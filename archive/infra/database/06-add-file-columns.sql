-- 06: Add file storage columns to thoughts table
-- Supports storing references to files in Azure Blob Storage

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS file_type TEXT;
