# DEV_ONBOARDING_V0_1.md

# Footbag Website Modernization Project

## Developer Onboarding Guide for MVFP v0.1

### Public Events + Results Slice

---

## Who this guide is for

This guide is for a technically capable engineer joining the project with:

- a **blank Windows machine**
- **WSL running Ubuntu**
- a **blank or newly prepared GitHub repository**
- a **blank AWS account** or an account that has not yet been prepared for this project

It assumes you are comfortable with the terminal, Git, and basic web development concepts, but it does **not** assume that this codebase already exists.

It also assumes that your main tools will be:

- **Cursor** as your editor / IDE
- **Anthropic Claude Code** as your primary AI coding assistant

The guide is written so you can follow it literally, but it is also designed to teach the architecture as you go so the system stays understandable and maintainable after the first deployment.

---

## What this guide is and is not

This guide **is**:

- an orientation guide
- a tutorial
- an implementation runbook
- a blank-slate repository plan
- a deployment bootstrap guide
- an AI-assisted development workflow guide

This guide is **not**:

- a bug report
- a giant architecture thesis
- a narrow checklist with no context
- a promise that missing scripts or files already exist

Where the repository is blank, this guide says which files to create and why.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Part A: Orientation and project understanding](#part-a-orientation-and-project-understanding)
  - [1. What this project is](#1-what-this-project-is)
  - [2. Project philosophy in practical terms](#2-project-philosophy-in-practical-terms)
  - [3. High-level architecture](#3-high-level-architecture)
  - [4. Where SQLite fits](#4-where-sqlite-fits)
  - [5. Where Docker fits](#5-where-docker-fits)
  - [6. Where Terraform fits](#6-where-terraform-fits)
  - [7. Where Lightsail and CloudFront fit](#7-where-lightsail-and-cloudfront-fit)
  - [8. Where Parameter Store and SSH fit](#8-where-parameter-store-and-ssh-fit)
  - [9. Where AI-assisted development fits](#9-where-ai-assisted-development-fits)
- [Part B: MVFP v0.1 slice explanation](#part-b-mvfp-v01-slice-explanation)
  - [10. What MVFP v0.1 is](#10-what-mvfp-v01-is)
  - [11. The exact public contract you must preserve](#11-the-exact-public-contract-you-must-preserve)
- [Part C: Developer environment and tools](#part-c-developer-environment-and-tools)
  - [12. Recommended development environment model](#12-recommended-development-environment-model)
  - [13. Install the required tools](#13-install-the-required-tools)
  - [14. AI-assisted development workflow rules](#14-ai-assisted-development-workflow-rules)
- [Part D: Local project bootstrap](#part-d-local-project-bootstrap)
  - [15. Start with a professional but small repository shape](#15-start-with-a-professional-but-small-repository-shape)
  - [16. Initialize package and TypeScript tooling](#16-initialize-package-and-typescript-tooling)
  - [17. Create baseline config files](#17-create-baseline-config-files)
  - [18. Create the SQLite bootstrap path](#18-create-the-sqlite-bootstrap-path)
  - [19. Seed deterministic MVFP data](#19-seed-deterministic-mvfp-data)
  - [20. Run locally outside Docker first](#20-run-locally-outside-docker-first)
  - [21. Implement the public route read path](#21-implement-the-public-route-read-path)
  - [22. Build the Handlebars templates](#22-build-the-handlebars-templates)
  - [23. Add health endpoints early](#23-add-health-endpoints-early)
- [Part E: Implementation order and artifact plan](#part-e-implementation-order-and-artifact-plan)
  - [24. Build in this order](#24-build-in-this-order)
    - [Batch 1: repository skeleton and toolchain](#batch-1-repository-skeleton-and-toolchain)
    - [Batch 2: app bootstrap](#batch-2-app-bootstrap)
    - [Batch 3: database bootstrap and seed path](#batch-3-database-bootstrap-and-seed-path)
    - [Batch 4: EventService public read models](#batch-4-eventservice-public-read-models)
    - [Batch 5: controllers, routes, and templates](#batch-5-controllers-routes-and-templates)
    - [Batch 6: integration tests and smoke scripts](#batch-6-integration-tests-and-smoke-scripts)
    - [Batch 7: Docker parity artifacts](#batch-7-docker-parity-artifacts)
    - [Batch 8: Terraform and ops artifacts](#batch-8-terraform-and-ops-artifacts)
  - [25. File responsibility map](#25-file-responsibility-map)
- [Part F: AWS bootstrap and Terraform handoff](#part-f-aws-bootstrap-and-terraform-handoff)
  - [26. The bootstrap principle](#26-the-bootstrap-principle)
  - [27. Secure the AWS account first](#27-secure-the-aws-account-first)
  - [28. Create the first named human operator identity](#28-create-the-first-named-human-operator-identity)
  - [29. Configure AWS CLI profiles deliberately](#29-configure-aws-cli-profiles-deliberately)
  - [29.5 Domain and DNS: deferred for initial test deployment](#295-domain-and-dns-deferred-for-initial-test-deployment)
  - [30. Create the Terraform remote-state foundation](#30-create-the-terraform-remote-state-foundation)
  - [31. Use explicit environment directories for Terraform](#31-use-explicit-environment-directories-for-terraform)
  - [32. What becomes Terraform-managed after handoff](#32-what-becomes-terraform-managed-after-handoff)
  - [33. The Lightsail runtime identity model](#33-the-lightsail-runtime-identity-model)
- [Part G: Parameter Store, Lightsail, CloudFront](#part-g-parameter-store-lightsail-cloudfront)
  - [34. Parameter Store path structure](#34-parameter-store-path-structure)
  - [35. Lightsail provisioning assumptions for this project](#35-lightsail-provisioning-assumptions-for-this-project)
  - [36. SSH setup and normal usage](#36-ssh-setup-and-normal-usage)
  - [37. CloudFront in front of the Lightsail origin](#37-cloudfront-in-front-of-the-lightsail-origin)
  - [38. Origin validation and public validation](#38-origin-validation-and-public-validation)
- [Part H: AWS deployment runbook](#part-h-aws-deployment-runbook-v01-test-deployment)
  - [Phase 1: AWS root account hardening](#phase-1-aws-root-account-hardening)
  - [Phase 2: Create IAM operator user](#phase-2-create-iam-operator-user)
  - [Phase 3: Bootstrap the Terraform state bucket](#phase-3-bootstrap-the-terraform-state-bucket)
  - [Phase 4: Configure staging backend and variables](#phase-4-configure-staging-backend-and-variables)
  - [Phase 5: Terraform init, validate, plan](#phase-5-terraform-init-validate-plan)
  - [Phase 6: Terraform apply](#phase-6-terraform-apply)
  - [Phase 7: Record the CloudFront URL](#phase-7-record-the-cloudfront-url)
  - [Phase 8: SSH into the Lightsail instance and create your named operator account](#phase-8-ssh-into-the-lightsail-instance-and-create-your-named-operator-account)
  - [Phase 9: Install Docker on the host](#phase-9-install-docker-on-the-host)
  - [Phase 10: Create the host env file](#phase-10-create-the-host-env-file)
  - [Phase 11: Deploy app files to host](#phase-11-deploy-app-files-to-host)
  - [Phase 12: Bootstrap the database](#phase-12-bootstrap-the-database)
  - [Phase 13: Build and start the app](#phase-13-build-and-start-the-app)
  - [Phase 14: Smoke test the origin directly](#phase-14-smoke-test-the-origin-directly)
  - [Phase 15: Verify through CloudFront](#phase-15-verify-through-cloudfront)
- [Part I: Verification, troubleshooting, deferred work](#part-i-verification-troubleshooting-deferred-work)
  - [39. Local smoke checks](#39-local-smoke-checks)
  - [40. Container smoke checks](#40-container-smoke-checks)
  - [41. Public deployment smoke checks](#41-public-deployment-smoke-checks)
  - [42. Common implementation mistakes](#42-common-implementation-mistakes)
  - [43. Common AWS/bootstrap mistakes](#43-common-awsbootstrap-mistakes)
  - [44. First-success criteria](#44-first-success-criteria)
  - [45. Deferred work](#45-deferred-work)
  - [46. Human, engineer, and AI handoff boundaries](#46-human-engineer-and-ai-handoff-boundaries)
  - [47. A practical first-week plan for a new contributor](#47-a-practical-first-week-plan-for-a-new-contributor)
- [Appendix A: Current official references](#appendix-a-current-official-references-used-to-verify-this-guide)
- [Next Steps: Closing the Bootstrap Shortcuts](#next-steps-closing-the-bootstrap-shortcuts)
  - [NS-1: Scope down footbag-operator IAM permissions](#ns-1-scope-down-footbag-operator-iam-permissions)
  - [NS-2: Remove footbag-operator long-lived access keys](#ns-2-remove-footbag-operator-long-lived-access-keys-after-first-deployment)
  - [NS-3: Attach a custom domain and ACM certificate](#ns-3-attach-a-custom-domain-and-acm-certificate)
  - [NS-4: Fix the CloudFront maintenance page](#ns-4-fix-the-cloudfront-maintenance-page)
  - [NS-5: Establish a SQLite backup plan](#ns-5-establish-a-sqlite-backup-plan)
  - [NS-6: Harden the Lightsail host further](#ns-6-harden-the-lightsail-host-further)
  - [NS-7: Move to a container registry for image distribution](#ns-7-move-to-a-container-registry-for-image-distribution)
  - [NS-8: Wire up runtime AWS credentials when the app needs them](#ns-8-wire-up-runtime-aws-credentials-when-the-app-needs-them)
  - [NS-9: Activate Parameter Store for runtime config management](#ns-9-activate-parameter-store-for-runtime-config-management)
  - [NS-10: Review and activate CloudWatch monitoring](#ns-10-review-and-activate-cloudwatch-monitoring)
- [Appendix B: Authoritative project facts](#appendix-b-authoritative-project-facts-this-guide-preserves)

---

# Quick Start


## Minimum AWS stand-up this guide targets

For MVFP v0.1, this guide targets the smallest project-acceptable deployment that works:

- one Lightsail instance as the origin
- one CloudFront distribution using the default `*.cloudfront.net` URL
- one SQLite database file at `/srv/footbag/footbag.db`
- one root-owned host env file at `/srv/footbag/env`
- one systemd unit that starts the Docker Compose stack from `/srv/footbag`

For this minimum stand-up, the guide does **not** require:

- a custom domain
- Route 53
- ACM certificates
- runtime SSM fetch at container startup
- a runtime IAM user for the current public Events + Results slice

If the public pages work through the CloudFront URL, the health endpoints work, and the origin can be restarted cleanly, that counts as first AWS success for this guide.

---

## Run local tests and view a web page 

If you just want to clone the github repo and run the code, follow the steps below to install prerequisites, clone, test, and run the dev server.

### Prerequisites (one-time, per machine)

Assumes that you have WSL on Windows set up for Ununtu Linux.

These are system-level installs. Do them once on a new machine; they persist across sessions.

There is no Python-style virtual environment for this project. Node's equivalent is `node_modules/` — a local directory managed by npm, installed once per clone, and reused across all sessions. You only need to re-run `npm install` when `package.json` changes.

**1. Node.js 22 LTS via nvm (recommended for WSL)**

nvm lets you install and switch Node versions without touching system Node. See §13.2 for full detail.

```bash
# Install nvm v0.40.3 (verified working)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Restart your terminal, then install and activate Node 22 LTS (v22.22.1 verified, npm 10.9.4)
nvm install 22
nvm use 22
nvm alias default 22

# Verify
node -v   # v22.x.x
npm -v    # 10.x.x
```

> **WSL2 PATH note:** If Node is also installed on Windows, `which node` inside WSL may resolve to the Windows binary. After installing via nvm, verify `which node` returns a path under `/home/...` or `/usr/...`, not `/mnt/c/...`.

**2. System packages**

`build-essential` is required to compile the `better-sqlite3` native addon during `npm install`. `sqlite3` is the CLI used by the database reset script.

```bash
sudo apt update
sudo apt install -y build-essential sqlite3

# Verify
sqlite3 --version
```

---

### First test from a new terminal

npm reads `package.json` to install dependencies (`npm install`) and delegates named scripts — `test`, `dev`, `build` — to the underlying tools (Vitest for tests, ts-node-dev for the dev server, tsc for compilation).

```bash
# Clone the repository and enter the project directory
git clone git@github.com:davidleberknight/footbag-platform.git
cd footbag-platform

# Install all declared Node.js dependencies into node_modules/
# (only needed once per clone, or after package.json changes)
npm install

# Create your local env file
cp .env.example .env
# Edit .env — at minimum confirm FOOTBAG_DB_PATH=./database/footbag.db

# Bootstrap the local database
bash scripts/reset-local-db.sh

# Run the integration test suite
npm test
```

All 15 tests should pass.

### Start the dev server and verify in a browser

```bash
# Start the dev server — leave this terminal running
npm run dev
```

WSL2 automatically forwards the port to Windows. Open your Windows browser and navigate to:

```
http://localhost:3000/events
```

You should see the events listing page. Verify these routes manually:

| URL | Expected |
| --- | --- |
| `http://localhost:3000/events` | Upcoming events listing |
| `http://localhost:3000/events/year/2025` | 2025 completed events with results |
| `http://localhost:3000/events/event_2025_beaver_open` | Single event detail with results |
| `http://localhost:3000/health/live` | `{"ok":true,"check":"live"}` |
| `http://localhost:3000/health/ready` | `{"ok":true,"check":"ready"}` |

Server logs appear in the terminal. Press `Ctrl+C` to stop the server.

> **If you switch Node versions:** run `npm rebuild` after switching. `better-sqlite3` is a native addon — it breaks at runtime with `ERR_DLOPEN_FAILED` if not recompiled for the new version.

---

# Part A: Orientation and project understanding

## 1. What this project is

The Footbag Website Modernization Project is a volunteer-maintained community platform intended to become the modern public hub for footbag. The project intentionally chooses a small-team architecture:

- simple enough for future volunteers to understand
- explicit enough to inspect and debug
- cheap enough to operate
- standard enough that new contributors are not forced to learn bespoke infrastructure before they can help

The key design philosophy is not “build the fanciest platform.” It is “build the platform that volunteers can keep alive for years.”

That philosophy drives nearly every technical choice in this guide.

---

## 2. Project philosophy in practical terms

### Maintainability over sophistication

The project prefers a conventional stack, clear boundaries, and readable SQL over layered abstractions that only pay off at much larger team size.

### Transparency over hidden machinery

Most application state lives in a single SQLite database file. The schema is visible. Queries are visible. The runtime shape is visible.

### Proportion over overengineering

The first public deployment target is a single-origin Lightsail deployment behind CloudFront. That is deliberate. It is not trying to be a distributed platform on day one.

### Explicit human responsibility

AWS account bootstrap, IAM setup, Terraform use, final review, deployment decisions, and verification remain human responsibilities. AI helps generate files; it does not replace operational judgment.

---

## 3. High-level architecture

At a high level, the system is a **server-rendered TypeScript web application**:

- **Node.js** runtime
- **Express** for HTTP routing and controllers
- **Handlebars** for server-rendered HTML views
- **SQLite** for application data
- **Docker** for consistent runtime shape
- **Terraform** for steady-state infrastructure after bootstrap
- **Lightsail** for the single application origin
- **CloudFront** in front of that origin
- **AWS Systems Manager Parameter Store** as optional AWS-side reference storage for non-local config values; the current MVFP v0.1 deployment reads `/srv/footbag/env` at runtime — the app does not fetch SSM at startup
- **Hardened per-operator SSH** for exceptional operator shell access on the Lightsail host
- **S3** for broader-project concerns such as media and backups, but not as the center of this first onboarding slice

You should think about the code in four layers:

1. **Views**
  - Handlebars templates that render HTML
  - should stay logic-light
2. **Controllers**
  - Express route handlers
  - parse request inputs
  - call services
  - choose status codes / render templates / return JSON for health endpoints
3. **Services**
  - own the slice’s business rules
  - validate route keys and year inputs
  - shape page-oriented data
  - decide visibility rules
  - translate temporary database contention into safe service failures
4. **DB / infrastructure layer**
  - one SQLite module
  - prepared statements prepared once at startup
  - transaction helper
  - no ORM
  - no repository layer

That layered mental model matters. Most implementation mistakes on this project are really boundary mistakes.

---

## 4. Where SQLite fits

SQLite is the project’s application-data store for this stage. The project deliberately uses a single database file and a single database access module because that keeps the system inspectable and easy to reason about.

For this project, SQLite is not an embarrassing stopgap. It is the intended early architecture.

What that means for contributors:

- use the provided schema directly for the initial baseline
- do **not** introduce an ORM
- do **not** add a repository layer
- do **not** scatter ad hoc SQL through controllers and services
- do keep prepared statements in one clear statement catalog
- do keep write transactions short and synchronous
- do enable foreign keys on every connection
- do use WAL mode where appropriate
- do write timestamps in canonical UTC ISO format

For MVFP v0.1 there is **no migration framework prerequisite**. The database bootstrap source is `schema_v0_1.sql`. A numbered migration chain is deferred until after the first stable deployed baseline.

---

## 5. Where Docker fits

Docker is part of the required workflow for this project, not an optional extra.

You will use two local development modes:

### Mode 1: fast host-run development

Use this when you want the fastest edit-run-debug loop in WSL Ubuntu.

Typical shape:

- run Node directly in WSL
- use the local SQLite file
- render the public slice quickly
- debug controllers, services, templates, and SQL without rebuilding containers every minute

### Mode 2: Docker parity mode

Use this before you advance to AWS work.

Typical shape:

- run the application through Docker Compose
- include the runtime container layout expected by the project
- verify the stack under container boundaries close to deployment shape

For this project level, Docker parity matters because the deployed origin is containerized. Skipping container verification would save minutes locally and cost hours later.

---

## 6. Where Terraform fits

Terraform is the tool that should own **steady-state infrastructure** once the initial secure baseline exists.

That means:

- a small amount of one-time manual bootstrap is allowed
- after the handoff, infrastructure changes should happen through Terraform
- the onboarding guide must explain the handoff clearly rather than hand-waving it away

For this project, Terraform is not there to look modern. It is there so future volunteers can see what exists and change it repeatably.

---

## 7. Where Lightsail and CloudFront fit

The early deployment posture is intentionally simple:

- **Lightsail** hosts the single application origin
- **CloudFront** sits in front of it

Why this shape exists:

- Lightsail keeps the origin simple and inexpensive
- CloudFront improves public delivery, caching posture, and edge behavior
- the combination is proportionate to the project’s scale

This is not the architecture for a huge platform. It is the right architecture for a community site that wants to stay maintainable.

---

## 8. Where Parameter Store and SSH fit

### Parameter Store

For the minimum MVFP v0.1 stand-up, Parameter Store is optional reference storage, not a runtime bootstrap dependency.

The current application does not call SSM at startup. It reads `process.env` only. That means:

- the live runtime values used by the app come from `/srv/footbag/env`
- Parameter Store may be used to record reference values in AWS
- updating SSM alone does not change the running app until the matching value is placed into `/srv/footbag/env`

### SSH

Used for bootstrap and operator shell access on the Lightsail host.

The project standard is:

- do use named non-root operator accounts with `sudo`
- do use separate SSH key pairs per operator
- do restrict port 22 to approved operator source IPs or CIDR ranges
- do not share private keys
- do not use shared shell accounts

One important project rule: the identity used for SSH host access is **not** the same thing as the application’s runtime AWS principal.

---

## 9. Where AI-assisted development fits

AI is part of the development workflow, but it does not own the project.

You should use Claude Code and Cursor to help with:

- generating file skeletons
- drafting controllers, services, and templates
- writing prepared statement scaffolds
- generating test cases
- proposing refactors
- producing repeated boilerplate in small batches

You should **not** let AI quietly decide project architecture.

The human still owns:

- reading the authority docs
- choosing what batch to build next
- reviewing every diff
- running tests and smoke checks
- operating AWS
- applying Terraform
- verifying that behavior matches the authoritative documents
- rejecting invented abstractions

A good rule for this project: **AI can draft; the human decides.**

---

# Part B: MVFP v0.1 slice explanation

## 10. What MVFP v0.1 is

MVFP v0.1 is the project’s first public, useful slice of functionality: **public Events + Results browsing**.

The slice is intentionally narrow. It proves the stack, the public routing model, the page-shaping service pattern, the SQLite read path, the Docker runtime shape, and the first AWS deployment path without dragging in the full platform.

### Routes in scope

- `GET /events`
- `GET /events/year/:year`
- `GET /events/:eventKey`
- `GET /health/live`
- `GET /health/ready`

### What the slice accomplishes

A visitor can:

- browse upcoming public events
- browse completed public events by year
- open one canonical public event page
- read public results where result rows exist
- still see historical events even when result rows do not exist yet

### What is deliberately excluded

This first slice does **not** require:

- member login flows
- registration workflows
- payment flows
- admin UI
- organizer tools
- event editing
- result upload UI
- Stripe
- SES
- S3-heavy media flows
- a public JSON API
- alternate detail/results public routes
- archive search or filters

### What is simplified on purpose

- `GET /events/year/:year` is a whole-year page with **no pagination**
- `GET /events/:eventKey` is the single canonical public event route
- `/health/ready` is deliberately minimal for this stage
- the repository starts blank except for docs and schema
- first deployment uses a single-origin Lightsail stack behind CloudFront

That narrowness is a strength. It makes the first implementation and onboarding path teachable.

---

## 11. The exact public contract you must preserve

When you implement the slice, preserve these rules:

### Public visibility

Only events in these statuses are publicly visible:

- `published`
- `registration_full`
- `closed`
- `completed`

Events in these statuses are **not** public:

- `draft`
- `pending_approval`
- `canceled`

### Event key

Public event identity uses:

- `eventKey` shape: `event_{year}_{event_slug}`

The stored standardized tag includes the leading `#`, but the public route key does not.

Example:

- stored tag: `#event_2025_beaver_open`
- public route key: `event_2025_beaver_open`

Do **not** invent:

- a separate `event_slug` column
- a bare slug route like `/events/beaver-open`
- a second public results route

### Year archive behavior

`GET /events/year/:year`:

- shows the full selected year
- is not paginated
- includes completed public events for that year
- shows inline grouped results when rows exist
- still shows the event when rows do not exist
- explicitly says when results are not yet available

### Canonical event page behavior

`GET /events/:eventKey`:

- is always the canonical event page
- is one route and one template
- can emphasize details or results through page-model fields
- still renders when the event is historical and has no result rows
- returns not found for invalid keys, unknown keys, and non-public events

### Health behavior

- `/health/live` is a cheap process liveness check
- `/health/ready` is a minimal SQLite-readiness check for this stage only

# Part C: Developer environment and tools

## 12. Recommended development environment model

Because your machine is **Windows + WSL Ubuntu**, the cleanest setup is:

- install **Cursor on Windows**
- install **Docker Desktop on Windows**
- enable the **WSL 2 backend**
- keep the repository **inside the Linux filesystem in WSL**, not on a mounted Windows drive
- run Node, npm, SQLite CLI, Terraform, AWS CLI, and Claude Code from the **WSL Ubuntu shell**

That gives you:

- Linux-native runtime behavior
- a clean terminal workflow
- better filesystem performance than keeping the repo under `/mnt/c/...`
- good Docker integration through WSL

---

## 13. Install the required tools

## 13.1 Git and GitHub

Install Git in WSL Ubuntu and confirm it works.

```bash
sudo apt update
sudo apt install -y git
git --version
```

Set your identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

Create the repository in your WSL home directory, for example:

```bash
mkdir -p ~/src
cd ~/src
git clone <your-repo-url> footbag-modernization
cd footbag-modernization
```

If the repository does not exist yet, create it in GitHub first and then clone it.

### Small-team Git workflow

Use short-lived branches. Keep changes reviewable. For this project, a good branch shape is:

- `chore/bootstrap-repo`
- `feat/public-events-read-path`
- `feat/docker-parity`
- `feat/aws-bootstrap-docs`

Do not combine app bootstrap, Docker, Terraform, and template work in one giant branch.

---

## 13.2 Node.js LTS and npm

Use the current **Node.js LTS** release line and use **npm** as the package manager default.

Why npm here:

- it ships with Node
- it reduces blank-machine setup steps
- it is perfectly adequate for a project of this size
- it avoids introducing another tool before the codebase exists

Install a Node version manager if you prefer, or install Node LTS directly. In WSL Ubuntu, a version manager is usually the cleanest option for long-term maintainability.

After install, verify:

```bash
node -v
npm -v
```

> **Note:** This project uses `better-sqlite3` which compiles a native Node.js addon. Node 22 LTS is the recommended version. If you use Node 24 or later, ensure `better-sqlite3` is at least `^12.6.2` in `package.json` or the native build will fail during `npm install`.

> **WSL2 PATH contamination.** WSL2 appends the Windows `PATH` by default. If Node.js is also installed on Windows, `which node` inside WSL may resolve to the Windows binary — wrong architecture, wrong version, subtle failures. After installing Node inside WSL, verify `which node` returns a path under `/home/...` or `/usr/...`, not `/mnt/c/...`.

> **CRLF line endings.** If git on Windows is configured with `core.autocrlf=true`, shell scripts cloned in WSL can gain `\r` characters and fail with `bash: bad interpreter: /usr/bin/env bash^M`. The repo should include a `.gitattributes` file with `*.sh text eol=lf` to enforce Unix line endings on shell scripts regardless of the cloning platform.

---

## 13.3 Base Linux packages

Install the utilities you will use repeatedly:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  sqlite3 \
  unzip \
  zip \
  jq \
  ca-certificates \
  curl
```

Verify SQLite:

```bash
sqlite3 --version
```

---

## 13.4 Docker Desktop + Docker Compose

On Windows:

1. install Docker Desktop
2. enable the WSL 2 backend
3. enable WSL integration for your Ubuntu distro

In WSL, verify:

```bash
docker --version
docker compose version
```

If you choose to install Docker Engine directly inside Ubuntu instead of using Docker Desktop, do that intentionally and document it for yourself. For most contributors on Windows + WSL, Docker Desktop with WSL integration is the simplest path.

> **Do not run `sudo apt install docker-compose`.** That package installs the old v1 standalone binary (`docker-compose` with a hyphen), which is deprecated and behaves differently from the v2 plugin (`docker compose` with a space) used throughout this project. Docker Desktop provides the v2 plugin automatically. If installing Docker Engine directly, use the official Docker APT repository and install `docker-compose-plugin`.

---

## 13.5 AWS CLI v2

Install AWS CLI v2 in WSL Ubuntu and verify:

```bash
aws --version
```

---

## 13.6 SSH client and key tools

Verify that the OpenSSH client is available in WSL Ubuntu: use ssh -v. You also need a secure way to generate and keep your own operator SSH key pair. The private key stays with you; only the public key is distributed for host access.

---

## 13.7 Terraform CLI

Install Terraform in WSL Ubuntu and verify:

```bash
terraform version
```

For this project, use a current stable Terraform CLI version and pin the required version in the repository once the Terraform code exists.

---

## 13.8 Cursor

Install Cursor on Windows.

Recommended setup choices for this project:

- open the repository through the WSL filesystem
- keep the integrated terminal pointed at WSL Ubuntu
- enable any Git and Markdown extensions you already trust
- keep Cursor rules or project instructions in the repo so the AI editor sees the same architecture constraints every time

Optional but useful: install the Cursor CLI if you want it available in the terminal.

---

## 13.9 Claude Code

Install Claude Code in WSL Ubuntu and verify:

```bash
claude --version
```

Then sign in and confirm it can run.

Because this project is WSL-first, prefer using Claude Code **inside WSL** where the repository, Node runtime, and shell tools already live.

---

## 13.10 Recommended editor / AI settings for this project

Create a small project rule file before generating code.

A good starting rule set for this project is:

- server-rendered Express + Handlebars only
- no ORM
- no repository layer
- one SQLite DB module
- thin controllers
- page shaping in services
- logic-light templates
- no alternate public results route
- preserve `GET /events/:eventKey` as the canonical event page
- preserve non-paginated year archive behavior
- no migration framework as a prerequisite
- prefer small verified batches

You can store those rules in a file such as:

- `AGENTS.md`
- `.claude/CLAUDE.md`
- project-level Cursor rules

The exact file mechanism can vary. The important thing is that the rules live in the repository, not only in your memory.

---

## 14. AI-assisted development workflow rules

Use this workflow every time:

### Step 1: read authority docs first

Before generating code, read:

- `USER_STORIES_V0_1.md`
- `VIEW_CATALOG_V0_1.md`
- `SERVICE_CATALOG_V0_1.md`
- `DESIGN_DECISIONS_V0_1.md`
- `schema_v0_1.sql`

Optionally also read `DATA_MODEL_V0_1.md` when working on SQLite runtime behavior.

### Step 2: ask for one small batch at a time

Good batch prompts:

- “Create the repository skeleton, package.json, tsconfig, and baseline scripts only.”
- “Create only the db module and prepared statement catalog for public event read paths.”
- “Create only the EventService public read methods and tests.”
- “Create only the Handlebars templates and minimal controllers for the three public routes.”

Bad batch prompt:

- “Build the entire app, Docker, Terraform, and AWS deployment in one go.”

### Step 3: review the diff yourself

Check for forbidden inventions:

- ORM
- repository layer
- alternate event routes
- `event_slug` column
- template business logic
- controller-owned visibility rules
- async work inside SQLite transactions

### Step 4: run tests and smoke checks

After each batch:

- run the tests that exist
- run or repeat the local smoke checks
- verify the rendered behavior manually

### Step 5: keep ownership boundaries clear

Claude Code may generate files. The human still must:

- approve the design
- review the diff
- run the commands
- inspect SQL
- operate AWS
- manage Terraform
- verify outputs
- make the final call

---

# Part D: Local project bootstrap

## 15. Start with a professional but small repository shape

Create this repository structure first:

```text
.
├─ src/
│  ├─ config/
│  │  ├─ env.ts
│  │  └─ logger.ts
│  ├─ controllers/
│  │  ├─ eventsController.ts
│  │  └─ healthController.ts
│  ├─ db/
│  │  ├─ db.ts
│  │  └─ openDatabase.ts
│  ├─ routes/
│  │  ├─ publicRoutes.ts
│  │  └─ healthRoutes.ts
│  ├─ services/
│  │  └─ EventService.ts
│  ├─ views/
│  │  ├─ layouts/
│  │  │  └─ main.hbs
│  │  ├─ events/
│  │  │  ├─ index.hbs
│  │  │  ├─ year.hbs
│  │  │  └─ detail.hbs
│  │  └─ errors/
│  │     ├─ not-found.hbs
│  │     └─ unavailable.hbs
│  ├─ public/
│  │  └─ css/
│  │     └─ style.css
│  ├─ app.ts
│  └─ server.ts
├─ database/
│  ├─ schema_v0_1.sql
│  └─ seeds/
│     └─ seed_mvfp_v0_1.sql
├─ tests/
│  ├─ integration/
│  │  └─ events.routes.test.ts
│  └─ unit/
│     └─ eventService.test.ts
├─ scripts/
│  ├─ reset-local-db.sh
│  ├─ smoke-local.sh
│  └─ smoke-public.sh
├─ docker/
│  ├─ web/
│  │  └─ Dockerfile
│  ├─ worker/
│  │  └─ Dockerfile
│  ├─ nginx/
│  │  └─ nginx.conf
│  ├─ docker-compose.yml
│  └─ docker-compose.prod.yml
├─ ops/
│  └─ systemd/
│     └─ footbag.service
├─ terraform/
│  ├─ shared/
│  ├─ staging/
│  └─ production/
├─ docs/
│  └─ DEV_ONBOARDING_V0_1.md
├─ .env.example
├─ .gitignore
├─ package.json
└─ tsconfig.json
```

### Why this shape works

- `src/` holds the application
- `database/` keeps schema and seed files obvious
- `tests/` keeps route and service tests separate
- `docker/` keeps runtime artifacts together
- `ops/` holds host-level operational wrappers
- `terraform/` separates infrastructure by environment
- root-level config stays discoverable for volunteers

It is conventional, small-team-friendly, and aligned with the project architecture.

---

## 16. Initialize package and TypeScript tooling

Use npm to create the project metadata and baseline scripts.

Suggested baseline runtime dependencies:

- `express`
- `express-handlebars`
- `better-sqlite3`
- `dotenv` or equivalent minimal env loader

Suggested development dependencies:

- `typescript`
- `tsx`
- `@types/node`
- `@types/express`
- `vitest`
- `supertest`
- `@types/supertest`

You may also add a lint/format stack later, but do not let linting block the first public slice.

A reasonable first script set is:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

The important point is not the exact JSON. The important point is that the initial toolchain is small and boring.

---

## 17. Create baseline config files

## 17.1 `.gitignore`

At minimum ignore:

- `node_modules/`
- `dist/`
- `.env`
- `database/footbag.db`
- `*.log`
- `.terraform/`
- `terraform.tfstate*`

## 17.2 `.env.example`

Start with a minimal local environment file:

```dotenv
COMPOSE_FILE=docker/docker-compose.yml
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
FOOTBAG_DB_PATH=./database/footbag.db
PUBLIC_BASE_URL=http://localhost:3000
```

For MVFP v0.1 local development, keep `.env` intentionally small. Do not drag production-only complexity into the first local boot.

### What belongs in local `.env`

Use `.env` for:

- local-only development values
- non-secret defaults
- temporary local secrets needed only for development

### What belongs in Parameter Store instead

For this MVFP v0.1 guide, Parameter Store is optional in staging and production.

Use it if you want AWS-side reference storage for:

- secret values you do not want documented only on the host
- environment-specific public base URLs
- future operational config you expect to manage centrally later

But remember: the running app reads `/srv/footbag/env`, not SSM. Mirroring a value into SSM does nothing for the running deployment until the same value is present in `/srv/footbag/env`.

Do not commit `.env`.

---

## 18. Create the SQLite bootstrap path

Copy the authoritative schema into `database/schema_v0_1.sql`.

Then create the local database:

```bash
sqlite3 database/footbag.db < database/schema_v0_1.sql
```

### Required SQLite runtime behavior

Your DB module must enforce these rules on every connection:

- `PRAGMA foreign_keys = ON`
- enable or confirm WAL mode
- use canonical UTC ISO timestamps
- keep write transactions short
- use a transaction helper based on `BEGIN IMMEDIATE`

### A good `db.ts` shape

`src/db/db.ts` should be the one place that:

- opens the SQLite database
- applies connection PRAGMAs
- exports the connection
- exports the transaction helper
- imports and exposes the prepared statements catalog

### A good `statements.ts` shape

`src/db/statements.ts` should define and prepare the queries used by this slice.

For MVFP v0.1, that means at least:

- public upcoming event listing
- archive year listing
- completed public event listing by year
- canonical public event detail lookup by normalized tag
- result-row queries needed to build `resultSections[]`
- minimal readiness query such as `SELECT 1`

Keep page shaping out of `statements.ts`. Let SQL return flat rows. Let the service layer group them.

---

## 19. Seed deterministic MVFP data

Before writing the full application, create a deterministic seed file:

`database/seeds/seed_mvfp_v0_1.sql`

Seed only the tables needed to exercise this slice. The seed set should include:

### Required scenarios

1. **An upcoming public event**
  - visible on `/events`
2. **A completed public event with results**
  - visible on `/events/year/:year`
  - has grouped results
  - opens on the canonical event page with `hasResults = true`
3. **A completed public event without results**
  - visible on `/events/year/:year`
  - explicitly shows “no results yet”
  - opens on the canonical event page and still renders
4. **A non-public event**
  - `draft` or `canceled`
  - should not be publicly visible
  - canonical route should resolve to not found

### Seed contents you will likely need

- standardized event tags in `tags`
- at least one host club in `clubs` if you want to test `hostClub`
- events in `events`
- at least one discipline in `event_disciplines`
- result rows in:
  - `event_results_uploads`
  - `event_result_entries`
  - `event_result_entry_participants`
- a minimal member row only if needed to satisfy result-upload foreign keys

Keep the seed narrow. You do not need the whole platform to prove the public slice.

### Helpful reset script

Create `scripts/reset-local-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

rm -f database/footbag.db
sqlite3 database/footbag.db < database/schema_v0_1.sql
sqlite3 database/footbag.db < database/seeds/seed_mvfp_v0_1.sql
echo "Local database reset complete."
```

Make it executable:

```bash
chmod +x scripts/reset-local-db.sh
```

Run it:

```bash
./scripts/reset-local-db.sh
```

---

## 20. Run locally outside Docker first

### App bootstrap responsibilities

Create these first:

- `src/app.ts`
- `src/server.ts`
- `src/config/env.ts`
- `src/config/logger.ts`

A good split is:

### `src/config/env.ts`

Owns:

- loading environment variables
- validating required ones
- exporting a small typed config object

### `src/config/logger.ts`

Owns:

- structured logging setup
- safe logging helpers

### `src/app.ts`

Owns:

- creating the Express app
- view engine setup
- static asset setup
- route registration
- safe 404 and safe unavailable handlers

### `src/server.ts`

Owns:

- reading config
- starting the HTTP server
- structured startup logs
- graceful shutdown hooks

Once those exist, run:

```bash
npm install
npm run dev
```

Verify the server is listening.

---

## 21. Implement the public route read path

Create:

- `src/routes/publicRoutes.ts`
- `src/routes/healthRoutes.ts`
- `src/controllers/eventsController.ts`
- `src/controllers/healthController.ts`
- `src/services/EventService.ts`

### Controller responsibilities

Controllers should:

- read the request path parameter
- call the service
- choose the template
- return JSON for health endpoints
- translate service “not found” into HTTP 404
- translate temporary-unavailable into the safe failure path

Controllers should **not**:

- invent page-model rules
- decide result visibility
- parse `eventKey` business rules beyond basic pass-through
- group result rows
- write inline SQL

### EventService responsibilities for this slice

EventService should own:

- validating `year` as a four-digit archive-year input
- validating `eventKey`
- normalizing `eventKey` to stored standardized tag form
- looking up public events only
- deriving archive years from `events.start_date`
- deriving `hostClub` from `events.host_club_id -> clubs.name`
- deciding `hasResults`
- deciding `primarySection`
- grouping flat result rows into `resultSections[]`
- returning page-oriented models

That service-owned page-shaping rule is one of the most important design constraints in the slice.

---

## 22. Build the Handlebars templates

Create:

- `src/views/layouts/main.hbs`
- `src/views/events/index.hbs`
- `src/views/events/year.hbs`
- `src/views/events/detail.hbs`
- `src/views/errors/not-found.hbs`
- `src/views/errors/unavailable.hbs`

### Template philosophy

Templates should receive already-resolved display data and simple booleans.

Templates should **not**:

- parse or normalize `eventKey`
- decide if an event is public
- infer `hostClub`
- group result rows
- invent adjacent year navigation
- re-derive no-results logic

Keep templates readable and close to the final HTML.

---

## 23. Add health endpoints early

Create the health controller at the same time as the public routes, not at the end.

### `/health/live`

Should be a cheap process signal only.

Example response shape:

```json
{"ok":true,"check":"live"}
```

### `/health/ready`

For MVFP v0.1, keep it minimal.

It should do only what is needed to confirm the app can serve this slice:

- open or reuse the SQLite connection
- perform a trivial read
- return readiness JSON

Example response shape:

```json
{"ok":true,"check":"ready"}
```

Do **not** expand readiness into backup freshness, S3 reachability, SES, Stripe, or CloudWatch checks just to stand up the first slice.

---

# Part E: Implementation order and artifact plan

## 24. Build in this order

This order is deliberate. Follow it.

## Batch 1: repository skeleton and toolchain

Create:

- package metadata
- TypeScript config
- `.gitignore`
- `.env.example`
- folder structure
- baseline npm scripts

**Test after batch 1**

- `npm install` succeeds
- `npm run build` works even if source is still minimal

### Good Claude Code prompt for batch 1

“Create only the repository skeleton, package.json, tsconfig.json, .gitignore, and .env.example for a TypeScript Express + Handlebars project. Do not add ORM, repository, Docker, or Terraform yet.”

---

## Batch 2: app bootstrap

Create:

- `src/config/env.ts`
- `src/config/logger.ts`
- `src/app.ts`
- `src/server.ts`

**Test after batch 2**

- app starts
- root process logs startup cleanly
- missing envs fail clearly

### Good Claude Code prompt for batch 2

“Create only env loading, logger, Express app bootstrap, and server startup for this project. Keep the app server-rendered, use Handlebars, and do not implement route business logic yet.”

---

## Batch 3: database bootstrap and seed path

Create:

- `database/schema_v0_1.sql` copy-in
- `database/seeds/seed_mvfp_v0_1.sql`
- `scripts/reset-local-db.sh`
- `src/db/db.ts`
- `src/db/openDatabase.ts`

**Responsibilities**

- DB module opens the database
- enables foreign keys
- configures WAL where appropriate
- exposes prepared statements
- exposes transaction helper using `BEGIN IMMEDIATE`

**Test after batch 3**

- local DB resets cleanly
- readiness query works
- FK enforcement is active
- a deliberate FK violation fails

### Good Claude Code prompt for batch 3

“Create only the SQLite bootstrap path for this project: db.ts, statements.ts, reset-local-db.sh, and a deterministic MVFP seed file. Use one DB module, prepared statements, and a BEGIN IMMEDIATE transaction helper. No ORM and no repository layer.”

---

## Batch 4: EventService public read models

Create:

- `src/services/EventService.ts`

**Responsibilities**

- page-oriented read methods for:
  - landing page
  - year page
  - canonical event page
- year validation
- event key validation and normalization
- visibility enforcement
- result grouping
- `primarySection` derivation

**Test after batch 4**

- unit tests pass
- upcoming event list excludes non-public statuses
- year page returns historical event with no-results state
- canonical page returns not found for invalid/non-public keys

### Good Claude Code prompt for batch 4

“Create only the EventService public read methods for the MVFP slice. Use page-oriented return types. Keep route interpretation and page shaping in the service. Do not add controller logic or templates.”

---

## Batch 5: controllers, routes, and templates

Create:

- `src/routes/publicRoutes.ts`
- `src/controllers/eventsController.ts`
- `src/controllers/healthController.ts`
- public Handlebars templates

**Responsibilities**

- wire service to route
- render HTML views
- return health JSON
- not-found and safe unavailable handling

**Test after batch 5**

- `/events` renders
- `/events/year/<seeded-year>` renders
- `/events/<eventKey>` renders
- invalid routes and invalid event keys behave safely

### Good Claude Code prompt for batch 5

“Create only the public route wiring, controllers, and Handlebars templates for the MVFP routes. Keep controllers thin and templates logic-light.”

---

## Batch 6: integration tests and smoke scripts

Create:

- `tests/integration/events.routes.test.ts`
- `tests/unit/eventService.test.ts`
- `scripts/smoke-local.sh`

**Smoke script should check**

- `/health/live`
- `/health/ready`
- `/events`
- one year page
- one event with results
- one event without results
- one non-public event returning not found

**Test after batch 6**

- integration tests pass
- smoke script passes
- manual browser verification also passes

---

## Batch 7: Docker parity artifacts

Create:

- `docker/web/Dockerfile`
- `docker/worker/Dockerfile`
- `docker/nginx/nginx.conf`
- `docker/docker-compose.yml`
- `docker/docker-compose.prod.yml`

### Why the worker exists now

The worker may be minimal for the first public slice, but the project’s runtime shape includes it. For MVFP v0.1, it can start with:

- structured startup/shutdown
- env validation
- a placeholder loop or disabled-job posture
- future hook points for backups, outbox processing, and scheduled jobs

That keeps runtime shape aligned with the design without forcing the entire background-job platform into the first public slice.

**Test after batch 7**

- `docker compose up --build` works
- nginx fronts the web container
- public routes and health routes work in containers
- local database mount behaves as expected

### Good Claude Code prompt for batch 7

“Create only the Docker and nginx artifacts for this project’s required runtime shape: nginx, web, worker, and local compose. Keep the worker minimal and aligned with the existing architecture rules.”

---

## Batch 8: Terraform and ops artifacts

Create:

- `terraform/shared/`
- `terraform/staging/`
- `terraform/production/`
- `ops/systemd/footbag.service`
- any first-pass deploy helper script you genuinely need

Keep these small and explicit. Do not create a giant infrastructure tree before the app actually runs locally and in Docker.

**Test after batch 8**

- `terraform fmt` and `terraform validate` pass
- environment directories are clear
- service wrapper is readable
- deployment assumptions match actual runtime containers

---

## 25. File responsibility map


| File                                  | Purpose                                                               |
| ------------------------------------- | --------------------------------------------------------------------- |
| `src/app.ts`                          | Express app construction, view engine, middleware, route registration |
| `src/server.ts`                       | process startup and shutdown                                          |
| `src/config/env.ts`                   | environment loading and validation                                    |
| `src/config/logger.ts`                | structured logging                                                    |
| `src/db/db.ts`                        | one SQLite connection module, PRAGMAs, transaction helper             |
| `src/db/openDatabase.ts`              | SQLite connection bootstrap, startup PRAGMAs                          |
| `src/services/EventService.ts`        | public events browse/detail business rules and page shaping           |
| `src/controllers/eventsController.ts` | route-to-service rendering bridge                                     |
| `src/controllers/healthController.ts` | liveness/readiness JSON handlers                                      |
| `src/routes/publicRoutes.ts`          | public route wiring                                                   |
| `src/views/events/*.hbs`              | server-rendered public HTML templates                                 |
| `database/seeds/seed_mvfp_v0_1.sql`   | deterministic local seed scenarios                                    |
| `scripts/reset-local-db.sh`           | local DB rebuild                                                      |
| `scripts/smoke-local.sh`              | local smoke checks                                                    |
| `docker/web/Dockerfile`               | web runtime image                                                     |
| `docker/worker/Dockerfile`            | worker runtime image                                                  |
| `docker/nginx/nginx.conf`             | reverse proxy config                                                  |
| `docker/docker-compose.yml`           | local parity stack                                                    |
| `docker/docker-compose.prod.yml`      | deployment overrides                                                  |
| `ops/systemd/footbag.service`         | production compose wrapper                                            |
| `terraform/`*                         | environment infrastructure definitions                                |


---

# Part F: AWS bootstrap and Terraform handoff

## 26. The bootstrap principle

A blank AWS account cannot be fully “Terraformed from nothing” without a little initial setup. This guide therefore uses a two-phase model:

### Phase 1: one-time human bootstrap

Do the minimum manual work needed to:

- secure the account
- establish a named human operator identity
- install and verify local AWS tooling
- create the Terraform remote-state foundation
- prepare Terraform authority handoff

### Phase 2: Terraform-owned steady state

Once the secure baseline exists, Terraform becomes the normal authority for:

- IAM roles and policies used by the project
- Lightsail instance resources
- CloudFront distribution resources
- S3 buckets that belong to the project
- Parameter Store path scaffolding
- logging resources
- other repeatable infrastructure

This order matters because Terraform itself needs a place to store state and credentials to operate safely.

---

## 27. Secure the AWS account first

Immediately after creating the AWS account, secure the root user: set a strong password, enable MFA, do not create root access keys, and stop using root for routine work. See Part H Phase 1 for the concrete steps.

That is the project’s baseline posture.

---

## 28. Create the first named human operator identity

For the minimum MVFP v0.1 stand-up, use one clear human AWS identity path:

- create one named IAM user for yourself only
- protect it with MFA
- use it for Terraform and AWS-side bootstrap
- do not use it inside the application runtime

Use the name `footbag-operator` consistently throughout this guide.

### Minimum permissions for bootstrap

`footbag-operator` needs **AdministratorAccess** for the bootstrap phase. Terraform creates resources across multiple AWS services. Start with `AdministratorAccess`; scope it down after first successful apply if your organisation requires it.

See Part H Phase 2 for the exact console and CLI steps to create this user and configure the local profile.

Optional later improvement: if you operate under AWS Organizations / IAM Identity Center, you may adapt this guide to SSO-backed human access. That is not required for the minimum stand-up described here.

---

## 29. Configure AWS CLI profiles deliberately

For the minimum MVFP v0.1 stand-up, use one explicit local AWS CLI profile:

- `footbag-operator` — the human operator profile used for Terraform and AWS bootstrap work

Use it for:

- Terraform
- one-time bootstrap actions
- AWS-side troubleshooting
- optional Parameter Store reference updates

Do not create host-side runtime profiles for this minimum deployment. The current public Events + Results slice does not need `AWS_PROFILE` inside containers or a source-profile + AssumeRole chain. Those are later-stage concerns, not requirements for getting the current code running on AWS.

Do **not** mount your human profile inside application containers.

---

## 29.5 Domain and DNS: deferred for initial test deployment

For the initial test deployment, no custom domain, no Route 53 hosted zone, and no ACM certificate are required. CloudFront automatically assigns a working HTTPS URL on its own domain:

```
https://d1a2b3c4d5e6f7.cloudfront.net
```

This URL works immediately after `terraform apply` completes and is sufficient to verify the full stack end-to-end.

The following are **commented out** in the Terraform code for this reason:

- `terraform/staging/acm.tf` — custom TLS certificate (deferred)
- `terraform/staging/route53.tf` — DNS A/AAAA records (deferred)
- the `aliases` block in `cloudfront.tf` — custom domain binding (deferred)
- `cloudfront.tf` uses `cloudfront_default_certificate = true` instead of an ACM cert

The CloudFront URL assigned after `terraform apply` is sufficient to verify the full stack end-to-end. Record it — you will place it into `/srv/footbag/env` as `PUBLIC_BASE_URL`. See Part H Phase 6 to capture it.

If you also want AWS-side reference storage for that value, mirroring it into Parameter Store is optional:

```bash
aws ssm put-parameter \
  --name /footbag/staging/app/public_base_url \
  --type String \
  --value "https://$(terraform output -raw cloudfront_domain)" \
  --overwrite \
  --profile footbag-operator
```

> **Future work — custom domain:** When the project is ready to attach a real domain (e.g. `staging.footbag.org`), the activation checklist is in `terraform/staging/acm.tf`. At that point, `docs/DESIGN_DECISIONS_V0_1.md` and `docs/DEVOPS_GUIDE_V0_1.md` will also need a pass to align with the real domain deployment model.

---

## 30. Create the Terraform remote-state foundation

Before the main Terraform stack can own steady-state resources, create the remote-state bucket. The repository includes `terraform/shared/` for exactly this purpose. It uses **local state** (no backend) because it is the thing that creates the backend.

The bucket name produced by this step must be pasted into `backend.tf` in `terraform/staging/` and `terraform/production/` before those directories can be initialized.

Back up the resulting `terraform/shared/terraform.tfstate` file somewhere safe (password manager, private notes). It is not committed to git. Losing it is recoverable, but keeping it avoids manual reconciliation.

### Why this uses local state

This bucket must exist before the rest of the Terraform configuration can safely use it as a backend. It is intentionally outside the remote-state loop.

See Part H Phases 3 and 4 for the exact commands.

---

## 31. Use explicit environment directories for Terraform

For this project, prefer:

- `terraform/shared`
- `terraform/staging`
- `terraform/production`

over a single giant directory plus heavy workspace-driven environment switching.

Why:

- clearer to volunteers
- clearer review diffs
- clearer backend keys
- lower risk of acting on the wrong environment

You can still understand Terraform workspaces, but do not rely on them as the main readability mechanism for long-lived environments here.

### Example backend block

```hcl
terraform {
  backend "s3" {
    bucket       = "footbag-terraform-state-<unique-suffix>"
    key          = "staging/global.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
```

### Important current Terraform notes

- Use the S3 backend with S3 locking (`use_lockfile = true`). Do not start a new project on the older DynamoDB lock-table pattern.
- `use_lockfile` is stable in Terraform ≥ 1.11 (experimental in 1.10). Both `terraform/staging/providers.tf` and `terraform/shared/providers.tf` are pinned to `>= 1.11` for this reason.
- **Pin the AWS provider version.** AWS provider v6.0 was released June 2025 with breaking changes. Without a pin, `terraform init` pulls the latest major version. Add `version = "~> 5.0"` in `required_providers` unless you have explicitly reviewed the v6 migration guide.
- The S3 backend writes a `.tflock` object alongside the state file when `use_lockfile = true`. Your Terraform operator IAM policy must include `s3:PutObject` and `s3:DeleteObject` on `<bucket>/<key-prefix>*.tflock` or `terraform apply` will fail with `AccessDenied` at lock acquisition.

---

## 32. What becomes Terraform-managed after handoff

After the remote-state foundation and operator identity exist, Terraform should own:

- Lightsail instance resources
- Lightsail static IP resources if used
- CloudFront distribution resources
- project S3 buckets
- runtime IAM roles and policies
- Lightsail firewall / SSH allowlist posture where represented in infrastructure
- logging resources
- environment scaffolding such as Parameter Store path creation where practical

### What remains human-owned

Some things remain human responsibilities even after handoff:

- root credential custody
- MFA device management
- initial secret value entry
- deployment approvals
- SSH key custody and host-access use
- Terraform execution and review
- final smoke verification

Terraform should own the infrastructure shape. It should not replace human accountability.

---

## 33. The Lightsail runtime identity model

For this guide's minimum MVFP v0.1 deployment, the runtime identity story is simple:

- the human AWS CLI identity is `footbag-operator`
- the running application serves the current public Events + Results slice from local process environment and SQLite
- the current public slice does **not** require runtime AWS API calls to boot or serve pages

The minimum stand-up does not require:

- a host-side runtime AWS profile
- `AWS_PROFILE` inside containers
- a source-profile + AssumeRole chain
- a runtime IAM user
- runtime SSM reads

### The one identity separation that matters for this guide

- **human operator identity** (`footbag-operator`) — for Terraform and AWS-side bootstrap
- **application runtime process** — for serving the site

Do not mount your human AWS CLI profile into containers. But do not invent runtime AWS credential plumbing that the current public slice does not use.

### Lightsail does not support EC2 instance profiles

`terraform/staging/iam.tf` may define IAM roles or instance-profile-shaped resources, but a Lightsail instance does not gain EC2 instance-metadata credentials from them. Treat any such resources as deferred groundwork, not as part of the minimum runtime bootstrap.

### Optional future note

If a later version of the app begins calling AWS APIs at runtime, the first simple step would be direct environment-variable credentials in `/srv/footbag/env`. The fuller source-profile + AssumeRole model is a post-MVFP improvement. Neither is required to stand up the current working public slice.

---

# Part G: Parameter Store, Lightsail, CloudFront

## 34. Parameter Store path structure

For this guide's minimum deployment, Parameter Store is optional. Use it only if you want AWS-side reference storage for values that you are also willing to place into `/srv/footbag/env`. The current app does not fetch SSM at startup.

If you choose to use SSM, use a path structure that makes environment and sensitivity obvious.

A simple, readable convention is:

```text
/footbag/staging/app/...
/footbag/staging/secrets/...
/footbag/production/app/...
/footbag/production/secrets/...
```

### Examples

```text
/footbag/staging/app/NODE_ENV
/footbag/staging/app/PUBLIC_BASE_URL
/footbag/staging/app/LOG_LEVEL
/footbag/staging/secrets/SESSION_SIGNING_KEY_ARN
/footbag/staging/secrets/SMTP_FROM
```

### Which parameter type to use

- use `String` for ordinary non-secret config
- use `SecureString` for secrets

### CLI examples

```bash
aws ssm put-parameter \
  --name /footbag/staging/app/PUBLIC_BASE_URL \
  --type String \
  --value https://staging.example.com \
  --overwrite \
  --profile footbag-operator
```

```bash
aws ssm put-parameter \
  --name /footbag/staging/secrets/SESSION_SIGNING_KEY_ARN \
  --type SecureString \
  --value arn:aws:kms:... \
  --overwrite \
  --profile footbag-operator
```

```bash
aws ssm get-parameter \
  --name /footbag/staging/secrets/SESSION_SIGNING_KEY_ARN \
  --with-decryption \
  --profile footbag-operator
```

### Local `.env` versus `/srv/footbag/env` versus Parameter Store

- use local `.env` in development
- use `/srv/footbag/env` as the live runtime config file on the Lightsail host
- use Parameter Store as optional AWS-side reference storage only

The rule to remember: for this deployment, `/srv/footbag/env` is what the app actually runs with.

---

## 35. Lightsail provisioning assumptions for this project

For MVFP v0.1, keep Lightsail simple:

- one Linux instance
- one Docker Compose runtime stack
- one static IP if you need a stable origin endpoint
- minimal persistent storage setup appropriate to the SQLite file and deployment wrapper
- restricted per-operator SSH access for documented host-admin work

The first production-like goal is not auto-scaling. It is a clean, understandable, repeatable single-origin deployment.

### What should live on the host

For the minimum MVFP v0.1 deployment:

- Docker Engine and the Docker Compose plugin
- the application checkout at `/srv/footbag`
- the live runtime env file at `/srv/footbag/env` (root-owned, mode 600)
- the SQLite database file at `/srv/footbag/footbag.db` (root-owned, mode 600)
- the systemd unit that starts Docker Compose from `/srv/footbag`
- named operator SSH accounts for host access

Minimum host layout:

```
/srv/footbag/            # application checkout
/srv/footbag/env         # root-owned runtime env file
/srv/footbag/footbag.db  # SQLite database
/etc/systemd/system/footbag.service
```

### What should not live on the host as ad hoc sprawl

- random copies of secrets
- unversioned deployment commands
- unexplained manual edits to container config

### Required footbag.service contract

The systemd unit must at minimum:

- depend on Docker being available (`After=docker.service`, `Requires=docker.service`)
- use `WorkingDirectory=/srv/footbag`
- load `EnvironmentFile=/srv/footbag/env`
- start the stack with `docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up -d`
- stop the stack with the matching `docker compose ... down`

This is how `systemctl restart footbag` turns the code in `/srv/footbag` plus the values in `/srv/footbag/env` into a running stack.

See Part H Phases 8–13 for the concrete bootstrap and deployment commands.

---

## 36. SSH setup and normal usage

> **Default SSH username for Amazon Linux 2023 on Lightsail:** `ec2-user`. Use this for the first bootstrap login only. Create your named operator account immediately after and use that for all subsequent host work. See Part H Phase 8 for the concrete steps.

### Project SSH standard

- do use named non-root operator accounts with `sudo`
- do use separate SSH key pairs per operator
- do restrict port 22 to approved source IPs or CIDR ranges
- do not share private keys
- do not use shared shell accounts

One important project rule: the identity used for SSH host access is **not** the same thing as the application’s runtime AWS principal. SSH gets you onto the box; it is not the application’s AWS identity model.

---

## 37. CloudFront in front of the Lightsail origin

CloudFront’s job in this project is to front the single origin cleanly.

> For this guide's minimum deployment, ACM is not needed. The CloudFront default `*.cloudfront.net` domain is sufficient to verify the working public slice. ACM becomes relevant only when a custom domain is introduced later.

At minimum, the distribution should:

- point at the Lightsail origin
- forward the headers/cookies/query behavior the app actually needs
- support public delivery of the site
- provide a clean place to define custom error responses

### Maintenance and safe-failure posture

> **v0.1 deferred — maintenance page is not functional.** The CloudFront distribution has no `ordered_cache_behavior` routing `/maintenance.html` to the S3 origin. The custom error response block exists in `cloudfront.tf`, but when the Lightsail origin is down the error response will itself fail to load. The full fix requires an S3 cache behavior, an Origin Access Control (OAC), and an X-Origin-Verify header to restrict direct-to-origin access. This is tracked as a reliability TODO. Do not rely on the maintenance page in v0.1.

For early phases, keep this simple:

- return friendly maintenance/error pages for origin 502/503/504 conditions
- use short error caching TTLs so recovery is not hidden behind long cache retention
- keep the maintenance behavior obvious and documented

You do not need an elaborate “maintenance platform” to stand up the first slice.

---

## 38. Origin validation and public validation

See Part H Phases 14 and 15 for the concrete validation steps and expected outcomes for both the Lightsail origin and the public CloudFront path.

---

# Part H: AWS deployment runbook (v0.1 test deployment)

This runbook covers a complete first-time deployment to AWS from scratch. It assumes:
- AWS account exists and root MFA is enabled
- Terraform >= 1.11 and AWS CLI v2 are installed locally
- You have the repo checked out locally and all code works locally

> **Scope:** CloudFront default `*.cloudfront.net` URL only. No custom domain, no ACM certificate, no runtime SSM fetch, and no runtime IAM user are required for this minimum deployment.

---

### Phase 1: AWS root account hardening

1. Sign in as root. Enable MFA on the root account.
2. Do not create access keys for root.
3. Proceed to Phase 2 to create an IAM operator user.

---

### Phase 2: Create IAM operator user

Use the **AWS Console** to create this user — you have no CLI credentials yet.

1. Sign in to the AWS Console as root.
2. Go to IAM → Users → Create user. Name: `footbag-operator`.
3. Attach policy: `AdministratorAccess` (scope down post-launch if required).
4. Create access keys: IAM → Users → footbag-operator → Security credentials → Create access key. Choose "CLI". Save `AccessKeyId` and `SecretAccessKey` — shown once only.

Configure your local AWS CLI profile:

```bash
aws configure --profile footbag-operator
# Enter: AccessKeyId, SecretAccessKey, region (e.g. us-east-1), output format (json)
export AWS_PROFILE=footbag-operator

# Verify
aws sts get-caller-identity
```

> **Bootstrap shortcut — NS-1 (broad IAM permissions):** `AdministratorAccess` is used here because Terraform touches many AWS services during bootstrap and scoping permissions in advance is impractical. After the first successful `terraform apply`, replace `AdministratorAccess` with a policy scoped to the services Terraform actually manages (Lightsail, CloudFront, S3, IAM, KMS, SSM, CloudWatch, SNS). See NS-1.

> **Bootstrap shortcut — NS-2 (long-lived access keys):** IAM access keys are long-lived static credentials. Once the stack is stable, rotate to short-lived credentials: either `aws sts get-session-token` with MFA enforcement, or AWS IAM Identity Center (SSO), which issues temporary tokens automatically. See NS-2.

> **Session note:** `export AWS_PROFILE=footbag-operator` applies only to the current shell session. If you open a new terminal for any later phase, re-run this export before running Terraform or AWS CLI commands.

---

### Phase 3: Bootstrap the Terraform state bucket

The state bucket is created once and shared by all environments. It uses local state.

> **Session check:** Confirm `AWS_PROFILE=footbag-operator` is set before running any Terraform command. If you are in a new terminal session since Phase 2, re-run `export AWS_PROFILE=footbag-operator` first.

```bash
cd terraform/shared
# Create terraform.tfvars — fill in your values (variables.tf has TODO defaults as hints)
cat > terraform.tfvars <<EOF
aws_account_id      = "123456789012"
state_bucket_suffix = "a1b2c3d4"
EOF
terraform init
terraform validate
terraform apply
# Note the output: terraform_state_bucket_name (e.g. footbag-terraform-state-a1b2c3d4)
```

---

### Phase 4: Configure staging backend and variables

```bash
cd terraform/staging
```

Edit `backend.tf` — replace the two TODO placeholders with:
- the bucket name from Phase 3
- the same region you used

Edit `terraform.tfvars` (copy from `terraform.tfvars.example`):

```hcl
aws_account_id     = "123456789012"
state_bucket_suffix = "<same suffix as shared>"
ssh_public_key     = "<contents of your ~/.ssh/id_ed25519.pub>"
alarm_email        = "you@example.com"
# domain_name and route53_zone_id — leave as "" for test deployment
```

---

### Phase 5: Terraform init, validate, plan

```bash
terraform init
terraform validate
terraform plan -out=tfplan
# Review the plan — expected: ~40 resources to create
```

---

### Phase 6: Terraform apply

```bash
terraform apply tfplan
```

Note these outputs after apply completes:

```bash
terraform output lightsail_static_ip
terraform output cloudfront_domain       # e.g. d1abc123.cloudfront.net
```

---

### Phase 7: Record the CloudFront URL

Capture the CloudFront URL now. You will place it into `/srv/footbag/env` later as `PUBLIC_BASE_URL`.

```bash
CF_DOMAIN=$(terraform output -raw cloudfront_domain)
echo "$CF_DOMAIN"
```

If you also want AWS-side reference storage for that value, mirroring it into Parameter Store is optional:

```bash
aws ssm put-parameter \
  --name "/footbag/staging/app/public_base_url" \
  --value "https://$CF_DOMAIN" \
  --type String \
  --overwrite \
  --profile footbag-operator
```

> **CloudFront propagation delay:** After `terraform apply`, CloudFront takes **15–30 minutes** to deploy globally. The `*.cloudfront.net` URL is assigned immediately but returns errors during propagation. Do **not** attempt Phase 15 until the distribution status shows **Deployed**. Check in the AWS Console → CloudFront → Distributions → Status column, or poll with:
> ```bash
> aws cloudfront get-distribution --id $(terraform output -raw cloudfront_distribution_id) \
>   --query 'Distribution.Status' --output text --profile footbag-operator
> ```
> Wait for `Deployed` before proceeding to Phase 15.

---

### Phase 8: SSH into the Lightsail instance and create your named operator account

```bash
LIGHTSAIL_IP=$(terraform output -raw lightsail_static_ip)
ssh -i ~/.ssh/id_ed25519 ec2-user@$LIGHTSAIL_IP
```

> Replace `~/.ssh/id_ed25519` with the path to the private key whose public half you placed in `ssh_public_key` in `terraform.tfvars`. SSH will only attempt the correct key automatically if it is at a default location. If login fails with `Permission denied (publickey)`, specify the key path explicitly with `-i`.

> **Bootstrap shortcut — NS-6 (ec2-user initial access):** `ec2-user` is the Lightsail default account. It is used here only for first-time bootstrap. Create your named operator account immediately (next step) and stop using `ec2-user` after that. The long-term plan is to disable `ec2-user` login entirely once your named account is confirmed working. See NS-6.

**Immediately after first login**, create your named operator account before doing anything else. Replace `yourname` with your actual operator username:

```bash
sudo useradd -m -G wheel yourname
sudo mkdir -p /home/yourname/.ssh
sudo tee /home/yourname/.ssh/authorized_keys <<< "<your SSH public key>"
sudo chown -R yourname:yourname /home/yourname/.ssh
sudo chmod 700 /home/yourname/.ssh
sudo chmod 600 /home/yourname/.ssh/authorized_keys
```

In the Lightsail console, restrict port 22 to your source IP or CIDR now.

Verify your named account works before closing the `ec2-user` session:

```bash
# In a new terminal
ssh -i ~/.ssh/id_ed25519 yourname@$LIGHTSAIL_IP
sudo whoami   # should return: root
```

From this point, use your named account for all remaining phases.

---

### Phase 9: Install Docker on the host

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin sqlite
sudo systemctl enable --now docker
sudo usermod -aG docker yourname
# Log out and back in for group membership to take effect
```

> **Bootstrap shortcut — manual Docker install:** Docker is installed here manually via SSH because `lightsail.tf` has a placeholder `user_data` script (`echo "bootstrap placeholder"`). The long-term plan is to replace that placeholder with a real bootstrap script that installs Docker, creates the `/srv/footbag` directory layout, and sets up the systemd service at instance launch time — eliminating the need for manual SSH in Phases 9–12. See `terraform/staging/lightsail.tf` TODO comment.

---

### Phase 10: Create the host env file

Create the live runtime config file the app will actually run with:

```bash
sudo mkdir -p /srv/footbag
sudo tee /srv/footbag/env > /dev/null <<EOF
NODE_ENV=production
FOOTBAG_DB_PATH=/srv/footbag/footbag.db
PUBLIC_BASE_URL=https://<cloudfront_domain from Phase 6>
EOF
sudo chown root:root /srv/footbag/env
sudo chmod 600 /srv/footbag/env
```

These are the required values for this guide's minimum deployment:

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | yes | run the app in production mode |
| `FOOTBAG_DB_PATH` | yes | point the app at the host SQLite file |
| `PUBLIC_BASE_URL` | yes | generate correct public URLs |

Do not add runtime AWS credentials here. They are not needed for the current public slice.

> **Bootstrap shortcut — NS-9 (manual env file):** `/srv/footbag/env` is created and edited by hand on the host. This is the simplest working approach for v0.1. The long-term plan is a startup script (wired into the `footbag.service` `ExecStartPre` directive) that pulls values from AWS Systems Manager Parameter Store and writes `/srv/footbag/env` automatically before the Compose stack starts. That removes the need to SSH in just to update a config value. See NS-9.

---

### Phase 11: Deploy app files to host

From your local machine, copy the repo to a staging path in your named operator's home directory:

```bash
LIGHTSAIL_IP=<ip from terraform output>
rsync -av --delete \
  --exclude=node_modules --exclude=.git \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  ./ yourname@$LIGHTSAIL_IP:~/footbag-release/
```

> **Bootstrap shortcut — NS-7 (build on host, deploy via rsync):** Files are transferred directly from your local machine and images are built on the host. This requires no container registry or CI pipeline. The long-term plan is to build images in CI (e.g. GitHub Actions), push to a registry (AWS ECR), and have the host do `docker compose pull` instead of `docker compose build`. That separates build from deploy, enables versioned rollbacks, and removes the need for build tools on the host. See NS-7.

Then on the host, promote the staged copy into the root-owned runtime path:

```bash
sudo mkdir -p /srv/footbag
sudo rsync -a --delete ~/footbag-release/ /srv/footbag/
sudo chown -R root:root /srv/footbag
```

---

### Phase 12: Bootstrap the database

Do this **only on the first deploy**.

```bash
cd /srv/footbag
sudo sqlite3 /srv/footbag/footbag.db < database/schema_v0_1.sql
# Optional smoke-test seed:
# sudo sqlite3 /srv/footbag/footbag.db < database/seeds/seed_mvfp_v0_1.sql
sudo chown root:root /srv/footbag/footbag.db
sudo chmod 600 /srv/footbag/footbag.db
```

> **Runtime user note:** The web container runs as root (no `USER` directive in the Dockerfile) and the systemd unit runs as root (no `User=` directive). This means the bind-mounted root-owned SQLite file and any WAL/SHM sidecar files it creates are writable as deployed. If you later add a non-root `USER` to the Dockerfile, update the host ownership and mode on `/srv/footbag/footbag.db` and `/srv/footbag/` to match that UID.

On later deploys, reuse the existing database file.

> **Bootstrap shortcut — NS-5 (no automated DB backup):** The database file at `/srv/footbag/footbag.db` has no automated backup at this point. A host failure or accidental deletion is unrecoverable. After confirming the stack is stable, add a cron job or systemd timer to copy the file to the S3 snapshots bucket on a scheduled interval (use `sqlite3 .backup` for a safe online copy). See NS-5.

---

### Phase 13: Build and start the app

On the host:

```bash
cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo cp ops/systemd/footbag.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now footbag
sudo systemctl status footbag
```

> **Expected warning during build:** Docker Compose reads `docker-compose.prod.yml` while building and will print `WARN: The "PUBLIC_BASE_URL" variable is not set. Defaulting to a blank string.` This is normal — `PUBLIC_BASE_URL` is only needed at container start time, which systemd handles via `EnvironmentFile=/srv/footbag/env`. The build succeeds regardless.

> **Bootstrap shortcut — NS-7 (images built on host):** Images are built directly on the Lightsail host from source. This is the simplest first-deployment approach but requires build tools on the host and is slow. The long-term plan is to build in CI and distribute via a container registry (AWS ECR), so the host only needs to pull pre-built images. See NS-7.

At this point, the `footbag` systemd unit turns the code in `/srv/footbag` plus the values in `/srv/footbag/env` into the running Compose stack.

On later deploys:

```bash
cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo systemctl restart footbag
```

---

### Phase 14: Smoke test the origin directly

Test through nginx on port 80 (the web container exposes port 3000 only within the Docker network; nginx is the host-facing entry point):

```bash
curl -i http://localhost/health/live
curl -i http://localhost/health/ready
curl -i http://localhost/events
curl -i http://localhost/events/year/2025
curl -i http://localhost/events/event_2025_beaver_open
curl -i http://localhost/events/event_2026_spring_classic
curl -i http://localhost/events/does_not_exist
```

Expected: health and event routes return 200; the spring classic returns 200 with the no-results state; the invalid key returns 404.

---

### Phase 15: Verify through CloudFront

> **Wait for CloudFront deployment before testing.** CloudFront takes 15–30 minutes to propagate after `terraform apply`. Confirm the distribution status is **Deployed** (AWS Console → CloudFront → Distributions, or the `aws cloudfront get-distribution` poll command from Phase 7) before proceeding. Requests to the `*.cloudfront.net` URL return errors until propagation is complete.

> **Bootstrap shortcut — NS-4 (maintenance page not functional):** The CloudFront custom error responses for 502/503 reference `/maintenance.html` from an S3 origin, but that S3 origin has no Origin Access Control (OAC) configured. If the Lightsail origin is down, the error response itself will also fail. This is a known v0.1 gap. Do not rely on the maintenance page. The full fix requires an OAC, an S3 cache behavior routing `/maintenance.html` to the S3 origin, and an `X-Origin-Verify` secret to prevent direct-to-origin bypass. See NS-4.

In a browser or with curl:

```
https://<cloudfront_domain>/health/live
https://<cloudfront_domain>/health/ready
https://<cloudfront_domain>/events
https://<cloudfront_domain>/events/year/2025
https://<cloudfront_domain>/events/event_2025_beaver_open
https://<cloudfront_domain>/events/event_2026_spring_classic
https://<cloudfront_domain>/events/does_not_exist
```

Confirm:

- health endpoints return success
- `/events` loads with correct HTML and styling
- the year archive page loads
- the event detail page with results loads
- the event detail page without results renders the no-results state correctly
- the invalid event key returns 404
- no stack traces or internal details appear in responses

---

# Part I: Verification, troubleshooting, deferred work

## 39. Local smoke checks

Create `scripts/smoke-local.sh` and make it executable.

A good local smoke script should verify:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

curl -fsS "$BASE_URL/health/live" >/dev/null
curl -fsS "$BASE_URL/health/ready" >/dev/null
curl -fsS "$BASE_URL/events" >/dev/null
curl -fsS "$BASE_URL/events/year/2025" >/dev/null
curl -fsS "$BASE_URL/events/event_2025_beaver_open" >/dev/null
curl -fsS "$BASE_URL/events/event_2026_spring_classic" >/dev/null

echo "Local smoke checks passed."
```

Also verify manually in the browser:

- the landing page shows upcoming events
- archive years exist
- the year page shows the full selected year
- events with no result rows render clearly
- non-public events do not leak into the public slice

---

## 40. Container smoke checks

After Docker parity artifacts exist:

```bash
docker compose up --build
```

Then repeat the same smoke script against the container-exposed port.

Also verify:

- nginx serves the app correctly
- DB mount path is correct
- container restarts are clean
- the worker container starts cleanly even if it is minimal

---

## 41. Public deployment smoke checks

Create `scripts/smoke-public.sh` and run it against the public URL after deployment.

Check:

- `/health/live`
- `/health/ready`
- `/events`
- a known year page
- a known canonical event page with results
- a known canonical event page without results
- one invalid event key returning not found

Then do a human browser pass.

For the first deployment, do not skip the human pass.

---

## 42. Common implementation mistakes

### Architecture mistakes

- adding Prisma or another ORM
- adding a repository layer
- pushing business rules into controllers
- pushing business rules into templates
- creating separate public detail and results routes
- inventing an `event_slug` column

### SQLite mistakes

- forgetting `PRAGMA foreign_keys = ON` on every connection
- using `datetime('now')` instead of the required UTC ISO format
- doing async work inside a transaction
- creating a generic retry loop instead of surfacing temporary-unavailable behavior cleanly

### Public-slice contract mistakes

- exposing `draft` or `canceled` events publicly
- paginating the year archive
- hiding historical events that lack result rows
- treating no-results historical pages as a different route

### WSL / Docker mistakes

- storing the repo under `/mnt/c/...`
- assuming Docker parity is optional
- debugging only in host-run mode and never validating the container shape

### Node.js / dependency mistakes

- using `better-sqlite3` v9 on Node 24 — it does not compile; the native binding changed; pin to `^12.6.2` or later
- placing any `import` before `import 'dotenv/config'` in `server.ts` — any module imported first that reads `process.env` will see an empty environment because dotenv has not run yet
- using lazy `require()` inside `app.ts` to import route modules — breaks Vitest's ESM transform; use static `import` at the top of the file
- forgetting that `db.ts` opens the SQLite connection at module-load time — `FOOTBAG_DB_PATH` must be in `process.env` before the first transitive import of `db.ts` occurs

### AI-workflow mistakes

- asking Claude Code to build the entire project in one shot
- accepting code without reading the diff
- letting AI invent infrastructure you did not ask for
- letting AI choose abstractions that violate the documented architecture

---

## 43. Common AWS/bootstrap mistakes

- continuing to use the root user after bootstrap
- creating or keeping root access keys
- using shared AWS users
- assuming the current public slice needs runtime AWS credentials when it does not
- assuming Lightsail gives you an EC2 instance-profile story identical to EC2
- leaving SSH broadly exposed instead of restricting it to approved source IPs or CIDRs
- updating Parameter Store and expecting the running app to change without also updating `/srv/footbag/env`
- copying files directly into a root-owned `/srv/footbag` without using a staging path and sudo promotion
- mixing staging and production state in the same Terraform path
- creating Terraform state storage without versioning or encryption
- relying on old Terraform DynamoDB locking patterns in a new setup
- running `sudo dnf install -y docker-compose-plugin` without first adding the Docker CE repo — the package is not in AL2023 default repos and the install will silently fail or error
- running `docker compose pull` instead of `docker compose build` when using a locally-built image — there is no registry to pull from in v0.1

---

## 44. First-success criteria

You have reached first success when all of the following are true:

### Local host-run success

- `npm run dev` starts the app
- local DB bootstrap works
- `/events`, `/events/year/:year`, `/events/:eventKey`, `/health/live`, and `/health/ready` all behave correctly
- seeded scenarios prove:
  - upcoming event
  - completed event with results
  - completed event without results
  - non-public event not found

### Docker parity success

- `docker compose up --build` works
- nginx, web, and worker all start
- the same smoke paths work through the container stack

### AWS/bootstrap success

- root is hardened
- the `footbag-operator` AWS CLI profile works
- SSH to the Lightsail host works with a named operator account
- Terraform remote state exists
- Terraform configuration validates and applies
- the CloudFront domain is known
- `/srv/footbag/env` exists on the host with the required values
- `/srv/footbag/footbag.db` exists on the host

### First public deployment success

- the Lightsail origin is up
- CloudFront fronts it on the default `*.cloudfront.net` URL
- `/health/live` and `/health/ready` work through both the origin and CloudFront
- `/events`, the year page, the event detail page with results, and the event detail page without results all work
- one invalid event key returns 404
- the host can rebuild the images and restart the stack cleanly
- public smoke checks pass

That is enough to count as a successful onboarding and first-slice implementation baseline.

---

## 45. Deferred work

The following are intentionally deferred and must not block first public success for this slice:

- member login and session flows
- Stripe
- SES-driven full email system
- admin UI
- richer readiness composition
- backup-age readiness gates
- disaster-recovery drills
- broader media and gallery implementation
- broader club/member/admin features
- post-launch operational polish not required to stand up the first public slice

Deferring these is not cutting corners. It is keeping the first slice proportionate.

---

## 46. Human, engineer, and AI handoff boundaries

## Human engineer

Owns:

- reading and understanding the authority docs
- deciding the implementation batch sequence
- reviewing diffs
- running the commands
- inspecting SQL and templates
- operating AWS
- applying Terraform
- validating smoke paths
- making deployment decisions

## System administrator / operator role

In a small project this may be the same human, but the responsibilities are distinct:

- account hardening
- MFA posture
- AWS identity management
- SSH posture
- host-side credential custody for future runtime API needs
- production rollout approval
- recovery execution if needed

## AI assistant

May help with:

- drafting files
- proposing implementations
- generating tests
- producing repeated boilerplate
- summarizing architecture rules

Must not be treated as the owner of:

- security posture
- AWS account operations
- Terraform authority
- correctness judgment
- final architectural decisions

---

## 47. A practical first-week plan for a new contributor

### Day 1

- install tools in Windows + WSL
- read the five authority docs
- create the repository skeleton
- create project AI rule files

### Day 2

- add app bootstrap, DB bootstrap, and seeds
- prove the local database reset flow
- prove health endpoints

### Day 3

- implement EventService public read models
- add route wiring and templates
- prove local smoke checks

### Day 4

- add tests and Docker parity artifacts
- prove container smoke checks

### Day 5

- prepare AWS account baseline
- create remote state
- scaffold Terraform
- stand up the first deployment path

This plan is intentionally realistic for a volunteer project. It is not a hackathon sprint and not a six-week architecture study.

---

# Appendix A: Current official references used to verify this guide

## AWS

- AWS CLI install: [https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- AWS CLI quickstart: [https://docs.aws.amazon.com/cli/latest/userguide/getting-started-quickstart.html](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-quickstart.html)
- IAM Identity Center with AWS CLI: [https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- `aws configure sso`: [https://docs.aws.amazon.com/cli/latest/reference/configure/sso.html](https://docs.aws.amazon.com/cli/latest/reference/configure/sso.html)
- Root user best practices: [https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)
- IAM best practices: [https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- Lightsail SSH keys and connection overview: [https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-ssh-in-amazon-lightsail.html](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-ssh-in-amazon-lightsail.html)
- Set up SSH keys for Lightsail: [https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-ssh.html](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-ssh.html)
- Lightsail firewall and port rules: [https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail).
- Parameter Store: [https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- SecureString and KMS: [https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html)
- Parameter Store IAM access: [https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-access.html](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-access.html)
- Lightsail instance creation: [https://docs.aws.amazon.com/lightsail/latest/userguide/how-to-create-amazon-lightsail-instance-virtual-private-server-vps.html](https://docs.aws.amazon.com/lightsail/latest/userguide/how-to-create-amazon-lightsail-instance-virtual-private-server-vps.html)
- CloudFront custom error responses: [https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)
- CloudFront error-page procedure: [https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-procedure.html](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-procedure.html)

## Terraform

- Install Terraform: [https://developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install)
- Install tutorial: [https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli)
- S3 backend: [https://developer.hashicorp.com/terraform/language/backend/s3](https://developer.hashicorp.com/terraform/language/backend/s3)
- State workspaces: [https://developer.hashicorp.com/terraform/language/state/workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces)
- CLI workspace overview: [https://developer.hashicorp.com/terraform/cli/workspaces](https://developer.hashicorp.com/terraform/cli/workspaces)

## Docker

- Docker Desktop on WSL 2: [https://docs.docker.com/desktop/features/wsl/](https://docs.docker.com/desktop/features/wsl/)
- Docker WSL best practices: [https://docs.docker.com/desktop/features/wsl/best-practices/](https://docs.docker.com/desktop/features/wsl/best-practices/)
- Docker “Use WSL”: [https://docs.docker.com/desktop/features/wsl/use-wsl/](https://docs.docker.com/desktop/features/wsl/use-wsl/)
- Docker Compose install on Linux: [https://docs.docker.com/compose/install/linux/](https://docs.docker.com/compose/install/linux/)
- Docker build best practices: [https://docs.docker.com/build/building/best-practices/](https://docs.docker.com/build/building/best-practices/)
- Docker multi-stage builds: [https://docs.docker.com/build/building/multi-stage/](https://docs.docker.com/build/building/multi-stage/)

## Node / npm

- Node downloads: [https://nodejs.org/en/download](https://nodejs.org/en/download)
- Node release status: [https://nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases)
- npm install guidance: [https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/)

## Cursor and Claude Code

- Cursor downloads: [https://cursor.com/docs/downloads](https://cursor.com/docs/downloads)
- Cursor docs home: [https://cursor.com/docs](https://cursor.com/docs)
- Cursor quickstart: [https://cursor.com/docs/get-started/quickstart](https://cursor.com/docs/get-started/quickstart)
- Cursor rules: [https://cursor.com/docs/context/rules](https://cursor.com/docs/context/rules)
- Claude Code quickstart: [https://docs.anthropic.com/en/docs/claude-code/quickstart](https://docs.anthropic.com/en/docs/claude-code/quickstart)
- Claude Code setup: [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)
- Claude Code overview: [https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- Claude Code common workflows: [https://docs.anthropic.com/en/docs/claude-code/common-workflows](https://docs.anthropic.com/en/docs/claude-code/common-workflows)
- Claude Code settings: [https://docs.anthropic.com/en/docs/claude-code/settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- Claude Code memory: [https://docs.anthropic.com/en/docs/claude-code/memory](https://docs.anthropic.com/en/docs/claude-code/memory)

---

# Next Steps: Closing the Bootstrap Shortcuts

The initial deployment described in this guide uses several deliberate shortcuts to keep the first stand-up simple and achievable. Each one is safe enough for a first working deployment but should be addressed before the environment is treated as durable production.

This section names every shortcut and the action needed to close it.

---

## NS-1: Scope down `footbag-operator` IAM permissions

**Shortcut:** `footbag-operator` holds `AdministratorAccess`, which is intentionally broad for the bootstrap phase.

**Action:** After the first successful `terraform apply`, review the AWS services Terraform actually touches (IAM, Lightsail, CloudFront, S3, SSM, CloudWatch) and replace `AdministratorAccess` with an inline or managed policy scoped to those services only. Keep a record of the policy you replace it with.

**Why it matters:** An operator credential with `AdministratorAccess` can do anything in the account. Scoping it down limits the blast radius of a compromised or accidentally misused key.

---

## NS-2: Remove `footbag-operator` long-lived access keys after first deployment

**Shortcut:** `footbag-operator` uses long-lived IAM access keys (created in Phase 2).

**Action:** Once you have completed the first deployment and verified the stack, consider switching `footbag-operator` to short-lived credentials. The cleanest path for a single-account setup is to enable MFA for API calls and use `aws sts get-session-token` before running Terraform. For a more mature setup, migrate to AWS IAM Identity Center (SSO), which issues short-lived tokens automatically.

**Why it matters:** Long-lived access keys are a persistent credential that can be compromised if they leak. Short-lived tokens expire and are much safer for ongoing operator use.

---

## NS-3: Attach a custom domain and ACM certificate

**Shortcut:** The initial deployment uses the default `*.cloudfront.net` URL with no custom domain.

**Action:**
1. Register or transfer the domain to Route 53 (or configure an existing registrar to point at Route 53).
2. Uncomment and apply `terraform/staging/acm.tf` to provision the ACM certificate in `us-east-1`.
3. Uncomment the `aliases` block in `cloudfront.tf` and the Route 53 A/AAAA records.
4. Re-run `terraform apply`.
5. Update `PUBLIC_BASE_URL` in `/srv/footbag/env` and restart the service.

**Note:** The ACM certificate must be provisioned in `us-east-1` regardless of where other resources live. The Terraform code already includes a `aws.us_east_1` provider alias for this.

---

## NS-4: Fix the CloudFront maintenance page

**Shortcut:** The CloudFront custom error response block exists in `cloudfront.tf` but the maintenance page itself will fail to load when the Lightsail origin is down, because the S3 origin behavior is not configured.

**Action:** The full fix requires:
1. An S3 bucket holding the maintenance page HTML.
2. An Origin Access Control (OAC) allowing CloudFront to read from that bucket.
3. An `ordered_cache_behavior` in `cloudfront.tf` routing `/maintenance.html` to the S3 origin.
4. An `X-Origin-Verify` header mechanism to prevent direct-to-origin access bypassing CloudFront.

Until this is complete, do not rely on the maintenance page for graceful downtime behavior.

---

## NS-5: Establish a SQLite backup plan

**Shortcut:** The initial deployment has no automated backup of `/srv/footbag/footbag.db`.

**Action:** Add a cron job or systemd timer on the Lightsail host to copy the database file to S3 on a scheduled interval. A safe approach for SQLite:

```bash
# Safe online backup using SQLite's built-in backup mechanism
sqlite3 /srv/footbag/footbag.db ".backup /tmp/footbag-backup.db"
aws s3 cp /tmp/footbag-backup.db s3://<backup-bucket>/footbag/$(date +%Y-%m-%d-%H%M%S).db
rm /tmp/footbag-backup.db
```

The worker container is the natural place to own this job once it is no longer a stub. Until then, a host-level cron job is acceptable.

**Why it matters:** SQLite on a single Lightsail host with no backup is a data-loss risk. A single host failure or accidental file deletion is unrecoverable without a backup.

---

## NS-6: Harden the Lightsail host further

**Shortcut:** The initial bootstrap uses `ec2-user` for first login and the Lightsail-managed SSH key pair. Named operator accounts are created immediately, but several host-hardening steps are deferred.

**Actions:**
- Disable or remove `ec2-user` password login once your named account is confirmed working.
- Consider disabling the Lightsail-managed browser SSH entirely (Lightsail console → Networking → SSH key pairs) once your own key is in place.
- Review and apply `unattended-upgrades` or equivalent automatic security patching for the host OS.
- Set up basic host-level logging so you can audit who did what via SSH.

---

## NS-7: Move to a container registry for image distribution

**Shortcut:** Docker images are built directly on the Lightsail host from source during each deployment. This works for v0.1 but requires build tools on the production host and is slow.

**Action:** When deployment frequency or team size increases, the right next step is:
1. Build images in CI (GitHub Actions or equivalent).
2. Push to a container registry (AWS ECR is the natural fit).
3. Change the deployment pattern to `docker compose pull` on the host instead of `docker compose build`.
4. Remove build tools (`docker-buildx-plugin`, build deps) from the host if desired.

This also enables image verification, versioned rollbacks, and separation of build from deploy.

---

## NS-8: Wire up runtime AWS credentials when the app needs them

**Shortcut:** The current public slice serves pages entirely from local process environment and SQLite. No runtime AWS API calls are made, so no runtime credentials are needed.

**Action required when:** the worker begins using S3 (media), SES (email outbox), or any other AWS service; or when SSM runtime reads are added to the app startup.

**When that point arrives:**
1. Create a scoped IAM user or role for runtime use.
2. Add the credentials to `/srv/footbag/env` under `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`.
3. The `footbag.service` `EnvironmentFile` directive already propagates these into containers.
4. The longer-term improvement is a source-profile + AssumeRole chain per service (web vs worker), which provides temporary credentials and a cleaner audit trail.

---

## NS-9: Activate Parameter Store for runtime config management

**Shortcut:** Parameter Store is optional reference storage in this guide. The app reads `/srv/footbag/env` only.

**Action:** Once the app or team grows to the point where hand-editing `/srv/footbag/env` on the host feels fragile, the next step is a small startup script that pulls values from SSM and writes `/srv/footbag/env` before the Compose stack starts. That script slots into the `footbag.service` `ExecStartPre` directive. Until then, the manual env file approach is acceptable.

---

## NS-10: Review and activate CloudWatch monitoring

**Shortcut:** The Terraform configuration includes CloudWatch alarm scaffolding but monitoring is minimal for the first deployment.

**Action:** After the stack is stable, review `terraform/staging/cloudwatch.tf` (or equivalent) and activate alarms for:
- Lightsail instance CPU and status checks
- CloudFront 5xx error rate
- CloudFront 4xx error rate (elevated 4xx can indicate routing or caching problems)

Connect alarms to the SNS topic already created by Terraform (the `alarm_email` variable in `terraform.tfvars`).

---

## Bootstrap shortcut summary

| Item | Shortcut used | Action |
|---|---|---|
| NS-1 | `AdministratorAccess` on footbag-operator | Scope down after first apply |
| NS-2 | Long-lived access keys | Switch to short-lived credentials or SSO |
| NS-3 | `*.cloudfront.net` URL | Add custom domain, ACM cert, Route 53 |
| NS-4 | Maintenance page broken | Wire up S3 origin + OAC in CloudFront |
| NS-5 | No DB backup | Add SQLite backup job to S3 |
| NS-6 | Host not fully hardened | Disable ec2-user, add OS auto-patching |
| NS-7 | Images built on host | Move to CI + container registry |
| NS-8 | No runtime AWS credentials | Add when app begins calling AWS APIs |
| NS-9 | Manual `/srv/footbag/env` | Add SSM pull script when team/scale warrants it |
| NS-10 | Minimal monitoring | Activate CloudWatch alarms |

None of these are required to reach first-deployment success as defined in §44. They are the path from "working first deployment" to "durable production posture."

---

## Appendix B: Authoritative project facts this guide preserves

This guide preserves the project constraints defined in the authority docs, including:

- Express + Handlebars + TypeScript server-rendered application
- one SQLite DB module
- prepared statements prepared once
- thin controllers
- services own page shaping
- no ORM
- no repository layer
- canonical `GET /events/:eventKey` public route
- non-paginated whole-year archive page
- explicit no-results rendering for historical events with no result rows
- minimal MVFP readiness semantics
- Lightsail origin behind CloudFront
- `/srv/footbag/env` as the live runtime config source for non-local deployments; Parameter Store is optional AWS-side reference storage
- hardened per-operator SSH for operator shell access
- manual bootstrap only until Terraform authority is established

