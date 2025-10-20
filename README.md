# Dashboard API

This is the **Dashboard API** that handles all authentication, user management, and data visualization for the frontend dashboard application.

## Endpoints

### Health Check

- `GET /health` - Health check endpoint

### Authentication

- `POST /auth/login` - Login with email/password
- `POST /auth/logout` - Logout and clear session

### User Profile

- `GET /me` - Get current authenticated user's profile

### Statistics

- `GET /stats/overview?range=7d|30d` - Get workflow statistics overview
- `GET /stats/trends?range=7d|30d` - Get daily execution trends

### Workflow Runs

- `GET /runs/recent?limit=10` - Get recent workflow executions

### Admin Endpoints (Admin Only)

#### Organizations

- `GET /admin/organizations` - List all organizations
- `POST /admin/organizations` - Create a new organization
- `PUT /admin/organizations/{org_id}` - Update an organization
- `DELETE /admin/organizations/{org_id}` - Delete an organization

#### Users

- `GET /admin/users?org_id={org_id}` - List all users (optionally filtered by org)
- `POST /admin/users` - Create a new user
- `PUT /admin/users/{user_id}` - Update a user
- `DELETE /admin/users/{user_id}` - Delete a user

#### Runs

- `GET /admin/runs?org_id={org_id}&limit=50` - Get all workflow runs across organizations

## Environment Variables

```bash
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
CORS_ORIGIN=http://localhost:3000,https://dashboard.yourdomain.com
JWT_SECRET=your-secret-key-here
JWT_EXPIRE_MIN=43200  # 30 days
```

## Local Development

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Create a `.env` file with the required environment variables

3. Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

## Docker Deployment

```bash
docker build -t dashboard-api .
docker run -p 8000:8000 --env-file .env dashboard-api
```

## CapRover Deployment

This API is configured for CapRover deployment. Set the environment variables in CapRover:

- DATABASE_URL
- CORS_ORIGIN
- JWT_SECRET
- JWT_EXPIRE_MIN

The `captain-definition` file is already configured.
