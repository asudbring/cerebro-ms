-- Enable the pgvector extension for vector similarity search.
-- Run this first, before creating any tables that use the vector type.
--
-- On Azure Database for PostgreSQL Flexible Server:
--   pgvector is a supported extension — just run this command.
--   No need to install anything manually.
--
-- Reference: https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-use-pgvector

CREATE EXTENSION IF NOT EXISTS vector;
