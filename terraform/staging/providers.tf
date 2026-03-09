terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
