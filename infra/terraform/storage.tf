# -----------------------------------------------------------------------------
# Storage Account
# -----------------------------------------------------------------------------
resource "azurerm_storage_account" "cerebro" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.cerebro.name
  location                 = azurerm_resource_group.cerebro.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  tags = {
    project = "cerebro"
  }
}

# Container for file attachments
resource "azurerm_storage_container" "files" {
  name                  = "cerebro-files"
  storage_account_id    = azurerm_storage_account.cerebro.id
  container_access_type = "private"
}
