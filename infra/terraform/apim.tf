# -----------------------------------------------------------------------------
# API Management (Developer tier)
# -----------------------------------------------------------------------------
# NOTE: APIM Developer tier can take 30–60 minutes to provision.
# MCP server API configuration (operations, policies, etc.) will be done
# post-deploy via the Azure Portal or Azure CLI.

resource "azurerm_api_management" "cerebro" {
  name                = var.apim_name
  resource_group_name = azurerm_resource_group.cerebro.name
  location            = azurerm_resource_group.cerebro.location
  publisher_email     = var.apim_publisher_email
  publisher_name      = var.apim_publisher_name
  sku_name            = "Developer_1"

  tags = {
    project = "cerebro"
  }
}
