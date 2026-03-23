#!/bin/sh
# ──────────────────────────────────────────────────────────────
# StudioWaai API — Docker Entrypoint
# 1. Run DB migrations + seed
# 2. Start the app (dev or prod)
# ──────────────────────────────────────────────────────────────
set -e

# Run migrations & seed (idempotent)
sh /app/scripts/migrate-and-seed.sh

# Execute the CMD passed by Docker (npm run start:dev, node dist/main.js, etc.)
echo "🚀 Starting NestJS..."
exec "$@"
