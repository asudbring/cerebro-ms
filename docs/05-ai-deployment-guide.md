# AI Deployment Guide — Cerebro Microsoft Edition

## Purpose

This document contains everything an AI coding assistant (GitHub Copilot, Claude Code, Cursor, etc.) needs to deploy Cerebro from scratch. Feed this entire document as context to your AI.

---

## What You're Deploying

A personal knowledge base on Azure that captures thoughts from MCP clients and Microsoft Teams, embeds them with Azure OpenAI, stores in PostgreSQL with pgvector, and delivers AI-powered digest summaries.

**Components:**
- 4 Azure Function groups (MCP server, Teams bot, digest, OAuth)
- PostgreSQL with pgvector extension for semantic search
- Azure OpenAI for embeddings + chat completions
- Azure Blob Storage for file attachments
- Azure Communication Services for email digests (optional)
- Teams bot for capture + proactive digest (optional)

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ MCP Clients │────▶│ Azure Functions  │────▶│ PostgreSQL      │
│ Teams Bot   │────▶│ (4 groups)       │────▶│ (pgvector)      │
└─────────────┘     └──────────────────┘     └─────────────────┘
                           │                        │
                    ┌──────┴──────┐          ┌──────┴──────┐
                    │ Azure OpenAI│          │ Blob Storage│
                    │ ACS Email   │          │ (files)     │
                    └─────────────┘          └─────────────┘
```

**Function groups:**
| Group | Route(s) | Purpose |
|-------|----------|---------|
| cerebro-mcp | `/cerebro-mcp` | MCP server — 7 tools, OAuth-protected |
| cerebro-teams | `/api/messages` | Teams bot — capture, tasks, files, digest registration |
| cerebro-digest | `/api/daily-digest`, `/api/weekly-digest` | Timer + HTTP triggers for digest generation |
| cerebro-oauth | `/oauth/*`, `/.well-known/*` | GitHub OAuth flow (6 endpoints) |

---

## Deployment Phases

Execute in order. Each phase depends on the previous.

1. Terraform infrastructure
2. Database migrations
3. GitHub OAuth App registration (**MANUAL — human must do this**)
4. Build and deploy function app
5. Set environment variables
6. Test MCP server
7. (Optional) Teams bot setup
8. (Optional) Email digest setup

---

## Phase 1: Terraform

```bash
cd infra/terraform
# Human provides terraform.tfvars
terraform init
terraform plan
terraform apply
```

### Key Terraform variables that MUST be globally unique

- `postgresql_server_name`
- `function_app_name`
- `openai_account_name`
- `storage_account_name`

If names conflict, append a random suffix (e.g., `cerebro-abc123-db`).

### Common issues

- **APIM Developer tier** takes 30–45 minutes to provision. Be patient.
- **OpenAI model availability** varies by region. `eastus2` is reliable for `text-embedding-3-small` + `gpt-4o-mini` + `gpt-4o`.
- **Name conflicts:** Names like `cerebro-db`, `cerebro-func` are often taken — use unique prefixes.
- **Quota limits:** If you hit OpenAI quota errors during Terraform, request a quota increase or reduce TPM in the Terraform config.

### Terraform outputs you'll need later

After `terraform apply`, capture these values:
```bash
terraform output -raw postgresql_fqdn       # DB hostname
terraform output -raw function_app_name      # Function app name
terraform output -raw openai_endpoint        # Azure OpenAI endpoint
terraform output -raw storage_connection     # Blob storage connection string
```

---

## Phase 2: Database

### Step 2a: Enable pgvector extension

Enable pgvector in Azure Portal **FIRST** — this cannot be done via SQL alone on Azure:

1. Azure Portal → PostgreSQL Flexible Server → Server parameters
2. Search for `azure.extensions`
3. Add `VECTOR` to the list
4. Save (server may restart)

### Step 2b: Run migrations in order

Run the SQL migration files **in order**:

```
infra/database/01-enable-pgvector.sql
infra/database/02-create-thoughts-table.sql
infra/database/03-create-search-function.sql
infra/database/04-create-digest-channels.sql
```

Using psql:
```bash
export DATABASE_URL="postgresql://cerebroadmin:PASSWORD@DB-NAME.postgres.database.azure.com:5432/cerebro?sslmode=require"

psql "$DATABASE_URL" -f infra/database/01-enable-pgvector.sql
psql "$DATABASE_URL" -f infra/database/02-create-thoughts-table.sql
psql "$DATABASE_URL" -f infra/database/03-create-search-function.sql
psql "$DATABASE_URL" -f infra/database/04-create-digest-channels.sql
```

### If psql is unavailable (common on Windows)

Use Node.js with the `pg` module:

```javascript
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const files = [
  '01-enable-pgvector.sql',
  '02-create-thoughts-table.sql',
  '03-create-search-function.sql',
  '04-create-digest-channels.sql'
];

(async () => {
  for (const f of files) {
    const sql = fs.readFileSync(
      path.join(__dirname, 'infra', 'database', f), 'utf8'
    );
    console.log(`Running ${f}...`);
    await pool.query(sql);
    console.log(`  Done.`);
  }
  await pool.end();
  console.log('All migrations complete.');
})();
```

### Verification

```sql
-- Confirm pgvector is enabled
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Confirm thoughts table exists with correct vector dimension
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'thoughts' ORDER BY ordinal_position;

-- Confirm search function exists
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'search_thoughts';
```

---

## Phase 3: GitHub OAuth (HUMAN REQUIRED)

**Tell the human:**

1. Go to https://github.com/settings/developers → **New OAuth App**
2. Application name: `Cerebro` (or any name)
3. Homepage URL: `https://FUNC-NAME.azurewebsites.net`
4. Authorization callback URL: `https://FUNC-NAME.azurewebsites.net/oauth/callback`
5. Click **Register application**
6. Copy **Client ID**
7. Click **Generate a new client secret** and copy it immediately

**Then set the values:**

```bash
az functionapp config appsettings set -n FUNC-NAME -g cerebro-rg --settings \
  GITHUB_CLIENT_ID="Ov23li..." \
  GITHUB_CLIENT_SECRET="..."
```

> **Why GitHub OAuth?** The MCP server uses GitHub OAuth for authentication. MCP clients (VS Code Copilot, Claude Desktop, etc.) authenticate via this flow. The OAuth endpoints in `cerebro-oauth/index.ts` handle the full authorization code grant flow.

---

## Phase 4: Build and Deploy

### Build

```bash
cd functions
npm install
npm run build
```

Verify the build succeeded:
```bash
ls dist/app.js  # Must exist — this is the entry point
```

### Deploy Option 1: Azure Functions Core Tools

```bash
func azure functionapp publish FUNC-NAME --node
```

### Deploy Option 2: Kudu ZIP Deploy

Use this if Core Tools fails (known bug with large `node_modules`):

```bash
# Create temp directory with only needed files
mkdir deploy-temp
cp -r dist node_modules host.json package.json deploy-temp/
cd deploy-temp

# Create zip
# On Windows (PowerShell):
Compress-Archive -Path * -DestinationPath deploy.zip
# On macOS/Linux:
zip -r deploy.zip .

# Get publishing credentials
az functionapp deployment list-publishing-credentials \
  -n FUNC-NAME -g cerebro-rg \
  --query "{user:publishingUserName, pass:publishingPassword}" -o json

# Deploy via Kudu
curl -X POST "https://FUNC-NAME.scm.azurewebsites.net/api/zipdeploy" \
  -u "USERNAME:PASSWORD" \
  --data-binary @deploy.zip \
  -H "Content-Type: application/zip"
```

### Critical deployment checks

- `package.json` **MUST** have `"main": "dist/app.js"` — without it, Azure Functions v4 can't find the entry point.
- `host.json` **MUST** have `"routePrefix": ""` — this allows `.well-known` OAuth routes to serve at root.
- The deployment package must stay under ~20MB for reliable upload.
- Do NOT include `.env`, `local.settings.json`, or `src/` in the deployment.

---

## Phase 5: Environment Variables

### ALL required environment variables

```bash
az functionapp config appsettings set -n FUNC-NAME -g cerebro-rg --settings \
  DATABASE_URL="postgresql://cerebroadmin:PASSWORD@DB-NAME.postgres.database.azure.com:5432/cerebro?sslmode=require" \
  AZURE_OPENAI_ENDPOINT="https://OPENAI-NAME.openai.azure.com" \
  AZURE_OPENAI_API_KEY="KEY" \
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small" \
  AZURE_OPENAI_CHAT_DEPLOYMENT="gpt-4o-mini" \
  AZURE_OPENAI_VISION_DEPLOYMENT="gpt-4o" \
  AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;..." \
  GITHUB_CLIENT_ID="Ov23li..." \
  GITHUB_CLIENT_SECRET="..." \
  WEBSITE_TIME_ZONE="Central Standard Time"
```

### Optional: Teams bot

```bash
az functionapp config appsettings set -n FUNC-NAME -g cerebro-rg --settings \
  TEAMS_BOT_APP_ID="..." \
  TEAMS_BOT_APP_SECRET="..." \
  GRAPH_TENANT_ID="..." \
  GRAPH_CLIENT_ID="..." \
  GRAPH_CLIENT_SECRET="..."
```

### Optional: Email digest

```bash
az functionapp config appsettings set -n FUNC-NAME -g cerebro-rg --settings \
  ACS_CONNECTION_STRING="endpoint=https://...;accesskey=..." \
  ACS_EMAIL_SENDER="DoNotReply@....azurecomm.net" \
  DIGEST_EMAIL_RECIPIENT="user@example.com"
```

### Environment variable reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string with `?sslmode=require` |
| `AZURE_OPENAI_ENDPOINT` | ✅ | Azure OpenAI resource endpoint URL |
| `AZURE_OPENAI_API_KEY` | ✅ | Azure OpenAI API key |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | ✅ | Deployment name for text-embedding-3-small |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | ✅ | Deployment name for gpt-4o-mini |
| `AZURE_OPENAI_VISION_DEPLOYMENT` | ✅ | Deployment name for gpt-4o (image analysis) |
| `AZURE_STORAGE_CONNECTION_STRING` | ✅ | Blob storage for file attachments |
| `GITHUB_CLIENT_ID` | ✅ | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | ✅ | GitHub OAuth App client secret |
| `WEBSITE_TIME_ZONE` | ✅ | `Central Standard Time` for timer triggers |
| `TEAMS_BOT_APP_ID` | ❌ | Entra ID app registration for Teams bot |
| `TEAMS_BOT_APP_SECRET` | ❌ | Bot app registration secret |
| `GRAPH_TENANT_ID` | ❌ | Tenant for Graph API calls (file downloads) |
| `GRAPH_CLIENT_ID` | ❌ | App registration for Graph API |
| `GRAPH_CLIENT_SECRET` | ❌ | Graph API app secret |
| `ACS_CONNECTION_STRING` | ❌ | Azure Communication Services for email |
| `ACS_EMAIL_SENDER` | ❌ | Verified sender email address |
| `DIGEST_EMAIL_RECIPIENT` | ❌ | Email recipient for digests |

---

## Phase 6: Test MCP Server

### Test OAuth discovery

```bash
# These should return JSON metadata
curl https://FUNC-NAME.azurewebsites.net/.well-known/oauth-protected-resource
curl https://FUNC-NAME.azurewebsites.net/.well-known/oauth-authorization-server
```

### Test with authentication

```bash
# If you have GitHub CLI, get a token:
TOKEN=$(gh auth token)

# Initialize MCP session
curl -X POST https://FUNC-NAME.azurewebsites.net/cerebro-mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'
# Should return server info with protocolVersion

# List available tools
curl -X POST https://FUNC-NAME.azurewebsites.net/cerebro-mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
# Should return 7 tools

# Capture a test thought
curl -X POST https://FUNC-NAME.azurewebsites.net/cerebro-mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"capture_thought","arguments":{"content":"Test thought from deployment verification"}},"id":3}'

# Search for the test thought
curl -X POST https://FUNC-NAME.azurewebsites.net/cerebro-mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_thoughts","arguments":{"query":"test deployment"}},"id":4}'
```

### Expected MCP tools (7 total)

| Tool | Description |
|------|-------------|
| `capture_thought` | Save a new thought |
| `search_thoughts` | Semantic search across all thoughts |
| `browse_recent` | List recent thoughts with optional filters |
| `cerebro_stats` | Get statistics (totals, types, topics) |
| `complete_task` | Mark a task as done (semantic match) |
| `reopen_task` | Reopen a completed task |
| `delete_thought` | Soft-delete a thought |

---

## Guard Rails for AI Deployers

### DO

- ✅ Run SQL migrations in order (01 → 04)
- ✅ Set ALL required environment variables before testing
- ✅ Use `(server as any).tool()` for MCP tool registration (avoids TS2589)
- ✅ Keep `package.json` `"main"` as `"dist/app.js"`
- ✅ Keep `host.json` `routePrefix` as empty string `""`
- ✅ Run embedding + metadata extraction in parallel (`Promise.all`)
- ✅ Enable pgvector in Azure Portal before running SQL migrations
- ✅ Verify `dist/app.js` exists after build, before deploying

### DO NOT

- ❌ Drop or alter existing database columns
- ❌ Commit secrets to source control
- ❌ Change the vector dimension (1536) without updating all 3 SQL files
- ❌ Remove the loop guard in `cerebro-teams` (prevents infinite message loops)
- ❌ Change `host.json` `routePrefix` (breaks OAuth `.well-known` routes)
- ❌ Install `pdf-parse` or `pdfjs-dist` (36MB, breaks deployment with size limit)
- ❌ Use model names instead of deployment names for Azure OpenAI
- ❌ Skip the `?sslmode=require` in `DATABASE_URL` (Azure PostgreSQL requires SSL)

---

## Key Technical Details

| Detail | Value |
|--------|-------|
| Vector dimension | 1536 (`text-embedding-3-small`) |
| Runtime | Azure Functions v4 (Node 18+) |
| Entry point | `functions/app.ts` → `dist/app.js` |
| Self-registration | Functions use `app.http()` / `app.timer()` |
| Route prefix | `""` (empty — critical for OAuth routes) |
| Timer timezone | `Central Standard Time` |
| Max deploy size | ~20MB for reliable upload |
| JWT validation | `jose` library for Bot Framework tokens |
| Email pattern | ACS `beginSend` / `pollUntilDone` |
| MCP transport | Hono HTTP with streamable JSON |

---

## File Structure Reference

```
functions/
├── app.ts                      # Entry point — imports all modules
├── cerebro-mcp/index.ts        # MCP server (7 tools, OAuth validation)
├── cerebro-teams/index.ts      # Teams bot (capture, tasks, files, digest registration)
├── cerebro-digest/index.ts     # Timer + HTTP triggers for digest
├── cerebro-oauth/index.ts      # 6 OAuth endpoints
├── lib/
│   ├── azure-ai.ts             # Azure OpenAI REST API
│   ├── database.ts             # PostgreSQL queries
│   ├── blob-storage.ts         # Azure Blob Storage
│   ├── email.ts                # ACS email
│   ├── github-oauth.ts         # GitHub OAuth helpers
│   ├── auth.ts                 # Bot Framework JWT
│   └── types.ts                # Shared interfaces
├── package.json                # Must have "main": "dist/app.js"
├── host.json                   # routePrefix: "" (critical!)
└── tsconfig.json
infra/
├── terraform/                  # All Azure resources
└── database/                   # 4 SQL migrations (run in order)
teams/
├── manifest.json               # Teams app manifest
├── color.png                   # 192×192 icon
└── outline.png                 # 32×32 icon
```

---

## Quick Checklist

Use this checklist to verify deployment is complete:

- [ ] Terraform applied successfully
- [ ] pgvector enabled in Azure Portal
- [ ] All 4 SQL migrations ran without errors
- [ ] GitHub OAuth App created, Client ID + Secret obtained
- [ ] `npm run build` succeeds, `dist/app.js` exists
- [ ] Function app deployed (Core Tools or Kudu ZIP)
- [ ] All required env vars set on function app
- [ ] `/.well-known/oauth-protected-resource` returns JSON
- [ ] `/.well-known/oauth-authorization-server` returns JSON
- [ ] MCP `initialize` returns server info
- [ ] MCP `tools/list` returns 7 tools
- [ ] `capture_thought` succeeds
- [ ] `search_thoughts` finds the captured thought
- [ ] (Optional) Teams bot responds to messages
- [ ] (Optional) Daily digest returns JSON with summary
- [ ] (Optional) Digest email received
