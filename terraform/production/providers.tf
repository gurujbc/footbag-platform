# =============================================================================
# Providers — production
# Primary region: configured via var.aws_region
# us-east-1 alias: required for ACM certificates used with CloudFront
# =============================================================================

terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "footbag"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ACM certificates for CloudFront must exist in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "footbag"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
