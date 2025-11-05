-- Migration: Add n8n webhook URLs to organizations
-- Description: Adds columns for org-specific n8n webhook URLs for prompt processing
-- Date: 2025-11-05

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS n8n_transcribe_webhook_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS n8n_prompt_webhook_url TEXT NULL;

COMMENT ON COLUMN organizations.n8n_transcribe_webhook_url IS 'n8n webhook URL for voice transcription (optional)';
COMMENT ON COLUMN organizations.n8n_prompt_webhook_url IS 'n8n webhook URL for prompt processing workflow';

COMMIT;
