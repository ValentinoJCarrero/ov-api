# ─── GCP ───────────────────────────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

# ─── Service ───────────────────────────────────────────────────────────────────

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "ovapy-api"
}

variable "docker_image" {
  description = "Full Docker image URL to deploy (from Artifact Registry)"
  type        = string
}

variable "service_memory" {
  description = "Memory allocated to each Cloud Run instance"
  type        = string
  default     = "512Mi"
}

variable "service_cpu" {
  description = "CPU allocated to each Cloud Run instance"
  type        = string
  default     = "1"
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 0
    error_message = "min_instances must be >= 0"
  }
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10

  validation {
    condition     = var.max_instances > 0
    error_message = "max_instances must be > 0"
  }
}

variable "timeout_seconds" {
  description = "Request timeout in seconds for Cloud Run"
  type        = number
  default     = 300

  validation {
    condition     = var.timeout_seconds >= 1 && var.timeout_seconds <= 3600
    error_message = "timeout_seconds must be between 1 and 3600"
  }
}

variable "allow_public_access" {
  description = "Allow unauthenticated access to the Cloud Run service"
  type        = bool
  default     = true
}

# ─── Database ──────────────────────────────────────────────────────────────────

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "ovapy"
}

variable "db_username" {
  description = "PostgreSQL user name"
  type        = string
  default     = "ovapy_user"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL user password"
  type        = string
  sensitive   = true
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "db_high_availability" {
  description = "Enable Cloud SQL high availability (REGIONAL)"
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Enable deletion protection on the Cloud SQL instance"
  type        = bool
  default     = true
}

# ─── Application ───────────────────────────────────────────────────────────────

variable "app_env" {
  description = "Application environment (production | development)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "development"], var.app_env)
    error_message = "app_env must be 'production' or 'development'"
  }
}

variable "admin_api_key" {
  description = "Master API key for /admin/* endpoints"
  type        = string
  sensitive   = true
}

variable "owner_jwt_secret" {
  description = "JWT signing secret for owner/staff authentication"
  type        = string
  sensitive   = true
}

# ─── WhatsApp ──────────────────────────────────────────────────────────────────

variable "whatsapp_token" {
  description = "Meta WhatsApp Cloud API bearer token"
  type        = string
  sensitive   = true
}

variable "ovapy_phone_number_id" {
  description = "Meta phone number ID for the Ovapy platform channel"
  type        = string
  sensitive   = true
}

variable "whatsapp_verify_token" {
  description = "Webhook verification token for Meta WhatsApp"
  type        = string
  sensitive   = true
}

# ─── OpenAI ────────────────────────────────────────────────────────────────────

variable "openai_api_key" {
  description = "OpenAI API key (used for gpt-4o-mini intent parsing)"
  type        = string
  sensitive   = true
}

# ─── Google Calendar OAuth2 ────────────────────────────────────────────────────

variable "google_client_id" {
  description = "Google OAuth2 client ID"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth2 client secret"
  type        = string
  sensitive   = true
}

# ─── Labels ────────────────────────────────────────────────────────────────────

variable "common_labels" {
  description = "Labels applied to all resources"
  type        = map(string)
  default = {
    project   = "ovapy-api"
    terraform = "true"
  }
}
