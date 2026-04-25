# =============================================================================
# KMS Keys
# One key per environment for SSM SecureString parameter encryption.
# =============================================================================

resource "aws_kms_key" "main" {
  description             = "${local.prefix} main encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowRootFullAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.aws_account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowSSMUse"
        Effect = "Allow"
        Principal = {
          Service = "ssm.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.prefix}"
  target_key_id = aws_kms_key.main.key_id
}

# =============================================================================
# JWT signing key — RSA-2048 asymmetric, SIGN_VERIFY.
# Used by KmsJwtAdapter (src/adapters/jwtSigningAdapter.ts) to sign session
# JWTs. alg=RS256; JWT header.kid must equal this key's ARN or an
# agreed-upon identifier for key rotation.
# =============================================================================

resource "aws_kms_key" "jwt_signing" {
  description              = "${local.prefix} JWT session signing key (RS256)"
  customer_master_key_spec = "RSA_2048"
  key_usage                = "SIGN_VERIFY"
  deletion_window_in_days  = 30
  # NOTE: asymmetric keys do not support automatic rotation. Rotation, when
  # implemented, is operator-driven (new key + alias swap + 24h overlap);
  # currently out of scope.

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowRootFullAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.aws_account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowRuntimeRoleSign"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.app_runtime.arn
        }
        Action = [
          "kms:Sign",
          "kms:GetPublicKey",
          "kms:DescribeKey"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_kms_alias" "jwt_signing" {
  name          = "alias/${local.prefix}-jwt"
  target_key_id = aws_kms_key.jwt_signing.key_id
}
