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
      title: 'Express API with Swagger',
      version: '1.0.0',
      description: 'A simple Express API with Swagger documentation',
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, swaggerUiOptions));

// Use routes
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const downloadRoutes = require('./routes/download');
const keysRoutes = require('./routes/keys');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/keys', keysRoutes);

// Health check — status nyata (DB di-ping beneran, nggak hardcode ok)
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./lib/db');
    await db.query('select 1');
    return res.json({ status: 'ok', database: 'connected', uptime: process.uptime() });
  } catch (err) {
    return res.status(503).json({ status: 'degraded', database: 'down', message: err.message });
  }
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