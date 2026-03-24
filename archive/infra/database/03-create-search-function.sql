-- Semantic search function.
-- Takes a query embedding and returns the most similar thoughts above a threshold.
--
-- Usage:
--   SELECT * FROM match_thoughts(query_embedding, 0.5, 10);
--
-- Parameters:
--   query_embedding  — 1536-dimensional vector from text-embedding-3-small
--   match_threshold  — minimum cosine similarity (0.0 to 1.0). Default 0.5.
--   match_count      — maximum number of results to return. Default 10.

CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id          UUID,
    content     TEXT,
    metadata    JSONB,
    similarity  float,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.metadata,
        1 - (t.embedding <=> query_embedding) AS similarity,
        t.created_at
    FROM thoughts t
    WHERE 1 - (t.embedding <=> query_embedding) > match_threshold
    ORDER BY t.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
