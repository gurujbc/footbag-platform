# =============================================================================
# S3 Buckets
# - media:        processed photo objects and media assets
# - snapshots:    5-minute SQLite WAL snapshots (primary backup)
# - dr:           nightly cross-region DR copies (Object Lock)
# - maintenance:  static maintenance page served by CloudFront during outages
# =============================================================================

locals {
  buckets = {
    media       = "${local.prefix}-media"
    snapshots   = "${local.prefix}-snapshots"
    dr          = "${local.prefix}-dr"
    maintenance = "${local.prefix}-maintenance"
  }
}

# ── Helper: private bucket baseline ──────────────────────────────────────────
# Applied to all buckets except maintenance (which needs CloudFront OAC access)

resource "aws_s3_bucket" "media" {
  bucket = local.buckets.media
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket" "snapshots" {
  bucket = local.buckets.snapshots
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket" "dr" {
  bucket = local.buckets.dr
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket" "maintenance" {
  bucket = local.buckets.maintenance
}

# ── Versioning ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_versioning" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_versioning" "dr" {
  bucket = aws_s3_bucket.dr.id
  versioning_configuration { status = "Enabled" }
}

# ── Encryption ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr" {
  bucket = aws_s3_bucket.dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Block public access on all private buckets ────────────────────────────────

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket                  = aws_s3_bucket.snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "dr" {
  bucket                  = aws_s3_bucket.dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Snapshot lifecycle — expire old versions after 90 days ───────────────────

resource "aws_s3_bucket_lifecycle_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id

  rule {
    id     = "expire-old-snapshot-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ── DR bucket: Object Lock for tamper-evident retention ──────────────────────
# NOTE: Object Lock must be enabled at bucket creation time.
# TODO: Add object_lock_configuration after confirming retention policy with ops.

# =============================================================================
# Media DR bucket (us-west-2) — cross-region replication target for the
# primary media bucket. Object Lock intentionally not applied: photo deletion
# must propagate to the DR side to honor member-account-erasure (DD §1.5
# "When member deletes account: member's photos automatically hard-deleted").
# Operator-recovery headroom comes from versioning + 30-day noncurrent
# expiration on both source and destination.
# =============================================================================

resource "aws_s3_bucket" "media_dr" {
  provider = aws.us_west_2
  bucket   = "${local.prefix}-media-dr"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "media_dr" {
  provider = aws.us_west_2
  bucket   = aws_s3_bucket.media_dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media_dr" {
  provider = aws.us_west_2
  bucket   = aws_s3_bucket.media_dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "media_dr" {
  provider                = aws.us_west_2
  bucket                  = aws_s3_bucket.media_dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Media lifecycle — expire old versions after 30 days on both buckets ──────
# Avatar keys are stable per member, so replacement uploads overwrite-in-place
# under versioning. Without expiration, every replacement would accumulate old
# bytes forever. 30 days gives operator headroom to restore prior versions.

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-old-media-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media_dr" {
  provider = aws.us_west_2
  bucket   = aws_s3_bucket.media_dr.id

  rule {
    id     = "expire-old-media-dr-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── Cross-region replication: media → media_dr ───────────────────────────────
# Continuous, RPO < 15 min. ONEZONE_IA destination storage class for cost
# savings on DR. Delete markers are replicated so account-erasure deletions
# propagate.

resource "aws_s3_bucket_replication_configuration" "media" {
  # Replication requires versioning enabled on BOTH source and destination.
  # Without listing the destination, terraform schedules them in parallel and
  # S3 rejects the PutBucketReplication call before destination versioning
  # state propagates.
  depends_on = [
    aws_s3_bucket_versioning.media,
    aws_s3_bucket_versioning.media_dr,
  ]

  role   = aws_iam_role.s3_replication.arn
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "replicate-all-to-media-dr"
    status = "Enabled"
    filter {}
    delete_marker_replication { status = "Enabled" }

    destination {
      bucket        = aws_s3_bucket.media_dr.arn
      storage_class = "ONEZONE_IA"
    }
  }
}

# ── CloudFront OAC read access on media bucket ───────────────────────────────
# Grants the CloudFront distribution s3:GetObject. Restricted to this distribution
# via aws:SourceArn so the bucket cannot be read through any other CloudFront
# distribution. Web role (app_runtime) has Put/Delete/Head only -- CloudFront-OAC
# is the sole read path.

data "aws_iam_policy_document" "media_cloudfront_oac" {
  count = var.enable_cloudfront ? 1 : 0

  statement {
    sid       = "AllowCloudFrontServicePrincipalRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.main[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  count  = var.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_cloudfront_oac[0].json
}
