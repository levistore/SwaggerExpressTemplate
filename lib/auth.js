const crypto = require('crypto');
const { SignJWT, jwtVerify } = require('jose');

// ---------------------------------------------------------------------------
// Password: scrypt dari modul crypto bawaan Node.
//
// scrypt itu memory-hard (mahal buat GPU/ASIC), jadi jauh lebih tahan
// brute-force daripada SHA-256 polos. Dipilih daripada bcrypt karena nol
// dependency dan nggak butuh kompilasi native (bcrypt native sering gagal
// build di serverless).
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const MIN_PASSWORD_LENGTH = 8;

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Hash password jadi satu string yang isinya parameter + salt + hash.
 * Menyimpan parameter di string bikin hash lama tetap bisa diverifikasi
 * walau parameter-nya nanti dinaikin.
 */
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT.keylen, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verifikasi password. Balikin false (bukan throw) kalau hash-nya rusak,
 * supaya baris database yang aneh nggak bikin endpoint 500.
 */
async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scryptAsync(plain, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT.maxmem,
    });
    // timingSafeEqual: perbandingan biasa bocorin info lewat waktu eksekusi.
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Hash palsu buat email yang nggak ada.
 *
 * Tanpa ini, login dengan email tidak terdaftar balik jauh lebih cepat
 * daripada email terdaftar + password salah. Selisih waktunya bisa dipakai
 * buat nebak email mana yang terdaftar (user enumeration).
 */
const DUMMY_HASH = [
  'scrypt',
  SCRYPT.N,
  SCRYPT.r,
  SCRYPT.p,
  crypto.randomBytes(16).toString('base64'),
  crypto.randomBytes(SCRYPT.keylen).toString('base64'),
].join('$');

// ---------------------------------------------------------------------------
// JWT (HS256, pakai jose)
// ---------------------------------------------------------------------------
const JWT_ALG = 'HS256';
const TOKEN_TTL = '7d';
const MIN_SECRET_LENGTH = 32;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET belum diisi atau kurang dari ${MIN_SECRET_LENGTH} karakter. ` +
        'Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  return new TextEncoder().encode(secret);
}

// Gagal keras waktu boot, bukan error misterius waktu ada request.
// Dicek di sini biar salah konfigurasi ketahuan langsung, bukan pas login.
getSecret();

async function signToken(user) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());
}

/**
 * Verifikasi token. Balikin payload kalau valid, null kalau tidak.
 *
 * algorithms dibatasi ke HS256 secara eksplisit — ini yang nutup celah
 * "alg confusion", di mana penyerang ganti header jadi alg:none atau
 * alg:RS256 dan bikin verifikasi dilewatin.
 */
async function verifyToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [JWT_ALG] });
    if (!payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Validasi email sederhana. Sengaja nggak pakai regex RFC 5322 lengkap —
 * itu panjang, susah dibaca, dan tetap nggak bisa memastikan email benar
 * (satu-satunya cara: kirim email verifikasi).
 */
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  isValidEmail,
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  TOKEN_TTL,
};
