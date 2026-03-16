# Footbag Website Modernization Project — DevOps Guide

**Last updated:** March 16, 2026

This file is the operator manual for the deployed platform. It assumes the solution architecture, functional requirements, and service boundaries are already defined elsewhere and intentionally does not repeat that material. It focuses on what a System Administrator must provision, secure, deploy, monitor, back up, restore, and maintain.

Current implementation note (current deployed public baseline): this guide covers the long-term operating model, but the current deployed public baseline is narrower in three places that must not be lost:
- `/health/ready` is currently only the minimal SQLite readiness check;
- the initial database baseline comes from `schema_v0_1.sql`, so the migration-chain runbooks here are post-baseline guidance rather than a bootstrap prerequisite;
- Backup freshness, required-config breadth, and memory-pressure handling remain operational monitoring concerns for this stage rather than readiness gates.

## Table of Contents

1. Operating Baseline
2. System Administrator Runbook Catalog
3. AWS Operations, IAM, and Zero-Trust Access Control
4. Runtime Topology and AWS Resource Layout
5. Configuration, Secrets, and Key Management
6. Terraform and Infrastructure Change Control
7. CI/CD, Release Promotion, and Deployment Workflow
8. Health Endpoints, Maintenance Mode, and Readiness
9. SQLite, Schema Migration, and Data Operations
10. Backup, Restore, and Disaster Recovery
11. Background Jobs and Scheduler Operations
12. Monitoring, Logging, Alerting, and Cost Control
13. Routine Security and Platform Operations
14. Staging Refresh and Anonymization
15. Incident Response and Troubleshooting
16. Operator Checklists

---

## 1. Operating Baseline

### 1.1 Environment model

| Environment | Purpose | Compute model | Data policy | Operator expectation |
|---|---|---|---|---|
| Development | local feature work and debugging | local Docker Compose | synthetic or safe fixture data by default | no production credentials; use local stubs unless integration testing is required |
| Staging | production-like validation, migration rehearsal, restore rehearsal | single-instance AWS environment matching production shape as closely as practical | anonymized production-derived data only | used for deployment rehearsal, rollback rehearsal, secret rotation rehearsal, and restore validation |
| Production | live footbag.org service | single AWS Lightsail instance behind CloudFront | real user data | conservative change control, MFA-backed access, full auditability |

### 1.2 Runtime shape

Production and staging use the same logical shape:

- one AWS Lightsail instance as the application origin
- CloudFront distribution(s) in front of the origin and media surfaces as required
- one SQLite database file on the instance for primary relational state
- S3 for media, backup snapshots, maintenance-page assets, and disaster-recovery storage
- CloudWatch for logs, metrics, alarms, and dashboards
- Parameter Store and KMS for secrets and cryptographic keys
- SES for email delivery
- Route 53 for DNS
- hardened per-operator SSH for exceptional operator shell access

### 1.3 Container roles

| Container | Role | Durable state | Operational notes |
|---|---|---|---|
| `nginx` | reverse proxy to app containers; origin-facing web entrypoint | none | small memory footprint; restart is low-risk |
| `web` | Node.js web application | none | serves HTTP requests; participates in `/health/live` and `/health/ready` |
| `worker` | background jobs, outbox processing, backup jobs, cleanup jobs | none | operationally critical; backup and job failures often begin here |
| `image` | isolated image processing | none | restart independently if image processing fails; does not hold primary state |

### 1.4 State placement

| State type | Canonical location | Notes |
|---|---|---|
| relational application data | SQLite file on Lightsail instance | primary live database |
| media objects | S3 | photo originals discarded after processing; stored variants are authoritative |
| backup snapshots | S3 primary backup bucket | versioned snapshot history |
| cross-region DR copies | S3 DR bucket | Object Lock retention for disaster recovery |
| runtime admin-configurable settings | `system_config_current` view | read directly by jobs and services at runtime |
| secrets | Parameter Store `SecureString` or KMS | never in code, image layers, or committed files |
| JWT signing keys | KMS asymmetric key | non-exportable key material |
| ballot encryption master keys | KMS | runtime assumed role may generate data keys; tally role may decrypt |

### 1.5 Operating posture

This guide assumes a conservative operating posture:

- simple, explicit, reproducible changes
- Terraform authority for infrastructure
- documented runbooks for every privileged task
- CloudWatch-first monitoring
- fast restore over complex failover
- no shared credentials
- no standing production access beyond what is operationally required

---

## 2. System Administrator Runbook Catalog

The previous DevOps draft had a useful set of System Administrator stories. Those ideas belong in this guide as concrete runbooks, not as prose examples. The table below is the operational catalog for those responsibilities.

| Runbook ID | Runbook | Covered in this guide |
|---|---|---|
| `SA_Infra_As_Code_Terraform` | manage AWS infrastructure through Terraform with code review and remote state locking | §6 |
| `SA_IAM_Policies_And_CloudTrail_Auditability` | define least-privilege IAM, bucket policies, audit logging, and access review | §3, §13 |
| `SA_SSH_Operator_Access` | manage named operator SSH access, firewall restrictions, and host-access lifecycle | §3.5 |
| `SA_Manage_Secrets_In_Parameter_Store` | create, scope, rotate, and audit secrets under `/footbag/{env}/...` | §5 |
| `SA_Rotate_Stripe_Keys` | dual-key rotation for Stripe API keys and webhook secrets | §5.5 |
| `SA_Deployment_Operations_And_Release_Runbooks` | deploy, verify, rollback, restart, and recover | §7, §15 |
| `SA_Maintenance_Mode_And_CloudFront_Maintenance_Page` | use CloudFront custom error responses and S3 maintenance assets | §8 |
| `SA_Backups_Verification_And_Restore_Drills` | validate backups and rehearse restores | §10 |
| `SA_Regional_Outage_Restore` | restore service from cross-region DR copies | §10.6 |
| `SA_Monitoring_Alerting_And_Incident_Response` | CloudWatch dashboards, alarms, SNS, and incident response | §12, §15 |
| `SA_Container_Resource_Allocation_Tuning` | tune container memory and restart policy based on observed data | §4.4, §12.4, §13.7 |
| `SA_Configure_Budgets_And_SNS_Alerting` | configure budgets, notifications, and cost alarms | §12.5 |
| `SA_Configure_Email_Delivery_Infrastructure` | SES domain verification, SPF, DKIM, DMARC, bounce handling | §4.5, §13.5 |
| `SA_Configure_Job_Schedules` | define and maintain the scheduler for system jobs | §11 |
| `SA_Bootstrap_New_Environment` | provision a new environment from scratch: root account hardening, IAM operator user, Terraform state bucket, environment apply, Lightsail host setup, Docker, first deployment, and CloudFront verification | DEV_ONBOARDING.md Path D; DEVOPS_GUIDE.md §17 (when added) |

---

## 3. AWS Operations, IAM, and Zero-Trust Access Control

### 3.1 Access-control principles

The AWS side of this project must be operated as a zero-trust environment:

- every human and workload identity is authenticated explicitly
- every permission is environment-scoped and least-privilege
- production access is narrower than development and staging access
- all privileged actions are auditable
- no role in the web app implies AWS access
- application-level administration and AWS/system administration remain separate
- production access requires MFA and must be temporary whenever practical
- shell access uses hardened per-operator SSH with restricted source IPs, not shared shell credentials

### 3.2 Role and boundary matrix

| Role | Where it exists | May do | Must not do |
|---|---|---|---|
| Application Administrator | inside the web app | moderate content, manage work queues, view app health, acknowledge alarms, adjust application runtime settings exposed by the app | change AWS resources, rotate secrets in AWS, modify IAM, view CloudTrail, run Terraform |
| System Administrator | AWS + repository + CI/CD | provision and change infrastructure, deploy code, rotate secrets, manage IAM, manage CloudWatch, restore backups, respond to incidents | use AWS access as a substitute for ordinary app administration; make undocumented console changes |
| Host System Administrator shell account | Lightsail host | connect by SSH for deployment, restore, patching, and diagnostics using a named non-root account with `sudo` and an individually assigned key | act as a shared account, use a shared private key, or stand in for the application runtime principal |
| Application runtime assumed role | selected through AWS shared config/shared credentials and service-specific profile selection | access only the AWS APIs the running application needs | perform broad account administration or stand in for human operator access |
| Voting tally role | restricted privileged role | decrypt ballot envelope keys during controlled tally operations only | run normal web traffic; broad infrastructure management |
| CI/CD deploy role | GitHub Actions or equivalent deployment identity | build, publish, and deploy the approved release path | read unrelated secrets or perform manual troubleshooting tasks |

### 3.3 Human AWS access rules

#### Non-negotiable rules

- No shared AWS usernames or shared shell accounts.
- Production access requires MFA.
- Production access must be justified by an approved change, deployment, incident, drill, or access review.
- Use temporary credentials or role assumption whenever the chosen AWS account model allows it.
- Separate non-production access from production access.
- Access to Parameter Store, KMS, S3, SES, CloudWatch, and Terraform state must be granted separately by role and environment.
- A person who can administer the application in the browser is **not** automatically a System Administrator.
- Direct inspection of member data through shell or SQLite tools is exceptional and must be tied to a documented incident, migration, or recovery need.

#### Minimum access review cadence

| Review | Cadence | Owner |
|---|---|---|
| IAM user/role membership review | quarterly | System Administrator lead |
| production-access and host SSH access review | quarterly and after volunteer offboarding | System Administrator lead |
| Parameter Store access review | quarterly | System Administrator lead |
| KMS key policy review | annually and after major role changes | System Administrator lead |
| CloudTrail review for privileged activity | monthly | System Administrator lead |
| break-glass / emergency access review | after every use | incident lead |

### 3.4 Workload IAM model

The workload AWS principal must be a narrow and explicit runtime assumed role. Do not describe it as an EC2-style role attached to the Lightsail host. Operator SSH access to the host is a separate mechanism and must not be confused with the runtime principal.

> **v0.1 runtime credential model — none required.** The current public Events + Results MVFP slice makes no runtime AWS API calls. The application reads `process.env` (sourced from `/srv/footbag/env`) and SQLite only. Do not add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or any AWS credential to `/srv/footbag/env` for the current slice. Do not mount the human operator CLI credentials into containers. The `app-runtime` IAM role created by `iam.tf` is deferred groundwork — it appears in `terraform state list` but is not active. Lightsail does not support EC2 instance profiles. The full source-profile + AssumeRole chain described in this section is the intended long-term model when the app begins making runtime AWS API calls (S3 backup writes, SES sends, etc.).

| AWS service | Runtime access | Notes |
|---|---|---|
| S3 media bucket | read/write only as required for media operations | no wildcard access to unrelated buckets |
| S3 primary backup bucket | write snapshots, read when validating readiness or restore support requires it | versioning is expected |
| S3 DR bucket | write only for the sync path or restore validation path if required | avoid broad delete rights |
| SES | send only from verified domain identities used by the app | no broad SES administration |
| Parameter Store | read-only under `/footbag/{env}/...` | runtime reads only |
| CloudWatch Logs / Metrics | write metrics and logs for the application | no broad CloudWatch account administration from runtime |
| KMS JWT key | `Sign` and `GetPublicKey` only as needed by auth runtime | private key remains non-exportable |
| KMS ballot key | runtime assumed role may request data keys for ballot encryption; decrypt is reserved to tally role | keep decrypt out of the normal runtime assumed role |

### 3.5 Session Manager and shell access

Hardened per-operator SSH is the standard host shell-access path on Lightsail.

Host shell access is exceptional. It exists for deployment, restore, patching, diagnostic verification, and incident response. It is not the normal path for application administration or AWS control-plane work.

#### Required operating rules

- Use named non-root Linux operator accounts with `sudo`.
- Do not use shared shell accounts.
- Do not use shared private SSH keys.
- Use key-based authentication only; disable password authentication.
- Do not use direct root login as the normal operator path.
- Restrict inbound SSH ports 22 and 2222 to approved operator IPv4 and IPv6 source ranges (Terraform-managed via `operator_cidrs` in `lightsail.tf`); never leave SSH open to the world. Port 2222 is the reliable operator port — some ISPs block outbound port 22 to AWS EC2 IP ranges. Both ports are restricted to `operator_cidrs`; only port 80 (for CloudFront origin traffic) is open to the world.
- Keep a host-access inventory that records, at minimum, the operator name, host account, public-key fingerprint, environments allowed, approval date, and removal date when offboarded.
- Distribute only public keys for host access. Private keys remain under the custody of the individual operator and must not be stored in the repository, Parameter Store, application containers, or shared team storage.
- Onboard a System Administrator by creating or enabling the named host account, installing the approved public key, verifying SSH login, verifying `sudo`, and recording the inventory entry.
- Offboard a System Administrator by removing the public key or disabling the host account immediately, verifying loss of access, and reviewing `authorized_keys` / `sudoers` for stale access.
- Every shell session must have a clear reason: deployment, incident, restore, patching, diagnostic verification, or drill.
- Lightsail browser-based SSH is an acceptable recovery mechanism (e.g., to configure sshd to listen on port 2222 after an instance rebuild, or when key-based SSH is temporarily unavailable). Treat all browser SSH sessions as exceptional, confirm the reason, and exit promptly.
- Standard connection pattern: `ssh -i ~/.ssh/<keyfile> -p 2222 <operator-user>@<static-ip>`. Use port 22 only if your network does not block it.

#### Operator checklist

1. Confirm you are in the correct AWS account and environment.
2. Confirm MFA-backed AWS credentials are active if the task also requires AWS-side changes.
3. Confirm the change, deployment, incident, or drill reference.
4. Confirm your current source IP is still within the approved SSH allowlist.
5. Connect using your named operator account and your own private key.
6. Capture commands or notes in the incident/change log.
7. Exit the session and verify any required follow-up notes or access changes were recorded.

### Rationale
This makes the host-access protocol explicit enough to be usable and auditable.

### 3.6 S3 bucket policy rules

Bucket policies must explicitly deny access outside the approved principals.

Required policy stance:

- media buckets: runtime assumed role + explicitly approved System Administrator principals only
- primary backup bucket: runtime assumed role writes snapshots; System Administrators read for restore and validation
- DR bucket: tightly restricted write and restore access; Object Lock enabled according to retention policy
- maintenance-page bucket/prefix: public-read only for the specific maintenance asset path behind CloudFront, or origin-restricted according to the chosen CloudFront pattern
- no anonymous write access anywhere

### 3.7 CloudTrail and auditability

All privileged AWS activity must be traceable.

Required controls:

- CloudTrail enabled for the account and retained according to policy
- review privileged production actions monthly
- investigate unusual Parameter Store, KMS, IAM, and S3 access
- ensure Terraform changes and console changes can be correlated to named humans
- document why any emergency manual action occurred and how it was reconciled back into code

### 3.8 Break-glass access

Break-glass means a privileged action outside the normal deployment or change path, typically during an outage or security incident.

Break-glass rules:

- use only for live incidents, blocked restores, or security containment
- require MFA-backed access
- record the reason before or immediately after action
- prefer temporary changes
- reconcile infrastructure drift back into Terraform immediately after stabilization
- review the action in the incident retrospective

---

## 4. Runtime Topology and AWS Resource Layout

### 4.1 Edge and request flow

1. Viewer traffic terminates at CloudFront.
2. CloudFront serves cached static assets and forwards dynamic requests to the Lightsail origin.
3. If the origin returns configured 5xx responses or is unreachable, CloudFront serves the maintenance page.
4. The origin runs nginx, which proxies to the Node.js web application.
5. The worker container executes background jobs and operational tasks.
6. Media is served from S3/CloudFront according to the configured media path.

Important limitation: browsing traffic gets the maintenance page during origin failure, but state-changing requests may still fail as connection errors or timeouts rather than receiving the branded page.

### 4.2 Networking and TLS

- viewer TLS terminates at CloudFront
- Route 53 points public DNS at the CloudFront distribution
- custom domains and certificates must be managed as infrastructure
- origin exposure should be minimized; direct origin access is not the user-facing path
- use WAF at CloudFront for basic managed-rule protection and IP-based emergency blocking when required

> **v0.1 test deployment — custom domain deferred.** The initial staging deployment uses the CloudFront default `*.cloudfront.net` URL. Route 53, ACM certificate provisioning, and custom domain aliases are commented out in Terraform (`acm.tf`, `route53.tf`, `cloudfront.tf`). The full custom-domain path described here applies when a real domain is attached. See `terraform/staging/acm.tf` for the activation checklist.

### 4.3 S3 layout expectations

At minimum, the AWS layout needs the following logical storage surfaces:

| Storage surface | Purpose |
|---|---|
| media bucket | processed photo objects and related media assets |
| primary snapshot bucket | 5-minute SQLite snapshots with version history |
| cross-region DR bucket | nightly replicated/synced copies and Object Lock retention |
| maintenance asset bucket or prefix | static maintenance page assets served by CloudFront |
| static asset storage | versioned application assets if separated from the instance |

### 4.4 Container sizing and restart behavior

Container memory limits are deployment settings, not app-admin runtime settings.

Operational rules:

- keep explicit memory limits in Compose or the chosen runtime config
- alert on sustained high memory before OOM
- automatic restart should recover transient failures
- repeated restarts indicate a real fault and require investigation
- any sizing change must be tested in staging and committed to version control

Minimum operator expectations:

- review per-container memory monthly
- investigate warning alarms before they become OOM restarts
- document before/after values and reason for any memory change
- keep enough host headroom for the OS and burst traffic

### 4.5 SES operations

System Administrators own SES account-level and DNS-level setup:

- verify sending domain
- publish SPF, DKIM, and DMARC records
- move SES out of sandbox before live production mail
- configure bounce and complaint notifications into the application webhook path
- monitor sender reputation and bounce/complaint rates
- coordinate DNS, SES, and app configuration changes together

---

## 5. Configuration, Secrets, and Key Management

### 5.1 Configuration boundary

There are three distinct configuration classes.

| Class | Canonical location | Changed by | Examples |
|---|---|---|---|
| infrastructure configuration | Terraform + deployment files | System Administrator | instance size, bucket names, firewall rules, CloudFront settings, job scheduler configuration |
| secrets and cryptographic material references | Parameter Store and KMS | System Administrator | Stripe keys, webhook secrets, bootstrap secrets, KMS key references |
| application runtime policy/config | `system_config_current` | Application Administrator through app workflows, with audit logging | reminder offsets, retention windows, pricing, pause flags, some job-related windows |

Never blur these boundaries.

- Do **not** place app-admin runtime policy in Terraform.
- Do **not** place deploy-time infrastructure settings in `system_config_current`.
- Do **not** put secrets in `system_config_current`.
- Do **not** query the raw `system_config` table for runtime use; jobs and services read `system_config_current`.

### 5.2 Parameter Store namespace

All Parameter Store paths must follow:

```text
/footbag/{env}/...
```

Examples:

```text
/footbag/prod/stripe/api_key
/footbag/prod/stripe/webhook_secret
/footbag/prod/app/bootstrap/admin_token
/footbag/staging/stripe/api_key
/footbag/dev/test/ses_sender
```

Rules:

- no `/fw/...` paths
- no cross-environment reads
- name paths by purpose, not by person
- use tags and descriptions
- never print parameter values to logs or terminal output

### 5.3 What goes in Parameter Store vs KMS

| Item | Store in | Reason |
|---|---|---|
| Stripe API keys | Parameter Store `SecureString` | secret value needed by app |
| Stripe webhook secrets | Parameter Store `SecureString` | secret value needed by app |
| administrative bootstrap secrets | Parameter Store `SecureString` | secret value needed by app/tooling |
| JWT signing key | KMS asymmetric key | non-exportable signing key material |
| ballot master key capability | KMS | envelope-encryption flow; keep decryption tightly scoped |
| ordinary runtime policy values | `system_config_current` | not secrets; admin-managed runtime config |

Use customer-managed KMS keys for sensitive `SecureString` parameters and for application cryptographic operations.

### 5.4 Secret-handling rules

- secrets are never committed to Git
- secrets are never baked into Docker images
- secrets are never stored in plaintext `.env` files outside explicitly local-only development stubs
- runtime loads secrets from Parameter Store or KMS-backed abstractions
- Terraform creates parameter structure, not secret values
- production secrets are rotated with a documented runbook and verification step
- after any secret rotation, restart or redeploy the containers that cache the value at startup
- the host stores the source AWS shared config/credential material for role assumption in a root-owned path
- only the containers that need AWS access receive the specific config/credential material they need, mounted read-only
- each AWS-enabled service must select its intended runtime assumed role explicitly, for example with `AWS_PROFILE`

### 5.5 Stripe key and webhook-secret rotation runbook

This is the direct operationalization of the older `SA_Rotate_Stripe_Keys` story.

#### When to run

- scheduled credential rotation
- suspected key exposure
- Stripe-side security requirement
- migration to a new Stripe configuration

#### Procedure

1. Generate the new key or webhook secret in Stripe.
2. Add the new value to the correct `/footbag/{env}/...` Parameter Store path according to the dual-key or staged-cutover design used by the application.
3. Validate in staging first.
4. Deploy the application change or restart path that picks up the new secret.
5. Run payment smoke tests and webhook verification.
6. Observe production for the grace period.
7. Remove the old secret only after successful verification.

#### Required verification

- successful API calls with the new key
- successful webhook signature validation
- no spike in payment or webhook failures
- incident/change record updated with actor and timestamp

### 5.6 JWT and ballot-key controls

- JWT signing uses KMS asymmetric signing; the application may call `Sign`, but the private key must remain non-exportable.
- Token verification should use cached public key material and must not call KMS on every request.
- Ballot encryption uses envelope encryption.
- The normal runtime role may request data keys for encryption but must not hold broad decrypt permission.
- Tally operations use a separate privileged role with tightly scoped decrypt permission.
- Key policy changes are infrastructure changes and require code review.

---

## 6. Terraform and Infrastructure Change Control

### 6.1 Terraform authority

Terraform is the source of truth for AWS infrastructure.

Infrastructure under Terraform control includes at minimum:

- Lightsail instance
- static IP and firewall rules
- S3 buckets and lifecycle/versioning/Object Lock settings
- CloudFront distributions and custom error responses
- IAM roles and policies
- Parameter Store structure
- KMS resources and aliases
- CloudWatch log groups, metrics, alarms, dashboards
- Route 53 records
- SNS topics and subscriptions
- budgets and budget alarms

### 6.1.1 Manual bootstrap boundary
A blank AWS account still requires one temporary manual bootstrap identity.

 That identity is allowed only to:
  1. harden the root account and establish billing alerts,
  2. create the remote Terraform state backend required by the current Terraform setup,
  3. apply the account-baseline Terraform root,
  4. create Terraform-managed IAM roles and policies,
  5. hand off routine administration to Terraform-managed roles.

Use clearly separated Terraform state backends for dev, staging, and production.

### 6.2 State management

- use remote state with locking
- keep environment state separated
- protect access to state because it is sensitive operational metadata
- never bypass locking for routine operations
- treat state changes as production-impacting changes
- Terraform >= 1.11 is required — `use_lockfile = true` (S3 native locking) requires this version floor; do not use DynamoDB locking
- AWS provider is pinned to `~> 5.0` in `providers.tf` — do not upgrade to v6 without reviewing the migration guide (v6 released June 2025, breaking changes)
- `terraform.tfvars` is excluded from git via `*.tfvars` in `.gitignore` — never commit it; it contains real IP addresses and account IDs; `*.tfvars.example` files are tracked and safe to commit
- `use_lockfile = true` requires `s3:PutObject` and `s3:DeleteObject` on `<bucket>/<key>*.tflock`; ensure the operator IAM policy includes these or `terraform apply` will fail with `AccessDenied` at lock acquisition

### 6.3 Standard workflow

Use this order for MVFP bootstrap and steady-state applies:

1. `terraform fmt -recursive`
2. `terraform validate`
3. `terraform plan -out=tfplan`
4. review the plan in PR
5. `terraform apply tfplan`
6. capture outputs required by deployment (static IP, bucket names, CloudFront domain, certificate ARN, and any documented firewall or allowlist inputs required for operator SSH access)
7. verify the applied AWS state and dashboards

For the initial blank-account bootstrap, apply in this sequence:
1. account baseline
2. Terraform-managed human/IAM access
3. Route 53 zone (if hosted in the same account)
4. ACM public certificate in `us-east-1`
5. S3 foundation buckets
6. Lightsail origin, Systems Manager hybrid-activation prerequisites/service role, and application runtime assumed role(s)
7. CloudWatch observability resources
8. CloudFront distribution
9. public DNS records

> **v0.1 test deployment — steps 3, 4, and 9 deferred.** Route 53 zone, ACM certificate, and public DNS records are not required when using the CloudFront default URL. The `terraform/shared/` module must be applied first to create the state bucket before applying `terraform/staging/`. See `DEV_ONBOARDING.md` §4.6 (Terraform staging apply) for the full v0.1 bootstrap sequence.

### 6.4 Environment separation

Use clearly separated Terraform workspaces, stacks, or state backends for dev, staging, and production.

Rules:

- never apply a staging plan to production
- keep variable files or workspace variables explicit
- environment-specific names, tags, bucket paths, and alarms must be deterministic
- do not allow a single command to mutate multiple environments implicitly

### 6.5 Emergency console changes

Console changes are allowed only for emergency troubleshooting or containment.

If a console change happens:

1. stabilize the incident
2. record exactly what changed
3. update Terraform to match reality
4. run plan and confirm the drift is reconciled
5. close the incident only after parity is restored

### 6.6 What not to do

- do not treat the console as the primary config surface
- do not leave unexplained drift in place
- do not edit prod and promise to “clean it up later”
- do not store secret values in Terraform state intentionally

---

## 7. CI/CD, Release Promotion, and Deployment Workflow

### 7.1 CI responsibilities

CI must at minimum:

- lint and type-check the codebase
- run the test suite
- build the deployable artifacts or container images
- publish versioned artifacts for approved branches/tags
- fail fast on migration or config-shape problems that can be detected automatically

### 7.2 Promotion policy

| Target | Promotion rule |
|---|---|
| Development | fast iteration; developers may deploy frequently |
| Staging | only from reviewed branches; used for migration rehearsal, restore rehearsal, smoke tests, and secret-rotation rehearsal |
| Production | promote only a version already validated in staging unless incident response requires emergency hotfix flow |

### 7.3 Standard deployment runbook

#### Preconditions

- green CI
- reviewed code and infrastructure diffs
- if schema changed: migration plan reviewed
- if secrets changed: rotation verification plan ready
- staging validation complete
- rollback path identified

#### Steps

1. Confirm current version, current health, and rollback target.
2. Confirm Terraform outputs for the target environment.
3. Connect to the host through SSH using your named operator account.
4. Confirm host prerequisites exist: Docker, Compose plugin, release directories, mounted SQLite host path, and the documented named-account SSH posture.
5. Place or update the approved release artifact on the host.
6. Render or place the environment config for the target release.
6a. place or refresh the root-owned host AWS shared config/shared credentials source material required for runtime role assumption
6b. confirm only the intended containers receive the required AWS config/credential mounts, read-only
6c. confirm each AWS-enabled service selects the intended runtime profile explicitly
6d. verify effective caller identity for the AWS-enabled service path before declaring deployment success
7. Confirm the host SQLite file exists and is mounted into the compose stack as `/app/footbag.db`.
8. Start or restart the compose stack through the documented service wrapper.
9. Verify `/health/live` on the origin directly.
10. Verify `/health/ready` on the origin directly.
11. Run origin smoke checks for `/events`, `/events/year/:year`, and `/events/:eventKey`.
12. Verify worker backup/job logs.
13. Validate the same route set through CloudFront.
14. End the change window only after post-deploy verification is clean.

### 7.4 Rollback runbook

Rollback is required when:

- readiness does not recover
- critical user flows fail
- alarms spike immediately after deploy
- secret rotation validation fails
- migration-related behavior is unsafe to continue

Rollback steps:

1. stop further rollout activity
2. restore prior application image/configuration
3. restart affected containers
4. verify health endpoints
5. re-run smoke tests
6. document the rollback trigger and next action

If the failure is schema-related, use the migration rollback rules in §9 before serving traffic again.

### 7.5 Restart runbook

Use targeted restarts for:

- stale cached secret/config values loaded at startup
- worker stuck state
- isolated image processor failure
- nginx reload after safe config change

Do **not** use restarts as a substitute for root-cause analysis when alarms or crash loops continue.

---

## 8. Health Endpoints, Maintenance Mode, and Readiness

### 8.1 `/health/live`

Purpose: cheap process liveness check.

Rules:

- return success only when the process is running
- do **not** call external dependencies
- do **not** call Stripe or SES
- keep the handler cheap and stable
- use this to distinguish dead process from dependency failure

### 8.2 `/health/ready`

Purpose: safe-to-serve-traffic readiness signal.

Readiness must at minimum validate:

- minimal database readiness
- required runtime configuration availability
- backup freshness signal sufficient to detect backup-path failure
- essential local application state
- memory pressure and other fatal operating conditions that should force traffic away from the origin

Readiness must **not**:

- call Stripe
- call SES
- perform expensive dependency fan-out
- hide partial failure by always returning success

Operational rule: if readiness fails persistently, treat the origin as not safe to receive traffic and recover or roll back.

### 8.3 Maintenance mode

Maintenance mode is edge-driven, not app-driven.

Primary mechanism:

- CloudFront custom error responses for origin 500/502/503/504 or origin unreachability
- maintenance page asset stored in S3
- short error cache TTL so recovery becomes visible quickly

This is the authoritative maintenance/outage experience for browsing traffic.

> **v0.1 deferred — maintenance page is not functional.** The CloudFront distribution has no `ordered_cache_behavior` routing `/maintenance.html` to the S3 origin. The custom error response block exists in `cloudfront.tf`, but when the origin is down the error response will itself fail to load. The full fix requires an S3 cache behavior, an Origin Access Control (OAC), and an X-Origin-Verify header. This is a known reliability gap in v0.1.

### 8.4 Planned maintenance

Use a maintenance window for:

- schema migrations with required downtime
- container/resource changes that require restart
- restore drills in staging
- security changes with expected brief service interruption

During planned maintenance:

1. ensure maintenance page path and CloudFront error behavior are correct
2. communicate maintenance window internally
3. stop or drain traffic as needed
4. run the change
5. verify origin health
6. confirm CloudFront returns to live content

### 8.5 Unplanned outage handling

If CloudFront is serving the maintenance page:

- verify whether the origin is actually down or merely not-ready
- check recent deploys, restarts, memory alarms, backup alarms, and database contention
- recover the origin first; CloudFront will return to live content automatically once healthy responses resume

---

## 9. SQLite, Schema Migration, and Data Operations

### 9.1 SQLite operating model

SQLite is the live primary database.

Operational implications:

- migrations require discipline and usually a short maintenance window
- WAL mode is part of the backup/recovery design
- the DB file on the instance is an intentional simplicity trade-off
- instance access and backup access must therefore be tightly controlled
- volunteers need basic SQL literacy for diagnostics and migrations

### 9.2 Migration rules

- use sequential, reviewed migration files
- prefer backward-compatible changes when feasible
- rehearse in staging using production-like anonymized data
- take or verify a current backup before migration
- run migrations during a maintenance window when required
- verify post-migration readiness before reopening traffic

### 9.3 Migration runbook

1. Confirm current snapshot is healthy and recent.
2. Put the site into the planned maintenance state.
3. Stop or drain write traffic.
4. Apply migrations in order.
5. Run integrity and smoke checks.
6. Restart services if required.
7. Verify `/health/live` and `/health/ready`.
8. Remove maintenance state.
9. Monitor logs and alarms for at least one stability window.

### 9.4 Data-access rules for operators

- use sqlite tools only when the app, runbook, or restore workflow requires it
- do not make ad hoc data edits in production unless a documented emergency fix is approved
- prefer audited application workflows for normal administrative changes
- if a direct DB fix is unavoidable, record the exact SQL and reconcile any permanent rule change into code or migration files

### 9.5 Contention and performance alarms

Investigate immediately when you see:

- backup age beyond threshold
- repeated `SQLITE_BUSY`
- slow query log growth
- WAL file growth beyond threshold
- long checkpoint latency
- disk usage approaching capacity

Common first checks:

- recent deploy or migration
- long-running write transaction
- worker backup failure
- abnormal import or cleanup workload
- host disk pressure

---

## 10. Backup, Restore, and Disaster Recovery

### 10.1 Recovery objectives by scenario

| Scenario | Target RPO | Target RTO | Notes |
|---|---|---|---|
| common database restore from recent snapshot | 5–10 minutes | ~5 minutes | primary operational recovery path |
| full service restore after application or host failure in-region | recent snapshot window | operator-paced; typically short if infra is intact | CloudFront serves maintenance page while recovering |
| cross-region regional disaster restore | up to last cross-region sync for DB; media replication target is tighter | 2–4 hours | requires manual rebuild and cutover |

### 10.2 Continuous database backup

The continuous backup job is part of normal operations.

Required behavior:

- run every `continuous_backup_interval_minutes` minutes (default 5)
- checkpoint WAL before snapshot
- use SQLite backup API for a consistent snapshot
- upload to the primary snapshot bucket
- retry on transient upload failure
- update backup success/failure metadata for logs and job history
- raise an alarm after repeated failure
- wait for in-flight backup completion on controlled shutdown when that shutdown hook exists

### 10.3 Nightly cross-region DR sync

A separate nightly sync protects against regional failure.

Required behavior:

- copy relevant primary backup state to the DR bucket
- verify integrity of the copied content
- enforce DR retention through Object Lock
- log run metadata and failures
- raise alarms on failure

### 10.4 Media backup

Media is backed up separately from the database.

Required stance:

- use S3 replication or the chosen S3-native cross-region backup path
- verify that replication/backup remains healthy
- treat media restore as a storage operation, not a SQLite restore operation
- document any manual promote/restore path needed for DR

### 10.5 Snapshot restore runbook

Use this for corruption, bad deploy with data damage, or accidental destructive bug.

1. Put the site in maintenance mode.
2. Identify the restore point.
3. Download or mount the selected snapshot.
4. Run `PRAGMA integrity_check`.
5. Replace the live DB file with the validated snapshot.
6. Restart affected containers.
7. Verify `/health/live` and `/health/ready`.
8. Run targeted smoke checks.
9. Remove maintenance mode and monitor.

### 10.6 Cross-region disaster restore runbook

Use this only when the primary region or primary storage path is unavailable for extended recovery.

1. Provision replacement infrastructure in the recovery region or approved alternate target.
2. Restore application code and container configuration.
3. Restore the SQLite snapshot from the DR bucket.
4. Reconnect or re-point media storage according to the DR design.
5. Update Route 53 and CloudFront origin configuration.
6. Verify end-to-end application function.
7. Communicate status and monitor carefully.

### 10.7 Backup validation and restore drills

Backups do not count as working until restore is proven.

Minimum drill expectations:

| Drill | Cadence | Required output |
|---|---|---|
| recent snapshot restore in staging | quarterly | restore time, issues found, verification checklist |
| cross-region DR rehearsal | at least annually or after major infra change | cutover notes, missing dependencies, revised timing estimate |
| backup-content validation | weekly automated check plus human review of failures | evidence that expected files and object paths exist |

### 10.8 What to verify after any restore

- application starts cleanly
- health endpoints pass
- critical read paths work
- admin dashboard shows expected backup/job state
- logs and alarms are normalizing
- no environment-crossing secrets or endpoints were introduced accidentally

---

## 11. Background Jobs and Scheduler Operations

### 11.1 Ownership model

`OperationsPlatformService` owns job orchestration, job-run logging, backup jobs, cleanup jobs, readiness composition, and alarm raise/ack integration. Job logic belongs in application code; schedule ownership belongs to the infrastructure/operator layer.

### 11.2 Job catalog

| Job | Cadence | Purpose | Operator concern |
|---|---|---|---|
| `SYS_Send_Email` | every `outbox_poll_interval_minutes` | send queued mail | dead-letter growth, bounce/complaint alarms |
| `SYS_Check_Tier_Expiry` | daily | expire or remind annual tiers | missed runs or unusual reminder spikes |
| `SYS_Open_Vote` | at least hourly | open scheduled votes | failed openings, admin-alerts flow |
| `SYS_Close_Vote` | at least hourly | close scheduled votes | failed closures, tally readiness |
| `SYS_Reconcile_Payments_Nightly` | nightly | reconciliation and digest generation | payment mismatches, digest failures |
| `SYS_Cleanup_Soft_Deleted_Records` | daily | PII purge and retention cleanup | retention correctness and audit trail |
| `SYS_Cleanup_Expired_Tokens` | daily | remove expired tokens | table growth, auth cleanup health |
| `SYS_Rebuild_Hashtag_Stats` | daily | rebuild tag stats | stale discovery stats |
| `SYS_Continuous_Database_Backup` | every 5 minutes by default | create SQLite snapshots | backup age and failure alarms |
| `SYS_Nightly_Backup_Sync` | nightly | sync to cross-region DR bucket | DR freshness and validation |
| `SYS_Cleanup_Static_Asset_Versions` | daily off-peak | remove obsolete versioned assets | rollback window preservation vs storage growth |
| webhook processors | event-driven | Stripe / SES durable inbound processing | idempotency failures, signature failures |

### 11.3 Scheduler rules

- schedules are infrastructure-managed, not app-admin managed
- schedule changes must be code-reviewed
- schedule definitions live with infrastructure configuration
- job execution status is visible in the app health view, but schedule changes are not exposed in the app
- missed job executions must alert before user-visible damage accumulates

### 11.4 Job failure response

For any failed job:

1. confirm whether it is a one-off or repeated failure
2. inspect CloudWatch logs and recent deploys
3. confirm required secrets/config are present
4. confirm dependent AWS services are reachable and authorized
5. rerun safely only if the job is idempotent or the runbook explicitly permits rerun
6. document operator action and outcome

### 11.5 Job-run logging

Every job run must record:

- job name
- start and end time
- success/failure state
- error summary if failed
- operator correlation where manually rerun
- key metrics such as processed counts when relevant

---

## 12. Monitoring, Logging, Alerting, and Cost Control

### 12.1 CloudWatch-first model

CloudWatch is the default monitoring substrate.

Use CloudWatch for:

- structured application logs
- infrastructure metrics
- custom application metrics
- job success/failure and duration metrics
- dashboards
- alarms
- host and platform logs that the runbooks explicitly choose to forward for operational visibility
- notification fan-out via SNS where configured

Optional external tools may be added only when they solve a concrete problem that CloudWatch does not solve well enough, and only if they do not materially increase volunteer burden, privacy risk, or cost.

### 12.2 Logging rules

Application logs must be structured and safe.

Required rules:

- structured JSON logs
- correlation IDs
- actor context where appropriate
- never log raw secrets, JWTs, reset tokens, webhook secrets, cookies, or full sensitive payloads
- log enough metadata to diagnose without exposing unnecessary personal data
- use CloudWatch Insights as the default search/query surface

### 12.3 Alarm model

#### Core infrastructure alarms

- origin 5xx / origin availability problems
- instance CPU and memory pressure
- container restart loops
- disk pressure
- S3 operation failures
- unusual Parameter Store access patterns
- KMS error rate or latency for auth/voting paths

#### Core application alarms

- application 5xx rate
- readiness failures
- backup age and backup failure
- job missed-run counts
- Stripe webhook failures
- SES bounce/complaint thresholds
- dead-letter / outbox failure growth

#### Administrator-visible summaries

The Application Administrator dashboard may show summarized health and alarm state, but it must not become an AWS operations console.

### 12.4 Suggested operational thresholds

These values should be implemented and tuned conservatively, then reviewed based on real data.

| Signal | Warning | Critical |
|---|---|---|
| CPU | >80% for 10 minutes | >90% for 5 minutes |
| per-container memory | >80% sustained | >90% sustained or restart risk |
| application 5xx rate | investigate sustained increase | >5% for 1–2 minutes |
| backup age | investigate if trend is rising | >15 minutes |
| missed scheduled job | 1 missed execution | 3 consecutive misses or restart loop |
| WAL size | investigate growth trend | >1 GB |
| checkpoint latency | investigate trend | >5 seconds |
| `SQLITE_BUSY` frequency | investigate | >5% of operations |
| DB file / disk use | >80% | >90% |

### 12.5 Dashboards and notifications

Maintain at least:

- an operations dashboard for System Administrators
- an application health summary for Application Administrators
- a cost dashboard or budget view

Notifications should be sent to the appropriate audience:

- infrastructure/incident alarms to System Administrators
- app-visible alarms and work queue notifications to the `admin-alerts` path where appropriate
- cost alarms to the designated budget owners

### 12.6 Cost control

Target operational cost remains modest. Operators must:

- track monthly spend against budget
- alarm on meaningful overrun or projection
- review unexplained spend spikes promptly
- evaluate any new AWS service against both dollar cost and volunteer support cost

---

## 13. Routine Security and Platform Operations

### 13.1 Monthly routine tasks

- review CloudWatch alarm history
- review CloudTrail for privileged production activity
- verify backup success and drill recency
- review SES reputation and bounce/complaint rates
- review container memory and restart trends
- review budget status and forecast

### 13.2 Quarterly routine tasks

- IAM and access review
- Parameter Store namespace cleanup
- backup restore rehearsal
- secret and key rotation review
- alert-threshold tuning review
- production access, SSH authorized-key inventory, and offboarding review

### 13.3 Patch management

- apply OS security updates on a documented cadence
- patch outside peak traffic when restart is required
- verify health endpoints and logs after patching
- record the patch date and any notable changes

### 13.4 Parameter Store hygiene

- remove unused parameters only after verifying no code path depends on them
- keep descriptions and tags current
- review prod write permissions carefully
- never leave obsolete secrets accessible longer than necessary

### 13.5 SES and deliverability maintenance

- verify DNS authentication records remain intact
- monitor reputation and quota
- investigate bounce/complaint spikes
- keep webhook processing healthy and idempotent
- test email paths after any sender-domain or secret change

### 13.6 Access reviews and volunteer turnover

When a volunteer leaves or no longer needs access:

1. remove AWS access promptly
2. remove repository and CI/CD access
3. rotate any credentials that were directly known to that person if required
4. verify there are no forgotten personal email subscriptions on alerting paths
5. document completion

### 13.7 Resource tuning

This guide treats resource tuning as a runbook, not guesswork.

When tuning memory or instance size:

- use observed CloudWatch data
- change one variable at a time where possible
- rehearse in staging first
- document the reason and expected effect
- verify after deployment

---

## 14. Staging Refresh and Anonymization

### 14.1 Goal

Staging should be realistic enough for deployment rehearsal and debugging, but it must not become a raw production clone.

### 14.2 Required workflow

1. Export a production-derived snapshot using the approved operator path.
2. Restore into an isolated staging workspace or temporary copy.
3. Run the anonymization/purge transformation.
4. remove or replace production-only secrets and external integration endpoints
5. import the sanitized dataset into staging
6. verify the anonymization result
7. run smoke tests

### 14.3 Required anonymization checks

Before staging is declared ready, verify:

- no raw production login emails remain where policy requires anonymization
- no production Stripe secrets or webhook secrets remain
- no production SES sending configuration is active in staging
- no production-only admin bootstrap values remain
- no raw sensitive contact fields remain when they should be anonymized
- any test mail or payments route to test systems only

### 14.4 What not to do

- do not point staging at production secrets
- do not allow staging to send real production mail
- do not retain raw production data in staging longer than required
- do not skip post-refresh verification

---

## 15. Incident Response and Troubleshooting

### 15.1 Standard incident flow

1. Detect via alarm, dashboard, or user report.
2. Classify: deploy issue, origin issue, database issue, job issue, secret/config issue, AWS service issue, cost/security issue.
3. Stabilize the user experience; maintenance page is acceptable while diagnosing.
4. Gather evidence from logs, metrics, and recent changes.
5. Recover using the smallest safe runbook: restart, rollback, restore, or infra fix.
6. Verify health.
7. Document cause, action, and follow-up.

### 15.2 First checks by symptom

| Symptom | First checks |
|---|---|
| CloudFront showing maintenance page | origin reachability, recent deploy, readiness failure, memory alarms, nginx/web process health |
| `/health/live` fails | process crash, container restart loop, host issue |
| `/health/live` passes but `/health/ready` fails | database access, backup freshness, required config presence, memory pressure |
| spike in 5xx | recent deploy, migration, secret rotation, upstream AWS auth errors, DB contention |
| backups failing | worker health, S3 permissions, bucket reachability, disk space, WAL/checkpoint issues |
| Stripe webhooks failing | webhook secret mismatch, signature validation, recent rotation, handler logs |
| SES complaint/bounce spike | sender reputation, template issue, recipient list problem, SES status |
| repeated `SQLITE_BUSY` | long transaction, backup overlap issue, migration, abnormal write load |
| high memory | image job pressure, worker leak, large request behavior, recent release |

### 15.3 Readiness-failure troubleshooting

If `/health/ready` is failing:
1. inspect the readiness output/check list
2. confirm the SQLite file is accessible and not corrupt
3. confirm the application boot completed far enough to serve the public slice
4. inspect recent deploy logs and restart history
5. if failure began after deploy, consider rollback
6. if failure is data-related, consider the restore path

If backup freshness alarms are firing while readiness still passes:
1. inspect worker health and job-run history
2. inspect S3 permissions and bucket reachability
3. inspect WAL/checkpoint and disk-space conditions
4. repair backup operations without redefining readiness semantics

### 15.4 Secret/config troubleshooting

Common causes:

- wrong `/footbag/{env}/...` path
- stale container process with cached startup values
- KMS permission mismatch
- wrong environment secret used in deployment
- missing restart after secret change

Resolution order:

1. verify path and environment
2. verify IAM and KMS rights
3. verify parameter metadata and last update
4. restart or redeploy affected container
5. re-test the dependent path

### 15.5 SSH access troubleshooting

If SSH access fails:

- verify the instance is running and that you are using the correct public IP or static IP
- verify the Lightsail firewall still permits port 22 from your current approved source IP or CIDR
- verify you are using the correct named host account
- verify you are using the correct private key and that the matching public key is still installed on the host
- verify the host account has not been disabled or had `sudo` removed
- if emergency access requires a temporary firewall change, document the reason and narrow the rule again immediately after recovery

---

## 16. Operator Checklists

### 16.1 Production deployment checklist

- CI green
- Terraform changes reviewed and applied if needed
- staging validated
- migration reviewed if applicable
- backup current
- secret changes verified
- deploy completed
- `/health/live` passes
- `/health/ready` passes
- smoke tests pass
- alarms quiet

### 16.2 Secret rotation checklist

- change approved
- new value created
- stored under correct `/footbag/{env}/...` path
- staging validated
- deploy/restart completed
- live verification completed
- grace period observed if dual-key flow used
- old value removed
- audit note recorded

### 16.3 Snapshot restore checklist

- maintenance state active
- restore point identified
- integrity check passed
- live DB replaced safely
- services restarted
- health endpoints pass
- smoke tests pass
- maintenance state removed
- incident notes updated

### 16.4 Access review checklist

- current System Administrator list reviewed
- production access list reviewed
- unused access removed
- offboarding completed
- Parameter Store write access reviewed
- KMS key policy reviewed
- findings documented

### 16.5 Backup-drill checklist

- snapshot selected
- restore target prepared
- restore executed
- health verified
- critical workflows tested
- timing recorded
- issues logged
- follow-up actions assigned

---

## 17. AWS Bootstrap and Initial Deployment

This section is the authoritative hands-on reference for bootstrapping a blank AWS account
and completing the first staging deployment. It absorbs the content previously in the
separate `docs/AWS_GUIDE_V0_1.md` draft (which is not checked in and should be deleted
locally once this section is confirmed complete).

For the developer-facing step-by-step walkthrough, see `DEV_ONBOARDING.md` Path D.
This section is the operational reference: it explains what each step controls, what the
constraints are, and what to do when things go wrong.

---

### 17.1 AWS account structure

| Item | Value |
|------|-------|
| Account purpose | Footbag Platform — all environments |
| Environments present | `staging` |
| Environments planned | `production` |
| Primary region | `us-east-1` |
| Terraform state | S3 backend with `use_lockfile = true` |
| Operator identity | `footbag-operator` IAM user (bootstrap shortcut — scope down after first deploy) |

> **PLACEHOLDER:** When production is added, decide whether it lives in the same AWS account
> (with strict IAM boundaries) or a separate account. A separate account is the cleaner
> long-term model but adds management overhead for a small volunteer project.

---

### 17.2 Root account hardening

**One-time procedure. Do not reuse root for ongoing work.**

1. Sign in as root at https://console.aws.amazon.com → **Root user**.
2. Enable MFA: click your account name (top right) → **Security credentials** → scroll to
   **Multi-factor authentication (MFA)** → **Assign MFA device**. Name it `root-mfa`, choose
   **Authenticator app**, and on the QR code screen look for the **"show secret key"** link —
   copy that text string. Store the secret key as a TOTP field in the team KeePassXC vault.
   Do not store it on a single device. Use KeePassXC to generate two consecutive TOTP codes
   to complete enrollment.
3. Confirm no root access keys exist: still on **Security credentials**, scroll to **Access
   keys**. Delete any that exist.
4. Sign out of root.

Do not use root again except to complete the next bootstrap step (creating the first operator
identity), then only in an account-recovery emergency.

**Team secrets vault:** The project uses KeePassXC with a shared encrypted vault file
(`footbag-platform-aws.kdbx`) on shared Google Drive. The vault holds: root email and
password, root MFA TOTP secret, `footbag-operator` access key ID and secret, and any
additional shared secrets as they are added. The vault master password is shared out of band
(Signal or in person — never email or Slack). To revoke access: remove the contributor from
the Google Drive share and rotate the master password and all secrets in the vault.

---

### 17.3 First operator identity

Sign in as root one more time to create the first IAM user.

1. Search bar → **IAM** → **Users** → **Create user**. User name: `footbag-operator`.
2. Choose **Attach policies directly** → search for and check **AdministratorAccess** → **Next**
   → **Create user**.

   > **Bootstrap shortcut:** `AdministratorAccess` is intentionally broad for the bootstrap
   > phase. Scope it down after first successful deploy — see §17.9.

3. Enable MFA for `footbag-operator`: click `footbag-operator` → **Security credentials** tab
   → **MFA** → **Assign MFA device**. Name it `footbag-operator-mfa`, choose **Authenticator
   app**. Scan, enter two codes, click **Add MFA**.

4. Create CLI access keys: still on **Security credentials** → **Access keys** → **Create
   access key** → use case: **Command Line Interface (CLI)** → check acknowledgement → **Next**
   → description tag `footbag-operator-bootstrap` → **Create access key**. **Copy both the
   Access Key ID and Secret Access Key immediately.** Click **Download .csv** and store it
   securely outside the repo. Click **Done**.

   > AWS shows the Secret Access Key only once. If you lose it, delete the key and create a new one.

5. Sign out of root. Root work is complete.

---

### 17.4 AWS CLI configuration (WSL)

All remaining steps run in the **WSL Ubuntu terminal**.

```bash
# Confirm AWS CLI is installed
aws --version
# Expected: aws-cli/2.x.x Python/3.x.x Linux/...

# Configure the operator profile
aws configure --profile footbag-operator
# Enter when prompted:
#   AWS Access Key ID:     <paste from step 17.3>
#   AWS Secret Access Key: <paste from step 17.3>
#   Default region name:   us-east-1
#   Default output format: json

# Activate for this shell session
export AWS_PROFILE=footbag-operator

# Verify
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/footbag-operator"
}
```

> `export AWS_PROFILE=footbag-operator` applies only to the current shell session. Re-run
> this export every time you open a new terminal before any Terraform or AWS CLI command.
> This is a common source of mid-bootstrap failures.

To make it persistent:
```bash
echo 'export AWS_PROFILE=footbag-operator' >> ~/.bashrc
source ~/.bashrc
```

**Troubleshooting:**

| Error | Cause | Fix |
|-------|-------|-----|
| `InvalidClientTokenId` | Access Key ID wrong | Re-run `aws configure --profile footbag-operator` |
| `SignatureDoesNotMatch` | Secret Access Key wrong | Re-run `aws configure --profile footbag-operator` |
| `Could not connect to endpoint` | No internet from WSL | Check WSL network |

---

### 17.5 Terraform remote state bootstrap

`terraform/shared` uses local state intentionally — it is the thing that creates the remote
backend. Apply it before initializing `terraform/staging`.

```bash
cd terraform/shared

cat > terraform.tfvars <<EOF
aws_account_id      = "YOUR_AWS_ACCOUNT_ID"
state_bucket_suffix = "YOUR_UNIQUE_SUFFIX"
EOF

terraform init
terraform validate
terraform apply
```

After apply, record the state bucket name:
```bash
terraform output -raw terraform_state_bucket_name
# Output format: footbag-terraform-state-<suffix>
```

Then:
1. Open `terraform/staging/backend.tf` and replace the `TODO-set-unique-suffix` placeholder
   with the real bucket name and region.
2. Back up the shared local state immediately — if this state is ever lost, recreating it
   against an existing bucket requires careful import to avoid destroying the bucket:
   ```bash
   cp terraform/shared/terraform.tfstate ~/footbag-shared-tfstate-backup.json
   ```
   Store this backup outside the repo.

**Critical constraints:**
- `terraform.tfvars` is gitignored via `*.tfvars` in `.gitignore` — never commit it;
  `*.tfvars.example` files are tracked and safe to commit
- `use_lockfile = true` requires Terraform >= 1.11 and AWS provider >= 5.x
- Do not use DynamoDB locking — this project uses S3 native locking
- AWS provider is pinned to `~> 5.0` — do not upgrade to v6 without reviewing the
  migration guide (June 2025, breaking changes)
- `use_lockfile = true` requires `s3:PutObject` and `s3:DeleteObject` on
  `<bucket>/<key>*.tflock`; confirm the operator IAM policy includes these

---

### 17.6 Lightsail constraints

**Namespace collision:** Lightsail static IPs and instances share a single AWS namespace —
they cannot have the same name. `lightsail.tf` uses `${local.prefix}-web-ip` for the
static IP (`footbag-staging-web-ip`) and `${local.prefix}-web` for the instance
(`footbag-staging-web`). Do not change these to the same value or instance creation fails
with "Some names are already in use."

**No public DNS hostname:** Lightsail does not provide public DNS hostnames. The
`publicDnsName` field in the Lightsail API always returns `None` (unlike EC2). Construct
the CloudFront origin hostname from the static IP Terraform output using nip.io (staging)
or a real DNS A record (production). See §17.7.

**No EC2 instance profiles:** Lightsail does not support EC2 instance profiles. The
`app-runtime` IAM role created by `iam.tf` is deferred groundwork — it appears in
`terraform state list` but is not active in v0.1.

**No user_data bootstrap:** `user_data` is intentionally omitted from `lightsail.tf`. All
host bootstrap (Docker CE install, `/srv/footbag` setup, systemd service) is performed
manually via SSH after first apply. See §17.8.

**Terraform-managed firewall:** Do not change firewall rules in the Lightsail console —
console changes are silently overwritten on the next `terraform apply`. To modify SSH
access at any point, update `operator_cidrs` in `terraform.tfvars` and run `terraform apply`.

**Port model (from `lightsail.tf`):**
- Port 22: SSH, restricted to `operator_cidrs`
- Port 2222: SSH alternate, restricted to `operator_cidrs` — use this if your ISP blocks port 22 to AWS EC2 IP ranges
- Port 80: HTTP, open to `0.0.0.0/0` — CloudFront connects here; nginx proxies to the app container
- Port 443: closed — TLS terminates at CloudFront, not at the origin

---

### 17.7 Two-pass CloudFront bootstrap

CloudFront requires a publicly resolvable DNS hostname as the origin domain — raw IPs are
not supported. `cloudfront.tf` uses `var.lightsail_origin_dns`. The instance must exist
before its static IP is known, which creates a chicken-and-egg problem: hence the two-pass
apply pattern.

**Pass 1:** set `enable_cloudfront = false` in `terraform.tfvars` and apply. This creates
Lightsail resources only. After it completes:

```bash
STATIC_IP=$(terraform output -raw lightsail_static_ip)
echo "${STATIC_IP}.nip.io"
```

**For staging:** use `<static_ip>.nip.io`. nip.io is a free public DNS service that
resolves `<ip>.nip.io` to `<ip>`. Verify resolution before proceeding:
```bash
dig "${STATIC_IP}.nip.io" +short
# Must return the static IP
```

**For production:** use a real DNS A record (e.g. `origin.footbag.org`) pointing to the
static IP. **Do not use nip.io in production.**

Set in `terraform/staging/terraform.tfvars`:
```hcl
lightsail_origin_dns = "34.x.x.x.nip.io"   # use your actual static IP
enable_cloudfront    = true
```

**Pass 2:** apply the full stack including CloudFront:
```bash
terraform plan -out=tfplan
terraform apply tfplan
```

After pass 2, CloudFront takes **15–30 minutes** to propagate globally. The
`*.cloudfront.net` URL is assigned immediately but returns errors during propagation:
```bash
CF_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront get-distribution \
  --id "$CF_ID" \
  --query 'Distribution.Status' \
  --output text \
  --profile footbag-operator
```
Wait for `Deployed` before testing through the edge.

**CloudFront 5xx alarm:** Gated on `enable_cloudfront` (`count = var.enable_cloudfront ? 1 : 0`
in `cloudwatch.tf`). Does not exist after pass 1. Created in pass 2 alongside the distribution.

**Current v0.1 CloudFront configuration:**

| Item | Value |
|------|-------|
| Distribution | Terraform-managed (`count = var.enable_cloudfront ? 1 : 0`) |
| Origin | `var.lightsail_origin_dns` — nip.io hostname for staging; real DNS A record for production |
| Domain | Default `*.cloudfront.net` URL (custom domain deferred) |
| HTTPS | CloudFront default certificate only (ACM cert deferred) |
| Maintenance mode | Not functional in v0.1 — S3 OAC and `ordered_cache_behavior` not yet implemented |
| Origin bypass protection | Not implemented in v0.1 — `X-Origin-Verify` header omitted from `cloudfront.tf` |

---

### 17.8 Host bootstrap sequence

After `terraform apply` completes and the static IP is available, bootstrap the host in this order.

#### Step 1 — First SSH login and named operator account

```bash
LIGHTSAIL_IP=$(terraform output -raw lightsail_static_ip)
ssh -i ~/.ssh/id_ed25519 -p 2222 ec2-user@$LIGHTSAIL_IP
```

> If port 2222 times out on a fresh instance, sshd has not yet been configured to listen
> on it. Use the Lightsail browser SSH console (AWS Console → Lightsail →
> `footbag-staging-web` → Connect) to log in as `ec2-user` and run:
> ```bash
> sudo sed -i 's/^#Port 22/Port 22\nPort 2222/' /etc/ssh/sshd_config && sudo systemctl reload sshd
> ```
> Then retry the SSH command.

Once logged in as `ec2-user`, create your named operator account:

```bash
sudo useradd -m -G wheel yourname
sudo mkdir -p /home/yourname/.ssh
sudo bash -c 'echo "<your-ssh-public-key>" > /home/yourname/.ssh/authorized_keys'
sudo chown -R yourname:yourname /home/yourname/.ssh
sudo chmod 700 /home/yourname/.ssh
sudo chmod 600 /home/yourname/.ssh/authorized_keys
```

> **Do not** use `tee <<< "..."` for the `authorized_keys` line on Amazon Linux 2023.
> The `<<<` here-string wraps long keys across two lines, breaking SSH auth silently.
> Use `sudo bash -c 'echo "..." > file'` instead.

Verify from a second terminal **before** leaving `ec2-user`:
```bash
ssh -i ~/.ssh/id_ed25519 -p 2222 yourname@$LIGHTSAIL_IP
sudo whoami   # must return: root
```

#### Step 2 — Install Docker CE

Amazon Linux 2023 default repos do not include Docker CE. Add the Docker repo first:

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin \
  sqlite \
  rsync
sudo systemctl enable --now docker
sudo usermod -aG docker yourname
```

Log out and back in so group membership takes effect. Verify:
```bash
docker --version && docker compose version && sqlite3 --version
```

All three must return version strings.

#### Step 3 — Prepare /srv/footbag and env file

```bash
sudo mkdir -p /srv/footbag
sudo tee /srv/footbag/env > /dev/null <<EOF
NODE_ENV=production
LOG_LEVEL=info
FOOTBAG_DB_PATH=/srv/footbag/footbag.db
PUBLIC_BASE_URL=https://<cloudfront_domain from terraform output>
EOF
sudo chown root:root /srv/footbag/env
sudo chmod 600 /srv/footbag/env
```

Required values for MVFP v0.1: `NODE_ENV`, `LOG_LEVEL`, `FOOTBAG_DB_PATH`, `PUBLIC_BASE_URL`.

**Do not add runtime AWS credentials.** The current slice makes no runtime AWS API calls.
See §3.4 and §17.9 for the full runtime credential model.

#### Step 4 — Rsync application files (from local machine)

```bash
rsync -av --delete -e "ssh -p 2222" \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=.terraform \
  --exclude=legacy_data \
  --exclude=terraform \
  --exclude=tests \
  --exclude=docs \
  --exclude=ifpa \
  --exclude=.claude \
  --exclude=aws \
  --exclude=coverage \
  --exclude=.env \
  --exclude='.env.*' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  ./ yourname@$LIGHTSAIL_IP:~/footbag-release/
```

> Adjust `-p 2222` to match your configured SSH port if different.

Then on the host, promote to the runtime path:
```bash
sudo rsync -a --delete ~/footbag-release/ /srv/footbag/
sudo chown -R root:root /srv/footbag
```

> Promote from a user-owned staging path into `/srv/footbag`. Do not copy directly into
> the root-owned runtime path from your laptop.

#### Step 5 — Initialize the database (first deploy only)

```bash
sudo sqlite3 /srv/footbag/footbag.db < /srv/footbag/database/schema_v0_1.sql
sudo sqlite3 /srv/footbag/footbag.db < /srv/footbag/database/seeds/seed_mvfp_v0_1.sql
sudo chown root:root /srv/footbag/footbag.db
sudo chmod 600 /srv/footbag/footbag.db
```

On later deploys, reuse the existing DB file — do not re-run this step.

#### Step 6 — Install and start footbag.service

```bash
cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo cp ops/systemd/footbag.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now footbag
sudo systemctl status footbag
docker ps
```

Expected:
- `footbag.service` may show `active (exited)` — correct for `Type=oneshot` with `RemainAfterExit=yes`
- nginx and web containers running
- worker container in `Exited (0)` state for MVFP v0.1 (stub worker exits cleanly)
- worker must not be restart-looping

---

### 17.9 IAM identity model (v0.1 current state)

| Identity | Type | Permissions | Purpose | Shortcut? |
|----------|------|-------------|---------|-----------|
| Root user | AWS root | Unrestricted | Account recovery only | No — correct |
| `footbag-operator` | IAM user | `AdministratorAccess` | Human operator — Terraform + CLI | Yes — scope down |
| `app-runtime` | IAM role | Deferred groundwork | Future app runtime calls | N/A — not active |

**Scope down footbag-operator after first successful deploy:**

The services touched by the current Terraform are: Lightsail, CloudFront, S3 (state bucket
+ project buckets), SSM, KMS, SNS, CloudWatch, and IAM (to create the app-runtime role).
Review each `.tf` file to derive the exact actions needed, then replace `AdministratorAccess`
with a least-privilege custom policy or IAM Identity Center permission set.

In IAM Console: IAM → Users → `footbag-operator` → **Permissions** tab → Detach
`AdministratorAccess` → Attach the scoped-down policy → Re-run `aws sts get-caller-identity`
and `terraform plan` to confirm the new permissions are sufficient.

**Remove long-lived access keys** after confirming MFA-backed short-lived credentials or
IAM Identity Center work: IAM → Users → `footbag-operator` → **Security credentials** →
**Access keys** → **Deactivate** first (confirm nothing breaks) → **Delete**.

**Retire ec2-user** once your named operator accounts are confirmed working with `sudo`:
```bash
sudo passwd -l ec2-user
# optionally: sudo userdel -r ec2-user
```

---

### 17.10 S3 bucket inventory (v0.1 staging)

| Bucket | Purpose | Managed by |
|--------|---------|------------|
| `footbag-terraform-state-<suffix>` | Terraform remote state | `terraform/shared` |
| `footbag-staging-snapshots` | SQLite DB backups | `terraform/staging` |
| `footbag-staging-dr` | Disaster recovery copies | `terraform/staging` |
| `footbag-staging-maintenance` | Maintenance page HTML | `terraform/staging` |
| `footbag-staging-media` | Media assets (deferred — not in use for MVFP v0.1) | `terraform/staging` |

All project buckets are created by Terraform with versioning and encryption enabled.

---

### 17.11 SSM Parameter Store (v0.1)

Provisioned by `terraform/staging/ssm.tf` as reference storage:

```
/footbag/staging/app/port
/footbag/staging/app/log_level
/footbag/staging/app/public_base_url
/footbag/staging/app/db_path
```

Not yet provisioned (deferred):
```
/footbag/staging/app/node_env
/footbag/staging/secrets/origin_verify_secret
```

**The running app reads `/srv/footbag/env`, not SSM.** Updating Parameter Store does not
change the running app — update `/srv/footbag/env` and restart the service to apply changes.

---

### 17.12 Monitoring — v0.1 current state

| Signal | Status | Notes |
|--------|--------|-------|
| CloudFront 5xx alarm | Created in pass 2 only | Gated on `enable_cloudfront` — does not exist until CloudFront distribution is created |
| SNS email subscription | Created on first apply; must be confirmed | Check `alarm_email` inbox after apply and click the confirmation link |
| CWAgent CPU/memory alarms | Disabled — `enable_cwagent_alarms = false` | Do not enable until CWAgent is installed and confirmed to be emitting metrics |
| DB backup age alarm | Disabled — `enable_backup_alarm = false` | Do not enable until backup job exists and emits `BackupAgeMinutes` to `Footbag/{env}` CloudWatch namespace; uses `treat_missing_data = "breaching"` — enabling before the job exists fires the alarm continuously |

Alarms for signals that do not exist are worse than no alarms — they train operators to
ignore monitoring.

---

### 17.13 Subsequent deploy procedure

After the first successful deploy, subsequent deploys follow this sequence.

From local machine:
```bash
export LIGHTSAIL_IP=$(cd terraform/staging && terraform output -raw lightsail_static_ip)

rsync -av --delete -e "ssh -p 2222" \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=.terraform \
  --exclude=legacy_data \
  --exclude=terraform \
  --exclude=tests \
  --exclude=docs \
  --exclude=ifpa \
  --exclude=.claude \
  --exclude=aws \
  --exclude=coverage \
  --exclude=.env \
  --exclude='.env.*' \
  --exclude='*.db' \
  --exclude='*.db-shm' \
  --exclude='*.db-wal' \
  ./ yourname@$LIGHTSAIL_IP:~/footbag-release/
```

On the host:
```bash
sudo rsync -a --delete ~/footbag-release/ /srv/footbag/
sudo chown -R root:root /srv/footbag

cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo systemctl restart footbag
sudo systemctl status footbag
```

Verify:
```bash
BASE_URL=http://$LIGHTSAIL_IP ./scripts/smoke-local.sh
```

---

### 17.14 Bootstrap confirmation checklist

Before moving to host bootstrap, confirm all of these:

- [ ] Root MFA enabled; no root access keys exist; root not used for ongoing work
- [ ] `footbag-operator` IAM user created with `AdministratorAccess`
- [ ] `footbag-operator` MFA enabled
- [ ] CLI access keys created and stored in KeePassXC vault (not in repo)
- [ ] `aws configure --profile footbag-operator` completed
- [ ] `export AWS_PROFILE=footbag-operator` set in this terminal
- [ ] `aws sts get-caller-identity` returns correct account and `user/footbag-operator`
- [ ] `terraform/shared` applied successfully
- [ ] State bucket name recorded; `terraform/staging/backend.tf` placeholder replaced with real bucket name
- [ ] Shared local state backed up outside the repo
- [ ] `terraform/staging` pass 1 applied (`enable_cloudfront = false`)
- [ ] Static IP captured; nip.io hostname constructed and verified with `dig`
- [ ] `lightsail_origin_dns` and `enable_cloudfront = true` set in `terraform.tfvars`
- [ ] `terraform/staging` pass 2 applied (full stack including CloudFront)
- [ ] SNS email subscription confirmed
- [ ] CloudFront status `Deployed` confirmed before testing through edge
- [ ] Host bootstrap complete (§17.8 steps 1–6)
- [ ] Application smoke checks pass (§4.9 of DEV_ONBOARDING.md)
