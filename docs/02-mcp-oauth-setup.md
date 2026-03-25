# MCP Server & GitHub OAuth Setup

## Overview

The Cerebro MCP server uses **GitHub OAuth 2.1** for authentication. The Azure Function acts as **both** the MCP resource server **and** the OAuth authorization server, wrapping GitHub as the identity provider.

> 🔑 No API keys needed — users authenticate via browser-based GitHub login.

**Key points:**

- OAuth 2.1 with PKCE (Proof Key for Code Exchange)
- GitHub is the identity provider
- The function app handles all OAuth endpoints
- Tokens are validated by calling the GitHub API

---

## How the OAuth Flow Works

```text
┌──────────┐                    ┌──────────────┐                   ┌──────────┐
│ MCP      │                    │ Azure        │                   │ GitHub   │
│ Client   │                    │ Function App │                   │ OAuth    │
└────┬─────┘                    └──────┬───────┘                   └────┬─────┘
     │                                 │                                │
     │ 1. POST /cerebro-mcp (no token) │                                │
     │────────────────────────────────►│                                │
     │                                 │                                │
     │ 2. 401 + WWW-Authenticate:      │                                │
     │    Bearer resource_metadata=    │                                │
     │    ".../.well-known/oauth-      │                                │
     │     protected-resource"         │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │ 3. GET /.well-known/            │                                │
     │    oauth-protected-resource     │                                │
     │────────────────────────────────►│                                │
     │    ← discovers auth server URL  │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │ 4. GET /.well-known/            │                                │
     │    oauth-authorization-server   │                                │
     │────────────────────────────────►│                                │
     │    ← discovers endpoints        │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │ 5. GET /oauth/authorize         │                                │
     │    ?redirect_uri=...            │                                │
     │    &state=...                   │                                │
     │    &code_challenge=...          │                                │
     │────────────────────────────────►│                                │
     │                                 │                                │
     │ 6. 302 → GitHub login           │                                │
     │    (stores redirect_uri +       │                                │
     │     PKCE in state param)        │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │         7. User logs into GitHub, authorizes app                 │
     │─────────────────────────────────────────────────────────────────►│
     │                                 │                                │
     │                                 │ 8. 302 → /oauth/callback       │
     │                                 │    ?code=...&state=...         │
     │                                 │◄───────────────────────────────│
     │                                 │                                │
     │ 9. 302 → MCP client redirect_uri│                                │
     │    with authorization code      │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │ 10. POST /oauth/token           │                                │
     │     (code + code_verifier)      │                                │
     │────────────────────────────────►│                                │
     │                                 │ 11. Exchange code with GitHub  │
     │                                 │────────────────────────────────►│
     │                                 │     ← access_token             │
     │                                 │◄───────────────────────────────│
     │     ← access_token              │                                │
     │◄────────────────────────────────│                                │
     │                                 │                                │
     │ 12. POST /cerebro-mcp           │                                │
     │     Authorization: Bearer token │                                │
     │────────────────────────────────►│ 13. GET api.github.com/user    │
     │                                 │────────────────────────────────►│
     │                                 │     ← user info (validates)    │
     │                                 │◄───────────────────────────────│
     │     ← MCP response              │                                │
     │◄────────────────────────────────│                                │
```

---

## Prerequisites

| Prerequisite | Details |
|---|---|
| GitHub account | Any GitHub account will work |
| Function app deployed | `cerebro-func` running on Azure |
| Azure CLI | For configuring app settings |

---

## Step 1: Register a GitHub OAuth App

1. Go to **<https://github.com/settings/developers>**
2. Click **"OAuth Apps"** → **"New OAuth App"**
3. Fill in the form:

| Field | Value |
|-------|-------|
| Application name | `Cerebro` |
| Homepage URL | `https://YOUR-FUNC.azurewebsites.net` |
| Application description | _(optional)_ Personal knowledge base |
| Authorization callback URL | `https://YOUR-FUNC.azurewebsites.net/oauth/callback` |

1. Click **"Register application"**
2. Copy the **Client ID** (starts with `Ov23li...`)
3. Click **"Generate a new client secret"** → copy it immediately

> ⚠️ The client secret is only shown once. Store it securely.

---

## Step 2: Configure the Function App

Set the OAuth environment variables on your function app:

```bash
az functionapp config appsettings set \
  -n YOUR-FUNC \
  -g cerebro-rg \
  --settings \
    GITHUB_OAUTH_CLIENT_ID="Ov23li..." \
    GITHUB_OAUTH_CLIENT_SECRET="your_secret_here"
```

> 💡 Replace `YOUR-FUNC` with your function app name and `cerebro-rg` with your resource group.

For **local development**, add these to `functions/local.settings.json`:

```json
{
  "Values": {
    "GITHUB_OAUTH_CLIENT_ID": "Ov23li...",
    "GITHUB_OAUTH_CLIENT_SECRET": "your_secret_here"
  }
}
```

---

## Step 3: Verify OAuth Endpoints

Test each endpoint to confirm the OAuth discovery chain works:

### 📋 Protected Resource Metadata (RFC 9728)

```bash
curl -s https://YOUR-FUNC.azurewebsites.net/.well-known/oauth-protected-resource | jq .
```

Expected response:

```json
{
  "resource": "https://YOUR-FUNC.azurewebsites.net",
  "authorization_servers": ["https://YOUR-FUNC.azurewebsites.net"]
}
```

### 📋 Authorization Server Metadata (RFC 8414)

```bash
curl -s https://YOUR-FUNC.azurewebsites.net/.well-known/oauth-authorization-server | jq .
```

Expected response includes `authorization_endpoint`, `token_endpoint`, and supported grant types.

### 📋 Test Unauthorized Access

```bash
curl -s -w "\n%{http_code}" -X POST \
  https://YOUR-FUNC.azurewebsites.net/cerebro-mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'
```

Expected: **401 Unauthorized** with a `WWW-Authenticate` header.

---

## Step 4: Connect MCP Clients

### 🟣 VS Code / GitHub Copilot

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

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

> VS Code auto-discovers OAuth endpoints via the well-known URLs. No API key needed.

When you first use the server, VS Code will:

1. Open a browser window for GitHub login
2. You authorize the app
3. Token is cached — subsequent requests are automatic

### 🟠 Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cerebro": {
      "type": "http",
      "url": "https://YOUR-FUNC.azurewebsites.net/cerebro-mcp"
    }
  }
}
```

Claude Desktop will handle the OAuth browser flow automatically.

### 🔵 Claude Code CLI

```bash
claude mcp add cerebro --transport http https://YOUR-FUNC.azurewebsites.net/cerebro-mcp
```

The CLI will prompt for GitHub login on first use.

### 🟢 Other MCP Clients

Any MCP client that supports **OAuth 2.1 with PKCE** and **HTTP transport** will work. The client needs to:

1. Discover the protected resource metadata at `/.well-known/oauth-protected-resource`
2. Follow the authorization server URL to `/.well-known/oauth-authorization-server`
3. Implement the authorization code flow with PKCE
4. Include `Authorization: Bearer <token>` on all MCP requests

---

## OAuth Endpoints Reference

| Endpoint | Method | Purpose | Spec |
|----------|--------|---------|------|
| `/.well-known/oauth-protected-resource` | GET | Resource metadata discovery | RFC 9728 |
| `/.well-known/oauth-authorization-server` | GET | Auth server metadata discovery | RFC 8414 |
| `/oauth/authorize` | GET | Initiates login, redirects to GitHub | OAuth 2.1 |
| `/oauth/callback` | GET | Receives GitHub callback, redirects to client | OAuth 2.1 |
| `/oauth/token` | POST | Exchanges authorization code for access token | OAuth 2.1 |

### Token Lifecycle

- **Access tokens** are GitHub OAuth tokens — they don't expire on a fixed schedule
- **Validation** happens on every request by calling `https://api.github.com/user`
- **Revocation** — revoke the token on GitHub (Settings → Applications → Authorized OAuth Apps)

---

## Troubleshooting

### ❌ "Dynamic Client Registration not supported"

This is **expected behavior**. MCP clients may show this message during the initial connection.

**Fix:** Click **"Copy URIs & Proceed"** (or equivalent) in your MCP client. The OAuth flow will continue normally.

### ⏳ "Waiting for server to respond to initialize"

The function app is experiencing a **cold start**. Azure Functions can take 30–60 seconds to warm up.

**Fix:** Wait 30–60 seconds and try again. The first request wakes the function app.

### 🔒 Token Expired / Authentication Failed

Your GitHub token may have been revoked or expired.

**Fix:** Re-authenticate by:

1. Removing the cached token in your MCP client
2. Reconnecting — the client will re-trigger the OAuth browser flow

### 🔗 Wrong Callback URL

The callback URL configured in GitHub must **exactly match** the one the function app uses.

**Fix:** Ensure the callback URL in GitHub OAuth App settings is:

```text
https://YOUR-FUNC.azurewebsites.net/oauth/callback
```

### 🔍 Debug OAuth State

Check function app logs for OAuth-related errors:

```bash
az functionapp log tail -n YOUR-FUNC -g cerebro-rg --filter "oauth"
```

---

## APIM (Optional)

Azure API Management can sit in front of the function app as a **passthrough proxy** for rate limiting and monitoring. Authentication is handled entirely by the function app — APIM does not participate in the OAuth flow.

If using APIM:

- Configure a simple passthrough policy (no auth transformation)
- Point the MCP client URL to the APIM endpoint instead
- Update the GitHub OAuth callback URL to use the APIM domain
- APIM adds monitoring, rate limiting, and usage analytics without changing the auth model
