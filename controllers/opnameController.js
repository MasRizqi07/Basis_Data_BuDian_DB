const { randomBytes } = require('node:crypto');
const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeOpnameNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `OPN-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function createOpname(req, res) {
  const warehouseId = requiredPositiveInteger(req.body.warehouseId, 'ID gudang');
  const employeeId = requiredPositiveInteger(req.body.employeeId, 'ID karyawan');
  const { items, notes = null } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'Opname harus memiliki minimal satu produk.');
  }

  const lines = items.map((item) => ({
    productId: requiredPositiveInteger(item.productId, 'ID produk'),
    physical: Number(item.physical)
  }));
  if (lines.some((line) => !Number.isSafeInteger(line.physical) || line.physical < 0)) {
    throw httpError(400, 'Stok fisik harus berupa bilangan bulat nol atau lebih.');
  }
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    throw httpError(400, 'Produk opname tidak boleh berulang.');
  }
  if (notes !== null && (typeof notes !== 'string' || notes.length > 255)) {
    throw httpError(400, 'Keterangan opname maksimal 255 karakter.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [employees] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? FOR UPDATE',
      [employeeId]
    );
    if (!employees.length) throw httpError(400, 'Karyawan tidak ditemukan.');

    const [warehouses] = await connection.execute(
      'SELECT id_gudang FROM gudang WHERE id_gudang = ? FOR UPDATE',
      [warehouseId]
    );
    if (!warehouses.length) throw httpError(400, 'Gudang tidak ditemukan.');

    const productIds = lines.map((line) => line.productId).sort((a, b) => a - b);
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id_produk, stok_minimum
         FROM produk
        WHERE aktif = TRUE AND id_produk IN (${placeholders})
        ORDER BY id_produk
        FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length) {
      throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    }

    const opnameNumber = makeOpnameNumber();
    const [header] = await connection.execute(
      `INSERT INTO stock_opname
        (no_opname, id_gudang, id_karyawan, status_opname, keterangan)
       VALUES (?, ?, ?, 'Selesai', ?)`,
      [opnameNumber, warehouseId, employeeId, notes]
    );
    const productById = new Map(products.map((product) => [product.id_produk, product]));
    const lineById = new Map(lines.map((line) => [line.productId, line]));
    const resultLines = [];

    for (const productId of productIds) {
      const product = productById.get(productId);
      const line = lineById.get(productId);
      await connection.execute(
        `INSERT INTO current_stock
          (id_produk, id_gudang, jumlah_stok, stok_minimum, status_stok)
         VALUES (?, ?, 0, ?, 'Habis')
         ON DUPLICATE KEY UPDATE id_current_stock = id_current_stock`,
        [productId, warehouseId, product.stok_minimum]
      );
      const [stocks] = await connection.execute(
        `SELECT jumlah_stok, stok_minimum
           FROM current_stock
          WHERE id_produk = ? AND id_gudang = ?
          FOR UPDATE`,
        [productId, warehouseId]
      );
      const systemQuantity = stocks[0].jumlah_stok;
      const difference = line.physical - systemQuantity;
      const adjustment = difference > 0
        ? 'Penambahan'
        : difference < 0
          ? 'Pengurangan'
          : 'Tetap';

      await connection.execute(
        `INSERT INTO detail_stock_opname
          (id_opname, id_produk, stok_sistem, stok_fisik, selisih,
           jenis_penyesuaian, keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [header.insertId, productId, systemQuantity, line.physical, difference, adjustment, notes]
      );
      resultLines.push({
        productId,
        system: systemQuantity,
        physical: line.physical,
        difference,
        adjustment
      });
    }

    await connection.commit();
    res.status(201).json({
      data: { id: header.insertId, opnameNumber, items: resultLines }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createOpname };
