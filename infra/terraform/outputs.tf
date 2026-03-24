# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.cerebro.name
}

output "function_app_url" {
  description = "Default URL of the Function App"
  value       = "https://${azurerm_windows_function_app.cerebro.default_hostname}"
}

output "function_app_default_hostname" {
  description = "Default hostname of the Function App"
  value       = azurerm_windows_function_app.cerebro.default_hostname
}

output "postgresql_fqdn" {
  description = "Fully qualified domain name of the PostgreSQL server"
  value       = azurerm_postgresql_flexible_server.cerebro.fqdn
}

output "postgresql_database_url" {
  description = "Full connection string for the cerebro database"
  sensitive   = true
  value       = "postgresql://${var.postgresql_admin_username}:${var.postgresql_admin_password}@${azurerm_postgresql_flexible_server.cerebro.fqdn}:5432/cerebro?sslmode=require"
}

output "openai_endpoint" {
  description = "Azure OpenAI endpoint URL"
  value       = azurerm_cognitive_account.openai.endpoint
}

output "storage_connection_string" {
  description = "Primary connection string for the storage account"
  sensitive   = true
  value       = azurerm_storage_account.cerebro.primary_connection_string
}

output "apim_gateway_url" {
  description = "API Management gateway URL"
  value       = azurerm_api_management.cerebro.gateway_url
}

output "mcp_app_client_id" {
  description = "Application (client) ID of the Cerebro MCP app registration"
  value       = azuread_application.mcp.client_id
}

output "teams_bot_app_id" {
  description = "Application (client) ID of the Cerebro Teams Bot app registration"
  value       = azuread_application.teams_bot.client_id
}

output "acs_connection_string" {
  description = "Primary connection string for Azure Communication Services"
  sensitive   = true
  value       = azurerm_communication_service.cerebro.primary_connection_string
}

output "acs_email_sender" {
  description = "Default sender email address for ACS Email"
  value       = "DoNotReply@${azurerm_email_communication_service_domain.cerebro.mail_from_sender_domain}"
}
