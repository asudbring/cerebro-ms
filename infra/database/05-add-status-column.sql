-- 05-add-status-column.sql
-- Adds a status column to the thoughts table for task completion tracking.
-- Status: 'open' (default) or 'done'

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status);
CREATE INDEX IF NOT EXISTS idx_thoughts_status_type ON thoughts (status, (metadata->>'type'));
