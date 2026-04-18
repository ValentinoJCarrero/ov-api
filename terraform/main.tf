locals {
  db_instance_name   = "ovapy-prod"
  service_name       = var.service_name
  db_availability    = var.db_high_availability ? "REGIONAL" : "ZONAL"
  db_max_connections = 100
}

# ─── Cloud SQL ─────────────────────────────────────────────────────────────────

resource "google_sql_database_instance" "postgres" {
  name             = local.db_instance_name
  database_version = "POSTGRES_15"
  region           = var.region
  project          = var.project_id

  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    availability_type = local.db_availability

    ip_configuration {
      ipv4_enabled = true

      authorized_networks {
        name  = "all"
        value = "0.0.0.0/0"
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
      point_in_time_recovery_enabled = false
    }

    insights_config {
      query_insights_enabled = true
    }

    database_flags {
      name  = "max_connections"
      value = tostring(local.db_max_connections)
    }
  }

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_database" "database" {
  name     = var.db_name
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
}

resource "google_sql_user" "user" {
  name     = var.db_username
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
  project  = var.project_id
}

# ─── Cloud Run ─────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "app" {
  name     = local.service_name
  location = var.region
  project  = var.project_id

  labels = var.common_labels

  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.docker_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          memory = var.service_memory
          cpu    = var.service_cpu
        }
      }

      # ── Database ────────────────────────────────────────────────────────────
      env {
        name  = "DATABASE_URL"
        value = "postgresql://${var.db_username}:${var.db_password}@${google_sql_database_instance.postgres.ip_address[0].ip_address}:5432/${var.db_name}"
      }

      # ── Application ─────────────────────────────────────────────────────────
      env {
        name  = "NODE_ENV"
        value = var.app_env
      }

      env {
        name  = "ADMIN_API_KEY"
        value = var.admin_api_key
      }

      env {
        name  = "OWNER_JWT_SECRET"
        value = var.owner_jwt_secret
      }

      # ── WhatsApp ────────────────────────────────────────────────────────────
      env {
        name  = "WHATSAPP_TOKEN"
        value = var.whatsapp_token
      }

      env {
        name  = "OVAPY_PHONE_NUMBER_ID"
        value = var.ovapy_phone_number_id
      }

      env {
        name  = "WHATSAPP_VERIFY_TOKEN"
        value = var.whatsapp_verify_token
      }

      # ── OpenAI ──────────────────────────────────────────────────────────────
      env {
        name  = "OPENAI_API_KEY"
        value = var.openai_api_key
      }

      # ── Google Calendar ─────────────────────────────────────────────────────
      env {
        name  = "GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }

      env {
        name  = "GOOGLE_CLIENT_SECRET"
        value = var.google_client_secret
      }

      env {
        name  = "GOOGLE_REDIRECT_URI"
        value = var.google_redirect_uri
      }

      # ── Startup probe (allows Prisma migrations to complete) ─────────────────
      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 30
        period_seconds        = 10
        failure_threshold     = 10
        timeout_seconds       = 5
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 0
        period_seconds        = 30
        failure_threshold     = 3
        timeout_seconds       = 5
      }
    }

    timeout = "${var.timeout_seconds}s"
  }

  depends_on = [
    google_project_service.run,
    google_sql_user.user,
  ]
}

# ─── Custom Domain ─────────────────────────────────────────────────────────────

resource "google_cloud_run_domain_mapping" "domain" {
  location = var.region
  name     = "backend.ovapy.com"
  project  = var.project_id

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.app.name
  }

  depends_on = [google_cloud_run_v2_service.app]
}

# ─── IAM ───────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count = var.allow_public_access ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
