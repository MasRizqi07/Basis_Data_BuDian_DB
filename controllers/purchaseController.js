const { randomBytes } = require('node:crypto');
const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeInvoiceNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `PB-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function listPurchases(_req, res) {
  const [rows] = await pool.execute(
    `SELECT b.id_pembelian, b.no_faktur, b.tanggal_pembelian,
            b.status_pembayaran, b.total_harga, s.nama_supplier,
            k.nama_karyawan, COUNT(d.id_detail_beli) AS jumlah_item
       FROM pembelian b
       JOIN supplier s ON s.id_supplier = b.id_supplier
       JOIN karyawan k ON k.id_karyawan = b.id_karyawan
       LEFT JOIN detail_pembelian d ON d.id_pembelian = b.id_pembelian
      GROUP BY b.id_pembelian
      ORDER BY b.tanggal_pembelian DESC`
  );
  res.json({ data: rows });
}

async function createPurchase(req, res) {
  const supplierId = requiredPositiveInteger(req.body.supplierId, 'ID supplier');
  const employeeId = requiredPositiveInteger(req.body.employeeId, 'ID karyawan');
  if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
    throw httpError(400, 'Pembelian harus memiliki minimal satu produk.');
  }

  const items = new Map();
  for (const item of req.body.items) {
    const productId = requiredPositiveInteger(item.productId, 'ID produk');
    const quantity = requiredPositiveInteger(item.quantity, 'Jumlah beli');
    const unitPrice = item.unitPrice === undefined ? null : Number(item.unitPrice);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw httpError(400, 'Harga satuan tidak valid.');
    }
    if (items.has(productId)) throw httpError(400, 'Produk pembelian tidak boleh berulang.');
    items.set(productId, { quantity, unitPrice });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [suppliers] = await connection.execute(
      'SELECT id_supplier FROM supplier WHERE id_supplier = ? FOR UPDATE',
      [supplierId]
    );
    if (!suppliers.length) throw httpError(400, 'Supplier tidak ditemukan.');

    const [employees] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? AND jabatan = ? FOR UPDATE',
      [employeeId, 'Purchasing']
    );
    if (!employees.length) throw httpError(400, 'Karyawan purchasing tidak ditemukan.');

    const productIds = [...items.keys()].sort((a, b) => a - b);
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id_produk, harga_beli
         FROM produk
        WHERE aktif = TRUE AND id_produk IN (${placeholders})
        ORDER BY id_produk
        FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length) {
      throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    }

    const productById = new Map(products.map((product) => [product.id_produk, product]));
    const invoiceNumber = makeInvoiceNumber();
    const [purchase] = await connection.execute(
      `INSERT INTO pembelian
        (no_faktur, id_supplier, id_karyawan, total_harga, status_pembayaran)
       VALUES (?, ?, ?, 0, 'Belum Lunas')`,
      [invoiceNumber, supplierId, employeeId]
    );

    let total = 0;
    for (const productId of productIds) {
      const item = items.get(productId);
      const unitPrice = item.unitPrice ?? Number(productById.get(productId).harga_beli);
      const subtotal = unitPrice * item.quantity;
      total += subtotal;
      await connection.execute(
        `INSERT INTO detail_pembelian
          (id_pembelian, id_produk, jumlah, harga_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [purchase.insertId, productId, item.quantity, unitPrice, subtotal]
      );
    }
    await connection.execute(
      'UPDATE pembelian SET total_harga = ? WHERE id_pembelian = ?',
      [total, purchase.insertId]
    );
    await connection.commit();
    res.status(201).json({
      data: { id: purchase.insertId, invoiceNumber, total, status: 'Belum Lunas' }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function receivePurchase(req, res) {
  const purchaseId = requiredPositiveInteger(req.params.id, 'ID pembelian');
  const warehouseId = req.body.warehouseId ? requiredPositiveInteger(req.body.warehouseId, 'ID gudang') : 1;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [warehouses] = await connection.execute(
      'SELECT id_gudang FROM gudang WHERE id_gudang = ? FOR UPDATE',
      [warehouseId]
    );
    if (!warehouses.length) throw httpError(400, 'Gudang tujuan penerimaan tidak ditemukan.');

    const [purchases] = await connection.execute(
      'SELECT id_pembelian, no_faktur, status_pembayaran FROM pembelian WHERE id_pembelian = ? FOR UPDATE',
      [purchaseId]
    );
    if (!purchases.length) throw httpError(404, 'Data pembelian tidak ditemukan.');

    const purchase = purchases[0];
    if (purchase.status_pembayaran === 'Diterima') {
      throw httpError(400, 'Pembelian ini sudah diterima sebelumnya.');
    }

    const [details] = await connection.execute(
      `SELECT dp.id_produk, dp.jumlah, p.nama_produk, p.stok_minimum
         FROM detail_pembelian dp
         JOIN produk p ON p.id_produk = dp.id_produk
        WHERE dp.id_pembelian = ?
        FOR UPDATE`,
      [purchaseId]
    );
    if (!details.length) {
      throw httpError(400, 'Pembelian tidak memiliki item barang untuk diterima.');
    }

    for (const item of details) {
      await connection.execute(
        `INSERT INTO current_stock
          (id_produk, id_gudang, jumlah_stok, stok_minimum, status_stok)
         VALUES (?, ?, 0, ?, 'Habis')
         ON DUPLICATE KEY UPDATE id_current_stock = id_current_stock`,
        [item.id_produk, warehouseId, item.stok_minimum]
      );

      const [stocks] = await connection.execute(
        `SELECT jumlah_stok, stok_minimum
           FROM current_stock
          WHERE id_produk = ? AND id_gudang = ?
          FOR UPDATE`,
        [item.id_produk, warehouseId]
      );

      const currentQty = Number(stocks[0].jumlah_stok);
      const minStock = Number(stocks[0].stok_minimum);
      const newQty = currentQty + Number(item.jumlah);
      const newStatus = newQty <= 0 ? 'Habis' : newQty <= minStock ? 'Menipis' : 'Aman';

      await connection.execute(
        `UPDATE current_stock
            SET jumlah_stok = ?, status_stok = ?, tanggal_update = CURRENT_TIMESTAMP
          WHERE id_produk = ? AND id_gudang = ?`,
        [newQty, newStatus, item.id_produk, warehouseId]
      );
    }

    await connection.execute(
      "UPDATE pembelian SET status_pembayaran = 'Diterima' WHERE id_pembelian = ?",
      [purchaseId]
    );

    await connection.commit();
    res.json({
      data: {
        id: purchaseId,
        invoiceNumber: purchase.no_faktur,
        status: 'Diterima',
        receivedItems: details.length
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createPurchase, listPurchases, receivePurchase };
