#!/usr/bin/env bash
#
# staging_diagnostics.sh — single-file diagnostic toolkit for the footbag
# staging host. Read-only by default. The only state-changing operation is
# `force-tick`, which must be invoked explicitly with `-y`.
#
# ----------------------------------------------------------------------------
# Upload instructions
# ----------------------------------------------------------------------------
#
# From your local workstation, after pulling latest:
#
#   scp scripts/staging_diagnostics.sh footbag-staging:/home/footbag/
#   ssh footbag-staging 'chmod +x /home/footbag/staging_diagnostics.sh'
#
# Then on staging:
#
#   ~/staging_diagnostics.sh help
#   ~/staging_diagnostics.sh outbox davidleberknightphone@gmail.com
#   ~/staging_diagnostics.sh worker-logs 60
#   ~/staging_diagnostics.sh force-tick -y
#
# Alternatively, the next `./deploy_to_aws.sh` also places a copy at
#   /home/footbag/footbag-release/scripts/staging_diagnostics.sh
# which you can invoke directly without re-uploading.
#
# Requires: sudo docker, node inside the web container (already present),
# and outbound AWS credentials for the aws-* subcommands (already present via
# /root/.aws on staging).
#
# ----------------------------------------------------------------------------

set -euo pipefail

ENV_FILE='/srv/footbag/env'
COMPOSE_BASE='/home/footbag/footbag-release/docker/docker-compose.yml'
COMPOSE_PROD='/home/footbag/footbag-release/docker/docker-compose.prod.yml'
DB_HOST_PATH='/srv/footbag/db/footbag.db'

compose() {
  sudo docker compose --env-file "$ENV_FILE" -f "$COMPOSE_BASE" -f "$COMPOSE_PROD" "$@"
}

node_run() { compose exec -T web node; }

banner() { printf '\n==> %s\n' "$*"; }

confirm() {
  local prompt="$1"
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

# ---------------- Runtime state ----------------

cmd_status() {
  banner "docker compose ps"
  compose ps
}

cmd_health() {
  banner "GET /health (inside web container)"
  compose exec -T web sh -c 'wget -q -O- --timeout=3 http://localhost:3000/health && echo' || echo "(wget failed)"
  banner "GET /health/ready"
  compose exec -T web sh -c 'wget -q -O- --timeout=3 http://localhost:3000/health/ready && echo' || echo "(wget failed)"
}

cmd_time() {
  banner "Host UTC"; date -u
  banner "Container UTC"; compose exec -T web date -u
}

cmd_git_sha() {
  banner "Release dir SHA"
  (cd /home/footbag/footbag-release 2>/dev/null && git rev-parse HEAD 2>/dev/null) || echo "(not a git tree)"
}

# ---------------- DB inspection ----------------

cmd_db_counts() {
  banner "DB row counts"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const one = (sql) => db.prepare(sql).get().c;
const many = (sql) => db.prepare(sql).all();
console.log('members                 :', one('SELECT COUNT(*) c FROM members'));
console.log('historical_persons      :', one('SELECT COUNT(*) c FROM historical_persons'));
console.log('legacy_members          :', one('SELECT COUNT(*) c FROM legacy_members'));
console.log('audit_entries           :', one('SELECT COUNT(*) c FROM audit_entries'));
console.log('outbox_emails by status :', many(`SELECT status, COUNT(*) c FROM outbox_emails GROUP BY status`));
JS
}

cmd_outbox() {
  local email="${1:-}"
  banner "outbox_emails${email:+ for $email}"
  compose exec -T -e EMAIL="$email" web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const email = process.env.EMAIL || '';
const rows = email
  ? db.prepare(`SELECT id, recipient_email, status, retry_count, last_attempt_at, sent_at, substr(last_error,1,160) err, created_at FROM outbox_emails WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 20`).all(email)
  : db.prepare(`SELECT id, recipient_email, status, retry_count, substr(last_error,1,80) err, created_at FROM outbox_emails ORDER BY created_at DESC LIMIT 20`).all();
console.log(rows);
JS
}

cmd_outbox_pending() {
  banner "outbox_emails status='pending'"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT id, recipient_email, scheduled_for, retry_count, last_attempt_at, created_at FROM outbox_emails WHERE status='pending' ORDER BY created_at ASC LIMIT 50`).all());
JS
}

cmd_outbox_retrying() {
  banner "outbox_emails retry_count > 0 (not yet dead-lettered)"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT id, recipient_email, status, retry_count, substr(last_error,1,160) err, last_attempt_at FROM outbox_emails WHERE retry_count > 0 AND status != 'dead_letter' ORDER BY last_attempt_at DESC LIMIT 50`).all());
JS
}

cmd_dead_letter() {
  banner "outbox_emails status='dead_letter'"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT id, recipient_email, retry_count, substr(last_error,1,200) err, last_attempt_at, created_at FROM outbox_emails WHERE status='dead_letter' ORDER BY last_attempt_at DESC LIMIT 50`).all());
JS
}

cmd_member() {
  local key="${1:?usage: member <email|slug>}"
  banner "member lookup: $key"
  compose exec -T -e KEY="$key" web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const key = process.env.KEY;
const rows = db.prepare(`SELECT id, slug, display_name, login_email, login_email_normalized, email_verified_at, created_at FROM members WHERE login_email_normalized = ? OR slug = ? LIMIT 5`).all(key.toLowerCase(), key);
console.log(rows);
JS
}

cmd_config() {
  local key="${1:-}"
  banner "system_config_current${key:+ for config_key LIKE %$key%}"
  compose exec -T -e KEY="$key" web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const key = process.env.KEY || '';
const rows = key
  ? db.prepare(`SELECT config_key, value_json, effective_start_at FROM system_config_current WHERE config_key LIKE ? ORDER BY config_key`).all('%'+key+'%')
  : db.prepare(`SELECT config_key, value_json, effective_start_at FROM system_config_current ORDER BY config_key`).all();
console.log(rows);
JS
}

cmd_integrity() {
  banner "PRAGMA integrity_check (inside container)"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.pragma('integrity_check'));
JS
}

# ---------------- Logs ----------------

cmd_worker_logs() { banner "worker logs --tail=${1:-80}"; compose logs worker --tail="${1:-80}"; }
cmd_web_logs()    { banner "web logs --tail=${1:-80}";    compose logs web    --tail="${1:-80}"; }
cmd_nginx_logs()  { banner "nginx logs --tail=${1:-80}";  compose logs nginx  --tail="${1:-80}"; }
cmd_all_logs()    { banner "all logs --tail=${1:-80}";    compose logs        --tail="${1:-80}"; }

# ---------------- Host ----------------

cmd_mem()     { banner "free -h"; free -h; }
cmd_disk() {
  banner "df -h /"
  df -h /
  banner "DB file + WAL + SHM sizes on host"
  sudo ls -lh "$DB_HOST_PATH"* 2>/dev/null || echo "(no host DB file at $DB_HOST_PATH)"
}
cmd_systemd() { banner "systemctl status footbag.service"; sudo systemctl status footbag.service --no-pager -l || true; }

# ---------------- AWS ----------------

cmd_aws_whoami() {
  banner "aws sts get-caller-identity (from inside web container)"
  compose exec -T web sh -c 'aws sts get-caller-identity 2>&1' || echo "(aws cli not present — falling back to host)"
}

cmd_ses_identity() {
  banner "SES identity verification for SES_FROM_IDENTITY"
  local ident
  ident=$(sudo awk -F= '$1=="SES_FROM_IDENTITY"{sub(/^[^=]*=/,""); print}' "$ENV_FILE" | tail -1)
  if [[ -z "$ident" ]]; then
    echo "SES_FROM_IDENTITY not set in $ENV_FILE"
    return
  fi
  echo "Identity: $ident"
  compose exec -T web sh -c "aws ses get-identity-verification-attributes --identities '$ident' 2>&1" || true
}

cmd_ses_quota() {
  banner "SES send quota"
  compose exec -T web sh -c 'aws ses get-send-quota 2>&1' || true
}

cmd_ses_suppression() {
  local email="${1:?usage: ses-suppression <email>}"
  banner "SES suppression for $email"
  compose exec -T web sh -c "aws sesv2 get-suppressed-destination --email-address '$email' 2>&1" || true
}

cmd_ses_bounces() {
  banner "SES bounce/complaint events (requires feedback SNS topic + subscription; stub until wired)"
  echo "Path H follow-up: wire SNS feedback topic and log table, then replace this stub."
}

cmd_kms_probe() {
  banner "KMS Sign probe (minimal payload against JWT_KMS_KEY_ID)"
  compose exec -T web sh -c 'node -e "const {KMSClient,SignCommand}=require(\"@aws-sdk/client-kms\"); const c=new KMSClient({region:process.env.AWS_REGION}); c.send(new SignCommand({KeyId:process.env.JWT_KMS_KEY_ID,Message:Buffer.from(\"probe\"),SigningAlgorithm:\"RSASSA_PSS_SHA_256\"})).then(r=>console.log(\"ok kid=\"+r.KeyId)).catch(e=>console.error(\"KMS probe failed:\",e.name,e.message))"' || true
}

cmd_jwt_kid() {
  banner "JWT_KMS_KEY_ID the signer is configured to use"
  grep '^JWT_KMS_KEY_ID=' "$ENV_FILE" 2>/dev/null | sudo cat || echo "(cannot read $ENV_FILE)"
}

# ---------------- Data integrity ----------------

cmd_orphans() {
  banner "Orphan checks (dangling FKs)"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const check = (label, sql) => console.log(label + ':', db.prepare(sql).get().c);
check('outbox_emails with missing member',
  `SELECT COUNT(*) c FROM outbox_emails o WHERE o.recipient_member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = o.recipient_member_id)`);
check('members with missing historical_person_id',
  `SELECT COUNT(*) c FROM members m WHERE m.historical_person_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historical_persons hp WHERE hp.person_id = m.historical_person_id)`);
check('audit_entries with actor_member_id pointing nowhere',
  `SELECT COUNT(*) c FROM audit_entries a WHERE a.actor_member_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM members m WHERE m.id = a.actor_member_id)`);
JS
}

cmd_stubs() {
  banner "Stub historical_persons (person_id prefix 'stub_')"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT person_id, person_name, created_at FROM historical_persons WHERE person_id LIKE 'stub_%' ORDER BY created_at DESC LIMIT 50`).all());
JS
}

cmd_unverified_members() {
  local days="${1:-1}"
  banner "Members unverified older than ${days} day(s)"
  compose exec -T -e DAYS="$days" web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const days = parseInt(process.env.DAYS || '1', 10);
const rows = db.prepare(`SELECT id, slug, login_email, created_at FROM members WHERE email_verified_at IS NULL AND created_at < datetime('now', ?) ORDER BY created_at DESC LIMIT 50`).all('-' + days + ' days');
console.log(rows);
JS
}

cmd_merge_drift() {
  banner "Members with HP-field drift vs historical_persons"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const rows = db.prepare(`SELECT m.slug, m.country AS m_country, hp.country AS hp_country, m.is_hof AS m_hof, hp.hof_member AS hp_hof, m.hof_inducted_year AS m_year, hp.hof_induction_year AS hp_year FROM members m JOIN historical_persons hp ON hp.person_id = m.historical_person_id WHERE m.deleted_at IS NULL AND m.personal_data_purged_at IS NULL AND ((m.country IS NULL AND hp.country IS NOT NULL) OR (COALESCE(m.is_hof,0) <> COALESCE(hp.hof_member,0)) OR (m.hof_inducted_year IS NULL AND hp.hof_induction_year IS NOT NULL)) LIMIT 50`).all();
console.log(rows);
JS
}

cmd_slug_collisions() {
  banner "Case-insensitive slug collisions"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT lower(slug) lslug, COUNT(*) c FROM members GROUP BY lower(slug) HAVING c > 1`).all());
JS
}

cmd_email_dupes() {
  banner "login_email_normalized duplicates"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log(db.prepare(`SELECT login_email_normalized, COUNT(*) c FROM members GROUP BY login_email_normalized HAVING c > 1`).all());
JS
}

# ---------------- Audit ----------------

cmd_admin_audit() {
  local n="${1:-20}"
  banner "Recent admin audit_entries (last $n)"
  compose exec -T -e N="$n" web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const n = parseInt(process.env.N || '20', 10);
console.log(db.prepare(`SELECT occurred_at, action_type, entity_type, entity_id, actor_member_id, category FROM audit_entries WHERE actor_type = 'admin' ORDER BY occurred_at DESC LIMIT ?`).all(n));
JS
}

# ---------------- Performance ----------------

cmd_db_sizes() {
  banner "Per-table row counts (sorted desc)"
  node_run <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
const rows = tables.map(t => ({ table: t, rows: db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c }));
rows.sort((a,b) => b.rows - a.rows);
console.table(rows);
JS
}

cmd_wal_size() {
  banner "WAL / SHM sizes on host and inside container"
  sudo ls -lh "$DB_HOST_PATH"* 2>/dev/null || echo "(no host DB file)"
  compose exec -T web sh -c 'ls -lh /app/db/footbag.db* 2>/dev/null' || true
}

cmd_split_wal_check() {
  banner "DB view comparison: host vs web vs worker"
  echo "--- HOST ---"
  sudo ls -lh "$DB_HOST_PATH"* 2>/dev/null || echo "(no host DB files)"
  sudo sqlite3 "$DB_HOST_PATH" "SELECT status, COUNT(*) FROM outbox_emails GROUP BY status;" 2>&1 || true
  sudo sqlite3 "$DB_HOST_PATH" "SELECT COUNT(*) AS members FROM members;" 2>&1 || true

  echo
  echo "--- WEB (inside container) ---"
  compose exec -T web sh -c 'ls -lh /app/db/footbag.db* 2>/dev/null' || true
  compose exec -T web node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log('outbox by status:', db.prepare('SELECT status, COUNT(*) c FROM outbox_emails GROUP BY status').all());
console.log('members:', db.prepare('SELECT COUNT(*) c FROM members').get().c);
JS

  echo
  echo "--- WORKER (inside container) ---"
  compose exec -T worker sh -c 'ls -lh /app/db/footbag.db* 2>/dev/null' || true
  compose exec -T worker node <<'JS'
const db = require('better-sqlite3')('/app/db/footbag.db', { readonly: true });
console.log('outbox by status:', db.prepare('SELECT status, COUNT(*) c FROM outbox_emails GROUP BY status').all());
console.log('members:', db.prepare('SELECT COUNT(*) c FROM members').get().c);
JS

  echo
  echo "Interpretation:"
  echo "  If web sees rows that worker does not, WAL sidecars live in separate"
  echo "  container overlays (file bind mount, not directory). Fix is to bind"
  echo "  the DB directory, not the DB file, in docker-compose.prod.yml."
}

# ---------------- Production readiness ----------------

cmd_tls_cert() {
  banner "TLS cert expiry for PUBLIC_BASE_URL"
  local url
  url=$(sudo awk -F= '$1=="PUBLIC_BASE_URL"{sub(/^[^=]*=/,""); print}' "$ENV_FILE" | tail -1)
  local host="${url#https://}"; host="${host#http://}"; host="${host%%/*}"
  if [[ -z "$host" ]]; then echo "PUBLIC_BASE_URL not set"; return; fi
  echo "Host: $host"
  echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -subject -issuer -dates || echo "(openssl failed)"
}

cmd_origin_probe() {
  banner "Fetch /health via PUBLIC_BASE_URL (CloudFront → nginx → web)"
  local url
  url=$(sudo awk -F= '$1=="PUBLIC_BASE_URL"{sub(/^[^=]*=/,""); print}' "$ENV_FILE" | tail -1)
  curl -sS -o - -w "\n---\nhttp_code=%{http_code}\ntime_total=%{time_total}s\n" "${url%/}/health" || true
}

cmd_nginx_test() {
  banner "nginx -t inside nginx container"
  compose exec -T nginx nginx -t 2>&1 || true
}

cmd_dns_check() {
  banner "DNS A record for PUBLIC_BASE_URL"
  local url host
  url=$(sudo awk -F= '$1=="PUBLIC_BASE_URL"{sub(/^[^=]*=/,""); print}' "$ENV_FILE" | tail -1)
  host="${url#https://}"; host="${host#http://}"; host="${host%%/*}"
  [[ -n "$host" ]] && (dig +short "$host" A; dig +short "$host" AAAA) || echo "(no host)"
}

# ---------------- Rollback visibility ----------------

cmd_deploy_history() {
  local n="${1:-20}"
  banner "Last $n footbag.service restarts (from journalctl)"
  sudo journalctl -u footbag.service --no-pager -n "$n" --output=short-iso | grep -E "Started|Stopped|Deactivated|Main process exited" || true
}

cmd_previous_release() {
  banner "Release / live directories"
  sudo ls -ld /home/footbag/footbag-release /srv/footbag 2>/dev/null || true
  banner "Any sibling release backups"
  sudo ls -ld /home/footbag/footbag-release.* 2>/dev/null || echo "(no sibling backups)"
}

# ---------------- State-change (force-tick only) ----------------

cmd_force_tick() {
  if [[ "${1:-}" != "-y" ]]; then
    echo "force-tick will trigger an immediate outbox drain inside the web container."
    echo "This performs real SES send attempts on pending rows and flips their status."
    echo "Re-run with -y to confirm:   $0 force-tick -y"
    exit 1
  fi
  banner "force-tick: operationsPlatformService.runEmailWorker()"
  node_run <<'JS'
(async () => {
  const svc = require('/app/dist/services/operationsPlatformService').operationsPlatformService;
  const result = await svc.runEmailWorker();
  console.log(result);
})().catch(e => { console.error(e); process.exit(1); });
JS
}

# ---------------- Help ----------------

cmd_help() {
  cat <<'HELP'
staging_diagnostics.sh — subcommands

  Runtime
    status                   docker compose ps
    health                   GET /health and /health/ready
    time                     host and container UTC
    git-sha                  release dir git SHA

  DB inspection
    db-counts                counts by key table
    outbox [email]           last 20 outbox rows (optionally filtered)
    outbox-pending           pending rows
    outbox-retrying          rows with retry_count > 0
    dead-letter              rows with status='dead_letter'
    member <email|slug>      lookup a member row
    config [key-substr]      system_config (optionally filtered)
    integrity                PRAGMA integrity_check

  Logs
    worker-logs [n]          tail worker logs (default 80)
    web-logs [n]             tail web logs
    nginx-logs [n]           tail nginx logs
    all-logs [n]             tail all services

  Host
    mem                      free -h
    disk                     df -h plus DB file sizes
    systemd                  systemctl status footbag.service

  AWS
    aws-whoami               aws sts get-caller-identity (inside web)
    ses-identity             SES identity verification state
    ses-quota                SES send quota
    ses-suppression <email>  SES suppression check
    ses-bounces              (stub — requires SNS feedback wiring)
    kms-probe                minimal KMS Sign call against JWT_KMS_KEY_ID
    jwt-kid                  show JWT_KMS_KEY_ID from env file

  Data integrity
    orphans                  FKs pointing at nonexistent rows
    stubs                    stub historical_persons rows
    unverified-members [d]   members unverified > d days (default 1)
    merge-drift              members vs HP field drift
    slug-collisions          case-insensitive slug dupes
    email-dupes              login_email_normalized dupes

  Audit
    admin-audit [n]          last n admin audit_entries

  Performance
    db-sizes                 per-table row counts
    wal-size                 WAL/SHM sizes (host + container)
    split-wal-check          compare host vs web vs worker DB views

  Production readiness
    tls-cert                 TLS cert expiry for PUBLIC_BASE_URL
    origin-probe             curl PUBLIC_BASE_URL/health
    nginx-test               nginx -t inside nginx container
    dns-check                dig A/AAAA for PUBLIC_BASE_URL host

  Rollback visibility
    deploy-history [n]       last n service restarts
    previous-release         release + live dirs, sibling backups

  State-change (confirm-required)
    force-tick -y            force immediate outbox drain

  help                       this message
HELP
}

# ---------------- Dispatcher ----------------

main() {
  local sub="${1:-help}"; shift || true
  case "$sub" in
    status)               cmd_status ;;
    health)               cmd_health ;;
    time)                 cmd_time ;;
    git-sha)              cmd_git_sha ;;

    db-counts)            cmd_db_counts ;;
    outbox)               cmd_outbox "${1:-}" ;;
    outbox-pending)       cmd_outbox_pending ;;
    outbox-retrying)      cmd_outbox_retrying ;;
    dead-letter)          cmd_dead_letter ;;
    member)               cmd_member "${1:?usage: member <email|slug>}" ;;
    config)               cmd_config "${1:-}" ;;
    integrity)            cmd_integrity ;;

    worker-logs)          cmd_worker_logs "${1:-80}" ;;
    web-logs)             cmd_web_logs "${1:-80}" ;;
    nginx-logs)           cmd_nginx_logs "${1:-80}" ;;
    all-logs)             cmd_all_logs "${1:-80}" ;;

    mem)                  cmd_mem ;;
    disk)                 cmd_disk ;;
    systemd)              cmd_systemd ;;

    aws-whoami)           cmd_aws_whoami ;;
    ses-identity)         cmd_ses_identity ;;
    ses-quota)            cmd_ses_quota ;;
    ses-suppression)      cmd_ses_suppression "${1:?usage: ses-suppression <email>}" ;;
    ses-bounces)          cmd_ses_bounces ;;
    kms-probe)            cmd_kms_probe ;;
    jwt-kid)              cmd_jwt_kid ;;

    orphans)              cmd_orphans ;;
    stubs)                cmd_stubs ;;
    unverified-members)   cmd_unverified_members "${1:-1}" ;;
    merge-drift)          cmd_merge_drift ;;
    slug-collisions)      cmd_slug_collisions ;;
    email-dupes)          cmd_email_dupes ;;

    admin-audit)          cmd_admin_audit "${1:-20}" ;;

    db-sizes)             cmd_db_sizes ;;
    wal-size)             cmd_wal_size ;;
    split-wal-check)      cmd_split_wal_check ;;

    tls-cert)             cmd_tls_cert ;;
    origin-probe)         cmd_origin_probe ;;
    nginx-test)           cmd_nginx_test ;;
    dns-check)            cmd_dns_check ;;

    deploy-history)       cmd_deploy_history "${1:-20}" ;;
    previous-release)     cmd_previous_release ;;

    force-tick)           cmd_force_tick "${1:-}" ;;

    help|-h|--help)       cmd_help ;;
    *) echo "unknown subcommand: $sub"; cmd_help; exit 2 ;;
  esac
}

main "$@"
