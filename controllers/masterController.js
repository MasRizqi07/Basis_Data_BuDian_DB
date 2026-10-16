const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function isValidEan13(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const checkDigit = [...value.slice(0, 12)].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return (10 - (checkDigit % 10)) % 10 === Number(value[12]);
}

function validateProduct(body) {
  const barcode = String(body.barcode || '').trim();
  const name = String(body.name || '').trim();
  if (!isValidEan13(barcode)) throw httpError(400, 'Barcode harus berupa EAN-13 yang valid.');
  if (!name) throw httpError(400, 'Nama produk wajib diisi.');
  const categoryId = requiredPositiveInteger(body.categoryId, 'ID kategori');
  const purchasePrice = Number(body.purchasePrice ?? 0);
  const salePrice = Number(body.salePrice);
  const minimumStock = Number(body.minimumStock ?? 5);
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0 ||
      !Number.isFinite(salePrice) || salePrice < 0 ||
      !Number.isSafeInteger(minimumStock) || minimumStock < 0) {
    throw httpError(400, 'Harga dan batas minimum stok tidak valid.');
  }
  return {
    barcode,
    name,
    categoryId,
    unit: String(body.unit || 'pcs').trim(),
    purchasePrice,
    salePrice,
    minimumStock
  };
}

async function listProducts(req, res) {
  const [rows] = await pool.execute(
    `SELECT p.id_produk, p.barcode AS kode_barcode, p.nama_produk, p.satuan,
            p.harga_beli, p.harga_jual, p.stok_minimum, p.id_kategori,
            k.nama_kategori, p.aktif
       FROM produk p
       JOIN kategori k ON k.id_kategori = p.id_kategori
      ORDER BY p.nama_produk`
  );
  res.json({ data: rows });
}

async function createProduct(req, res) {
  const product = validateProduct(req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO produk
        (id_kategori, barcode, nama_produk, satuan, harga_beli, harga_jual, stok_minimum)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        product.categoryId, product.barcode, product.name, product.unit,
        product.purchasePrice, product.salePrice, product.minimumStock
      ]
    );
    await connection.execute(
      `INSERT INTO current_stock
        (id_produk, id_gudang, jumlah_stok, stok_minimum, status_stok)
       SELECT ?, id_gudang, 0, ?, 'Habis' FROM gudang`,
      [result.insertId, product.minimumStock]
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
  const product = validateProduct(req.body);
  const active = req.body.active !== false;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE produk
          SET id_kategori = ?, barcode = ?, nama_produk = ?, satuan = ?,
              harga_beli = ?, harga_jual = ?, stok_minimum = ?, aktif = ?
        WHERE id_produk = ?`,
      [
        product.categoryId, product.barcode, product.name, product.unit,
        product.purchasePrice, product.salePrice, product.minimumStock, active, id
      ]
    );
    if (!result.affectedRows) throw httpError(404, 'Produk tidak ditemukan.');
    await connection.execute(
      `UPDATE current_stock
          SET stok_minimum = ?,
              status_stok = CASE
                WHEN jumlah_stok <= 0 THEN 'Habis'
                WHEN jumlah_stok <= ? THEN 'Menipis'
                ELSE 'Aman'
              END
        WHERE id_produk = ?`,
      [product.minimumStock, product.minimumStock, id]
    );
    await connection.commit();
    res.json({ data: { id } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteProduct(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID produk');
  const [result] = await pool.execute('UPDATE produk SET aktif = FALSE WHERE id_produk = ?', [id]);
  if (!result.affectedRows) throw httpError(404, 'Produk tidak ditemukan.');
  res.status(204).end();
}

async function listSuppliers(_req, res) {
  const [rows] = await pool.execute(
    `SELECT id_supplier, nama_supplier, alamat, no_telepon, email, kontak_person
       FROM supplier
      ORDER BY nama_supplier`
  );
  res.json({ data: rows });
}

async function createSupplier(req, res) {
  const { name, address = null, phone = null, email = null, contactPerson = null } = req.body;
  if (!String(name || '').trim()) throw httpError(400, 'Nama supplier wajib diisi.');
  const [result] = await pool.execute(
    `INSERT INTO supplier (nama_supplier, alamat, no_telepon, email, kontak_person)
     VALUES (?, ?, ?, ?, ?)`,
    [String(name).trim(), address, phone, email, contactPerson]
  );
  res.status(201).json({ data: { id: result.insertId } });
}

async function updateSupplier(req, res) {
  const id = requiredPositiveInteger(req.params.id, 'ID supplier');
  const { name, address = null, phone = null, email = null, contactPerson = null } = req.body;
  if (!String(name || '').trim()) throw httpError(400, 'Nama supplier wajib diisi.');
  const [result] = await pool.execute(
    `UPDATE supplier
        SET nama_supplier = ?, alamat = ?, no_telepon = ?, email = ?, kontak_person = ?
      WHERE id_supplier = ?`,
    [String(name).trim(), address, phone, email, contactPerson, id]
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

async function getReferenceData(_req, res) {
  const [categories] = await pool.execute(
    'SELECT id_kategori AS id, nama_kategori AS name FROM kategori ORDER BY nama_kategori'
  );
  const [warehouses] = await pool.execute(
    'SELECT id_gudang AS id, nama_gudang AS name FROM gudang ORDER BY nama_gudang'
  );
  const [employees] = await pool.execute(
    'SELECT id_karyawan AS id, nama_karyawan AS name, jabatan FROM karyawan ORDER BY nama_karyawan'
  );
  res.json({ data: { categories, warehouses, employees } });
}

module.exports = {
  createProduct,
  createSupplier,
  deleteProduct,
  deleteSupplier,
  getReferenceData,
  isValidEan13,
  listProducts,
  listSuppliers,
  updateProduct,
  updateSupplier
};
