const pool = require('../config/database');

async function getSalesReport(req, res) {
  const period = req.query.period || 'all';
  let dateCondition = '';
  let detailDateCondition = '';

  if (period === '7d') {
    dateCondition = 'WHERE tanggal_penjualan >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    detailDateCondition = 'WHERE pj.tanggal_penjualan >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
  } else if (period === '30d') {
    dateCondition = 'WHERE tanggal_penjualan >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    detailDateCondition = 'WHERE pj.tanggal_penjualan >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
  }

  const [summaryRows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_transaksi,
       COALESCE(SUM(total_bayar), 0) AS total_omzet,
       COALESCE(AVG(total_bayar), 0) AS rata_rata_transaksi
     FROM penjualan
     ${dateCondition}`
  );

  const [paymentBreakdown] = await pool.execute(
    `SELECT
       metode_pembayaran,
       COUNT(*) AS jumlah_transaksi,
       COALESCE(SUM(total_bayar), 0) AS total_nominal
     FROM penjualan
     ${dateCondition}
     GROUP BY metode_pembayaran
     ORDER BY total_nominal DESC`
  );

  let dailySalesQuery;
  if (period === '7d') {
    dailySalesQuery = `SELECT tanggal, total_transaksi AS jumlah_transaksi, total_omzet FROM v_rekap_omzet_harian WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ORDER BY tanggal DESC LIMIT 7`;
  } else if (period === '30d') {
    dailySalesQuery = `SELECT tanggal, total_transaksi AS jumlah_transaksi, total_omzet FROM v_rekap_omzet_harian WHERE tanggal >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) ORDER BY tanggal DESC LIMIT 30`;
  } else {
    dailySalesQuery = `SELECT tanggal, total_transaksi AS jumlah_transaksi, total_omzet FROM v_rekap_omzet_harian ORDER BY tanggal DESC LIMIT 30`;
  }
  const [dailySales] = await pool.execute(dailySalesQuery);

  const [fastMoving] = await pool.execute(
    `SELECT
       p.id_produk,
       p.nama_produk,
       p.barcode,
       p.satuan,
       k.nama_kategori,
       COALESCE(SUM(dp.jumlah), 0) AS total_terjual,
       COALESCE(SUM(dp.subtotal), 0) AS total_pendapatan
     FROM detail_penjualan dp
     JOIN penjualan pj ON pj.id_penjualan = dp.id_penjualan
     JOIN produk p ON p.id_produk = dp.id_produk
     JOIN kategori k ON k.id_kategori = p.id_kategori
     ${detailDateCondition}
     GROUP BY p.id_produk, p.nama_produk, p.barcode, p.satuan, k.nama_kategori
     ORDER BY total_terjual DESC
     LIMIT 10`
  );

  res.json({
    data: {
      period,
      summary: summaryRows[0] || { total_transaksi: 0, total_omzet: 0, rata_rata_transaksi: 0 },
      paymentBreakdown,
      dailySales,
      fastMoving
    }
  });
}

async function getStockMovementReport(req, res) {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const parameters = [];
  let filter = '';
  if (warehouseId) {
    filter = 'AND g.id_gudang = ?';
    parameters.push(warehouseId);
  }

  const [rows] = await pool.execute(
    `SELECT
       p.id_produk,
       p.nama_produk,
       p.barcode,
       p.satuan,
       g.id_gudang,
       g.nama_gudang,
       COALESCE(cs.jumlah_stok, 0) AS stok_saat_ini,
       COALESCE(cs.status_stok, 'Habis') AS status_stok,
       COALESCE((
         SELECT SUM(dp.jumlah)
           FROM detail_pembelian dp
           JOIN pembelian pb ON pb.id_pembelian = dp.id_pembelian
          WHERE dp.id_produk = p.id_produk AND pb.status_pembayaran = 'Diterima'
       ), 0) AS total_masuk_pengadaan,
       COALESCE((
         SELECT SUM(dr.jumlah_retur)
           FROM detail_retur dr
           JOIN retur r ON r.id_retur = dr.id_retur
          WHERE dr.id_produk = p.id_produk AND r.id_gudang = g.id_gudang AND r.jenis_retur = 'Dari Pelanggan'
       ), 0) AS total_masuk_retur,
       COALESCE((
         SELECT SUM(dj.jumlah)
           FROM detail_penjualan dj
           JOIN penjualan pj ON pj.id_penjualan = dj.id_penjualan
          WHERE dj.id_produk = p.id_produk AND pj.id_gudang = g.id_gudang
       ), 0) AS total_keluar_penjualan,
       COALESCE((
         SELECT SUM(dr.jumlah_retur)
           FROM detail_retur dr
           JOIN retur r ON r.id_retur = dr.id_retur
          WHERE dr.id_produk = p.id_produk AND r.id_gudang = g.id_gudang AND r.jenis_retur = 'Ke Supplier'
       ), 0) AS total_keluar_retur,
       COALESCE((
         SELECT SUM(dso.selisih)
           FROM detail_stock_opname dso
           JOIN stock_opname so ON so.id_opname = dso.id_opname
          WHERE dso.id_produk = p.id_produk AND so.id_gudang = g.id_gudang
       ), 0) AS total_penyesuaian_opname
     FROM produk p
     CROSS JOIN gudang g
     LEFT JOIN current_stock cs ON cs.id_produk = p.id_produk AND cs.id_gudang = g.id_gudang
     WHERE p.aktif = TRUE ${filter}
     ORDER BY p.nama_produk, g.nama_gudang`,
    parameters
  );

  res.json({ data: rows });
}

module.exports = {
  getSalesReport,
  getStockMovementReport
};
