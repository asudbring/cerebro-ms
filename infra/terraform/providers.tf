terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    azapi = {
      source  = "azure/azapi"
      version = "~> 2.0"
    }
  }
}

provider "azurerm" {
  subscription_id = "7e9e8912-84f2-46b4-a6e4-8d743d1f9ee6"
  features {}
}

# Entra ID app registrations live in the sudbringlab tenant
provider "azuread" {
  tenant_id = "1e1cce84-0637-4693-99d9-27ff18dd65c8"
}

provider "azapi" {}
