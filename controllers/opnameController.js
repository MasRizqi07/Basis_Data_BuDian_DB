const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeReference(prefix) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [employees] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? AND aktif = TRUE FOR UPDATE',
      [employeeId]
    );
    if (!employees.length) throw httpError(400, 'Karyawan tidak ditemukan atau tidak aktif.');

    const opnameNumber = makeReference('OPN');
    const [header] = await connection.execute(
      `INSERT INTO stock_opname (nomor_opname, id_gudang, id_karyawan, catatan)
       VALUES (?, ?, ?, ?)`,
      [opnameNumber, warehouseId, employeeId, notes]
    );

    const resultLines = [];
    for (const line of lines) {
      const [products] = await connection.execute(
        'SELECT id_produk FROM produk WHERE id_produk = ? AND aktif = TRUE FOR UPDATE',
        [line.productId]
      );
      if (!products.length) throw httpError(400, `Produk ${line.productId} tidak ditemukan atau tidak aktif.`);

      await connection.execute(
        `INSERT INTO current_stock (id_produk, id_gudang, jumlah_stok, status_stok)
         VALUES (?, ?, 0, 'Habis')
         ON DUPLICATE KEY UPDATE id_stock = id_stock`,
        [line.productId, warehouseId]
      );
      const [stockRows] = await connection.execute(
        `SELECT jumlah_stok FROM current_stock
          WHERE id_produk = ? AND id_gudang = ? FOR UPDATE`,
        [line.productId, warehouseId]
      );
      const system = stockRows[0].jumlah_stok;
      await connection.execute(
        `INSERT INTO detail_stock_opname
          (id_stock_opname, id_produk, jumlah_sistem, jumlah_fisik)
         VALUES (?, ?, ?, ?)`,
        [header.insertId, line.productId, system, line.physical]
      );
      resultLines.push({
        productId: line.productId,
        system,
        physical: line.physical,
        difference: line.physical - system
      });
    }

    await connection.commit();
    res.status(201).json({ data: { id: header.insertId, opnameNumber, items: resultLines } });
  } catch (error) {
    await connection.rollback();
    if (error.sqlState === '45000') throw httpError(409, error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createOpname };
