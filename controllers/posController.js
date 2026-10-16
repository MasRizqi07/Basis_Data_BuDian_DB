const { randomBytes } = require('node:crypto');
const pool = require('../config/database');
const { httpError, requiredPositiveInteger } = require('../utils/http');

function makeTransactionNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `TRX-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
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

  const quantities = new Map();
  for (const item of items) {
    const productId = requiredPositiveInteger(item.productId, 'ID produk');
    const quantity = requiredPositiveInteger(item.quantity, 'Jumlah beli');
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [cashiers] = await connection.execute(
      'SELECT id_karyawan FROM karyawan WHERE id_karyawan = ? AND jabatan = ? FOR UPDATE',
      [employeeId, 'Kasir']
    );
    if (!cashiers.length) throw httpError(400, 'Karyawan kasir tidak ditemukan.');

    const [warehouses] = await connection.execute(
      'SELECT id_gudang FROM gudang WHERE id_gudang = ? FOR UPDATE',
      [warehouseId]
    );
    if (!warehouses.length) throw httpError(400, 'Gudang tidak ditemukan.');

    const productIds = [...quantities.keys()].sort((a, b) => a - b);
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id_produk, nama_produk, harga_jual
         FROM produk
        WHERE aktif = TRUE AND id_produk IN (${placeholders})
        ORDER BY id_produk
        FOR UPDATE`,
      productIds
    );
    if (products.length !== productIds.length) {
      throw httpError(400, 'Satu atau lebih produk tidak ditemukan atau tidak aktif.');
    }

    const [stocks] = await connection.execute(
      `SELECT id_produk, jumlah_stok
         FROM current_stock
        WHERE id_gudang = ? AND id_produk IN (${placeholders})
        ORDER BY id_produk
        FOR UPDATE`,
      [warehouseId, ...productIds]
    );
    const stockByProduct = new Map(stocks.map((stock) => [stock.id_produk, stock.jumlah_stok]));
    if (productIds.some((productId) => (stockByProduct.get(productId) ?? -1) < quantities.get(productId))) {
      throw httpError(400, 'Stok tidak mencukupi');
    }

    const productById = new Map(products.map((product) => [product.id_produk, product]));
    const lines = productIds.map((productId) => {
      const product = productById.get(productId);
      const quantity = quantities.get(productId);
      const unitPrice = Number(product.harga_jual);
      return {
        productId,
        name: product.nama_produk,
        quantity,
        unitPrice,
        subtotal: unitPrice * quantity
      };
    });
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const transactionNumber = makeTransactionNumber();

    const [sale] = await connection.execute(
      `INSERT INTO penjualan
        (no_transaksi, id_karyawan, id_gudang, total_bayar, metode_pembayaran)
       VALUES (?, ?, ?, ?, ?)`,
      [transactionNumber, employeeId, warehouseId, total, paymentMethod]
    );

    for (const line of lines) {
      await connection.execute(
        `INSERT INTO detail_penjualan
          (id_penjualan, id_produk, jumlah, harga_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [sale.insertId, line.productId, line.quantity, line.unitPrice, line.subtotal]
      );
    }

    await connection.commit();
    res.status(201).json({
      data: {
        id: sale.insertId,
        receiptNumber: transactionNumber,
        paymentMethod,
        total,
        items: lines
      }
    });
  } catch (error) {
    await connection.rollback();
    if (error.sqlState === '45000' && error.message === 'Stok tidak mencukupi') {
      throw httpError(400, 'Stok tidak mencukupi');
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { checkout };
