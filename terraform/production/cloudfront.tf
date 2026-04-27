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
# Origin: Lightsail static IP (nginx on port 80)
# TLS termination at edge using ACM certificate (us-east-1)
# Maintenance page fallback on 5xx from origin
# =============================================================================

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.prefix} distribution"
  default_root_object = ""
  price_class         = "PriceClass_100" # US + Europe — adjust for global reach

  aliases = [var.domain_name, "www.${var.domain_name}"]

  # ── Origin: Lightsail nginx ───────────────────────────────────────────────
  # CloudFront requires a resolvable DNS hostname; raw IPs are not supported.
  # Operator points var.lightsail_origin_dns at a real A record (e.g.
  # origin.footbag.org) that resolves to aws_lightsail_static_ip.web.ip_address.
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

  # ── Origin: S3 maintenance page ───────────────────────────────────────────
  origin {
    origin_id   = "s3-maintenance"
    domain_name = aws_s3_bucket.maintenance.bucket_regional_domain_name

    s3_origin_config {
      # TODO: Create an OAC and reference it here
      origin_access_identity = ""
    }
  }

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

  # ── Custom error: serve maintenance page on 5xx ──────────────────────────
  custom_error_response {
    error_code            = 502
    response_code         = 503
    response_page_path    = "/maintenance.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 503
    response_code         = 503
    response_page_path    = "/maintenance.html"
    error_caching_min_ttl = 10
  }

  # ── TLS ──────────────────────────────────────────────────────────────────
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
}
