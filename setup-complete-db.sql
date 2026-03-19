-- Migration: Initial Schema
-- Description: Creates base organizations and users tables
-- Date: 2026-02-20

BEGIN;

-- 1. Create organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- 3. Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
-- Migration: Create Approval System Tables
-- Description: Adds approvals, approval_assets, and approval_events tables
-- Date: 2025-10-23

BEGIN;

-- 1. Create approvals table
CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    title TEXT NOT NULL,
    preview JSONB NOT NULL DEFAULT '{}'::jsonb,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    n8n_execute_webhook_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by_user_id UUID REFERENCES users(id),
    
    CONSTRAINT approvals_status_check CHECK (
        status IN ('pending', 'approved', 'rejected', 'sent', 'failed')
    ),
    CONSTRAINT approvals_type_check CHECK (
        type IN ('order', 'linkedin_post', 'gmail_reply')
    )
);

CREATE INDEX idx_approvals_org_status ON approvals(org_id, status);
CREATE INDEX idx_approvals_org_created ON approvals(org_id, created_at DESC);
CREATE INDEX idx_approvals_type ON approvals(type);

-- 2. Create approval_assets table
CREATE TABLE approval_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id UUID NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- Free-text: 'source_email_body_html', 'draft_order_confirmation_pdf', etc.
    storage_provider TEXT NOT NULL DEFAULT 'minio',  -- 'minio', 's3', 'external', 'local'
    storage_key TEXT,  -- MinIO/S3 key path
    external_url TEXT,  -- Presigned URL from MinIO/S3
    filename TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT approval_assets_storage_check CHECK (
        (storage_provider IN ('minio', 's3', 'external') AND external_url IS NOT NULL) OR
        (storage_provider = 'local' AND storage_key IS NOT NULL)
    )
);

CREATE INDEX idx_approval_assets_approval_id ON approval_assets(approval_id);
CREATE INDEX idx_approval_assets_role ON approval_assets(approval_id, role);

-- Common role values (not enforced - for documentation):
-- 'source_email_body_html', 'source_email_body_text', 'source_attachment',
-- 'draft_order_confirmation_pdf', 'draft_orderbon_pdf', 'draft_email_html'

-- 3. Create approval_events table
CREATE TABLE approval_events (
    id BIGSERIAL PRIMARY KEY,
    approval_id UUID NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
    event TEXT NOT NULL,  -- 'created', 'viewed', 'approved', 'rejected', 'sent', 'failed'
    by_user_id UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_events_approval_id ON approval_events(approval_id, created_at DESC);

-- 4. Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_approvals_updated_at BEFORE UPDATE ON approvals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- Verification queries (uncomment to test after running):
-- SELECT COUNT(*) FROM approvals;
-- SELECT COUNT(*) FROM approval_assets;
-- SELECT COUNT(*) FROM approval_events;
-- Backfill data.preview from legacy preview column if needed
UPDATE approvals
SET data = jsonb_set(
    COALESCE(data, '{}'::jsonb),
    '{preview}',
    COALESCE(preview, '{}'::jsonb),
    true
)
WHERE preview IS NOT NULL
  AND (data->'preview') IS NULL;

-- Drop the legacy preview column
ALTER TABLE approvals
DROP COLUMN IF EXISTS preview;

-- Migration: Add per-user page permissions
-- Description: Adds page_permissions JSONB to users table to control visible pages
-- Date: 2025-11-03

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS page_permissions JSONB NULL;

-- Optional: basic check to ensure it's an array of strings (not enforced strictly)
-- No strict constraint added to keep flexibility.

COMMIT;

-- Migration: Add n8n webhook URLs to organizations
-- Description: Adds columns for org-specific n8n webhook URLs for prompt processing and approvals
-- Date: 2025-11-05

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS n8n_transcribe_webhook_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS n8n_prompt_webhook_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS n8n_approval_webhook_url TEXT NULL;

COMMENT ON COLUMN organizations.n8n_transcribe_webhook_url IS 'n8n webhook URL for voice transcription (optional)';
COMMENT ON COLUMN organizations.n8n_prompt_webhook_url IS 'n8n webhook URL for prompt processing workflow';
COMMENT ON COLUMN organizations.n8n_approval_webhook_url IS 'n8n webhook URL for approval execution (called when approval is approved)';

COMMIT;
-- Migration: Add forward_gmail approval type
-- Description: Extends approvals_type_check to allow 'forward_gmail'
-- Date: 2026-01-08

BEGIN;

-- 1) Add new constraint including forward_gmail (NOT VALID to reduce impact)
ALTER TABLE approvals
  ADD CONSTRAINT approvals_type_check_v2
  CHECK (type IN ('order', 'linkedin_post', 'gmail_reply', 'forward_gmail'))
  NOT VALID;

-- 2) Validate it against existing rows
ALTER TABLE approvals
  VALIDATE CONSTRAINT approvals_type_check_v2;

-- 3) Replace old constraint with v2 under the original name
ALTER TABLE approvals
  DROP CONSTRAINT approvals_type_check;

ALTER TABLE approvals
  RENAME CONSTRAINT approvals_type_check_v2 TO approvals_type_check;

COMMIT;
-- Migration: Add password_hash and role columns to users
-- Description: Adds authentication fields for user login
-- Date: 2026-02-20

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Add check constraint for role
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'viewer'));

COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password for authentication';
COMMENT ON COLUMN users.role IS 'User role: user, admin, or viewer';

COMMIT;
-- Migration: Add ingest_tokens table
-- Description: Adds table for API authentication tokens per organization
-- Date: 2026-02-20

BEGIN;

CREATE TABLE ingest_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingest_tokens_org_id ON ingest_tokens(org_id);
CREATE INDEX idx_ingest_tokens_token ON ingest_tokens(token);

COMMENT ON TABLE ingest_tokens IS 'API tokens for organization-specific data ingestion';
COMMENT ON COLUMN ingest_tokens.token IS 'Unique token string for API authentication';
COMMENT ON COLUMN ingest_tokens.name IS 'Human-readable name/description for this token';

-- Add trigger to update updated_at
CREATE TRIGGER update_ingest_tokens_updated_at BEFORE UPDATE ON ingest_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- Maak admin gebruiker aan
INSERT INTO organizations (name) VALUES ('Studio Waai') ON CONFLICT DO NOTHING;

WITH org AS (SELECT id FROM organizations WHERE name = 'Studio Waai' LIMIT 1)
INSERT INTO users (org_id, email, name, password_hash, role, is_admin, is_active)
SELECT 
  org.id,
  'info@studiowaai.nl',
  'Studio Waai Admin',
  '$2b$10$JAs2Zbf0IxnlLZhch1QaJevV2wdihycgulNG.bbkPH5hy4ch0RNRm',
  'admin',
  true,
  true
FROM org
ON CONFLICT (email) DO NOTHING;

WITH org AS (SELECT id FROM organizations WHERE name = 'Studio Waai' LIMIT 1)
INSERT INTO ingest_tokens (org_id, token, name, is_active)
SELECT
  org.id,
  'waai_prod_' || substr(md5(random()::text), 1, 28),
  'Production API Token',
  true
FROM org
WHERE NOT EXISTS (SELECT 1 FROM ingest_tokens WHERE org_id = org.id);

