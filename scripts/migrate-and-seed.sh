#!/bin/sh
# ──────────────────────────────────────────────────────────────
# StudioWaai — Run DB migrations & seed data
# Executed automatically before the NestJS app starts.
#
# - Tracks which migrations have already been applied
# - Only runs new migrations (idempotent)
# - Seeds default workspace + admin user if missing
# ──────────────────────────────────────────────────────────────
set -e

echo "🗄️  Running database migrations..."

# Parse DATABASE_URL → individual vars for psql
# Supports: postgresql://user:pass@host:port/dbname
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

export PGPASSWORD="$DB_PASS"
PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1"

# ── 1. Create migration tracking table ───────────────────────
$PSQL -q <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
    id          SERIAL PRIMARY KEY,
    filename    TEXT NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# ── 2. Run each migration file in order ──────────────────────
MIGRATION_DIR="/app/migrations"
APPLIED=0
SKIPPED=0

for f in "$MIGRATION_DIR"/[0-9]*.sql; do
  [ -f "$f" ] || continue
  BASENAME=$(basename "$f")

  # Check if already applied
  ALREADY=$($PSQL -tAq -c "SELECT 1 FROM _migrations WHERE filename = '$BASENAME' LIMIT 1" 2>/dev/null || echo "")

  if [ "$ALREADY" = "1" ]; then
    SKIPPED=$((SKIPPED + 1))
  else
    echo "  ▶ Applying $BASENAME ..."
    $PSQL -q < "$f"
    $PSQL -q -c "INSERT INTO _migrations (filename) VALUES ('$BASENAME')"
    APPLIED=$((APPLIED + 1))
  fi
done

echo "  ✅ Migrations: $APPLIED applied, $SKIPPED skipped"

# ── 3. Seed default workspace + admin user ────────────────────
echo "🌱 Running seed data..."

$PSQL -q <<'SQL'
-- Workspace
INSERT INTO workspaces (name, slug)
VALUES ('Studio Waai', 'studio-waai')
ON CONFLICT DO NOTHING;

-- Admin user
WITH ws AS (SELECT id FROM workspaces WHERE slug = 'studio-waai' LIMIT 1)
INSERT INTO users (default_workspace_id, email, name, password_hash, role, is_admin, is_active)
SELECT ws.id, 'info@studiowaai.nl', 'Studio Waai Admin',
       '$2b$10$JAs2Zbf0IxnlLZhch1QaJevV2wdihycgulNG.bbkPH5hy4ch0RNRm',
       'admin', true, true
FROM ws
ON CONFLICT (email) DO NOTHING;

-- Workspace member
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
SELECT w.id, u.id, 'owner', NOW()
FROM users u, workspaces w
WHERE u.email = 'info@studiowaai.nl' AND w.slug = 'studio-waai'
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Set workspace owner
UPDATE workspaces SET owner_id = (SELECT id FROM users WHERE email = 'info@studiowaai.nl')
WHERE slug = 'studio-waai' AND owner_id IS NULL;
SQL

echo "  ✅ Seed data applied"
echo ""
