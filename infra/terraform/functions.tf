# -----------------------------------------------------------------------------
# Application Insights (Log Analytics workspace + component)
# -----------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "cerebro" {
  name                = "${var.function_app_name}-logs"
  resource_group_name = azurerm_resource_group.cerebro.name
  location            = azurerm_resource_group.cerebro.location
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = {
    project = "cerebro"
  }
}

resource "azurerm_application_insights" "cerebro" {
  name                = "${var.function_app_name}-insights"
  resource_group_name = azurerm_resource_group.cerebro.name
  location            = azurerm_resource_group.cerebro.location
  workspace_id        = azurerm_log_analytics_workspace.cerebro.id
  application_type    = "web"

  tags = {
    project = "cerebro"
  }
}

# -----------------------------------------------------------------------------
# App Service Plan (Consumption / Y1)
# -----------------------------------------------------------------------------
resource "azurerm_service_plan" "cerebro" {
  name                = "${var.function_app_name}-plan"
  resource_group_name = azurerm_resource_group.cerebro.name
  location            = azurerm_resource_group.cerebro.location
  os_type             = "Windows"
  sku_name            = "Y1"

  tags = {
    project = "cerebro"
  }
}

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
resource "azurerm_windows_function_app" "cerebro" {
  name                       = var.function_app_name
  resource_group_name        = azurerm_resource_group.cerebro.name
  location                   = azurerm_resource_group.cerebro.location
  service_plan_id            = azurerm_service_plan.cerebro.id
  storage_account_name       = azurerm_storage_account.cerebro.name
  storage_account_access_key = azurerm_storage_account.cerebro.primary_access_key

  site_config {
    application_stack {
      node_version = "~18"
    }
    cors {
      allowed_origins = ["*"]
    }
  }

  app_settings = {
    # --- Runtime ---
    FUNCTIONS_WORKER_RUNTIME     = "node"
    WEBSITE_NODE_DEFAULT_VERSION = "~18"
    WEBSITE_TIME_ZONE            = "Central Standard Time"

    # --- Application Insights ---
    APPINSIGHTS_INSTRUMENTATIONKEY        = azurerm_application_insights.cerebro.instrumentation_key
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.cerebro.connection_string

    # --- Azure OpenAI ---
    AZURE_OPENAI_ENDPOINT             = azurerm_cognitive_account.openai.endpoint
    AZURE_OPENAI_API_KEY              = azurerm_cognitive_account.openai.primary_access_key
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "text-embedding-3-small"
    AZURE_OPENAI_CHAT_DEPLOYMENT      = "gpt-4o-mini"
    AZURE_OPENAI_VISION_DEPLOYMENT    = "gpt-4o"

    # --- PostgreSQL ---
    DATABASE_URL = "postgresql://${var.postgresql_admin_username}:${var.postgresql_admin_password}@${azurerm_postgresql_flexible_server.cerebro.fqdn}:5432/cerebro?sslmode=require"

    # --- Storage ---
    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.cerebro.primary_connection_string

    # --- Entra ID / Teams Bot ---
    TEAMS_BOT_APP_ID    = azuread_application.teams_bot.client_id
    TEAMS_BOT_TENANT_ID = var.entra_tenant_id
    # TEAMS_BOT_APP_SECRET — set manually or via Key Vault after deploy

    # --- Azure Communication Services / Email ---
    ACS_CONNECTION_STRING    = azurerm_communication_service.cerebro.primary_connection_string
    ACS_EMAIL_SENDER         = "DoNotReply@${azurerm_email_communication_service_domain.cerebro.mail_from_sender_domain}"
    DIGEST_EMAIL_RECIPIENT   = var.digest_email_recipient
  }

  tags = {
    project = "cerebro"
  }
}
