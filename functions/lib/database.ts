/**
 * PostgreSQL database helpers.
 *
 * Uses the pg library with a connection pool.
 * Requires env var: DATABASE_URL
 */

import pg from "pg";
import type { ThoughtRow, SearchResult, ThoughtMetadata, BrainStats } from "./types.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 10,
    });
  }
  return pool;
}

/**
 * Insert a new thought with its embedding and metadata.
 */
export async function insertThought(
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata,
  source: string = "teams"
): Promise<ThoughtRow> {
  const db = getPool();
  const result = await db.query<ThoughtRow>(
    `INSERT INTO thoughts (content, embedding, metadata)
     VALUES ($1, $2::vector, $3)
     RETURNING id, content, metadata, status, created_at, updated_at`,
    [content, JSON.stringify(embedding), { ...metadata, source }]
  );
  return result.rows[0];
}

/**
 * Semantic search using the match_thoughts function.
 */
export async function searchThoughts(
  queryEmbedding: number[],
  threshold: number = 0.5,
  limit: number = 10
): Promise<SearchResult[]> {
  const db = getPool();
  const result = await db.query<SearchResult>(
    `SELECT * FROM match_thoughts($1::vector, $2, $3)`,
    [JSON.stringify(queryEmbedding), threshold, limit]
  );
  return result.rows;
}

/**
 * Browse recent thoughts, optionally filtered by metadata type.
 */
export async function getRecentThoughts(
  limit: number = 20,
  typeFilter?: string
): Promise<ThoughtRow[]> {
  const db = getPool();

  if (typeFilter) {
    const result = await db.query<ThoughtRow>(
      `SELECT id, content, metadata, status, created_at, updated_at
       FROM thoughts
       WHERE metadata->>'type' = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [typeFilter, limit]
    );
    return result.rows;
  }

  const result = await db.query<ThoughtRow>(
    `SELECT id, content, metadata, status, created_at, updated_at
     FROM thoughts
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Get thoughts captured since a given date.
 */
export async function getThoughtsSince(since: Date): Promise<ThoughtRow[]> {
  const db = getPool();
  const result = await db.query<ThoughtRow>(
    `SELECT id, content, metadata, status, created_at, updated_at
     FROM thoughts
     WHERE created_at >= $1
     ORDER BY created_at ASC`,
    [since.toISOString()]
  );
  return result.rows;
}

/**
 * Mark a thought as done by ID.
 */
export async function markThoughtDone(id: string): Promise<ThoughtRow | null> {
  const db = getPool();
  const result = await db.query<ThoughtRow>(
    `UPDATE thoughts SET status = 'done', updated_at = NOW()
     WHERE id = $1
     RETURNING id, content, metadata, status, created_at, updated_at`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Search for open task-type thoughts by semantic similarity.
 */
export async function searchOpenTasks(
  queryEmbedding: number[],
  limit: number = 5
): Promise<SearchResult[]> {
  const db = getPool();
  const result = await db.query<SearchResult>(
    `SELECT id, content, metadata, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM thoughts
     WHERE status = 'open'
       AND metadata->>'type' = 'task'
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), limit]
  );
  return result.rows;
}

/**
 * Get recently completed thoughts within a time range, limited.
 */
export async function getCompletedThoughtsSince(
  since: Date,
  limit: number = 5
): Promise<ThoughtRow[]> {
  const db = getPool();
  const result = await db.query<ThoughtRow>(
    `SELECT id, content, metadata, status, created_at, updated_at
     FROM thoughts
     WHERE status = 'done'
       AND updated_at >= $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [since.toISOString(), limit]
  );
  return result.rows;
}

/**
 * Get brain stats overview.
 */
export async function getStats(): Promise<BrainStats> {
  const db = getPool();

  const countResult = await db.query<{ total: string; earliest: string; latest: string }>(
    `SELECT COUNT(*) as total,
            MIN(created_at) as earliest,
            MAX(created_at) as latest
     FROM thoughts`
  );

  const typesResult = await db.query<{ type: string; count: string }>(
    `SELECT metadata->>'type' as type, COUNT(*) as count
     FROM thoughts
     WHERE metadata->>'type' IS NOT NULL
     GROUP BY metadata->>'type'
     ORDER BY count DESC
     LIMIT 10`
  );

  const peopleResult = await db.query<{ person: string; count: string }>(
    `SELECT person, COUNT(*) as count
     FROM thoughts, jsonb_array_elements_text(metadata->'people') AS person
     GROUP BY person
     ORDER BY count DESC
     LIMIT 10`
  );

  const row = countResult.rows[0];
  return {
    total_thoughts: parseInt(row.total, 10),
    earliest: row.earliest,
    latest: row.latest,
    top_types: typesResult.rows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) })),
    top_people: peopleResult.rows.map((r) => ({ person: r.person, count: parseInt(r.count, 10) })),
  };
}
