-- ============================================================================
-- 03-create-search-function.sql
-- Vector similarity search function for semantic thought retrieval
-- ============================================================================

-- match_thoughts: finds semantically similar thoughts using cosine similarity
-- Uses the HNSW index on the embedding column for fast approximate search
CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10,
    filter_status text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    status text,
    file_url text,
    file_type text,
    similarity float,
    created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.metadata,
        t.status,
        t.file_url,
        t.file_type,
        1 - (t.embedding <=> query_embedding) AS similarity,
        t.created_at
    FROM thoughts t
    WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    AND (filter_status IS NULL OR t.status = filter_status)
    ORDER BY t.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
