# -----------------------------------------------------------------------------
# General
# -----------------------------------------------------------------------------
variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "centralus"
}

variable "resource_group_name" {
  description = "Name of the resource group"
  type        = string
  default     = "cerebro-rg"
}

# -----------------------------------------------------------------------------
# PostgreSQL
# -----------------------------------------------------------------------------
variable "postgresql_server_name" {
  description = "Name of the PostgreSQL Flexible Server"
  type        = string
  default     = "cerebro-db"
}

variable "postgresql_admin_username" {
  description = "PostgreSQL administrator username"
  type        = string
  default     = "cerebroadmin"
}

variable "postgresql_admin_password" {
  description = "PostgreSQL administrator password"
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Azure OpenAI
# -----------------------------------------------------------------------------
variable "openai_account_name" {
  description = "Name of the Azure OpenAI (Cognitive Services) account"
  type        = string
  default     = "cerebro-openai"
}

variable "openai_location" {
  description = "Region for Azure OpenAI (may differ from primary region due to model availability)"
  type        = string
  default     = "eastus2"
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
variable "storage_account_name" {
  description = "Name of the Storage Account (must be globally unique, lowercase, no hyphens)"
  type        = string
  default     = "cerebrostorage"
}

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
variable "function_app_name" {
  description = "Name of the Azure Function App"
  type        = string
  default     = "cerebro-func"
}

# -----------------------------------------------------------------------------
# API Management
# -----------------------------------------------------------------------------
variable "apim_name" {
  description = "Name of the API Management instance"
  type        = string
  default     = "cerebro-apim"
}

variable "apim_publisher_email" {
  description = "Publisher email for API Management"
  type        = string
}

variable "apim_publisher_name" {
  description = "Publisher name for API Management"
  type        = string
  default     = "Cerebro Admin"
}

# -----------------------------------------------------------------------------
# Entra ID tenant
# -----------------------------------------------------------------------------
variable "entra_tenant_id" {
  description = "Entra ID tenant for app registrations"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Email / Digest
# -----------------------------------------------------------------------------
variable "digest_email_recipient" {
  description = "Email address to receive digest summaries"
  type        = string
  default     = ""
}
