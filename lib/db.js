const { Pool } = require('pg');

// Neon nulis connection string ke beberapa nama env var tergantung cara setup.
// Ambil yang pertama ketemu, biar nggak rewel kalau nama-nya beda.
const CONNECTION_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'];

function resolveConnectionString() {
  for (const key of CONNECTION_KEYS) {
    if (process.env[key]) return process.env[key];
  }
  return null;
}

/**
 * Postgres lokal (socket, localhost) nggak pakai TLS. Provider terkelola
 * (Neon dll) wajib TLS. Salah tebak di sini bikin error koneksi yang
 * bingungin, jadi deteksinya eksplisit.
 */
function needsSsl(connectionString) {
  if (/sslmode=disable/.test(connectionString)) return false;
  // koneksi lewat unix socket: host=/var/run/postgresql atau ?host=/tmp/pgdata
  if (/[?&]host=\//.test(connectionString)) return false;
  // host lokal eksplisit
  if (/@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(connectionString)) return false;
  return true;
}

const connectionString = resolveConnectionString();

// Gagal keras waktu boot, bukan error misterius waktu ada request.
if (!connectionString) {
  throw new Error(
    `Environment variable belum diisi: salah satu dari ${CONNECTION_KEYS.join(', ')}. ` +
      'Lokal: copy .env.example jadi .env. Vercel: Settings -> Environment Variables.'
  );
}

// Pool di level modul: dipakai ulang selama instance serverless masih hangat.
// max kecil karena Vercel bisa menyalakan banyak instance sekaligus — Neon
// punya pooler sendiri di sisi server, jadi kita nggak perlu pool besar.
const pool = new Pool({
  connectionString,
  ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

// Tanpa handler ini, koneksi idle yang diputus server bikin proses crash.
pool.on('error', (err) => {
  console.error('[db] error pada koneksi idle:', err.message);
});

module.exports = pool;
