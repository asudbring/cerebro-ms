# =============================================================================
# Entra ID App Registrations (sudbringlab tenant)
# All resources use the azuread provider configured with tenant_id.
# =============================================================================

# -----------------------------------------------------------------------------
# 1. cerebro-mcp — MCP Server (single-tenant, exposes API scope)
# -----------------------------------------------------------------------------
resource "azuread_application" "mcp" {
  display_name     = "Cerebro MCP Server"
  sign_in_audience = "AzureADMyOrg"

  # URI must contain tenant ID per org policy
  identifier_uris = ["api://1e1cce84-0637-4693-99d9-27ff18dd65c8/cerebro-mcp"]

  api {
    oauth2_permission_scope {
      admin_consent_description  = "Read and write thoughts in the Cerebro knowledge base"
      admin_consent_display_name = "Read/Write Thoughts"
      enabled                    = true
      id                         = "e7a1c5d4-3b2f-4a8e-9c6d-0f1e2d3c4b5a"
      type                       = "User"
      user_consent_description   = "Allow the app to read and write your thoughts"
      user_consent_display_name  = "Read/Write Thoughts"
      value                      = "Thoughts.ReadWrite"
    }
  }

  web {
    redirect_uris = [
      "http://localhost/",
      "https://vscode.dev/redirect",
    ]
  }

  tags = ["cerebro", "mcp"]
}

resource "azuread_service_principal" "mcp" {
  client_id = azuread_application.mcp.client_id
}

# -----------------------------------------------------------------------------
# 2. cerebro-teams-bot — Teams Bot (multitenant, required by Bot Framework)
# -----------------------------------------------------------------------------
resource "azuread_application" "teams_bot" {
  display_name     = "Cerebro Teams Bot"
  sign_in_audience = "AzureADMultipleOrgs"

  tags = ["cerebro", "teams-bot"]
}

resource "azuread_service_principal" "teams_bot" {
  client_id = azuread_application.teams_bot.client_id
}

resource "azuread_application_password" "teams_bot_secret" {
  application_id = azuread_application.teams_bot.id
  display_name   = "terraform-managed"
  end_date       = "2026-12-31T00:00:00Z"
}

# -----------------------------------------------------------------------------
# 3. cerebro-graph — Graph API access for calendar + file downloads
# -----------------------------------------------------------------------------
resource "azuread_application" "graph" {
  display_name     = "Cerebro Calendar"
  sign_in_audience = "AzureADMyOrg"

  required_resource_access {
    resource_app_id = data.azuread_application_published_app_ids.well_known.result["MicrosoftGraph"]

    resource_access {
      id   = data.azuread_service_principal.msgraph.app_role_ids["Calendars.ReadWrite"]
      type = "Role" # Application permission
    }
  }

  tags = ["cerebro", "graph"]
}

resource "azuread_service_principal" "graph" {
  client_id = azuread_application.graph.client_id
}

resource "azuread_application_password" "graph_secret" {
  application_id = azuread_application.graph.id
  display_name   = "terraform-managed"
  end_date       = "2026-12-31T00:00:00Z"
}
