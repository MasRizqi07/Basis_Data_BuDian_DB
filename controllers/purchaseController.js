const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeReference(prefix) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function listPurchases(req, res) {
  const [rows] = await pool.execute(
    `SELECT b.id_pembelian, b.nomor_po, b.tanggal_pembelian, b.status_pembelian,
            b.total_pembelian, s.nama_supplier, g.nama_gudang,
            COUNT(d.id_detail_pembelian) AS jumlah_item
       FROM pembelian b
       JOIN supplier s ON s.id_supplier = b.id_supplier
       JOIN gudang g ON g.id_gudang = b.id_gudang
       LEFT JOIN detail_pembelian d ON d.id_pembelian = b.id_pembelian
      GROUP BY b.id_pembelian
      ORDER BY b.tanggal_pembelian DESC`
  );
  res.json({ data: rows });
}

async function createPurchase(req, res) {
  const supplierId = requiredPositiveInteger(req.body.supplierId, 'ID supplier');
  const warehouseId = requiredPositiveInteger(req.body.warehouseId, 'ID gudang');
  const employeeId = requiredPositiveInteger(req.body.employeeId, 'ID karyawan');
  if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
    throw httpError(400, 'PO harus memiliki minimal satu produk.');
  }
  const itemMap = new Map();
  for (const item of req.body.items) {
    const productId = requiredPositiveInteger(item.productId, 'ID produk');
    const quantity = requiredPositiveInteger(item.quantity, 'Jumlah beli');
    const unitPrice = item.unitPrice === undefined ? null : Number(item.unitPrice);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw httpError(400, 'Harga beli tidak valid.');
    }
    if (itemMap.has(productId)) throw httpError(400, 'Produk PO tidak boleh berulang.');
    itemMap.set(productId, { quantity, unitPrice });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [products] = await connection.execute(
      `SELECT id_produk, harga_beli FROM produk
        WHERE aktif = TRUE AND id_produk IN (${[...itemMap.keys()].map(() => '?').join(',')})
        FOR UPDATE`,
      [...itemMap.keys()]
    );
    if (products.length !== itemMap.size) throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    const byId = new Map(products.map((product) => [product.id_produk, product]));
    const number = makeReference('PO');
    const [header] = await connection.execute(
      `INSERT INTO pembelian
        (nomor_po, id_supplier, id_gudang, id_karyawan, status_pembelian)
       VALUES (?, ?, ?, ?, 'Draft')`,
      [number, supplierId, warehouseId, employeeId]
    );
    let total = 0;
    for (const [productId, item] of itemMap) {
      const unitPrice = item.unitPrice ?? Number(byId.get(productId).harga_beli);
      const subtotal = unitPrice * item.quantity;
      total += subtotal;
      await connection.execute(
        `INSERT INTO detail_pembelian
          (id_pembelian, id_produk, jumlah_beli, harga_beli_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [header.insertId, productId, item.quantity, unitPrice, subtotal]
      );
    }
    await connection.execute(
      'UPDATE pembelian SET total_pembelian = ? WHERE id_pembelian = ?',
      [total, header.insertId]
    );
    await connection.commit();
    res.status(201).json({ data: { id: header.insertId, purchaseNumber: number, total } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function receivePurchase(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID pembelian');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [purchases] = await connection.execute(
      `SELECT id_pembelian, id_gudang, status_pembelian
         FROM pembelian WHERE id_pembelian = ? FOR UPDATE`,
      [id]
    );
    if (!purchases.length) throw httpError(404, 'Pembelian tidak ditemukan.');
    const purchase = purchases[0];
    if (purchase.status_pembelian !== 'Draft') {
      throw httpError(409, 'Hanya PO berstatus Draft yang dapat diterima.');
    }
    const [items] = await connection.execute(
      `SELECT d.id_produk, d.jumlah_beli, p.stok_minimum
         FROM detail_pembelian d
         JOIN produk p ON p.id_produk = d.id_produk
        WHERE d.id_pembelian = ? FOR UPDATE`,
      [id]
    );
    if (!items.length) throw httpError(409, 'PO tidak memiliki item.');

    for (const item of items) {
      await connection.execute(
        `INSERT INTO current_stock (id_produk, id_gudang, jumlah_stok, status_stok)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status_stok = CASE
             WHEN jumlah_stok + VALUES(jumlah_stok) <= 0 THEN 'Habis'
             WHEN jumlah_stok + VALUES(jumlah_stok) <= ? THEN 'Menipis'
             ELSE 'Aman'
           END,
           jumlah_stok = jumlah_stok + VALUES(jumlah_stok),
           tanggal_update_terakhir = CURRENT_TIMESTAMP`,
        [
          item.id_produk, purchase.id_gudang, item.jumlah_beli,
          item.jumlah_beli <= item.stok_minimum ? 'Menipis' : 'Aman',
          item.stok_minimum
        ]
      );
    }
    await connection.execute(
      `UPDATE pembelian SET status_pembelian = 'Selesai' WHERE id_pembelian = ?`,
      [id]
    );
    await connection.commit();
    res.json({ data: { id, status: 'Selesai', itemsReceived: items.length } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createPurchase, listPurchases, receivePurchase };
