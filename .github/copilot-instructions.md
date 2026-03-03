# Copilot Instructions for Open Brain (Microsoft Edition)

## Project Overview

A personal knowledge base built on Azure. Captures thoughts via Microsoft Teams, generates vector embeddings with Azure OpenAI, stores them in PostgreSQL with pgvector for semantic search, and exposes an MCP server so any AI assistant can search and write to the brain.

## Architecture

Two serverless functions (Azure Functions, TypeScript) connected to one database:

- **ingest-thought**: Teams Outgoing Webhook → validate HMAC → embed + extract metadata in parallel → insert to PostgreSQL → return reply JSON
- **open-brain-mcp**: MCP server with 4 tools (search_thoughts, browse_recent, brain_stats, capture_thought) → access key auth → query PostgreSQL

Shared library in `lib/`:
- `azure-openai.ts` — embedding generation + metadata extraction via Azure OpenAI SDK
- `database.ts` — PostgreSQL connection pool + all queries (insert, search, browse, stats)
- `types.ts` — shared TypeScript interfaces

## Build and Deploy

```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript
npm run start        # local dev server (requires Azure Functions Core Tools)
func azure functionapp publish open-brain-functions  # deploy to Azure
```

## Key Conventions

- **Embedding and metadata extraction run in parallel** (`Promise.all`). Both functions do this — never make them sequential.
- **The embedding is the primary retrieval mechanism.** Metadata (title, type, people, tags) is a convenience layer for browsing/filtering. Don't over-rely on metadata accuracy.
- **Teams Outgoing Webhooks are synchronous.** The function returns JSON and Teams displays it as a reply. No separate API call needed — this is different from Slack's async model.
- **Access key validation** on the MCP server accepts both `x-brain-key` header and `?key=` query param. Always check both.
- **The vector dimension is 1536** (text-embedding-3-small). If you swap embedding models, update the dimension in `02-create-thoughts-table.sql`, `03-create-search-function.sql`, and the IVFFlat index.
- **SQL scripts in `infra/database/` are numbered and run sequentially** (01 through 04). They're idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`).
- **Environment variables** are documented in `.env.example`. Azure OpenAI uses deployment names (not model names).
- **Companion prompts in `prompts/` are numbered 01–05** and designed to be used in order. Prompts 1, 2, and 5 require the MCP server to be connected (they use `capture_thought`, `search_thoughts`, `browse_recent`). Prompt 4 is a reference doc, not an AI prompt.
