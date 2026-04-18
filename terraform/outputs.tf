# ─── Database ──────────────────────────────────────────────────────────────────

output "database_instance_name" {
  description = "Cloud SQL instance name"
  value       = google_sql_database_instance.postgres.name
}

output "database_host" {
  description = "Cloud SQL public IP address"
  value       = google_sql_database_instance.postgres.ip_address[0].ip_address
  sensitive   = true
}

output "database_name" {
  description = "Database name"
  value       = google_sql_database.database.name
}

output "database_connection_name" {
  description = "Cloud SQL connection name (project:region:instance)"
  value       = google_sql_database_instance.postgres.connection_name
}

output "database_url" {
  description = "Full DATABASE_URL for the application"
  value       = "postgresql://${var.db_username}:${var.db_password}@${google_sql_database_instance.postgres.ip_address[0].ip_address}:5432/${var.db_name}"
  sensitive   = true
}

# ─── Cloud Run ─────────────────────────────────────────────────────────────────

output "service_url" {
  description = "Public URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.app.uri
}

output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.app.name
}

output "service_id" {
  description = "Cloud Run service ID"
  value       = google_cloud_run_v2_service.app.id
}

output "service_location" {
  description = "Region where the Cloud Run service is deployed"
  value       = google_cloud_run_v2_service.app.location
}

output "health_check_url" {
  description = "Health check endpoint"
  value       = "${google_cloud_run_v2_service.app.uri}/health"
}


output "google_redirect_uri" {
  description = "Google OAuth2 redirect URI to register in Google Cloud Console"
  value       = "${google_cloud_run_v2_service.app.uri}/admin/staff/google/callback"
}

output "whatsapp_webhook_url" {
  description = "WhatsApp webhook URL to register in Meta Developer Console"
  value       = "${google_cloud_run_v2_service.app.uri}/webhook"
}

# ─── Deployment ────────────────────────────────────────────────────────────────

output "deployed_image" {
  description = "Docker image deployed"
  value       = var.docker_image
}

output "environment" {
  description = "Deployment environment"
  value       = var.app_env
}

output "deployment_summary" {
  description = "Full deployment summary"
  sensitive   = true
  value = {
    service_url           = google_cloud_run_v2_service.app.uri
    environment           = var.app_env
    region                = var.region
    docker_image          = var.docker_image
    db_instance           = google_sql_database_instance.postgres.name
    db_connection_name    = google_sql_database_instance.postgres.connection_name
    health_check_url      = "${google_cloud_run_v2_service.app.uri}/health"
    whatsapp_webhook_url  = "${google_cloud_run_v2_service.app.uri}/webhook"
    google_redirect_uri   = "${google_cloud_run_v2_service.app.uri}/admin/staff/google/callback"
  }
}
