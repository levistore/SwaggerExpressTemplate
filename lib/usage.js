// Usage tracking / API analytics (Phase 3).
//
// Prinsip:
//   - Fire-and-forget: kegagalan write analytics TIDAK PERNAH bikin request gagal.
//   - Yang disimpan cuma metadata operasional (lihat db/007_usage_quota.sql).
//   - JANGAN PERNAH memasukkan header Authorization, token, key raw, password,
//     body request, atau query sensitif ke sini. route = path tanpa query.
//
// Retensi: baris > 30 hari dihapus dengan throttle (maks 1x/jam per instance).
const db = require('./db');

const RETENTION_DAYS = 30;
let lastCleanup = 0;

function record(entry) {
  try {
    db.query(
      `insert into api_usage (user_id, api_key_id, method, route, status_code,
                              duration_ms, platform, request_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.userId || null,
        entry.apiKeyId || null,
        String(entry.method || '').slice(0, 10),
        String(entry.route || '').slice(0, 200),
        entry.status | 0,
        entry.durationMs | 0,
        entry.platform ? String(entry.platform).slice(0, 32) : null,
        entry.requestId ? String(entry.requestId).slice(0, 64) : null,
      ]
    ).catch(() => {});

    // Cleanup throttle: sekali per jam, HANYA di hot path — bounded DELETE
    // (maks 5000 baris per panggilan) supaya tidak pernah jadi operasi besar
    // di dalam request user. Sisa baris diambil giliran berikutnya.
    const now = Date.now();
    if (now - lastCleanup > 3600_000) {
      lastCleanup = now;
      cleanupExpired(5000);
    }
  } catch { /* analytics tidak pernah meledakkan request */ }
}

/** Hapus usage > retention. Bounded, idempotent, aman dipanggil berkala. */
function cleanupExpired(limit = 5000) {
  return db.query(
    `delete from api_usage where id in (
       select id from api_usage where created_at < now() - ($1 || ' days')::interval limit $2
     )`,
    [String(RETENTION_DAYS), limit]
  ).then((r) => r.rowCount).catch(() => -1);
}

/** Pemakaian harian sebuah API key (dipakai quota enforcement). */
async function dailyCountForKey(apiKeyId) {
  const { rows } = await db.query(
    `select count(*)::int as n from api_usage
     where api_key_id = $1 and created_at >= date_trunc('day', now())`,
    [apiKeyId]
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = { record, dailyCountForKey, cleanupExpired, RETENTION_DAYS };
