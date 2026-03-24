# AGENTS.md — Cerebro (Microsoft Edition)

> **This file is the canonical reference for AI coding agents** (GitHub Copilot, Claude Code,
> Cursor, Windsurf) working on this codebase. Read it before making any changes.
>
> ⚠️ **Deployer-Provided Configuration Required**
>
> This repo is a template — it contains **no hardcoded credentials, subscription IDs, tenant IDs, or personal information**. Before deploying, the user MUST provide:
>
> - Azure Subscription ID and Entra ID Tenant ID → `infra/terraform/providers.tf` + `terraform.tfvars`
> - Globally unique resource names (DB, Function App, OpenAI, Storage) → `terraform.tfvars`
> - PostgreSQL admin password → `terraform.tfvars`
> - GitHub OAuth App Client ID + Secret → function app settings
> - Teams bot App ID + Secret (optional) → function app settings
> - ACS email config (optional) → function app settings
>
> **ASK the user for these values. Do not guess or invent them.** See `docs/05-ai-deployment-guide.md` for the full AI deployment workflow.

---

## Project Overview

Cerebro is a personal knowledge base running on Azure. It captures thoughts from two sources
— Microsoft Teams messages and MCP client interactions — embeds them with Azure OpenAI,
stores them in PostgreSQL with pgvector for semantic search, and surfaces them via an MCP
server and AI-generated digest summaries.

**Tech stack:** Azure Functions v4, TypeScript, Node 18+, PostgreSQL + pgvector,
Azure OpenAI (text-embedding-3-small, gpt-4o-mini, gpt-4o), Azure Blob Storage,
Azure Communication Services (email), GitHub OAuth, Bot Framework.

---

## Build & Deploy

All commands run from the `functions/` directory:

```bash
cd functions
npm install          # install dependencies
npm run build        # compile TypeScript (tsc) → dist/
npm run watch        # compile in watch mode for development
npm run start        # local dev server (requires Azure Functions Core Tools v4; auto-builds via prestart)
```

### Deployment

```bash
# Primary method (may fail — see Known Issues #2)
func azure functionapp publish cerebro-func --node

# Fallback: Kudu ZIP deploy
# 1. Copy dist/, node_modules/, host.json, package.json to a temp directory
# 2. tar -cf deploy.zip .
# 3. POST to https://<app>.scm.azurewebsites.net/api/zipdeploy with Basic auth
```

> **⚠️ There is no test suite or linter configured.** Do not attempt `npm test` or `npm run lint`.

---

## Architecture

### Entry Point

`functions/app.ts` — imports all function modules, which self-register routes via `app.http()`
and `app.timer()` (Azure Functions v4 programming model).

### Function Groups

| File | Route / Trigger | Purpose |
|------|----------------|---------|
| `cerebro-mcp/index.ts` | POST/GET/DELETE `/cerebro-mcp` | MCP server: 7 tools via Streamable HTTP transport, GitHub OAuth validation |
| `cerebro-teams/index.ts` | POST `/cerebro-teams` | Teams bot webhook: capture thoughts, task management (`done:`/`reopen:`/`delete:`), file attachments via Graph API |
| `cerebro-digest/index.ts` | Timer: 6 AM daily, noon Sunday; HTTP: GET `/daily-digest`, GET `/weekly-digest` | AI-generated digest summaries delivered to Teams and email |
| `cerebro-oauth/index.ts` | GET `.well-known/*`, `/oauth/*` | 6 OAuth endpoints: RFC 9728/8414 discovery, authorize, callback, token exchange |

### Shared Library (`functions/lib/`)

| File | Purpose |
|------|---------|
| `azure-ai.ts` | Azure OpenAI REST API calls: embeddings (text-embedding-3-small, 1536 dimensions), metadata extraction (gpt-4o-mini), vision analysis (gpt-4o). Uses direct `fetch()`, not SDK classes. |
| `database.ts` | PostgreSQL connection pool via `pg`. All queries are parameterized. Exports: `insertThought`, `searchThoughts`, `browseThoughts`, `getStats`, `findClosestThought`, `updateThoughtStatus`, `getThoughtsSince`, `getCompletedThoughtsSince`, `getDigestChannels`, `registerDigestChannel` |
| `blob-storage.ts` | Azure Blob Storage uploads to `cerebro-files` container + SAS URL generation (1-year expiry) |
| `email.ts` | Azure Communication Services email delivery. Uses `beginSend`/`pollUntilDone` pattern. Exports: `sendDigestEmail`, `isEmailConfigured` |
| `github-oauth.ts` | GitHub OAuth helpers: `exchangeCodeForToken`, `validateGitHubToken` (calls `api.github.com/user`), `extractBearerToken`, `getProtectedResourceMetadata` (RFC 9728), `getAuthorizationServerMetadata` (RFC 8414), `isOAuthConfigured`, `getOAuthConfig`, `getBaseUrl` |
| `auth.ts` | Bot Framework JWT validation via `jose` library. Validates tokens issued by the Bot Connector service. |
| `types.ts` | Shared TypeScript interfaces: `Thought`, `ThoughtMetadata`, `DigestChannel`, `BrowseOptions`, `SearchOptions` |

### Data Flow

```text
Teams Message → Power Automate / Bot Framework → cerebro-teams
                                                      ↓
MCP Client (Copilot CLI, etc.) → cerebro-oauth → cerebro-mcp
                                                      ↓
                                            ┌─────────┴──────────┐
                                            │   Promise.all()    │
                                            ├────────────────────┤
                                            │ generateEmbedding  │
                                            │ extractMetadata    │
                                            └─────────┬──────────┘
                                                      ↓
                                              PostgreSQL + pgvector
                                                      ↓
                                            cerebro-digest (timer)
                                                      ↓
                                            Teams channel + Email
```

---

## Database Schema

### `thoughts` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `content` | `text` | Raw thought content |
| `embedding` | `vector(1536)` | text-embedding-3-small output |
| `metadata` | `jsonb` | `{title, type, people, topics, source, has_reminder, reminder_title, reminder_datetime}` |
| `status` | `text` | `'open'` (default), `'done'`, `'deleted'` |
| `file_url` | `text` | Azure Blob Storage SAS URL (nullable) |
| `file_type` | `text` | MIME type of attachment (nullable) |
| `source` | `text` | `'mcp'` or `'teams'` |
| `created_at` | `timestamptz` | Auto-set on insert |
| `updated_at` | `timestamptz` | Auto-updated via database trigger |

**Indexes:**

- HNSW on `embedding` (cosine distance) — primary search index
- GIN on `metadata` — JSON field queries
- B-tree on `status` — filter by open/done/deleted
- B-tree on `created_at` — time-range queries

### `digest_channels` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `channel_type` | `text` | `'teams'` |
| `channel_id` | `text` | Teams conversation reference (serialized JSON) |
| `created_at` | `timestamptz` | |

### `match_thoughts` function

```sql
match_thoughts(query_embedding vector(1536), match_threshold float, match_count int)
```

Returns thoughts with `similarity` score, ordered by similarity descending. Used by
`searchThoughts` in `database.ts`.

### SQL Migrations

Located in `infra/database/`, numbered 01–04. **Run in order.** All are idempotent
(`IF NOT EXISTS` / `CREATE OR REPLACE`).

| File | Purpose |
|------|---------|
| `01-enable-pgvector.sql` | Enable the pgvector extension |
| `02-create-thoughts-table.sql` | Create thoughts table with vector(1536) column |
| `03-create-search-function.sql` | Create `match_thoughts` search function |
| `04-create-digest-channels.sql` | Create digest_channels table |

---

## Authentication

### MCP Endpoint (GitHub OAuth)

The MCP endpoint validates GitHub OAuth tokens by calling `api.github.com/user`.
OAuth discovery follows RFC 9728 (Protected Resource Metadata) and RFC 8414
(Authorization Server Metadata).

**OAuth flow:** Client discovers metadata → redirects to GitHub authorize → callback
exchanges code for token → client uses Bearer token on MCP requests.

### Teams Endpoint (Bot Framework JWT)

The Teams endpoint validates JWT tokens issued by the Bot Connector service using
`jose` library. Token validation checks issuer, audience (bot app ID), and signing keys.

### Key Authentication Details

- MCP: GitHub OAuth Bearer token in `Authorization` header
- Teams: Bot Framework JWT in `Authorization` header
- Digest HTTP triggers: No auth (intended for internal/manual use)
- OAuth endpoints: Public (discovery) or session-based (authorize/callback)

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string with pgvector |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_API_KEY` | Yes | Azure OpenAI API key |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Yes | Deployment name for text-embedding-3-small |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Yes | Deployment name for gpt-4o-mini |
| `AZURE_OPENAI_VISION_DEPLOYMENT` | Yes | Deployment name for gpt-4o |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | Azure Blob Storage connection string |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `WEBSITE_TIME_ZONE` | Yes | Must be `"Central Standard Time"` for timer triggers |
| `TEAMS_BOT_APP_ID` | Teams | Entra ID app registration client ID |
| `TEAMS_BOT_APP_SECRET` | Teams | Entra ID app registration client secret |
| `GRAPH_TENANT_ID` | Teams files | Entra ID tenant ID for Graph API |
| `GRAPH_CLIENT_ID` | Teams files | Entra ID client ID (often same as TEAMS_BOT_APP_ID) |
| `GRAPH_CLIENT_SECRET` | Teams files | Entra ID client secret (often same as TEAMS_BOT_APP_SECRET) |
| `ACS_CONNECTION_STRING` | Email | Azure Communication Services connection string |
| `ACS_EMAIL_SENDER` | Email | Sender address (e.g., `DoNotReply@...azurecomm.net`) |
| `DIGEST_EMAIL_RECIPIENT` | Email | Recipient email for digest delivery |

> **Note:** Azure OpenAI uses **deployment names**, not model names. The deployment name
> is set when you deploy a model in the Azure OpenAI Studio.

---

## Key Conventions

### Parallel Processing

Embedding generation and metadata extraction **always run in parallel** via `Promise.all()`.
Never make them sequential — this is a core performance invariant.

### Loop Guard (Teams)

`cerebro-teams` rejects messages starting with bot reply prefixes to prevent infinite loops
when the bot's own replies trigger re-processing:

- `**Captured**`
- `✅ **Marked done`
- `🔄 **Reopened`
- `🗑️ **Deleted`

Any new capture source must implement a similar loop guard.

### MCP Tool Registration

Use `(server as any).tool()` instead of `server.tool()` to avoid TypeScript error TS2589
(deep type instantiation). This is caused by Zod v3/v4 schema inference interacting with
the MCP SDK's generic types.

### Task Management

- **`done:` prefix** → generates embedding → finds closest open task by vector similarity → marks it done
- **`reopen:` prefix** → generates embedding → finds closest done task → marks it open
- **`delete:` prefix** → generates embedding → finds closest open task → marks it deleted

### Reminder Extraction

The metadata extraction prompt includes the current datetime with day-of-week in Central Time
(e.g., `"Friday, 2026-03-06T19:28:00.000-06:00"`). This allows the AI to correctly resolve
relative date references like "next Monday" or "this Wednesday". Default time is 09:00 CT
when only a date is mentioned.

### Digest Delivery

- **Daily digest:** Timer fires at 6 AM CT. Queries last 24h thoughts + completed tasks + upcoming reminders (48h).
- **Weekly digest:** Timer fires at noon Sunday CT. Queries last 7 days + themes.
- **Summary cap:** The `summary` field (Teams markdown) is capped at ~24KB. If exceeded, the thought list is omitted but the AI summary is preserved.
- **Channels:** Digests are sent to all registered channels in `digest_channels` table + email if configured.

### File Attachments

- Files uploaded via Teams are stored in Azure Blob Storage (`cerebro-files` container)
- Images are analyzed by gpt-4o vision; DOCX files are parsed with `mammoth`
- Teams stores files on SharePoint with auth-protected URLs — downloads require Graph API client credentials (`Sites.Read.All` permission)
- The `contentType` from Teams is `"reference"` — actual MIME type is resolved from the file extension
- SAS URLs have 1-year expiry

### Route Configuration

`host.json` sets `routePrefix` to `""` (empty string) so OAuth `.well-known` routes serve at
the domain root. **Do not change this** — it will break all OAuth discovery.

### Package Size

The deployment package must stay under ~20MB for reliable deployment.
**Do not install** `pdf-parse` or `pdfjs-dist` (36MB combined).

---

## Guard Rails

### DO ✅

- Use parameterized queries for all database operations
- Run SQL migrations in order (01 → 04)
- Keep embedding + metadata extraction parallel (`Promise.all`)
- Test OAuth discovery endpoints after any route changes
- Use `(server as any).tool()` for MCP tool registration
- Include loop guard check in any new message capture source
- Use deployment names (not model names) for Azure OpenAI
- Keep the package under 20MB

### DO NOT ❌

- Change `host.json` `routePrefix` (breaks OAuth discovery)
- Remove `"main": "dist/app.js"` from `package.json` (deployment silently fails)
- Drop or alter existing database columns without a migration
- Commit secrets or credentials to source control
- Change vector dimension (1536) without updating all SQL files and indexes
- Install `pdf-parse` or `pdfjs-dist` (too large for deployment)
- Make embedding and metadata extraction sequential
- Use `server.tool()` directly (causes TS2589)

---

## Known Issues

| # | Issue | Workaround |
|---|-------|------------|
| 1 | **TS2589**: `McpServer.tool()` with Zod schemas causes infinite type recursion | Cast to `(server as any).tool()` |
| 2 | **func publish fails**: Core Tools v4.x sometimes errors with "Value cannot be null" | Use Kudu ZIP deploy (copy dist/, node_modules/, host.json, package.json → zip → POST to scm.azurewebsites.net/api/zipdeploy) |
| 3 | **Terraform APIM timeout**: APIM Developer tier makes `terraform plan` hang 30+ minutes | Use `-target` flags or provision APIM via Azure CLI |
| 4 | **ZIP deploy 409 Conflict**: Previous stuck deployment blocks new ones | Stop/start function app, wait 30 seconds, retry |

---

## Project Structure

```text
cerebro-ms/
├── AGENTS.md                          ← You are here
├── README.md                          ← User-facing project overview
├── functions/
│   ├── app.ts                         ← Entry point: imports all function modules
│   ├── package.json                   ← "main": "dist/app.js" (critical)
│   ├── tsconfig.json                  ← TypeScript configuration
│   ├── host.json                      ← routePrefix: "" (critical for OAuth)
│   ├── cerebro-mcp/index.ts           ← MCP server (7 tools, Streamable HTTP)
│   ├── cerebro-teams/index.ts         ← Teams bot webhook
│   ├── cerebro-digest/index.ts        ← Digest timer + HTTP triggers
│   ├── cerebro-oauth/index.ts         ← OAuth discovery + flow endpoints
│   └── lib/
│       ├── azure-ai.ts                ← Azure OpenAI: embed, extract, vision
│       ├── database.ts                ← PostgreSQL queries (all parameterized)
│       ├── blob-storage.ts            ← Blob uploads + SAS URLs
│       ├── email.ts                   ← ACS email delivery
│       ├── github-oauth.ts            ← GitHub OAuth + RFC 9728/8414
│       ├── auth.ts                    ← Bot Framework JWT validation
│       └── types.ts                   ← Shared interfaces
├── infra/
│   └── database/
│       ├── 01-enable-pgvector.sql
│       ├── 02-create-thoughts-table.sql
│       ├── 03-create-search-function.sql
│       └── 04-create-digest-channels.sql
├── docs/                              ← Additional documentation
└── teams/                             ← Teams app manifest and config
```

---

## MCP Server Tools

The MCP server (`cerebro-mcp/index.ts`) exposes 7 tools via Streamable HTTP:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `search_thoughts` | `query: string` | Semantic search across all thoughts using vector similarity |
| `browse_recent` | `limit?: number`, `type?: string`, `status?: string` | Browse thoughts with optional filters |
| `cerebro_stats` | *(none)* | Get counts and statistics about the knowledge base |
| `capture_thought` | `content: string` | Capture a new thought (embeds + extracts metadata) |
| `complete_task` | `description: string` | Mark the closest matching open task as done |
| `reopen_task` | `description: string` | Reopen the closest matching completed task |
| `delete_task` | `description: string` | Soft-delete the closest matching thought |

---

## Quick Reference for Common Tasks

### Adding a new MCP tool

1. Define the tool in `cerebro-mcp/index.ts` using `(server as any).tool()`
2. Add any new database queries to `database.ts` (parameterized)
3. Build and test locally: `npm run build && npm run start`

### Adding a new database column

1. Create a new numbered migration in `infra/database/` (e.g., `05-add-column.sql`)
2. Use `IF NOT EXISTS` or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for idempotency
3. Update `types.ts` if the column maps to a TypeScript interface
4. Update relevant queries in `database.ts`

### Adding a new function

1. Create a new directory under `functions/` (e.g., `cerebro-newfeature/index.ts`)
2. Self-register routes using `app.http()` or `app.timer()`
3. Import the module in `functions/app.ts`
4. Build: `npm run build`

### Debugging locally

1. Copy `.env.example` values into `functions/local.settings.json` under `"Values"`
2. Run `npm run start` (requires Azure Functions Core Tools v4)
3. Functions are available at `http://localhost:7071/`

### Deploying

1. Try `func azure functionapp publish cerebro-func --node`
2. If it fails with "Value cannot be null", use Kudu ZIP deploy:

   ```bash
   mkdir /tmp/deploy && cp -r dist node_modules host.json package.json /tmp/deploy/
   cd /tmp/deploy && zip -r deploy.zip .
   curl -X POST -u '<user>:<pass>' --data-binary @deploy.zip \
     https://cerebro-func.scm.azurewebsites.net/api/zipdeploy
   ```

3. If ZIP deploy returns 409, stop/start the function app and retry after 30 seconds
