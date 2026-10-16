const { randomBytes } = require('node:crypto');
const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeReturnNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `RET-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function listReturns(_req, res) {
  const [rows] = await pool.execute(
    `SELECT r.id_retur, r.no_retur, r.tanggal_retur, r.jenis_retur,
            r.total_nilai_retur, r.status_retur,
            r.id_pembelian, pb.no_faktur,
            r.id_penjualan, pj.no_transaksi,
            r.id_gudang, g.nama_gudang,
            r.id_karyawan, k.nama_karyawan,
            COUNT(dr.id_detail_retur) AS jumlah_item
       FROM retur r
       LEFT JOIN pembelian pb ON pb.id_pembelian = r.id_pembelian
       LEFT JOIN penjualan pj ON pj.id_penjualan = r.id_penjualan
       JOIN gudang g ON g.id_gudang = r.id_gudang
       JOIN karyawan k ON k.id_karyawan = r.id_karyawan
       LEFT JOIN detail_retur dr ON dr.id_retur = r.id_retur
      GROUP BY r.id_retur
      ORDER BY r.tanggal_retur DESC`
  );
  res.json({ data: rows });
}

async function getReturnReferences(_req, res) {
  const [purchases] = await pool.execute(
    `SELECT b.id_pembelian AS id, b.no_faktur AS code,
            CONCAT(b.no_faktur, ' — ', s.nama_supplier, ' (', DATE_FORMAT(b.tanggal_pembelian, '%d/%m/%Y'), ')') AS label
       FROM pembelian b
       JOIN supplier s ON s.id_supplier = b.id_supplier
      ORDER BY b.tanggal_pembelian DESC LIMIT 50`
  );

  const [sales] = await pool.execute(
    `SELECT p.id_penjualan AS id, p.no_transaksi AS code,
            CONCAT(p.no_transaksi, ' — ', p.metode_pembayaran, ' (', DATE_FORMAT(p.tanggal_penjualan, '%d/%m/%Y'), ')') AS label
       FROM penjualan p
      ORDER BY p.tanggal_penjualan DESC LIMIT 50`
  );

  res.json({ data: { purchases, sales } });
}

async function createReturn(req, res) {
  const { returnType, status = 'Selesai' } = req.body;
  if (!['Ke Supplier', 'Dari Pelanggan'].includes(returnType)) {
    throw httpError(400, "Jenis retur harus 'Ke Supplier' atau 'Dari Pelanggan'.");
  }

  const warehouseId = requiredPositiveInteger(req.body.warehouseId, 'ID gudang');
  const employeeId = requiredPositiveInteger(req.body.employeeId, 'ID karyawan');
  const referenceId = requiredPositiveInteger(req.body.referenceId, 'ID referensi pembelian/penjualan');
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'Retur harus memiliki minimal satu item produk.');
  }

  const validReasons = ['Rusak', 'Kadaluarsa', 'Tidak Sesuai'];
  const lines = items.map((item) => {
    const productId = requiredPositiveInteger(item.productId, 'ID produk');
    const quantity = requiredPositiveInteger(item.quantity, 'Jumlah retur');
    const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : null;
    const reason = String(item.reason || 'Rusak').trim();
    if (!validReasons.includes(reason)) {
      throw httpError(400, "Alasan retur harus 'Rusak', 'Kadaluarsa', atau 'Tidak Sesuai'.");
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      throw httpError(400, 'Harga satuan tidak valid.');
    }
    return { productId, quantity, unitPrice, reason };
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [warehouses] = await connection.execute(
      'SELECT id_gudang FROM gudang WHERE id_gudang = ? FOR UPDATE',
      [warehouseId]
    );
    if (!warehouses.length) throw httpError(400, 'Gudang tidak ditemukan.');

    const [employees] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? FOR UPDATE',
      [employeeId]
    );
    if (!employees.length) throw httpError(400, 'Karyawan tidak ditemukan.');

    let purchaseId = null;
    let saleId = null;

    if (returnType === 'Ke Supplier') {
      purchaseId = referenceId;
      const [purchases] = await connection.execute(
        'SELECT id_pembelian FROM pembelian WHERE id_pembelian = ? FOR UPDATE',
        [purchaseId]
      );
      if (!purchases.length) throw httpError(400, 'Faktur pembelian tidak ditemukan.');
    } else {
      saleId = referenceId;
      const [sales] = await connection.execute(
        'SELECT id_penjualan FROM penjualan WHERE id_penjualan = ? FOR UPDATE',
        [saleId]
      );
      if (!sales.length) throw httpError(400, 'Transaksi penjualan tidak ditemukan.');
    }

    const productIds = lines.map((l) => l.productId).sort((a, b) => a - b);
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id_produk, nama_produk, harga_beli, harga_jual, stok_minimum
         FROM produk
        WHERE aktif = TRUE AND id_produk IN (${placeholders})
        ORDER BY id_produk
        FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length) {
      throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    }
    const productById = new Map(products.map((p) => [p.id_produk, p]));

    let totalNilai = 0;
    const processedLines = [];

    for (const line of lines) {
      const product = productById.get(line.productId);
      const unitPrice = line.unitPrice ?? (returnType === 'Ke Supplier' ? Number(product.harga_beli) : Number(product.harga_jual));
      const subtotal = unitPrice * line.quantity;
      totalNilai += subtotal;

      await connection.execute(
        `INSERT INTO current_stock
          (id_produk, id_gudang, jumlah_stok, stok_minimum, status_stok)
         VALUES (?, ?, 0, ?, 'Habis')
         ON DUPLICATE KEY UPDATE id_current_stock = id_current_stock`,
        [line.productId, warehouseId, product.stok_minimum]
      );

      const [stocks] = await connection.execute(
        `SELECT jumlah_stok, stok_minimum
           FROM current_stock
          WHERE id_produk = ? AND id_gudang = ?
          FOR UPDATE`,
        [line.productId, warehouseId]
      );

      const currentQty = Number(stocks[0].jumlah_stok);
      const minStock = Number(stocks[0].stok_minimum);

      let newQty = currentQty;
      if (returnType === 'Ke Supplier') {
        if (currentQty < line.quantity) {
          throw httpError(400, `Stok produk ${product.nama_produk} di gudang (${currentQty}) tidak mencukupi untuk retur ke supplier sejumlah ${line.quantity}.`);
        }
        newQty = currentQty - line.quantity;
      } else {
        newQty = currentQty + line.quantity;
      }

      const newStatus = newQty <= 0 ? 'Habis' : newQty <= minStock ? 'Menipis' : 'Aman';

      await connection.execute(
        `UPDATE current_stock
            SET jumlah_stok = ?, status_stok = ?, tanggal_update = CURRENT_TIMESTAMP
          WHERE id_produk = ? AND id_gudang = ?`,
        [newQty, newStatus, line.productId, warehouseId]
      );

      processedLines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice,
        subtotal,
        reason: line.reason
      });
    }

    const returnNumber = makeReturnNumber();
    const [header] = await connection.execute(
      `INSERT INTO retur
        (no_retur, id_pembelian, id_penjualan, id_karyawan, id_gudang,
         jenis_retur, total_nilai_retur, status_retur)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        returnNumber,
        purchaseId,
        saleId,
        employeeId,
        warehouseId,
        returnType,
        totalNilai,
        status
      ]
    );

    for (const item of processedLines) {
      await connection.execute(
        `INSERT INTO detail_retur
          (id_retur, id_produk, jumlah_retur, harga_satuan, subtotal, alasan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [header.insertId, item.productId, item.quantity, item.unitPrice, item.subtotal, item.reason]
      );
    }

    await connection.commit();
    res.status(201).json({
      data: {
        id: header.insertId,
        returnNumber,
        returnType,
        total: totalNilai,
        itemsCount: processedLines.length
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  createReturn,
  getReturnReferences,
  listReturns
};

