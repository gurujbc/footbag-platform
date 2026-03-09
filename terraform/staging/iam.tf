# =============================================================================
# IAM — Runtime role for the application
# The web container assumes this role to read SSM parameters at startup.
# Lightsail instances use EC2-compatible instance profiles for role assumption.
# =============================================================================

resource "aws_iam_role" "app_runtime" {
  name = "${local.prefix}-app-runtime"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "app_ssm_read" {
  name = "ssm-read"
  role = aws_iam_role.app_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadSSMParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/*"
      },
      {
        Sid    = "DecryptSSMParameters"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.main.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "app_s3_snapshots" {
  name = "s3-snapshots"
  role = aws_iam_role.app_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "WriteSnapshots"
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ]
      Resource = [
        aws_s3_bucket.snapshots.arn,
        "${aws_s3_bucket.snapshots.arn}/*"
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "app_runtime" {
  name = "${local.prefix}-app-runtime"
  role = aws_iam_role.app_runtime.name
}
