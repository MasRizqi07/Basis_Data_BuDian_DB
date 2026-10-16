const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

async function listProducts(req, res) {
  const [rows] = await pool.execute(
    `SELECT p.id_produk, p.kode_barcode, p.nama_produk, p.satuan, p.harga_beli,
            p.harga_jual, p.stok_minimum, p.id_kategori, k.nama_kategori,
            p.id_supplier_utama, s.nama_supplier, p.aktif
       FROM produk p
       JOIN kategori k ON k.id_kategori = p.id_kategori
       LEFT JOIN supplier s ON s.id_supplier = p.id_supplier_utama
      ORDER BY p.nama_produk`
  );
  res.json({ data: rows });
}

async function createProduct(req, res) {
  const { barcode, name, categoryId, supplierId = null, unit = 'pcs', purchasePrice = 0, salePrice, minimumStock = 5 } = req.body;
  if (!String(barcode || '').trim() || !String(name || '').trim() || salePrice === undefined || salePrice === '' || categoryId === undefined) {
    throw httpError(400, 'Barcode, nama, kategori, dan harga jual wajib diisi.');
  }
  const category = requiredPositiveInteger(categoryId, 'ID kategori');
  const supplier = supplierId ? requiredPositiveInteger(supplierId, 'ID supplier') : null;
  const buy = Number(purchasePrice);
  const sell = Number(salePrice);
  const minimum = Number(minimumStock);
  if (!Number.isFinite(buy) || buy < 0 || !Number.isFinite(sell) || sell < 0 ||
      !Number.isSafeInteger(minimum) || minimum < 0) {
    throw httpError(400, 'Harga dan batas minimum stok tidak valid.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO produk
        (kode_barcode, nama_produk, id_kategori, id_supplier_utama, satuan,
         harga_beli, harga_jual, stok_minimum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(barcode).trim(), String(name).trim(), category, supplier, String(unit).trim(), buy, sell, minimum]
    );
    await connection.execute(
      `INSERT INTO current_stock (id_produk, id_gudang, jumlah_stok, status_stok)
       SELECT ?, id_gudang, 0, 'Habis' FROM gudang WHERE aktif = TRUE`,
      [result.insertId]
    );
    await connection.commit();
    res.status(201).json({ data: { id: result.insertId } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateProduct(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID produk');
  const { barcode, name, categoryId, supplierId = null, unit, purchasePrice, salePrice, minimumStock, active = true } = req.body;
  if (!String(barcode || '').trim() || !String(name || '').trim() || categoryId === undefined || salePrice === undefined || salePrice === '') {
    throw httpError(400, 'Barcode, nama, kategori, dan harga jual wajib diisi.');
  }
  const buy = Number(purchasePrice ?? 0);
  const sell = Number(salePrice);
  const minimum = Number(minimumStock ?? 5);
  if (!Number.isFinite(buy) || buy < 0 || !Number.isFinite(sell) || sell < 0 ||
      !Number.isSafeInteger(minimum) || minimum < 0) {
    throw httpError(400, 'Harga dan batas minimum stok tidak valid.');
  }
  const [result] = await pool.execute(
    `UPDATE produk SET kode_barcode = ?, nama_produk = ?, id_kategori = ?,
      id_supplier_utama = ?, satuan = ?, harga_beli = ?, harga_jual = ?,
      stok_minimum = ?, aktif = ?
      WHERE id_produk = ?`,
    [
      String(barcode).trim(), String(name).trim(),
      requiredPositiveInteger(categoryId, 'ID kategori'),
      supplierId ? requiredPositiveInteger(supplierId, 'ID supplier') : null,
      String(unit || 'pcs').trim(), buy, sell,
      minimum, active === true, id
    ]
  );
  if (!result.affectedRows) throw httpError(404, 'Produk tidak ditemukan.');
  res.json({ data: { id } });
}

async function deleteProduct(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID produk');
  const [result] = await pool.execute('UPDATE produk SET aktif = FALSE WHERE id_produk = ?', [id]);
  if (!result.affectedRows) throw httpError(404, 'Produk tidak ditemukan.');
  res.status(204).end();
}

async function listSuppliers(req, res) {
  const [rows] = await pool.execute(
    `SELECT id_supplier, nama_supplier, kontak, email, alamat
       FROM supplier ORDER BY nama_supplier`
  );
  res.json({ data: rows });
}

async function createSupplier(req, res) {
  const { name, contact = null, email = null, address = null } = req.body;
  if (!name || !String(name).trim()) throw httpError(400, 'Nama supplier wajib diisi.');
  const [result] = await pool.execute(
    'INSERT INTO supplier (nama_supplier, kontak, email, alamat) VALUES (?, ?, ?, ?)',
    [String(name).trim(), contact, email, address]
  );
  res.status(201).json({ data: { id: result.insertId } });
}

async function updateSupplier(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID supplier');
  const { name, contact = null, email = null, address = null } = req.body;
  if (!name || !String(name).trim()) throw httpError(400, 'Nama supplier wajib diisi.');
  const [result] = await pool.execute(
    `UPDATE supplier SET nama_supplier = ?, kontak = ?, email = ?, alamat = ?
      WHERE id_supplier = ?`,
    [String(name).trim(), contact, email, address, id]
  );
  if (!result.affectedRows) throw httpError(404, 'Supplier tidak ditemukan.');
  res.json({ data: { id } });
}

async function deleteSupplier(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID supplier');
  const [result] = await pool.execute('DELETE FROM supplier WHERE id_supplier = ?', [id]);
  if (!result.affectedRows) throw httpError(404, 'Supplier tidak ditemukan.');
  res.status(204).end();
}

async function getReferenceData(req, res) {
  const [categories] = await pool.execute('SELECT id_kategori AS id, nama_kategori AS name FROM kategori ORDER BY nama_kategori');
  const [warehouses] = await pool.execute('SELECT id_gudang AS id, nama_gudang AS name FROM gudang WHERE aktif = TRUE ORDER BY nama_gudang');
  const [employees] = await pool.execute('SELECT id_karyawan AS id, nama_karyawan AS name, jabatan FROM karyawan WHERE aktif = TRUE ORDER BY nama_karyawan');
  res.json({ data: { categories, warehouses, employees } });
}

module.exports = {
  createProduct, createSupplier, deleteProduct, deleteSupplier,
  getReferenceData, listProducts, listSuppliers, updateProduct, updateSupplier
};
