terraform {
  cloud {
    organization = "Ovapy"

    workspaces {
      tags = ["ovapy-api"]
    }
  }
}
