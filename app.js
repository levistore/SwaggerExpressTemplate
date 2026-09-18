const express = require('express');
const path = require('path');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// Import routes
const usersRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const downloadRoutes = require('./routes/download');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/download', downloadRoutes);

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