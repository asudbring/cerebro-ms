-- ============================================================================
-- 01-enable-pgvector.sql
-- Enable pgvector extension for vector similarity search
-- ============================================================================
-- Prerequisites:
--   The 'vector' extension must be added to the azure.extensions server
--   parameter allowlist in Azure Database for PostgreSQL Flexible Server
--   BEFORE running this migration.
--
--   Azure Portal → PostgreSQL server → Server parameters → azure.extensions
--   → Add 'vector' → Save
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
