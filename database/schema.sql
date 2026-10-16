CREATE DATABASE IF NOT EXISTS db_inventory_minimarket CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE db_inventory_minimarket;
CREATE TABLE IF NOT EXISTS kategori (
  id_kategori BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama_kategori VARCHAR(100) NOT NULL,
  deskripsi VARCHAR(255) NULL,
  PRIMARY KEY (id_kategori),
  UNIQUE KEY uq_kategori_nama (nama_kategori)
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS supplier (
  id_supplier BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama_supplier VARCHAR(120) NOT NULL,
  alamat VARCHAR(255) NULL,
  no_telepon VARCHAR(30) NULL,
  email VARCHAR(160) NULL,
  kontak_person VARCHAR(120) NULL,
  PRIMARY KEY (id_supplier),
  UNIQUE KEY uq_supplier_email (email)
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS karyawan (
  id_karyawan BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama_karyawan VARCHAR(120) NOT NULL,
  jabatan VARCHAR(60) NOT NULL,
  no_telepon VARCHAR(30) NULL,
  shift_kerja VARCHAR(40) NULL,
  PRIMARY KEY (id_karyawan)
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS gudang (
  id_gudang BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama_gudang VARCHAR(120) NOT NULL,
  lokasi VARCHAR(255) NULL,
  kapasitas INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id_gudang),
  UNIQUE KEY uq_gudang_nama (nama_gudang)
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS produk (
  id_produk BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_kategori BIGINT UNSIGNED NOT NULL,
  barcode VARCHAR(13) NOT NULL,
  nama_produk VARCHAR(160) NOT NULL,
  satuan VARCHAR(30) NOT NULL DEFAULT 'pcs',
  harga_beli DECIMAL(14, 2) NOT NULL DEFAULT 0,
  harga_jual DECIMAL(14, 2) NOT NULL,
  stok_minimum INT UNSIGNED NOT NULL DEFAULT 5,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id_produk),
  UNIQUE KEY uq_produk_barcode (barcode),
  KEY idx_produk_nama (nama_produk),
  CONSTRAINT chk_produk_harga CHECK (
    harga_beli >= 0
    AND harga_jual >= 0
  ),
  CONSTRAINT fk_produk_kategori FOREIGN KEY (id_kategori) REFERENCES kategori (id_kategori) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS current_stock (
  id_current_stock BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_produk BIGINT UNSIGNED NOT NULL,
  id_gudang BIGINT UNSIGNED NOT NULL,
  jumlah_stok INT NOT NULL DEFAULT 0,
  stok_minimum INT UNSIGNED NOT NULL DEFAULT 5,
  status_stok ENUM('Aman', 'Menipis', 'Habis') NOT NULL DEFAULT 'Habis',
  tanggal_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_current_stock),
  UNIQUE KEY uq_produk_gudang (id_produk, id_gudang),
  CONSTRAINT chk_current_stock_nonnegative CHECK (jumlah_stok >= 0),
  CONSTRAINT fk_current_stock_produk FOREIGN KEY (id_produk) REFERENCES produk (id_produk) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_current_stock_gudang FOREIGN KEY (id_gudang) REFERENCES gudang (id_gudang) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS pembelian (
  id_pembelian BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  no_faktur VARCHAR(40) NOT NULL,
  id_supplier BIGINT UNSIGNED NOT NULL,
  id_karyawan BIGINT UNSIGNED NOT NULL,
  tanggal_pembelian DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_harga DECIMAL(14, 2) NOT NULL DEFAULT 0,
  status_pembayaran ENUM('Belum Lunas', 'Lunas', 'Diterima') NOT NULL DEFAULT 'Belum Lunas',
  PRIMARY KEY (id_pembelian),
  UNIQUE KEY uq_pembelian_no_faktur (no_faktur),
  CONSTRAINT chk_pembelian_total CHECK (total_harga >= 0),
  CONSTRAINT fk_pembelian_supplier FOREIGN KEY (id_supplier) REFERENCES supplier (id_supplier) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pembelian_karyawan FOREIGN KEY (id_karyawan) REFERENCES karyawan (id_karyawan) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS detail_pembelian (
  id_detail_beli BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_pembelian BIGINT UNSIGNED NOT NULL,
  id_produk BIGINT UNSIGNED NOT NULL,
  jumlah INT UNSIGNED NOT NULL,
  harga_satuan DECIMAL(14, 2) NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL,
  PRIMARY KEY (id_detail_beli),
  UNIQUE KEY uq_detail_beli_produk (id_pembelian, id_produk),
  CONSTRAINT chk_detail_beli_qty CHECK (jumlah > 0),
  CONSTRAINT chk_detail_beli_harga CHECK (
    harga_satuan >= 0
    AND subtotal >= 0
  ),
  CONSTRAINT fk_detail_beli_pembelian FOREIGN KEY (id_pembelian) REFERENCES pembelian (id_pembelian) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_detail_beli_produk FOREIGN KEY (id_produk) REFERENCES produk (id_produk) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS penjualan (
  id_penjualan BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  no_transaksi VARCHAR(40) NOT NULL,
  id_karyawan BIGINT UNSIGNED NOT NULL,
  id_gudang BIGINT UNSIGNED NOT NULL,
  tanggal_penjualan DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_bayar DECIMAL(14, 2) NOT NULL DEFAULT 0,
  metode_pembayaran ENUM('Tunai', 'Debit', 'QRIS') NOT NULL,
  PRIMARY KEY (id_penjualan),
  UNIQUE KEY uq_penjualan_no_transaksi (no_transaksi),
  CONSTRAINT chk_penjualan_total CHECK (total_bayar >= 0),
  CONSTRAINT fk_penjualan_karyawan FOREIGN KEY (id_karyawan) REFERENCES karyawan (id_karyawan) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_penjualan_gudang FOREIGN KEY (id_gudang) REFERENCES gudang (id_gudang) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS detail_penjualan (
  id_detail_jual BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_penjualan BIGINT UNSIGNED NOT NULL,
  id_produk BIGINT UNSIGNED NOT NULL,
  jumlah INT UNSIGNED NOT NULL,
  harga_satuan DECIMAL(14, 2) NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL,
  PRIMARY KEY (id_detail_jual),
  UNIQUE KEY uq_detail_jual_produk (id_penjualan, id_produk),
  CONSTRAINT chk_detail_jual_qty CHECK (jumlah > 0),
  CONSTRAINT chk_detail_jual_harga CHECK (
    harga_satuan >= 0
    AND subtotal >= 0
  ),
  CONSTRAINT fk_detail_jual_penjualan FOREIGN KEY (id_penjualan) REFERENCES penjualan (id_penjualan) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_detail_jual_produk FOREIGN KEY (id_produk) REFERENCES produk (id_produk) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS retur (
  id_retur BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  no_retur VARCHAR(40) NOT NULL,
  id_pembelian BIGINT UNSIGNED NULL,
  id_penjualan BIGINT UNSIGNED NULL,
  id_karyawan BIGINT UNSIGNED NOT NULL,
  id_gudang BIGINT UNSIGNED NOT NULL,
  tanggal_retur DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  jenis_retur ENUM('Ke Supplier', 'Dari Pelanggan') NOT NULL,
  total_nilai_retur DECIMAL(14, 2) NOT NULL DEFAULT 0,
  status_retur VARCHAR(40) NOT NULL DEFAULT 'Menunggu',
  PRIMARY KEY (id_retur),
  UNIQUE KEY uq_retur_no_retur (no_retur),
  CONSTRAINT chk_retur_total CHECK (total_nilai_retur >= 0),
  CONSTRAINT fk_retur_pembelian FOREIGN KEY (id_pembelian) REFERENCES pembelian (id_pembelian) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_retur_penjualan FOREIGN KEY (id_penjualan) REFERENCES penjualan (id_penjualan) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_retur_karyawan FOREIGN KEY (id_karyawan) REFERENCES karyawan (id_karyawan) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_retur_gudang FOREIGN KEY (id_gudang) REFERENCES gudang (id_gudang) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS detail_retur (
  id_detail_retur BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_retur BIGINT UNSIGNED NOT NULL,
  id_produk BIGINT UNSIGNED NOT NULL,
  jumlah_retur INT UNSIGNED NOT NULL,
  harga_satuan DECIMAL(14, 2) NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL,
  alasan ENUM('Rusak', 'Kadaluarsa', 'Tidak Sesuai') NOT NULL,
  PRIMARY KEY (id_detail_retur),
  UNIQUE KEY uq_detail_retur_produk (id_retur, id_produk),
  CONSTRAINT chk_detail_retur_qty CHECK (jumlah_retur > 0),
  CONSTRAINT chk_detail_retur_harga CHECK (
    harga_satuan >= 0
    AND subtotal >= 0
  ),
  CONSTRAINT fk_detail_retur_retur FOREIGN KEY (id_retur) REFERENCES retur (id_retur) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_detail_retur_produk FOREIGN KEY (id_produk) REFERENCES produk (id_produk) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS stock_opname (
  id_opname BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  no_opname VARCHAR(40) NOT NULL,
  id_gudang BIGINT UNSIGNED NOT NULL,
  id_karyawan BIGINT UNSIGNED NOT NULL,
  tanggal_opname DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_opname ENUM('Draft', 'Selesai', 'Dibatalkan') NOT NULL DEFAULT 'Selesai',
  keterangan VARCHAR(255) NULL,
  PRIMARY KEY (id_opname),
  UNIQUE KEY uq_stock_opname_no_opname (no_opname),
  CONSTRAINT fk_stock_opname_gudang FOREIGN KEY (id_gudang) REFERENCES gudang (id_gudang) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_stock_opname_karyawan FOREIGN KEY (id_karyawan) REFERENCES karyawan (id_karyawan) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
CREATE TABLE IF NOT EXISTS detail_stock_opname (
  id_detail_opname BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_opname BIGINT UNSIGNED NOT NULL,
  id_produk BIGINT UNSIGNED NOT NULL,
  stok_sistem INT NOT NULL,
  stok_fisik INT NOT NULL,
  selisih INT NOT NULL,
  jenis_penyesuaian ENUM('Penambahan', 'Pengurangan', 'Tetap') NOT NULL,
  keterangan VARCHAR(255) NULL,
  PRIMARY KEY (id_detail_opname),
  UNIQUE KEY uq_detail_opname_produk (id_opname, id_produk),
  CONSTRAINT chk_detail_opname_qty CHECK (
    stok_sistem >= 0
    AND stok_fisik >= 0
  ),
  CONSTRAINT chk_detail_opname_selisih CHECK (selisih = stok_fisik - stok_sistem),
  CONSTRAINT fk_detail_opname_opname FOREIGN KEY (id_opname) REFERENCES stock_opname (id_opname) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_detail_opname_produk FOREIGN KEY (id_produk) REFERENCES produk (id_produk) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB;
DROP TRIGGER IF EXISTS trg_after_insert_detail_penjualan;
DROP TRIGGER IF EXISTS trg_after_insert_detail_stock_opname;
DELIMITER $$ CREATE TRIGGER trg_after_insert_detail_penjualan
AFTER
INSERT ON detail_penjualan FOR EACH ROW BEGIN
DECLARE v_gudang BIGINT UNSIGNED;
DECLARE v_stok INT;
DECLARE v_minimum INT UNSIGNED;
DECLARE v_stok_akhir INT;
SELECT id_gudang INTO v_gudang
FROM penjualan
WHERE id_penjualan = NEW.id_penjualan;
SELECT jumlah_stok,
  stok_minimum INTO v_stok,
  v_minimum
FROM current_stock
WHERE id_produk = NEW.id_produk
  AND id_gudang = v_gudang FOR
UPDATE;
IF v_stok IS NULL
OR v_stok < NEW.jumlah THEN SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Stok tidak mencukupi';
END IF;
SET v_stok_akhir = v_stok - NEW.jumlah;
UPDATE current_stock
SET jumlah_stok = v_stok_akhir,
  status_stok = CASE
    WHEN v_stok_akhir <= 0 THEN 'Habis'
    WHEN v_stok_akhir <= v_minimum THEN 'Menipis'
    ELSE 'Aman'
  END,
  tanggal_update = CURRENT_TIMESTAMP
WHERE id_produk = NEW.id_produk
  AND id_gudang = v_gudang;
END $$ CREATE TRIGGER trg_after_insert_detail_stock_opname
AFTER
INSERT ON detail_stock_opname FOR EACH ROW BEGIN
DECLARE v_gudang BIGINT UNSIGNED;
DECLARE v_minimum INT UNSIGNED;
SELECT id_gudang INTO v_gudang
FROM stock_opname
WHERE id_opname = NEW.id_opname;
SELECT stok_minimum INTO v_minimum
FROM current_stock
WHERE id_produk = NEW.id_produk
  AND id_gudang = v_gudang FOR
UPDATE;
IF v_minimum IS NULL THEN SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'Snapshot stok tidak ditemukan untuk opname';
END IF;
UPDATE current_stock
SET jumlah_stok = NEW.stok_fisik,
  status_stok = CASE
    WHEN NEW.stok_fisik <= 0 THEN 'Habis'
    WHEN NEW.stok_fisik <= v_minimum THEN 'Menipis'
    ELSE 'Aman'
  END,
  tanggal_update = CURRENT_TIMESTAMP
WHERE id_produk = NEW.id_produk
  AND id_gudang = v_gudang;
END $$ DELIMITER;
INSERT INTO kategori (id_kategori, nama_kategori, deskripsi)
VALUES (
    1,
    'Makanan',
    'Makanan kemasan dan kebutuhan dapur'
  ),
  (2, 'Minuman', 'Minuman siap konsumsi'),
  (
    3,
    'Kebutuhan Rumah',
    'Produk kebersihan dan kebutuhan rumah'
  ) ON DUPLICATE KEY
UPDATE nama_kategori =
VALUES(nama_kategori);
INSERT INTO supplier (
    id_supplier,
    nama_supplier,
    alamat,
    no_telepon,
    email,
    kontak_person
  )
VALUES (
    1,
    'PT Sumber Pangan Nusantara',
    'Jakarta',
    '021-5550101',
    'sales@sumberpangan.test',
    'Tim Penjualan'
  ),
  (
    2,
    'CV Segar Sejahtera',
    'Tangerang',
    '021-5550102',
    'order@segarsejahtera.test',
    'Tim Order'
  ) ON DUPLICATE KEY
UPDATE nama_supplier =
VALUES(nama_supplier);
INSERT INTO gudang (id_gudang, nama_gudang, lokasi, kapasitas)
VALUES (
    1,
    'Toko Utama',
    'Area penjualan minimarket',
    1000
  ),
  (
    2,
    'Gudang Belakang',
    'Ruang penyimpanan belakang',
    5000
  ) ON DUPLICATE KEY
UPDATE nama_gudang =
VALUES(nama_gudang);
INSERT INTO karyawan (
    id_karyawan,
    nama_karyawan,
    jabatan,
    no_telepon,
    shift_kerja
  )
VALUES (1, 'Kasir Demo', 'Kasir', '081200000001', 'Pagi'),
  (
    2,
    'Petugas Gudang',
    'Gudang',
    '081200000002',
    'Pagi'
  ),
  (
    3,
    'Staf Purchasing',
    'Purchasing',
    '081200000003',
    'Reguler'
  ) ON DUPLICATE KEY
UPDATE nama_karyawan =
VALUES(nama_karyawan);
INSERT INTO produk (
    id_produk,
    id_kategori,
    barcode,
    nama_produk,
    satuan,
    harga_beli,
    harga_jual,
    stok_minimum,
    aktif
  )
VALUES (
    1,
    1,
    '8991001000019',
    'Mi Instan Goreng',
    'pcs',
    2500,
    3500,
    10,
    TRUE
  ),
  (
    2,
    2,
    '8991001000026',
    'Air Mineral 600 ml',
    'botol',
    2200,
    3500,
    12,
    TRUE
  ),
  (
    3,
    3,
    '8991001000033',
    'Sabun Cuci Piring 400 ml',
    'botol',
    8500,
    12000,
    5,
    TRUE
  ),
  (
    4,
    1,
    '8991001000040',
    'Biskuit Cokelat',
    'pcs',
    6000,
    8500,
    8,
    TRUE
  ),
  (
    5,
    2,
    '8991001000057',
    'Susu UHT 1 Liter',
    'kotak',
    14500,
    18000,
    6,
    TRUE
  ) ON DUPLICATE KEY
UPDATE nama_produk =
VALUES(nama_produk);
INSERT INTO current_stock (
    id_produk,
    id_gudang,
    jumlah_stok,
    stok_minimum,
    status_stok
  )
SELECT stock_seed.id_produk,
  stock_seed.id_gudang,
  stock_seed.jumlah_stok,
  stock_seed.stok_minimum,
  CASE
    WHEN stock_seed.jumlah_stok <= 0 THEN 'Habis'
    WHEN stock_seed.jumlah_stok <= stock_seed.stok_minimum THEN 'Menipis'
    ELSE 'Aman'
  END
FROM (
    SELECT p.id_produk,
      g.id_gudang,
      p.stok_minimum,
      CASE
        WHEN g.id_gudang = 1
        AND p.id_produk = 1 THEN 50
        WHEN g.id_gudang = 1
        AND p.id_produk = 2 THEN 8
        WHEN g.id_gudang = 1
        AND p.id_produk = 3 THEN 0
        WHEN g.id_gudang = 1
        AND p.id_produk = 4 THEN 24
        WHEN g.id_gudang = 1
        AND p.id_produk = 5 THEN 15
        WHEN g.id_gudang = 2
        AND p.id_produk = 1 THEN 100
        WHEN g.id_gudang = 2
        AND p.id_produk = 2 THEN 30
        WHEN g.id_gudang = 2
        AND p.id_produk = 3 THEN 12
        WHEN g.id_gudang = 2
        AND p.id_produk = 4 THEN 40
        ELSE 20
      END AS jumlah_stok
    FROM produk p
      CROSS JOIN gudang g
  ) AS stock_seed ON DUPLICATE KEY
UPDATE jumlah_stok = VALUES(jumlah_stok),
  stok_minimum = VALUES(stok_minimum),
  status_stok = CASE
    WHEN current_stock.jumlah_stok <= 0 THEN 'Habis'
    WHEN current_stock.jumlah_stok <= VALUES(stok_minimum) THEN 'Menipis'
    ELSE 'Aman'
  END;
INSERT IGNORE INTO pembelian (id_pembelian, no_faktur, id_supplier, id_karyawan, tanggal_pembelian, total_harga, status_pembayaran)
VALUES
  (1, 'PO-20261005-001', 1, 3, '2026-10-05 09:00:00', 144000.00, 'Diterima'),
  (2, 'PO-20261008-002', 2, 3, '2026-10-08 11:30:00', 265000.00, 'Diterima'),
  (3, 'PO-20261012-003', 1, 3, '2026-10-12 14:15:00', 170000.00, 'Belum Lunas');
INSERT IGNORE INTO detail_pembelian (id_detail_beli, id_pembelian, id_produk, jumlah, harga_satuan, subtotal)
VALUES
  (1, 1, 1, 40, 2500.00, 100000.00),
  (2, 1, 2, 20, 2200.00, 44000.00),
  (3, 2, 4, 20, 6000.00, 120000.00),
  (4, 2, 5, 10, 14500.00, 145000.00),
  (5, 3, 3, 20, 8500.00, 170000.00);
INSERT IGNORE INTO penjualan (id_penjualan, no_transaksi, id_karyawan, id_gudang, tanggal_penjualan, total_bayar, metode_pembayaran)
VALUES
  (1, 'TRX-20261009-001', 1, 1, '2026-10-09 10:15:00', 10500.00, 'Tunai'),
  (2, 'TRX-20261010-002', 1, 1, '2026-10-10 13:45:00', 26500.00, 'QRIS'),
  (3, 'TRX-20261011-003', 1, 1, '2026-10-11 16:20:00', 17500.00, 'Debit'),
  (4, 'TRX-20261012-004', 1, 1, '2026-10-12 18:30:00', 20500.00, 'QRIS'),
  (5, 'TRX-20261013-005', 1, 1, '2026-10-13 19:10:00', 32000.00, 'Tunai');
INSERT IGNORE INTO detail_penjualan (id_detail_jual, id_penjualan, id_produk, jumlah, harga_satuan, subtotal)
VALUES
  (1, 1, 1, 2, 3500.00, 7000.00),
  (2, 1, 2, 1, 3500.00, 3500.00),
  (3, 2, 4, 1, 8500.00, 8500.00),
  (4, 2, 5, 1, 18000.00, 18000.00),
  (5, 3, 1, 3, 3500.00, 10500.00),
  (6, 3, 2, 2, 3500.00, 7000.00),
  (7, 4, 4, 2, 8500.00, 17000.00),
  (8, 4, 2, 1, 3500.00, 3500.00),
  (9, 5, 1, 4, 3500.00, 14000.00),
  (10, 5, 5, 1, 18000.00, 18000.00);
INSERT IGNORE INTO retur (id_retur, no_retur, id_pembelian, id_penjualan, id_karyawan, id_gudang, tanggal_retur, jenis_retur, total_nilai_retur, status_retur)
VALUES
  (1, 'RET-20261010-001', 1, NULL, 3, 1, '2026-10-10 15:00:00', 'Ke Supplier', 5000.00, 'Selesai'),
  (2, 'RET-20261011-002', NULL, 1, 1, 1, '2026-10-11 17:30:00', 'Dari Pelanggan', 3500.00, 'Selesai');
INSERT IGNORE INTO detail_retur (id_detail_retur, id_retur, id_produk, jumlah_retur, harga_satuan, subtotal, alasan)
VALUES
  (1, 1, 1, 2, 2500.00, 5000.00, 'Rusak'),
  (2, 2, 2, 1, 3500.00, 3500.00, 'Tidak Sesuai');
INSERT IGNORE INTO stock_opname (id_opname, no_opname, id_gudang, id_karyawan, tanggal_opname, status_opname, keterangan)
VALUES
  (1, 'OPN-20261007-001', 1, 2, '2026-10-07 08:00:00', 'Selesai', 'Audit rutin mingguan Toko Utama');
INSERT IGNORE INTO detail_stock_opname (id_detail_opname, id_opname, id_produk, stok_sistem, stok_fisik, selisih, jenis_penyesuaian, keterangan)
VALUES
  (1, 1, 1, 50, 50, 0, 'Tetap', 'Sesuai fisik rak');