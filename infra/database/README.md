# Database Migrations

SQL migration scripts for Cerebro's PostgreSQL database on Azure Database for PostgreSQL Flexible Server with pgvector.

## Prerequisites

Before running any migrations, enable the `vector` extension in your Azure PostgreSQL server:

1. **Azure Portal** → your PostgreSQL Flexible Server → **Server parameters**
2. Search for `azure.extensions`
3. Add `vector` to the allowlist
4. **Save** (may require a server restart)

## Migration Files

| File | Purpose |
|------|---------|
| `01-enable-pgvector.sql` | Enables the pgvector extension for vector similarity search |
| `02-create-thoughts-table.sql` | Creates the `thoughts` table, indexes (HNSW, GIN, B-tree), and auto-update trigger |
| `03-create-search-function.sql` | Creates the `match_thoughts` function for semantic vector search |
| `04-create-digest-channels.sql` | Creates the `digest_channels` table for Teams digest delivery tracking |

## Running Migrations

Migrations **must be run in order** (01 through 04). Connect to your Azure PostgreSQL instance and run each file sequentially:

```bash
# Set your connection string (adjust host, user, dbname as needed)
PGHOST="cerebro-db.postgres.database.azure.com"
PGUSER="cerebroadmin"
PGDB="cerebro"

# Run each migration in order
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 01-enable-pgvector.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 02-create-thoughts-table.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 03-create-search-function.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 04-create-digest-channels.sql
```

You will be prompted for the password each time. Set `PGPASSWORD` or use a `.pgpass` file to avoid repeated prompts.

## Idempotency

All migrations are **safe to re-run**. They use:

- `CREATE EXTENSION IF NOT EXISTS`
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- Conditional trigger creation via `DO` block

No destructive operations (DROP, TRUNCATE, unqualified DELETE) are used.

## Schema Notes

- **Vector dimension is 1536** — matches the `text-embedding-3-small` model. If you change embedding models, update the dimension in `02-create-thoughts-table.sql`, `03-create-search-function.sql`, and the HNSW index.
- **HNSW index** uses cosine distance (`vector_cosine_ops`) with `m=16, ef_construction=64` for a balance of build speed and recall.
- **Metadata JSONB** stores structured fields extracted by AI: `title`, `type`, `topics`, `people`, `action_items`, `has_reminder`, `reminder_title`, `reminder_datetime`, `has_file`, `file_name`, `file_description`, `source`.
- **Status values**: `open` (default), `done`, `deleted`.
