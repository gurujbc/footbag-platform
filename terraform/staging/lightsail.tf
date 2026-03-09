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

  # User data bootstraps Docker, Docker Compose, and pulls the app image.
  # TODO: Replace with actual bootstrap script or reference a file:
  #   user_data = file("${path.module}/scripts/bootstrap.sh")
  user_data = <<-BOOTSTRAP
    #!/bin/bash
    # TODO: add Docker install, docker compose plugin, app directory setup
    echo "bootstrap placeholder"
  BOOTSTRAP
}

resource "aws_lightsail_static_ip" "web" {
  name = "${local.prefix}-web"
}

resource "aws_lightsail_static_ip_attachment" "web" {
  static_ip_name = aws_lightsail_static_ip.web.name
  instance_name  = aws_lightsail_instance.web.name
}

resource "aws_lightsail_instance_public_ports" "web" {
  instance_name = aws_lightsail_instance.web.name

  # SSH — restrict to operator IPs in production
  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    # TODO: Restrict cidrs to operator IP ranges in production:
    # cidrs = ["<operator-ip>/32"]
    cidrs = ["0.0.0.0/0"]
  }

  # HTTP — CloudFront connects on 80; nginx proxies to app container
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  # HTTPS — not terminated at Lightsail; CloudFront handles TLS
  # Kept closed unless direct-to-origin TLS is needed.
}
