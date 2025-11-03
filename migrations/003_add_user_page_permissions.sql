-- Migration: Add per-user page permissions
-- Description: Adds page_permissions JSONB to users table to control visible pages
-- Date: 2025-11-03

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS page_permissions JSONB NULL;

-- Optional: basic check to ensure it's an array of strings (not enforced strictly)
-- No strict constraint added to keep flexibility.

COMMIT;

