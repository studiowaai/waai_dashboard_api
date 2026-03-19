-- Migration: Rename organizations → workspaces + add workspace_members
-- Description: Evolve from simple org/user model to multi-tenant workspace model
-- Date: 2026-03-15

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Rename organizations → workspaces
-- ══════════════════════════════════════════════════════════════
ALTER TABLE organizations RENAME TO workspaces;

-- Add new columns to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Backfill slugs from name (lowered, no spaces)
UPDATE workspaces SET slug = LOWER(REPLACE(name, ' ', '-')) WHERE slug IS NULL;
ALTER TABLE workspaces ALTER COLUMN slug SET NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 2. Create workspace_members join table
-- ══════════════════════════════════════════════════════════════
CREATE TABLE workspace_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'agent',
    invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at   TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT workspace_members_role_check CHECK (
        role IN ('owner', 'admin', 'agent')
    ),
    CONSTRAINT workspace_members_unique UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

-- ══════════════════════════════════════════════════════════════
-- 3. Update users table — rename org_id → default_workspace_id
-- ══════════════════════════════════════════════════════════════
ALTER TABLE users RENAME COLUMN org_id TO default_workspace_id;
ALTER INDEX idx_users_org_id RENAME TO idx_users_default_workspace_id;

-- ══════════════════════════════════════════════════════════════
-- 4. Migrate existing users → workspace_members
-- ══════════════════════════════════════════════════════════════
INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
SELECT default_workspace_id, id,
       CASE WHEN is_admin THEN 'admin' ELSE 'agent' END,
       created_at
FROM users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- 5. Update related tables that reference org_id
-- ══════════════════════════════════════════════════════════════
ALTER TABLE approvals RENAME COLUMN org_id TO workspace_id;
ALTER INDEX idx_approvals_org_status RENAME TO idx_approvals_workspace_status;
ALTER INDEX idx_approvals_org_created RENAME TO idx_approvals_workspace_created;

-- Update ingest_tokens if org_id column exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ingest_tokens' AND column_name='org_id') THEN
    ALTER TABLE ingest_tokens RENAME COLUMN org_id TO workspace_id;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 6. Set workspace owner from first admin or earliest user
-- ══════════════════════════════════════════════════════════════
UPDATE workspaces w
SET owner_id = (
  SELECT wm.user_id FROM workspace_members wm
  WHERE wm.workspace_id = w.id
  ORDER BY (wm.role = 'admin') DESC, wm.joined_at ASC
  LIMIT 1
);

-- ══════════════════════════════════════════════════════════════
-- 7. Triggers
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Drop old organizations trigger if exists
DROP TRIGGER IF EXISTS update_organizations_updated_at ON workspaces;

COMMIT;
