# =============================================================================
# Lightsail — Origin server
# Single instance + static IP + firewall rules.
# nginx + Docker Compose stack runs on this host.
# =============================================================================

resource "aws_lightsail_key_pair" "operator" {
  name       = "${local.prefix}-operator"
  public_key = var.ssh_public_key
}

resource "aws_lightsail_instance" "web" {
  name              = "${local.prefix}-web"
  availability_zone = "${var.aws_region}a"
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id
  key_pair_name     = aws_lightsail_key_pair.operator.name

  # user_data is intentionally omitted.
  # All host bootstrap (Docker CE install, /srv/footbag directory setup,
  # systemd service install) is performed manually via SSH after first apply.
  # See section 4.7 of docs/DEV_ONBOARDING_V0_1.md.
}

resource "aws_lightsail_static_ip" "web" {
  name = "${local.prefix}-web-ip"
}

resource "aws_lightsail_static_ip_attachment" "web" {
  static_ip_name = aws_lightsail_static_ip.web.name
  instance_name  = aws_lightsail_instance.web.name
}

resource "aws_lightsail_instance_public_ports" "web" {
  instance_name = aws_lightsail_instance.web.name

  # SSH — restricted to declared operator IP ranges.
  # Set operator_cidrs in terraform.tfvars before first apply.
  # Example: operator_cidrs = ["1.2.3.4/32"]
  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.operator_cidrs
  }

  # HTTP — CloudFront connects on 80; nginx proxies to app container
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  # SSH alternate port — operator access when port 22 is ISP-blocked
  # Some ISPs block outbound port 22 to AWS EC2 IP ranges.
  # sshd is configured to listen on both 22 and 2222 on the host.
  port_info {
    protocol  = "tcp"
    from_port = 2222
    to_port   = 2222
    cidrs     = var.operator_cidrs
  }

  # HTTPS — not terminated at Lightsail; CloudFront handles TLS
  # Kept closed unless direct-to-origin TLS is needed.
}
