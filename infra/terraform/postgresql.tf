# -----------------------------------------------------------------------------
# PostgreSQL Flexible Server
# -----------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server" "cerebro" {
  name                          = var.postgresql_server_name
  resource_group_name           = azurerm_resource_group.cerebro.name
  location                      = azurerm_resource_group.cerebro.location
  version                       = "16"
  administrator_login           = var.postgresql_admin_username
  administrator_password        = var.postgresql_admin_password
  sku_name                      = "B_Standard_B1ms"
  storage_mb                    = 32768
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = true
  zone                          = "1"

  tags = {
    project = "cerebro"
  }
}

# Allow Azure services to connect (start/end IP 0.0.0.0)
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.cerebro.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Allowlist the pgvector extension
resource "azurerm_postgresql_flexible_server_configuration" "pgvector" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.cerebro.id
  value     = "vector"
}

# Database
resource "azurerm_postgresql_flexible_server_database" "cerebro" {
  name      = "cerebro"
  server_id = azurerm_postgresql_flexible_server.cerebro.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
