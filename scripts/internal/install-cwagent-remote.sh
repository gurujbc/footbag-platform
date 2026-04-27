#!/usr/bin/env bash
# Root-side body of scripts/install-cwagent-staging.sh.
#
# Invoked via:
#   { cat;
#     printf 'CWAGENT_AKID=%q\n' "$AKID";
#     printf 'CWAGENT_SAK=%q\n' "$SAK";
#     cat scripts/internal/install-cwagent-remote.sh;
#   } | ssh REMOTE 'sudo -S -p "" bash'
#
# (cat consumes operator stdin = password line; the printf lines emit shell
# variable assignments; the final cat appends this body. ssh stdin = password
# + assignments + body. sudo -S consumes the password; bash inherits the rest
# and runs the assignments and this body as root.)
#
# Required shell variables (provided by the caller's prepended assignments):
#   CWAGENT_AKID  AWS access key id for the cwagent IAM user
#   CWAGENT_SAK   AWS secret access key for the cwagent IAM user

set -euo pipefail

: "${CWAGENT_AKID:?missing CWAGENT_AKID variable in pipe}"
: "${CWAGENT_SAK:?missing CWAGENT_SAK variable in pipe}"

INSTANCE_NAME="footbag-staging-web"
NAMESPACE="CWAgent"
CWAGENT_PROFILE="footbag-staging-cwagent"
RPM_URL="https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm"

# Write stdin to a destination file via a user-owned tmpfile, then promote
# with `install` (avoids piping secrets to a wrapped command's stdin, which
# can leak when sudo creds are cached).
install_via_tmp() {
  local dest="$1"
  local mode="$2"
  local tmp
  tmp=$(mktemp)
  cat > "$tmp"
  install -m "$mode" -o root -g root "$tmp" "$dest"
  rm -f "$tmp"
}

echo "=== Pre-flight 1: root fstype ==="
fstype=$(findmnt -no FSTYPE /)
echo "  Root fstype: ${fstype}"
if [[ "${fstype}" != "xfs" ]]; then
  echo "  WARNING: fstype is ${fstype}, not xfs. Update" >&2
  echo "  terraform/staging/cloudwatch.tf high_disk.dimensions.fstype before" >&2
  echo "  setting enable_cwagent_alarms = true." >&2
fi

echo
echo "=== Pre-flight 2: IMDS instance-id (informational) ==="
token=$(curl -sf -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
if [[ -n "${token}" ]]; then
  imds_id=$(curl -sf -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/meta-data/instance-id || echo 'UNKNOWN')
else
  imds_id=$(curl -sf http://169.254.169.254/latest/meta-data/instance-id || echo 'UNKNOWN')
fi
echo "  IMDS instance-id: ${imds_id}"

echo
echo "=== Step 1: install amazon-cloudwatch-agent (rpm) ==="
if rpm -q amazon-cloudwatch-agent >/dev/null 2>&1; then
  echo "  Already installed: $(rpm -q amazon-cloudwatch-agent)"
else
  tmpdir=$(mktemp -d)
  trap 'rm -rf "${tmpdir}"' EXIT
  curl -fsSL "$RPM_URL" -o "${tmpdir}/amazon-cloudwatch-agent.rpm"
  dnf install -y "${tmpdir}/amazon-cloudwatch-agent.rpm"
fi

echo
echo "=== Step 2: write agent JSON config ==="
install -d -m 0755 -o root -g root /opt/aws/amazon-cloudwatch-agent/etc
install_via_tmp /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json 0644 <<JSON
{
  "agent": {
    "region": "us-east-1",
    "metrics_collection_interval": 60,
    "logfile": "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"
  },
  "metrics": {
    "namespace": "$NAMESPACE",
    "append_dimensions": {
      "InstanceId": "$INSTANCE_NAME"
    },
    "metrics_collected": {
      "cpu": {
        "measurement": ["usage_active", "usage_idle", "usage_iowait", "usage_user", "usage_system"],
        "totalcpu": true
      },
      "mem": {
        "measurement": ["mem_used_percent", "mem_available_percent"]
      },
      "disk": {
        "measurement": ["used_percent"],
        "resources": ["/"],
        "drop_device": true
      }
    }
  }
}
JSON

echo
echo "=== Step 3: dedicated credentials file + common-config.toml ==="
install -d -m 0700 -o root -g root /etc/amazon-cloudwatch-agent.aws
install_via_tmp /etc/amazon-cloudwatch-agent.aws/credentials 0600 <<CREDS
[$CWAGENT_PROFILE]
aws_access_key_id = $CWAGENT_AKID
aws_secret_access_key = $CWAGENT_SAK
CREDS

install_via_tmp /opt/aws/amazon-cloudwatch-agent/etc/common-config.toml 0644 <<CC
[credentials]
   shared_credential_file = "/etc/amazon-cloudwatch-agent.aws/credentials"
   shared_credential_profile = "$CWAGENT_PROFILE"
CC

echo
echo "=== Step 3b: install logrotate config ==="
install_via_tmp /etc/logrotate.d/amazon-cloudwatch-agent 0644 <<'LR'
/opt/aws/amazon-cloudwatch-agent/logs/*.log {
    daily
    rotate 4
    size 10M
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
LR
logrotate --debug /etc/logrotate.d/amazon-cloudwatch-agent >/dev/null 2>&1 \
  && echo "  logrotate config installed and validated." \
  || echo "  WARNING: logrotate validation failed; check /etc/logrotate.d/amazon-cloudwatch-agent" >&2

echo
echo "=== Step 4: fetch-config and start agent (onPremise mode) ==="
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m onPremise \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
  -s
systemctl status amazon-cloudwatch-agent --no-pager || true

echo
echo "=== Step 5: agent log tail (look for 403/AccessDenied/ExpiredToken) ==="
sleep 5
tail -n 50 /opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log || true

echo
echo "=== Capture for AWS_PROJECT_SPECIFICS.md ==="
echo "  Root fstype:       ${fstype}"
echo "  IMDS instance-id:  ${imds_id}"
echo
echo "Verify metrics from operator workstation:"
echo "  aws cloudwatch list-metrics --namespace $NAMESPACE \\"
echo "    --dimensions Name=InstanceId,Value=$INSTANCE_NAME"
