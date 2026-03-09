# =============================================================================
# Lightsail — web instance + static IP
# =============================================================================

resource "aws_lightsail_instance" "web" {
  name              = "${local.prefix}-web"
  availability_zone = "${var.aws_region}a"
  blueprint_id      = var.lightsail_blueprint_id
  bundle_id         = var.lightsail_bundle_id

  # Cloud-init: install Docker + inject SSH key
  user_data = <<-EOF
    #!/bin/bash
    amazon-linux-extras install docker -y || dnf install -y docker
    systemctl enable --now docker
    usermod -aG docker ec2-user
    mkdir -p /home/ec2-user/.ssh
    echo "${var.ssh_public_key}" >> /home/ec2-user/.ssh/authorized_keys
    chmod 600 /home/ec2-user/.ssh/authorized_keys
  EOF

  tags = {
    Role = "web"
  }
}

resource "aws_lightsail_static_ip" "web" {
  name = "${local.prefix}-web-ip"
}

resource "aws_lightsail_static_ip_attachment" "web" {
  static_ip_name = aws_lightsail_static_ip.web.name
  instance_name  = aws_lightsail_instance.web.name
}

# ── Firewall rules ────────────────────────────────────────────────────────────

resource "aws_lightsail_instance_public_ports" "web" {
  instance_name = aws_lightsail_instance.web.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
  }

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
  }
}
