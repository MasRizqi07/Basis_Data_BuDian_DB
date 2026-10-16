const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeReference(prefix) {
  const date = new Date();
  const stamp = date.toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}

async function checkout(req, res) {
  const warehouseId = requiredPositiveInteger(req.body.warehouseId, 'ID gudang');
  const employeeId = requiredPositiveInteger(req.body.employeeId, 'ID karyawan');
  const { paymentMethod, items } = req.body;
  if (!['Tunai', 'Debit', 'QRIS'].includes(paymentMethod)) {
    throw httpError(400, 'Metode pembayaran tidak valid.');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, 'Transaksi harus memiliki minimal satu produk.');
  }

  const itemMap = new Map();
  for (const item of items) {
    const productId = requiredPositiveInteger(item.productId, 'ID produk');
    const quantity = requiredPositiveInteger(item.quantity, 'Jumlah beli');
    itemMap.set(productId, (itemMap.get(productId) || 0) + quantity);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [employees] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? AND aktif = TRUE FOR UPDATE',
      [employeeId]
    );
    if (!employees.length) throw httpError(400, 'Karyawan tidak ditemukan atau tidak aktif.');

    const productIds = [...itemMap.keys()];
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id_produk, harga_jual FROM produk
        WHERE aktif = TRUE AND id_produk IN (${placeholders}) FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length) {
      throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    }

    const productsById = new Map(products.map((product) => [product.id_produk, product]));
    const lines = productIds.map((productId) => {
      const product = productsById.get(productId);
      const quantity = itemMap.get(productId);
      const unitPrice = Number(product.harga_jual);
      return { productId, quantity, unitPrice, subtotal: unitPrice * quantity };
    });
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const receiptNumber = makeReference('TRX');

    const [sale] = await connection.execute(
      `INSERT INTO penjualan
        (nomor_struk, id_gudang, id_karyawan, metode_pembayaran, total_penjualan)
       VALUES (?, ?, ?, ?, ?)`,
      [receiptNumber, warehouseId, employeeId, paymentMethod, total]
    );

    for (const line of lines) {
      await connection.execute(
        `INSERT INTO detail_penjualan
          (id_penjualan, id_produk, jumlah_jual, harga_jual_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [sale.insertId, line.productId, line.quantity, line.unitPrice, line.subtotal]
      );
    }

    await connection.commit();
    res.status(201).json({
      data: {
        id: sale.insertId,
        receiptNumber,
        paymentMethod,
        total,
        items: lines
      }
    });
  } catch (error) {
    await connection.rollback();
    if (error.sqlState === '45000') throw httpError(409, error.message);
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { checkout };
