require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const quoteIdentifier = (identifier) => `\`${identifier.replace(/`/g, '``')}\``;

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

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    let line = rawLine;
    const trimmed = rawLine.trim();
    if (!quote && !blockComment && !lineComment && /^DELIMITER\b/i.test(trimmed)) {
      const match = trimmed.match(/^DELIMITER\s+(\S+)(?:\s+(.*))?$/i);
      if (match) {
        delimiter = match[1];
        const tail = match[2] ? match[2].trim() : '';
        if (tail) {
          line = tail;
        } else {
          continue;
        }
      }
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

      const token = line.slice(index, index + delimiter.length);
      if (token === delimiter) {
        const remainder = line.slice(index + delimiter.length).trim();
        const resetMatch = remainder.match(/^DELIMITER\s*(\S+)?\s*$/i);
        if (resetMatch) {
          delimiter = resetMatch[1] || ';';
          flush();
          break;
        }
        flush();
        index += delimiter.length;
        continue;
      }

      current += char;
      index += 1;
    }

    if (!lineComment) {
      current += '\n';
    }
    lineComment = false;
  }

  if (quote) throw new Error('SQL tidak valid: literal string/identifier belum ditutup.');
  if (blockComment) throw new Error('SQL tidak valid: komentar blok belum ditutup.');
  flush();
  return statements;
}

async function getTableColumns(connection, databaseName, tableName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, EXTRA AS extra
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?`,
    [databaseName, tableName]
  );
  return new Map(
    rows.map((row) => {
      const name = row.column_name || row.COLUMN_NAME;
      const type = (row.column_type || row.COLUMN_TYPE || '').toLowerCase();
      const extra = row.extra || row.EXTRA || '';
      return [name.toLowerCase(), { column_name: name, column_type: type, extra }];
    })
  );
}

async function renameLegacyColumn(connection, databaseName, tableName, oldName, newName) {
  const columns = await getTableColumns(connection, databaseName, tableName);
  if (!columns.has(newName.toLowerCase()) && columns.has(oldName.toLowerCase())) {
    const [checks] = await connection.execute(
      `SELECT tc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS check_clause
         FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc
           ON cc.constraint_schema = tc.constraint_schema
          AND cc.constraint_name = tc.constraint_name
        WHERE tc.table_schema = ? AND tc.table_name = ?
          AND tc.constraint_type = 'CHECK'`,
      [databaseName, tableName]
    );
    for (const check of checks) {
      const cName = check.constraint_name || check.CONSTRAINT_NAME;
      const clause = (check.check_clause || check.CHECK_CLAUSE || '').toLowerCase();
      if (clause.includes(oldName.toLowerCase())) {
        try {
          await connection.query(
            `ALTER TABLE ${quoteIdentifier(tableName)} DROP CHECK ${quoteIdentifier(cName)}`
          );
        } catch (e) {}
      }
    }
    await connection.query(
      `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`
    );
  }
}

async function addColumnIfMissing(connection, databaseName, tableName, columnName, definition) {
  const columns = await getTableColumns(connection, databaseName, tableName);
  if (!columns.has(columnName.toLowerCase())) {
    await connection.query(
      `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
    );
  }
}

async function upgradeLegacySchema(connection, databaseName) {
  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME AS table_name FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
    [databaseName]
  );
  const tables = new Set(
    tableRows.map((row) => (row.table_name || row.TABLE_NAME || '').toLowerCase())
  );
  if (!tables.size) return;

  const renames = [
    ['supplier', 'kontak', 'no_telepon'],
    ['produk', 'kode_barcode', 'barcode'],
    ['current_stock', 'id_stock', 'id_current_stock'],
    ['current_stock', 'tanggal_update_terakhir', 'tanggal_update'],
    ['pembelian', 'nomor_po', 'no_faktur'],
    ['pembelian', 'total_pembelian', 'total_harga'],
    ['detail_pembelian', 'id_detail_pembelian', 'id_detail_beli'],
    ['detail_pembelian', 'jumlah_beli', 'jumlah'],
    ['detail_pembelian', 'harga_beli_satuan', 'harga_satuan'],
    ['penjualan', 'nomor_struk', 'no_transaksi'],
    ['penjualan', 'total_penjualan', 'total_bayar'],
    ['detail_penjualan', 'id_detail_penjualan', 'id_detail_jual'],
    ['detail_penjualan', 'jumlah_jual', 'jumlah'],
    ['detail_penjualan', 'harga_jual_satuan', 'harga_satuan'],
    ['retur', 'nomor_retur', 'no_retur'],
    ['stock_opname', 'id_stock_opname', 'id_opname'],
    ['stock_opname', 'nomor_opname', 'no_opname'],
    ['stock_opname', 'catatan', 'keterangan'],
    ['detail_stock_opname', 'id_detail_stock_opname', 'id_detail_opname'],
    ['detail_stock_opname', 'id_stock_opname', 'id_opname'],
    ['detail_stock_opname', 'jumlah_sistem', 'stok_sistem'],
    ['detail_stock_opname', 'jumlah_fisik', 'stok_fisik']
  ];
  for (const [tableName, oldName, newName] of renames) {
    if (tables.has(tableName.toLowerCase())) {
      await renameLegacyColumn(connection, databaseName, tableName, oldName, newName);
    }
  }

  const additions = [
    ['supplier', 'no_telepon', 'VARCHAR(30) NULL'],
    ['supplier', 'kontak_person', 'VARCHAR(120) NULL'],
    ['karyawan', 'no_telepon', 'VARCHAR(30) NULL'],
    ['karyawan', 'shift_kerja', 'VARCHAR(40) NULL'],
    ['gudang', 'kapasitas', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['current_stock', 'stok_minimum', 'INT UNSIGNED NOT NULL DEFAULT 5'],
    ['pembelian', 'status_pembayaran', "ENUM('Belum Lunas','Lunas') NOT NULL DEFAULT 'Belum Lunas'"],
    ['retur', 'total_nilai_retur', 'DECIMAL(14,2) NOT NULL DEFAULT 0'],
    ['retur', 'status_retur', "VARCHAR(40) NOT NULL DEFAULT 'Menunggu'"],
    ['detail_retur', 'harga_satuan', 'DECIMAL(14,2) NOT NULL DEFAULT 0'],
    ['detail_retur', 'subtotal', 'DECIMAL(14,2) NOT NULL DEFAULT 0'],
    ['detail_retur', 'alasan', "ENUM('Rusak','Kadaluarsa','Tidak Sesuai') NOT NULL DEFAULT 'Rusak'"],
    ['stock_opname', 'status_opname', "ENUM('Draft','Selesai','Dibatalkan') NOT NULL DEFAULT 'Selesai'"],
    ['detail_stock_opname', 'jenis_penyesuaian', "ENUM('Penambahan','Pengurangan','Tetap') NOT NULL DEFAULT 'Tetap'"],
    ['detail_stock_opname', 'keterangan', 'VARCHAR(255) NULL']
  ];
  for (const [tableName, columnName, definition] of additions) {
    if (tables.has(tableName.toLowerCase())) {
      await addColumnIfMissing(connection, databaseName, tableName, columnName, definition);
    }
  }

  if (tables.has('karyawan')) {
    const columns = await getTableColumns(connection, databaseName, 'karyawan');
    if (columns.has('username')) {
      await connection.query('ALTER TABLE karyawan MODIFY COLUMN username VARCHAR(60) NULL');
    }
    if (columns.has('jabatan') && columns.get('jabatan').column_type.startsWith('enum(')) {
      await connection.query(
        'ALTER TABLE karyawan MODIFY COLUMN jabatan VARCHAR(60) NOT NULL'
      );
    }
  }

  if (tables.has('detail_stock_opname')) {
    const columns = await getTableColumns(connection, databaseName, 'detail_stock_opname');
    if (columns.has('selisih') && columns.get('selisih').extra.includes('GENERATED')) {
      await connection.query(
        `ALTER TABLE detail_stock_opname
           ADD COLUMN selisih_migrasi INT NOT NULL DEFAULT 0`
      );
      await connection.query(
        `UPDATE detail_stock_opname
            SET selisih_migrasi = stok_fisik - stok_sistem`
      );
      await connection.query(
        `ALTER TABLE detail_stock_opname
           DROP COLUMN selisih,
           RENAME COLUMN selisih_migrasi TO selisih`
      );
      await connection.query(
        'ALTER TABLE detail_stock_opname MODIFY COLUMN selisih INT NOT NULL'
      );
    } else {
      await addColumnIfMissing(
        connection, databaseName, 'detail_stock_opname', 'selisih', 'INT NOT NULL DEFAULT 0'
      );
    }
    await connection.query(
      `UPDATE detail_stock_opname
          SET selisih = stok_fisik - stok_sistem,
              jenis_penyesuaian = CASE
                WHEN stok_fisik > stok_sistem THEN 'Penambahan'
                WHEN stok_fisik < stok_sistem THEN 'Pengurangan'
                ELSE 'Tetap'
              END`
    );
  }

  if (tables.has('retur')) {
    const columns = await getTableColumns(connection, databaseName, 'retur');
    const type = columns.get('jenis_retur')?.column_type || '';
    if (type.includes("'Supplier'") || type.includes("'Pelanggan'")) {
      const [checks] = await connection.execute(
        `SELECT tc.CONSTRAINT_NAME AS constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.check_constraints cc
             ON cc.constraint_schema = tc.constraint_schema
            AND cc.constraint_name = tc.constraint_name
          WHERE tc.constraint_schema = ? AND tc.table_name = 'retur'
            AND tc.constraint_type = 'CHECK'
            AND cc.check_clause LIKE '%jenis_retur%'`,
        [databaseName]
      );
      for (const check of checks) {
        const cName = check.constraint_name || check.CONSTRAINT_NAME;
        if (cName) {
          await connection.query(
            `ALTER TABLE retur DROP CHECK ${quoteIdentifier(cName)}`
          );
        }
      }
      await connection.query(
        'ALTER TABLE retur MODIFY COLUMN jenis_retur VARCHAR(40) NOT NULL'
      );
      await connection.query(
        `UPDATE retur
            SET jenis_retur = CASE jenis_retur
              WHEN 'Supplier' THEN 'Ke Supplier'
              WHEN 'Pelanggan' THEN 'Dari Pelanggan'
              ELSE jenis_retur
            END`
      );
      await connection.query(
        `ALTER TABLE retur MODIFY COLUMN jenis_retur
          ENUM('Ke Supplier','Dari Pelanggan') NOT NULL`
      );
    }
  }

  if (tables.has('current_stock') && tables.has('produk')) {
    const stockColumns = await getTableColumns(connection, databaseName, 'current_stock');
    const productColumns = await getTableColumns(connection, databaseName, 'produk');
    if (stockColumns.has('stok_minimum') && productColumns.has('stok_minimum')) {
      await connection.query(
        `UPDATE current_stock cs
          JOIN produk p ON p.id_produk = cs.id_produk
           SET cs.stok_minimum = p.stok_minimum,
               cs.status_stok = CASE
                 WHEN cs.jumlah_stok <= 0 THEN 'Habis'
                 WHEN cs.jumlah_stok <= p.stok_minimum THEN 'Menipis'
                 ELSE 'Aman'
               END`
      );
    }
  }
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
    if (statements.length < 2 || !/^CREATE DATABASE/i.test(statements[0]) || !/^USE /i.test(statements[1])) {
      throw new Error('Schema harus dimulai dengan CREATE DATABASE dan USE.');
    }
    await connection.query(statements[0]);
    await connection.query(statements[1]);
    await connection.query('DROP TRIGGER IF EXISTS trg_detail_penjualan_stok');
    await connection.query('DROP TRIGGER IF EXISTS trg_detail_opname_sinkronisasi');
    await upgradeLegacySchema(connection, databaseName);
    for (const statement of statements.slice(2)) {
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
    const totalTables = Number(tables[0]?.total ?? tables[0]?.TOTAL ?? 0);
    const totalTriggers = Number(triggers[0]?.total ?? triggers[0]?.TOTAL ?? 0);
    if (totalTables !== 14 || totalTriggers !== 2) {
      throw new Error(`Verifikasi schema gagal: ditemukan ${totalTables} tabel dan ${totalTriggers} trigger.`);
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
