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
-- Migration: Integration framework
-- Description: Tables for managing OAuth integrations (Gmail, Shopify, etc.)
-- Date: 2026-03-15

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Integration providers (system-level catalog)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE integration_providers (
    id          TEXT PRIMARY KEY,           -- e.g. 'gmail', 'shopify'
    name        TEXT NOT NULL,              -- Human label: 'Gmail', 'Shopify'
    category    TEXT NOT NULL,              -- 'email', 'ecommerce', 'ai'
    auth_type   TEXT NOT NULL DEFAULT 'oauth2',
    config      JSONB NOT NULL DEFAULT '{}',  -- client_id placeholder, scopes, etc.
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT integration_providers_auth_check CHECK (
        auth_type IN ('oauth2', 'api_key', 'webhook')
    )
);

-- Seed initial providers
INSERT INTO integration_providers (id, name, category, auth_type, config) VALUES
  ('gmail',   'Gmail',   'email',      'oauth2', '{"scopes": ["https://www.googleapis.com/auth/gmail.modify"]}'),
  ('shopify', 'Shopify', 'ecommerce',  'oauth2', '{"scopes": ["read_orders", "read_customers"]}');

-- ══════════════════════════════════════════════════════════════
-- 2. Connected accounts (workspace-level)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE connected_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL REFERENCES integration_providers(id),
    label           TEXT,                   -- e.g. 'support@store.com'
    status          TEXT NOT NULL DEFAULT 'pending',
    credentials_enc BYTEA,                  -- encrypted OAuth tokens
    metadata        JSONB NOT NULL DEFAULT '{}',  -- shop domain, email address, etc.
    connected_by    UUID REFERENCES users(id),
    connected_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,            -- token expiry for refresh scheduling
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT connected_accounts_status_check CHECK (
        status IN ('pending', 'active', 'expired', 'revoked', 'error')
    )
);

CREATE INDEX idx_connected_accounts_workspace ON connected_accounts(workspace_id);
CREATE INDEX idx_connected_accounts_provider ON connected_accounts(workspace_id, provider_id);

-- ══════════════════════════════════════════════════════════════
-- 3. OAuth state (CSRF protection for OAuth flows)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE oauth_states (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id     TEXT NOT NULL REFERENCES integration_providers(id),
    state_token     TEXT NOT NULL UNIQUE,
    redirect_uri    TEXT,
    initiated_by    UUID NOT NULL REFERENCES users(id),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oauth_states_token ON oauth_states(state_token);

-- ══════════════════════════════════════════════════════════════
-- 4. Sync jobs (track integration sync status)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE sync_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connected_account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
    job_type            TEXT NOT NULL,        -- 'full_sync', 'incremental', 'webhook'
    status              TEXT NOT NULL DEFAULT 'pending',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    records_processed   INTEGER DEFAULT 0,
    error_message       TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sync_jobs_status_check CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
    )
);

CREATE INDEX idx_sync_jobs_account ON sync_jobs(connected_account_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status);

-- ══════════════════════════════════════════════════════════════
-- 5. Triggers
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_connected_accounts_updated_at BEFORE UPDATE ON connected_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
-- Migration: Contacts & Channels
-- Description: Support contacts and communication channels
-- Date: 2026-03-15

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Contacts (customers / senders)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email           TEXT,
    name            TEXT,
    phone           TEXT,
    avatar_url      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',  -- shopify_customer_id, etc.
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_workspace ON contacts(workspace_id);
CREATE UNIQUE INDEX idx_contacts_workspace_email ON contacts(workspace_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_name ON contacts(workspace_id, name);

-- ══════════════════════════════════════════════════════════════
-- 2. Channels (communication channel linked to a connected account)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE channels (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
    type                TEXT NOT NULL,          -- 'email', 'chat', 'sms'
    name                TEXT NOT NULL,          -- 'support@store.com'
    is_active           BOOLEAN NOT NULL DEFAULT true,
    config              JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT channels_type_check CHECK (
        type IN ('email', 'chat', 'sms', 'whatsapp', 'form')
    )
);

CREATE INDEX idx_channels_workspace ON channels(workspace_id);

-- ══════════════════════════════════════════════════════════════
-- 3. Triggers
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
-- Migration: Conversations & Messages
-- Description: Core inbox model — conversations with messages and AI suggestions
-- Date: 2026-03-15

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Conversations
-- ══════════════════════════════════════════════════════════════
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES channels(id) ON DELETE SET NULL,
    contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
    assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
    subject         TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    priority        TEXT NOT NULL DEFAULT 'normal',
    category        TEXT,                          -- AI-classified category
    external_id     TEXT,                          -- Gmail thread ID, etc.
    last_message_at TIMESTAMPTZ,
    snoozed_until   TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conversations_status_check CHECK (
        status IN ('open', 'assigned', 'snoozed', 'resolved', 'closed')
    ),
    CONSTRAINT conversations_priority_check CHECK (
        priority IN ('urgent', 'high', 'normal', 'low')
    )
);

CREATE INDEX idx_conversations_workspace_status ON conversations(workspace_id, status);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conversations_channel ON conversations(channel_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_external ON conversations(workspace_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON conversations(workspace_id, last_message_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 2. Messages
-- ══════════════════════════════════════════════════════════════
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type     TEXT NOT NULL,              -- 'contact', 'agent', 'system', 'ai'
    sender_id       UUID,                       -- user.id for agents, contact.id for contacts
    direction       TEXT NOT NULL DEFAULT 'inbound',
    content_text    TEXT,                        -- plaintext body
    content_html    TEXT,                        -- rich HTML body
    external_id     TEXT,                        -- Gmail message ID, etc.
    metadata        JSONB NOT NULL DEFAULT '{}', -- headers, cc, bcc, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_sender_type_check CHECK (
        sender_type IN ('contact', 'agent', 'system', 'ai')
    ),
    CONSTRAINT messages_direction_check CHECK (
        direction IN ('inbound', 'outbound')
    )
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_external ON messages(external_id) WHERE external_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 3. Message attachments
-- ══════════════════════════════════════════════════════════════
CREATE TABLE message_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    mime_type       TEXT,
    size_bytes      INTEGER,
    storage_key     TEXT,                        -- S3/MinIO key
    external_url    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_attachments_message ON message_attachments(message_id);

-- ══════════════════════════════════════════════════════════════
-- 4. AI suggestions (per conversation)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE ai_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,              -- 'reply', 'summary', 'classification'
    content         TEXT NOT NULL,              -- the AI-generated text
    confidence      REAL,                       -- 0.0 - 1.0
    model           TEXT,                       -- 'gpt-4o', 'claude-3.5', etc.
    accepted        BOOLEAN,                    -- true = agent used it
    accepted_by     UUID REFERENCES users(id),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ai_suggestions_type_check CHECK (
        type IN ('reply', 'summary', 'classification', 'sentiment')
    )
);

CREATE INDEX idx_ai_suggestions_conversation ON ai_suggestions(conversation_id);

-- ══════════════════════════════════════════════════════════════
-- 5. Conversation events (activity log)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE conversation_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id),
    event_type      TEXT NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conversation_events_type_check CHECK (
        event_type IN (
            'created', 'assigned', 'unassigned',
            'status_changed', 'priority_changed',
            'message_sent', 'message_received',
            'ai_suggestion', 'note_added',
            'snoozed', 'resolved', 'reopened'
        )
    )
);

CREATE INDEX idx_conversation_events_conversation ON conversation_events(conversation_id, created_at);

-- ══════════════════════════════════════════════════════════════
-- 6. Triggers
-- ══════════════════════════════════════════════════════════════
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-update last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_last_message
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

COMMIT;
-- 012: Store Google OAuth tokens per user for Gmail API access
-- These tokens allow us to read emails on behalf of the user

-- Add Google OAuth fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Allow password_hash to be null (Google-only users don't have a password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Index for Google login lookup
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
-- Migration 013: External Objects
-- Stores synced external data (Gmail threads, Shopify orders, etc.)

CREATE TABLE IF NOT EXISTS external_objects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,  -- 'gmail', 'shopify', etc.
  object_type   TEXT NOT NULL,  -- 'thread', 'order', 'customer', 'product'
  external_id   TEXT NOT NULL,  -- ID in the external system
  data          JSONB NOT NULL DEFAULT '{}',
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id, provider, object_type, external_id)
);

CREATE INDEX idx_external_objects_workspace ON external_objects(workspace_id);
CREATE INDEX idx_external_objects_provider ON external_objects(workspace_id, provider, object_type);
CREATE INDEX idx_external_objects_external_id ON external_objects(external_id);

-- Add Shopify env columns to .env support
-- Add sync_cursor to connected_accounts for incremental sync
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS sync_cursor TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
-- Migration: Workspace-level integration provider configs
-- Description: Allows workspace admins to configure their own app credentials
--              (e.g. Shopify client_id/secret) per integration provider.
-- Date: 2026-03-17

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Per-workspace provider configuration
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_provider_configs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id   TEXT NOT NULL REFERENCES integration_providers(id),
    config        JSONB NOT NULL DEFAULT '{}',
    configured_by UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(workspace_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_wpc_workspace ON workspace_provider_configs(workspace_id);

CREATE TRIGGER update_wpc_updated_at BEFORE UPDATE ON workspace_provider_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ══════════════════════════════════════════════════════════════
-- 2. Add description + icon columns to integration_providers
-- ══════════════════════════════════════════════════════════════
ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website     TEXT NOT NULL DEFAULT '';

-- ══════════════════════════════════════════════════════════════
-- 3. Update existing providers + seed new ones (re:amaze-style catalog)
-- ══════════════════════════════════════════════════════════════
UPDATE integration_providers SET
  description = 'Lees en verstuur e-mails vanuit je zakelijke Gmail-account.',
  icon = 'mail',
  website = 'https://mail.google.com'
WHERE id = 'gmail';

UPDATE integration_providers SET
  description = 'Zoek bestellingen en klantgegevens op vanuit je Shopify-winkel.',
  icon = 'shopping-bag',
  website = 'https://www.shopify.com',
  auth_type = 'api_key',
  config = '{"scopes": ["read_orders", "read_customers", "read_products"], "fields": [{"key": "shop_domain", "label": "Shop domein", "type": "text", "required": true, "placeholder": "jouw-winkel.myshopify.com"}, {"key": "access_token", "label": "Admin API Toegangstoken", "type": "password", "required": true, "placeholder": "shpat_..."}]}'
WHERE id = 'shopify';

-- New providers (not yet functional — shown as "binnenkort beschikbaar")
INSERT INTO integration_providers (id, name, category, auth_type, config, description, icon, website, is_active) VALUES
  ('slack',      'Slack',         'messaging', 'oauth2',  '{"scopes": ["channels:read","chat:write"], "fields": []}',     'Ontvang meldingen en stuur berichten naar Slack-kanalen.',                   'message-square', 'https://slack.com',                true),
  ('whatsapp',   'WhatsApp Business', 'messaging', 'api_key', '{"fields": [{"key": "phone_number_id", "label": "Telefoonnummer ID", "type": "text", "required": true}, {"key": "access_token", "label": "Access Token", "type": "password", "required": true}]}', 'Ontvang en beantwoord WhatsApp-berichten van klanten.', 'phone', 'https://business.whatsapp.com', true),
  ('woocommerce','WooCommerce',   'ecommerce', 'api_key', '{"fields": [{"key": "store_url", "label": "Winkel URL", "type": "text", "required": true, "placeholder": "https://jouwwinkel.nl"}, {"key": "consumer_key", "label": "Consumer Key", "type": "text", "required": true}, {"key": "consumer_secret", "label": "Consumer Secret", "type": "password", "required": true}]}', 'Zoek bestellingen en klantgegevens op vanuit je WooCommerce-winkel.', 'shopping-cart', 'https://woocommerce.com', true),
  ('notion',     'Notion',        'productivity', 'oauth2', '{"scopes": ["read_content"], "fields": []}', 'Synchroniseer kennisbank-artikelen vanuit Notion.',                          'book-open',       'https://www.notion.so',            true),
  ('hubspot',    'HubSpot',       'crm',       'oauth2',  '{"scopes": ["crm.objects.contacts.read"], "fields": []}', 'Synchroniseer contacten en deals vanuit HubSpot CRM.',                     'users',           'https://www.hubspot.com',          true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
