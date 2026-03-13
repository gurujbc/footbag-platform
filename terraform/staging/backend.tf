# Remote state — S3 bucket provisioned by terraform/shared.

terraform {
  backend "s3" {
    bucket = "footbag-terraform-state-a1b2c3d4e5"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"

    # S3-native locking (requires AWS provider >= 5.x and bucket versioning)
    use_lockfile = true

    encrypt = true
  }
}
