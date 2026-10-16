require('dotenv').config();

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const pool = require('./config/database');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});
app.use('/api/stock', require('./routes/stockRoutes'));
app.use('/api/pos', require('./routes/posRoutes'));
app.use('/api/opname', require('./routes/opnameRoutes'));
app.use('/api/masters', require('./routes/masterRoutes'));
app.use('/api/purchases', require('./routes/purchaseRoutes'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  const knownConstraintErrors = ['ER_DUP_ENTRY', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2'];
  const databaseMessages = {
    ER_ACCESS_DENIED_ERROR: 'Kredensial MySQL ditolak. Periksa DB_USER dan DB_PASSWORD di file .env.',
    ER_BAD_DB_ERROR: 'Database belum tersedia. Jalankan npm run migrate setelah mengatur akses MySQL.',
    ECONNREFUSED: 'MySQL tidak dapat dijangkau. Pastikan service MySQL aktif dan DB_HOST/DB_PORT benar.',
    ETIMEDOUT: 'Koneksi ke MySQL melewati batas waktu. Periksa service dan konfigurasi jaringan.'
  };
  const isDatabaseError = Boolean(databaseMessages[error.code]);
  const status = error.status || (isDatabaseError ? 503 : knownConstraintErrors.includes(error.code) ? 409 : 500);
  const message = error.status
    ? error.message
    : isDatabaseError
      ? databaseMessages[error.code]
    : knownConstraintErrors.includes(error.code)
      ? 'Data bertentangan dengan constraint atau relasi yang sudah ada.'
      : 'Terjadi kesalahan pada server.';
  res.status(status).json({ error: message });
});

const server = app.listen(port, () => {
  console.log(`Inventory Minimarket berjalan di http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
