# Stockwise — Manajemen Stock Inventory Minimarket

Aplikasi full-stack lokal untuk operasi stok minimarket: monitoring stok, POS, PO dan penerimaan barang, stock opname, serta pengelolaan produk dan supplier.

## Teknologi

- Node.js 20 atau lebih baru, Express, mysql2/promise
- MySQL 8.4
- HTML, CSS, dan JavaScript responsif dengan Lucide Icons

## Menjalankan di Windows

1. Pastikan MySQL Server 8.4 aktif dan buat user yang memiliki izin `CREATE DATABASE`, `CREATE`, `ALTER`, `TRIGGER`, `INSERT`, `UPDATE`, `DELETE`, dan `SELECT`.
2. Salin `.env.example` menjadi `.env`, lalu sesuaikan `DB_HOST`, `DB_PORT`, `DB_USER`, dan `DB_PASSWORD`. Database akan dibuat otomatis sebagai `db_inventory_minimarket`.
3. Di PowerShell, dari folder proyek jalankan:

   ```powershell
   npm install
   npm run migrate
   npm run dev
   ```

4. Buka `http://localhost:3000`.

Seeder membuat data contoh supplier, kategori, gudang, karyawan, produk, dan stok awal. Semua pernyataan seeding memakai `INSERT IGNORE` sehingga migrasi ulang tidak menambahkan duplikat untuk ID contoh.

## Alur operasi yang didukung

1. Buat PO dengan status `Draft`, supplier, gudang tujuan, petugas, dan daftar item.
2. Pilih **Terima barang** pada PO draft. Penerimaan dan perubahan status dilakukan dalam satu transaksi database; saldo `current_stock` bertambah hanya sekali.
3. Checkout POS menggunakan harga jual tersimpan. Detail penjualan ditulis dalam transaksi ACID dan trigger database menolak transaksi bila snapshot stok tidak cukup.
4. Simpan hitung fisik opname. Nilai sistem dikunci dan disimpan sebagai pembanding, sementara trigger menerapkan nilai fisik ke snapshot stok.
5. Produk dapat diedit atau dinonaktifkan; supplier dapat ditambah, diedit, dan dihapus bila tidak direferensikan transaksi.

## Tabel database

Schema membuat 14 tabel: `supplier`, `kategori`, `produk`, `gudang`, `karyawan`, `current_stock`, `pembelian`, `detail_pembelian`, `penjualan`, `detail_penjualan`, `retur`, `detail_retur`, `stock_opname`, dan `detail_stock_opname`.

Foreign key, indeks unik, pemeriksaan kuantitas/harga, dua trigger stok, serta seed contoh didefinisikan di `database/schema.sql`. Migrasi dapat dijalankan ulang untuk menyegarkan trigger dan seed tidak menduplikasi data contoh. DDL memakai `CREATE TABLE IF NOT EXISTS`, jadi perubahan definisi tabel di versi berikutnya perlu migration `ALTER TABLE` tersendiri.

## API

| Method | Endpoint | Kegunaan |
|---|---|---|
| GET | `/api/health` | Cek server dan koneksi database |
| GET | `/api/stock?warehouseId=1` | Daftar snapshot stok, opsional filter gudang |
| GET | `/api/stock/summary` | KPI produk, nilai stok, stok menipis/habis |
| GET/POST/PUT/DELETE | `/api/masters/products` | Kelola master produk |
| GET/POST/PUT/DELETE | `/api/masters/suppliers` | Kelola master supplier |
| GET | `/api/masters/references` | Data kategori, gudang, dan karyawan |
| POST | `/api/pos/checkout` | Checkout transaksi kasir |
| GET/POST | `/api/purchases` | Riwayat dan pembuatan PO |
| POST | `/api/purchases/:id/receive` | Terima PO draft dan tambah snapshot stok |
| POST | `/api/opname` | Simpan audit stok fisik |

## Catatan operasional

- Tidak ada autentikasi pada versi praktikum lokal ini. Jangan mengekspos server ke jaringan publik tanpa menambahkan autentikasi dan kontrol akses.
- `retur` dan `detail_retur` tersedia dalam skema, tetapi alur retur belum disediakan pada UI/API.
- Harga dan nilai stok memakai Rupiah tanpa pecahan di tampilan. Penyimpanan database tetap menggunakan `DECIMAL(14,2)`.
