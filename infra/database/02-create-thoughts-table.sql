-- Create the thoughts table.
-- Each row is one captured thought with its text, vector embedding, and metadata.

CREATE TABLE IF NOT EXISTS thoughts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content     TEXT NOT NULL,
    embedding   vector(1536),          -- text-embedding-3-small output dimension
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast vector similarity search (IVFFlat).
-- Tune the lists parameter based on row count: sqrt(num_rows) is a good starting point.
-- For < 10,000 rows, 100 lists is fine. Rebuild if your data grows significantly.
CREATE INDEX IF NOT EXISTS thoughts_embedding_idx
    ON thoughts
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Index for browsing recent thoughts efficiently.
CREATE INDEX IF NOT EXISTS thoughts_created_at_idx
    ON thoughts (created_at DESC);

-- Index for JSONB metadata filtering.
CREATE INDEX IF NOT EXISTS thoughts_metadata_idx
    ON thoughts
    USING gin (metadata);
