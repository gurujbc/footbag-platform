# =============================================================================
# SSM Parameter Store — /footbag/{env}/...
# All application secrets live here. SecureString type with KMS encryption.
#
# TODO: After apply, set actual secret values via AWS Console or CLI:
#   aws ssm put-parameter --name "/footbag/staging/app/secret_key" \
#     --value "$(openssl rand -hex 32)" --type SecureString \
#     --key-id alias/footbag-staging --overwrite
# =============================================================================

resource "aws_ssm_parameter" "app_port" {
  name  = "${local.ssm_prefix}/app/port"
  type  = "String"
  value = "3000"
}

resource "aws_ssm_parameter" "app_log_level" {
  name  = "${local.ssm_prefix}/app/log_level"
  type  = "String"
  value = "info"
}

resource "aws_ssm_parameter" "app_public_base_url" {
  name = "${local.ssm_prefix}/app/public_base_url"
  type = "String"
  # Set to the CloudFront default URL after first terraform apply.
  # Run: terraform output cloudfront_domain, then update this value and re-apply.
  # When a real domain is attached, change to "https://<your-domain>".
  value = "https://placeholder.cloudfront.net"
  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "app_db_path" {
  name  = "${local.ssm_prefix}/app/db_path"
  type  = "String"
  value = "/srv/footbag/footbag.db"
}

# ── Stripe (placeholder — payment deferred) ───────────────────────────────────
# TODO: Uncomment and populate when payment integration is implemented.
# resource "aws_ssm_parameter" "stripe_api_key" {
#   name   = "${local.ssm_prefix}/stripe/api_key"
#   type   = "SecureString"
#   key_id = aws_kms_key.main.arn
#   value  = "TODO-set-via-cli-after-apply"
#   lifecycle { ignore_changes = [value] }
# }

# ── SES (placeholder — email deferred) ───────────────────────────────────────
# resource "aws_ssm_parameter" "ses_sender" {
#   name   = "${local.ssm_prefix}/ses/sender_address"
#   type   = "SecureString"
#   key_id = aws_kms_key.main.arn
#   value  = "TODO-noreply@footbag.org"
#   lifecycle { ignore_changes = [value] }
# }
