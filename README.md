# 🧠 Open Brain — Microsoft Edition

An AI-powered personal knowledge base built on Azure. Capture thoughts in Microsoft Teams (via Power Automate), embed them with Azure OpenAI, store them in PostgreSQL with vector search, and expose an MCP server so any AI assistant can search and write to your brain.

Adapted from [Nate B. Jones' Open Brain](https://natebjones.com) guide — same architecture, Microsoft stack.

**Your only job: type a thought into Teams. The system handles the rest.**

## What You're Building

A Teams channel where you post a thought — Power Automate detects the new message, sends it to an Azure Function that embeds and classifies it automatically — you get a confirmation reply. Mark tasks done by typing `done: <description>`. Reopen tasks with `reopen: <description>`. Get daily and weekly digests in Teams and email. Plus an MCP server that lets any AI assistant search your brain by meaning.

```
You post in Teams  →  Power Automate  →  Azure Function  →  AI embeds + classifies  →  PostgreSQL
                                                                                            ↓
       Any AI assistant  ←  MCP server  ←  Semantic search  ←  Vector similarity
                                                                                            ↓
       Daily/Weekly Digests  ←  Power Automate (scheduled)  ←  Azure Function  ←  AI summary
```

## The Stack

| Role | Azure/Microsoft Tool | Original (Open Brain) |
|------|---------------------|----------------------|
| Capture interface | Microsoft Teams + Power Automate | Slack |
| Database + vector search | Azure Database for PostgreSQL + pgvector | Supabase |
| AI (embeddings + metadata) | Azure OpenAI | OpenRouter |
| Serverless functions | Azure Functions (Node.js/TypeScript) | Supabase Edge Functions |
| MCP server | Azure Function (HTTP trigger) | Supabase Edge Function |
| Digests | Power Automate (scheduled) + Azure Functions | N/A |

## Azure Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `ingest-thought` | HTTP POST | Capture: embed, classify, store, detect completions/reopens |
| `open-brain-mcp` | HTTP GET/POST | MCP server with 4 tools for AI clients |
| `daily-digest` | HTTP GET | Generate daily summary (called by Power Automate) |
| `weekly-digest` | HTTP GET | Generate weekly summary (called by Power Automate) |

## Features

- **Capture:** Post a thought in your dedicated Teams channel → auto-embedded, classified, stored
- **File Capture:** Post images, PDFs, or Word docs → stored in Azure Blob Storage, analyzed by AI (gpt-4o vision for images), indexed for semantic search
- **Complete:** Type `done: <task>` → semantically matches and marks the closest open task as done
- **Reopen:** Type `reopen: <task>` → finds and reopens a completed task
- **Reminders:** Include a time/date in your thought → calendar event created automatically (shows as Free, 24-hour advance reminder)
- **Daily Digest:** AI-generated summary of yesterday's thoughts + completed tasks + upcoming reminders (next 48h)
- **Weekly Digest:** Theme analysis, open loops, completed tasks + upcoming reminders (next 7 days)
- **MCP Server:** 4 tools (search_thoughts, browse_recent, brain_stats, capture_thought) for any AI client
- **Semantic Search:** Find thoughts by meaning, not keywords — includes file contents

## Prerequisites

- **Microsoft 365** subscription (for Teams + Power Automate)
- **Azure subscription** ([free tier](https://azure.microsoft.com/free) works to start)
- **Azure OpenAI** access ([request here](https://aka.ms/oai/access))
- **Node.js** 18+ and **npm**
- **Azure Functions Core Tools** (`npm install -g azure-functions-core-tools@4`)
- **Azure CLI** (`brew install azure-cli` or [install guide](https://learn.microsoft.com/cli/azure/install-azure-cli))

## Credential Tracker

Copy this into a text editor and fill it in as you go:

```
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=          # Step 2
AZURE_OPENAI_API_KEY=           # Step 2
EMBEDDING_DEPLOYMENT_NAME=      # Step 2
CHAT_DEPLOYMENT_NAME=           # Step 2

# Azure Database for PostgreSQL
SERVER_NAME=                    # Step 1
DATABASE_NAME=open_brain        # Step 1
ADMIN_USER=                     # Step 1
ADMIN_PASSWORD=                 # Step 1
DATABASE_URL=                   # Step 1 (assembled)

# Azure Functions
FUNCTION_APP_URL=               # Step 3
INGEST_API_KEY=                 # Step 3 (same as MCP_ACCESS_KEY, or separate)

# MCP
MCP_ACCESS_KEY=                 # Step 5
MCP_CONNECTION_URL=             # Step 6
```

## Three Parts

**Part 1 — Capture (Steps 1–4):** Teams → Power Automate → Azure Function → PostgreSQL. Type a thought, it gets embedded and classified automatically.

**Part 2 — Retrieval (Steps 5–7):** MCP Server → Any AI. Connect Claude, ChatGPT, or any MCP client to your brain with a URL.

**Part 3 — Digests (Step 8):** Power Automate schedules → Azure Function → AI summary → Teams + Email.

---

# Part 1 — Capture

## Step 1: Create the Azure PostgreSQL Database

### Create the Server

```bash
# Log in to Azure
az login

# Create a resource group (or use an existing one)
az group create --name open-brain-rg --location eastus

# Create the PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group open-brain-rg \
  --name open-brain-db \
  --location eastus \
  --admin-user brainadmin \
  --admin-password 'YOUR_STRONG_PASSWORD' \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0
```

Save the server name and credentials in your tracker.

### Allow Your IP (for setup)

```bash
az postgres flexible-server firewall-rule create \
  --resource-group open-brain-rg \
  --name open-brain-db \
  --rule-name allow-setup \
  --start-ip-address YOUR_IP \
  --end-ip-address YOUR_IP
```

### Enable pgvector Extension

```bash
az postgres flexible-server parameter set \
  --resource-group open-brain-rg \
  --server-name open-brain-db \
  --name azure.extensions \
  --value vector
```

### Create the Database and Run SQL Scripts

```bash
# Connect with psql
psql "host=open-brain-db.postgres.database.azure.com dbname=postgres user=brainadmin sslmode=require"

# Create the database
CREATE DATABASE open_brain;
\c open_brain

# Run each script in order (or paste their contents):
\i infra/database/01-enable-pgvector.sql
\i infra/database/02-create-thoughts-table.sql
\i infra/database/03-create-search-function.sql
\i infra/database/04-row-level-security.sql
\i infra/database/05-add-status-column.sql
```

Assemble your connection string: `postgresql://brainadmin:PASSWORD@open-brain-db.postgres.database.azure.com:5432/open_brain?sslmode=require`

## Step 2: Set Up Azure OpenAI

### Create the Resource

```bash
az cognitiveservices account create \
  --name open-brain-ai \
  --resource-group open-brain-rg \
  --kind OpenAI \
  --sku S0 \
  --location eastus
```

### Deploy the Models

```bash
# Embedding model (1536 dimensions)
az cognitiveservices account deployment create \
  --name open-brain-ai \
  --resource-group open-brain-rg \
  --deployment-name text-embedding-3-small \
  --model-name text-embedding-3-small \
  --model-version "1" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard

# Chat model (metadata extraction + digests)
az cognitiveservices account deployment create \
  --name open-brain-ai \
  --resource-group open-brain-rg \
  --deployment-name gpt-4o-mini \
  --model-name gpt-4o-mini \
  --model-version "2024-07-18" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard
```

### Get Your Credentials

```bash
# Endpoint
az cognitiveservices account show \
  --name open-brain-ai \
  --resource-group open-brain-rg \
  --query properties.endpoint -o tsv

# API Key
az cognitiveservices account keys list \
  --name open-brain-ai \
  --resource-group open-brain-rg \
  --query key1 -o tsv
```

Save both in your credential tracker.

## Step 3: Deploy the Azure Functions

### Install Dependencies

```bash
cd functions
npm install
npm run build
cd ..
```

### Create the Function App

```bash
# Create a storage account (required by Azure Functions)
az storage account create \
  --name openbrainstorage \
  --resource-group open-brain-rg \
  --location eastus \
  --sku Standard_LRS

# Create the Function App
az functionapp create \
  --resource-group open-brain-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --name open-brain-func \
  --storage-account openbrainstorage
```

### Generate an Access Key

```bash
# Mac/Linux
openssl rand -hex 32

# Windows (PowerShell)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

Copy the 64-character hex string into your credential tracker as `MCP_ACCESS_KEY`.

### Set Environment Variables

```bash
az functionapp config appsettings set \
  --name open-brain-func \
  --resource-group open-brain-rg \
  --settings \
    AZURE_OPENAI_ENDPOINT="https://open-brain-ai.openai.azure.com" \
    AZURE_OPENAI_API_KEY="your-key" \
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="text-embedding-3-small" \
    AZURE_OPENAI_CHAT_DEPLOYMENT="gpt-4o-mini" \
    DATABASE_URL="postgresql://brainadmin:PASSWORD@open-brain-db.postgres.database.azure.com:5432/open_brain?sslmode=require" \
    MCP_ACCESS_KEY="your-64-char-key"
```

### Deploy

```bash
cd functions
func azure functionapp publish open-brain-func --node
cd ..
```

Your function URLs will be:
- **Ingest:** `https://open-brain-func.azurewebsites.net/api/ingest-thought`
- **MCP:** `https://open-brain-func.azurewebsites.net/api/open-brain-mcp`
- **Daily Digest:** `https://open-brain-func.azurewebsites.net/api/daily-digest`
- **Weekly Digest:** `https://open-brain-func.azurewebsites.net/api/weekly-digest`

## Step 4: Set Up Power Automate Capture Flow

Power Automate connects Teams to your Azure Function. When you post a message in your dedicated capture channel, it captures the thought and replies with a confirmation.

> **Why Power Automate?** Microsoft is retiring Office 365 Connectors (incoming webhooks) and steering away from outgoing webhooks. Power Automate is the future-proof approach for Teams integration.

### Create the Capture Flow

1. Go to [make.powerautomate.com](https://make.powerautomate.com) → **Create** → **Automated cloud flow**
2. Name: **Open Brain — Capture**
3. Trigger: **When a new channel message is added** (Microsoft Teams)
   - **Team:** your team
   - **Channel:** your dedicated capture channel

4. **Add action: Get message details** (Microsoft Teams)
   - **Message ID:** use the Message ID from the trigger output
   - **Team:** same team
   - **Channel:** same channel

5. **Add action: Compose** (Data Operations) — *optional, helps debug*
   - **Inputs:** `@{body('Get_message_details')}`

6. **Add action: HTTP**
   - **Method:** POST
   - **URI:** `https://YOUR-FUNC.azurewebsites.net/api/ingest-thought?key=YOUR-ACCESS-KEY`
   - **Headers:** `Content-Type: application/json`
   - **Body:**
     ```json
     {
       "text": "@{body('Get_message_details')?['body']?['plainTextContent']}",
       "from": "@{body('Get_message_details')?['from']?['user']?['displayName']}",
       "attachments": @{coalesce(body('Get_message_details')?['attachments'], json('[]'))}
     }
     ```

7. **Add action: Parse JSON**
   - **Content:** `@{body('HTTP')}`
   - **Schema:**
     ```json
     {
       "type": "object",
       "properties": {
         "id": { "type": "string" },
         "reply": { "type": "string" },
         "type": { "type": "string" },
         "title": { "type": "string" },
         "markedDone": { "type": ["string", "null"] },
         "skipped": { "type": "boolean" },
         "reason": { "type": "string" },
         "has_reminder": { "type": "boolean" },
         "reminder_title": { "type": ["string", "null"] },
         "reminder_datetime": { "type": ["string", "null"] },
         "has_file": { "type": "boolean" },
         "file_url": { "type": ["string", "null"] }
       }
     }
     ```

8. **Add action: Condition**
   - `body('Parse_JSON')?['skipped']` is equal to `true`

9. **No branch** (not skipped):
   - **Reply with a message in a channel** (Microsoft Teams)
     - **Message ID:** use the Message ID from the trigger output
     - **Team:** same team
     - **Channel:** same channel
     - **Message:** `@{body('Parse_JSON')?['reply']}`
   - **Add action: Condition** (nested inside the No branch)
     - `body('Parse_JSON')?['has_reminder']` is equal to `true`
     - **Yes branch:** Add **Create event (V4)** (Office 365 Outlook)
       - **Calendar:** Calendar (your default)
       - **Subject:** `@{body('Parse_JSON')?['reminder_title']}`
       - **Start time:** `@{body('Parse_JSON')?['reminder_datetime']}`
       - **End time:** `@{addMinutes(body('Parse_JSON')?['reminder_datetime'], 15)}`
       - **Time zone:** (UTC-06:00) Central Time
       - **Show As:** Free
       - **Reminder:** Yes, 1440 minutes (= 24 hours before)
     - **No branch:** leave empty

10. **Yes branch** — leave empty (skipped = nothing to reply)

11. **Save** and test by posting a thought in your capture channel.

> **Important:** Use "Reply with a message" (not "Post message") so the reply doesn't re-trigger the flow. The trigger only fires on new messages, not replies.
>
> **Loop guard:** The ingest function also rejects messages that look like its own reply text (starting with `**Captured**`, `✅ **Marked done`, or `🔄 **Reopened`), providing defense-in-depth against infinite loops.

### Test Capture

In your Teams capture channel, post:

```
Sarah mentioned she's thinking about leaving her job to start a consulting business
```

Wait 5–10 seconds. You should see a reply:

> **Captured** as `person_note` — Sarah — career consulting plans
>
> **People:** Sarah
>
> **Tags:** career, consulting

### Task Completion

Mark a task as done:
```
done: the API redesign
```
> ✅ **Marked done:** API Redesign Project

### Reopen a Task

Reopen a completed task:
```
reopen: the API redesign
```
> 🔄 **Reopened:** API Redesign Project

**Completion prefixes:** `done:`, `completed:`, `finished:`, `shipped:`, `closed:`

**Reopen prefixes:** `reopen:`, `undo:`, `not done:`, `re-open:`

Natural language also works — "I finished the API redesign" will be detected as a completion by the AI.

### Set a Reminder

Post a thought with a time reference:
```
remind me to submit the TPS report by Friday at 3pm
```
> **Captured** as `task` — TPS Report Submission
>
> 📅 **Reminder set:** Submit the TPS report — Fri, Mar 7, 3:00 PM

A calendar event will appear in your Outlook calendar (15-minute event, shown as Free) with a 24-hour advance reminder.

### File Capture (Images, PDFs, Docs)

The capture flow already includes `attachments` in the HTTP body (step 6 above). When you post a file in your capture channel, the function will:
- Download the file from Teams
- Upload it to Azure Blob Storage (`brain-files` container)
- Analyze images with gpt-4o vision (description + OCR)
- Extract text from Word documents
- Combine the analysis with your message text for embedding

Supported file types:
- **Images:** PNG, JPG, GIF, WebP → AI vision analysis
- **Word docs:** DOCX → text extraction
- **PDFs:** Noted as attached (full text extraction planned for future update)
- **Other files:** Stored and noted in metadata

Test by posting a screenshot in your capture channel. You should see a reply with 📎 and a description of the image.

**If capture works, Part 1 is done.**

---

# Part 2 — Retrieval

## Step 5: Configure the MCP Server

The MCP server was already deployed in Step 3. Your MCP server URL is:

```
https://open-brain-func.azurewebsites.net/api/open-brain-mcp
```

Build your MCP Connection URL by adding the access key:

```
https://open-brain-func.azurewebsites.net/api/open-brain-mcp?key=your-access-key
```

Save this in your credential tracker as `MCP_CONNECTION_URL`.

Verify it works:

```bash
curl "https://open-brain-func.azurewebsites.net/api/open-brain-mcp?key=your-access-key"
```

You should get a JSON response with status "ok" and the 4 tool names.

## Step 6: Connect to Your AI

### Claude Desktop

1. Open Claude Desktop → **Settings** → **Connectors**
2. Click **Add custom connector**
3. **Name:** Open Brain
4. **Remote MCP server URL:** paste your MCP Connection URL
5. Click **Add**

### ChatGPT

Requires a paid ChatGPT plan. Enable Developer Mode first:

1. Go to chatgpt.com → **Settings** → **Apps & Connectors** → **Advanced settings**
2. Toggle **Developer mode** ON
3. In **Apps & Connectors**, click **Create**
4. **Name:** Open Brain
5. **MCP endpoint URL:** paste your MCP Connection URL
6. **Authentication:** No Authentication (key is in the URL)
7. Click **Create**

### VS Code / GitHub Copilot

Add to your VS Code user `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "open-brain": {
        "type": "http",
        "url": "https://YOUR-FUNC.azurewebsites.net/api/open-brain-mcp?key=YOUR-ACCESS-KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http open-brain \
  https://open-brain-func.azurewebsites.net/api/open-brain-mcp \
  --header "x-brain-key: your-access-key"
```

### Other Clients (Cursor, Windsurf)

**Option A — URL with key:** If your client supports remote MCP URLs, paste the MCP Connection URL directly.

**Option B — mcp-remote bridge:** For clients that only support local stdio servers:

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://open-brain-func.azurewebsites.net/api/open-brain-mcp",
        "--header",
        "x-brain-key:${BRAIN_KEY}"
      ],
      "env": {
        "BRAIN_KEY": "your-access-key"
      }
    }
  }
}
```

## Step 7: Test Retrieval

| Prompt | Tool Used |
|--------|-----------|
| "What did I capture about career changes?" | search_thoughts |
| "Show me my recent thoughts" | browse_recent |
| "How many thoughts do I have?" | brain_stats |
| "Find my notes about the API redesign" | search_thoughts |
| "Remember that Marcus wants to move to the platform team" | capture_thought |

---

# Part 3 — Digests

## Step 8: Set Up Digest Flows in Power Automate

### Daily Digest Flow

1. Go to [make.powerautomate.com](https://make.powerautomate.com) → **Create** → **Scheduled cloud flow**
2. Name: **Open Brain — Daily Digest**
3. Start: tomorrow at **8:00 AM**, repeat every **1 day**

4. **Add action: HTTP**
   - **Method:** GET
   - **URI:** `https://YOUR-FUNC.azurewebsites.net/api/daily-digest?key=YOUR-ACCESS-KEY`

5. **Add action: Parse JSON**
   - **Content:** `@{body('HTTP')}`
   - **Schema:**
     ```json
     {
       "type": "object",
       "properties": {
         "title": { "type": "string" },
         "summary": { "type": "string" },
         "summaryHtml": { "type": "string" },
         "thoughtCount": { "type": "integer" },
         "skipped": { "type": "boolean" }
       }
     }
     ```

6. **Add action: Condition**
   - `body('Parse_JSON')?['skipped']` is equal to `true`

7. **No branch** (there ARE thoughts):
   - **Post message in a chat or channel** (Teams) — Message: `@{body('Parse_JSON')?['summary']}`
   - **Send an email (V2)** — Subject: `@{body('Parse_JSON')?['title']}`, Body: `@{body('Parse_JSON')?['summaryHtml']}`

8. **Yes branch** — leave empty (no thoughts = no digest)

The daily digest includes an AI-generated summary plus the **top 3 completed tasks** from the past 24 hours.

### Weekly Digest Flow

Same structure as daily, with two changes:

1. **Schedule:** Every **1 week** on **Monday** at **8:00 AM**
2. **HTTP URI:** `https://YOUR-FUNC.azurewebsites.net/api/weekly-digest?key=YOUR-ACCESS-KEY`

The weekly digest includes theme analysis, open loops, and the **top 5 completed tasks** from the past 7 days.

---

## What's Next: Companion Prompts

Your Open Brain is live. Now make it work for you. The [companion prompts](prompts/) cover the full lifecycle:

1. **[Memory Migration](prompts/01-memory-migration.md)** — Extract everything Claude/ChatGPT already knows about you into your brain
2. **[Second Brain Migration](prompts/02-second-brain-migration.md)** — Bring over your existing notes from Microsoft Lists, Notion, Obsidian, or any other system
3. **[Open Brain Spark](prompts/03-open-brain-spark.md)** — Discover capture patterns specific to your workflow
4. **[Quick Capture Templates](prompts/04-quick-capture-templates.md)** — Capture patterns, task completion, and reopen commands
5. **[Weekly Review](prompts/05-weekly-review.md)** — Friday ritual that surfaces themes, forgotten action items, and connections

**Start with Memory Migration**, then run Second Brain Migration if you have existing notes. The Spark shows you what to capture going forward. The templates build the daily habit. The weekly review closes the loop.

---

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for common issues and fixes.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system design, data flow, and building blocks.

## Cost Estimate

| Service | Estimated Cost |
|---------|---------------|
| Azure Database for PostgreSQL (Burstable B1ms) | ~$13/month |
| Azure Functions (Consumption plan) | Free tier covers typical usage |
| Azure OpenAI (embeddings + gpt-4o-mini) | ~$0.10–0.30/month for 20 thoughts/day |
| Power Automate | Included with Microsoft 365 |

💡 For a cheaper start, use the Azure free tier for PostgreSQL and Functions. The primary ongoing cost is Azure OpenAI usage, which is minimal for personal use.

## Credits

Architecture inspired by [Nate B. Jones'](https://natebjones.com) Open Brain system and [the companion video](https://www.youtube.com/watch?v=0TpON5T-Sw4). The original uses Slack + Supabase + OpenRouter. This repo adapts it for the Microsoft/Azure ecosystem.

## License

MIT — see [LICENSE](LICENSE)
