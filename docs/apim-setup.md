# Azure API Management — MCP Server Setup

## Overview
APIM acts as an OAuth proxy for the Cerebro MCP server. It validates Entra ID tokens using the `validate-azure-ad-token` inbound policy before forwarding requests to the Azure Function.

## Prerequisites
- APIM instance provisioned (Developer tier or above)
- `cerebro-mcp` Entra ID app registration with an API scope defined
- Azure Function deployed with the MCP endpoint at `/api/cerebro-mcp`

## Setup Steps

### 1. Import the MCP API
In APIM → APIs → Add API → HTTP:
- Display name: `Cerebro MCP`
- Web service URL: `https://cerebro-func.azurewebsites.net/api`
- API URL suffix: `mcp`

### 2. Add Operations
Add operations for the MCP Streamable HTTP transport:
- **POST** `/cerebro-mcp` — Main MCP communication
- **GET** `/cerebro-mcp` — SSE endpoint (optional)
- **DELETE** `/cerebro-mcp` — Session termination

### 3. Configure OAuth Inbound Policy
Apply this inbound policy to validate Entra ID tokens:

```xml
<policies>
    <inbound>
        <base />
        <validate-azure-ad-token tenant-id="1e1cce84-0637-4693-99d9-27ff18dd65c8">
            <client-application-ids>
                <!-- Add authorized MCP client app IDs here -->
                <application-id>CLIENT_APP_ID</application-id>
            </client-application-ids>
            <audiences>
                <audience>api://cerebro-mcp</audience>
            </audiences>
        </validate-azure-ad-token>
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

### 5. MCP Client Configuration
MCP clients connect to: `https://cerebro-apim.azure-api.net/mcp/cerebro-mcp`

OAuth settings for the client:
- Authority: `https://login.microsoftonline.com/1e1cce84-0637-4693-99d9-27ff18dd65c8`
- Scope: `api://cerebro-mcp/.default`
- Grant type: Authorization Code with PKCE (for interactive clients) or Client Credentials (for server-to-server)

### Notes
- APIM Developer tier is required — Consumption tier doesn't support the `validate-azure-ad-token` policy
- The backend Azure Function uses `authLevel: 'anonymous'` since APIM handles auth
- Add each authorized MCP client's app registration ID to the `client-application-ids` list
