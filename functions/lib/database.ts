import pg from 'pg';
import { Thought, ThoughtMetadata, SearchResult, DigestChannel } from './types.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

export async function insertThought(
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata,
  fileUrl?: string,
  fileType?: string,
  sourceMessageId?: string
): Promise<Thought> {
  const vectorStr = `[${embedding.join(',')}]`;
  const result = await getPool().query(
    `INSERT INTO thoughts (content, embedding, metadata, file_url, file_type, source_message_id)
     VALUES ($1, $2::vector, $3, $4, $5, $6)
     RETURNING id, content, metadata, status, file_url, file_type, source_message_id, created_at, updated_at`,
    [content, vectorStr, JSON.stringify(metadata), fileUrl || null, fileType || null, sourceMessageId || null]
  );
  return result.rows[0] as Thought;
}

export async function searchThoughts(
  queryEmbedding: number[],
  options?: { threshold?: number; count?: number; status?: string }
): Promise<SearchResult[]> {
  const threshold = options?.threshold ?? 0.5;
  const count = options?.count ?? 10;
  const status = options?.status ?? null;
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const result = await getPool().query(
    `SELECT * FROM match_thoughts($1::vector, $2, $3, $4)`,
    [vectorStr, threshold, count, status]
  );
  return result.rows as SearchResult[];
}

export async function browseThoughts(options?: {
  type?: string;
  topic?: string;
  person?: string;
  days?: number;
  status?: string;
  hasFile?: boolean;
  limit?: number;
}): Promise<Thought[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  const status = options?.status ?? 'open';
  conditions.push(`status = $${paramIndex++}`);
  params.push(status);

  if (options?.type) {
    conditions.push(`metadata->>'type' = $${paramIndex++}`);
    params.push(options.type);
  }
  if (options?.topic) {
    conditions.push(`metadata->'topics' @> $${paramIndex++}::jsonb`);
    params.push(JSON.stringify([options.topic]));
  }
  if (options?.person) {
    conditions.push(`metadata->'people' @> $${paramIndex++}::jsonb`);
    params.push(JSON.stringify([options.person]));
  }
  if (options?.days) {
    conditions.push(`created_at > now() - $${paramIndex++}::interval`);
    params.push(`${options.days} days`);
  }
  if (options?.hasFile) {
    conditions.push(`file_url IS NOT NULL`);
  }

  const limit = options?.limit ?? 20;
  const whereClause= conditions.join(' AND ');
  const result = await getPool().query(
    `SELECT id, content, metadata, status, file_url, file_type, source_message_id, created_at, updated_at
     FROM thoughts
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex}`,
    [...params, limit]
  );
  return result.rows as Thought[];
}

export async function getStats(): Promise<{
  total: number;
  types: Record<string, number>;
  topics: Record<string, number>;
  people: Record<string, number>;
  recentCount: number;
}> {
  const db = getPool();

  const [totalRes, typesRes, topicsRes, peopleRes, recentRes] = await Promise.all([
    db.query(`SELECT count(*)::int AS total FROM thoughts WHERE status = 'open'`),
    db.query(
      `SELECT metadata->>'type' AS type, count(*)::int AS count
       FROM thoughts WHERE status = 'open' AND metadata->>'type' IS NOT NULL
       GROUP BY metadata->>'type' ORDER BY count DESC`
    ),
    db.query(
      `SELECT topic, count(*)::int AS count
       FROM thoughts, jsonb_array_elements_text(metadata->'topics') AS topic
       WHERE status = 'open'
       GROUP BY topic ORDER BY count DESC`
    ),
    db.query(
      `SELECT person, count(*)::int AS count
       FROM thoughts, jsonb_array_elements_text(metadata->'people') AS person
       WHERE status = 'open'
       GROUP BY person ORDER BY count DESC`
    ),
    db.query(
      `SELECT count(*)::int AS count FROM thoughts
       WHERE status = 'open' AND created_at > now() - interval '7 days'`
    ),
  ]);

  const types: Record<string, number> = {};
  for (const row of typesRes.rows) types[row.type] = row.count;

  const topics: Record<string, number> = {};
  for (const row of topicsRes.rows) topics[row.topic] = row.count;

  const people: Record<string, number> = {};
  for (const row of peopleRes.rows) people[row.person] = row.count;

  return {
    total: totalRes.rows[0].total,
    types,
    topics,
    people,
    recentCount: recentRes.rows[0].count,
  };
}

export async function updateThoughtStatus(
  id: string,
  status: 'open' | 'done' | 'deleted'
): Promise<Thought | null> {
  const result = await getPool().query(
    `UPDATE thoughts SET status = $1 WHERE id = $2
     RETURNING id, content, metadata, status, file_url, file_type, source_message_id, created_at, updated_at`,
    [status, id]
  );
  return (result.rows[0] as Thought) || null;
}

export async function findClosestThought(
  queryEmbedding: number[],
  status: string
): Promise<SearchResult | null> {
  const results = await searchThoughts(queryEmbedding, {
    threshold: 0.3,
    count: 1,
    status,
  });
  return results.length > 0 ? results[0] : null;
}

export async function getDigestChannels(): Promise<DigestChannel[]> {
  const result = await getPool().query(
    `SELECT id, source, teams_service_url, teams_conversation_id, teams_user_name, enabled, last_digest_at, created_at
     FROM digest_channels WHERE enabled = true`
  );
  return result.rows as DigestChannel[];
}

export async function upsertDigestChannel(
  source: string,
  data: {
    teams_service_url?: string;
    teams_conversation_id?: string;
    teams_user_name?: string;
  }
): Promise<DigestChannel> {
  const result = await getPool().query(
    `INSERT INTO digest_channels (source, teams_service_url, teams_conversation_id, teams_user_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source, teams_conversation_id)
     DO UPDATE SET teams_service_url = EXCLUDED.teams_service_url,
                   teams_user_name = EXCLUDED.teams_user_name
     RETURNING id, source, teams_service_url, teams_conversation_id, teams_user_name, enabled, last_digest_at, created_at`,
    [source, data.teams_service_url || null, data.teams_conversation_id || null, data.teams_user_name || null]
  );
  return result.rows[0] as DigestChannel;
}

export async function getThoughtsSince(since: Date): Promise<Thought[]> {
  const result = await getPool().query(
    `SELECT id, content, metadata, status, file_url, file_type, source_message_id, created_at, updated_at
     FROM thoughts
     WHERE status = 'open' AND created_at > $1
     ORDER BY created_at DESC`,
    [since.toISOString()]
  );
  return result.rows as Thought[];
}

export async function getCompletedThoughtsSince(since: Date): Promise<Thought[]> {
  const result = await getPool().query(
    `SELECT id, content, metadata, status, file_url, file_type, source_message_id, created_at, updated_at
     FROM thoughts
     WHERE status = 'done' AND updated_at > $1
     ORDER BY updated_at DESC`,
    [since.toISOString()]
  );
  return result.rows as Thought[];
}
