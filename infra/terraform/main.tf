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
