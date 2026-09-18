// Response envelope standar (Phase 3) — dipakai DI MOUNT v1 SAJA.
//
// Legacy routes (/api/auth, /api/users, dst) TIDAK disentuh — format respons
// mereka tetap apa adanya supaya backward compatibility 100% (frontend &
// integrator lama tidak rusak). Endpoint /api/v1/* membungkus respons yang
// sama dengan format standar:
//
//   Success: { success: true, data: <payload asli>, request_id }
//   Error:   { success: false, error: { code, message }, request_id }
//
// Semua security middleware (rate limit, auth, scopes, audit, SSRF,
// error handler Phase 1) tetap jalan — envelope hanya membungkus output.
const { errorHandler } = require('./middleware');

function wrapSuccess(req, res, payload, status = 200) {
  return res.status(status).json({
    success: true,
    data: payload,
    request_id: req.id,
  });
}

// Bungkus router Express: intersep res.json sebelum dikirim, bungkus payload.
function envelopedRouter(router) {
  const wrapped = require('express').Router();
  wrapped.use((req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      // Sudah berbentuk envelope (dari error handler v1 / quota denial)?
      if (body && typeof body === 'object' &&
          (body.success === true || body.success === false)) {
        if (body.request_id === undefined) body.request_id = req.id;
        return origJson(body);
      }
      // Respons error dari handler legacy (res.status(4xx/5xx).json({message}))
      // → bungkus jadi error envelope, JANGAN success.
      if (res.statusCode >= 400) {
        return origJson({
          success: false,
          error: {
            code: (body && body.code) || 'ERROR',
            message: (body && (body.message || body.error)) || 'Terjadi kesalahan.',
          },
          request_id: req.id,
        });
      }
      return origJson({ success: true, data: body, request_id: req.id });
    };
    next();
  });
  wrapped.use(router);
  return wrapped;
}

// Error handler versi v1: format sama dengan errorHandler Phase 1 (yang sudah
// standar), tapi ditambah context quota dsb. Delegasi penuh ke Phase 1.
const v1ErrorHandler = errorHandler;

module.exports = { wrapSuccess, envelopedRouter, v1ErrorHandler };
