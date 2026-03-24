# -----------------------------------------------------------------------------
# Azure OpenAI (Cognitive Services)
# Deployed to a separate region because model availability varies by region.
# -----------------------------------------------------------------------------
resource "azurerm_cognitive_account" "openai" {
  name                  = var.openai_account_name
  resource_group_name   = azurerm_resource_group.cerebro.name
  location              = var.openai_location
  kind                  = "OpenAI"
  sku_name              = "S0"
  custom_subdomain_name = var.openai_account_name

  tags = {
    project = "cerebro"
  }
}

# --- Model Deployments -------------------------------------------------------

resource "azurerm_cognitive_deployment" "embedding" {
  name                 = "text-embedding-3-small"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "text-embedding-3-small"
    version = "1"
  }

  sku {
    name     = "Standard"
    capacity = 120
  }
}

resource "azurerm_cognitive_deployment" "chat" {
  name                 = "gpt-4o-mini"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o-mini"
    version = "2024-07-18"
  }

  sku {
    name     = "Standard"
    capacity = 30
  }

  depends_on = [azurerm_cognitive_deployment.embedding]
}

resource "azurerm_cognitive_deployment" "vision" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-11-20"
  }

  sku {
    name     = "Standard"
    capacity = 30
  }

  depends_on = [azurerm_cognitive_deployment.chat]
}
