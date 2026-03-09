# =============================================================================
# Variables — production
# Fill in terraform.tfvars (never commit the real values file).
# =============================================================================

variable "environment" {
  description = "Deployment environment name"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-2" # TODO: Confirm production region
}

variable "aws_account_id" {
  description = "AWS account ID (used in IAM resource ARNs)"
  type        = string
  # TODO: Fill in before apply
}

variable "domain_name" {
  description = "Apex domain served by CloudFront"
  type        = string
  default     = "footbag.org" # TODO: Confirm apex domain
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for domain_name"
  type        = string
  # TODO: Import or create the hosted zone, then fill in
}

variable "lightsail_bundle_id" {
  description = "Lightsail instance bundle (size)"
  type        = string
  default     = "small_3_0" # $10/mo — appropriate for production MVFP
}

variable "lightsail_blueprint_id" {
  description = "Lightsail OS blueprint"
  type        = string
  default     = "amazon_linux_2023"
}

variable "ssh_public_key" {
  description = "SSH public key to inject into the Lightsail instance"
  type        = string
  # TODO: Paste the contents of your production deploy key (~/.ssh/id_ed25519.pub)
}

variable "alarm_email" {
  description = "Email address for CloudWatch alarm SNS notifications"
  type        = string
  # TODO: Set to ops alert address
}

variable "state_bucket_suffix" {
  description = "Unique suffix appended to the Terraform state bucket name"
  type        = string
  # TODO: Must match the suffix used when provisioning terraform/shared
}
