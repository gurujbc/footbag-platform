locals {
  # Short prefix used in resource names: "footbag-staging" or "footbag-production"
  prefix = "footbag-${var.environment}"

  # SSM parameter namespace: /footbag/staging/... or /footbag/production/...
  ssm_prefix = "/footbag/${var.environment}"

  # Common tags merged into every resource via provider default_tags
  common_tags = {
    Project     = "footbag-platform"
    Environment = var.environment
  }
}
