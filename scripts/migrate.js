#!/usr/bin/env node
/**
 * Migration runner — jalankan semua db/*.sql ke database Supabase.
 *
 * Usage:
 *   node scripts/migrate.js
 *
 * Butuh connection string (bukan REST API), ambil dari env:
 *   MIGRATE_DATABASE_URL  -> kalau diisi, pakai itu
 *   atau otomatis cari (urut prioritas):
 *     POSTGRES_URL_NON_POOLING, POSTGRES_URL, DATABASE_URL
 *
 * Pakai yang NON-POOLING buat DDL: pooler (pgbouncer) mode transaction
 * nggak cocok buat statement DDL multi-baris.
 *
 * Idempotent: file migration ditulis pakai IF NOT EXISTS / ON CONFLICT,
 * jadi aman dijalankan berulang.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'db');

function resolveUrl() {
  if (process.env.MIGRATE_DATABASE_URL) return ['MIGRATE_DATABASE_URL', process.env.MIGRATE_DATABASE_URL];
  for (const key of ['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL', 'DATABASE_URL']) {
    if (process.env[key]) return [key, process.env[key]];
  }
  return [null, null];
}

async function main() {
  const [source, url] = resolveUrl();
  if (!url) {
    console.error(
      'Connection string nggak ketemu. Set MIGRATE_DATABASE_URL, atau salah satu dari:\n' +
        '  POSTGRES_URL_NON_POOLING, POSTGRES_URL, DATABASE_URL'
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`Nggak ada file .sql di ${DIR}`);
    process.exit(1);
  }

  console.log(`sumber connection string: ${source}`);
  const client = new Client({
    connectionString: url,
    ssl: /sslmode=disable|[?&]host=\/|@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(url)
      ? false
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      process.stdout.write(`-> ${file} ... `);
      await client.query(sql);
      console.log('OK');
    }

    // Bukti nyata: baca balik isi tabelnya, bukan cuma percaya "OK".
    const { rows: tables } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`
    );
    console.log('\ntabel di schema public:', tables.map((t) => t.table_name).join(', ') || '(kosong)');

    const { rows: users } = await client.query('select id, name, email from public.users order by id');
    console.log(`isi public.users (${users.length} baris):`);
    for (const u of users) console.log(`  ${u.id} | ${u.name} | ${u.email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nGAGAL:', err.message);
  process.exit(1);
});
