# =============================================================================
# SES sender identity.
# LiveSesAdapter (src/adapters/sesAdapter.ts) sends outbound mail via SES
# with the From: header set to this verified address. Target production
# value: noreply@footbag.org (once the domain is acquired). Substitute
# values for staging use a Google Workspace alias on a project-controlled
# domain; literal value lives in terraform.tfvars (gitignored), not here.
#
# The runtime role's ses:SendEmail grant on this identity is declared in
# iam.tf alongside the kms:Sign grant for JWT signing.
# =============================================================================

variable "ses_sender_identity" {
  description = <<-EOT
    SES-verified sender email address used as the From: header for outbound
    mail. Target canonical value: noreply@footbag.org. If the footbag.org
    domain is not yet available, use a substitute address on a controlled
    domain (recorded in local operator notes, not committed).
  EOT
  type        = string
}

resource "aws_ses_email_identity" "sender" {
  email = var.ses_sender_identity
}
