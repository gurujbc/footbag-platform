# Remote state — S3 bucket provisioned by terraform/shared.
# Run `terraform/shared` first to create the bucket, then fill in values below.
#
# TODO: Replace all TODO values before running `terraform init`.

terraform {
  backend "s3" {
    # TODO: Set to the bucket name output from terraform/shared
    bucket = "footbag-terraform-state-TODO-set-unique-suffix"
    key    = "staging/terraform.tfstate"
    region = "us-east-1"

    # S3-native locking (requires AWS provider >= 5.x and bucket versioning)
    use_lockfile = true

    encrypt = true
  }
}
