# Express API with Swagger Documentation

This is a skeleton Express.js project with Swagger API documentation integration. It provides a basic structure for building RESTful APIs with automatic documentation, configured for both local development and Vercel deployment.

## Features

- Express.js web server
- Swagger UI for API documentation
- Example API routes with CRUD operations
- API documentation using JSDoc comments
- Development mode with auto-restart using nodemon
- Vercel deployment configuration with CDN for Swagger UI assets

## Project Structure

```
├── app.js                # Main application entry point
├── package.json          # Project dependencies and scripts
├── routes/               # API route definitions
│   └── users.js          # User routes with Swagger documentation
├── vercel.json           # Vercel deployment configuration
└── README.md             # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (v12 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository or download the source code

2. Install dependencies
   ```
   npm install
   ```

### Running the Application

#### Development Mode

```
npm run dev
```

This will start the server with nodemon, which automatically restarts when you make changes to the code.

#### Production Mode

```
npm start
```

### Accessing the API

- API Base URL: http://localhost:3000
- Swagger Documentation: http://localhost:3000/api-docs

## Vercel Deployment

This project is configured for deployment on Vercel with the following features:

1. **vercel.json Configuration**:
   - Builds the app.js file using the Node.js runtime
   - Routes all requests to the Express application
   - Configures CDN routes for Swagger UI assets

2. **Swagger UI CDN Integration**:
   - Uses CDN links for Swagger UI CSS and JavaScript files
   - Improves loading performance in production
   - Routes configured:
     - `/api/swagger-ui.css` → CDN CSS file
     - `/api/swagger-ui-bundle.js` → CDN JS bundle
     - `/api/swagger-ui-standalone-preset.js` → CDN JS preset

3. **Environment Detection**:
   - Automatically detects Vercel environment
   - Uses appropriate server URLs based on environment
   - Configures Swagger UI differently in production vs development

### Deploying to Vercel

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)

2. Import the project in the Vercel dashboard

3. Deploy with default settings (Vercel will detect the Node.js project)

4. Access your API at the provided Vercel URL

5. Access Swagger documentation at `https://your-vercel-url/api-docs`

## API Endpoints

### Users

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a specific user by ID
- `POST /api/users` - Create a new user
- `PUT /api/users/:id` - Update a user
- `DELETE /api/users/:id` - Delete a user

## License

ISC