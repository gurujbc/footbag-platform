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

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
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
# Origin Access Control for the media bucket
# Lets the CloudFront distribution read S3 objects via SigV4 without making the
# bucket public. Paired with aws_s3_bucket_policy.media in s3.tf.
# =============================================================================

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "${local.prefix}-media-oac"
  description                       = "OAC for media bucket (URL-versioned cache-bust + immutable PUTs)"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# =============================================================================
# CloudFront Function: strip /media/ prefix from viewer-request URI
# DD §1.5 says local-fs and S3 layouts mirror exactly, so S3 keys do NOT have
# a /media/ prefix. The /media/ on URLs is an Express-route convention. When
# CloudFront forwards to S3, this function rewrites the URI so the origin sees
# the actual S3 key. Without it, S3 looks up media/avatars/... and 404s.
# =============================================================================

resource "aws_cloudfront_function" "strip_media_prefix" {
  count   = var.enable_cloudfront ? 1 : 0
  name    = "${local.prefix}-strip-media-prefix"
  runtime = "cloudfront-js-2.0"
  publish = true
  comment = "Strips /media/ from viewer-request URI before forwarding to S3 origin (DD §1.5)"
  code    = file("${path.module}/cloudfront-functions/strip-media-prefix.js")
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

  # ── Origin: media bucket via OAC ──────────────────────────────────────────
  # CloudFront reads processed photo objects directly from S3. App writes are
  # handled by the app_runtime IAM policy (Put/Delete/Head only); reads flow
  # exclusively through this origin via OAC, never via direct S3 GetObject.
  origin {
    origin_id                = "media-s3-origin"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  # Maintenance-page S3 origin intentionally omitted (deferred).
  # Re-add when OAC, ordered_cache_behavior for /maintenance.html, bucket policy,
  # and the maintenance.html object all exist and are tested. See Path E, section 5.3.

  # ── Default cache behaviour ───────────────────────────────────────────────
  # All HTML uses CachingDisabled; origin (Express middleware) sets
  # Cache-Control on every authenticated response.
  # Origin request policy is AllViewerExceptHostHeader: forwards everything
  # EXCEPT Host. The canonical OAC-S3 pattern (DD §6.2) requires no Host
  # forwarding to an S3 origin; the AWS-recommended policy for any custom
  # HTTP origin (Lightsail nginx here) is the same. Avoiding AllViewer
  # uniformly prevents the bug class that bit /media/* before the fix.
  default_cache_behavior {
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
  }

  # ── Static assets — longer cache ─────────────────────────────────────────
  # WART: cors_s3_origin is the AWS-managed policy for S3 CORS preflight; it
  # forwards three CORS request headers to the origin. The four behaviors
  # below (/css/*, /js/*, /img/*, /fonts/*) target Lightsail nginx, not S3,
  # so the CORS forwarding is semantically misplaced but functionally
  # harmless (nginx ignores those headers for static assets). Future work:
  # switch to all_viewer_except_host_header or omit the origin request
  # policy entirely.
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
  # No origin_request_policy: OAC handles SigV4 signing, and forwarding the
  # viewer Host header to an S3 origin breaks virtual-host bucket routing.
  # AllViewer forwarded Host=<cloudfront-domain> to S3, so S3 could not map
  # the Host to any bucket and returned generic NotFound before the bucket
  # policy was even evaluated. With no origin request policy plus a cache
  # policy that forwards no headers/cookies, CloudFront sets Host to the S3
  # origin domain and the OAC signature matches.
  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "media-s3-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.media_assets.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_media_prefix[0].arn
    }
  }

  # ── Health probes — pass through uncached ────────────────────────────────
  # Origin request policy: AllViewerExceptHostHeader (see default_cache_behavior).
  ordered_cache_behavior {
    path_pattern           = "/health/*"
    target_origin_id       = "lightsail-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
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
