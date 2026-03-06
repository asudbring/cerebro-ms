# Copilot Instructions for Open Brain (Microsoft Edition)

## Project Overview

A personal knowledge base built on Azure. Captures thoughts via Microsoft Teams, generates vector embeddings with Azure OpenAI, stores them in PostgreSQL with pgvector for semantic search, and exposes an MCP server so any AI assistant can search and write to the brain.

## Architecture

Four serverless functions (Azure Functions, TypeScript) connected to one database:

- **ingest-thought**: Power Automate HTTP POST → validate API key → embed + extract metadata in parallel → detect completion/reopen intent → insert to PostgreSQL → return reply JSON
- **open-brain-mcp**: MCP server with 4 tools (search_thoughts, browse_recent, brain_stats, capture_thought) → access key auth → query PostgreSQL
- **daily-digest**: HTTP GET → query last 24h thoughts + completed tasks → AI-generate summary → return JSON for Power Automate to post to Teams + email
- **weekly-digest**: HTTP GET → query last 7 days thoughts + completed tasks → AI-generate theme analysis → return JSON for Power Automate

Shared library in `lib/`:
- `azure-openai.ts` — embedding generation + metadata extraction via Azure OpenAI SDK
- `database.ts` — PostgreSQL connection pool + all queries (insert, search, browse, stats, mark done, reopen)
- `types.ts` — shared TypeScript interfaces

## Build and Deploy

```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript
npm run start        # local dev server (requires Azure Functions Core Tools)
func azure functionapp publish open-brain-func --node  # deploy to Azure
```

## Key Conventions

- **Embedding and metadata extraction run in parallel** (`Promise.all`). Both functions do this — never make them sequential.
- **The embedding is the primary retrieval mechanism.** Metadata (title, type, people, tags) is a convenience layer for browsing/filtering. Don't over-rely on metadata accuracy.
- **Power Automate handles Teams integration.** The "When a new channel message is added" trigger detects messages in a dedicated capture channel, "Get message details" fetches the body, HTTP action calls the function, reply action posts back as a reply (not a new message). No keyword trigger — every message in the channel is captured.
- **Loop guard in ingest-thought.** The function rejects messages that start with bot reply patterns (`**Captured**`, `✅ **Marked done`, `🔄 **Reopened`). This prevents infinite loops if Power Automate re-triggers on its own replies.
- **Digest summaries are truncated for Teams.** The `summary` field (markdown for Teams) is capped at ~24KB. If the full content exceeds this, the thought list is omitted from Teams and only included in the `summaryHtml` field for email.
- **Task completion uses semantic matching.** When `done:` prefix or AI-detected completion intent is found, the ingest function generates an embedding and searches for the closest open task by vector similarity.
- **Reopen uses the same pattern.** `reopen:` prefix triggers a search against done tasks.
- **Access key validation** on both ingest and MCP endpoints accepts both `x-brain-key` header and `?key=` query param. Always check both.
- **The vector dimension is 1536** (text-embedding-3-small). If you swap embedding models, update the dimension in `02-create-thoughts-table.sql`, `03-create-search-function.sql`, and the HNSW index.
- **SQL scripts in `infra/database/` are numbered and run sequentially** (01 through 05). They're idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`).
- **The thoughts table has a `status` column** — `'open'` (default) or `'done'`. Digests filter by status to separate active thoughts from completed tasks.
- **Environment variables** are documented in `.env.example`. Azure OpenAI uses deployment names (not model names).
- **Companion prompts in `prompts/` are numbered 01–05** and designed to be used in order. Prompts 1, 2, and 5 require the MCP server to be connected (they use `capture_thought`, `search_thoughts`, `browse_recent`). Prompt 4 is a reference doc, not an AI prompt.
