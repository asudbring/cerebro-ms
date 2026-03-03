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

-- Index for fast vector similarity search (HNSW).
-- HNSW works well from zero rows onward — no need to rebuild after loading data.
CREATE INDEX IF NOT EXISTS thoughts_embedding_idx
    ON thoughts
    USING hnsw (embedding vector_cosine_ops);

-- Index for browsing recent thoughts efficiently.
CREATE INDEX IF NOT EXISTS thoughts_created_at_idx
    ON thoughts (created_at DESC);

-- Index for JSONB metadata filtering.
CREATE INDEX IF NOT EXISTS thoughts_metadata_idx
    ON thoughts
    USING gin (metadata);
