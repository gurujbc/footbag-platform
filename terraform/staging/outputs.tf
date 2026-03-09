# =============================================================================
# Outputs — staging
# =============================================================================

output "lightsail_static_ip" {
  description = "Static IP address of the Lightsail web instance"
  value       = aws_lightsail_static_ip.web.ip_address
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (used for cache invalidations)"
  value       = aws_cloudfront_distribution.main.id
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate attached to CloudFront"
  value       = aws_acm_certificate_validation.main.certificate_arn
}

output "snapshots_bucket_name" {
  description = "S3 bucket for SQLite DB snapshots"
  value       = aws_s3_bucket.snapshots.bucket
}

output "dr_bucket_name" {
  description = "Cross-region DR bucket for SQLite DB snapshots"
  value       = aws_s3_bucket.dr.bucket
}

output "maintenance_bucket_name" {
  description = "S3 bucket hosting the static maintenance page"
  value       = aws_s3_bucket.maintenance.bucket
}

output "kms_key_arn" {
  description = "ARN of the KMS key used for SSM parameter encryption"
  value       = aws_kms_key.main.arn
}

output "alarm_topic_arn" {
  description = "ARN of the SNS alarm notification topic"
  value       = aws_sns_topic.alarms.arn
}
