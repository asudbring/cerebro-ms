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
  subscription_id = "your-azure-subscription-id"
  features {}
}

# Entra ID app registrations live in the user's tenant
provider "azuread" {
  tenant_id = "your-entra-tenant-id"
}

provider "azapi" {}
