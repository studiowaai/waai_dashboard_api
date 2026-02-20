# NestJS TypeScript Backend voor n8n Dashboard API

Volledige migratie van Python/FastAPI naar TypeScript/NestJS.

## Project Structuur

```
src/
├── main.ts                 # Bootstrap applicatie
├── app.module.ts           # Root module
├── health.controller.ts    # Health check endpoints
├── auth/                   # Authentication module
│   ├── auth.module.ts
│   ├── auth.service.ts     # JWT, bcrypt
│   ├── auth.controller.ts  # Login/logout
│   ├── jwt.strategy.ts
│   ├── jwt-auth.guard.ts
│   └── current-user.decorator.ts
├── me/                     # User profile module
│   ├── me.module.ts
│   ├── me.service.ts
│   └── me.controller.ts
├── stats/                  # Statistics module
│   ├── stats.module.ts
│   ├── stats.service.ts
│   └── stats.controller.ts
├── runs/                   # Workflow runs module
│   ├── runs.module.ts
│   ├── runs.service.ts
│   └── runs.controller.ts
├── prompts/                # AI prompts module
│   ├── prompts.module.ts
│   ├── prompts.service.ts
│   └── prompts.controller.ts
├── admin/                  # Admin module
│   ├── admin.module.ts
│   ├── admin.service.ts
│   ├── admin.controller.ts
│   └── admin.dto.ts
└── approvals/              # Approvals module
    ├── approvals.module.ts
    ├── approvals.service.ts
    └── approvals.controller.ts
```

## Installatie

```bash
# Install dependencies
npm install

# Development
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## Environment Variables

Zelfde als Python versie:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret
- `JWT_EXPIRE_MIN` - JWT expiration in minutes (default: 43200)
- `CORS_ORIGIN` - Comma-separated list of allowed origins
- `CORS_ORIGIN_REGEX` - Optional regex pattern for CORS origins
- `PORT` - Server port (default: 3000)
- `API_NAME` - API name for logging

## Docker

```bash
# Build
docker build -f Dockerfile.nestjs -t waai-dashboard-api:nestjs .

# Run
docker run -p 3000:3000 --env-file .env waai-dashboard-api:nestjs
```

## Belangrijke Verschillen met Python Versie

### Architectuur
- **NestJS Modules**: Elk domein heeft zijn eigen module (AuthModule, MeModule, etc.)
- **Dependency Injection**: Constructor-based DI i.p.v. FastAPI's Depends()
- **Guards & Decorators**: `@UseGuards(JwtAuthGuard)` en `@CurrentUser()` decorator
- **TypeORM**: Database queries via TypeORM DataSource (raw queries) i.p.v. SQLAlchemy

### HTTP Framework
- **Fastify**: NestJS draait op Fastify i.p.v. Starlette (sneller)
- **Cookie Handling**: Via `@fastify/cookie` package
- **File Uploads**: Via `@fastify/multipart` voor audio uploads in prompts

### Type Safety
- **DTOs**: Class-validator decorators voor request validation
- **Interfaces**: Type-safe response objects
- **TypeScript**: Compile-time type checking

### Database
- **Connection**: TypeORM met PostgreSQL driver
- **Queries**: Raw SQL queries (zelfde als Python versie)
- **Migrations**: SQL migration files blijven ongewijzigd

## API Endpoints

Alle endpoints zijn identiek aan de Python versie:

- `GET /health` - Health check
- `GET /debug/cors` - CORS debug info
- `POST /auth/login` - Login
- `POST /auth/logout` - Logout
- `GET /me` - Current user info
- `GET /stats/overview` - Statistics overview
- `GET /stats/trends` - Trends data
- `GET /runs/recent` - Recent workflow runs
- `GET /runs/:run_id` - Run details
- `POST /prompts/transcribe` - Audio transcription
- `POST /prompts/submit` - Submit prompt
- `GET /approvals` - List approvals
- `GET /approvals/:id` - Approval details
- `POST /approvals/:id/approve` - Approve
- `POST /approvals/:id/reject` - Reject
- `GET /approvals/:id/assets/:asset_id` - View asset
- Admin endpoints voor organizations, users, tokens

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## Performance

NestJS/Fastify is significant sneller dan Python/FastAPI:
- 2-3x sneller request handling
- Lower memory footprint
- Better concurrency (Node.js event loop)

## Deployment

### CapRover
Update captain-definition om Dockerfile.nestjs te gebruiken:
```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile.nestjs"
}
```

### Environment
Zelfde environment variables als Python versie werken direct.
