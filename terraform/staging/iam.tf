# =============================================================================
# IAM — Runtime role for the application
#
# DEFERRED — bootstrap shortcut (NS-8):
# Lightsail instances do NOT support EC2 instance profiles natively. These
# resources are created as groundwork for future use but are not attached to
# or used by the Lightsail instance in the current deployment.
#
# The current app reads process.env only and makes no runtime AWS API calls.
# When the app begins calling AWS APIs (S3 for media, SES, SSM reads at
# startup, etc.), the first step is to add credentials to /srv/footbag/env.
# The longer-term plan is to wire up this role via a source-profile +
# AssumeRole chain per service (web vs worker). See docs §33 and NS-8.
# =============================================================================

resource "aws_iam_role" "app_runtime" {
  name = "${local.prefix}-app-runtime"

  # Trusts:
  #   - footbag-staging-source-profile (host runtime path; long-lived keys
  #     live on the staging Lightsail host at /root/.aws/credentials)
  #   - footbag-operator (operator-workstation chained-AssumeRole path used
  #     by tests/smoke/staging-readiness.test.ts via
  #     AWS_PROFILE=footbag-staging-runtime)
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "TrustHostAndOperator"
      Effect = "Allow"
      Principal = {
        AWS = [
          aws_iam_user.source_profile.arn,
          "arn:aws:iam::${var.aws_account_id}:user/footbag-operator"
        ]
      }
      Action = "sts:AssumeRole"
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

# Media bucket access for the app: PutObject (avatar upload) + DeleteObject
# (account erasure) + GetObject (required for HeadObject existence check, per
# AWS docs — there is no separate s3:HeadObject action). ListBucket retained
# so HEAD on missing keys returns 404 NoSuchKey rather than 403 AccessDenied
# (better error semantics for callers). Despite the GetObject grant, the app
# does NOT fetch object bytes — the only call site is adapter.exists() via
# HeadObject. CloudFront-OAC remains the sole serving read path; code review
# enforces this (no GetObjectCommand import in src/adapters/photoStorageAdapter.ts).
resource "aws_iam_role_policy" "app_s3_media" {
  name = "s3-media"
  role = aws_iam_role.app_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadWriteMediaObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Sid      = "HeadMediaObjects"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.media.arn
      }
    ]
  })
}

# JwtSigning grants here are redundant with the role-direct grant in the JWT
# key policy (aws_kms_key.jwt_signing). Kept for parity with the live IAM
# policy attached during Path H bootstrap and to keep SES Send authorization
# alongside the JWT signing grants in one statement set.
# OutboundEmail uses identity/* because SES sandbox mode IAM-checks both
# sender and recipient identities per send call; tighten to the sender ARN
# only after SES production access lands.
resource "aws_iam_role_policy" "app_jwt_ses" {
  name = "${local.prefix}-app-runtime-jwt-ses"
  role = aws_iam_role.app_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "JwtSigning"
        Effect = "Allow"
        Action = [
          "kms:Sign",
          "kms:GetPublicKey"
        ]
        Resource = aws_kms_key.jwt_signing.arn
      },
      {
        Sid      = "OutboundEmail"
        Effect   = "Allow"
        Action   = "ses:SendEmail"
        Resource = "arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "app_runtime" {
  name = "${local.prefix}-app-runtime"
  role = aws_iam_role.app_runtime.name
}

# =============================================================================
# Source-profile IAM user.
# Long-lived keys live on the staging Lightsail host at /root/.aws/credentials
# (root-owned, 0600); the host SDK uses them as the source profile of the
# AssumeRole chain into app_runtime. Console access disabled. Permission is
# scoped to sts:AssumeRole on app_runtime via the inline policy below.
#
# Do not delete-and-recreate this user as a rotation strategy. AWS resolves
# the runtime role's trust principal to this user's internal unique ID at
# trust-policy save time; recreation produces a different unique ID and
# silently breaks AssumeRole. Rotate via "second access key under the same
# user".
# =============================================================================

resource "aws_iam_user" "source_profile" {
  name          = "${local.prefix}-source-profile"
  force_destroy = false
}

resource "aws_iam_user_policy" "source_profile_assume_role" {
  name = "${local.prefix}-source-profile-assume-role"
  user = aws_iam_user.source_profile.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AssumeRuntimeRole"
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = aws_iam_role.app_runtime.arn
    }]
  })
}

# =============================================================================
# CWAgent publisher IAM user (long-lived static keys).
# Lightsail does not support EC2 instance profiles, and CWAgent's
# common-config.toml does not honor source_profile chaining: the agent reads
# only the static credentials file, not config-file profile chains. This user
# provides static credentials for CWAgent only, scoped to PutMetricData on
# the CWAgent namespace.
#
# Key creation is out-of-band (aws iam create-access-key) per the source-
# profile pattern; secret stored in the operator vault and dropped into
# /root/.aws/credentials on the host. Rotate via "second access key under
# the same user", never delete-and-recreate.
# =============================================================================

resource "aws_iam_user" "cwagent_publisher" {
  name          = "${local.prefix}-cwagent-publisher"
  force_destroy = false
}

resource "aws_iam_user_policy" "cwagent_publisher_putmetric" {
  name = "${local.prefix}-cwagent-publisher-putmetric"
  user = aws_iam_user.cwagent_publisher.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "CWAgentMetrics"
      Effect   = "Allow"
      Action   = "cloudwatch:PutMetricData"
      Resource = "*"
      Condition = {
        StringEquals = {
          "cloudwatch:namespace" = "CWAgent"
        }
      }
    }]
  })
}

# =============================================================================
# S3 cross-region replication role for the media bucket.
# Separate from app_runtime: the principal of trust is s3.amazonaws.com,
# not the application. Combining would muddy each role's purpose.
# =============================================================================

resource "aws_iam_role" "s3_replication" {
  name = "${local.prefix}-s3-replication"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TrustS3"
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "s3_replication" {
  name = "media-replication"
  role = aws_iam_role.s3_replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SourceBucketRead"
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.media.arn
      },
      {
        Sid    = "SourceObjectRead"
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        Sid    = "DestinationObjectWrite"
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = "${aws_s3_bucket.media_dr.arn}/*"
      }
    ]
  })
}
