# Cerebro Setup Guide — Azure Edition

Complete guide to provisioning, configuring, and deploying Cerebro on Azure.
From zero to a working personal knowledge base in ~60 minutes.

---

## Before You Start

### Prerequisites

| Prerequisite | Why | How to Get |
|---|---|---|
| Azure subscription | All resources deployed here | [portal.azure.com](https://portal.azure.com) |
| Azure CLI | Infrastructure provisioning | `winget install Microsoft.AzureCLI` or `brew install azure-cli` |
| Terraform >= 1.5 | Infrastructure as code | [terraform.io/downloads](https://developer.hashicorp.com/terraform/downloads) |
| Node.js 20+ | Build function app | [nodejs.org](https://nodejs.org) |
| Azure Functions Core Tools v4 | Local dev + deployment | `npm i -g azure-functions-core-tools@4 --unsafe-perm true` |
| GitHub account | OAuth authentication for MCP | [github.com](https://github.com) |
| Git | Source control | [git-scm.com](https://git-scm.com) |

### Optional Prerequisites

| If you want... | You also need... |
|---|---|
| Teams bot capture | Microsoft 365 account, Teams admin access for sideloading |
| Email digests | Azure Communication Services (provisioned by Terraform) |
| File attachments | Azure Blob Storage (provisioned by Terraform) |
| Calendar reminders | Entra ID app registration with Graph API permissions |

### Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│ MCP Client  │────▶│              │────▶│ Azure Database for│
│ (VS Code,   │     │ Azure        │     │ PostgreSQL        │
│  Claude,    │     │ Functions    │     │ (pgvector)        │
│  ChatGPT)   │     │              │     └───────────────────┘
├─────────────┤     │ • cerebro-mcp│     ┌───────────────────┐
│ Microsoft   │────▶│ • cerebro-   │────▶│ Azure OpenAI      │
│ Teams       │     │   teams      │     │ (embeddings+chat) │
└─────────────┘     │ • cerebro-   │     └───────────────────┘
                    │   digest     │     ┌───────────────────┐
                    │ • cerebro-   │────▶│ Azure Blob Storage│
                    │   oauth      │     │ (file attachments)│
                    └──────────────┘     └───────────────────┘
                           │
                    ┌──────┴──────┐
                    │ ACS Email   │
                    │ (digests)   │
                    └─────────────┘
```

**Functions:**
- **cerebro-mcp** — MCP server with 7 tools (search, browse, stats, capture, complete, reopen, delete)
- **cerebro-teams** — Teams bot webhook: captures thoughts, handles `done:`/`reopen:`/`delete:` intents
- **cerebro-digest** — Daily and weekly AI-generated summaries via HTTP GET
- **cerebro-oauth** — GitHub OAuth 2.1 flow for MCP client authentication

### 📋 Credential Tracker

Copy this template somewhere safe. Fill in values as you complete each phase.

```
# Cerebro Credentials — KEEP SECRET

## Azure
Subscription ID: ___
Tenant ID: ___
Resource Group: cerebro-rg

## PostgreSQL
Host: ___.postgres.database.azure.com
Admin User: cerebroadmin
Admin Password: ___
Database: cerebro
DATABASE_URL: postgresql://cerebroadmin:___@___.postgres.database.azure.com:5432/cerebro?sslmode=require

## Azure OpenAI
Endpoint: https://___.openai.azure.com
API Key: ___
Embedding Deployment: text-embedding-3-small
Chat Deployment: gpt-4o-mini
Vision Deployment: gpt-4o

## GitHub OAuth App
Client ID: ___
Client Secret: ___
Callback URL: https://___.azurewebsites.net/oauth/callback

## Teams Bot
App ID: ___
App Secret: ___

## ACS Email
Connection String: ___
Sender Address: DoNotReply@___.azurecomm.net

## Function App
Name: ___
URL: https://___.azurewebsites.net
```

---

## Phase 1: Infrastructure (Terraform)

⏱️ ~20 minutes

### Step 1: Clone and Configure

```bash
git clone https://github.com/YOUR_USER/cerebro-ms.git
cd cerebro-ms/infra/terraform
```

Create `terraform.tfvars` with your values. Key variables from `variables.tf`:

```hcl
# Required — must be globally unique across Azure
postgresql_server_name = "cerebro-YOURNAME-db"
postgresql_admin_password = "YourStrongPassword123!"    # save this!
openai_account_name    = "cerebro-YOURNAME-openai"
function_app_name      = "cerebro-YOURNAME-func"
storage_account_name   = "cerebroYOURNAMEstor"          # lowercase, no hyphens

# Optional — defaults shown
location               = "centralus"
resource_group_name    = "cerebro-rg"
openai_location        = "eastus2"                      # OpenAI may need a different region
apim_publisher_email   = "you@example.com"              # required for APIM

# Entra ID tenant for app registrations
entra_tenant_id        = "your-tenant-id"

# Digest email recipient (optional)
digest_email_recipient = "you@example.com"
```

⚠️ **Storage account names** must be 3-24 characters, lowercase letters and numbers only — no hyphens or uppercase.

### Step 2: Login and Deploy

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION"

terraform init
terraform plan    # review what will be created
terraform apply   # type 'yes' to confirm
```

This creates:
- Resource Group
- PostgreSQL Flexible Server (with `cerebro` database)
- Azure OpenAI account + model deployments (text-embedding-3-small, gpt-4o-mini, gpt-4o)
- Storage Account + `cerebro-files` blob container
- Function App + App Service Plan (Consumption)
- Application Insights + Log Analytics Workspace
- APIM (Developer tier)
- Entra ID app registrations (MCP + Teams bot)
- ACS Email Service

⚠️ **APIM Developer tier can take 30+ minutes.** If it hangs, see [Troubleshooting](#troubleshooting).

### Step 3: Save Terraform Outputs

```bash
terraform output -json > ../terraform-outputs.json

# Key values to save — fill in your credential tracker:
terraform output function_app_url
terraform output postgresql_fqdn
terraform output -raw postgresql_database_url
terraform output openai_endpoint
terraform output -raw storage_connection_string
terraform output mcp_app_client_id
terraform output teams_bot_app_id
terraform output -raw acs_connection_string
terraform output acs_email_sender
```

### ✅ Verification Gate 1

| # | Test | Expected |
|---|------|----------|
| 1 | `az group show -n cerebro-rg` | Resource group exists |
| 2 | `az functionapp show -n YOUR-FUNC -g cerebro-rg` | Function app exists |
| 3 | `az postgres flexible-server show -n YOUR-DB -g cerebro-rg` | PostgreSQL running |
| 4 | `curl https://YOUR-FUNC.azurewebsites.net` | Returns default page |

---

## Phase 2: Database Setup

⏱️ ~5 minutes

### Step 1: Enable pgvector Extension

1. Open **Azure Portal** → your PostgreSQL Flexible Server
2. Go to **Server parameters**
3. Search for `azure.extensions`
4. Add `VECTOR` to the allowed list
5. Click **Save** and wait for the server to update

### Step 2: Run Migrations

There are 4 migration scripts that must run in order. Each is idempotent (safe to re-run).

**Option A: Using psql** (Mac/Linux or WSL)

```bash
export PGPASSWORD="your_password"
PGHOST="your-db.postgres.database.azure.com"

psql "host=$PGHOST port=5432 dbname=cerebro user=cerebroadmin sslmode=require" \
  -f infra/database/01-enable-pgvector.sql

psql "host=$PGHOST port=5432 dbname=cerebro user=cerebroadmin sslmode=require" \
  -f infra/database/02-create-thoughts-table.sql

psql "host=$PGHOST port=5432 dbname=cerebro user=cerebroadmin sslmode=require" \
  -f infra/database/03-create-search-function.sql

psql "host=$PGHOST port=5432 dbname=cerebro user=cerebroadmin sslmode=require" \
  -f infra/database/04-create-digest-channels.sql
```

**Option B: Node.js script** (Windows-friendly, no psql needed)

```bash
cd functions
npm install   # ensures pg is installed

# Set your connection string
# PowerShell:
$env:DATABASE_URL = "postgresql://cerebroadmin:PASSWORD@YOUR-DB.postgres.database.azure.com:5432/cerebro?sslmode=require"

# bash:
export DATABASE_URL="postgresql://cerebroadmin:PASSWORD@YOUR-DB.postgres.database.azure.com:5432/cerebro?sslmode=require"

node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const files = [
    '../infra/database/01-enable-pgvector.sql',
    '../infra/database/02-create-thoughts-table.sql',
    '../infra/database/03-create-search-function.sql',
    '../infra/database/04-create-digest-channels.sql'
  ];
  for (const f of files) {
    const sql = fs.readFileSync(f, 'utf8');
    await pool.query(sql);
    console.log('✅ ' + f);
  }
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
"
```

**Option C: Azure Data Studio / pgAdmin**

Connect with your credentials and run each `.sql` file in order from the `infra/database/` directory.

### ✅ Verification Gate 2

| # | Test | Expected |
|---|------|----------|
| 1 | `SELECT * FROM pg_extension WHERE extname = 'vector';` | pgvector installed |
| 2 | `SELECT count(*) FROM thoughts;` | Returns 0 (table exists) |
| 3 | `SELECT * FROM match_thoughts(ARRAY[0.1]::vector(1536), 0.5, 5);` | Empty result set, no error |
| 4 | `SELECT count(*) FROM digest_channels;` | Returns 0 (table exists) |

---

## Phase 3: GitHub OAuth App

⏱️ ~5 minutes

The MCP server uses GitHub OAuth for authentication. MCP clients (VS Code, Claude) authenticate by logging into GitHub.

### Step 1: Register OAuth App

1. Go to [github.com/settings/developers](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** `Cerebro`
   - **Homepage URL:** `https://YOUR-FUNC.azurewebsites.net`
   - **Authorization callback URL:** `https://YOUR-FUNC.azurewebsites.net/oauth/callback`
4. Click **Register application**
5. Copy the **Client ID** → save to credential tracker
6. Click **Generate a new client secret** → copy it immediately (you won't see it again)

### Step 2: Set Function App Settings

```bash
az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
  GITHUB_OAUTH_CLIENT_ID="your_client_id" \
  GITHUB_OAUTH_CLIENT_SECRET="your_client_secret"
```

⚠️ The environment variable names include `_OAUTH_` — don't drop it.

### ✅ Verification Gate 3

| # | Test | Expected |
|---|------|----------|
| 1 | `curl https://YOUR-FUNC.azurewebsites.net/.well-known/oauth-protected-resource` | JSON with `resource` URL |
| 2 | `curl https://YOUR-FUNC.azurewebsites.net/.well-known/oauth-authorization-server` | JSON with authorization/token endpoints |
| 3 | Open `https://YOUR-FUNC.azurewebsites.net/oauth/authorize?redirect_uri=http://localhost&state=test` in browser | Redirects to GitHub login |

---

## Phase 4: Build and Deploy Function App

⏱️ ~10 minutes

### Step 1: Build

```bash
cd functions
npm install
npm run build    # compiles TypeScript → dist/
```

⚠️ There is no test suite or linter configured. `npm run build` (tsc) is the only validation step.

### Step 2: Deploy

**Option A: Azure Functions Core Tools** (recommended)

```bash
func azure functionapp publish YOUR-FUNC --node
```

**Option B: Kudu ZIP Deploy** (if Core Tools fails)

```powershell
# Windows PowerShell
$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; mkdir $_ }
Copy-Item dist, node_modules, host.json, package.json -Destination $tempDir -Recurse
Push-Location $tempDir
tar -cf deploy.zip -a *
Pop-Location

# Get deployment credentials
$creds = az functionapp deployment list-publishing-credentials `
  -n YOUR-FUNC -g cerebro-rg `
  --query "{user:publishingUserName, pass:publishingPassword}" -o json | ConvertFrom-Json
$pair = "$($creds.user):$($creds.pass)"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [System.Convert]::ToBase64String($bytes)

# Deploy
Invoke-RestMethod `
  -Uri "https://YOUR-FUNC.scm.azurewebsites.net/api/zipdeploy" `
  -Method POST `
  -Headers @{Authorization="Basic $base64"} `
  -InFile "$tempDir\deploy.zip" `
  -ContentType "application/zip"
```

### Step 3: Set All Environment Variables

```bash
az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
  DATABASE_URL="postgresql://cerebroadmin:PASSWORD@YOUR-DB.postgres.database.azure.com:5432/cerebro?sslmode=require" \
  AZURE_OPENAI_ENDPOINT="https://YOUR-OPENAI.openai.azure.com" \
  AZURE_OPENAI_API_KEY="your_openai_key" \
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small" \
  AZURE_OPENAI_CHAT_DEPLOYMENT="gpt-4o-mini" \
  AZURE_OPENAI_VISION_DEPLOYMENT="gpt-4o" \
  AZURE_STORAGE_CONNECTION_STRING="your_storage_conn_string" \
  GITHUB_OAUTH_CLIENT_ID="your_github_oauth_client_id" \
  GITHUB_OAUTH_CLIENT_SECRET="your_github_oauth_client_secret" \
  WEBSITE_TIME_ZONE="Central Standard Time"
```

⚠️ Use **deployment names** for Azure OpenAI, not model names. The defaults above match what Terraform provisions.

### ✅ Verification Gate 4

| # | Test | Expected |
|---|------|----------|
| 1 | `curl -s -o /dev/null -w "%{http_code}" -X POST https://YOUR-FUNC.azurewebsites.net/cerebro-mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"initialize","id":1}'` | `401` (auth required) |
| 2 | Authenticate via OAuth, then send `initialize` to `/cerebro-mcp` | Server info with `protocolVersion`, 7 tools listed |
| 3 | Call `capture_thought` tool via MCP with content `"Hello Cerebro"` | Thought saved, confirmation returned |
| 4 | Call `search_thoughts` tool for `"Hello Cerebro"` | Found with similarity score |

---

## Phase 5: Connect MCP Client

⏱️ ~2 minutes

### VS Code / GitHub Copilot

Add to your MCP configuration (`%APPDATA%\Code\User\mcp.json` on Windows, `~/.config/Code/User/mcp.json` on Mac/Linux):

```json
{
  "servers": {
    "cerebro": {
      "type": "http",
      "url": "https://YOUR-FUNC.azurewebsites.net/cerebro-mcp"
    }
  }
}
```

Reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window"). The OAuth flow starts automatically:

1. VS Code shows "Dynamic Client Registration not supported" → Click **Copy URIs & Proceed**
2. Enter your GitHub OAuth App **Client ID**
3. Browser opens → log in with GitHub → authorize the app
4. ✅ MCP server connects — 7 tools available in Copilot Chat

### Claude Desktop

Settings → MCP → Add Server → HTTP type → paste:
```
https://YOUR-FUNC.azurewebsites.net/cerebro-mcp
```

### Claude Code

```bash
claude mcp add cerebro --transport http https://YOUR-FUNC.azurewebsites.net/cerebro-mcp
```

### Available MCP Tools

Once connected, your AI client has access to these 7 tools:

| Tool | Purpose |
|------|---------|
| `search_thoughts` | Semantic similarity search across all thoughts |
| `list_thoughts` | Browse/filter by type, topic, person, time range, status |
| `thought_stats` | Aggregate stats: totals, type breakdown, top topics/people |
| `capture_thought` | Save a new thought (auto-embeds, extracts metadata) |
| `complete_task` | Mark a task as done via semantic matching |
| `reopen_task` | Reopen a completed task via semantic matching |
| `delete_task` | Soft-delete a thought via semantic matching |

---

## Phase 6: Teams Bot (Optional)

⏱️ ~15 minutes

The Teams bot lets you capture thoughts by posting messages in a Teams channel. Every message is automatically embedded, tagged, and stored.

### Quick Setup Summary

1. **Entra ID app registration** — already created by Terraform (see `teams_bot_app_id` output)
2. **Create Azure Bot resource** — link it to the Entra app registration
3. **Enable Teams channel** on the bot
4. **Set function app environment variables:**
   ```bash
   az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
     TEAMS_BOT_APP_ID="your_bot_app_id" \
     TEAMS_BOT_APP_SECRET="your_bot_app_secret" \
     TEAMS_BOT_TENANT_ID="your_tenant_id"
   ```
5. **Package the Teams app manifest** with bot icons
6. **Sideload** via Teams Admin Center or developer upload

⚠️ The bot uses a **loop guard** — it rejects messages starting with its own reply prefixes (`**Captured**`, `✅ **Marked done`, `🔄 **Reopened`) to prevent infinite re-trigger loops.

### Teams Message Intents

| Prefix | Action |
|--------|--------|
| *(none)* | Capture as a new thought |
| `done: <description>` | Semantically find and complete matching task |
| `reopen: <description>` | Semantically find and reopen matching task |
| `delete: <description>` | Semantically find and soft-delete matching thought |

---

## Phase 7: Email Digest (Optional)

⏱️ ~5 minutes

Email digests send AI-generated summaries of your recent thoughts to your inbox.

### Setup

1. **ACS is provisioned by Terraform** — get the connection string and sender from Terraform outputs:
   ```bash
   terraform output -raw acs_connection_string
   terraform output acs_email_sender
   ```

2. **Set function app environment variables:**
   ```bash
   az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
     ACS_CONNECTION_STRING="your_acs_connection_string" \
     ACS_EMAIL_SENDER="DoNotReply@your-domain.azurecomm.net" \
     DIGEST_EMAIL_RECIPIENT="you@example.com"
   ```

3. **Test the digest:**
   ```bash
   # Daily digest
   curl "https://YOUR-FUNC.azurewebsites.net/api/daily-digest"

   # Weekly digest
   curl "https://YOUR-FUNC.azurewebsites.net/api/weekly-digest"
   ```

### Digest Endpoints

| Endpoint | Scope | Reminders |
|----------|-------|-----------|
| `GET /api/daily-digest` | Last 24 hours | Next 48 hours |
| `GET /api/weekly-digest` | Last 7 days | Next 7 days |

⚠️ The `summary` field (Teams markdown) is capped at ~24KB. If content exceeds this, the full thought list is only included in the `summaryHtml` email field.

---

## Phase 8: Calendar Reminders (Optional)

⏱️ ~5 minutes

If a captured thought mentions a date or time (e.g., "Submit report by Friday"), Cerebro extracts it and can create an Outlook calendar event via Microsoft Graph.

### Setup

1. **Register an Entra ID app** (or reuse the Graph app from Terraform) with `Calendars.ReadWrite` application permission
2. **Grant admin consent** for the permission
3. **Set function app environment variables:**
   ```bash
   az functionapp config appsettings set -n YOUR-FUNC -g cerebro-rg --settings \
     GRAPH_TENANT_ID="your_tenant_id" \
     GRAPH_CLIENT_ID="your_graph_client_id" \
     GRAPH_CLIENT_SECRET="your_graph_client_secret" \
     CALENDAR_USER_EMAIL="you@yourdomain.com"
   ```

Reminders default to **09:00 Central Time** if only a date is given. The current day-of-week is passed to the AI so relative references like "next Wednesday" resolve correctly.

---

## Troubleshooting

### Common Issues

**Terraform: Name already taken**

Azure resource names must be globally unique. Add a personal prefix/suffix in `terraform.tfvars`:

```hcl
postgresql_server_name = "cerebro-yourname-db"
function_app_name     = "cerebro-yourname-func"
openai_account_name   = "cerebro-yourname-openai"
storage_account_name  = "cerebroyournamestor"
```

**Terraform: APIM hangs for 30+ minutes**

APIM Developer tier provisioning is notoriously slow. Options:
- Wait it out (can take up to 45 minutes)
- Use `terraform apply -target=...` to provision other resources first and handle APIM separately
- Provision APIM via Azure CLI instead

**`func publish` fails with "Value cannot be null"**

Known issue with Core Tools v4.x on some systems. Use the Kudu ZIP deploy method instead (see Phase 4, Option B).

**MCP: "Waiting for server to respond to initialize"**

The function app may be cold-starting (Azure Consumption plan). Wait 30-60 seconds and retry. If persistent:
```bash
# Check Application Insights for errors
az monitor app-insights query -g cerebro-rg --app YOUR-APPINSIGHTS \
  --analytics-query "exceptions | order by timestamp desc | take 10"
```

**OAuth: "Dynamic Client Registration not supported"**

This is expected behavior. VS Code shows this because Cerebro uses a pre-registered GitHub OAuth app. Click **Copy URIs & Proceed** and enter your Client ID.

**Database: "extension vector is not available"**

You need to allowlist the extension first:
1. Azure Portal → PostgreSQL Flexible Server → **Server parameters**
2. Search `azure.extensions` → add `VECTOR`
3. Click **Save** → wait for restart
4. Then re-run `01-enable-pgvector.sql`

**409 Conflict on ZIP deploy**

A previous deployment is stuck. Stop and restart the function app:

```bash
az functionapp stop -n YOUR-FUNC -g cerebro-rg
# Wait 30 seconds
az functionapp start -n YOUR-FUNC -g cerebro-rg
# Wait 30 seconds, then retry deploy
```

**"Cannot find module" errors after deploy**

Ensure `node_modules` is included in the deployment package. If using `func publish`, it handles this automatically. For ZIP deploy, verify the zip structure:

```
deploy.zip/
├── dist/          # compiled JavaScript
├── node_modules/  # dependencies
├── host.json      # Functions runtime config
└── package.json   # dependency manifest
```

**Embedding dimension mismatch**

The vector dimension is **1536** (text-embedding-3-small). If you change the embedding model, you must also update:
- `infra/database/02-create-thoughts-table.sql` — column definition
- `infra/database/03-create-search-function.sql` — function parameter
- Any HNSW index definitions

---

## Quick Reference

### Environment Variables Summary

| Variable | Required | Set In |
|----------|----------|--------|
| `DATABASE_URL` | ✅ | Phase 4 |
| `AZURE_OPENAI_ENDPOINT` | ✅ | Phase 4 |
| `AZURE_OPENAI_API_KEY` | ✅ | Phase 4 |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | ✅ | Phase 4 |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | ✅ | Phase 4 |
| `AZURE_OPENAI_VISION_DEPLOYMENT` | ✅ | Phase 4 |
| `AZURE_STORAGE_CONNECTION_STRING` | ✅ | Phase 4 |
| `GITHUB_OAUTH_CLIENT_ID` | ✅ | Phase 3 |
| `GITHUB_OAUTH_CLIENT_SECRET` | ✅ | Phase 3 |
| `WEBSITE_TIME_ZONE` | ✅ | Phase 4 |
| `TEAMS_BOT_APP_ID` | Teams only | Phase 6 |
| `TEAMS_BOT_APP_SECRET` | Teams only | Phase 6 |
| `TEAMS_BOT_TENANT_ID` | Teams only | Phase 6 |
| `TEAMS_ALLOWED_SENDERS` | Optional | Phase 6 |
| `GRAPH_TENANT_ID` | Reminders only | Phase 8 |
| `GRAPH_CLIENT_ID` | Reminders only | Phase 8 |
| `GRAPH_CLIENT_SECRET` | Reminders only | Phase 8 |
| `CALENDAR_USER_EMAIL` | Reminders only | Phase 8 |
| `ACS_CONNECTION_STRING` | Email only | Phase 7 |
| `ACS_EMAIL_SENDER` | Email only | Phase 7 |
| `DIGEST_EMAIL_RECIPIENT` | Email only | Phase 7 |

### Function Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/cerebro-mcp` | GET, POST | GitHub OAuth | MCP server (7 tools) |
| `/cerebro-teams` | POST | Bot Framework | Teams webhook |
| `/api/daily-digest` | GET | Function key | Daily AI summary |
| `/api/weekly-digest` | GET | Function key | Weekly AI summary |
| `/.well-known/oauth-protected-resource` | GET | None | OAuth discovery |
| `/.well-known/oauth-authorization-server` | GET | None | OAuth server metadata |
| `/oauth/authorize` | GET | None | Start OAuth flow |
| `/oauth/callback` | GET | None | GitHub OAuth callback |
| `/oauth/token` | POST | None | Exchange code for token |

### Useful Commands

```bash
# Build and deploy
cd functions && npm run build && func azure functionapp publish YOUR-FUNC --node

# Watch mode for local dev
cd functions && npm run start

# Check function app logs
az functionapp log tail -n YOUR-FUNC -g cerebro-rg

# Restart function app
az functionapp restart -n YOUR-FUNC -g cerebro-rg

# View all app settings
az functionapp config appsettings list -n YOUR-FUNC -g cerebro-rg -o table
```
