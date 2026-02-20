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
