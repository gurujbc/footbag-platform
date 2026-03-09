# =============================================================================
# Locals — production
# =============================================================================

locals {
  prefix     = "footbag-${var.environment}"
  ssm_prefix = "/footbag/${var.environment}"
}
