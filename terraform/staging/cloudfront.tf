# =============================================================================
# CloudFront Distribution
# Origin: Lightsail public DNS hostname (nginx on port 80)
# TLS termination at edge using ACM certificate (us-east-1)
# =============================================================================

resource "aws_cloudfront_distribution" "main" {
  count = var.enable_cloudfront ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.prefix} distribution"
  default_root_object = ""
  price_class         = "PriceClass_100" # US + Europe — adjust for global reach

  # DEFERRED: custom domain aliases commented out for initial test deployment.
  # Uncomment and set domain_name + route53_zone_id in terraform.tfvars when
  # ready to attach a real domain. Also re-enable acm.tf and route53.tf.
  # aliases = [var.domain_name, "www.${var.domain_name}"]

  # ── Origin: Lightsail nginx ───────────────────────────────────────────────
  # Use the instance public DNS name, not the raw static IP.
  # CloudFront custom_origin_config requires a resolvable DNS hostname.
  # Retrieve the DNS name after the first apply (Lightsail only) and set
  # lightsail_origin_dns in terraform.tfvars before the second apply.
  origin {
    origin_id   = "lightsail-origin"
    domain_name = var.lightsail_origin_dns

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # nginx on Lightsail listens on 80
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # X-Origin-Verify header intentionally omitted.
    # Origin-bypass protection is deferred to Path E, section 5.3.
    # When implemented: provision a real secret in SSM, reference it here, and enforce it in nginx.
  }

  # Maintenance-page S3 origin intentionally omitted from v0.1.
  # Re-add when OAC, ordered_cache_behavior for /maintenance.html, bucket policy,
  # and the maintenance.html object all exist and are tested. See Path E, section 5.3.

  # ── Default cache behaviour ───────────────────────────────────────────────
  default_cache_behavior {
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    # Short TTL — server-rendered HTML should not be cached aggressively
    min_ttl     = 0
    default_ttl = 60
    max_ttl     = 300
  }

  # ── Static assets — longer cache ─────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/css/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400   # 1 day
    max_ttl     = 2592000 # 30 days
  }

  # ── Health probes — pass through uncached ────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/health/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # custom_error_response blocks for maintenance page intentionally omitted from v0.1.
  # Re-add together with the s3-maintenance origin and ordered_cache_behavior for /maintenance.html.

  # ── TLS ──────────────────────────────────────────────────────────────────
  # DEFERRED: switch to ACM certificate when real domain is attached.
  # See acm.tf and route53.tf (currently commented out).
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
}
