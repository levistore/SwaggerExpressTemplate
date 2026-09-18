// Structured logging — satu format JSON per baris ke stdout.
//
// Di Vercel, stdout function otomatis ke-log dan bisa dicari di dashboard.
// Format JSON bikin log gampang difilter tanpa dependency.
//
// ATURAN: jangan pernah lempar password, token, header Authorization,
// atau connection string ke sini. Field sensitif harus dihapus sebelum
// dipanggil, bukan dibuang di sini.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, msg };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    entry[k] = v;
  }
  // Satu JSON.stringify per entry — kalau ada field aneh (circular dsb)
  // jangan sampai bikin request 500 cuma karena logging.
  try {
    process.stdout.write(JSON.stringify(entry) + '\n');
  } catch { /* logging tidak boleh bikin crash */ }
}

module.exports = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};
