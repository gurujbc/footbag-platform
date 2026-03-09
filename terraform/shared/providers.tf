terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Shared bootstrap uses local state — this directory provisions the S3
  # bucket that all other environments use as their remote backend.
  # Keep this state file backed up manually or in version control.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "footbag-platform"
      Environment = "shared"
      ManagedBy   = "terraform"
    }
  }
}
