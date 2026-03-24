# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Cerebro (Microsoft Edition) — a personal knowledge base on Azure. Microsoft Teams messages are captured via Power Automate → Azure Functions embeds them with Azure OpenAI → stored in PostgreSQL (pgvector) → retrieved via an MCP server by any AI client.

## Commands

All commands run from the `functions/` directory:

```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript (tsc) → dist/
npm run watch        # compile in watch mode
npm run start        # local dev server (requires Azure Functions Core Tools; auto-builds via prestart)
func azure functionapp publish cerebro-func --node  # deploy to Azure
```

**There is no test suite or linter.** Do not attempt `npm test` or `npm run lint`.

## Architecture

**Entry point:** `functions/app.ts` — imports all function modules, which self-register via `app.http()` (Azure Functions v4 pattern).

**Four serverless functions:**

| File | Route | Purpose |
|------|-------|---------|
| `functions/ingest-thought/index.ts` | POST `/api/ingest-thought` | Receives Power Automate webhook: validates key, downloads file attachments via Graph API, embeds + extracts metadata in parallel, detects `done:`/`reopen:` intent, extracts reminder datetime, inserts to DB, returns reply JSON |
| `functions/cerebro-mcp/index.ts` | GET/POST `/api/cerebro-mcp` | MCP server (Hono transport) exposing 4 tools: `search_thoughts`, `browse_recent`, `cerebro_stats`, `capture_thought` |
| `functions/digest/index.ts` | GET `/api/daily-digest`, `/api/weekly-digest` | Queries DB, generates AI summary, returns JSON for Power Automate to post to Teams + email |

**Shared library (`functions/lib/`):**

- `azure-openai.ts` — embedding generation + metadata extraction (title, type, people, tags) via Azure OpenAI SDK
- `database.ts` — PostgreSQL connection pool + all queries (insert, semantic search, browse, stats, mark done, reopen)
- `blob-storage.ts` — Azure Blob Storage uploads + SAS URL generation (`cerebro-files` container, 1-year expiry)
- `file-analysis.ts` — gpt-4o vision for images, mammoth for DOCX, basic PDF noting
- `types.ts` — shared TypeScript interfaces

## Key Conventions

**Access key auth:** Both ingest and MCP endpoints accept `x-brain-key` header **or** `?key=` query param. Ingest checks `INGEST_API_KEY` first, falls back to `MCP_ACCESS_KEY`.

**Loop guard:** `ingest-thought` rejects messages starting with bot reply prefixes (`**Captured**`, `✅ **Marked done`, `🔄 **Reopened`) to prevent Power Automate re-trigger loops.

**Vector dimension is 1536** (text-embedding-3-small). If swapping embedding models, update `infra/database/02-create-thoughts-table.sql`, `03-create-search-function.sql`, and the HNSW index.

**SQL scripts** in `infra/database/` are numbered 01–06 and must run in order. They are idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`).

**Reminder date resolution:** The current datetime is sent to the AI in Central Time including day-of-week (e.g. `Saturday, 2026-03-14 10:30 CT`) so relative references like "next Wednesday" resolve correctly.

**Digest truncation:** The `summary` field (Teams markdown) is capped at ~24KB. If content exceeds this, the thought list is omitted but the AI summary is preserved.

**Teams file downloads** use Microsoft Graph API client credentials (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`) with `Sites.Read.All`. The `contentType: "reference"` attachments from Teams require MIME type resolution from the file extension.

**Azure OpenAI uses deployment names, not model names** — set via `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`, `AZURE_OPENAI_CHAT_DEPLOYMENT`, `AZURE_OPENAI_VISION_DEPLOYMENT`.

## Environment Variables

See `.env.example` for all required variables. For local dev, copy to `functions/local.settings.json` under `Values`. Key variables:

```
AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY
AZURE_OPENAI_EMBEDDING_DEPLOYMENT / CHAT_DEPLOYMENT / VISION_DEPLOYMENT
DATABASE_URL
AZURE_STORAGE_CONNECTION_STRING
GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
MCP_ACCESS_KEY
INGEST_API_KEY  (optional; falls back to MCP_ACCESS_KEY)
```
