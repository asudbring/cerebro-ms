# Cerebro — Your Brain in the Azure Cloud ☁️🧠

A personal knowledge base built entirely on Azure. Capture thoughts from MCP clients and Microsoft Teams, embed them with Azure OpenAI, store in PostgreSQL with pgvector for semantic search, and retrieve via an MCP server. Includes task management, calendar reminders, file attachments, and AI-powered daily/weekly digests.

## Architecture

```
┌─────────────┐       ┌──────────────┐       ┌──────────────────┐       ┌────────────────────┐
│  MCP Client │──────▶│  Azure APIM  │──────▶│  Azure Function  │──────▶│  PostgreSQL        │
│  (any AI)   │ OAuth │  (OAuth 2.1) │       │  cerebro-mcp     │       │  pgvector (1536d)  │
└─────────────┘       └──────────────┘       └──────────────────┘       └────────────────────┘
                                                     │                          ▲
                                                     ▼                          │
                                              ┌──────────────┐                  │
                                              │  Azure OpenAI │                  │
                                              │  embed + chat │                  │
                                              └──────────────┘                  │
                                                                                │
┌─────────────┐       ┌──────────────────┐                                      │
│  Microsoft  │──────▶│  Azure Function  │──────────────────────────────────────┘
│  Teams      │  Bot  │  cerebro-teams   │──────▶ Azure Blob Storage (files)
└─────────────┘ Frmwk └──────────────────┘──────▶ Microsoft Graph (calendar)

┌─────────────┐       ┌──────────────────┐
│  Timer      │──────▶│  Azure Function  │──────▶ Teams (proactive messages)
│  Triggers   │       │  cerebro-digest  │
└─────────────┘       └──────────────────┘
```

## Features

- 🔍 **Semantic search** across all thoughts via vector similarity (pgvector)
- 📝 **Capture from anywhere** — MCP clients (Copilot, Claude, etc.) and Microsoft Teams
- ✅ **Task management** — complete, reopen, and delete tasks via semantic matching
- 📅 **AI-powered reminders** — mentions of dates/times automatically create O365 calendar events
- 📎 **File attachments** — images analyzed by GPT-4o vision, DOCX parsed by mammoth, stored in Blob Storage
- 📊 **Daily & weekly digests** — AI-generated summaries delivered to Teams via proactive messages
- 🔐 **OAuth 2.1 authentication** — MCP endpoint secured via Azure API Management + Entra ID
- 🤖 **Bot Framework integration** — Teams bot with JWT validation and sender allowlisting

## Azure Services Used

| Service | Resource Name | Purpose |
|---------|--------------|---------|
| Azure Functions | `cerebro-func` | Serverless compute (3 function modules, 6 triggers) |
| Azure Database for PostgreSQL | `cerebro-db` | Vector storage with pgvector extension |
| Azure OpenAI | `cerebro-openai` | Embeddings (text-embedding-3-small) + chat (gpt-4o-mini) + vision (gpt-4o) |
| Azure Blob Storage | `cerebrostorage` | File attachment storage (`cerebro-files` container) |
| Azure API Management | `cerebro-apim` | MCP OAuth 2.1 proxy (validate-azure-ad-token policy) |
| Azure Application Insights | (auto-provisioned) | Monitoring + logging |
| Entra ID | App registrations | Bot Framework auth, Graph API credentials, APIM OAuth |

## MCP Tools (7 tools)

The MCP server exposes 7 tools for any AI client:

| Tool | Description |
|------|-------------|
| `search_thoughts` | Semantic search across your knowledge base by query similarity |
| `list_thoughts` | Browse/filter thoughts by type, topic, person, time period, status, or file attachment |
| `thought_stats` | Aggregate statistics — totals, types, top topics, and people |
| `capture_thought` | Save a new thought with automatic embedding, metadata extraction, and reminder creation |
| `complete_task` | Mark a task as done by describing it — uses semantic matching to find the closest open task |
| `reopen_task` | Reopen a completed task by describing it — finds the closest done task by similarity |
| `delete_task` | Soft-delete a thought by describing it — searches open then done tasks |

## Teams Bot Commands

Send messages in any conversation with the bot:

| Input | Action |
|-------|--------|
| Any message | Captured as a thought (auto-embedded, metadata extracted) |
| `done: <description>` | Mark the closest matching open task as complete |
| `reopen: <description>` | Reopen the closest matching completed task |
| `delete: <description>` | Soft-delete the closest matching thought |
| File attachment | Stored in Azure Blob Storage + analyzed by AI (vision for images, parsing for DOCX) |

The bot auto-registers the conversation for digest delivery on first message.

## Quick Start

```bash
# 1. Provision infrastructure
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # edit with your values
terraform init && terraform apply

# 2. Run database migrations
psql "$DATABASE_URL" -f infra/database/01-enable-pgvector.sql
psql "$DATABASE_URL" -f infra/database/02-create-thoughts-table.sql
psql "$DATABASE_URL" -f infra/database/03-create-search-function.sql
psql "$DATABASE_URL" -f infra/database/04-create-digest-channels.sql

# 3. Configure environment
cp .env.example functions/local.settings.json   # adapt format for local dev

# 4. Build and deploy
cd functions
npm install && npm run build
func azure functionapp publish cerebro-func --node
```

See [docs/setup.md](docs/setup.md) for the full setup guide including Entra ID app registrations, APIM configuration, and Teams bot setup.

## Project Structure

```
cerebro-ms/
├── functions/                   # Azure Functions v4 (TypeScript, Node 18+)
│   ├── app.ts                   # Entry point — imports all function modules
│   ├── cerebro-mcp/             # MCP server (7 tools via Streamable HTTP)
│   │   └── index.ts
│   ├── cerebro-teams/           # Teams bot webhook (Bot Framework)
│   │   └── index.ts
│   ├── cerebro-digest/          # Daily/weekly digest (timer + HTTP triggers)
│   │   └── index.ts
│   └── lib/                     # Shared libraries
│       ├── azure-ai.ts          # Azure OpenAI — embeddings, metadata extraction, vision
│       ├── database.ts          # PostgreSQL connection pool + all queries
│       ├── blob-storage.ts      # Azure Blob Storage — upload + SAS URL generation
│       ├── calendar.ts          # Microsoft Graph — calendar event creation
│       ├── auth.ts              # Bot Framework JWT validation + sender allowlist
│       └── types.ts             # Shared TypeScript interfaces
├── infra/
│   ├── terraform/               # Infrastructure as Code
│   └── database/                # SQL migrations (01–04, run in order)
├── docs/
│   └── setup.md                 # Full setup & deployment guide
└── .env.example                 # Environment variable reference
```

## Development

```bash
cd functions
npm install           # install dependencies
npm run build         # compile TypeScript → dist/
npm run watch         # compile in watch mode
npm run start         # local dev server (requires Azure Functions Core Tools v4)
```

There is no test suite or linter configured.

### Key conventions

- **Embedding + metadata extraction run in parallel** (`Promise.all`) — never sequential
- **Vector dimension is 1536** (text-embedding-3-small). Changing models requires updating SQL migrations + HNSW index
- **Azure OpenAI uses deployment names**, not model names — set via environment variables
- **Loop guard** prevents the Teams bot from re-processing its own replies
- **Stale message guard** ignores Teams messages older than 5 minutes
- **Digest messages truncated at ~24KB** for Teams message limits

### Environment variables

See [`.env.example`](.env.example) for the full list. Key groups:

| Group | Variables |
|-------|-----------|
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `*_DEPLOYMENT` |
| Database | `DATABASE_URL` |
| Blob Storage | `AZURE_STORAGE_CONNECTION_STRING` |
| Teams Bot | `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_SECRET`, `TEAMS_BOT_TENANT_ID` |
| Graph API | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `CALENDAR_USER_EMAIL` |

MCP OAuth is handled by Azure API Management — no auth environment variables needed in the function app.

## License

MIT
