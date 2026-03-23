# Multi-stage build for NestJS
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install psql for running migrations
RUN apk add --no-cache postgresql16-client

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy migrations & entrypoint
COPY migrations ./migrations
COPY scripts ./scripts
RUN chmod +x scripts/*.sh

# Expose port (default 3000, but can be overridden with PORT env var)
EXPOSE 3000

# Run migrations → start NestJS
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
