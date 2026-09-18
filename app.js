const express = require('express');
const path = require('path');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const security = require('./lib/middleware');
const { rateLimit } = require('./lib/ratelimit');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware global — urutan penting:
// request id -> headers -> cors -> body parse (dengan guard ukuran) -> log
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.use(security.requestId);
app.use(security.securityHeaders);
app.use(security.cors);
app.use(security.bodyLimit);
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// Penghalang global: 300 req/menit per IP untuk seluruh /api.
// Endpoint sensitif dapat limit jauh lebih ketat di route-nya masing-masing.
app.use('/api', rateLimit(300, { scope: 'api' }));

app.use(security.requestLogger);

// ---------------------------------------------------------------------------
// Usage tracking (Phase 3) — fire-and-forget, TIDAK menyimpan secret apa pun
// (hanya metadata operasional: user/key id, route, status, durasi, request_id).
// Gagal write analytics tidak pernah bikin request gagal (lib/usage.js).
// ---------------------------------------------------------------------------
const usage = require('./lib/usage');
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl || !req.originalUrl.startsWith('/api')) return;
    usage.record({
      userId: req.user ? req.user.id : null,
      apiKeyId: req.auth && req.auth.type === 'api_key' ? req.auth.keyId : null,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
      platform: req.params && req.params.platform ? req.params.platform : null,
      requestId: req.id,
    });
  });
  next();
});

// Landing page statis (public/) — index.html dilayani di '/'
// Nama file nggak di-hash, jadi jangan cache lama: cukup revalidate (ETag -> 304).
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}));

// Swagger configuration
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'LCODE API',
      version: '2.0.0',
      description: [
        'LCODE API — downloader multi-platform, auth (JWT + session + refresh token), API keys dengan scopes, quota, audit trail.',
        '',
        '**Versioning:** `/api/v1/...` adalah canonical API (respons envelope `{success, data|error, request_id}`). Path `/api/...` tanpa versi tetap bekerja sebagai compatibility layer dengan format respons legacy.',
        '**Auth:** Bearer JWT **atau** API key `lcode_live_...` (scopes: downloads:read, profile:read, profile:write). Endpoint admin menolak API key.',
        '**Rate limit:** global 300/m, auth 10/m, download 20/m, keys 30/m, admin 60/m → 429 + Retry-After. Quota per API key: 60/m & 1000/hari (default).',
        '**Errors:** `{success:false, error:{code,message}, request_id}`. Semua respons membawa X-Request-ID.',
      ].join('\n'),
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      servers: [
        {
          url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`,
          description: process.env.VERCEL_URL ? 'Production server' : 'Development server'
        }
      ]
    }
  },
  apis: ['./routes/*.js'] // Path to the API routes files
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

// Check if running in Vercel production environment
const isVercelProduction = process.env.VERCEL_ENV === 'production';

// Configure Swagger UI with CDN options when in Vercel production
const swaggerUiOptions = isVercelProduction ? {
  customCssUrl: '/api/swagger-ui.css',
  customJs: [
    '/api/swagger-ui-bundle.js',
    '/api/swagger-ui-standalone-preset.js'
  ]
} : {};

// Spec JSON untuk konsumsi programatis (Phase 3): /api/docs.json
app.get('/api/docs.json', (req, res) => res.json(swaggerDocs));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, swaggerUiOptions));

// Use routes
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const downloadRoutes = require('./routes/download');
const keysRoutes = require('./routes/keys');
const dashboardRoutes = require('./routes/dashboard');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/keys', keysRoutes);

// ---------------------------------------------------------------------------
// API versioning (Phase 3): /api/v1 = canonical API. Alias dari router yang
// SAMA dengan legacy — behavior, auth, scopes, rate limit, audit, quota
// identik; hanya format respons dibungkus envelope standar
// {success, data|error, request_id}. Legacy tetap bekerja (compatibility layer).
// ---------------------------------------------------------------------------
const { envelopedRouter } = require('./lib/envelope');
app.use('/api/v1/auth', envelopedRouter(authRoutes));
app.use('/api/v1/users', envelopedRouter(usersRoutes));
app.use('/api/v1/download', envelopedRouter(downloadRoutes));
app.use('/api/v1/keys', envelopedRouter(keysRoutes));
app.use('/api/v1/dashboard', envelopedRouter(dashboardRoutes));

// Health check — status nyata (DB di-ping beneran, nggak hardcode ok)
// Health check (Phase 5): app up / DB down dibedakan; cepat; TANPA detail
// kredensial/host/stack. Nggak menyentuh downloader provider eksternal.
// Metadata lifecycle aman: versi API, versi yang didukung, docs.
const API_LIFECYCLE = {
  current: 'v1',
  supported: ['v1'],
  deprecated: [], // legacy /api/* TIDAK dideprekasi — compatibility layer tetap
  docs: '/api/docs.json',
  legacy: { status: 'supported', note: 'path /api/* tanpa versi tetap berjalan' },
};

app.get('/api/health', async (req, res) => {
  try {
    const db = require('./lib/db');
    await db.query('select 1');
    return res.json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime(),
      api: API_LIFECYCLE,
      time: new Date().toISOString(),
    });
  } catch (err) {
    // Jangan bocorkan err.message (bisa berisi host/kredensial string koneksi).
    require('./lib/logger').error('health_db_down', { request_id: req.id, error: String(err.message).slice(0, 100) });
    return res.status(503).json({ status: 'degraded', database: 'down', api: API_LIFECYCLE });
  }
});

// Provider health internal (opsional, buat debugging — data sudah sanitasi:
// hanya counter/latency/kategori, tanpa URL user/credential).
app.get('/api/health/providers', (req, res) => {
  const { healthSnapshot } = require('./lib/resilience');
  return res.json({
    instance_local: true, // jujur: metrics ini per Vercel instance, bukan global
    providers: healthSnapshot(),
  });
});

// 404 + error handler TERAKHIR (setelah semua route)
app.use(security.notFoundHandler);
app.use(security.errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  if (process.env.VERCEL_URL) {
    console.log(`Swagger documentation available at https://${process.env.VERCEL_URL}/api-docs`);
  } else {
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
  }
  
  if (process.env.VERCEL_ENV) {
    console.log(`Running in Vercel ${process.env.VERCEL_ENV} environment`);
  }
});