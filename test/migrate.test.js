const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { splitSqlStatements } = require('../database/migrate');
const { isValidEan13 } = require('../controllers/masterController');

const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');

test('SQL parser splits multiline statements and honors $$ trigger delimiters', () => {
  const statements = splitSqlStatements(`
    CREATE TABLE sample_table (
      id BIGINT UNSIGNED NOT NULL,
      note VARCHAR(30) DEFAULT 'semi;colon'
    );
    DELIMITER $$
    CREATE TRIGGER sample_trigger
    AFTER INSERT ON sample_table
    FOR EACH ROW
    BEGIN
      SET @sample_value = 'first;second';
    END$$
    DELIMITER ;
    INSERT INTO sample_table (id) VALUES (1);
  `);

  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE sample_table/);
  assert.match(statements[1], /BEGIN[\s\S]*END$/);
  assert.match(statements[2], /INSERT INTO sample_table/);
});

test('schema declares the 14 CDM tables and the two stock triggers', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(schema);
  const tables = statements.filter((statement) => /^CREATE TABLE IF NOT EXISTS/i.test(statement));
  const triggers = statements.filter((statement) => /^CREATE TRIGGER/i.test(statement));

  assert.equal(tables.length, 14);
  assert.deepEqual(
    triggers.map((statement) => statement.match(/^CREATE TRIGGER\s+(\w+)/i)?.[1]),
    ['trg_after_insert_detail_penjualan', 'trg_after_insert_detail_stock_opname']
  );
  assert.match(schema, /UNIQUE KEY uq_produk_gudang \(id_produk, id_gudang\)/);
});

test('seeded product barcodes have valid EAN-13 check digits', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const seedBlock = schema.split('INSERT INTO produk')[1].split('ON DUPLICATE KEY UPDATE')[0];
  const barcodes = [...seedBlock.matchAll(/'(\d{13})'/g)].map((match) => match[1]);

  assert.equal(barcodes.length, 5);
  assert.ok(barcodes.every(isValidEan13));
});
