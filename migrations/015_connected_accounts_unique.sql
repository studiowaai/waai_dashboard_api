-- 015: Add unique constraint on connected_accounts for upsert support
-- Needed for ON CONFLICT (workspace_id, provider_id, label)

UPDATE connected_accounts SET label = '' WHERE label IS NULL;
ALTER TABLE connected_accounts ALTER COLUMN label SET DEFAULT '';
ALTER TABLE connected_accounts ALTER COLUMN label SET NOT NULL;
ALTER TABLE connected_accounts
  ADD CONSTRAINT IF NOT EXISTS uq_connected_accounts_ws_provider_label
  UNIQUE (workspace_id, provider_id, label);
