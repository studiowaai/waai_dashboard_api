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
