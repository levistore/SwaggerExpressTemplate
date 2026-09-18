// Verifikasi signature webhook (Phase 6).
// Header dari LCODE API:
//   X-LCODE-Signature: sha256=<hmac_sha256_hex(secret, RAW_BODY)>
//   X-LCODE-Event-Id:  evt_...  → pakai untuk dedup (delivery at-least-once)
//
// PENTING: verifikasi memakai RAW request body (byte asli), bukan hasil
// re-serialize JSON.parse — urutan/spasi bisa berubah dan signature jadi beda.
//
// Express:
//   app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const crypto = require('crypto');

function verifySignature(secret, rawBody, header) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const received = header.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Contoh handler Express:
//
// app.post('/hooks/lcode', express.raw({ type: 'application/json' }), (req, res) => {
//   const raw = req.body; // Buffer
//   if (!verifySignature(WEBHOOK_SECRET, raw, req.headers['x-lcode-signature'])) {
//     return res.status(401).send('bad signature');
//   }
//   const event = JSON.parse(raw.toString('utf8'));
//   // event = { id, type, created_at, data } — dedup via event.id
//   res.sendStatus(204);
// });

module.exports = { verifySignature };

if (require.main === module) {
  const secret = 'whsec_demo';
  const body = JSON.stringify({ id: 'evt_x', type: 'API_KEY_CREATED', created_at: new Date().toISOString(), data: {} });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  console.log('valid:', verifySignature(secret, body, sig));
  console.log('invalid:', verifySignature(secret, body + ' ', sig));
}
