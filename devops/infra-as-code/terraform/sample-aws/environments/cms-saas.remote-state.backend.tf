# cms-saas: the remote-state stack's own state, kept in the bucket that stack
# created, under its own key. remote-state/ has no backend block (it bootstraps
# the bucket), so copy this in as an override before init:
#   cp environments/cms-saas.remote-state.backend.tf remote-state/backend_override.tf
#   cd remote-state && terraform init -reconfigure && terraform plan -var=bucket_name=ccrs-prod-tfstate-349271159511
terraform {
  backend "s3" {
    bucket         = "ccrs-prod-tfstate-349271159511"
    key            = "remote-state/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "ccrs-prod-tfstate-349271159511"
    encrypt        = true
  }
}
