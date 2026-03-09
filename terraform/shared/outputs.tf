output "terraform_state_bucket_name" {
  description = "Name of the S3 bucket for Terraform remote state. Use this in staging/backend.tf and production/backend.tf."
  value       = aws_s3_bucket.terraform_state.bucket
}
