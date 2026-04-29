terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}

# Primary region — Lightsail, S3, SSM, CloudWatch, Route 53
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "footbag-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# us-east-1 alias required for ACM certificates used with CloudFront
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "footbag-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# us-west-2 alias for the media DR bucket (cross-region replication target)
provider "aws" {
  alias  = "us_west_2"
  region = "us-west-2"

  default_tags {
    tags = {
      Project     = "footbag-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
