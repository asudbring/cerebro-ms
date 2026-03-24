# Cerebro — Setup & Deployment Guide

Complete guide to provisioning, configuring, and deploying Cerebro on Azure.

---

## 1. Prerequisites

Before starting, ensure you have:

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Azure subscription** | — | Owner or Contributor role required |
| **Azure CLI** | Latest | Logged in (`az login`) |
| **Terraform** | >= 1.5 | Manages all infrastructure |
| **Azure Functions Core Tools** | v4 | For local dev and deployment |
| **Node.js** | 18+ | Runtime for Azure Functions |
| **npm** | 9+ | Package manager |
| **psql** | Any | PostgreSQL client for running migrations |
| **Entra ID access** | — | Permission to create app registrations in your tenant |

Install Azure CLI and Functions Core Tools:

```bash
# Azure CLI
winget install Microsoft.AzureCLI        # Windows
brew install azure-cli                   # macOS

# Azure Functions Core Tools v4
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Terraform
winget install HashiCorp.Terraform       # Windows
brew install terraform                   # macOS
```

---

## 2. Infrastructure Provisioning (Terraform)

### 2.1 Clone and configure

```bash
git clone <your-repo-url>
cd cerebro-ms/infra/terraform
```

Edit `terraform.tfvars` with your values:

```hcl
location            = "centralus"
resource_group_name = "cerebro-rg"

# PostgreSQL
postgresql_server_name    = "cerebro-db"
postgresql_admin_username = "cerebroadmin"
# postgresql_admin_password — pass via -var flag (do NOT commit)

# Azure OpenAI (eastus2 for model availability)
openai_account_name = "cerebro-openai"
openai_location     = "eastus2"

# Storage (globally unique, lowercase, no hyphens)
storage_account_name = "cerebrostorage"

# Function App
function_app_name = "cerebro-func"

# API Management
apim_name            = "cerebro-apim"
apim_publisher_email = "you@example.com"
apim_publisher_name  = "Cerebro Admin"

# calendar_user_email — email for calendar reminder events
```

### 2.2 Cross-tenant provider setup

Cerebro uses a **dual-provider** configuration:

- **`azurerm`** — deploys Azure resources (resource group, PostgreSQL, OpenAI, Storage, Functions, APIM) into your Azure subscription.
- **`azuread`** — creates Entra ID app registrations in a (potentially different) Entra ID tenant.

This is defined in `providers.tf`:

```hcl
provider "azurerm" {
  subscription_id = "YOUR-AZURE-SUBSCRIPTION-ID"
  features {}
}

provider "azuread" {
  tenant_id = "YOUR-ENTRA-TENANT-ID"
}
```

Update the `subscription_id` and `tenant_id` in `providers.tf` to match your environment. If your Azure subscription and Entra ID tenant are the same, both will use the same tenant. If they differ (e.g., resources in a corporate subscription, app registrations in a lab tenant), the dual-provider setup handles this automatically — just ensure `az login` has access to both.

### 2.3 Deploy

```bash
terraform init
terraform plan -var="postgresql_admin_password=YOUR_SECURE_PASSWORD"
terraform apply -var="postgresql_admin_password=YOUR_SECURE_PASSWORD"
```

### 2.4 Resources created

Terraform provisions the following:

| Resource | Name | Region | Notes |
|----------|------|--------|-------|
| Resource Group | `cerebro-rg` | centralus | Contains all Azure resources |
| PostgreSQL Flexible Server | `cerebro-db` | centralus | v16, B_Standard_B1ms, 32 GB, pgvector allowlisted |
| PostgreSQL Database | `cerebro` | centralus | UTF8, en_US.utf8 collation |
| Azure OpenAI (Cognitive Services) | `cerebro-openai` | **eastus2** | S0 tier, custom subdomain |
| Storage Account | `cerebrostorage` | centralus | Standard LRS, TLS 1.2 |
| Storage Container | `cerebro-files` | centralus | Private access, for file attachments |
| App Service Plan | `cerebro-func-plan` | centralus | Windows, Consumption (Y1) |
| Function App | `cerebro-func` | centralus | Node 18, all app settings auto-configured |
| Log Analytics Workspace | `cerebro-func-logs` | centralus | 30-day retention |
| Application Insights | `cerebro-func-insights` | centralus | Connected to Log Analytics |
| API Management | `cerebro-apim` | centralus | **Developer_1** tier |
| Entra App: MCP Server | `Cerebro MCP Server` | Entra tenant | Single-tenant, `api://cerebro-mcp` |
| Entra App: Teams Bot | `Cerebro Teams Bot` | Entra tenant | Multi-tenant (Bot Framework requirement) |
| Entra App: Graph/Calendar | `Cerebro Calendar` | Entra tenant | Single-tenant, `Calendars.ReadWrite` |
| Firewall Rule | `AllowAzureServices` | — | Allows Azure services to connect to PostgreSQL |

> **⏱ APIM Developer tier takes 30–60 minutes to provision.** Plan accordingly — this is the longest step in `terraform apply`.

### 2.5 Terraform outputs

After apply, retrieve key values:

```bash
terraform output function_app_url
terraform output postgresql_fqdn
terraform output openai_endpoint
terraform output apim_gateway_url
terraform output mcp_app_client_id
terraform output teams_bot_app_id
terraform output graph_app_client_id

# Sensitive outputs
terraform output -raw postgresql_database_url
terraform output -raw storage_connection_string
```

---

## 3. Database Setup

### 3.1 Prerequisites

Before running migrations, verify that Terraform has allowlisted the `vector` extension. This is handled automatically by the `azurerm_postgresql_flexible_server_configuration.pgvector` resource. If you need to verify manually:

1. **Azure Portal** → PostgreSQL Flexible Server → **Server parameters**
2. Search for `azure.extensions`
3. Confirm `vector` is in the allowlist
4. Save if changed (may require a server restart)

### 3.2 Connect to PostgreSQL

```bash
psql "host=cerebro-db.postgres.database.azure.com port=5432 dbname=cerebro user=cerebroadmin sslmode=require"
```

You'll be prompted for the password. To avoid repeated prompts:

```bash
export PGPASSWORD="YOUR_PASSWORD"
```

### 3.3 Run migrations

From the `infra/database/` directory, run each migration **in order**:

```bash
cd infra/database

PGHOST="cerebro-db.postgres.database.azure.com"
PGUSER="cerebroadmin"
PGDB="cerebro"

psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 01-enable-pgvector.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 02-create-thoughts-table.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 03-create-search-function.sql
psql "host=$PGHOST port=5432 dbname=$PGDB user=$PGUSER sslmode=require" -f 04-create-digest-channels.sql
```

### 3.4 Verify

```sql
-- Check pgvector extension is installed
\dx
-- Should show: vector | 0.x.x | public | vector data type and ivfflat and hnsw access methods

-- Check tables exist
\dt
-- Should show: thoughts, digest_channels

-- Check search function exists
\df match_thoughts
```

All migrations are **idempotent** — safe to re-run at any time.

---

## 4. Azure OpenAI Model Deployments

Terraform creates three model deployments on the `cerebro-openai` account in **eastus2**:

| Deployment Name | Model | Version | Capacity | Purpose |
|----------------|-------|---------|----------|---------|
| `text-embedding-3-small` | text-embedding-3-small | 1 | 120K TPM | Vector embeddings (1536 dimensions) |
| `gpt-4o-mini` | gpt-4o-mini | 2024-07-18 | 30K TPM | Metadata extraction, digest summaries |
| `gpt-4o` | gpt-4o | 2024-11-20 | 30K TPM | Image/document vision analysis |

Verify deployments:

```bash
az cognitiveservices account deployment list \
  --name cerebro-openai \
  --resource-group cerebro-rg \
  --output table
```

> **Note:** Azure OpenAI is deployed to **eastus2** (not centralus) because model availability varies by region. This is controlled by the `openai_location` variable.

---

## 5. Entra ID Configuration

### 5.1 App registrations created by Terraform

| App Registration | Display Name | Audience | Purpose |
|-----------------|--------------|----------|---------|
| **cerebro-mcp** | Cerebro MCP Server | Single-tenant (`AzureADMyOrg`) | MCP server OAuth; exposes `api://cerebro-mcp` with `Thoughts.ReadWrite` scope; APIM validates tokens against this |
| **cerebro-teams-bot** | Cerebro Teams Bot | Multi-tenant (`AzureADMultipleOrgs`) | Teams bot identity (Bot Framework requires multi-tenant) |
| **cerebro-graph** | Cerebro Calendar | Single-tenant (`AzureADMyOrg`) | Graph API client credentials for calendar events and file downloads |

### 5.2 Post-Terraform manual steps

Terraform creates the app registrations and auto-generates secrets for the Teams Bot and Graph apps, but you still need to:

#### a) Retrieve client secrets from Terraform output or Entra portal

The Teams Bot and Graph app secrets are managed by Terraform (`azuread_application_password`). Retrieve them:

```bash
# These are sensitive — use -raw to get the actual values
terraform output -raw teams_bot_app_secret   # if exposed as output
```

Or navigate to **Entra ID → App registrations → [App] → Certificates & secrets** to view/create secrets.

#### b) Grant admin consent for Graph API permissions

The `cerebro-graph` app requests `Calendars.ReadWrite` as an application permission. An Entra ID admin must grant consent:

1. **Entra ID portal** → **App registrations** → **Cerebro Calendar**
2. Go to **API permissions**
3. Click **Grant admin consent for [your tenant]**
4. Confirm

> If you also need file download support (Teams attachments via SharePoint), add `Sites.Read.All` application permission and grant consent for it as well.

#### c) Register the Teams bot

1. Go to [Azure Portal](https://portal.azure.com) → **Create a resource** → **Azure Bot**
2. **Bot handle:** `cerebro-teams-bot`
3. **Type of App:** Multi Tenant
4. **Use existing app registration:** Yes — paste the `teams_bot_app_id` from Terraform output
5. **Messaging endpoint:** `https://cerebro-func.azurewebsites.net/api/cerebro-teams`
6. Under **Channels**, enable **Microsoft Teams**

---

## 6. Function App Deployment

### 6.1 Build

```bash
cd functions
npm install
npm run build
```

This compiles TypeScript to `dist/` via `tsc`.

### 6.2 Deploy to Azure

```bash
func azure functionapp publish cerebro-func --node
```

### 6.3 Configure environment variables

Most app settings are auto-configured by Terraform. The following **must be set manually** after deployment (Terraform marks them with comments):

```bash
# Teams Bot secret (from Entra app registration)
az functionapp config appsettings set \
  --name cerebro-func \
  --resource-group cerebro-rg \
  --settings "TEAMS_BOT_APP_SECRET=YOUR_TEAMS_BOT_SECRET"

# Graph API secret (from Entra app registration)
az functionapp config appsettings set \
  --name cerebro-func \
  --resource-group cerebro-rg \
  --settings "GRAPH_CLIENT_SECRET=YOUR_GRAPH_SECRET"

# Calendar user email (whose calendar gets reminder events)
az functionapp config appsettings set \
  --name cerebro-func \
  --resource-group cerebro-rg \
  --settings "CALENDAR_USER_EMAIL=you@example.com"

# Optional: restrict which Teams users can send messages
az functionapp config appsettings set \
  --name cerebro-func \
  --resource-group cerebro-rg \
  --settings "TEAMS_ALLOWED_SENDERS=aad-object-id-1,aad-object-id-2"
```

#### Complete environment variable reference

| Variable | Set By | Description |
|----------|--------|-------------|
| `FUNCTIONS_WORKER_RUNTIME` | Terraform | `node` |
| `WEBSITE_NODE_DEFAULT_VERSION` | Terraform | `~18` |
| `WEBSITE_TIME_ZONE` | Terraform | `Central Standard Time` (timer triggers use Central Time) |
| `APPINSIGHTS_INSTRUMENTATIONKEY` | Terraform | Application Insights key |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Terraform | Application Insights connection |
| `AZURE_OPENAI_ENDPOINT` | Terraform | `https://cerebro-openai.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | Terraform | Auto-populated from Cognitive Services |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Terraform | `text-embedding-3-small` |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Terraform | `gpt-4o-mini` |
| `AZURE_OPENAI_VISION_DEPLOYMENT` | Terraform | `gpt-4o` |
| `DATABASE_URL` | Terraform | PostgreSQL connection string |
| `AZURE_STORAGE_CONNECTION_STRING` | Terraform | Blob storage connection |
| `TEAMS_BOT_APP_ID` | Terraform | Teams bot client ID |
| `TEAMS_BOT_TENANT_ID` | Terraform | Entra tenant ID |
| `TEAMS_BOT_APP_SECRET` | **Manual** | Teams bot client secret |
| `GRAPH_TENANT_ID` | Terraform | Entra tenant ID |
| `GRAPH_CLIENT_ID` | Terraform | Graph app client ID |
| `GRAPH_CLIENT_SECRET` | **Manual** | Graph app client secret |
| `CALENDAR_USER_EMAIL` | **Manual** | Target calendar email address |
| `TEAMS_ALLOWED_SENDERS` | **Manual** (optional) | Comma-separated AAD Object IDs |

### 6.4 Verify endpoints

```bash
# MCP server (should return SSE or method-not-allowed for GET)
curl -X POST https://cerebro-func.azurewebsites.net/api/cerebro-mcp

# Teams bot endpoint (expects Bot Framework activity payload)
curl https://cerebro-func.azurewebsites.net/api/cerebro-teams

# Daily digest (manual trigger)
curl https://cerebro-func.azurewebsites.net/api/daily-digest

# Weekly digest
curl https://cerebro-func.azurewebsites.net/api/weekly-digest
```

---

## 7. APIM MCP Server Setup

Azure API Management proxies the MCP endpoint and adds OAuth token validation.

### 7.1 Overview

- **APIM instance:** `cerebro-apim` (Developer_1 tier)
- **Purpose:** Expose the MCP server with `validate-azure-ad-token` inbound policy so clients authenticate via Entra ID OAuth
- **Backend:** `https://cerebro-func.azurewebsites.net/api/cerebro-mcp`

### 7.2 Configuration

APIM API operations and policies are configured **post-deploy** via the Azure Portal or Azure CLI (not in Terraform). Key steps:

1. **Create an API** in APIM pointing to the Function App MCP endpoint
2. **Add inbound policy** — `validate-azure-ad-token` to verify the caller's OAuth token against the `cerebro-mcp` app registration (`api://cerebro-mcp`)
3. **Configure CORS** to allow MCP client origins
4. **Set routing** for the MCP SSE/Streamable HTTP transport

> Detailed APIM policy configuration is maintained separately. Refer to the APIM policy reference in the Azure Portal for the current inbound/outbound policies.

---

## 8. Teams Bot Registration

### 8.1 Create Azure Bot resource

1. **Azure Portal** → **Create a resource** → search **Azure Bot**
2. Fill in:
   - **Bot handle:** `cerebro-teams-bot`
   - **Pricing tier:** F0 (Free) for development
   - **Type of App:** Multi Tenant
   - **App ID:** Use the `teams_bot_app_id` from Terraform output
   - **App password:** The client secret from the `cerebro-teams-bot` app registration
3. **Messaging endpoint:** `https://cerebro-func.azurewebsites.net/api/cerebro-teams`
4. Under **Channels**, click **Microsoft Teams** to enable

### 8.2 Create Teams app manifest

Create a `manifest.json` for sideloading the bot into Teams:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "TEAMS_BOT_APP_ID",
  "developer": {
    "name": "Cerebro",
    "websiteUrl": "https://cerebro-func.azurewebsites.net",
    "privacyUrl": "https://cerebro-func.azurewebsites.net/privacy",
    "termsOfUseUrl": "https://cerebro-func.azurewebsites.net/terms"
  },
  "name": {
    "short": "Cerebro",
    "full": "Cerebro Knowledge Brain"
  },
  "description": {
    "short": "Personal knowledge capture and recall",
    "full": "Capture thoughts, ideas, and tasks from Teams. Search your knowledge base with AI-powered semantic search."
  },
  "bots": [
    {
      "botId": "TEAMS_BOT_APP_ID",
      "scopes": ["personal", "team"],
      "commandLists": [
        {
          "scopes": ["personal", "team"],
          "commands": [
            { "title": "done:", "description": "Mark a task as complete (e.g., done: update the report)" },
            { "title": "reopen:", "description": "Reopen a completed task (e.g., reopen: fix the login bug)" },
            { "title": "delete:", "description": "Soft-delete a thought (e.g., delete: old project idea)" }
          ]
        }
      ]
    }
  ],
  "permissions": ["messageTeamMembers"],
  "validDomains": ["cerebro-func.azurewebsites.net"]
}
```

Replace `TEAMS_BOT_APP_ID` with the actual client ID from Terraform output.

### 8.3 Package and install

```bash
# Create a zip with manifest.json + two icon files (color.png 192x192, outline.png 32x32)
zip cerebro-teams-app.zip manifest.json color.png outline.png
```

Upload via **Teams Admin Center** → **Manage apps** → **Upload new app**, or sideload in Teams → **Apps** → **Upload a custom app**.

---

## 9. Local Development

### 9.1 Configure local settings

Copy `.env.example` values into `functions/local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_OPENAI_ENDPOINT": "https://cerebro-openai.openai.azure.com",
    "AZURE_OPENAI_API_KEY": "YOUR_API_KEY",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
    "AZURE_OPENAI_CHAT_DEPLOYMENT": "gpt-4o-mini",
    "AZURE_OPENAI_VISION_DEPLOYMENT": "gpt-4o",
    "DATABASE_URL": "postgres://cerebroadmin:YOUR_PASSWORD@cerebro-db.postgres.database.azure.com:5432/cerebro?sslmode=require",
    "AZURE_STORAGE_CONNECTION_STRING": "YOUR_STORAGE_CONNECTION_STRING",
    "TEAMS_BOT_APP_ID": "YOUR_BOT_APP_ID",
    "TEAMS_BOT_APP_SECRET": "YOUR_BOT_SECRET",
    "TEAMS_BOT_TENANT_ID": "YOUR_ENTRA_TENANT_ID",
    "GRAPH_TENANT_ID": "YOUR_ENTRA_TENANT_ID",
    "GRAPH_CLIENT_ID": "YOUR_GRAPH_CLIENT_ID",
    "GRAPH_CLIENT_SECRET": "YOUR_GRAPH_SECRET",
    "CALENDAR_USER_EMAIL": "you@example.com"
  }
}
```

> **`local.settings.json` is gitignored.** Never commit this file.

### 9.2 Start the local dev server

```bash
cd functions
npm run start    # auto-builds via prestart hook, then runs func start
```

The server starts at `http://localhost:7071`. Available endpoints:

- `POST http://localhost:7071/api/cerebro-mcp` — MCP server
- `POST http://localhost:7071/api/cerebro-teams` — Teams bot webhook
- `GET  http://localhost:7071/api/daily-digest` — Daily digest
- `GET  http://localhost:7071/api/weekly-digest` — Weekly digest

### 9.3 Teams webhook testing with ngrok

The Teams Bot Framework requires a public HTTPS endpoint. Use ngrok to tunnel:

```bash
ngrok http 7071
```

Copy the `https://xxxx.ngrok-free.app` URL and update the bot's messaging endpoint:

1. **Azure Portal** → **Azure Bot** → **Configuration**
2. Set **Messaging endpoint** to `https://xxxx.ngrok-free.app/api/cerebro-teams`
3. Save

Remember to revert the endpoint to `https://cerebro-func.azurewebsites.net/api/cerebro-teams` when done testing.

---

## 10. Verification Checklist

- [ ] `terraform apply` completes successfully (all resources created)
- [ ] Database migrations run without errors (01 through 04)
- [ ] `\dx` shows pgvector extension installed
- [ ] `\dt` shows `thoughts` and `digest_channels` tables
- [ ] `npm run build` compiles cleanly (no TypeScript errors)
- [ ] `func azure functionapp publish cerebro-func --node` deploys successfully
- [ ] MCP endpoint responds to POST requests
- [ ] Teams bot responds to messages in Teams
- [ ] `done:` prefix marks a task as complete and bot confirms
- [ ] Daily digest endpoint returns JSON summary (manual trigger or schedule)
- [ ] Calendar reminders are created via Graph API when thoughts mention dates
- [ ] File attachments (images, DOCX) are uploaded to blob storage and analyzed

---

## Important Notes

- **Azure OpenAI region:** Deployed to **eastus2** (not centralus) because model availability varies by region. Controlled by the `openai_location` variable.
- **pgvector must be allowlisted** in the `azure.extensions` server parameter **before** running migrations. Terraform handles this automatically, but verify if troubleshooting.
- **APIM Developer tier is required** (not Consumption) for the MCP server proxy. The Developer_1 SKU supports the necessary policy features.
- **Timer triggers use Central Time** — the `WEBSITE_TIME_ZONE=Central Standard Time` app setting ensures cron expressions evaluate in Central Time.
- **Vector dimension is 1536** (`text-embedding-3-small`). If you change embedding models, you must update:
  - `infra/database/02-create-thoughts-table.sql` (column definition)
  - `infra/database/03-create-search-function.sql` (function parameter)
  - The HNSW index (rebuild with new dimensions)
- **All migrations are idempotent.** They use `IF NOT EXISTS`, `CREATE OR REPLACE`, and conditional `DO` blocks. Safe to re-run.
- **Secrets are not stored in Terraform state for security.** The `TEAMS_BOT_APP_SECRET` and `GRAPH_CLIENT_SECRET` must be set manually on the Function App after deployment. The Teams Bot and Graph app registration passwords are managed by Terraform but should be treated as sensitive.
- **MCP OAuth is handled by APIM**, not by the Function App. The Function App has no MCP auth environment variables — APIM's `validate-azure-ad-token` inbound policy handles token validation before requests reach the function.
