# AGENTS.md

## What This Is
Cerebro (Microsoft Edition) — a personal knowledge base on Azure. Microsoft Teams messages and MCP client inputs are captured via Azure Functions, embedded with Azure OpenAI, stored in PostgreSQL (pgvector), and retrieved via an MCP server proxied through APIM with Entra ID OAuth.

## Commands
All commands run from the `functions/` directory:
```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript (tsc) → dist/
npm run watch        # compile in watch mode
npm run start        # local dev server (requires Azure Functions Core Tools)
func azure functionapp publish cerebro-func --node  # deploy to Azure
```

**There is no test suite or linter.** Do not attempt `npm test` or `npm run lint`.

## Architecture
Entry point: `functions/app.ts` — imports all function modules which self-register via `app.http()` / `app.timer()` (Azure Functions v4 pattern).

Four function groups:
| File | Route/Trigger | Purpose |
|------|--------------|---------|
| `cerebro-mcp/index.ts` | POST/GET/DELETE `/api/cerebro-mcp` | MCP server with 7 tools via Streamable HTTP |
| `cerebro-teams/index.ts` | POST `/api/cerebro-teams` | Teams bot webhook: capture, task mgmt, files |
| `cerebro-digest/index.ts` | Timer 6AM daily / noon Sunday | AI digest summaries delivered to Teams |
| `cerebro-digest/index.ts` | GET `/api/daily-digest`, `/api/weekly-digest` | Manual digest triggers |

Shared library (`functions/lib/`):
- `azure-ai.ts` — Azure OpenAI REST API (embeddings, metadata extraction, vision)
- `database.ts` — PostgreSQL with pg, all queries parameterized
- `blob-storage.ts` — Azure Blob Storage uploads + SAS URLs
- `calendar.ts` — Graph API calendar events with token caching
- `auth.ts` — Bot Framework JWT validation via jose
- `types.ts` — Shared TypeScript interfaces

## Key Conventions
- **Embedding + metadata extraction always run in parallel** (`Promise.all`)
- **Azure OpenAI uses direct fetch()** to REST API, not SDK classes
- **Day-of-week + Central Time** injected into metadata prompt for relative date resolution
- **Loop guard** on Teams: reject messages starting with bot reply prefixes
- **`(server as any).tool()`** for MCP tool registration to avoid TS2589 deep type inference
- **SQL migrations** in `infra/database/` are numbered and idempotent
- **Token caching** in calendar.ts and Teams bot with 60s safety margin
- **pgvector dimension is 1536** (text-embedding-3-small)
- **APIM handles MCP OAuth** — the MCP function uses anonymous auth
- **Bot Framework JWT** validation in auth.ts for Teams webhook

## Environment Variables
See `.env.example` for all required variables. Key groups:
- `AZURE_OPENAI_*` — endpoint, key, deployment names
- `DATABASE_URL` — PostgreSQL connection string
- `AZURE_STORAGE_CONNECTION_STRING` — Blob Storage
- `GRAPH_*` — Microsoft Graph API credentials
- `TEAMS_BOT_*` — Bot Framework app ID and secret
- `MCP_ACCESS_KEY` — MCP endpoint auth (used by APIM policy)
