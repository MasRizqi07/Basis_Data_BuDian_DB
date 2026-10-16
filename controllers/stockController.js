const pool = require('../config/database');
const { requiredPositiveInteger } = require('../utils/http');

async function getStock(req, res) {
  const parameters = [];
  let filter = '';
  if (req.query.warehouseId) {
    const warehouseId = requiredPositiveInteger(req.query.warehouseId, 'ID gudang');
    filter = 'WHERE cs.id_gudang = ?';
    parameters.push(warehouseId);
  }

  const [rows] = await pool.execute(
    `SELECT cs.id_stock, cs.id_produk, p.kode_barcode, p.nama_produk, p.satuan,
            p.harga_beli, p.harga_jual, p.stok_minimum, cs.id_gudang,
            g.nama_gudang, cs.jumlah_stok, cs.status_stok,
            cs.tanggal_update_terakhir
       FROM current_stock cs
       JOIN produk p ON p.id_produk = cs.id_produk
       JOIN gudang g ON g.id_gudang = cs.id_gudang
       ${filter}
      ORDER BY p.nama_produk, g.nama_gudang`,
    parameters
  );
  res.json({ data: rows });
}

async function getSummary(req, res) {
  const [rows] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM produk WHERE aktif = TRUE) AS total_produk,
       COALESCE(SUM(cs.jumlah_stok * p.harga_beli), 0) AS total_nilai_stok,
       COALESCE(SUM(cs.status_stok = 'Menipis'), 0) AS item_menipis,
       COALESCE(SUM(cs.status_stok = 'Habis'), 0) AS item_habis
     FROM current_stock cs
     JOIN produk p ON p.id_produk = cs.id_produk`
  );
  res.json({ data: rows[0] });
}

module.exports = { getStock, getSummary };
