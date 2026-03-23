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
