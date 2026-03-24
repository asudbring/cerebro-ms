# -----------------------------------------------------------------------------
# Resource Group
# -----------------------------------------------------------------------------
resource "azurerm_resource_group" "cerebro" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    project = "cerebro"
  }
}

# -----------------------------------------------------------------------------
# Data sources
# -----------------------------------------------------------------------------
data "azurerm_client_config" "current" {}

data "azuread_client_config" "current" {}

# Microsoft Graph well-known application ID (for API permission references)
data "azuread_application_published_app_ids" "well_known" {}

data "azuread_service_principal" "msgraph" {
  client_id = data.azuread_application_published_app_ids.well_known.result["MicrosoftGraph"]
}
