# 🧠 Cerebro — Your Brain in the Azure Cloud

<p align="center">
  <img src="docs/images/cerebro-logo.png" alt="Cerebro Logo" width="200">
</p>

> A personal knowledge base built entirely on Azure. Capture thoughts from any MCP-compatible AI client or Microsoft Teams, embed them with Azure OpenAI, store in PostgreSQL with pgvector, and let any AI assistant search your memory. Includes task management, file attachments, and AI-powered daily/weekly digests delivered by email.

[![Azure Functions](https://img.shields.io/badge/Azure_Functions-v4-0062AD?logo=azure-functions)](https://learn.microsoft.com/azure/azure-functions/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Node_20-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-764ABC)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ What It Does

- 🔍 **Semantic search** — find thoughts by meaning, not keywords (pgvector cosine similarity)
- 📝 **Capture from anywhere** — MCP clients (VS Code, Claude, ChatGPT) and Microsoft Teams
- ✅ **Task management** — complete, reopen, and soft-delete tasks via semantic matching
- 📎 **File attachments** — images analyzed by GPT-4o vision, DOCX parsed, stored in Blob Storage
- 📊 **Daily & weekly digests** — AI-generated summaries delivered via Teams proactive messages + email
- 🔐 **GitHub OAuth 2.1** — browser login for MCP clients, no API keys to manage
- 🤖 **Teams bot** — Bot Framework integration with JWT validation

---

## 🏗️ Architecture

```text
┌──────────────┐                  ┌──────────────────┐       ┌────────────────────┐
│  MCP Client  │─── OAuth 2.1 ──▶│  Azure Function  │──────▶│  PostgreSQL        │
│  (any AI)    │  GitHub login    │  cerebro-mcp     │       │  pgvector (1536d)  │
└──────────────┘                  └──────────────────┘       └────────────────────┘
                                          │                          ▲
                                          ▼                          │
                                   ┌──────────────┐                  │
                                   │  Azure OpenAI │                  │
                                   │  embed + chat │                  │
                                   └──────────────┘                  │
                                                                     │
┌──────────────┐       ┌──────────────────┐                          │
│  Microsoft   │──────▶│  Azure Function  │──────────────────────────┘
│  Teams       │  Bot  │  cerebro-teams   │──▶ Blob Storage (files)
└──────────────┘ Frmwk └──────────────────┘
                                                    ┌──▶ Teams (proactive msg)
┌──────────────┐       ┌──────────────────┐         │
│  Timer +     │──────▶│  Azure Function  │─────────┤
│  HTTP Trigger│       │  cerebro-digest  │         │
└──────────────┘       └──────────────────┘         └──▶ Email (ACS)
```

**Four function groups** on Azure Functions v4 (TypeScript, Node.js 20):

| Function | Trigger | Purpose |
|----------|---------|---------|
| `cerebro-mcp` | HTTP (GET/POST) | MCP server — 7 tools via Streamable HTTP |
| `cerebro-teams` | HTTP (POST) | Teams bot webhook — Bot Framework |
| `cerebro-digest` | Timer + HTTP | Daily/weekly AI digests |
| `cerebro-oauth` | HTTP (6 routes) | GitHub OAuth 2.1 endpoints |

---

## 🔧 MCP Tools

The MCP server exposes **7 tools** to any connected AI client:

| Tool | Description |
|------|-------------|
| `search_thoughts` | Semantic search by query similarity |
| `list_thoughts` | Browse/filter by type, topic, person, time range, status, files |
| `thought_stats` | Aggregate stats — totals, types, top topics, people |
| `capture_thought` | Save a new thought with auto embedding + metadata extraction |
| `complete_task` | Mark a task done via semantic matching against open tasks |
| `reopen_task` | Reopen a completed task via semantic matching |
| `delete_task` | Soft-delete a thought via semantic matching |

---

## 📡 Connecting AI Clients

When you connect, your browser opens for GitHub login — **no API keys needed**.

| Client | How to Connect |
|--------|----------------|
| **VS Code / Copilot** | Add to `mcp.json`: `{"type": "http", "url": "https://your-func.azurewebsites.net/cerebro-mcp"}` |
| **Claude Desktop** | Settings → MCP → Add server → HTTP → paste the URL |
| **Claude Code** | `claude mcp add cerebro --transport http https://your-func.azurewebsites.net/cerebro-mcp` |
| **Other MCP clients** | Use the HTTP URL directly; OAuth discovery is automatic |

OAuth uses **RFC 9728 + RFC 8414** discovery with PKCE support. The `host.json` route prefix is set to empty string so `.well-known` routes resolve at the root.

---

## 🤖 Teams Bot

Send any message to the Cerebro bot — it gets captured as a thought automatically.

| Input | What Happens |
|-------|--------------|
| Any message | Captured as a thought (embedded, metadata extracted) |
| `done: <description>` | Marks the closest matching open task as complete |
| `reopen: <description>` | Reopens the closest matching completed task |
| `delete: <description>` | Soft-deletes the closest matching thought |
| File attachment | Stored in Blob Storage + analyzed by AI |

**File handling:** Images are analyzed by GPT-4o vision. DOCX files are parsed with mammoth. The analysis is included in the thought content for searchability.

**Loop guard:** The bot rejects messages starting with its own reply prefixes (`**Captured**`, `✅ **Marked done**`, etc.) to prevent Power Automate / webhook re-trigger loops.

**Auto-registration:** The bot registers each conversation for digest delivery on first message.

---

## 📊 Digests

AI-generated summaries of your recent thoughts, completed tasks, and upcoming reminders.

| Digest | Schedule | Content Window |
|--------|----------|----------------|
| **Daily** | 6:00 AM Central Time (timer) | Last 24 hours + reminders in next 48h |
| **Weekly** | Sunday 12:00 PM Central Time (timer) | Last 7 days + reminders in next 7 days |

Both also have manual HTTP triggers for on-demand generation.

**Delivery:** Teams proactive messages + email via Azure Communication Services. The `summary` field (Teams markdown) is capped at ~24KB — if content exceeds this, the thought list is omitted from Teams but preserved in the HTML email.

---

## 🔐 Authentication

| Surface | Method |
|---------|--------|
| **MCP endpoint** | GitHub OAuth 2.1 — browser login, PKCE, token refresh |
| **Teams bot** | Bot Framework JWT validation via Entra ID |
| **Digest HTTP triggers** | Azure Functions host key (function-level auth) |

---

## 🚀 Quick Start

> Full walkthrough: **[docs/setup.md](docs/setup.md)**

```bash
# 1. Provision infrastructure
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars    # edit with your values
terraform init && terraform apply

# 2. Run database migrations (4 files, in order)
psql "$DATABASE_URL" -f infra/database/01-enable-pgvector.sql
psql "$DATABASE_URL" -f infra/database/02-create-thoughts-table.sql
psql "$DATABASE_URL" -f infra/database/03-create-search-function.sql
psql "$DATABASE_URL" -f infra/database/04-create-digest-channels.sql

# 3. Register a GitHub OAuth App (for MCP auth)

# 4. Build and deploy
cd functions
npm install && npm run build
func azure functionapp publish cerebro-func --node

# 5. Connect an MCP client
# VS Code → mcp.json: {"type": "http", "url": "https://your-func.azurewebsites.net/cerebro-mcp"}
```

---

## ☁️ Azure Services

| Service | Default Name | Purpose |
|---------|-------------|---------|
| Resource Group | `cerebro-rg` | Container for all resources |
| Azure Functions | `cerebro-func` | Serverless compute (Consumption plan) |
| Azure Database for PostgreSQL | `cerebro-db` | Vector storage with pgvector |
| Azure OpenAI | `cerebro-openai` | Embeddings + chat + vision |
| Azure Blob Storage | `cerebrostorage` | File attachment storage |
| Azure Communication Services | `cerebro-acs` | Email delivery for digests |
| Azure Bot Service | `cerebro-bot` | Teams bot registration |
| Azure API Management | `cerebro-apim` | Optional: rate limiting, monitoring |
| Application Insights | *(auto-provisioned)* | Monitoring + logging |
| Entra ID | App registrations | Bot Framework auth |

---

## 📁 Project Structure

```text
cerebro-ms/
├── functions/                        # Azure Functions v4 (TypeScript, Node 20)
│   ├── app.ts                        # Entry point — imports all function modules
│   ├── cerebro-mcp/index.ts          # MCP server (7 tools, Streamable HTTP)
│   ├── cerebro-teams/index.ts        # Teams bot webhook (Bot Framework)
│   ├── cerebro-digest/index.ts       # Timer + HTTP digest triggers
│   ├── cerebro-oauth/index.ts        # GitHub OAuth 2.1 (6 routes)
│   ├── lib/
│   │   ├── azure-ai.ts               # Azure OpenAI — embed, metadata, vision
│   │   ├── database.ts               # PostgreSQL connection pool + queries
│   │   ├── blob-storage.ts           # Blob uploads + SAS URL generation
│   │   ├── email.ts                  # ACS email delivery
│   │   ├── github-oauth.ts           # GitHub OAuth helpers
│   │   ├── auth.ts                   # Bot Framework JWT validation
│   │   └── types.ts                  # Shared TypeScript interfaces
│   ├── host.json                     # Function app config (empty routePrefix)
│   ├── package.json
│   └── tsconfig.json
├── infra/
│   ├── terraform/                    # IaC for all Azure resources
│   └── database/                     # SQL migrations (01–04, run in order)
├── teams/                            # Teams app manifest + icons
├── docs/                             # Setup & deployment guides
├── archive/                          # Original project files (archived)
├── .env.example                      # Environment variable reference
└── README.md
```

---

## 🛠️ Development

```bash
cd functions
npm install            # install dependencies
npm run build          # compile TypeScript → dist/
npm run watch          # compile in watch mode
npm run start          # local dev server (requires Azure Functions Core Tools v4)
```

There is no test suite or linter configured.

### ⚙️ Environment Variables

See [`.env.example`](.env.example) for the full list. Key groups:

| Group | Variables |
|-------|-----------|
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `*_EMBEDDING_DEPLOYMENT`, `*_CHAT_DEPLOYMENT`, `*_VISION_DEPLOYMENT` |
| Database | `DATABASE_URL` |
| Blob Storage | `AZURE_STORAGE_CONNECTION_STRING` |
| Teams Bot | `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_SECRET`, `TEAMS_BOT_TENANT_ID` |
| GitHub OAuth | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Email (ACS) | `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS` |
| Graph API | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` |

> **Note:** Azure OpenAI uses **deployment names**, not model names.

### 🧩 Key Conventions

- **Embedding + metadata extraction run in parallel** (`Promise.all`) — never sequential
- **Vector dimension is 1536** (text-embedding-3-small). Changing models requires updating SQL migrations + HNSW index
- **Day-of-week + Central Time** injected into AI prompts for relative date resolution ("next Monday", etc.)
- **Timer triggers** use `WEBSITE_TIME_ZONE=Central Standard Time`
- **Loop guard** prevents the bot from re-processing its own replies
- **Digest truncation** at ~24KB for Teams message limits; full content in email HTML
- **SQL migrations are idempotent** (`IF NOT EXISTS` / `CREATE OR REPLACE`)

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Setup Guide](docs/setup.md) | Full deployment walkthrough |
| [APIM Setup](docs/apim-setup.md) | API Management configuration |
| [Teams Manifest](teams/README.md) | Teams app packaging & sideloading |
| [Database Migrations](infra/database/README.md) | SQL migration details |

---

## 💡 Inspiration

This project is inspired by the open-source [Cerebro](https://github.com/allenheltondev/cerebro) by Allen Helton and the [Open Brain (OB1)](https://github.com/NateBJones/OB1) project by Nate B. Jones. Cerebro on Azure reimagines the personal knowledge brain concept using entirely Azure-native services.

---

## 📄 License

MIT
