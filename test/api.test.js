const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const app = require('../server');
const pool = require('../config/database');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /api/health returns 200 and status ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, { status: 'ok' });
});

test('GET /api/stock returns list of current stock items with warehouse details', async () => {
  const res = await fetch(`${baseUrl}/api/stock`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
  assert.ok('id_stock' in data[0]);
  assert.ok('nama_produk' in data[0]);
  assert.ok('nama_gudang' in data[0]);
  assert.ok('jumlah_stok' in data[0]);
  assert.ok('status_stok' in data[0]);
});

test('GET /api/stock/summary returns KPI metrics', async () => {
  const res = await fetch(`${baseUrl}/api/stock/summary`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Number(data.total_produk) > 0);
  assert.ok(Number(data.total_nilai_stok) >= 0);
  assert.ok('item_menipis' in data);
  assert.ok('item_habis' in data);
});

test('GET /api/masters/references returns categories, warehouses, and employees', async () => {
  const res = await fetch(`${baseUrl}/api/masters/references`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data.categories) && data.categories.length > 0);
  assert.ok(Array.isArray(data.warehouses) && data.warehouses.length > 0);
  assert.ok(Array.isArray(data.employees) && data.employees.length > 0);
});

test('GET /api/masters/products returns product catalog', async () => {
  const res = await fetch(`${baseUrl}/api/masters/products`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data) && data.length > 0);
  assert.ok(data.every((p) => p.kode_barcode && p.nama_produk));
});

test('GET /api/masters/suppliers returns registered suppliers', async () => {
  const res = await fetch(`${baseUrl}/api/masters/suppliers`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data) && data.length > 0);
  assert.ok(data.every((s) => s.nama_supplier));
});

test('GET /api/purchases returns purchase invoice list', async () => {
  const res = await fetch(`${baseUrl}/api/purchases`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data));
});

test('GET /api/purchases/:id returns detail invoice with items', async () => {
  const res = await fetch(`${baseUrl}/api/purchases/1`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.id_pembelian, 1);
  assert.ok(data.no_faktur);
  assert.ok(data.nama_supplier);
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);
  assert.ok('subtotal' in data.items[0]);
});

test('GET /api/purchases/999999 returns 404 for unknown purchase', async () => {
  const res = await fetch(`${baseUrl}/api/purchases/999999`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /tidak ditemukan/);
});

test('GET /api/returns and /api/returns/references return valid data', async () => {
  const resRet = await fetch(`${baseUrl}/api/returns`);
  assert.equal(resRet.status, 200);
  const { data: returns } = await resRet.json();
  assert.ok(Array.isArray(returns));

  const resRef = await fetch(`${baseUrl}/api/returns/references`);
  assert.equal(resRef.status, 200);
  const { data: refs } = await resRef.json();
  assert.ok(Array.isArray(refs.purchases));
  assert.ok(Array.isArray(refs.sales));
});

test('GET /api/returns/:id returns detail return invoice with items', async () => {
  const res = await fetch(`${baseUrl}/api/returns/1`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.id_retur, 1);
  assert.ok(data.no_retur);
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);
  assert.ok('alasan' in data.items[0]);
});

test('GET /api/returns/999999 returns 404 for unknown return', async () => {
  const res = await fetch(`${baseUrl}/api/returns/999999`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /tidak ditemukan/);
});

test('GET /api/pos/:id returns detail POS sale receipt with items', async () => {
  const res = await fetch(`${baseUrl}/api/pos/1`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.id_penjualan, 1);
  assert.ok(data.no_transaksi);
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);
  assert.ok('subtotal' in data.items[0]);
});

test('GET /api/pos/999999 returns 404 for unknown transaction', async () => {
  const res = await fetch(`${baseUrl}/api/pos/999999`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /tidak ditemukan/);
});

test('GET /api/reports/sales returns sales analytics and supports period filter', async () => {
  const resAll = await fetch(`${baseUrl}/api/reports/sales`);
  assert.equal(resAll.status, 200);
  const { data: dataAll } = await resAll.json();
  assert.equal(dataAll.period, 'all');
  assert.ok('summary' in dataAll);
  assert.ok('paymentBreakdown' in dataAll);
  assert.ok('dailySales' in dataAll);
  assert.ok('fastMoving' in dataAll);

  const res7d = await fetch(`${baseUrl}/api/reports/sales?period=7d`);
  assert.equal(res7d.status, 200);
  const { data: data7d } = await res7d.json();
  assert.equal(data7d.period, '7d');
  assert.ok('summary' in data7d);

  const res30d = await fetch(`${baseUrl}/api/reports/sales?period=30d`);
  assert.equal(res30d.status, 200);
  const { data: data30d } = await res30d.json();
  assert.equal(data30d.period, '30d');
});

test('GET /api/reports/stock-movement returns stock audit matrix', async () => {
  const res = await fetch(`${baseUrl}/api/reports/stock-movement`);
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(Array.isArray(data) && data.length > 0);
  assert.ok('total_masuk_pengadaan' in data[0]);
  assert.ok('total_keluar_penjualan' in data[0]);
});

test('GET /api/nonexistent returns 404 error JSON', async () => {
  const res = await fetch(`${baseUrl}/api/nonexistent-route-xyz`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'Endpoint API tidak ditemukan.');
});

test('POST /api/pos/checkout validates required payload and rejects empty items', async () => {
  const res = await fetch(`${baseUrl}/api/pos/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test('POST /api/opname validates required payload and rejects empty items', async () => {
  const res = await fetch(`${baseUrl}/api/opname`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test('POST /api/returns rejects invalid return type', async () => {
  const res = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnType: 'InvalidType' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Jenis retur harus/);
});

test('POST /api/masters/products rejects invalid EAN-13 barcode', async () => {
  const res = await fetch(`${baseUrl}/api/masters/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode: '12345', name: 'Produk Uji' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /EAN-13/);
});
