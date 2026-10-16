require('dotenv').config();

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const pool = require('../config/database');

function reference(prefix) {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

async function rollbackTest(connection, label, run) {
  await connection.beginTransaction();
  try {
    await run();
    console.log(`PASS ${label}`);
  } finally {
    await connection.rollback();
  }
}

async function main() {
  const connection = await pool.getConnection();
  try {
    const [monitoring] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM produk WHERE aktif = TRUE) AS total_produk,
         COALESCE(SUM(cs.jumlah_stok * p.harga_beli), 0) AS nilai_stok,
         COUNT(DISTINCT CASE WHEN cs.status_stok = 'Menipis' THEN cs.id_produk END) AS menipis,
         COUNT(DISTINCT CASE WHEN cs.status_stok = 'Habis' THEN cs.id_produk END) AS habis
       FROM produk p
       LEFT JOIN current_stock cs ON cs.id_produk = p.id_produk
       WHERE p.aktif = TRUE`
    );
    assert.ok(Number(monitoring[0].total_produk) > 0, 'Dashboard harus menghitung produk aktif');
    assert.ok(Number(monitoring[0].nilai_stok) >= 0, 'Dashboard harus menghitung estimasi nilai stok');
    console.log('PASS Monitoring KPI membaca produk dan snapshot stok');

    const [cashiers] = await connection.execute(
      "SELECT id_karyawan FROM karyawan WHERE jabatan = 'Kasir' ORDER BY id_karyawan LIMIT 1"
    );
    const [saleStock] = await connection.execute(
      `SELECT cs.id_produk, cs.id_gudang, cs.jumlah_stok, p.harga_jual
         FROM current_stock cs
         JOIN produk p ON p.id_produk = cs.id_produk
        WHERE cs.jumlah_stok > 0 AND p.aktif = TRUE
        ORDER BY cs.id_gudang, cs.id_produk
        LIMIT 1`
    );
    assert.ok(cashiers.length && saleStock.length, 'Seed harus menyediakan kasir dan stok positif');

    await rollbackTest(connection, 'Control POS mengurangi stok melalui trigger', async () => {
      const number = reference('TEST');
      const price = Number(saleStock[0].harga_jual);
      const [header] = await connection.execute(
        `INSERT INTO penjualan
          (no_transaksi, id_karyawan, id_gudang, total_bayar, metode_pembayaran)
         VALUES (?, ?, ?, ?, 'Tunai')`,
        [number, cashiers[0].id_karyawan, saleStock[0].id_gudang, price]
      );
      await connection.execute(
        `INSERT INTO detail_penjualan
          (id_penjualan, id_produk, jumlah, harga_satuan, subtotal)
         VALUES (?, ?, 1, ?, ?)`,
        [header.insertId, saleStock[0].id_produk, price, price]
      );
      const [after] = await connection.execute(
        'SELECT jumlah_stok FROM current_stock WHERE id_produk = ? AND id_gudang = ?',
        [saleStock[0].id_produk, saleStock[0].id_gudang]
      );
      assert.equal(Number(after[0].jumlah_stok), Number(saleStock[0].jumlah_stok) - 1);
    });

    await rollbackTest(connection, 'Control trigger menolak penjualan saat stok habis', async () => {
      const [emptyStocks] = await connection.execute(
        `SELECT cs.id_produk, cs.id_gudang, p.harga_jual
           FROM current_stock cs JOIN produk p ON p.id_produk = cs.id_produk
          WHERE cs.jumlah_stok = 0 AND p.aktif = TRUE
          ORDER BY cs.id_gudang, cs.id_produk LIMIT 1`
      );
      const target = emptyStocks[0] || saleStock[0];
      await connection.execute(
        `UPDATE current_stock SET jumlah_stok = 0, status_stok = 'Habis'
          WHERE id_produk = ? AND id_gudang = ?`,
        [target.id_produk, target.id_gudang]
      );
      const price = Number(target.harga_jual);
      const [header] = await connection.execute(
        `INSERT INTO penjualan
          (no_transaksi, id_karyawan, id_gudang, total_bayar, metode_pembayaran)
         VALUES (?, ?, ?, ?, 'Tunai')`,
        [reference('TEST'), cashiers[0].id_karyawan, target.id_gudang, price]
      );
      await assert.rejects(
        connection.execute(
          `INSERT INTO detail_penjualan
            (id_penjualan, id_produk, jumlah, harga_satuan, subtotal)
           VALUES (?, ?, 1, ?, ?)`,
          [header.insertId, target.id_produk, price, price]
        ),
        (error) => error.sqlState === '45000' && error.message === 'Stok tidak mencukupi'
      );
    });

    const [opnameEmployee] = await connection.execute(
      'SELECT id_karyawan FROM karyawan ORDER BY id_karyawan LIMIT 1'
    );
    const [opnameStock] = await connection.execute(
      `SELECT id_produk, id_gudang, jumlah_stok
         FROM current_stock
        ORDER BY id_gudang, id_produk
        LIMIT 1`
    );
    assert.ok(opnameEmployee.length && opnameStock.length, 'Seed harus menyediakan petugas dan snapshot');

    await rollbackTest(connection, 'Control opname menyinkronkan stok fisik melalui trigger', async () => {
      const [header] = await connection.execute(
        `INSERT INTO stock_opname
          (no_opname, id_gudang, id_karyawan, status_opname)
         VALUES (?, ?, ?, 'Selesai')`,
        [reference('TEST'), opnameStock[0].id_gudang, opnameEmployee[0].id_karyawan]
      );
      const system = Number(opnameStock[0].jumlah_stok);
      const physical = system + 2;
      await connection.execute(
        `INSERT INTO detail_stock_opname
          (id_opname, id_produk, stok_sistem, stok_fisik, selisih, jenis_penyesuaian)
         VALUES (?, ?, ?, ?, 2, 'Penambahan')`,
        [header.insertId, opnameStock[0].id_produk, system, physical]
      );
      const [after] = await connection.execute(
        'SELECT jumlah_stok FROM current_stock WHERE id_produk = ? AND id_gudang = ?',
        [opnameStock[0].id_produk, opnameStock[0].id_gudang]
      );
      assert.equal(Number(after[0].jumlah_stok), physical);
    });
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Black-box smoke test gagal:', error.message);
  process.exitCode = 1;
});
