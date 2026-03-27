# =============================================================================
# Remote state — S3 backend with native locking
# Requires AWS provider >= 5.x; bucket must exist before init.
# Run terraform/shared first to create the state bucket.
# =============================================================================

terraform {
  backend "s3" {
    # TODO: Set bucket to the name output by terraform/shared
    bucket       = "footbag-tfstate-TODO"
    key          = "production/terraform.tfstate"
    region       = "us-east-2" # TODO: Match var.aws_region
    use_lockfile = true        # Native S3 locking — no DynamoDB table required
    encrypt      = true
  }
}
