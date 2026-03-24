# MCP Server Authentication & APIM Setup

## Overview

The Cerebro MCP server uses **GitHub OAuth 2.1** for authentication, following the MCP specification's required auth flow. The Azure Function acts as both the MCP resource server and the OAuth authorization server, wrapping GitHub as the identity provider.

APIM is **optional** — it can be used as a passthrough proxy for rate limiting, monitoring, or custom domain support, but authentication is handled entirely by the function app itself.

## Authentication Flow

```
MCP Client → POST /api/cerebro-mcp → 401 (no token)
           → GET /.well-known/oauth-protected-resource → discovers auth server
           → GET /.well-known/oauth-authorization-server → discovers endpoints
           → GET /api/oauth/authorize → 302 redirect to GitHub login
           → User authorizes on GitHub
           → GitHub → GET /api/oauth/callback → 302 redirect to MCP client with code
           → MCP Client → POST /api/oauth/token (code) → GitHub access token
           → POST /api/cerebro-mcp with Bearer token → validates via GitHub API → MCP response
```

## Environment Variables

Set these on the Azure Function App (or in `local.settings.json` for local dev):

| Variable | Description |
|----------|-------------|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |

When these variables are **not set**, OAuth is disabled and the MCP endpoint allows unauthenticated access (suitable for local development).

## GitHub OAuth App Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) → OAuth Apps → New OAuth App
2. Set the **Authorization callback URL** to: `https://cerebro-func.azurewebsites.net/api/oauth/callback`
3. Copy the Client ID and Client Secret into the function app configuration

## MCP Client Configuration

MCP clients connect directly to the function app:

```
URL: https://cerebro-func.azurewebsites.net/api/cerebro-mcp
```

OAuth discovery is automatic via the well-known endpoints. No manual OAuth configuration is needed in the MCP client — compliant clients will discover endpoints and initiate the flow when they receive a 401 response.

## OAuth Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 resource metadata |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414 server metadata |
| `/api/oauth/authorize` | GET | Redirects to GitHub login |
| `/api/oauth/callback` | GET | Receives GitHub auth callback |
| `/api/oauth/token` | POST | Exchanges code for access token |

## APIM Setup (Optional)

APIM can be used as a passthrough proxy in front of the function app. Since the function handles its own auth, APIM does **not** need any token validation policies.

### 1. Import the MCP API
In APIM → APIs → Add API → HTTP:
- Display name: `Cerebro MCP`
- Web service URL: `https://cerebro-func.azurewebsites.net`
- API URL suffix: `mcp`

### 2. Add Operations
Add operations for all endpoints:
- **POST** `/api/cerebro-mcp` — Main MCP communication
- **GET** `/api/cerebro-mcp` — SSE endpoint (optional)
- **DELETE** `/api/cerebro-mcp` — Session termination
- **GET** `/.well-known/oauth-protected-resource` — Resource metadata
- **GET** `/.well-known/oauth-authorization-server` — Auth server metadata
- **GET** `/api/oauth/authorize` — OAuth authorize redirect
- **GET** `/api/oauth/callback` — OAuth callback
- **POST** `/api/oauth/token` — Token exchange

### 3. Passthrough Policy
No token validation is needed — the function handles auth. Use a simple passthrough:

```xml
<policies>
    <inbound>
        <base />
    </inbound>
    <backend>
        <base />
    </backend>
    <outbound>
        <base />
    </outbound>
    <on-error>
        <base />
    </on-error>
</policies>
```

### 4. CORS Configuration
If MCP clients connect from browsers, add CORS policy:
```xml
<cors allow-credentials="true">
    <allowed-origins>
        <origin>*</origin>
    </allowed-origins>
    <allowed-methods>
        <method>GET</method>
        <method>POST</method>
        <method>DELETE</method>
        <method>OPTIONS</method>
    </allowed-methods>
    <allowed-headers>
        <header>*</header>
    </allowed-headers>
</cors>
```

### Notes
- The backend Azure Function uses `authLevel: 'anonymous'` — the function handles its own auth via GitHub OAuth
- When using APIM, update the GitHub OAuth App callback URL to use the APIM domain
- APIM is useful for rate limiting, analytics, and custom domain support but is not required for auth
