# Stockwise — Sistem Manajemen Stock Inventory Minimarket

Aplikasi Full-Stack berbasis Node.js (Express.js) dan MySQL 8.4 (14 Tabel 3NF) untuk monitoring persediaan real-time, transaksi kasir (POS), pengadaan barang & konfirmasi penerimaan (Goods Receipt), manajemen retur (supplier & pelanggan), audit fisik (Stock Opname), serta analitik laporan bisnis.

---

## 1. Menjalankan di Windows

1. Jalankan MySQL 8.4 dan siapkan akun dengan izin membuat database, tabel, trigger, serta membaca/menulis data.
2. Salin `.env.example` menjadi `.env`, lalu atur `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME`.
3. Dari PowerShell di folder proyek:

   ```powershell
   npm install
   npm run migrate
   npm run dev
   ```

4. Buka peramban di `http://localhost:3000`.

---

## 2. Skema Basis Data (14 Tabel 3NF) & Triggers

File `database/schema.sql` mendefinisikan 14 tabel CDM:
- **Master (5):** `kategori`, `produk`, `supplier`, `karyawan`, `gudang`
- **Snapshot (1):** `current_stock` (Status: `'Aman'`, `'Menipis'`, `'Habis'`)
- **Transaksi (8):** `pembelian`, `detail_pembelian`, `penjualan`, `detail_penjualan`, `retur`, `detail_retur`, `stock_opname`, `detail_stock_opname`

Semua primary key auto-increment dan foreign key menggunakan `BIGINT UNSIGNED`.

### Database Triggers Aktif:
1. `trg_after_insert_detail_penjualan`: Memotong saldo `current_stock` etalase toko secara otomatis setelah item kasir tersimpan dan menolak penjualan jika stok tidak mencukupi (SQLSTATE 45000).
2. `trg_after_insert_detail_stock_opname`: Menyelaraskan saldo sistem pada `current_stock` agar sama persis dengan angka fisik nyata hasil audit.

---

## 3. Fitur Utama Sistem (Monitoring vs Control)

- **Monitoring:**
  * Dashboard KPI real-time (Total Produk, Nilai HPP, Item Menipis, Item Habis).
  * Tabel ringkasan persediaan dengan filter per gudang dan pencarian barcode/nama.
  * Laporan & Analitik omzet penjualan, produk fast-moving (terlaris), dan kartu mutasi stok komprehensif.
  * Ekspor ringkasan penjualan dan mutasi stok ke file CSV atau cetak langsung.
- **Control:**
  * **Kasir / POS:** Pembatasan kuantitas beli di UI, validasi transaksi ACID dengan locking `SELECT ... FOR UPDATE`, dan auto-deduct via trigger.
  * **Pengadaan & Goods Receipt:** Pembuatan PO supplier dan tombol konfirmasi penerimaan barang (`POST /api/purchases/:id/receive`) yang otomatis menambah saldo `current_stock`.
  * **Retur Barang:** Transaksi retur ke supplier (memotong stok barang rusak) dan retur dari pelanggan (mengembalikan stok layak jual).
  * **Stock Opname:** Perhitungan fisik independen per gudang, kalkulasi selisih (+/-), dan rekonsiliasi saldo seketika via database trigger.

---

## 4. Rincian API Endpoint

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | Status server dan konektivitas basis data |
| GET | `/api/stock` | Daftar snapshot stok (dukungan filter `?warehouseId=1`) |
| GET | `/api/stock/summary` | KPI total produk, nilai HPP, stok menipis dan habis |
| POST | `/api/pos/checkout` | Transaksi kasir POS berprinsip ACID (auto trigger potong stok) |
| GET | `/api/purchases` | Riwayat PO pengadaan dan status faktur |
| POST | `/api/purchases` | Pembuatan draf PO pembelian ke supplier |
| POST | `/api/purchases/:id/receive` | Konfirmasi penerimaan barang pengadaan (tambah stok) |
| GET | `/api/returns` | Riwayat retur supplier dan pelanggan |
| GET | `/api/returns/references` | Daftar referensi PO dan struk kasir untuk form retur |
| POST | `/api/returns` | Transaksi pencatatan retur dan mutasi stok terkait |
| POST | `/api/opname` | Simpan audit fisik opname (auto trigger sinkronisasi stok) |
| GET | `/api/reports/sales` | Rekapitulasi omzet penjualan, metode bayar, dan produk terlaris |
| GET | `/api/reports/stock-movement` | Kartu mutasi stok lengkap (masuk/keluar/opname/saldo akhir) |
| GET/POST/PUT/DELETE | `/api/masters/products` | CRUD master produk (DELETE menonaktifkan katalog) |
| GET/POST/PUT/DELETE | `/api/masters/suppliers` | CRUD master supplier pemasok barang |
| GET | `/api/masters/references` | Data referensi kategori, gudang, dan karyawan |

---

## 5. Rangkaian Pengujian (Testing Suite)

Jalankan unit test parser SQL dan barcode EAN-13:
```powershell
npm test
```

Jalankan 10 skenario Black Box Integration Testing (Monitoring vs Control):
```powershell
npm run test:integration
```

Hasil eksekusi:
```
=== MENJALANKAN 10 SKENARIO BLACK BOX TESTING (MONITORING VS CONTROL) ===

PASS [TC-01] Monitoring KPI membaca produk dan saldo snapshot stok
PASS [TC-02] Control POS checkout otomatis memotong saldo current_stock via trigger
PASS [TC-03] Control validasi checkout menolak penjualan jika stok tidak mencukupi
PASS [TC-04] Control Stock Opname audit fisik menyinkronkan saldo via trigger
PASS [TC-05] Monitoring kalkulasi ambang batas stok minimum (Status Menipis)
PASS [TC-06] Control pembuatan Purchase Order (PO) pengadaan ke supplier
PASS [TC-07] Control konfirmasi penerimaan barang (Goods Receipt) menambah saldo stok
PASS [TC-08] Control transaksi retur ke supplier memotong saldo stok barang rusak
PASS [TC-09] Control retur pengembalian pelanggan menambah kembali saldo persediaan
PASS [TC-10] Monitoring laporan analitik omzet dan kartu mutasi persediaan komprehensif

=== SELURUH 10 TEST CASE BLACK BOX LOLOS DENGAN STATUS: PASS ===
```

---

## 6. Berkas Akademik Bu Dian

- **`database/minimarket.dbml`**: Definisi skema DBML 14 tabel 3NF, enum, dan kardinalitas relasi yang siap di-copy-paste langsung ke [dbdiagram.io](https://dbdiagram.io).
- **`LAPORAN_TUGAS_BU_DIAN.md`**: Dokumen laporan lengkap memuat 10 Narasi Proses Bisnis, BPFD Swimlane, Diagram Berjenjang, DFD Level 0, 1, 2, Kamus Data 14 Tabel, serta Matriks Pengujian Black Box.
