-- Backfill data.preview from legacy preview column if needed
UPDATE approvals
SET data = jsonb_set(
    COALESCE(data, '{}'::jsonb),
    '{preview}',
    COALESCE(preview, '{}'::jsonb),
    true
)
WHERE preview IS NOT NULL
  AND (data->'preview') IS NULL;

-- Drop the legacy preview column
ALTER TABLE approvals
DROP COLUMN IF EXISTS preview;

