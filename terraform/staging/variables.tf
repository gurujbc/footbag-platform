# =============================================================================
# Environment variables — staging
# Copy this file to terraform.tfvars and fill in all TODO values before apply.
# See terraform.tfvars.example for a template.
# =============================================================================

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "Primary AWS region for this environment."
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "12-digit AWS account ID. # TODO: fill in."
  type        = string
}

# ── Domain ────────────────────────────────────────────────────────────────────

variable "domain_name" {
  description = <<-EOT
    Primary domain name for this environment.
    DEFERRED: not used in test deployment mode (CloudFront default URL).
    Set to e.g. "staging.footbag.org" when attaching a real domain.
  EOT
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = <<-EOT
    Route 53 hosted zone ID for var.domain_name.
    DEFERRED: not used in test deployment mode (CloudFront default URL).
    Set when attaching a real domain (see acm.tf activation checklist).
  EOT
  type        = string
  default     = ""
}

# ── Lightsail ─────────────────────────────────────────────────────────────────

variable "lightsail_bundle_id" {
  description = <<-EOT
    Lightsail instance bundle (size).
    # TODO: Choose based on expected traffic. Recommended starting points:
    #   staging:    "nano_3_0"    (1 vCPU, 512 MB RAM, $3.50/mo)
    #   production: "small_3_0"   (1 vCPU, 2 GB RAM,  $10/mo)
    Run: aws lightsail get-bundles --query 'bundles[*].[bundleId,price]'
  EOT
  type        = string
  default     = "nano_3_0"
}

variable "lightsail_blueprint_id" {
  description = "Lightsail OS blueprint. Amazon Linux 2023 recommended."
  type        = string
  default     = "amazon_linux_2023"
}

variable "ssh_public_key" {
  description = <<-EOT
    SSH public key for operator access to the Lightsail instance.
    # TODO: Paste the contents of your operator's ~/.ssh/id_ed25519.pub (or similar).
    Each operator needs a named account.
  EOT
  type        = string
}

# ── Notifications ─────────────────────────────────────────────────────────────

variable "alarm_email" {
  description = "Email address for CloudWatch alarm notifications. # TODO: fill in."
  type        = string
}

# ── State bucket ──────────────────────────────────────────────────────────────

variable "state_bucket_suffix" {
  description = "Unique suffix used in the state bucket name. Must match backend.tf."
  type        = string
}

# ── Operator access ───────────────────────────────────────────────────────────

variable "operator_cidrs" {
  description = <<-EOT
    List of CIDR ranges permitted to SSH into the Lightsail instance.
    Must be set before first apply. Do not leave as 0.0.0.0/0.
    Example: ["1.2.3.4/32"]
    To find your current public IP: curl -s https://checkip.amazonaws.com
  EOT
  type        = list(string)
}

# ── CloudFront bootstrap ──────────────────────────────────────────────────────

variable "lightsail_origin_dns" {
  description = <<-EOT
    Resolvable DNS hostname used as the CloudFront custom origin domain_name.
    CloudFront requires a DNS hostname — a raw IP address is not supported.
    Lightsail does not provide public DNS hostnames (unlike EC2). The
    publicDnsName field in the Lightsail API always returns None.
    For staging: construct from the static IP Terraform output using nip.io:
      lightsail_origin_dns = "<static_ip>.nip.io"
      e.g. lightsail_origin_dns = "34.192.250.246.nip.io"
    For production: use a real DNS A record pointing to the static IP,
    e.g. origin.staging.footbag.org. Do not use nip.io in production.
    Set this value and enable_cloudfront = true for the second apply pass.
    Leave as empty string for the first apply pass (set enable_cloudfront = false).
  EOT
  type        = string
  default     = ""
}

variable "enable_cloudfront" {
  description = <<-EOT
    Controls whether the CloudFront distribution is created.
    Set to false for the first apply pass (creates Lightsail only).
    After constructing the nip.io hostname from the static IP Terraform output
    (staging) or creating a real DNS A record (production), set
    lightsail_origin_dns and set this to true for the second apply pass.
  EOT
  type        = bool
  default     = false
}

# ── Monitoring gates ──────────────────────────────────────────────────────────

variable "enable_cwagent_alarms" {
  description = <<-EOT
    Set to true only after the CloudWatch agent is installed and running on
    the Lightsail host and is confirmed to be emitting CPUUtilization and
    mem_used_percent metrics to the CWAgent namespace.
    Enabling before the agent exists creates alarms that immediately enter
    INSUFFICIENT_DATA and train operators to ignore monitoring.
  EOT
  type        = bool
  default     = false
}

variable "enable_backup_alarm" {
  description = <<-EOT
    Set to true only after the SQLite backup job exists, runs on schedule,
    and is confirmed to emit BackupAgeMinutes to the
    Footbag/{environment} CloudWatch namespace after each run.
    Enabling before the job exists causes the alarm to immediately enter
    ALARM state (treat_missing_data = "breaching") and fire constantly.
  EOT
  type        = bool
  default     = false
}
