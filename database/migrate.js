require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

function splitSqlStatements(source) {
  const statements = [];
  let current = '';
  let delimiter = ';';
  let quote = null;
  let blockComment = false;
  let lineComment = false;

  const flush = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = '';
  };

  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const delimiterMatch = !quote && !blockComment && !lineComment &&
      trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      delimiter = delimiterMatch[1];
      continue;
    }

    for (let index = 0; index < line.length;) {
      const char = line[index];
      const next = line[index + 1];

      if (lineComment) {
        current += char;
        index += 1;
        continue;
      }

      if (blockComment) {
        current += char;
        if (char === '*' && next === '/') {
          current += next;
          index += 2;
          blockComment = false;
        } else {
          index += 1;
        }
        continue;
      }

      if (quote) {
        current += char;
        if (char === '\\' && index + 1 < line.length) {
          current += line[index + 1];
          index += 2;
          continue;
        }
        if (char === quote) {
          if (next === quote) {
            current += next;
            index += 2;
            continue;
          }
          quote = null;
        }
        index += 1;
        continue;
      }

      if (char === '#' || (char === '-' && next === '-' && /\s/.test(line[index + 2] || ' '))) {
        current += line.slice(index);
        lineComment = true;
        break;
      }
      if (char === '/' && next === '*') {
        current += '/*';
        blockComment = true;
        index += 2;
        continue;
      }
      if (char === '\'' || char === '"' || char === '`') {
        quote = char;
        current += char;
        index += 1;
        continue;
      }
      if (line.startsWith(delimiter, index)) {
        flush();
        index += delimiter.length;
        continue;
      }
      current += char;
      index += 1;
    }
    current += '\n';
    lineComment = false;
  }

  if (quote) throw new Error('SQL tidak valid: literal string/identifier belum ditutup.');
  if (blockComment) throw new Error('SQL tidak valid: komentar blok belum ditutup.');
  flush();
  return statements;
}

async function migrate() {
  const databaseName = process.env.DB_NAME || 'db_inventory_minimarket';
  if (!/^[A-Za-z0-9_]{1,64}$/.test(databaseName)) {
    throw new Error('DB_NAME hanya boleh berisi huruf, angka, dan underscore (maksimal 64 karakter).');
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: false
  });

  try {
    const source = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    const schema = source.replaceAll('db_inventory_minimarket', databaseName);
    const statements = splitSqlStatements(schema);
    for (const statement of statements) {
      await connection.query(statement);
    }
    console.log(`Migration selesai: ${statements.length} pernyataan SQL dijalankan.`);
    const [tables] = await connection.query(
      `SELECT COUNT(*) AS total
         FROM information_schema.tables
        WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [databaseName]
    );
    const [triggers] = await connection.query(
      `SELECT COUNT(*) AS total
         FROM information_schema.triggers
        WHERE trigger_schema = ?
          AND trigger_name IN (
            'trg_after_insert_detail_penjualan',
            'trg_after_insert_detail_stock_opname'
          )`,
      [databaseName]
    );
    if (Number(tables[0].total) !== 14 || Number(triggers[0].total) !== 2) {
      throw new Error(`Verifikasi schema gagal: ditemukan ${tables[0].total} tabel dan ${triggers[0].total} trigger.`);
    }
    console.log('Verifikasi berhasil: 14 tabel dan 2 trigger aktif.');
  } finally {
    await connection.end();
  }
}

module.exports = { splitSqlStatements };

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Migration gagal:', error.message);
    process.exitCode = 1;
  });
}
