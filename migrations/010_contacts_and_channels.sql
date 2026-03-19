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
