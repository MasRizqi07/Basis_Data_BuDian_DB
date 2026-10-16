# Stockwise — Sistem Manajemen Stock Inventory Minimarket

Aplikasi lokal berbasis Express dan MySQL untuk monitoring persediaan, transaksi kasir, pembelian, serta audit stok fisik.

## Menjalankan di Windows

1. Jalankan MySQL 8.4 dan siapkan akun dengan izin membuat database, tabel, trigger, serta membaca/menulis data.
2. Salin `.env.example` menjadi `.env`, lalu atur `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME`.
3. Dari PowerShell di folder proyek:

   ```powershell
   npm install
   npm run migrate
   npm run dev
   ```

4. Buka `http://localhost:3000`.

Migrasi dapat dijalankan ulang: tabel dibuat bila belum ada, trigger aplikasi diganti dengan versi terkini, dan seed memakai upsert. Migrasi **tidak menghapus atau mengonversi otomatis** tabel lama yang kolomnya memakai skema versi sebelumnya; cadangkan data dan migrasikan struktur lama sebelum menggunakan versi ini. Proses memverifikasi hasilnya harus tepat 14 tabel dan dua trigger.

## Skema dan seed

`database/schema.sql` mendefinisikan 14 tabel CDM: `kategori`, `produk`, `supplier`, `karyawan`, `gudang`, `current_stock`, `pembelian`, `detail_pembelian`, `penjualan`, `detail_penjualan`, `retur`, `detail_retur`, `stock_opname`, dan `detail_stock_opname`. Semua primary key auto-increment dan foreign key menggunakan `BIGINT UNSIGNED`.

Seed mencakup tiga kategori, lima produk dengan barcode EAN-13 valid, dua supplier, dua gudang, tiga karyawan (Kasir, Gudang, Purchasing), dan snapshot stok untuk lima produk di kedua gudang. Stok awal Toko Utama memuat status Aman, Menipis, dan Habis sehingga dashboard dapat menunjukkan seluruh kondisi.

Trigger `trg_after_insert_detail_penjualan` mengurangi stok pada gudang transaksi setelah detail penjualan disimpan dan menolak kuantitas yang tidak tersedia. Trigger `trg_after_insert_detail_stock_opname` menyesuaikan snapshot dengan hitung fisik. Aplikasi juga mengunci serta memeriksa stok di dalam transaksi POS, sebagai lapisan Control sebelum trigger database.

## Monitoring dan Control

- **Monitoring:** dashboard membaca KPI dan ringkasan `current_stock` dari API, termasuk filter gudang dan pencarian produk.
- **Control POS:** stok yang tersedia terlihat per gudang, jumlah keranjang dibatasi di UI, lalu diverifikasi ulang dengan `SELECT ... FOR UPDATE` sebelum transaksi ACID. Jika tidak cukup, API membalas HTTP 400 `Stok tidak mencukupi`; header dan detail transaksi di-rollback.
- **Control opname:** hitung fisik dibandingkan dengan stok sistem, selisih dan jenis penyesuaian disimpan pada detail opname, kemudian trigger memperbarui snapshot dalam transaksi yang sama.
- **Pembelian:** faktur dan rincian pembelian dapat dicatat. CDM yang ditetapkan tidak memiliki gudang tujuan atau status penerimaan pembelian, jadi pencatatan pembelian tidak otomatis menambah stok.
- **Retur:** tabel retur supplier/pelanggan dan rinciannya sudah dibuat; endpoint dan UI retur belum termasuk lingkup operasional ini.

## API utama

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | Status server dan database |
| GET | `/api/stock` | Daftar snapshot stok, dapat difilter `?warehouseId=1` |
| GET | `/api/stock/summary` | Total produk, nilai stok, stok menipis dan habis |
| POST | `/api/pos/checkout` | Checkout POS dalam transaksi ACID |
| POST | `/api/opname` | Simpan audit dan sesuaikan stok fisik |
| GET/POST | `/api/purchases` | Riwayat dan pencatatan pembelian |
| GET/POST/PUT/DELETE | `/api/masters/products` | Daftar dan CRUD produk (DELETE menonaktifkan) |
| GET/POST/PUT/DELETE | `/api/masters/suppliers` | CRUD supplier |
| GET | `/api/masters/references` | Referensi kategori, gudang, dan karyawan |

## Uji

```powershell
npm test
```

Uji black-box yang memerlukan database:

```powershell
npm run migrate
npm run test:integration
```

Smoke test integrasi memverifikasi pembacaan monitoring serta kedua trigger Control di dalam transaksi yang di-rollback, sehingga tidak meninggalkan transaksi uji atau mengubah stok.

## Catatan

- Versi praktikum ini belum memiliki autentikasi; jangan mengeksposnya ke jaringan publik tanpa kontrol akses.
- Estimasi nilai persediaan dihitung dari jumlah snapshot dikali harga beli.
