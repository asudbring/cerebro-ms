# Credential Tracker

Copy this into a text editor and fill it in as you go through the setup guide. Each item tells you which step generates it.

```
# ================================================
# OPEN BRAIN — MICROSOFT EDITION — CREDENTIALS
# ================================================
# ⚠️ Keep this file private. Never commit it.

# --- Azure Database for PostgreSQL (Step 1) ---
PG_SERVER_NAME=                    # e.g., open-brain-db
PG_ADMIN_USER=                     # e.g., brainadmin
PG_ADMIN_PASSWORD=                 # the password you set during creation
PG_DATABASE=open_brain
DATABASE_URL=                      # postgresql://USER:PASS@SERVER.postgres.database.azure.com:5432/open_brain?sslmode=require

# --- Azure OpenAI (Step 2) ---
AZURE_OPENAI_ENDPOINT=             # e.g., https://open-brain-ai.openai.azure.com
AZURE_OPENAI_API_KEY=              # from az cognitiveservices account keys list
EMBEDDING_DEPLOYMENT=text-embedding-3-small
CHAT_DEPLOYMENT=gpt-4o-mini

# --- Azure Functions (Step 3) ---
FUNCTION_APP_NAME=                 # e.g., open-brain-functions
INGEST_FUNCTION_URL=               # e.g., https://open-brain-functions.azurewebsites.net/api/ingest-thought

# --- Teams Outgoing Webhook (Step 4) ---
TEAMS_WEBHOOK_SECRET=              # the security token Teams gives you when creating the webhook

# --- MCP Access Key (Step 6) ---
MCP_ACCESS_KEY=                    # 64-character hex string from openssl rand -hex 32

# --- MCP Connection URL (Step 7) ---
MCP_SERVER_URL=                    # https://FUNCTION_APP.azurewebsites.net/api/open-brain-mcp
MCP_CONNECTION_URL=                # MCP_SERVER_URL + ?key=MCP_ACCESS_KEY
```
