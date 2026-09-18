// SSRF protection buat endpoint downloader.
//
// User mengirim ?url= dan server melakukan permintaan keluar memakai nilai
// itu (setelah dipetakan ke provider pihak ketiga). Tanpa proteksi di sini,
// server bisa dipakai men-scanning jaringan internal / cloud metadata.
//
// Strategi:
//   1. Hanya scheme http/https.
//   2. Hostname dilarang keras: localhost, *.localhost, *.local, *.internal.
//   3. Hostname harus menyelesaikan (DNS) ke alamat IP PUBLIK — kita
//      menyelesaikannya sendiri (dns.lookup all) dan memeriksa setiap hasil.
//   4. Blokir semua rentang non-publik: loopback, private, link-local,
//      multicast, reserved, 0.0.0.0, dan metadata cloud (169.254.169.254).
//   5. Penyamaran IP ditegakkan: decimal (http://2130706433), hex
//      (0x7f000001), oktal, dan format singkat — semua dinormalisasi
//      ke bentuk numerik sebelum pemeriksaan, jadi tidak bergantung pada
//      blacklist string.
//   6. Literal IPv6 didukung ([::1], [fe80::], [fc00::], dst).
//
// Catatan rebind DNS: kita menyelesaikan DNS sekali di sini dan membuktikan
// alamatnya aman; fetch Node akan menyelesaikan lagi secara independen, jadi
// jendela rebinding klasik tetap ada secara teori. Instansi fetch di route
// dikunci tanpa redirect otomatis — ini mempersempit vektor tersebut
// tanpa menambahkan ketergantungan.
const dns = require('dns').promises;
const net = require('net');

class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.status = 400;
  }
}

/** Parse string IPv4 ke 32-bit number; null kalau bukan IPv4 valid. */
function ipv4ToInt(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/**
 * Normalisasi hostname yang bisa berupa penyamaran IP (desimal, hex, oktal,
 * format 3-bagian, dsb.) menjadi 4-oktet standar. Node `net.isIP` tidak
 * menangani http://2130706433/, jadi kita menanganinya sendiri.
 * Balikin { kind:'ipv4'|'ipv6', value } atau { kind:'name', value }.
 */
function classifyHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, ''); // trailing dot
  // bracket IPv6 literal
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1);
    return net.isIPv6(v6) ? { kind: 'ipv6', value: v6 } : null;
  }
  if (net.isIPv6(h)) return { kind: 'ipv6', value: h };
  if (net.isIPv4(h)) return { kind: 'ipv4', value: h };

  // Bukan dotted-quad → coba interpretasi integer/format singkat.
  // http://2130706433 = 127.0.0.1; http://0x7f.0.0.1 juga legal di banyak parser.
  if (/^\d+$/.test(h) && h.length <= 10) {
    const n = Number(h);
    if (n <= 0xffffffff) return { kind: 'ipv4', value: intToIpv4(n >>> 0) };
  }
  if (/^0x[0-9a-f]+$/i.test(h)) {
    const n = parseInt(h.slice(2), 16);
    if (n <= 0xffffffff) return { kind: 'ipv4', value: intToIpv4(n >>> 0) };
  }
  // bentuk campuran: hex/oktal/desimal per oktet (0x7f.0.0.1, 0177.0.0.1)
  if (/^[0-9.]+$/.test(h) && h.includes('.')) {
    const parts = h.split('.');
    if (parts.length >= 2 && parts.length <= 4) {
      const nums = [];
      for (const p of parts) {
        let v;
        if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p.slice(2), 16);
        else if (/^0[0-7]+$/.test(p)) v = parseInt(p.slice(1), 8);
        else if (/^\d+$/.test(p)) v = Number(p);
        else return { kind: 'name', value: h };
        if (Number.isNaN(v) || v > 255) return { kind: 'name', value: h };
        nums.push(v);
      }
      if (nums.length === 4) return { kind: 'ipv4', value: nums.join('.') };
      if (nums.length < 4) {
        // format singkat: bagian terakhir memuat sisa oktet
        const last = nums.pop();
        if (last <= 0xffffff) {
          const rest = [(last >>> 16) & 255, (last >>> 8) & 255, last & 255];
          const full = nums.concat(rest);
          if (full.length === 4) return { kind: 'ipv4', value: full.join('.') };
        }
      }
    }
  }
  return { kind: 'name', value: h };
}

function intToIpv4(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Apakah alamat IP ini dilarang keluar dari server? */
function isForbiddenIp(kind, ip) {
  if (kind === 'ipv6') {
    const low = ip.toLowerCase();
    if (low === '::' || low === '::1') return true; // unspecified / loopback
    // Expand IPv6 penuh jadi 8 grup hex — WHATWG URL mengompres IPv4-mapped
    // jadi bentuk seperti ::ffff:7f00:1, jadi analisa per-grup butuh bentuk penuh.
    let g;
    if (low.includes('::')) {
      const [a, b] = low.split('::');
      const head = a ? a.split(':') : [];
      const tail = b ? b.split(':') : [];
      g = head.concat(Array(8 - head.length - tail.length).fill('0'), tail)
        .map((x) => x.padStart(4, '0'));
    } else {
      g = low.split(':').map((x) => x.padStart(4, '0'));
    }
    if (g.length !== 8) return true; // bentuk aneh → fail-closed
    const num = (i) => parseInt(g[i], 16);
    // IPv4-mapped (0000:0000:0000:0000:0000:ffff:a.b.c.d): periksa IPv4-nya
    if (g[0] === '0000' && g[1] === '0000' && g[2] === '0000' &&
        g[3] === '0000' && g[4] === '0000' && g[5] === 'ffff') {
      // grup 6-7 bisa bentuk hex (7f00:0001) atau dotted (127.0.0.1)
      const v4 = /^[0-9a-f]{1,4}$/.test(g[6])
        ? `${(num(6) >> 8) & 255}.${num(6) & 255}.${(num(7) >> 8) & 255}.${num(7) & 255}`
        : g[6] + '.' + g[7].replace(/^0+(?=\d)/, '');
      if (isForbiddenIp('ipv4', v4)) return true;
    }
    const w = (i) => parseInt(g[i], 16);
    const f0 = w(0);
    if (f0 === 0 && num(1) === 0 && num(2) === 0 && num(3) === 0 && num(4) === 0 && num(5) === 0 && num(6) === 0 && num(7) === 1) return true; // ::1 bentuk expand
    if (f0 === 0xfe80 && (num(1) & 0xffc0) === 0) return true; // fe80::/10 link-local
    if ((f0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((f0 & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  const n = ipv4ToInt(ip);
  if (n === null) return true; // format aneh → tolak (fail-closed)
  const ranges = [
    [0x00000000, 0x00ffffff], // 0.0.0.0/8 — "this network" (termasuk 0.0.0.0)
    [0x0a000000, 0x0affffff], // 10.0.0.0/8
    [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
    [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
    [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (metadata AWS/GCP)
    [0xac100000, 0xac1fffff], // 172.16.0.0/12
    [0xc0000000, 0xc00000ff], // 192.0.0.0/24
    [0xc0000200, 0xc00002ff], // 192.0.2.0/24 TEST-NET
    [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
    [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmark
    [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET
    [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 TEST-NET
    [0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
    [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved + broadcast
  ];
  return ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

const FORBIDDEN_HOST_PATTERNS = [
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /\.internal$/,
];

/**
 * Validasi URL user untuk downloader.
 * Balikin URL ternormalisasi, atau throw SsrfError.
 */
async function assertSafePublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError('URL tidak valid.');
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError('Hanya URL http/https yang diizinkan.');
  }
  if (!u.hostname) throw new SsrfError('URL tidak punya hostname.');
  if (u.username || u.password) {
    throw new SsrfError('URL dengan kredensial tidak diizinkan.');
  }

  const cls = classifyHost(u.hostname);
  if (!cls) throw new SsrfError('Hostname URL tidak valid.');

  if (cls.kind === 'name') {
    const name = cls.value;
    if (FORBIDDEN_HOST_PATTERNS.some((re) => re.test(name))) {
      throw new SsrfError('URL mengarah ke host internal dan ditolak.');
    }
    // Resolve semua record — kalau SATU SAJA mengarah ke IP terlarang, tolak.
    let addrs;
    try {
      addrs = await dns.lookup(name, { all: true, verbatim: true });
    } catch {
      throw new SsrfError('Hostname tidak bisa di-resolve.');
    }
    if (!addrs || addrs.length === 0) {
      throw new SsrfError('Hostname tidak punya alamat IP.');
    }
    for (const a of addrs) {
      const kind = net.isIPv6(a.address) ? 'ipv6' : 'ipv4';
      if (isForbiddenIp(kind, a.address)) {
        throw new SsrfError('URL mengarah ke alamat internal dan ditolak.');
      }
    }
  } else if (isForbiddenIp(cls.kind, cls.value)) {
    throw new SsrfError('URL mengarah ke alamat internal dan ditolak.');
  }

  return u;
}

module.exports = { assertSafePublicUrl, SsrfError, isForbiddenIp, classifyHost };
