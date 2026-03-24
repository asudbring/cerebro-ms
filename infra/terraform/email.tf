# -----------------------------------------------------------------------------
# Azure Communication Services + Email
# -----------------------------------------------------------------------------

resource "azurerm_communication_service" "cerebro" {
  name                = "cerebro-acs"
  resource_group_name = azurerm_resource_group.cerebro.name
  data_location       = "United States"

  tags = {
    project = "cerebro"
  }
}

resource "azurerm_email_communication_service" "cerebro" {
  name                = "cerebro-email"
  resource_group_name = azurerm_resource_group.cerebro.name
  data_location       = "United States"

  tags = {
    project = "cerebro"
  }
}

resource "azurerm_email_communication_service_domain" "cerebro" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.cerebro.id
  domain_management = "AzureManaged"

  tags = {
    project = "cerebro"
  }
}
