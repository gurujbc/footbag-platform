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
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr" {
  bucket = aws_s3_bucket.dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
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
