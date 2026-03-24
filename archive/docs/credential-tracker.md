# Credential Tracker

Copy this into a text editor and fill it in as you go through the setup guide. Each item tells you which step generates it.

```
# ================================================
# CEREBRO — MICROSOFT EDITION — CREDENTIALS
# ================================================
# ⚠️ Keep this file private. Never commit it.

# --- Azure Database for PostgreSQL (Step 1) ---
PG_SERVER_NAME=                    # e.g., cerebro-db
PG_ADMIN_USER=                     # e.g., cerebroadmin
PG_ADMIN_PASSWORD=                 # the password you set during creation
PG_DATABASE=cerebro
DATABASE_URL=                      # postgresql://USER:PASS@SERVER.postgres.database.azure.com:5432/cerebro?sslmode=require

# --- Azure OpenAI (Step 2) ---
AZURE_OPENAI_ENDPOINT=             # e.g., https://cerebro-ai.openai.azure.com
AZURE_OPENAI_API_KEY=              # from az cognitiveservices account keys list
EMBEDDING_DEPLOYMENT=text-embedding-3-small
CHAT_DEPLOYMENT=gpt-4o-mini
VISION_DEPLOYMENT=gpt-4o           # used for image analysis in file capture

# --- Azure Functions (Step 3) ---
FUNCTION_APP_NAME=                 # e.g., cerebro-func
INGEST_FUNCTION_URL=               # e.g., https://cerebro-func.azurewebsites.net/api/ingest-thought
DAILY_DIGEST_URL=                  # e.g., https://cerebro-func.azurewebsites.net/api/daily-digest
WEEKLY_DIGEST_URL=                 # e.g., https://cerebro-func.azurewebsites.net/api/weekly-digest

# --- Azure Blob Storage (for file attachments) ---
AZURE_STORAGE_CONNECTION_STRING=   # from az storage account show-connection-string

# --- Entra ID App Registration (for downloading Teams/SharePoint files) ---
GRAPH_TENANT_ID=                   # your Entra ID tenant (e.g., contoso.onmicrosoft.com tenant GUID)
GRAPH_CLIENT_ID=                   # app registration client/application ID
GRAPH_CLIENT_SECRET=               # app registration client secret (expires in 2 years)

# --- MCP Access Key (Step 5) ---
MCP_ACCESS_KEY=                    # 64-character hex string from openssl rand -hex 32

# --- MCP Connection URL (Step 6) ---
MCP_SERVER_URL=                    # https://FUNCTION_APP.azurewebsites.net/api/cerebro-mcp
MCP_CONNECTION_URL=                # MCP_SERVER_URL + ?key=MCP_ACCESS_KEY
```
