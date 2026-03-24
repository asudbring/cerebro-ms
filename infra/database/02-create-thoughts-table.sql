-- ============================================================================
-- 02-create-thoughts-table.sql
-- Core thoughts table, indexes, and auto-update trigger
-- ============================================================================

-- Thoughts table: stores captured thoughts with vector embeddings
CREATE TABLE IF NOT EXISTS thoughts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'open',
    file_url TEXT,
    file_type TEXT,
    source_message_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for fast approximate nearest-neighbor search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_thoughts_embedding
    ON thoughts USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- GIN index for JSONB metadata queries (type, tags, people filtering)
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata
    ON thoughts USING gin (metadata);

-- B-tree index for chronological browsing
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at
    ON thoughts (created_at DESC);

-- B-tree index for status filtering
CREATE INDEX IF NOT EXISTS idx_thoughts_status
    ON thoughts (status);

-- Composite index for filtered queries by status and thought type
CREATE INDEX IF NOT EXISTS idx_thoughts_status_type
    ON thoughts (status, ((metadata->>'type')));

-- Auto-update trigger for updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop and recreate trigger to ensure idempotency
-- (CREATE TRIGGER has no IF NOT EXISTS in PostgreSQL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_thoughts_updated_at'
    ) THEN
        CREATE TRIGGER update_thoughts_updated_at
            BEFORE UPDATE ON thoughts
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;
