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
