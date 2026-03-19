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
