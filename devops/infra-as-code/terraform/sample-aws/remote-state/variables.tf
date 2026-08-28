variable "bucket_name" {
  description = "Globally-unique name for the S3 bucket + DynamoDB lock table that hold Terraform state. Pass with -var=\"bucket_name=...\" (see DEPLOYMENT.MD)."
}