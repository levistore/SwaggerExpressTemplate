# Express API with Swagger Documentation

This is a skeleton Express.js project with Swagger API documentation integration. It provides a basic structure for building RESTful APIs with automatic documentation.

## Features

- Express.js web server
- Swagger UI for API documentation
- Example API routes with CRUD operations
- API documentation using JSDoc comments
- Development mode with auto-restart using nodemon

## Project Structure

```
├── app.js                # Main application entry point
├── package.json          # Project dependencies and scripts
├── routes/               # API route definitions
│   └── users.js          # User routes with Swagger documentation
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

## API Endpoints

### Users

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a specific user by ID
- `POST /api/users` - Create a new user
- `PUT /api/users/:id` - Update a user
- `DELETE /api/users/:id` - Delete a user

## Extending the Project

### Adding New Routes

1. Create a new route file in the `routes` directory
2. Add Swagger JSDoc comments to document your API
3. Import and use the route in `app.js`

### Customizing Swagger Documentation

You can modify the Swagger configuration in `app.js` to customize the documentation:

```javascript
const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Your API Title',
      version: 'Your Version',
      description: 'Your Description',
      contact: {
        name: 'Your Name',
        email: 'your.email@example.com'
      }
    }
  },
  apis: ['./routes/*.js']
};
```

## License

ISC