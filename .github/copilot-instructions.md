# Copilot Instructions for Cerebro (Microsoft Edition)

## Project Overview

A personal knowledge base built on Azure. Captures thoughts via Microsoft Teams, generates vector embeddings with Azure OpenAI, stores them in PostgreSQL with pgvector for semantic search, and exposes an MCP server so any AI assistant can search and write to the cerebro.

## Architecture

Azure Functions v4 (TypeScript, Node 18+). `functions/app.ts` is the entry point — it imports all function modules, which self-register routes via `app.http()`. Four serverless functions connected to one database:

- **ingest-thought**: Teams Bot webhook POST → validate Bot Framework JWT → process file attachments (download, blob upload, AI analysis) → embed + extract metadata in parallel → detect completion/reopen intent → extract reminder info → insert to PostgreSQL → send reply via Bot Framework API
- **cerebro-mcp**: MCP server with 7 tools (search_thoughts, list_thoughts, thought_stats, capture_thought, complete_task, reopen_task, delete_task) → APIM handles OAuth → query PostgreSQL
- **daily-digest**: Timer trigger 6 AM CT → query last 24h thoughts + completed tasks + upcoming reminders (48h) → AI-generate summary → deliver to Teams
- **weekly-digest**: Timer trigger Sunday noon CT → query last 7 days → AI-generate theme analysis → deliver to Teams

Shared library in `functions/lib/`:
- `azure-ai.ts` — embedding generation + metadata extraction via Azure OpenAI REST API (direct fetch, not SDK)
- `database.ts` — PostgreSQL connection pool + all queries (insert, search, browse, stats, mark done, reopen)
- `blob-storage.ts` — Azure Blob Storage upload + SAS URL generation for file attachments
- `calendar.ts` — Graph API calendar events with token caching
- `auth.ts` — Bot Framework JWT validation via jose
- `types.ts` — shared TypeScript interfaces

Key dependencies: `@azure/functions` v4 runtime, `openai` + `@azure/openai` for AI, `pg` for PostgreSQL, `@modelcontextprotocol/sdk` for MCP, `hono` for middleware, `jose` for JWT, `zod` for schema validation.

## Build and Deploy

```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript (tsc)
npm run watch        # compile in watch mode for development
npm run start        # local dev server (requires Azure Functions Core Tools)
func azure functionapp publish cerebro-func --node  # deploy to Azure
```

There is no test suite or linter configured. Do not attempt to run `npm test` or `npm run lint`.

## Key Conventions

- **Embedding and metadata extraction run in parallel** (`Promise.all`). Both the MCP and Teams functions do this — never make them sequential.
- **Azure OpenAI uses direct fetch()** to REST API (`api-version=2024-06-01`), not SDK classes. Uses `api-key` header auth.
- **The embedding is the primary retrieval mechanism.** Metadata (title, type, people, tags) is a convenience layer for browsing/filtering.
- **`(server as any).tool()`** for MCP tool registration to avoid TS2589 deep type inference with Zod schemas.
- **Loop guard in Teams bot.** The function rejects messages that start with bot reply patterns (`**Captured**`, `✅ **Marked done`, `🔄 **Reopened`).
- **Task completion uses semantic matching.** When `done:` prefix is detected, the function generates an embedding and searches for the closest open task by vector similarity.
- **Reminder extraction is AI-driven.** The metadata prompt includes day-of-week + Central Time for relative date resolution.
- **Token caching** for Bot Framework and Graph API tokens with 60-second safety margin before expiry.
- **Teams file downloads use Graph API client credentials** with Sites.Read.All permission.
- **APIM handles MCP OAuth** via `validate-azure-ad-token` policy — the MCP function itself uses anonymous auth.
- **The vector dimension is 1536** (text-embedding-3-small). If swapping models, update SQL migrations and HNSW index.
- **SQL scripts in `infra/database/` are numbered and run sequentially** (01 through 04). They're idempotent.
- **Environment variables** are documented in `.env.example`. Azure OpenAI uses deployment names (not model names).
