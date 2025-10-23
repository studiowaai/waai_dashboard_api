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
