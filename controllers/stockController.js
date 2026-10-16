const pool = require('../config/database');
const { requiredPositiveInteger } = require('../utils/http');

async function getStock(req, res) {
  const parameters = [];
  let filter = '';
  if (req.query.warehouseId) {
    filter = 'WHERE cs.id_gudang = ?';
    parameters.push(requiredPositiveInteger(req.query.warehouseId, 'ID gudang'));
  }

  const [rows] = await pool.execute(
    `SELECT cs.id_current_stock AS id_stock, cs.id_produk, p.barcode AS kode_barcode,
            p.nama_produk, p.satuan, p.harga_beli, p.harga_jual,
            cs.stok_minimum, cs.id_gudang, g.nama_gudang, cs.jumlah_stok,
            cs.status_stok, cs.tanggal_update AS tanggal_update_terakhir
       FROM current_stock cs
       JOIN produk p ON p.id_produk = cs.id_produk AND p.aktif = TRUE
       JOIN gudang g ON g.id_gudang = cs.id_gudang
       ${filter}
      ORDER BY p.nama_produk, g.nama_gudang`,
    parameters
  );
  res.json({ data: rows });
}

async function getSummary(req, res) {
  const parameters = [];
  let stockFilter = '';
  if (req.query.warehouseId) {
    stockFilter = 'AND cs.id_gudang = ?';
    parameters.push(requiredPositiveInteger(req.query.warehouseId, 'ID gudang'));
  }
  const [rows] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM produk WHERE aktif = TRUE) AS total_produk,
       COALESCE(SUM(cs.jumlah_stok * p.harga_beli), 0) AS total_nilai_stok,
       COUNT(DISTINCT CASE WHEN cs.status_stok = 'Menipis' THEN cs.id_produk END) AS item_menipis,
       COUNT(DISTINCT CASE WHEN cs.status_stok = 'Habis' THEN cs.id_produk END) AS item_habis
     FROM produk p
     LEFT JOIN current_stock cs ON cs.id_produk = p.id_produk ${stockFilter}
     WHERE p.aktif = TRUE`
    ,
    parameters
  );
  res.json({ data: rows[0] });
}

module.exports = { getStock, getSummary };
