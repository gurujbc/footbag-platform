# =============================================================================
# Cache & origin-request policies
# Managed policies (data sources) for HTML and static assets; one custom cache
# policy for /media/* (query string in cache key, URL-versioned cache-bust).
# =============================================================================

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

data "aws_cloudfront_origin_request_policy" "cors_s3_origin" {
  name = "Managed-CORS-S3Origin"
}

resource "aws_cloudfront_cache_policy" "media_assets" {
  name        = "${local.prefix}-media-assets"
  comment     = "Edge cache for /media/* with query string in cache key (URL-versioned cache-bust)"
  min_ttl     = 0
  default_ttl = 604800   # 7 days; matches express.static maxAge
  max_ttl     = 31536000 # 1 year ceiling

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

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
  # CloudFront requires a resolvable DNS hostname — raw IPs are not supported.
  # Lightsail does not provide public DNS hostnames (unlike EC2).
  # publicDnsName in the Lightsail API always returns None.
  # For staging: set lightsail_origin_dns = "<static_ip>.nip.io"
  # For production: use a real DNS A record pointing to the static IP.
  # Set lightsail_origin_dns in terraform.tfvars before the second apply pass.
  origin {
    origin_id   = "lightsail-origin"
    domain_name = var.lightsail_origin_dns

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # nginx on Lightsail listens on 80
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = data.aws_ssm_parameter.origin_verify_secret.value
    }
  }

  # Maintenance-page S3 origin intentionally omitted (deferred).
  # Re-add when OAC, ordered_cache_behavior for /maintenance.html, bucket policy,
  # and the maintenance.html object all exist and are tested. See Path E, section 5.3.

  # ── Default cache behaviour ───────────────────────────────────────────────
  # All HTML uses CachingDisabled; origin (Express middleware) sets
  # Cache-Control on every authenticated response.
  default_cache_behavior {
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # ── Static assets — longer cache ─────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/css/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3_origin.id
  }

  # ── JavaScript — longer cache ──────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/js/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3_origin.id
  }

  # ── Images — longer cache ────────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/img/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3_origin.id
  }

  # ── Web fonts — longer cache ─────────────────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/fonts/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3_origin.id
  }

  # ── User-uploaded media — query-string in cache key (URL-versioned cache-bust) ─
  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = aws_cloudfront_cache_policy.media_assets.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # ── Health probes — pass through uncached ────────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/health/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # custom_error_response blocks for maintenance page intentionally omitted (deferred).
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
