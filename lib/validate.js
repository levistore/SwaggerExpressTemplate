// Validasi input server-side — dipakai semua route yang menerima body/query.
//
// Prinsip: frontend validation itu UX, BUKAN security. Semua yang datang
// dari luar dianggap tidak dipercaya. Fungsi di sini sengaja kecil dan
// eksplisit, tanpa library validasi (dependency discipline Phase 1).

const LIMITS = {
  name: 100,
  email: 254,
  password: 128,
  url: 2048,
  bodyBytes: 16 * 1024, // body JSON > 16KB ditolak
};

class ValidationError extends Error {
  constructor(message, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = code;
  }
}

/** String bersih: harus string, panjang wajar, tidak kosong setelah trim. */
function cleanString(value, { field, max, min = 1 }) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} harus berupa teks.`);
  }
  const v = value.trim();
  if (v.length < min) {
    throw new ValidationError(`${field} wajib diisi.`);
  }
  if (v.length > max) {
    throw new ValidationError(`${field} maksimal ${max} karakter.`);
  }
  return v;
}

function isValidEmail(email) {
  // Sama dengan lib/auth.isValidEmail — dipanggil lewat lib/auth supaya
  // tidak ada dua aturan berbeda.
  const { isValidEmail: fn } = require('./auth');
  return fn(email);
}

/** Email valid + batas panjang. Balikin versi trim/lowercase-normalized. */
function cleanEmail(value) {
  const v = cleanString(value, { field: 'Email', max: LIMITS.email });
  const normalized = v.toLowerCase();
  if (!isValidEmail(normalized)) {
    throw new ValidationError('Format email tidak valid.');
  }
  return normalized;
}

/**
 * Password: minimal panjang, maksimal panjang (mencegah DoS via scrypt
 * dengan password raksasa), tanpa aturan komposisi untuk register/login
 * (sama seperti perilaku lama). Ganti password di PUT /me punya aturan
 * komposisi sendiri di route-nya — tetap dipertahankan.
 */
function cleanPassword(value, { field = 'Password' } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} harus berupa teks.`);
  }
  if (value.length < 8) {
    throw new ValidationError(`${field} minimal 8 karakter.`);
  }
  if (value.length > LIMITS.password) {
    throw new ValidationError(`${field} maksimal ${LIMITS.password} karakter.`);
  }
  return value;
}

/** ID integer positif yang aman untuk kolom int4 Postgres. */
function cleanId(raw) {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  return id;
}

module.exports = { ValidationError, cleanString, cleanEmail, cleanPassword, cleanId, LIMITS };
