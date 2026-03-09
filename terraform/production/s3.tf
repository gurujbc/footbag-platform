# =============================================================================
# S3 Buckets
#   - media:       user-facing media (future use)
#   - snapshots:   SQLite DB snapshots (primary)
#   - dr:          cross-region DR copy of snapshots
#   - maintenance: static maintenance page served by CloudFront on 5xx
# =============================================================================

# ── Media ─────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "media" {
  bucket = "${local.prefix}-media"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Snapshots (primary) ───────────────────────────────────────────────────────

resource "aws_s3_bucket" "snapshots" {
  bucket = "${local.prefix}-db-snapshots"
}

resource "aws_s3_bucket_versioning" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  versioning_configuration { status = "Enabled" }
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

resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket                  = aws_s3_bucket.snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

# ── DR bucket (cross-region) ──────────────────────────────────────────────────
# TODO: Configure replication rule on snapshots bucket to replicate to dr bucket.

resource "aws_s3_bucket" "dr" {
  bucket = "${local.prefix}-db-snapshots-dr"
}

resource "aws_s3_bucket_versioning" "dr" {
  bucket = aws_s3_bucket.dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr" {
  bucket = aws_s3_bucket.dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "dr" {
  bucket                  = aws_s3_bucket.dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Maintenance page ──────────────────────────────────────────────────────────

resource "aws_s3_bucket" "maintenance" {
  bucket = "${local.prefix}-maintenance"
}

resource "aws_s3_bucket_public_access_block" "maintenance" {
  bucket                  = aws_s3_bucket.maintenance.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
