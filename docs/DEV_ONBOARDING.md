# Footbag Website Modernization Project --  Developer Onboarding Guide

## Local Quickstart, Architecture Orientation, and AWS Staging Deployment

This guide helps contributors do different things: understand how the initial public slice is structured and how it was originally assembled, get that slice to run locally (view a working page in your browser), deploy the slice to AWS in a bootstrap scenario, and then close the bootstrap shortcuts.

> **Choose your path**
>
> - **Path A** — I am a brand-new contributor on Windows + WSL. I need to install the tools, clone the repo with HTTPS, run the tests, start the dev server, and load the public Events + Results pages locally.
> - **Path B** — I need the architecture mental model, scope boundaries, and workflow rules.
> - **Path C** — I need the original blank-slate build order, and detailed historical implementation logic, how to get that initial v0,1 setup to work.
> - **Path D** — I already have the app working locally, and I am continuing the AWS bootstrap deployment.
> - **Path E** — The first deployment works. I need the transition mental model: what is now complete enough to use staging, what remains intentionally temporary, and where the remaining hardening work has moved.
> - **Path F** — The initial deployment is working. I want the complete repeatable staging deploy workflow, including routine code-only deploys and destructive schema/dev deploys that rebuild and replace the host DB from scratch.
> - **Path G** — The deploy workflow is established. I need the remaining AWS hardening roadmap before the durable operational guidance moves into `docs/DEVOPS_GUIDE.md`.

---

## Table of Contents

- [1. Path A — Local quickstart for a new contributor](#1-path-a--local-quickstart-for-a-new-contributor)
  - [1.1 Goal of this path](#11-goal-of-this-path)
  - [1.2 Supported machine setup](#12-supported-machine-setup)
  - [1.3 Required tools](#13-required-tools)
  - [1.4 First-time machine install steps](#14-first-time-machine-install-steps)
  - [1.5 Clone and install](#15-clone-and-install)
  - [1.6 Local env file](#16-local-env-file)
  - [1.7 Reset the local database](#17-reset-the-local-database)
  - [1.8 Run the test suite](#18-run-the-test-suite)
  - [1.9 Run the dev server](#19-run-the-dev-server)
  - [1.10 Browser verification](#110-browser-verification)
  - [1.11 Optional deterministic checks](#111-optional-deterministic-checks)
  - [1.12 Docker parity check](#112-docker-parity-check)
- [2. Path B — Orientation: what this project is and how to think about it](#2-path-b--orientation-what-this-project-is-and-how-to-think-about-it)
  - [2.1 Project purpose and philosophy](#21-project-purpose-and-philosophy)
  - [2.2 Document relationships](#22-document-relationships)
  - [2.3 Current scope](#23-current-scope)
  - [2.4 Route contract and UI contract](#24-route-contract-and-ui-contract)
  - [2.5 Architecture mental model](#25-architecture-mental-model)
  - [2.6 Repo map](#26-repo-map)
- [3. Path C — Historical bootstrap: how this slice was originally assembled](#3-path-c--historical-bootstrap-how-this-slice-was-originally-assembled)
  - [3.1 Why this section exists](#31-why-this-section-exists)
  - [3.2 Original blank-slate assumptions](#32-original-blank-slate-assumptions)
  - [3.3 Original implementation order](#33-original-implementation-order)
- [4. Path D — AWS staging deployment runbook](#4-path-d--aws-staging-deployment-runbook)
  - [4.1 Purpose](#41-purpose)
  - [4.2 Preconditions](#42-preconditions)
  - [4.3 Read this before first apply](#43-read-this-before-first-apply)
  - [4.4 Lightsail SSH security, set your operator CIDRs](#44-lightsail-ssh-security)
  - [4.5 AWS account/bootstrap setup](#45-aws-accountbootstrap-setup)
  - [4.6 Terraform staging apply](#46-terraform-staging-apply)
  - [4.7 Host bootstrap](#47-host-bootstrap)
  - [4.8 Deploy and start application](#48-deploy-and-start-application)
  - [4.9 Verification](#49-verification)
  - [4.10 Known temporary assumptions](#410-known-temporary-assumptions)
- [5. Path E — From first success to the repeatable staging baseline](#5-path-e--from-first-success-to-the-repeatable-staging-baseline)
  - [5.1 Why this section exists](#51-why-this-section-exists)
  - [5.2 What is complete now](#52-what-is-complete-now)
  - [5.3 What remains intentionally temporary](#53-what-remains-intentionally-temporary)
  - [5.4 Where the remaining work moved](#54-where-the-remaining-work-moved)
- [6. Path F — Repeatable staging deploy workflow](#6-path-f--repeatable-staging-deploy-workflow)
  - [6.1 Who this path is for](#61-who-this-path-is-for)
  - [6.1A Claude Code Plan Mode for iteration](#61a-claude-code-plan-mode-for-iteration)
  - [6.2 Fix the SSH config alias](#62-fix-the-ssh-config-alias)
  - [6.3 Deploy scripts and what they do](#63-deploy-scripts-and-what-they-do)
  - [6.4 Routine deploy workflow](#64-routine-deploy-workflow)
  - [6.5 If something goes wrong on staging](#65-if-something-goes-wrong-on-staging)
  - [6.6 Future: ECR registry and automated image builds](#66-future-ecr-registry-and-automated-image-builds)
- [7. Path G — Remaining AWS hardening after the deploy workflow is established](#7-path-g--remaining-aws-hardening-after-the-deploy-workflow-is-established)
  - [7.1 Why this section exists](#71-why-this-section-exists)
  - [7.2 Public edge and delivery hardening](#72-public-edge-and-delivery-hardening)
  - [7.3 GitHub and operator governance hardening](#73-github-and-operator-governance-hardening)
  - [7.4 Reliability and recovery](#74-reliability-and-recovery)
  - [7.5 Runtime configuration maturity](#75-runtime-configuration-maturity)
  - [7.6 Monitoring maturity](#76-monitoring-maturity)
  - [7.7 Delivery maturity beyond on-host builds](#77-delivery-maturity-beyond-on-host-builds)
- [8. Path H — Runtime AWS identity and transactional email activation](#8-path-h--runtime-aws-identity-and-transactional-email-activation)
  - [8.1 Why this path exists](#81-why-this-path-exists)
  - [8.2 Scope](#82-scope)
  - [8.3 Preconditions](#83-preconditions)
  - [8.4 Naming convention](#84-naming-convention)
  - [8.5 Supersedes an earlier assumption](#85-supersedes-an-earlier-assumption)
  - [8.6 Step 1 — Create the KMS asymmetric signing key](#86-step-1--create-the-kms-asymmetric-signing-key)
  - [8.7 Step 2 — Create the app-runtime IAM user](#87-step-2--create-the-app-runtime-iam-user)
  - [8.8 Step 3 — Verify the SES sandbox sender and test recipient](#88-step-3--verify-the-ses-sandbox-sender-and-test-recipient)
  - [8.9 Step 4 — Attach the least-privilege policy to the IAM user](#89-step-4--attach-the-least-privilege-policy-to-the-iam-user)
  - [8.10 Step 5 — Update /srv/footbag/env on the staging host](#810-step-5--update-srvfootbagenv-on-the-staging-host)
  - [8.11 Step 6 — Post-setup validation](#811-step-6--post-setup-validation)
  - [8.12 Where rotation lives](#812-where-rotation-lives)
  - [8.13 Where the remaining AWS work lives](#813-where-the-remaining-aws-work-lives)
- [9. Path I — Production activation](#9-path-i--production-activation)
  - [9.1 Why this path exists](#91-why-this-path-exists)
  - [9.2 Scope](#92-scope)
  - [9.3 Preconditions](#93-preconditions)
  - [9.4 Domain acquisition and DNS delegation](#94-domain-acquisition-and-dns-delegation)
  - [9.5 Cloudflare Email Routing for noreply@footbag.org](#95-cloudflare-email-routing-for-noreplyfootbagorg)
  - [9.6 SES production-access activation](#96-ses-production-access-activation)
  - [9.7 SES domain identity with DKIM](#97-ses-domain-identity-with-dkim)
  - [9.8 Production KMS key, source-profile, and runtime role](#98-production-kms-key-source-profile-and-runtime-role)
  - [9.9 Production SES sender identity and IAM pin](#99-production-ses-sender-identity-and-iam-pin)
  - [9.10 SES bounce/complaint webhook subscription](#910-ses-bouncecomplaint-webhook-subscription)
  - [9.11 Host credential wiring on the production Lightsail instance](#911-host-credential-wiring-on-the-production-lightsail-instance)
  - [9.12 Post-setup validation](#912-post-setup-validation)
- [10. Appendices](#10-appendices)
  - [10.1 Troubleshooting reference](#101-troubleshooting-reference)
  - [10.2 Deterministic seed-data reference](#102-deterministic-seed-data-reference)
  - [10.3 Smoke-check contract](#103-smoke-check-contract)
  - [10.4 Authoritative project facts preserved by this guide](#104-authoritative-project-facts-preserved-by-this-guide)
  - [10.5 Official references](#105-official-references)

---

## 1. Path A — Local quickstart for a new contributor

### 1.1 Goal of this path

Success for this path means you can:

- install the prerequisites
- clone the GitHub repo
- install dependencies
- create `.env` - local environment variables file
- reset the local DB
- run tests
- launch the dev server
- verify `/events`, `/events/year/2025`, `/events/event_2025_beaver_open`, `/health/live`, and `/health/ready` in a browser
- optionally run the Docker parity stack and local smoke script

### 1.2 Supported machine setup

This guide is written **WSL-first** for the newcomer path (Windows Subsystem for Linux).

For Windows contributors, use this working model:

1. If WSL is not already installed, open **PowerShell as Administrator** and run:
  ```powershell
   wsl --install
  ```
2. Restart Windows when prompted.
3. Open **Ubuntu** from the Start menu and complete the first-time Linux username/password setup.
4. From that point on, do the rest of this guide from the **Ubuntu shell**, not from `cmd.exe` or PowerShell.
5. Keep the repo **inside the Linux filesystem** (for example `~/GIT/footbag-platform`), not under `/mnt/c/...`.
6. Use your normal Windows browser to open forwarded `localhost` ports, and the Cursor IDE.

Recommended Windows + WSL working model:

- install Cursor on Windows (for working with code).
- enable the WSL 2 backend and WSL integration for your Ubuntu distro (essential).
- run Node, npm, sqlite3, Git, AWS CLI, Terraform, SSH, and Claude Code from the WSL Ubuntu shell.

macOS/Linux contributors can adapt the same command flow in their normal terminal, but the primary onboarding path in this guide assumes Windows + WSL Ubuntu.

### 1.3 Required tools

For the **minimum newcomer local path**, install these first:

- `git`
- Node.js via `nvm`
- `npm`
- `build-essential`
- `sqlite3`
- `curl`
- `unzip`
- `ca-certificates`
- `openssh-client`
- `rsync`

If you know you will continue into **Path D** or **Path E**, also install or verify these:

- Docker Desktop with WSL integration
- `docker compose` support
- AWS CLI v2
- Terraform CLI
- Claude Code
- Cursor on Windows

**Use Node 22 as the project baseline.**

Notes:

- this repo's Dockerfiles use `FROM node:22-alpine` in both the web and worker images, so Node 22 is the documented baseline to keep local and container behavior aligned
- `package.json` declares `"engines": {"node": ">=18.0.0"}` but Node 22 is what this guide teaches
- Node 24 became Active LTS in October 2025 and can work since `better-sqlite3` is already at `^12.6.2`, but it is not the documented baseline for this guide
- this project uses `better-sqlite3`, which compiles a native addon during install
- there is no Python-style virtual environment here; `node_modules/` is the per-clone dependency boundary
- if you ever switch Node versions, run `npm rebuild`; `better-sqlite3` must be recompiled for the active Node version
- `npm` is the intended package-manager baseline because it keeps blank-machine setup small and boring

### 1.4 First-time machine install steps

#### 1. If WSL is not installed yet

From **PowerShell as Administrator**:

```powershell
wsl --install
```

Restart Windows if prompted, then open **Ubuntu** from the Start menu and complete first-time Linux setup.

To confirm your distro is running WSL 2, from PowerShell run:

```powershell
wsl.exe -l -v
```

#### 2. Update Ubuntu and install baseline packages

In the Ubuntu Linux terminal shell (Run all the following commands one at a time):

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  sqlite3 \
  git \
  unzip \
  zip \
  jq \
  ca-certificates \
  curl \
  openssh-client \
  rsync \
  gpg
```

Verify the basics:

```bash
sqlite3 --version
git --version
ssh -V
rsync --version
```

#### 3. Install `nvm` and Node 22

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

**Close and reopen your terminal** (or run `source ~/.bashrc`) so that `nvm` is available. Then:

```bash
nvm install 22
nvm use 22
nvm alias default 22

node -v
npm -v
which node
```

`which node` should resolve to a path under `/home/...` or `/usr/...`, not `/mnt/c/...`.

#### 4. Configure Git (optional for now, you can clone the repo without doing this)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

#### 5. Verify Docker from WSL if you will use Docker parity or any AWS path (you can skip this just to run a local server)

Install Docker Desktop on Windows, enable the **WSL 2 based engine**, and enable WSL integration for your Ubuntu distro.

Then verify from the Ubuntu shell:

```bash
docker --version
docker compose version
```

#### 6. Install AWS CLI v2 in WSL if you will use Path D or Path E (AWS setup steps) 

On most x86_64 Windows + WSL setups:

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -u awscliv2.zip
sudo ./aws/install
aws --version
```

If `uname -m` reports `aarch64`, use the ARM64 AWS CLI package instead.

#### 7. Install Terraform in WSL if you will use Path D or Path E (AWS setup steps) 

```bash
curl -fsSL https://apt.releases.hashicorp.com/gpg | \
  gpg --dearmor | \
  sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null

echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(. /etc/os-release && echo "$VERSION_CODENAME") main" | \
  sudo tee /etc/apt/sources.list.d/hashicorp.list

sudo apt update
sudo apt install -y terraform
terraform version
```

Verify the version is >= 1.11 (required by this project's `providers.tf`).

#### 8. Install Claude Code in WSL (before you get into development work)

Note that for this you will need a Pro plan from Anthropic, purchased through the web page.
To get Claude Code to do any real work, you must complete the /login steps and authenticate.
Ask your Claude AI about this in the chats to get precise steps.

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

The Cursor IDE runs in Windows, and connects to Linux.
Claude Code runs inside WSL Linux.

#### 9. Line-ending sanity check (Windows versus Linux incompatability)

This repo includes `.gitattributes` rules so shell scripts stay LF-terminated in normal use.

If you ever see `bash: ...^M` errors:

- make sure the repo was cloned from **inside WSL**
- make sure the repo is not under `/mnt/c/...`
- prefer re-cloning in WSL over trying to repair a broken checkout by hand

### 1.5 Clone and Install the Project GitHub Repository

Clone via HTTPS — no SSH key required (again, run commands one at a time):

```bash
mkdir -p ~/GIT
cd ~/GIT
git clone https://github.com/davidleberknight/footbag-platform.git
cd footbag-platform
```

```bash
npm install
```

If `npm install` fails while compiling `better-sqlite3`:

- confirm you are on Node 22
- confirm `build-essential` is installed
- confirm `which node` points to the WSL/Linux binary
- then rerun `npm install`

### 1.6 Local env file

Create the local environment file from the example:

```bash
cp .env.example .env
```

The minimum local `.env` shape is:

```
COMPOSE_FILE=docker/docker-compose.yml
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
FOOTBAG_DB_PATH=./database/footbag.db
PUBLIC_BASE_URL=http://localhost:3000
```

For local development, keep `.env` intentionally small.

Use local `.env` for:

- local-only development values
- non-secret defaults
- temporary local secrets needed only for development

Do not commit `.env` (make sure it is in your .gitignore)

### 1.7 Reset the local database

> **Minimal first-boot check (optional).** To confirm that `npm install` and `.env` are healthy before running the full seed pipeline, apply the schema only:
>
> ```bash
> rm -f ./database/footbag.db ./database/footbag.db-wal ./database/footbag.db-shm
> sqlite3 ./database/footbag.db < ./database/schema.sql
> ```
>
> With only the schema applied, `npm run dev` (§1.9) boots and the following render: `http://localhost:3000/`, `http://localhost:3000/health/live`, `http://localhost:3000/health/ready`. Every other public route needs the full seed below. Run the full reset before browser verification in §1.10.

Bootstrap the local database from schema plus seed data:

```bash
bash scripts/reset-local-db.sh
```

This step requires the `sqlite3` CLI.

Expected result:

- the script completes without error
- the local DB file is rebuilt
- the app has deterministic baseline data for local testing and optional smoke checks

### 1.8 Run the test suite

```bash
npm test
```

This is the first proof that your local environment is healthy.

Tests should pass before you spend time debugging browser behavior.

### 1.9 Run the dev server

```bash
npm run dev
```

Leave that terminal running.

On WSL2, the port is forwarded automatically, so you can use your normal browser on Windows.

### 1.10 Browser verification

This is the primary local success path.

Open these in a browser:

| URL                                                                                                        | Expected outcome                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [http://localhost:3000/events](http://localhost:3000/events)                                               | events landing page renders                      |
| [http://localhost:3000/events/year/2025](http://localhost:3000/events/year/2025)                           | 2025 archive renders                             |
| [http://localhost:3000/events/event_2025_beaver_open](http://localhost:3000/events/event_2025_beaver_open) | canonical event detail page renders with results |
| [http://localhost:3000/health/live](http://localhost:3000/health/live)                                     | `{"ok":true,"check":"live"}`                     |
| [http://localhost:3000/health/ready](http://localhost:3000/health/ready)                                   | `{"ok":true,"check":"ready"}`                    |

What matters here:

- the Events landing page renders cleanly
- the year archive page renders cleanly
- the canonical event detail/results page renders cleanly
- the health endpoints return clean liveness/readiness responses
- you can click around the public slice locally without stack traces or route confusion

### 1.11 Optional deterministic checks

The primary local proof already includes `/events/event_2025_beaver_open`, because that is the canonical event detail/results page. It is not optional.

The routes below are **optional additional deterministic checks**:

- `/events/event_2026_draft_event` — should not be public; expected 404
- `/events/event_9999_does_not_exist` — expected 404
- `/events/year/1899` — empty year page should still render cleanly (confirmed in `smoke-local.sh`)

Use these when:

- troubleshooting
- verifying the deterministic seed contract
- comparing behavior to the smoke scripts
- debugging route and visibility edge cases

### 1.12 Docker parity check

Docker is part of the required workflow because the deployed origin is containerized.

Do this before anyone touches AWS.

> **Note on `COMPOSE_FILE`:** The `.env` file sets `COMPOSE_FILE=docker/docker-compose.yml`. This only applies when running bare `docker compose` without `-f` flags. The parity commands below use explicit `-f` flags that override `COMPOSE_FILE`. Always use the explicit `-f` form shown here.

> **Note on `--env-file`:** The parity commands require `--env-file .env` so that Docker Compose can substitute `SESSION_SECRET` (and any future secrets) from your local `.env` into the container. Without it, Compose resolves variable substitution from `docker/` (the compose file's directory), finds no `.env` there, and the app crashes at startup. This mirrors how the production deploy passes `--env-file /srv/footbag/env`.

> **Note on TypeScript compilation:** The `docker/web/Dockerfile` is a multi-stage build that runs `npm run build` inside the builder stage. You do not need to run `npm run build` before `docker compose build` — the Dockerfile handles compilation internally.

Run the base parity stack locally in a separate terminal (or detached):
```bash
docker compose \
  --env-file .env \
  -f docker/docker-compose.yml \
  up --build --detach
```

Then run the smoke checks:

Then run the smoke checks against the containerized local app:

```bash
chmod +x scripts/smoke-local.sh
BASE_URL=http://localhost ./scripts/smoke-local.sh
```

What you are proving here:

- nginx fronts the web container correctly
- the runtime container shape behaves like deployment shape
- the DB mount path is correct
- web and nginx stay healthy under Compose

Bring the stack down when done:

```bash
docker compose \
  --env-file .env \
  -f docker/docker-compose.yml \
  down
```

## 2. Path B — Orientation: what this project is and how to think about it

### 2.1 Project purpose and philosophy

The Footbag Website Modernization Project is a volunteer-maintained community platform intended to become the modern public hub for footbag.

Read the PROJECT_SUMMARY doc first.

### 2.2 Document relationships

Treat this guide as one document in a wider authority-doc set.

Read these first when working on code:

- `PROJECT_SUMMARY.md`
- `USER_STORIES.md`
- `VIEW_CATALOG.md`
- `SERVICE_CATALOG.md`
- `DESIGN_DECISIONS.md`
- `DATA_MODEL.md`

How they relate:

- user stories define what the website must do
- view catalog defines what pages must exist and what they must communicate
- service catalog defines service responsibilities and contracts
- design decisions define what architectural shortcuts are intentional and what is forbidden
- The data mode / schema sql is the executable truth for the current data baseline

### 2.3 Current scope

This guide is about the first public, useful slice of the platform.

Routes in scope:

- `GET /events`
- `GET /events/year/:year`
- `GET /events/:eventKey`
- `GET /health/live`
- `GET /health/ready`

What the slice accomplishes:

A visitor can:

- browse upcoming public events
- browse completed public events by year
- open one canonical public event page
- read public results where result rows exist
- still see historical events even when result rows do not exist yet

What the slice proves:

- the stack works
- public routing works
- page shaping belongs in the service layer
- SQLite read paths work
- Docker parity is real
- the first AWS deployment path is tractable

### 2.4 Route contract and UI contract

#### Event identity

Public event identity uses:

`eventKey` shape: `event_{year}_{event_slug}`

The stored standardized tag includes the leading `#`, but the public route key does not.

Example:

- stored tag: `#event_2025_beaver_open`
- route key: `event_2025_beaver_open`

#### Year archive behavior

`GET /events/year/:year`:

- shows the full selected year
- is not paginated
- includes completed public events for that year
- shows inline grouped results when rows exist
- still shows the event when rows do not exist
- explicitly says when results are not yet available

#### Canonical event page behavior

`GET /events/:eventKey`:

- is the one canonical public event page
- uses one route and one template
- can emphasize details or results through page-model fields
- still renders for historical events with no result rows
- returns 404 for invalid keys, unknown keys, and non-public events

#### Health behavior

- `/health/live` is a cheap process liveness check
- `/health/ready` is a minimal SQLite-readiness check for this stage

### 2.5 Architecture mental model

This is a server-rendered TypeScript application built with:

- Node.js
- Express
- Handlebars
- SQLite
- Docker
- Terraform
- Lightsail
- CloudFront

Think about the code in four layers:

Views
- Handlebars templates
- logic-light

Controllers
- parse request inputs
- call services
- choose status codes
- render templates or return JSON

Services
- own business rules
- validate route keys and year inputs
- shape page-oriented data
- decide visibility rules
- translate temporary DB contention into safe service failures

DB / infrastructure layer
- one SQLite module
- prepared statements prepared once at startup
- transaction helper
- no ORM
- no repository layer

### 2.6 Repo map

The repository shape remains the right mental map:

.
├─ src/
│  ├─ config/
│  │  ├─ env.ts
│  │  └─ logger.ts
│  ├─ controllers/
│  │  ├─ eventController.ts
│  │  └─ healthController.ts
│  ├─ db/
│  │  ├─ db.ts
│  │  └─ openDatabase.ts
│  ├─ routes/
│  │  ├─ publicRoutes.ts
│  │  └─ healthRoutes.ts
│  ├─ services/
│  │  ├─ eventService.ts
│  │  ├─ operationsPlatformService.ts
│  │  ├─ serviceErrors.ts
│  │  └─ sqliteRetry.ts
│  ├─ views/
│  │  ├─ layouts/
│  │  │  └─ main.hbs
│  │  ├─ events/
│  │  │  ├─ index.hbs
│  │  │  ├─ year.hbs
│  │  │  └─ detail.hbs
│  │  ├─ partials/
│  │  │  └─ result-section.hbs
│  │  └─ errors/
│  │     ├─ not-found.hbs
│  │     └─ unavailable.hbs
│  ├─ public/
│  │  └─ css/
│  │     └─ style.css
│  ├─ app.ts
│  └─ server.ts
├─ database/
│  └─ schema.sql
├─ tests/
│  └─ integration/
│     └─ app.routes.test.ts
├─ scripts/
│  ├─ reset-local-db.sh
│  └─ smoke-local.sh
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
│  └─ DEV_ONBOARDING.md
├─ .env.example
├─ .gitignore
├─ package.json
└─ tsconfig.json

Important file-level responsibilities:


| File or path                        | Responsibility                                           |
| ----------------------------------- | -------------------------------------------------------- |
| src/app.ts                          | Express app construction, middleware, route registration |
| src/server.ts                       | process startup and shutdown                             |
| src/config/env.ts                   | environment loading and validation                       |
| src/config/logger.ts                | structured logging                                       |
| src/db/db.ts                        | Database queries & SQLite connections / transaction      |
| src/db/openDatabase.ts              | SQLite connection bootstrap and PRAGMAs                  |
| src/services/eventService.ts        | Event and Results business rules and page shaping        |
| src/controllers/eventController.ts | route-to-service render bridge                           |
| src/controllers/healthController.ts | liveness/readiness handlers                              |
| src/routes/publicRoutes.ts          | public route wiring                                      |
| src/views/events/*.hbs              | server-rendered public Handlebars templates              |
| database/schema.sql                  | Schema definition                                        |
| scripts/reset-local-db.sh           | local DB rebuild                                         |
| scripts/smoke-local.sh              | local/container/origin smoke checks                      |
| docker/docker-compose.yml           | base runtime stack                                       |
| docker/docker-compose.prod.yml      | deployment overrides                                     |
| ops/systemd/footbag.service         | production Compose wrapper                               |
| terraform/                          | environment infrastructure definitions                   |

## 3. Path C — Historical bootstrap: how this slice was originally assembled

### 3.1 Why this section exists

This section is historical and architectural context.

It explains:

- how the initial functionality slice was originally built
- what order the parts were intended to come together 
- why particular files exist
- how to reason about repo archaeology

It is not the first thing a new contributor should follow today.

### 3.2 Original blank-slate assumptions

The original onboarding guide assumed a technically capable engineer joining the project with:

- a blank Windows machine
- WSL running Ubuntu
- a blank or newly prepared GitHub repository
- a blank AWS account or an account not yet prepared for this project

That framing made sense for the original build-out. It no longer describes the main present-day onboarding entry point, which is why it lives here.

### 3.3 Original implementation order

The original build order was deliberate. In cleaned-up form, it was:

#### Repository skeleton and initial files

- package metadata
- TypeScript config
- .gitignore
- .env.example
- conventional directory layout

#### Package and TypeScript tooling

- Express
- Handlebars
- better-sqlite3
- dotenv
- TypeScript
- tsx
- Vitest
- Supertest

#### Baseline config

- env loading/validation
- logger
- simple script set: dev, build, start, test

#### SQLite bootstrap path

- one DB module
- PRAGMAs
- statement catalog
- transaction helper
- no migration framework prerequisite yet

#### Deterministic seed data

- upcoming public event
- completed public event with results
- completed public event without results
- non-public event that must not leak

#### Host-run local app first

- `src/app.ts`
- `src/server.ts`
- prove the app outside Docker before adding deployment complexity

#### Public read routes

- `GET /events`
- `GET /events/year/:year`
- `GET /events/:eventKey`

#### Handlebars views

- list page
- year page
- canonical event detail page
- no-results handling
- error pages

#### Health endpoints

- `/health/live`
- `/health/ready`

#### Tests and smoke scripts

- integration tests
- local smoke script
- a smoke-public script has not yet been created for this slice

#### Docker parity artifacts

- web image
- worker image
- nginx
- Compose stack
- production overrides

#### Terraform and ops artifacts

- terraform/shared
- terraform/staging
- terraform/production
- ops/systemd/footbag.service

The original guide strongly emphasized the order: do not build giant infrastructure before the app runs locally and in Docker.

#### Historical implementation batches

The original batch plan is still useful as a mental model:

- Batch 1: repository skeleton and toolchain
- Batch 2: app bootstrap
- Batch 3: database bootstrap and seed path
- Batch 4: EventService public read models
- Batch 5: controllers, routes, and templates
- Batch 6: integration tests and smoke scripts
- Batch 7: Docker parity artifacts
- Batch 8: Terraform and ops artifacts

Good historical checkpoints were:

- `npm install` succeeds
- `npm run build` works, even if source is still minimal
- app starts cleanly
- DB resets cleanly
- readiness query works
- route smoke checks pass
- Docker parity works
- Terraform fmt and validate pass

## 4. Path D — AWS staging deployment runbook

### 4.1 Purpose

This path takes a developer who already has the app working locally and gets the current slice deployed to staging safely.

It is deliberately operational, ordered, and explicit.

### 4.2 Preconditions

First, make sure you followed ALL of the steps described in section 1.4: First-time machine install steps.

Do not begin AWS work until every item below is green in the same WSL environment you plan to use for deployment work.

#### Local application gate

These must already work:

```bash
npm test
bash scripts/reset-local-db.sh
npm run dev
```

And you must already have verified in a browser:

- `/events`
- `/events/year/2025`
- `/events/event_2025_beaver_open`
- `/health/live`
- `/health/ready`

If local host-run is not green, AWS will only hide application problems behind more moving parts.

#### Docker gate

The deployed origin is containerized. Prove that shape locally first.

These must already work:

```bash
docker --version
docker compose version
docker compose -f docker/docker-compose.yml up --build
BASE_URL=http://localhost ./scripts/smoke-local.sh
docker compose -f docker/docker-compose.yml down
```

#### Operator tooling gate

These must already work before you start Terraform or SSH bootstrap:

```bash
aws --version
terraform version
ssh -V
rsync --version
```

If any of those commands fail, stop and install the missing tool first (see section 1.4).

#### Credential/profile gate

Before running Terraform or AWS CLI commands, confirm the operator profile works:

```bash
export AWS_PROFILE=footbag-operator
aws sts get-caller-identity
```

If profile setup is not working yet (footbag-operator not found), complete section 4.5 first.

### 4.3 Read this before first apply

This is a first-deploy path, not a mature production platform.

Some defaults are intentionally temporary.

Do not blindly run terraform apply until the pre-apply corrections below are complete.

The fragile parts are:

- first-apply inputs must be honest
- unsupported CloudFront origin assumptions must be removed
- monitoring must be gated to signals that actually exist
- manual host bootstrap is still required (accepted temporary deviation)
- CloudFront maintenance-page behavior is not truly functional yet
- Lightsail static IPs and instances share a single namespace — they cannot
  have the same name simultaneously; `lightsail.tf` uses
  `footbag-staging-web-ip` for the static IP and `footbag-staging-web` for
  the instance; do not make these the same or instance creation will fail
  with "Some names are already in use"

### 4.4 Lightsail SSH security, set your operator CIDRs

`lightsail.tf` restricts port 22 to `var.operator_cidrs`. You must supply real values in `terraform.tfvars` before first apply, never leave this as a placeholder.

Find your current public IP from WSL:

```bash
curl -s https://checkip.amazonaws.com
```

Set the value in `terraform.tfvars` — one `/32` entry per authorized operator:

```hcl
# Single operator
operator_cidrs = ["203.0.113.10/32"]

# Multiple operators
operator_cidrs = [
  "203.0.113.10/32",   # Alice — home
  "198.51.100.42/32",  # Bob — office
]
```

Notes on `operator_cidrs`:

- `/32` means exactly that one IP address. Do not use broader ranges like `/24` unless you control a stable office block.
- Operators on a dynamic home IP must update their entry and re-run `terraform apply` when their IP changes.
- To add or remove an operator: update the list and run `terraform apply` — Terraform replaces only the firewall rule.
- For temporary access from a different location (travel, etc.): add a second entry for that session, apply, then remove it and re-apply when done.

> [!NOTE]
> Some ISPs block outbound port 22 to AWS EC2 IP ranges. If SSH on port 22 times out
> despite the firewall rule being correct, use the Lightsail browser SSH console to
> configure sshd to also listen on port 2222, then use `-p 2222` for all SSH commands.
> `lightsail.tf` opens port 2222 to `operator_cidrs` for this reason.

> [!IMPORTANT]
> The Lightsail firewall is Terraform-managed. Do not change firewall rules in the Lightsail console — console changes are silently overwritten on the next `terraform apply`. To modify SSH access at any point, update `operator_cidrs` in `terraform.tfvars` and run `terraform apply`.

`**terraform.tfvars` must never be committed to git.** The root `.gitignore` already excludes `*.tfvars` while keeping `*.tfvars.example` tracked. Verify this protection is in place before your first apply:

```bash
git check-ignore -v terraform/staging/terraform.tfvars
```

Expected output: `.gitignore:97:*.tfvars  terraform/staging/terraform.tfvars`. If that command produces no output, the file is not ignored — stop and fix `.gitignore` before proceeding.

#### 3. CloudFront origin — use DNS, not raw IP, and use the two-pass apply

CloudFront custom origins require a publicly resolvable DNS hostname, not a raw IP address. `cloudfront.tf` uses `var.lightsail_origin_dns` for the origin domain. This creates a chicken-and-egg problem on first deploy because the instance must exist before you can retrieve its DNS name.

The two-pass apply pattern:

- pass 1: set `enable_cloudfront = false` in `terraform.tfvars`, apply — creates Lightsail resources only
- construct the CloudFront origin hostname from the static IP Terraform output
  using nip.io for staging (see section 4.6 step 4) — Lightsail does not
  provide public DNS hostnames; `publicDnsName` always returns `None`
- set `lightsail_origin_dns` to that value and `enable_cloudfront = true` in `terraform.tfvars`
- pass 2: apply the full stack including CloudFront

If you skip the two-pass approach and set `enable_cloudfront = true` before the DNS name exists, you will get an unsupported edge-to-origin configuration that may appear to apply successfully but will not work.

#### 4. Bootstrap shared Terraform state and fill real backend values

Change: apply `terraform/shared`, create the remote state bucket, and replace the TODO bucket values in `terraform/staging/backend.tf`.

Why it matters: `terraform/staging` cannot initialize cleanly until the bucket exists and the backend references are real.

If skipped: `terraform init` fails before you even reach plan/apply.

Done looks like:

- `terraform/shared` has been applied successfully
- the state bucket exists with versioning and encryption
- `staging/backend.tf` contains the real bucket name and region
- shared local state has been backed up outside the repo

#### 5. Monitoring gates

Keep `enable_cwagent_alarms = false` and `enable_backup_alarm = false` in `terraform.tfvars` for the first deployment. The `cloudfront_5xx` alarm is gated on `enable_cloudfront` and is created in pass 2 alongside the distribution — it does not exist after pass 1. The CWAgent and backup-age alarms are separately gated because the signals they monitor do not exist yet.

Alarms for signals that do not exist are worse than no alarms — they train the team to ignore monitoring. The backup-age alarm uses `treat_missing_data = "breaching"` and will enter ALARM immediately if enabled before the backup job exists and emits metrics.

#### 6. Confirm current Terraform operational assumptions

Before first apply, also verify these notes still hold in your staging setup:

- use explicit environment directories: `terraform/shared`, `terraform/staging`, `terraform/production`
- S3 backend with `use_lockfile = true` requires Terraform >= 1.11 — verify with `terraform version`
- the AWS provider is pinned to `~> 5.0` in `providers.tf`; AWS provider v6.0 was released June 2025 with breaking changes — do not change this pin unless you have explicitly reviewed the v6 migration guide
- `**.tflock` IAM requirement:** when `use_lockfile = true` is active, Terraform writes a `.tflock` object alongside the state file; the operator IAM policy must include `s3:PutObject` and `s3:DeleteObject` on `<bucket>/<key-prefix>*.tflock` or `terraform apply` will fail with `AccessDenied` at lock acquisition

### 4.5 AWS account/bootstrap setup

#### Root account hardening

1. Sign in as the AWS account root user once.
2. Enable MFA on the root account.
3. Do **not** create access keys for the root user.
4. Record root-account recovery ownership and MFA custody according to your team's security practice.
5. Stop using root after this bootstrap step and continue with a named operator identity.

#### Create the first named operator identity

> [!NOTE]
> If IAM Identity Center is already configured for this AWS account, prefer `aws configure sso --profile footbag-operator` over creating long-lived access keys. See the AWS references in section 6.3. Use the steps below only if IAM Identity Center is not yet available.

Use the **AWS Console** to create `footbag-operator` — you have no working CLI credentials yet.

1. Sign in to the AWS Console as root.
2. Go to **IAM → Users → Create user**.
3. Create the user: `footbag-operator`.
4. Enable MFA for that user.
5. Attach `AdministratorAccess` for the bootstrap phase.
6. Create CLI access keys: IAM → Users → footbag-operator → Security credentials → Create access key → choose "CLI" use case.
7. Save the access key ID and secret access key immediately — AWS only shows the secret once.

Configure the local AWS CLI profile:

```bash
aws configure --profile footbag-operator
# Enter: AccessKeyId, SecretAccessKey, region (e.g. us-east-1), output format (json)

export AWS_PROFILE=footbag-operator
aws sts get-caller-identity
```

> [!WARNING]
> This is an intentional bootstrap shortcut, not the desired durable state.
>
> - Scope down `AdministratorAccess` after first successful apply (see Path E, section 5.2).
> - Remove long-lived access keys after first deployment (see Path E, section 5.2).

> [!NOTE]
> `export AWS_PROFILE=footbag-operator` applies only to the current shell session. If you open a new terminal for any later phase, re-run the export before any Terraform or AWS CLI commands. This is a common source of mid-bootstrap failures.

#### Domain and DNS for first deployment

For this runbook, a custom domain is deferred.

The minimum successful deployment uses the default CloudFront `*.cloudfront.net` URL. ACM and Route 53 come later.

#### Bootstrap remote Terraform state

Bootstrap the remote-state bucket before initializing `terraform/staging`. This directory intentionally uses local state because it is the thing that creates the remote backend.

From the repo root:

```bash
cd terraform/shared

cat > terraform.tfvars <<EOF
aws_account_id      = "123456789012"
state_bucket_suffix = "a1b2c3d4e5"
EOF

terraform init
terraform validate
terraform apply
```

After the shared apply:

- terraform output -raw terraform_state_bucket_name
- record the real state-bucket name from the Terraform output (format: `footbag-terraform-state-<suffix>`)
- paste that bucket name into `terraform/staging/backend.tf`, replacing the `TODO-set-unique-suffix` placeholder
- back up `terraform/shared/terraform.tfstate` immediately: cp terraform.tfstate ~/footbag-shared-tfstate-backup.json

#### What becomes Terraform-managed after handoff

After bootstrap, Terraform should own:

- Lightsail resources
- static IP resources
- CloudFront resources
- project S3 buckets
- runtime IAM scaffolding
- firewall posture where represented in infra
- logging/alarm resources
- Parameter Store path scaffolding where practical

Human-owned responsibilities remain:

- root credential custody
- MFA device management
- initial secret-value entry
- Terraform execution/review
- SSH key custody
- deployment approvals
- final smoke verification

#### Parameter Store path structure

Parameter Store is optional in this minimum deployment, but if you use it as AWS-side reference storage, use a readable convention:

/footbag/staging/app/...
/footbag/staging/secrets/...
/footbag/production/app/...
/footbag/production/secrets/...

Examples currently provisioned by `terraform/staging/ssm.tf`:

/footbag/staging/app/port
/footbag/staging/app/log_level
/footbag/staging/app/public_base_url
/footbag/staging/app/db_path

Not yet provisioned (deferred hardening — see Path E, section 5.3):

/footbag/staging/app/node_env
/footbag/staging/secrets/origin_verify_secret

Remember: the running app reads /srv/footbag/env, not SSM.

#### Lightsail runtime identity model

Three identities, distinct scopes, per DD §3.5 and §7.2:

- **`footbag-operator`** is the env-agnostic human AWS/Terraform identity. Used from operator terminals for Terraform plans/applies and AWS CLI work. Do not mount this profile into containers.
- **`footbag-staging-source-profile`** is a staging-scoped IAM user with a single permission: `sts:AssumeRole` on the runtime role below. Its long-lived access keys live on the host at `/root/.aws/credentials` (root-owned, mode 0600), not in `/srv/footbag/env`. This is the "source profile" in DD §7.2. Rotation: at least every 90 days (CIS Benchmark); runbook in `docs/DEVOPS_GUIDE.md` §5.7.
- **`aws_iam_role.app_runtime`** (Terraform resource; IAM role name `footbag-staging-app-runtime`) is the staging-scoped IAM role the running app acts as. It holds the KMS Sign/GetPublicKey, SES SendEmail, SSM read, and S3 snapshot permissions. The app never handles this role's credentials directly. The AWS SDK default chain reads `AWS_PROFILE=footbag-staging-runtime` from `/srv/footbag/env`, looks up `role_arn` + `source_profile` in `/root/.aws/config`, calls `sts:AssumeRole`, and hands the process temporary credentials. This is the assumed runtime role and, per DD §7.2, is the authoritative runtime principal.

Earlier iterations of the public slice served pages from `process.env` plus SQLite only and did not require any runtime AWS API calls. That changed when KMS-backed JWT sessions and SES-backed transactional email were introduced; the assumed-role chain above is how those calls authenticate.

Lightsail has no EC2 instance profile, so credentials cannot be attached to the instance. The source-profile + assumed-role chain is the supported substitute: long-lived keys stay on the host (root-owned, minimum permission), and the temporary credentials the app actually uses are scoped to the runtime role and expire naturally. See Path H (§8) for one-time staging activation.

### 4.6 Terraform staging apply

> **Terraform version:** Terraform >= 1.11 is required. Verify before proceeding:
>
> ```bash
> terraform version
> ```

Use this sequence.

#### 1. Prepare shared state first

> **If `terraform/shared` has already been applied**, skip this step.
> Confirm the state bucket exists and `terraform/staging/backend.tf`
> contains the real bucket name, then proceed to step 2.

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

Record the state bucket output.

#### 2. Prepare staging values

In `terraform/staging/backend.tf`, replace the placeholder bucket and region values.

In `terraform/staging/terraform.tfvars`, fill at least:

First, print your SSH public key locally:

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy that full single-line public key into `ssh_public_key` below.

```hcl
aws_account_id         = "123456789012"
state_bucket_suffix    = "<same suffix as shared>"
ssh_public_key         = "<contents of ~/.ssh/id_ed25519.pub>"
alarm_email            = "you@example.com"
operator_cidrs         = ["<your-ip>/32"]  # see §4.4 correction 2 for multi-operator format
# domain_name and route53_zone_id remain empty for test deployment

# Two-pass CloudFront bootstrap — critical for first apply pass:
enable_cloudfront    = false
lightsail_origin_dns = ""

# Monitoring gates — leave false until signals exist:
enable_cwagent_alarms = false
enable_backup_alarm   = false
```

`terraform.tfvars` is excluded from git by `*.tfvars` in `.gitignore`. Never commit this file — it will contain real IP addresses.

#### 3. Initialize and validate

```bash
cd terraform/staging
terraform init
terraform validate
```

#### 3b. Recover orphaned resources (if static IP or key pair already exist in AWS)

If a previous partial apply created resources in AWS that are not in Terraform state, import them before running plan/apply. Skipping this step causes instance creation to fail with "Some names are already in use".

Check for orphaned resources:

```bash
aws lightsail get-static-ips --profile footbag-operator
aws lightsail get-key-pairs --profile footbag-operator
terraform state list | grep lightsail
```

If any Lightsail resources appear in the AWS output but not in `terraform state list`, import them:

```bash
terraform import aws_lightsail_static_ip.web footbag-staging-web-ip
terraform import aws_lightsail_key_pair.operator footbag-staging-operator
```

Then proceed to step 4.

#### 4. First apply pass for Lightsail, if needed

With `enable_cloudfront = false` set in `terraform.tfvars`, the first apply creates Lightsail resources only. After it completes, construct the CloudFront origin hostname from the static IP. Lightsail does not provide public DNS hostnames — unlike EC2, the `publicDnsName` API field always returns `None`. Instead, construct a resolvable hostname using nip.io:

```bash
STATIC_IP=$(terraform output -raw lightsail_static_ip)
echo "${STATIC_IP}.nip.io"
```

Set the output value as `lightsail_origin_dns` in `terraform.tfvars`:

```hcl
lightsail_origin_dns = "34.192.250.246"   # 34.192.250.246.nip.io maps to 34.192.250.246 for DNS (use temp IP lightsail is handing out)
enable_cloudfront    = true
```

For production, replace nip.io with a real DNS A record pointing to the static IP (e.g. `origin.staging.footbag.org`). Do not use nip.io in production.

Then proceed to step 5.

#### 5. Full plan and review

```bash
terraform plan -out=tfplan
```

Review the plan carefully. Confirm:

- Lightsail and static IP are being created
- port 22 uses `operator_cidrs`, not `0.0.0.0/0`
- CloudFront is using DNS, not raw IP
- gated alarms are not being created
- the CloudFront 5xx alarm is being created
- no fake `user_data` bootstrap exists

#### 6. Apply

```bash
terraform apply tfplan
```

#### 7. Record outputs immediately

Capture and keep these in operator notes:

```bash
terraform output lightsail_static_ip
terraform output lightsail_instance_name
terraform output cloudfront_domain
terraform output cloudfront_distribution_id
terraform output snapshots_bucket_name
terraform output dr_bucket_name
terraform output maintenance_bucket_name
terraform output kms_key_arn
terraform output alarm_topic_arn
```

`lightsail_static_ip` is used to construct the nip.io origin hostname for the two-pass CloudFront setup (see step 4).

#### 8. Confirm the alarm subscription (and CloudFront status optionally)

- confirm the SNS email subscription, just open the footbag aws root's @gmail.com and click the confirmation link AWS sent. 

CloudFront status check: N/A — CloudFront doesn't exist yet (enable_cloudfront = false). 
But if it does exist wehen you are reading this doc, then:
- wait for the CloudFront distribution status to show `Deployed` before you test through the edge — CloudFront takes **15–30 minutes** to propagate globally after apply; the `*.cloudfront.net` URL is assigned immediately but returns errors during propagation

```bash
CF_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront get-distribution \
  --id "$CF_ID" \
  --query 'Distribution.Status' \
  --output text \
  --profile footbag-operator
```

> [!NOTE]
> After this apply the Lightsail origin still accepts direct HTTP on port 80 from the public internet. CloudFront is the intended entry point, but direct-origin bypass protection is not yet implemented. Do not treat this deployment as CloudFront-locked until Path E section 5.3 is complete.

### 4.7 Host bootstrap

Once infra exists, bootstrap the host in this order.

#### 1. First SSH login and real operator account

First login:

> [!NOTE]
> If port 2222 times out on first attempt, sshd has not yet been configured to listen
> on it. Use the Lightsail browser SSH console (AWS Console → Lightsail →
> footbag-staging-web → Connect) to log in as `ec2-user`, then run:
> `sudo sed -i 's/^#Port 22/Port 22\nPort 2222/' /etc/ssh/sshd_config && sudo systemctl reload sshd`
> Then retry the SSH command below.

ec2-user is only used on first login, from then on, the user name will be footbag.

```bash
LIGHTSAIL_IP=$(terraform output -raw lightsail_static_ip)
ssh -i ~/.ssh/id_ed25519 -p 2222 ec2-user@$LIGHTSAIL_IP
```

Immediately create your named operator account:

```bash
sudo useradd -m -G wheel footbag
sudo mkdir -p /home/footbag/.ssh
sudo bash -c 'echo "<your SSH public key>" > /home/footbag/.ssh/authorized_keys'
sudo chown -R footbag:footbag /home/footbag/.ssh
sudo chmod 700 /home/footbag/.ssh
sudo chmod 600 /home/footbag/.ssh/authorized_keys
```

> **Note:** Do not use `tee <<< "..."` for authorized_keys on Amazon Linux 2023. The here-string wraps long keys across two lines, breaking SSH auth silently. Use `sudo bash -c 'echo "..." > file'` instead.

Still as `ec2-user`, set a password for the footbag account (required for sudo):

```bash
sudo passwd footbag
```

Store this password in your credentials vault (KeePassXC).

Then verify in a new terminal:

```bash
ssh -i ~/.ssh/id_ed25519 -p 2222 footbag@$LIGHTSAIL_IP
sudo whoami
```

`sudo whoami` must return `root` before you stop using `ec2-user`.

> [!IMPORTANT]
> The Lightsail firewall is Terraform-managed via `operator_cidrs`. Do not use the Lightsail console to modify firewall rules — console changes are silently overwritten on the next `terraform apply`. To update SSH access at any point, modify `operator_cidrs` in `terraform.tfvars` and run `terraform apply`.

#### 2. Install Docker and required packages

On the host:

```bash
# Docker engine — from AL2023 native repos (moby-engine)
sudo dnf install -y docker sqlite

# Docker Compose plugin — not in AL2023 native repos; install binary from Docker GitHub
sudo mkdir -p /usr/local/lib/docker/cli-plugins
COMPOSE_VER=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
  | grep -oP '"tag_name": "\K[^"]+')
sudo curl -SL \
  "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

sudo systemctl enable --now docker
sudo usermod -aG docker footbag
```

Log out and back in so group membership takes effect.

Verify:

```bash
docker --version
docker compose version
sqlite3 --version
```

All three must return version strings.

> [!IMPORTANT]
> Do not use the Docker CE RHEL repo (`download.docker.com/linux/rhel`) on Amazon Linux 2023. AL2023 reports a version string of `2023.x.x` which matches no RHEL repo path and returns 404. Use the AL2023 native `docker` package and install the Compose plugin as a standalone binary as shown above.

#### 3. Prepare /srv/footbag and the live env file

```bash
sudo mkdir -p /srv/footbag
SESSION_SECRET_VAL=$(openssl rand -hex 32)
sudo tee /srv/footbag/env > /dev/null <<EOF
NODE_ENV=production
LOG_LEVEL=info
FOOTBAG_DB_PATH=/srv/footbag/db/footbag.db
FOOTBAG_DB_DIR=/srv/footbag/db
PUBLIC_BASE_URL=https://<cloudfront_domain from terraform output>
SESSION_SECRET=${SESSION_SECRET_VAL}
EOF
unset SESSION_SECRET_VAL
sudo chown root:root /srv/footbag/env
sudo chmod 600 /srv/footbag/env
```

`SESSION_SECRET` must be generated fresh per environment. The deploy script and the application both reject values shorter than 32 characters or containing the literal placeholder substring `changeme`. Never reuse the value across staging and production.

Required values in this minimum deployment:

- `NODE_ENV`
- `LOG_LEVEL`
- `FOOTBAG_DB_PATH`
- `FOOTBAG_DB_DIR`
- `PUBLIC_BASE_URL`
- `SESSION_SECRET`

Do not add runtime AWS credentials here. They are provisioned separately via Path H (§8) and live under `/root/.aws` on the host, not in `/srv/footbag/env`.

If you mirror values into Parameter Store for reference, keep the same values under the `/footbag/staging/app/...` path structure, but remember `/srv/footbag/env` is the live runtime source of truth.

#### 4. Copy application files

From your local machine: use footbag@34.192.250.246 
Note that 34.192.250.246.nip.io maps to 34.192.250.246 for DNS (use temp IP lightsail is handing out)

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
  ./ footbag@34.192.250.246:~/footbag-release/
```

> Adjust `-p 2222` to match your configured SSH port if different.

Then on the host:

```bash
sudo rsync -a --delete ~/footbag-release/ /srv/footbag/
sudo chown -R root:root /srv/footbag
```

> [!IMPORTANT]
> Promote from a user-owned staging path into `/srv/footbag`. Do not copy directly into the root-owned runtime path from your laptop.

#### 5. Initialize the database

On first deploy only:

```bash
sudo sqlite3 /srv/footbag/db/footbag.db < /srv/footbag/database/schema.sql
```

To load seed data (run the seed pipeline from the repo root):

```bash
bash scripts/reset-local-db.sh
```

Then lock down the DB file:

```bash
sudo chown root:root /srv/footbag/db/footbag.db
sudo chmod 600 /srv/footbag/db/footbag.db
```

On later deploys, reuse the existing DB file.

> [!NOTE]
> **Runtime user note:**
>
> The web container runs as root and the bind-mounted directory `/srv/footbag/db` is root-owned, so the SQLite main file and its WAL/SHM sidecars are writable as deployed. If you later add a non-root `USER` to the Dockerfile, update host ownership and modes on `/srv/footbag/` and `/srv/footbag/db/` to match.

#### 6. Install and verify footbag.service

Required `footbag.service` contract:

- `After=docker.service`
- `Requires=docker.service`
- `WorkingDirectory=/srv/footbag`
- `EnvironmentFile=/srv/footbag/env`
- starts with `docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up --detach --remove-orphans`
- stops with the matching `docker compose ... down`

### 4.8 Deploy and start application

On the host:

```bash
cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo cp ops/systemd/footbag.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now footbag
sudo systemctl status footbag
```

The systemd service starts the stack with `up --detach --remove-orphans` (matching the actual `footbag.service` file).

Expected behavior:

- `footbag.service` may show `active (exited)` if it is a `Type=oneshot` unit with `RemainAfterExit=yes`
- nginx and web containers should be running
- the worker should exist but be in `Exited (0)` state — no jobs are configured yet (accepted temporary deviation)
- the worker should not be restart-looping

Useful checks:

```bash
docker ps
docker compose \
  -f /srv/footbag/docker/docker-compose.yml \
  -f /srv/footbag/docker/docker-compose.prod.yml \
  logs web --tail=20
sudo systemctl restart footbag
sudo systemctl status footbag
```

> [!NOTE]
> During build, Compose may warn that PUBLIC_BASE_URL is unset. That is expected. The variable is needed at container start time, and systemd supplies it from /srv/footbag/env.

On later deploys (after the first):

```bash
cd /srv/footbag
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build
sudo systemctl restart footbag
```

### 4.9 Verification

#### 1. Verify the origin directly

In a browser: http://34.192.250.246/events (or whatever temp IP lightsail is handing out)

ALso: Use the local smoke script against the Lightsail host on port 80:

```bash
BASE_URL=http://$LIGHTSAIL_IP ./scripts/smoke-local.sh
```

All documented checks must pass.

Also confirm manually:

- `/health/live`
- `/health/ready`
- `/events`
- `/events/year/2025`

#### 2. Verify through CloudFront

Only after distribution status is `Deployed`:

```bash
CF_DOMAIN=$(terraform output -raw cloudfront_domain)
BASE_URL=https://$CF_DOMAIN ./scripts/smoke-local.sh
```

Then do a manual browser pass:

- `https://<cloudfront_domain>/events`
- `https://<cloudfront_domain>/events/year/2025`
- `https://<cloudfront_domain>/events/event_2025_beaver_open`
- `https://<cloudfront_domain>/events/event_2026_spring_classic`
- `https://<cloudfront_domain>/events/event_9999_does_not_exist`

Also expect the smoke script to cover these routes:

- `GET /health/live` → 200
- `GET /health/ready` → 200
- `GET /events` → 200
- `GET /events/year/2025` → 200
- `GET /events/year/1899` → 200
- `GET /events/event_2026_draft_event` → 404
- `GET /events/event_9999_does_not_exist` → 404
- `GET /events/not-a-valid-key` → 404

Expected outcomes:

- health endpoints succeed
- `/events` renders normally
- `/events/year/2025` renders normally
- browser styling looks normal
- no stack traces or internal details leak

If CloudFront returns 403 or 502:

- the distribution may still be propagating
- the origin domain may not be resolving correctly
- wait a few minutes and retry
- if the problem persists, inspect the CloudFront origin settings and confirm the configured DNS name resolves to the Lightsail IP

### 4.10 Known temporary assumptions

After first success, these simplifications are still in place:

- no final custom domain or ACM certificate yet
- the default CloudFront `*.cloudfront.net` URL is still in use
- `/srv/footbag/env` is still managed manually
- runtime AWS credentials have been added for the app-runtime IAM identity (see Path H)
- some monitoring is intentionally deferred
- automated DB backup/restore is not yet closed
- images are still built on-host rather than pulled from a registry
- maintenance-page behavior is not truly production-grade yet
- CloudFront maintenance is not reliable until OAC, ordered cache behavior, and origin-bypass protection are added (accepted temporary deviation)

## 5. Path E — From first success to the repeatable staging baseline

### 5.1 Why this section exists

After the first successful AWS deployment, the project sits in an in-between state: no longer bootstrap-only, but not yet durably hardened.

Path F is now the complete repeatable staging deploy workflow.

Path G contains the remaining AWS hardening work that still follows after that deploy baseline is in place.

### 5.2 What is complete now

At this point, the project has a working staging origin, a host runtime layout, a repeatable service wrapper, three deploy scripts in the repo, and an initial GitHub Actions CI baseline.

In practical terms, the team can now do both of the following:

- deploy routine code changes while preserving the live staging DB
- deploy schema/dev-data changes by rebuilding and replacing the staging DB from scratch

### 5.3 What remains intentionally temporary

The current staging model still includes accepted temporary shortcuts.

Examples:

- `/srv/footbag/env` remains manually managed on the host
- the host still builds Docker images locally rather than pulling from a registry
- staging data remains disposable for the destructive schema/dev deploy path
- public-edge hardening, durable backup/restore, and mature monitoring are still not complete

These are no longer blockers to routine staging deploys, but they are still unfinished.

### 5.4 Where the remaining work moved

Use Path F for the operational staging deploy workflow.

Use Path G for the remaining AWS hardening roadmap that still needs to be completed before the durable operational guidance is moved into `docs/DEVOPS_GUIDE.md`.

## 6. Path F — Repeatable staging deploy workflow

### 6.1 Who this path is for

Use this path when the initial AWS bootstrap is complete (Path D done), the host runtime layout is healthy, and you need the complete repeatable staging deploy workflow.

**Do not use this path to recover a broken host bootstrap.** If `/srv/footbag/env`, the service unit, or the `/srv/footbag` layout is missing or broken, recover the host using §4.7 and §4.8 first.

Path F is now operational, not a backlog of one-time setup tasks. The remaining AWS hardening work has moved to Path G.

Current state entering this path:

- the staging host exists and is reachable
- `footbag.service` is installed and used as the runtime entry point
- `/srv/footbag/env` remains the live runtime source of truth
- `scripts/deploy-code.sh` exists for routine code-only deploys
- `scripts/deploy-rebuild.sh` exists for destructive staging/dev deploys that rebuild and replace the host DB from scratch
- `scripts/deploy-migrate.sh` exists as a stub for future non-destructive schema migrations
- initial GitHub Actions CI exists
- the remaining AWS hardening work now lives in Path G, not here

### 6.1A Claude Code Plan Mode for iteration

Use Plan Mode before editing when the task is primarily planning-heavy or the implementation is not yet obvious.

Use Plan Mode when:

- the change touches multiple files or layers
- you need to inspect route/service/db/test dependencies first
- you are planning legacy-data migration, member import, account-claim, or password-reset work
- you are doing refactor planning, sequencing analysis, or "what should we build next?" work

Skip Plan Mode when the change is small, obvious, and describable in one sentence.

How to use it:

- In an active Claude Code session, press `Shift+Tab` until `plan mode on` appears.
- Or type `/plan mode` in the Claude Code prompt.

Recommended prompt pattern for this repo:

- Tell Claude to read `CLAUDE.md`, the nearest local `CLAUDE.md`, and the likely touched code and tests first.
- Tell Claude current code is the source of truth for implemented behavior.
- Tell Claude not to use browser automation unless explicitly asked.
- Ask Claude to return: baseline observed, files likely to change, dependencies or prerequisites, risks and tradeoffs, verification plan, and recommended implementation order.

After the plan is reviewed, switch back to normal mode to implement.

### 6.2 Fix the SSH config alias

The `~/.ssh/config` entry for `footbag-staging` was created during bootstrap with `User ec2-user`. Update it to `User footbag` before using the deploy script:

```
Host footbag-staging
  Hostname 34.192.250.246
  Port 2222
  User footbag
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

Verify:

```bash
ssh footbag-staging "whoami"
```

Expected output: `footbag`.

### 6.3 Deploy scripts and what they do

Do not inline deploy script bodies in this guide. The executable source of truth lives in `scripts/`. This section explains what each script does, what commands it runs, and why.

#### Which script to use

Use `scripts/deploy-code.sh` for routine code-only deploys. This is the normal path when the code changes but the live staging database should stay in place. This script has no database logic of any kind. It preserves `/srv/footbag/env` and the live DB on every run.

Use `scripts/deploy-rebuild.sh` for schema-changing or seed-data-changing staging/dev deploys when staging data is disposable. This script is intentionally destructive. It preserves `/srv/footbag/env` but destroys and replaces the live DB from a freshly rebuilt local `database/footbag.db`.

Use `scripts/deploy-migrate.sh` for non-destructive schema or data changes against a live DB that must be preserved. This script is not yet implemented. It exits with an error if run. Implement it once the backup/restore path (Path G §7.4) is tested and the project requires non-destructive migrations.

Do not teach manual `scp` + `ssh cp` database replacement as the normal workflow. The destructive staging/dev DB-replacement path is handled by `scripts/deploy-rebuild.sh`.

Why both code-deploy and rebuild scripts still build on-host: the current runtime model still uses `docker compose build` on the Lightsail host. There is no image registry in use yet. The future registry-based path belongs in §6.6.

#### What `scripts/deploy-code.sh` does, command by command, and why

1. Resolves the SSH alias target with `ssh -G` and extracts the hostname.
   Why: show the operator exactly which host is being targeted.

2. Confirms connectivity with `ssh <target> "echo ..."`.
   Why: fail fast before any upload starts.

3. Deletes and recreates the temporary upload directory with `rm -rf ~/footbag-release && mkdir -p ~/footbag-release`.
   Why: each deploy starts from a clean user-owned staging directory.

4. Uploads a restricted allowlist of deployable files with `rsync -av --delete -e "ssh" ...`.
   Why: push only runtime-relevant code files. The database directory is not in the allowlist.

5. Promotes the staged release into `/srv/footbag` with `sudo rsync -a --delete --exclude env --exclude footbag.db`.
   Why: update the runtime tree without overwriting the host env file or the live DB. The live DB is protected at both the upload and the promote step.

6. Resets ownership under `/srv/footbag` with `chown -R root:root`.
   Why: align the deployed tree with the documented root-owned host runtime model.

7. Reinstalls `ops/systemd/footbag.service` and runs `systemctl daemon-reload`.
   Why: keep the installed unit aligned with repo changes.

8. Builds images on-host with `docker compose --env-file /srv/footbag/env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml build`.
   Why: there is still no registry-backed pull path.

9. Restarts `footbag` and checks service status.
   Why: the deploy is not complete until the runtime actually restarts.

10. Runs `BASE_URL=http://<origin-ip> bash scripts/smoke-local.sh` from the local machine.
    Why: verify the origin contract, not just container startup.

#### What `scripts/deploy-rebuild.sh` does, command by command, and why

1. Prints a loud destructive warning before doing anything else.
   Why: this script always replaces the host DB.

2. Confirms SSH connectivity.
   Why: fail fast before any destructive remote action.

3. Runs the local test preflight unless `SKIP_TESTS=yes` is set.
   Why: avoid shipping obviously broken code.

4. Rebuilds the local DB with `bash scripts/reset-local-db.sh` unless `SKIP_DB_REBUILD=yes` is set.
   Why: produce the replacement DB from the current schema and seed pipeline.

5. Verifies the rebuilt local DB with `sqlite3` integrity checks.
   Why: fail locally before anything is uploaded.

6. Confirms that required schema objects exist, including `legacy_person_club_affiliations`.
   Why: make sure the rebuilt DB matches the code being deployed.

7. Prepares the remote upload directory and uploads the deployable runtime files, including the rebuilt DB.
   Why: stage both code and replacement data together.

8. Reads `/srv/footbag/env` on the host, validates required runtime vars, and resolves `FOOTBAG_DB_PATH`.
   Why: the host env file remains the runtime source of truth.

9. Rejects `SESSION_SECRET` values containing `#`.
   Why: systemd `EnvironmentFile` parsing treats `#` as an inline comment delimiter.

10. Stops `footbag` and brings the compose stack fully down.
    Why: avoid conflicts while replacing the DB file and runtime tree.

11. Promotes the new release into `/srv/footbag` while preserving `/srv/footbag/env`.
    Why: align code and runtime artifacts with the rebuilt DB.

12. Removes the current DB path and installs the rebuilt DB as a fresh root-owned file.
    Why: avoid bad leftover host-path states and make the destructive replacement explicit.

13. Verifies the copied DB again on the host with `sqlite3`.
    Why: confirm the exact host-mounted DB is valid before restart.

14. Reinstalls the systemd unit, rebuilds images on-host, and restarts `footbag`.
    Why: finish the deploy the same way the routine path does.

15. Dumps `systemctl`, `journalctl`, and compose diagnostics automatically if restart fails.
    Why: destructive deploy failures must surface actionable diagnostics immediately.

16. Runs the smoke check against the staging origin.
    Why: the deployment is only finished when the runtime contract is working.

#### What `scripts/deploy-migrate.sh` will do (not yet implemented)

This script will deploy code changes and run migration SQL against the existing live DB. Non-destructive: all existing live data is preserved. New schema objects, backfills, and additive data changes are applied in place.

It becomes the active schema/data-change deploy path once the project reaches the point where host data must be preserved. Until then, use `scripts/deploy-rebuild.sh`.

Planned sequence: backup the live DB, deploy code, stop the service, run migration SQL with `sqlite3`, verify DB integrity, restart, smoke check. On any failure: restore from the pre-migration backup and restart.

Do not implement this script until the backup/restore path (Path G §7.4) is tested and a working restore has been rehearsed in staging.

The point of this section is not to duplicate shell source. The point is to explain the exact operational sequence so a contributor understands what the scripts do and why the three deploy paths are different.


### 6.4 Routine deploy workflow

After the deploy baseline is established, the staging deploy cycle is:

1. Make the change locally.
2. Run the local quality gate.
3. Push a branch and open a PR.
4. Let CI run.
5. Let branch protection block merge until checks pass.
6. Merge.
7. Run exactly one deploy command from your local machine against the staging origin.
8. Verify the origin.
9. If CloudFront is enabled in staging, verify CloudFront too.

The deploy trigger remains a local manual step by design. GitHub-hosted runners use dynamic IPs, while the Lightsail firewall remains locked to explicit operator CIDRs.

#### Before each deploy: check the env file

The host env file `/srv/footbag/env` is never overwritten by any deploy script and remains the runtime source of truth. Review it before any deploy that introduces a new required environment variable or changes runtime behavior.

At minimum, the host env file must define:

- `NODE_ENV`
- `LOG_LEVEL`
- `FOOTBAG_DB_PATH`
- `FOOTBAG_DB_DIR`
- `PUBLIC_BASE_URL`
- `SESSION_SECRET`

`docker/docker-compose.prod.yml` bind-mounts `${FOOTBAG_DB_DIR}` into `/app/db`, and `footbag.service` starts Docker Compose with `--env-file /srv/footbag/env`. If the env file is wrong, the deploy can succeed mechanically but still fail at runtime.

Warning: do not use `#` in env file values. systemd `EnvironmentFile` parsing treats `#` as an inline comment delimiter.

#### Before each deploy: local quality gate

Always run:

```bash
npm test
```

Optionally run Docker parity when the change touches runtime shape, static assets, containerization, or environment handling.

#### Deploy options

**Option A — routine code-only deploy**

Use this when the host DB should remain untouched.

```bash
bash scripts/deploy-code.sh <password>
```

This path preserves `/srv/footbag/env` and the live DB.

**Option B — destructive schema/dev deploy**

Use this when the change requires rebuilding and replacing the host DB from scratch and staging/dev data is still disposable.

```bash
bash scripts/deploy-rebuild.sh <password>
```

This path preserves `/srv/footbag/env` but intentionally destroys and replaces the live host DB.

**Option C — non-destructive migration deploy (future)**

Use this once the project reaches the point where host data must be preserved. Not yet implemented.

```bash
bash scripts/deploy-migrate.sh <password>
# exits with error until implemented — see Path G §7.4
```

Do not document manual `scp` + `ssh sudo cp` DB-replacement procedures. Those manual destructive flows are superseded by `scripts/deploy-rebuild.sh`.

#### After each deploy: verification

Always verify the staging origin first.

```bash
BASE_URL=http://<staging-origin> bash scripts/smoke-local.sh
```

Also verify manually in the browser when the change affects routing, rendering, or static assets.

If CloudFront is enabled in staging, also verify CloudFront after the origin is confirmed healthy:

```bash
BASE_URL=https://<cloudfront-domain> bash scripts/smoke-local.sh
```

Why origin-first still matters: if the origin fails, CloudFront only obscures the root cause.

### 6.5 If something goes wrong on staging

#### Check logs

```bash
# Service status
ssh footbag-staging "sudo systemctl status footbag --no-pager -l"

# Recent journal entries
ssh footbag-staging "sudo journalctl -u footbag -n 50 --no-pager"

# Extended journal with full context (use for startup failures)
ssh footbag-staging "sudo journalctl -xeu footbag.service --no-pager | tail -50"

# Running containers
ssh footbag-staging "docker ps"

# Web container logs via Compose
ssh footbag-staging "sudo docker compose \
  -f /srv/footbag/docker/docker-compose.yml \
  -f /srv/footbag/docker/docker-compose.prod.yml \
  logs web --tail=30"

# Web container logs directly (useful when Compose context is unavailable)
ssh footbag-staging "sudo docker logs docker-web-1 2>&1 | tail -30"
```

> **Note:** Always use `sudo systemctl restart footbag`, not `start`. The `start` command is a no-op if the service is already active.

#### Roll back

Check out the last known-good commit and re-run the deploy script:

```bash
git checkout <known-good-ref>
bash scripts/deploy-code.sh <password>
```

The database is not touched by `scripts/deploy-code.sh`.

Schema-changing staging/dev deploys are currently handled by `scripts/deploy-rebuild.sh`, which destroys and replaces the host DB from a freshly rebuilt local DB. This is a deliberate temporary development workflow, not the future live-data procedure.

Once the project reaches the point where host data must be preserved, replace this destructive workflow with `scripts/deploy-migrate.sh`. That durable operational guidance belongs in the future DevOps guide, not in the current development-phase onboarding workflow.

### 6.6 Future: ECR registry and automated image builds

When you are ready to move image builds out of the Lightsail host:

1. Create ECR repositories for `footbag-web` and `footbag-worker`.
2. Create a GitHub Actions IAM user `github-actions-ecr` scoped to ECR push only. Add access keys as GitHub repository secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `ECR_REGISTRY`).
3. Add a `build-push` job to `ci.yml` that runs after tests pass on `main`: builds images and pushes to ECR with `${{ github.sha }}` and `latest` tags.
4. Update `docker/docker-compose.prod.yml` to reference ECR image URIs instead of build directives.
5. Create a host IAM user `staging-ecr-pull` scoped to ECR read on those repositories only. Add its credentials to `/srv/footbag/env`.
6. Update `deploy-code.sh` and `deploy-rebuild.sh` to run `docker compose pull` instead of `docker compose build`.

After this, the deploy scripts become much faster. The remaining manual trigger (step 7 in §6.4) can only be eliminated by replacing Lightsail with EC2 and using SSM Session Manager (no IP restriction), or by running a self-hosted GitHub Actions runner on the same network as the host.

---

## 7. Path G — Remaining AWS hardening after the deploy workflow is established

### 7.1 Why this section exists

Path F is now the complete repeatable staging deploy workflow. Path G collects the remaining AWS hardening and governance work that still follows after that deploy baseline is in place.

This section is still part of onboarding because the AWS setup story is not fully closed yet, but it is no longer part of the day-to-day staging deploy workflow.

### 7.2 Public edge and delivery hardening

If CloudFront pass 2 is not already complete, finish it here rather than treating it as part of the routine deploy path.

#### Prerequisites

- `export AWS_PROFILE=footbag-operator` in your terminal
- SSH alias `footbag-staging` working (`ssh footbag-staging` connects on port 2222)
- `npm test` and `npm run build` passing locally

#### Phase A: Deploy code to staging host first

The nginx config must land before CloudFront is enabled. CloudFront strips `X-Forwarded-Proto` from origin requests but sends `CloudFront-Forwarded-Proto` instead. The `map` directive in `docker/nginx/nginx.conf` translates this to `X-Forwarded-Proto` so the app sets the session cookie `Secure` flag correctly. Without this, login cookies would lack the `Secure` flag when accessed through CloudFront. When accessed directly (no CloudFront header), the map falls back to `$scheme`.

```bash
bash scripts/deploy-code.sh <password>
```

Verify the site still works via direct IP:

```bash
curl -I http://34.192.250.246/
curl -I http://34.192.250.246/health/ready
```

Both should return 200.

#### Phase B: Enable CloudFront on staging

1. In `terraform/staging/terraform.tfvars`, set:
   - `lightsail_origin_dns = "34.192.250.246.nip.io"`
   - `enable_cloudfront = true`

2. Plan and review:

```bash
cd terraform/staging
terraform plan -out=tfplan
```

Expect: 2 resources to add (`aws_cloudfront_distribution.main[0]` and `aws_cloudwatch_metric_alarm.cloudfront_5xx[0]`), 0 to change, 0 to destroy. The dashboard resource will show as changed (it picks up the new distribution ID in its widget JSON).

3. Apply:

```bash
terraform apply tfplan
terraform output cloudfront_domain
terraform output cloudfront_distribution_id
```

Save both outputs. The domain will be something like `d1234abcdef8.cloudfront.net`.

4. Wait for CloudFront to deploy (15 to 30 minutes):

```bash
CF_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront get-distribution \
  --id "$CF_ID" \
  --query 'Distribution.Status' \
  --output text
```

Repeat until it returns `Deployed`.

#### Phase C: Update host config

SSH to staging and update `PUBLIC_BASE_URL` to the CloudFront domain:

```bash
ssh footbag-staging
sudo sed -i 's|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://<cloudfront-domain>|' /srv/footbag/env
sudo systemctl restart footbag
```

Verify containers came back:

```bash
docker ps
curl -s http://localhost/health/ready | head
```

Then exit the SSH session.

#### Phase D: Smoke test through CloudFront

Replace `<cf>` with the actual CloudFront domain in all commands below.

**D1. Automated smoke check:**

```bash
BASE_URL=https://<cf> bash scripts/smoke-local.sh
```

All checks should pass.

**D2. Static asset caching:**

```bash
curl -I https://<cf>/css/style.css
curl -I https://<cf>/js/clubs-map.js
curl -I https://<cf>/img/world-map.svg
```

Expect 200 with `X-Cache` header. On repeat requests, `Age` header should increase (assets cache for up to 1 day).

**D3. Health endpoint (no caching):**

```bash
curl -I https://<cf>/health/ready
```

`Age` header should always be 0 or absent (`/health/*` TTL is 0).

**D4. Browser tests (manual):**

Open `https://<cf>/` in a browser.

1. Navigate public pages (home, events, clubs, players). Confirm pages render correctly.
2. Go to `/login`. Log in with the test account. Confirm:
   - Login POST succeeds (not 405 or 403)
   - Redirect lands on the member dashboard
   - In browser dev tools, the `footbag_session` cookie has the `Secure` flag set
3. Test `returnTo`: visit `/login?returnTo=/members/footbag_hacky`. After login, confirm redirect goes to the profile page.
4. Test avatar: go to profile edit, upload an avatar. Confirm it saves and displays.
5. Log out. Confirm logout POST works and session clears.

**D5. Verify direct IP still works:**

```bash
curl -I http://34.192.250.246/
```

Should still return 200. Direct access is not blocked until 1-F (X-Origin-Verify).

#### Phase E: Update local records

Update local operator notes to reflect the new state:

- Updated tfvars values (`enable_cloudfront = true`, `lightsail_origin_dns`)
- `aws_cloudfront_distribution.main` now in Terraform state
- Outputs `cloudfront_domain` and `cloudfront_distribution_id` populated
- Staging CloudFront status is ACTIVE with the published domain
- Deployment checklist: CloudFront pass 2 is complete

#### Rollback

If anything breaks, disable CloudFront and revert the host config:

```bash
# Edit terraform/staging/terraform.tfvars: set enable_cloudfront = false
cd terraform/staging
terraform plan -out=tfplan
terraform apply tfplan
```

Then revert PUBLIC_BASE_URL on the host:

```bash
ssh footbag-staging
sudo sed -i 's|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://34.192.250.246|' /srv/footbag/env
sudo systemctl restart footbag
```

#### Remaining public-edge hardening (after CloudFront exists)

After CloudFront is active and validated, three operations close the public-edge posture: attach the custom domain, enforce origin-bypass protection, and provision the maintenance page. They are independent of each other; attach them in the order below so that the maintenance page can use the final custom domain. Until all three land, do not rely on the maintenance page as a graceful-downtime path and expect direct-to-origin traffic to reach the host.

##### Attach custom domain (ACM + Route 53)

Prerequisites:

- The project's canonical domain is owned in Route 53 (or at least has a Route 53 hosted zone that can serve as the authoritative DNS for it).
- `var.domain_name` and `var.route53_zone_id` are populated in `terraform/staging/terraform.tfvars`.

1. Uncomment the ACM resources in `terraform/staging/acm.tf` (all three: `aws_acm_certificate.main`, `aws_route53_record.acm_validation`, `aws_acm_certificate_validation.main`).

2. Uncomment the Route 53 records in `terraform/staging/route53.tf` (`apex_a`, `apex_aaaa`, `www_a`).

3. In `terraform/staging/cloudfront.tf`:
   - Uncomment the `aliases` line on `aws_cloudfront_distribution.main`.
   - Replace the `viewer_certificate { cloudfront_default_certificate = true }` block with:

     ```hcl
     viewer_certificate {
       acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
       ssl_support_method       = "sni-only"
       minimum_protocol_version = "TLSv1.2_2021"
     }
     ```

4. Plan and review:

   ```bash
   cd terraform/staging
   terraform plan -out=tfplan
   ```

   Expect: one ACM certificate, its DNS validation records (one per name), one `aws_acm_certificate_validation`, three Route 53 alias records (apex A, apex AAAA, www A), and one change on `aws_cloudfront_distribution.main` (viewer_certificate + aliases).

5. Apply:

   ```bash
   terraform apply tfplan
   ```

   Certificate validation takes 1 to 5 minutes; `terraform apply` blocks on `aws_acm_certificate_validation.main` until DNS propagation succeeds.

6. Wait for CloudFront to redeploy (15 to 30 minutes):

   ```bash
   CF_ID=$(terraform output -raw cloudfront_distribution_id)
   aws cloudfront get-distribution --id "$CF_ID" --query 'Distribution.Status' --output text
   ```

7. Validate DNS resolution and TLS:

   ```bash
   dig +short <domain>
   dig +short www.<domain>
   curl -I https://<domain>/health/ready
   curl -I https://www.<domain>/health/ready
   ```

   Both `dig` calls resolve to CloudFront edge IPs (Route 53 alias targets). Both `curl` calls return 200 with TLS handshake against the new ACM cert.

8. Update `PUBLIC_BASE_URL` on the host:

   ```bash
   ssh footbag-staging
   sudo sed -i 's|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://<domain>|' /srv/footbag/env
   sudo systemctl restart footbag
   exit
   ```

9. Run the full smoke check against the custom domain:

   ```bash
   BASE_URL=https://<domain> bash scripts/smoke-local.sh
   ```

Rollback: comment the ACM and Route 53 resources back, restore `cloudfront_default_certificate = true` in `cloudfront.tf`, `terraform apply`, revert `PUBLIC_BASE_URL` to the CloudFront default URL.

##### Enforce origin-bypass protection (X-Origin-Verify)

Until this step is complete, direct-to-origin traffic at `http://<lightsail-static-ip>/` bypasses CloudFront entirely. Origin-bypass protection places a shared secret header on every CloudFront → origin request and makes nginx reject requests that lack it.

1. Generate the shared secret:

   ```bash
   openssl rand -hex 32
   ```

   Keep this value in the operator vault; it must match in CloudFront and on the host. Store an optional reference copy in SSM at `/footbag/staging/secrets/origin_verify_secret`.

2. Declare the sensitive variable in `terraform/staging/variables.tf`:

   ```hcl
   variable "origin_verify_secret" {
     description = "Shared secret between CloudFront and the origin's nginx; rejects direct-to-origin traffic."
     type        = string
     sensitive   = true
   }
   ```

3. Provide the value via a non-committed source (gitignored tfvars file, or `TF_VAR_origin_verify_secret` exported in the shell before `terraform plan`). Do not commit it to `terraform.tfvars`.

4. Add the header to the CloudFront origin in `terraform/staging/cloudfront.tf`. Inside the `origin` block for `lightsail-origin`, add a `custom_header` block:

   ```hcl
   custom_header {
     name  = "X-Origin-Verify"
     value = var.origin_verify_secret
   }
   ```

5. Add the secret to the host's runtime env (the running app does not read it; nginx inside the web container does):

   ```bash
   ssh footbag-staging
   sudo bash -c 'printf "\nX_ORIGIN_VERIFY_SECRET=<paste-the-secret>\n" >> /srv/footbag/env'
   ```

6. Enforce the header in `docker/nginx/nginx.conf`. In the server block that listens on port 80, before any `proxy_pass` to the app, add:

   ```nginx
   # Reject direct-to-origin bypass. CloudFront sets X-Origin-Verify; direct callers do not.
   if ($http_x_origin_verify != "${X_ORIGIN_VERIFY_SECRET}") {
     return 403;
   }
   ```

   The `${X_ORIGIN_VERIFY_SECRET}` substitution requires nginx to see the variable at config-evaluation time. Use nginx's official `envsubst`-on-templates entrypoint (rename `nginx.conf` to `nginx.conf.template` and list `X_ORIGIN_VERIFY_SECRET` in `NGINX_ENVSUBST_TEMPLATE_SUFFIX`), or an equivalent templating step in the container build.

7. Plan and apply the terraform change, then deploy the code and nginx update:

   ```bash
   cd terraform/staging && terraform plan -out=tfplan && terraform apply tfplan
   bash scripts/deploy-code.sh <password>
   ```

8. Validate enforcement:

   ```bash
   # Through CloudFront: expect 200.
   curl -I https://<domain>/health/ready

   # Direct to the Lightsail static IP: expect 403.
   curl -I http://<lightsail-static-ip>/health/ready
   ```

   The direct call must fail with 403. A 200 means nginx is not enforcing the header and the procedure is incomplete.

##### Provision the maintenance page (S3 + OAC)

Serve a static `/maintenance.html` from S3 behind CloudFront so that origin outages are covered by a graceful page rather than a CloudFront 5xx. Uses Origin Access Control (OAC), not the older Origin Access Identity.

The `maintenance` S3 bucket already exists (`aws_s3_bucket.maintenance` in `terraform/staging/s3.tf`) but has no OAC, no bucket policy, and no object.

1. Upload the maintenance HTML. If no canonical page exists yet, author a minimal static page first under a repo-tracked path (for example `docker/nginx/maintenance.html`):

   ```bash
   MAINT_BUCKET=$(cd terraform/staging && terraform output -raw maintenance_bucket || echo "footbag-staging-maintenance")
   aws s3 cp docker/nginx/maintenance.html "s3://${MAINT_BUCKET}/maintenance.html" \
     --content-type text/html \
     --cache-control "public, max-age=60"
   ```

2. Add an Origin Access Control in `terraform/staging/cloudfront.tf`:

   ```hcl
   resource "aws_cloudfront_origin_access_control" "maintenance" {
     name                              = "${local.prefix}-maintenance-oac"
     description                       = "OAC for the maintenance S3 bucket"
     origin_access_control_origin_type = "s3"
     signing_behavior                  = "always"
     signing_protocol                  = "sigv4"
   }
   ```

3. Add the S3 origin to `aws_cloudfront_distribution.main`, alongside the existing `lightsail-origin`:

   ```hcl
   origin {
     origin_id                = "maintenance-origin"
     domain_name              = aws_s3_bucket.maintenance.bucket_regional_domain_name
     origin_access_control_id = aws_cloudfront_origin_access_control.maintenance.id

     s3_origin_config {
       origin_access_identity = ""
     }
   }
   ```

4. Add an `ordered_cache_behavior` for `/maintenance.html`:

   ```hcl
   ordered_cache_behavior {
     path_pattern           = "/maintenance.html"
     target_origin_id       = "maintenance-origin"
     viewer_protocol_policy = "redirect-to-https"
     allowed_methods        = ["GET", "HEAD"]
     cached_methods         = ["GET", "HEAD"]

     forwarded_values {
       query_string = false
       cookies { forward = "none" }
     }

     min_ttl     = 0
     default_ttl = 60
     max_ttl     = 300
   }
   ```

5. Add `custom_error_response` blocks so CloudFront serves `/maintenance.html` when the origin is unavailable:

   ```hcl
   custom_error_response {
     error_code            = 502
     response_code         = 503
     response_page_path    = "/maintenance.html"
     error_caching_min_ttl = 0
   }

   custom_error_response {
     error_code            = 503
     response_code         = 503
     response_page_path    = "/maintenance.html"
     error_caching_min_ttl = 0
   }

   custom_error_response {
     error_code            = 504
     response_code         = 504
     response_page_path    = "/maintenance.html"
     error_caching_min_ttl = 0
   }
   ```

6. Add a bucket policy in `terraform/staging/s3.tf` granting CloudFront (via the OAC) read access to the maintenance bucket:

   ```hcl
   data "aws_iam_policy_document" "maintenance_bucket" {
     statement {
       actions   = ["s3:GetObject"]
       resources = ["${aws_s3_bucket.maintenance.arn}/*"]

       principals {
         type        = "Service"
         identifiers = ["cloudfront.amazonaws.com"]
       }

       condition {
         test     = "StringEquals"
         variable = "AWS:SourceArn"
         values   = [aws_cloudfront_distribution.main[0].arn]
       }
     }
   }

   resource "aws_s3_bucket_policy" "maintenance" {
     bucket = aws_s3_bucket.maintenance.id
     policy = data.aws_iam_policy_document.maintenance_bucket.json
   }

   resource "aws_s3_bucket_public_access_block" "maintenance" {
     bucket                  = aws_s3_bucket.maintenance.id
     block_public_acls       = true
     block_public_policy     = false
     ignore_public_acls      = true
     restrict_public_buckets = false
   }
   ```

7. Plan, apply, wait for CloudFront to redeploy.

8. Validate `/maintenance.html` is reachable:

   ```bash
   curl -I https://<domain>/maintenance.html
   ```

   Expect 200 with `X-Cache` set (first call `Miss from cloudfront`, subsequent `Hit from cloudfront`).

9. Simulate an origin failure to confirm the error-response fallback:

   ```bash
   ssh footbag-staging
   sudo systemctl stop footbag
   exit

   # From the workstation:
   curl -I https://<domain>/
   ```

   Expect 503 with the maintenance page body. Restart the service afterward:

   ```bash
   ssh footbag-staging
   sudo systemctl start footbag
   ```

### 7.3 GitHub and operator governance hardening

Initial CI now exists, but the governance around it still needs to be closed. Three one-time operations: enable GitHub branch protection on `main`, scope `footbag-operator` down from `AdministratorAccess` to a least-privilege policy, and retire the Lightsail `ec2-user` default account. Two additional governance notes appear at the end.

#### Enable branch protection on `main`

1. GitHub → the repository → Settings → Branches → Branch protection rules → Add rule.
2. Branch name pattern: `main`.
3. Enable:
   - Require a pull request before merging.
   - Require approvals: 1.
   - Require status checks to pass before merging:
     - `Type-check and test`
     - `Terraform fmt / validate`
   - Require branches to be up to date before merging.
   - Require linear history (optional but recommended).
4. Save.
5. Verify by opening a test PR with a known-failing check; confirm the merge button is blocked until the check passes.

Refresh the required-check names if the CI workflow job names change: branch protection reads the exact job-name strings from the latest runs.

#### Scope down `footbag-operator` from `AdministratorAccess`

The operator IAM user initially holds `AdministratorAccess` for bootstrap. After the first successful deploy, move it to a least-privilege policy covering only services the project uses.

1. Define the scoped policy in `terraform/staging/iam.tf` (or a sibling file) with statements covering:
   - Lightsail (full: instance management, static IP, SSH key, firewall rules)
   - CloudFront (full: distribution, OAC, cache policies)
   - S3 (the project's state bucket, media bucket, snapshots bucket, DR bucket, maintenance bucket; scoped by ARN)
   - SSM Parameter Store under `/footbag/*`
   - KMS scoped to the project's keys by ARN (SSM key, JWT signing key)
   - SNS (the operator alert topic)
   - CloudWatch (metrics, alarms, dashboards)
   - IAM self-rotation (only on the operator user's own access keys)
   - STS for `sts:AssumeRole` if the operator assumes any project roles

2. Attach the scoped policy to `footbag-operator` via Terraform. Leave `AdministratorAccess` attached for one `terraform apply` cycle so you can compare permission sets in practice.

3. Apply:

   ```bash
   cd terraform/staging
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

4. Exercise the operator path end-to-end while both policies are attached:
   - `terraform plan` and `terraform apply` on a no-op change.
   - `aws s3 ls` on each project bucket.
   - `aws cloudfront list-distributions`.
   - `bash scripts/deploy-code.sh <password>`.

5. When the above is green, detach `AdministratorAccess`:

   ```bash
   aws iam detach-user-policy \
     --user-name footbag-operator \
     --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
   ```

6. Re-exercise the same paths. Any denied action indicates a missing statement in the scoped policy. Tighten, re-apply, re-test. Keep the final policy in Terraform HCL so the scope-down is reproducible and audit-trailable.

#### Retire `ec2-user`

The Lightsail default `ec2-user` account was used for initial SSH before the named operator account existed. After named operator SSH is validated, retire it.

Prerequisite: `ssh footbag-staging` (the named operator account) has worked for multiple sessions without needing `ec2-user` as a fallback.

1. SSH in as the named operator and escalate:

   ```bash
   ssh footbag-staging
   sudo -i
   ```

2. Lock the `ec2-user` account (lock rather than delete; locked accounts preserve audit trails):

   ```bash
   passwd -l ec2-user
   usermod -s /usr/sbin/nologin ec2-user
   ```

3. Remove `ec2-user`'s authorized SSH keys:

   ```bash
   rm /home/ec2-user/.ssh/authorized_keys
   ```

4. Verify the named operator still has access in a fresh shell:

   ```bash
   ssh footbag-staging -o ControlMaster=no -o ControlPath=none
   ```

5. Attempt to log in as `ec2-user` from the workstation using the old key:

   ```bash
   ssh -i ~/.ssh/footbag-lightsail-key ec2-user@<lightsail-static-ip> -p 2222
   ```

   Expect "Permission denied" or immediate disconnect.

Rollback: `usermod -s /bin/bash ec2-user` and restore the authorized_keys file from a backup. Rotate or delete the old key material only after a cooling-off period.

#### Additional governance notes

- Long-lived IAM access keys on `footbag-operator` remain in place until the project selects a short-lived-credential path (IAM Identity Center, workload identity federation, or equivalent). Until that decision lands, rotate keys on the 90-day cadence per `docs/DEVOPS_GUIDE.md` §5.7.
- Lightsail browser SSH can be disabled once named-operator SSH is fully reliable. Browser SSH has no per-IP allowlist and expands the attack surface; disable it from the Lightsail console under the instance's Networking tab once an alternative recovery path is confirmed.

### 7.4 Reliability and recovery

The staging deploy workflow exists, but durable recovery does not. Close it with four one-time operations: provision dedicated backup credentials, deploy a scheduled backup producer, emit a backup-age metric for alerting, and rehearse a full restore drill. The goal is to move from "we can redeploy" to "we can recover," and it is a prerequisite for implementing `scripts/deploy-migrate.sh`.

#### Provision dedicated backup credentials

The backup producer must not use the operator's credentials or the app-runtime role. Create a dedicated IAM user with `s3:PutObject` on the snapshots bucket only, plus `cloudwatch:PutMetricData` for the freshness metric added below.

1. Declare the backup user and scoped policy in `terraform/staging/iam.tf`:

   ```hcl
   resource "aws_iam_user" "backup_writer" {
     name = "${local.prefix}-backup-writer"
   }

   data "aws_iam_policy_document" "backup_writer" {
     statement {
       actions = ["s3:PutObject", "s3:ListBucket"]
       resources = [
         aws_s3_bucket.snapshots.arn,
         "${aws_s3_bucket.snapshots.arn}/*",
       ]
     }

     statement {
       actions   = ["cloudwatch:PutMetricData"]
       resources = ["*"]

       condition {
         test     = "StringEquals"
         variable = "cloudwatch:namespace"
         values   = ["Footbag"]
       }
     }
   }

   resource "aws_iam_user_policy" "backup_writer" {
     user   = aws_iam_user.backup_writer.name
     policy = data.aws_iam_policy_document.backup_writer.json
   }
   ```

2. `terraform plan` and `terraform apply`.

3. Create an access key for the user and install it on the host in a root-only credentials file:

   ```bash
   aws iam create-access-key --user-name footbag-staging-backup-writer
   # Record AccessKeyId and SecretAccessKey in the operator vault.

   ssh footbag-staging
   sudo bash -c 'cat > /root/.aws/credentials-backup <<EOF
   [backup]
   aws_access_key_id = <AccessKeyId>
   aws_secret_access_key = <SecretAccessKey>
   EOF'
   sudo chmod 600 /root/.aws/credentials-backup
   ```

   Rotate this key on the same 90-day cadence as other access keys per `docs/DEVOPS_GUIDE.md` §5.7.

#### Deploy the backup producer (systemd timer)

A systemd timer is preferred over cron because it integrates with journalctl and handles missed runs via `Persistent=true`. Backups run every 5 minutes; the snapshots bucket holds versioned objects so a 5-minute cadence gives a ~5-minute RPO.

1. Install the backup script on the host at `/usr/local/sbin/footbag-backup.sh`:

   ```bash
   sudo tee /usr/local/sbin/footbag-backup.sh > /dev/null <<'EOF'
   #!/bin/bash
   set -euo pipefail

   export AWS_SHARED_CREDENTIALS_FILE=/root/.aws/credentials-backup
   export AWS_PROFILE=backup
   BUCKET="<your-snapshots-bucket-name>"
   DB_PATH="${FOOTBAG_DB_PATH:-/srv/footbag/db/footbag.db}"
   TS="$(date -u +%Y%m%dT%H%M%SZ)"
   OUT="/tmp/footbag-${TS}.db"

   sqlite3 "$DB_PATH" ".backup $OUT"
   sqlite3 "$OUT" 'PRAGMA integrity_check;' | grep -q '^ok$' || { echo "integrity check failed"; exit 1; }
   aws s3 cp "$OUT" "s3://${BUCKET}/snapshots/${TS}.db"
   aws cloudwatch put-metric-data \
     --namespace "Footbag" \
     --metric-name BackupAgeMinutes \
     --value 0 \
     --unit Count \
     --dimensions Environment=staging
   rm -f "$OUT"
   EOF
   sudo chmod +x /usr/local/sbin/footbag-backup.sh
   ```

2. Install the systemd service unit at `/etc/systemd/system/footbag-backup.service`:

   ```bash
   sudo tee /etc/systemd/system/footbag-backup.service > /dev/null <<'EOF'
   [Unit]
   Description=footbag.org SQLite snapshot producer
   After=network-online.target

   [Service]
   Type=oneshot
   ExecStart=/usr/local/sbin/footbag-backup.sh
   User=root
   EOF
   ```

3. Install the timer unit at `/etc/systemd/system/footbag-backup.timer`:

   ```bash
   sudo tee /etc/systemd/system/footbag-backup.timer > /dev/null <<'EOF'
   [Unit]
   Description=footbag.org backup schedule

   [Timer]
   OnCalendar=*:0/5
   Persistent=true
   AccuracySec=1min
   Unit=footbag-backup.service

   [Install]
   WantedBy=timers.target
   EOF
   ```

4. Enable and start the timer:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now footbag-backup.timer
   ```

5. Verify:

   ```bash
   sudo systemctl status footbag-backup.timer
   sudo journalctl -u footbag-backup.service --no-pager | tail
   aws s3 ls "s3://<snapshots-bucket>/snapshots/" | tail
   ```

   Expect the timer active, the service journal showing a recent successful run, and the bucket listing new objects every 5 minutes.

#### Enable the backup-age alarm

Without a freshness alarm, a silent backup failure can go unnoticed until the next restore drill. The Terraform scaffolding for the alarm already exists in `terraform/staging/cloudwatch.tf`; enabling it now that the metric is being emitted is a one-line tfvars change.

1. Trigger a manual backup run to confirm the metric appears:

   ```bash
   sudo systemctl start footbag-backup.service
   aws cloudwatch list-metrics --namespace Footbag
   ```

2. Enable the alarm in `terraform/staging/terraform.tfvars`:

   ```hcl
   enable_backup_alarm = true
   ```

3. `terraform plan` and `terraform apply`.

4. Confirm the alarm reaches the operator by temporarily stopping the timer and waiting past the alarm threshold, then re-enabling:

   ```bash
   sudo systemctl stop footbag-backup.timer
   # Wait past the configured threshold; observe the alarm firing via SNS email.
   sudo systemctl start footbag-backup.timer
   ```

#### Rehearse a full restore

Rehearse this before any migration-related work. Completing the drill is a gate for §28.1.

1. Capture baseline state so you can compare after restore:

   ```bash
   ssh footbag-staging
   sudo sqlite3 /srv/footbag/db/footbag.db 'SELECT COUNT(*) FROM members;' > /tmp/members-baseline.txt
   ```

2. Stop the service:

   ```bash
   sudo systemctl stop footbag
   ```

3. Pick a known-good snapshot and copy it down:

   ```bash
   SNAPSHOT=$(aws s3 ls s3://<snapshots-bucket>/snapshots/ | awk '{print $4}' | tail -1)
   aws s3 cp "s3://<snapshots-bucket>/snapshots/${SNAPSHOT}" /tmp/restore.db
   ```

4. Verify snapshot integrity:

   ```bash
   sqlite3 /tmp/restore.db 'PRAGMA integrity_check;'
   ```

   Expect `ok`.

5. Replace the live DB in place:

   ```bash
   sudo install -o root -g root -m 600 /tmp/restore.db /srv/footbag/db/footbag.db
   ```

6. Restart the service:

   ```bash
   sudo systemctl start footbag
   ```

7. Run the smoke check and compare member counts:

   ```bash
   BASE_URL=https://<public-url> bash scripts/smoke-local.sh
   sudo sqlite3 /srv/footbag/db/footbag.db 'SELECT COUNT(*) FROM members;'
   ```

   Confirm the smoke passes and the member count matches expectations for the snapshot age.

8. Time the sequence end-to-end. Target: under 5 minutes RTO from "stop service" to "smoke passes."

9. Record the timing in operator notes and confirm it meets the `docs/DEVOPS_GUIDE.md` §10.1 target.

### 7.5 Runtime configuration maturity

`/srv/footbag/env` remains the runtime source of truth and now includes runtime AWS credentials for the app-runtime IAM identity. Manual host edits remain the delivery mechanism; this becomes harder to live with as secrets multiply.

Remaining work:

- keep `/srv/footbag/env` as the current runtime source of truth for now
- decide when manual host edits become too fragile; access-key rotation every 90 days is the first recurring forcing function now that the app has runtime AWS credentials
- if needed later, add a helper that materializes `/srv/footbag/env` from Parameter Store
- keep local `.env`, host `/srv/footbag/env`, and optional AWS-side reference storage clearly distinct

### 7.6 Monitoring maturity

Some monitoring exists in concept. Close the full loop with three one-time operations: install the CloudWatch agent (CWAgent) on the runtime host, enable the CWAgent CPU / memory / disk alarms, and validate SNS alert delivery end-to-end. Backup-freshness alarms are covered in §7.4; the CloudFront 5xx alarm is enabled automatically with CloudFront in §7.2.

#### Install CWAgent on the Lightsail host

1. SSH in and install the agent from Amazon's apt repo:

   ```bash
   ssh footbag-staging
   sudo bash -c '
   cd /tmp
   curl -fsSL https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -o amazon-cloudwatch-agent.deb
   dpkg -i amazon-cloudwatch-agent.deb
   '
   ```

2. Create the agent config at `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json`:

   ```bash
   sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null <<'EOF'
   {
     "agent": {
       "metrics_collection_interval": 60,
       "run_as_user": "root"
     },
     "metrics": {
       "namespace": "CWAgent",
       "metrics_collected": {
         "cpu": {
           "measurement": ["usage_idle", "usage_iowait", "usage_user", "usage_system"],
           "totalcpu": true
         },
         "mem": {
           "measurement": ["mem_used_percent", "mem_available_percent"]
         },
         "disk": {
           "measurement": ["used_percent"],
           "resources": ["/"]
         }
       }
     }
   }
   EOF
   ```

3. CWAgent publishes via the host's default AWS profile, which under Path H is the assumed runtime-role chain. Verify:

   ```bash
   sudo -u root aws sts get-caller-identity
   ```

   Expect the assumed runtime role ARN. If the chain is not in place, CWAgent will fail to publish and its log at `/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log` will show the credential error.

4. Grant the runtime role `cloudwatch:PutMetricData` on the `CWAgent` namespace. Extend the `app_runtime` inline policy in `terraform/staging/iam.tf`:

   ```hcl
   statement {
     sid       = "CWAgentMetrics"
     actions   = ["cloudwatch:PutMetricData"]
     resources = ["*"]

     condition {
       test     = "StringEquals"
       variable = "cloudwatch:namespace"
       values   = ["CWAgent"]
     }
   }
   ```

   `terraform apply`.

5. Start the agent and confirm metrics arrive:

   ```bash
   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
     -a fetch-config \
     -m onPremise \
     -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json \
     -s

   sudo systemctl status amazon-cloudwatch-agent
   ```

   Then from the workstation:

   ```bash
   aws cloudwatch list-metrics --namespace CWAgent
   ```

   Expect entries for `cpu_usage_idle`, `mem_used_percent`, and `disk_used_percent`.

#### Enable CWAgent alarms

1. In `terraform/staging/terraform.tfvars`:

   ```hcl
   enable_cwagent_alarms = true
   ```

2. `terraform plan` and `terraform apply`. Expect CPU, memory, and disk alarms added.

3. Verify alarm states:

   ```bash
   aws cloudwatch describe-alarms --query 'MetricAlarms[].{Name:AlarmName,State:StateValue}' --output table
   ```

   Each should show `INSUFFICIENT_DATA` initially and transition to `OK` within one evaluation period.

#### Validate SNS alert delivery end-to-end

CloudWatch alarms are only useful if the operator receives them. Confirm the path with a deliberate test.

1. Identify the SNS topic and confirm the operator subscription is active:

   ```bash
   cd terraform/staging
   TOPIC_ARN=$(terraform output -raw alerts_topic_arn)
   aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN"
   ```

   Expect at least one `Protocol=email` subscription in the `Confirmed` state (not `PendingConfirmation`).

2. Publish a test message:

   ```bash
   aws sns publish \
     --topic-arn "$TOPIC_ARN" \
     --subject "footbag.org monitoring test" \
     --message "Manual SNS delivery check."
   ```

3. Confirm the operator receives the email within one minute.

4. Force a real alarm to confirm the alarm-to-SNS path. A simple approach: temporarily lower the CPU alarm threshold in `cloudwatch.tf` to 1%, `terraform apply`, wait for the alarm to breach, confirm the SNS email arrives, then revert.

#### Document the operator dashboard

Record the CloudWatch dashboard URL, the `/health/live` and `/health/ready` URLs through CloudFront, and the confirmed SNS subscription address in operator notes. These are the first-check locations when an alarm fires.

### 7.7 Delivery maturity beyond on-host builds

The current deploy scripts still rely on on-host image builds.

Remaining work:

- move image builds into CI
- publish images to a registry such as ECR
- change the host deploy path from `docker compose build` to `docker compose pull`
- keep the deploy scripts aligned with that future registry-backed flow

This is the natural handoff point from onboarding into the longer-lived operational guidance in `docs/DEVOPS_GUIDE.md`.

---

## 8. Path H — Runtime AWS identity and transactional email activation

### 8.1 Why this path exists

Earlier paths assume the running app uses only `process.env` and SQLite and makes no AWS API calls at runtime. That assumption held until KMS-backed JWT session signing and SES-backed transactional email were introduced. Those two capabilities require the app to call AWS at request time. Per DD §3.5 and §7.2, the authoritative runtime principal on Lightsail is an assumed IAM role reached through a source-profile credential chain on a root-owned host AWS config; Lightsail has no EC2 instance profile, so this chain is the supported substitute. Path H is the one-time activation runbook that extends the existing deferred runtime role (`aws_iam_role.app_runtime`), creates the source-profile IAM user, stands up the KMS signing key and the SES sender, and wires the chain on the staging host (host config files, `/srv/footbag/env`, and the production compose file).

Path H is parallel to Path D in feel: executed once per environment, not part of the routine deploy workflow. Access-key rotation is stewardship, not activation; it lives in `docs/DEVOPS_GUIDE.md` §5.7 (see §8.12 below for the pointer).

### 8.2 Scope

Staging only. Four tasks, in order:

1. A KMS asymmetric signing key.
2. A new minimal source-profile IAM user plus an extension of the existing deferred runtime role (`aws_iam_role.app_runtime`): new trust statement and new inline-policy statements for KMS Sign and SES Send.
3. A SES sandbox sender identity plus a verified test recipient.
4. Host AWS config/credentials files, `/srv/footbag/env` additions, and a compose-file update that mounts `/root/.aws` read-only into the app container.

This path assumes the staging baseline from Paths D through F is already in place: the `footbag-operator` human identity exists, Terraform state is bootstrapped, the Lightsail instance is running, and the routine deploy workflow is working. If any of that is not true, complete those paths first.

Out of scope: custom domains, ACM, Route 53, new CloudFront work (§7.2); backups and monitoring (§7.4, §7.6); CI image publishing (§7.7); production (production KMS, SES production-access, and production IAM are a separate later activation); domain-identity verification (this path uses a sandbox email identity only); Terraform HCL reconciliation of the inline policy + trust edits made via Console in this path.

### 8.3 Preconditions

Before starting, confirm:

- You are signed in to the AWS Console with your human operator identity, not root.
- `AWS_PROFILE=footbag-operator` is active in any terminal you will use for validation.
- The staging Lightsail host is reachable via the SSH alias `footbag-staging`.
- You have the current staging base URL (canonical source: `README.md` and `docs/DEVOPS_GUIDE.md`).

Have your local operator-specifics notes open so you can record identifiers as you go. This path will tell you which values you need to retain.

### 8.3.1 Console sign-in for the operator identity

Path H is Console-driven in §8.6 through §8.9. Before starting, sign in to the AWS Console as the operator IAM user (`footbag-operator`, not root) per `docs/DEVOPS_GUIDE.md` §3.3 "Operator console sign-in". That section covers the account ID, password, and MFA TOTP mechanics, and notes where the required credentials are held.

After sign-in, confirm the Console region selector (top-right) is **US East (N. Virginia) us-east-1**. This check is repeated at the start of §8.6 because a misregioned KMS key is the most common expensive mistake in this path.

For a new volunteer taking over this runbook: you need vault access before you can execute Path H. Arrange handoff with the outgoing maintainer per DEVOPS_GUIDE §3.3 and §17.2 before proceeding.

### 8.4 Naming convention

Follows the existing project pattern `footbag-<env>-<component>[-<qualifier>]` seen in `footbag-staging-web` (Lightsail instance), `footbag-staging-web-ip` (static IP), and `alias/footbag-staging` (existing SSM KMS key).

- KMS alias: `alias/footbag-staging-jwt`.
- Existing runtime IAM role (reuse, do not create): Terraform name `aws_iam_role.app_runtime`, IAM role name `footbag-staging-app-runtime`. Already declared in `terraform/staging/iam.tf:16-85` as deferred groundwork for exactly this chain.
- New source-profile IAM user: `footbag-staging-source-profile`. Holds only `sts:AssumeRole` on the runtime role; its long-lived access keys are delivered to the host.
- New inline-policy statements on the runtime role: `JwtSigning` (`kms:Sign` + `kms:GetPublicKey`) and `OutboundEmail` (`ses:SendEmail`).
- Source-profile user inline policy: `footbag-staging-source-profile-assume-role` (single `sts:AssumeRole` statement).
- AWS SDK profile name used on the host: `footbag-staging-runtime`.

The human operator identity (`footbag-operator`) remains env-agnostic; the names above are env-specific because the resources they label are env-specific. See also §4.5 "Lightsail runtime identity model" for the three-identity split (operator, source-profile user, runtime role) and its rationale.

### 8.5 Supersedes an earlier assumption

The "current public slice does not need runtime AWS API calls" stance expressed earlier in this document (§4.5, earlier wording now revised) was accurate before this activation. It is no longer accurate once Path H has run: the app now assumes the runtime role once per process startup (via `sts:AssumeRole` through the source-profile chain) and then calls `kms:Sign` on every login and session re-issue, `kms:GetPublicKey` once per process (cached in memory), and `ses:SendEmail` for every verification, reset, and confirmation email the outbox drains.

Lightsail has no EC2 instance profile, so these calls route through the source-profile + assumed-role chain rather than through an instance-attached role. That is what this path provisions.

### 8.6 Step 1 — Create the KMS asymmetric signing key

Do this first because step 4 (the IAM policy) needs the key ARN.

Confirm the AWS Console region selector (top-right) is `US East (N. Virginia) us-east-1` before creating any resource in this path; the KMS key, SES identity, IAM policy resource ARNs, and `AWS_REGION=us-east-1` in §8.10 step 5b all assume this region. A key created in a different region will produce a `NotFoundException` from the SDK at runtime.

1. AWS Console → KMS → Customer managed keys → **Create key**.
2. Key type: **Asymmetric**.
3. Key usage: **Sign and verify**.
4. Key spec: **RSA_2048**.
5. Alias: `footbag-staging-jwt`.
6. Description: `JWT session signing for staging. RSA-2048. Do not repurpose.`
7. Key administrators: leave as your human operator.
8. Key users: leave empty for now; the app IAM user created in step 2 gets access via the inline policy in step 4, not via the key policy.
9. Finish and create.
10. Before leaving the KMS console, view the generated key policy and confirm it contains the `Enable IAM User Permissions` statement (`Principal: AWS: arn:aws:iam::<ACCOUNT>:root`, `Action: kms:*`). This statement is what lets the step-4 IAM policy authorize KMS Sign calls. Without it the IAM policy is silently ineffective.

Record locally:

- KMS key ARN (full `arn:aws:kms:us-east-1:...:key/...` form).
- KMS alias (`alias/footbag-staging-jwt`).

You will paste the ARN into step 4 and step 5.

### 8.7 Step 2 — Create the source-profile IAM user

Do this second because step 4 attaches an inline policy that references both the KMS key ARN from step 1 and the runtime role ARN, and because the runtime role's trust policy in step 4 needs this user's ARN.

1. AWS Console → IAM → Users → **Create user**.
2. Username: `footbag-staging-source-profile`.
3. Do **not** grant console access.
4. Do **not** attach any managed policies at this step; the inline policy is added in step 4.
5. Create the user.
6. Go to the user → **Security credentials** → **Create access key** → choose **Application outside AWS** (or **Other**) as the use case, confirm.
7. Save the access key ID and secret access key immediately. AWS shows the secret only once.

Record locally:

- Source-profile IAM user ARN.
- Access key ID.
- Date of access-key issuance (tracked for rotation cadence in `docs/DEVOPS_GUIDE.md` §5.7).

Treat the secret access key with the same custody you use for `footbag-operator` credentials. Do not paste it into checked-in files, chat logs, or shared screens. The source-profile user holds only `sts:AssumeRole` (attached in step 4): a leaked key lets an attacker only attempt to assume the runtime role, and revoking the role's trust of this user severs access instantly.

### 8.8 Step 3 — Verify the SES sandbox sender and test recipient

Before starting, confirm `noreply@footbag.org` has an active Cloudflare Email Routing rule forwarding to an operator mailbox (per DD §5.5); SES email-identity verification requires clicking a link delivered to that address, and without an inbound route the verification email is dropped silently. If no rule exists, create the Cloudflare rule first.

**Preflight (added post-2025-07-03 Cloudflare change):** Cloudflare Email Routing now drops inbound mail that fails both SPF and DKIM. Before triggering the SES verification email, send a manual test message from a different external account (e.g. a personal gmail) to `noreply@footbag.org` and confirm it arrives at the forwarding destination inbox. If it does not arrive, the SES verification email will also be silently dropped and this step will appear to hang. Fix Cloudflare routing first, then continue.

1. AWS Console → SES → **Verified identities** → **Create identity**.
2. Identity type: **Email address**.
3. Email address: `noreply@footbag.org`.
4. Create. AWS sends a verification email; click the link to confirm ownership.
5. Repeat steps 1-4 for the email address you will use as the test recipient in §8.11 post-setup validation. You will need to click the verification link sent to that mailbox to confirm.

In SES sandbox, the account can only send to verified recipients, so the test recipient is how you exercise the full send path during step 6 validation. Verifying the recipient in SES is necessary but not sufficient — the IAM policy in §8.9 step 4b must also permit `ses:SendEmail` on the recipient's identity ARN. The identity-wildcard pattern used there covers every address you verify in this step without a separate IAM edit per tester.

Record locally:

- Verified sender (`noreply@footbag.org`).
- Verified test recipient.
- SES region (`us-east-1`).

The account stays in SES sandbox. Production access is a separate support ticket and is out of scope for this path.

The IAM policy in the next step uses v1 SES actions (`ses:SendEmail`, `ses:SendRawEmail`) matching the v1 SES SDK client. AWS has not deprecated the v1 API. SESv2-specific features (for example configuration sets with Virtual Deliverability Manager) would require a separate IAM and client update.

### 8.9 Step 4 — Attach policies and amend the runtime role's trust

Three Console actions. These IAM edits are applied via the AWS Console; Terraform HCL reconciliation for them is out of scope for this path.

**4a. Source-profile user → `sts:AssumeRole` only.**

1. IAM → Users → `footbag-staging-source-profile` → **Add permissions** → **Create inline policy** → JSON.
2. Look up the runtime role ARN (IAM → Roles → `footbag-staging-app-runtime` → copy ARN) and paste it into the policy below.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeRuntimeRole",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "<RUNTIME_ROLE_ARN>"
    }
  ]
}
```

3. Name the policy `footbag-staging-source-profile-assume-role` and save.

**4b. Runtime role → add KMS Sign + SES Send inline statements.**

The role `footbag-staging-app-runtime` already exists in Terraform with pre-existing statements for SSM read and S3 snapshots. This step adds two new statements via Console.

1. IAM → Roles → `footbag-staging-app-runtime` → **Add permissions** → **Create inline policy** → JSON.
2. Paste the policy below, substituting the KMS key ARN from step 1 and your AWS account ID. The `JwtSigning` Resource is pinned to the single KMS key; the `OutboundEmail` Resource uses an identity wildcard within the account — see note below.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "JwtSigning",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey"
      ],
      "Resource": "<KMS_KEY_ARN_FROM_STEP_1>"
    },
    {
      "Sid": "OutboundEmail",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:<ACCOUNT_ID>:identity/*"
    }
  ]
}
```

3. Name the policy `footbag-staging-app-runtime-jwt-ses` and save.

**Why the identity wildcard for `OutboundEmail`.** In SES sandbox mode, AWS performs an IAM permission check against BOTH the sender identity AND every recipient identity on each `ses:SendEmail` call. A policy that pins `Resource` to the sender identity alone will refuse sends to a verified sandbox recipient with `User ... is not authorized to perform ses:SendEmail on resource arn:aws:ses:...:identity/<RECIPIENT>`. The recipient still must be verified in SES per §8.8 — the wildcard does not bypass SES's sandbox check, it only allows the role to reach SES for identities within this account. Each new tester requires only an §8.8 SES verification step; no IAM edit per tester. SES production access (out of scope for this path) removes the recipient-identity permission check; at that point the Resource can be tightened back to the single sender identity ARN.

`ses:SendRawEmail` is not granted. The app uses `@aws-sdk/client-ses` `SendEmailCommand` exclusively; if a future change needs raw MIME (attachments), add `ses:SendRawEmail` at that point.

**4c. Runtime role → amend trust policy to trust the source-profile user.**

Current trust policy trusts only `ec2.amazonaws.com` (a Terraform stub from when the role was scaffolded for instance-profile use, unreachable on Lightsail). Replace it so the source-profile user can assume the role.

1. IAM → Roles → `footbag-staging-app-runtime` → **Trust relationships** → **Edit trust policy**.
2. Replace the existing JSON with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TrustSourceProfileUser",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<SOURCE_PROFILE_USER_ARN_FROM_STEP_2>"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

3. Save. The old `ec2.amazonaws.com` statement is dropped; Lightsail cannot assume EC2-trust roles. Terraform reconciliation will remove or replace that statement in the HCL post-sprint.

Do not delete and recreate the source-profile user to rotate credentials. AWS resolves the principal ARN to the user's internal unique ID at save time, so a recreated user with the same name produces a trust that looks correct in JSON but silently refuses `AssumeRole` until the trust policy is re-edited. Rotate by issuing a second access key under the same user (see `docs/DEVOPS_GUIDE.md` §5.7).

### 8.10 Step 5 — Wire credentials, env, and the compose file

Four sub-steps. Access-key material lives in `/root/.aws/credentials` (root-owned, 0600). `/srv/footbag/env` carries only non-secret runtime config and the AWS profile name. The compose file mounts `/root/.aws` read-only into the app container and passes the env vars through.

**5a. Write root-owned AWS config/credentials on the staging host.**

Replace every `<...>` placeholder in the heredocs below before pasting. `<ACCESS_KEY_ID_FROM_STEP_2>` and `<SECRET_ACCESS_KEY_FROM_STEP_2>` come from §8.7; `<RUNTIME_ROLE_ARN>` is the ARN of `footbag-staging-app-runtime` (IAM → Roles → copy ARN), also referenced in §8.9 step 4a. The single-quoted `<<'EOF'` deliberately disables shell expansion, so an unreplaced placeholder is written verbatim to the file and the chain will fail silently at `sts:AssumeRole`.

```bash
ssh footbag-staging

sudo install -d -m 0700 -o root -g root /root/.aws

sudo tee /root/.aws/credentials > /dev/null <<'EOF'
[footbag-staging-source-profile]
aws_access_key_id = <ACCESS_KEY_ID_FROM_STEP_2>
aws_secret_access_key = <SECRET_ACCESS_KEY_FROM_STEP_2>
EOF
sudo chmod 0600 /root/.aws/credentials

sudo tee /root/.aws/config > /dev/null <<'EOF'
[profile footbag-staging-runtime]
role_arn = <RUNTIME_ROLE_ARN>
source_profile = footbag-staging-source-profile
region = us-east-1
EOF
sudo chmod 0600 /root/.aws/config
```

Verify the chain before going further:

```bash
sudo AWS_PROFILE=footbag-staging-runtime aws sts get-caller-identity
```

The `Arn` in the output should be `arn:aws:sts::<ACCOUNT>:assumed-role/footbag-staging-app-runtime/...`, confirming the SDK performed the AssumeRole call. If instead you see an IAM-user ARN or an AccessDenied, the trust policy (§8.9 step 4c) or the source-profile inline policy (§8.9 step 4a) is misconfigured.

**Stanza-prefix footgun:** the stanza name rule differs between the two files and is a common silent misconfiguration. In `/root/.aws/config` the role profile stanza MUST include the literal word `profile`: `[profile footbag-staging-runtime]`. In `/root/.aws/credentials` the source profile stanza MUST NOT include it: `[footbag-staging-source-profile]`. Swapping either produces a chain that fails silently, with `get-caller-identity` returning the source user's identity instead of the assumed role.

**5b. Append non-secret AWS config to `/srv/footbag/env`.**

`/srv/footbag/env` is the runtime source of truth on the Lightsail host for non-secret runtime config (see §10.4). Access-key material does not live here.

```bash
sudo tee -a /srv/footbag/env > /dev/null <<'EOF'

# Runtime AWS wiring for KMS JWT signing and SES transactional email.
# Long-lived access keys are in /root/.aws/credentials (root-owned, 0600),
# not here. The app reaches AWS via the assumed-role chain.
JWT_SIGNER=kms
JWT_KMS_KEY_ID=<KMS_KEY_ARN_FROM_STEP_1>
SES_ADAPTER=live
SES_SANDBOX_MODE=1
SES_FROM_IDENTITY=noreply@footbag.org
AWS_REGION=us-east-1
AWS_PROFILE=footbag-staging-runtime
EOF
```

> [!IMPORTANT]
> **Confirm `SESSION_SECRET` is set and valid on the host.** Verify `SESSION_SECRET` is present in `/srv/footbag/env` from §4.7 Step 3 with a real value. The deploy script will refuse to proceed if it is shorter than 32 characters or contains the literal `changeme` placeholder. If the host was provisioned before the §4.7 update or you carried over `.env.example` text, regenerate it now:

```bash
sudo sed -i '/^SESSION_SECRET=/d' /srv/footbag/env
echo "SESSION_SECRET=$(openssl rand -hex 32)" | sudo tee -a /srv/footbag/env > /dev/null
```

Local-dev reference. The equivalent block for a contributor's local `.env` (commented because dev defaults are applied automatically when `NODE_ENV !== 'production'`) is the following. Add it to `.env.example` so new contributors see these keys exist and know what to uncomment when switching to high-fidelity local testing:

```
# Auth / runtime-AWS wiring
# Dev defaults: JWT_SIGNER=local and SES_ADAPTER=stub are applied automatically
# when NODE_ENV !== 'production'. In production both must be set explicitly.
# JWT_SIGNER=local
# JWT_KMS_KEY_ID=arn:aws:kms:us-east-1:<ACCOUNT>:key/<KEY_ID>
# JWT_LOCAL_KEYPAIR_PATH=database/dev-jwt-keypair.pem
# SES_ADAPTER=stub
# SES_SANDBOX_MODE=0
# SES_FROM_IDENTITY=noreply@footbag.org
# AWS_REGION=us-east-1
# AWS_PROFILE=footbag-staging-runtime
```

**5c. Extend `docker/docker-compose.prod.yml`.**

Both the `web` and `worker` services must bind-mount `/root/.aws` read-only and pass the new env vars through. Without this, the SDK inside the container cannot see the credentials or the profile.

Under both `services.web` and `services.worker` add:

- to `volumes:` — `- /root/.aws:/root/.aws:ro`
- to `environment:` — `AWS_PROFILE: ${AWS_PROFILE}`, `AWS_REGION: ${AWS_REGION}`, `JWT_SIGNER: ${JWT_SIGNER}`, `JWT_KMS_KEY_ID: ${JWT_KMS_KEY_ID}`, `SES_ADAPTER: ${SES_ADAPTER}`, `SES_FROM_IDENTITY: ${SES_FROM_IDENTITY}`

The systemd unit already invokes compose with `--env-file /srv/footbag/env`, so the `${...}` substitutions resolve from the values set in 5b. Commit and redeploy per Path F.

**5d. Restart `footbag.service` and confirm a clean start.**

```bash
# Confirm host Node version (must be 22.x to match the pinned AWS SDK engine
# requirement; the SDK will refuse to load on Node 18 or earlier).
node --version

sudo systemctl restart footbag
sudo systemctl status footbag --no-pager | head -20
```

If the service does not come back cleanly, check journal logs (§6.5 covers the common commands) and revert the env and compose additions before continuing.

### 8.11 Step 6 — Post-setup validation

All checks run after the application code that consumes these env vars has deployed to staging. If you run this path before that code has landed, skip this section and return afterward.

From your local machine, exercise the KMS signing path by logging in and inspecting the session cookie format. Use the current staging base URL in place of `<base-url>` throughout:

```bash
# 1. KMS signing path: login, inspect the session cookie format.
curl -s -c /tmp/cookies.txt -X POST \
  -d "email=<known-verified-member>&password=<known-password>" \
  <base-url>/login -i | head -30

# The footbag_session cookie value should have three base64url segments
# separated by dots. The first segment decodes to JSON with "alg":"RS256"
# and a "kid" that matches the KMS key ARN from step 1.
```

Then exercise the SES path.

**First-send test recipient: use `success@simulator.amazonses.com`.** The SES mailbox simulator is always a safe recipient, does not require verification, and sidesteps the SES account-level suppression list (which silently drops messages to addresses that previously bounced in this account). Using it first isolates the SES IAM + identity path from the end-to-end anti-enumeration and member-row preconditions.

On the staging host, insert an outbox row directly. The column set below covers the current NOT NULL constraints and the "at least one recipient target" CHECK in `outbox_emails`; verify against `database/schema.sql` if the schema may have evolved:

```bash
ssh footbag-staging

sudo sqlite3 /srv/footbag/db/footbag.db <<'EOF'
INSERT INTO outbox_emails
  (id, created_at, created_by, updated_at, updated_by,
   subject, body_text, recipient_email)
VALUES
  ('ses-smoke-' || lower(hex(randomblob(6))),
   datetime('now'), 'ses-smoke',
   datetime('now'), 'ses-smoke',
   'Path H SES smoke test',
   'Path H validation send.',
   'success@simulator.amazonses.com');
EOF
```

The worker container runs continuously (`restart: unless-stopped` in `docker/docker-compose.prod.yml`) and polls the outbox on its own interval (see `src/worker.ts`); you do not need to trigger it manually. Wait for the poll to elapse, then confirm:

```bash
sudo sqlite3 /srv/footbag/db/footbag.db \
  "SELECT id, status, sent_at, last_error FROM outbox_emails \
   WHERE recipient_email = 'success@simulator.amazonses.com' \
   ORDER BY created_at DESC LIMIT 1;"
```

`status=sent` with a non-null `sent_at` confirms KMS-assumed-role credentials, the `ses:SendEmail` grant, and the sender identity are all wired correctly. Only after this passes, switch to the verified real test recipient for the end-to-end password-reset flow below.

**Precondition for the end-to-end password-reset check:** confirm a staging member row exists with the same email as the verified test recipient (seed or register-and-verify beforehand). Anti-enumeration (DD §3.8) makes the reset request a silent no-op otherwise, and no outbox row is ever created.

```bash
# 2. SES path: request a password reset for the verified test recipient.
curl -s -X POST -d "email=<verified-test-recipient>" \
  <base-url>/password/forgot -i | head -5

# Response is always 200 with the generic "if an account exists" message
# (anti-enumeration, DD §3.8).
```

On the staging host, confirm the outbox row transitioned:

```bash
ssh footbag-staging

sudo sqlite3 /srv/footbag/db/footbag.db \
  "SELECT id, status, sent_at, last_error FROM outbox_emails \
   ORDER BY created_at DESC LIMIT 1;"
```

The latest row should show `status=sent` and a non-null `sent_at`. If it shows `failed` or `pending`, check the logs for the SES error; common causes are the IAM policy not attached yet and the recipient not verified in sandbox.

Finally, confirm the verified test recipient received the reset email.

For routine post-change verification of the staging runtime identity wiring (after IAM, KMS, SES, or trust-policy changes; after access-key rotation; after a host rebuild), the operator-workstation path via `npm run test:smoke` is the canonical runbook. See `docs/DEVOPS_GUIDE.md` §13.8.

### 8.12 Where rotation lives

The access keys issued in §8.7 belong to the source-profile user `footbag-staging-source-profile`. They are long-lived credentials. CIS Benchmarks call for rotation at least every 90 days; current AWS IAM best-practices guidance prefers short-lived credentials overall and flags unused keys via last-accessed information. The rotation runbook (target file on the host: `/root/.aws/credentials`; target profile: `footbag-staging-source-profile`) is stewardship rather than first-time activation and lives in `docs/DEVOPS_GUIDE.md` §5.7. Rotate by issuing a second access key under the same user; do not delete and recreate the user (see §8.9 step 4c for the principal-ARN pitfall). The runtime role's permissions and trust policy are untouched by rotation. Record the access-key issuance date in your local operator notes so the rotation schedule can be tracked against it.

### 8.13 AWS SDK version pinning

The three AWS SDK client packages (`@aws-sdk/client-kms`, `@aws-sdk/client-ses`, `@aws-sdk/client-sts`) are pinned to EXACT versions in `package.json` (no caret, no tilde). All three must be kept at the same version.

AWS SDK v3 has a near-daily release cadence (roughly 18 to 20 minor/patch releases per month) and a documented history of shipping behavior-changing regressions under non-major version bumps, including credential-chain regressions that would silently break the staging assumed-role path on which this entire setup depends. Caret ranges cannot be trusted across that cadence when the app's entire auth and email paths route through KMS and SES.

To upgrade: update all three client entries together in a single PR, run `npm install` to refresh `package-lock.json`, run `npm test` and `npm run build`, then commit `package.json` and `package-lock.json` in the same commit. Never update one client without the others. Never run `npm install` in the course of unrelated work without checking for SDK drift (`git diff package-lock.json`). Deploy uses `npm ci`, which installs exactly what the lock file says; this is correct and must not change.

The Lightsail host Node.js runtime must be 22.x. The pinned SDK versions declare a minimum engine of Node 20, but this repo's `package.json` `engines` field requires 22.x and the rest of the toolchain assumes it. Confirm with `node --version` on the host before first deploy (see §8.10 step 5d).

### 8.14 Where the remaining AWS work lives

This path deliberately does not cover other outstanding AWS hardening. Those items track against Path G:

- Custom domain, ACM certificate, Route 53, X-Origin-Verify, S3 maintenance page: §7.2.
- Branch-protection refinement, operator scope-down from `AdministratorAccess`, retiring `ec2-user`: §7.3.
- Host-side SQLite backups and restore drill: §7.4.
- `/srv/footbag/env` manual-edits fragility threshold: §7.5. Access-key rotation is the first recurring forcing function.
- CWAgent activation, backup-freshness metrics, SNS delivery: §7.6.
- CI-built images, ECR registry, `docker compose pull`: §7.7.

Once all Path G items are complete, the durable operational content (including this path, condensed) migrates into `docs/DEVOPS_GUIDE.md`.

---

## 9. Path I — Production activation

### 9.1 Why this path exists

Path H activates KMS-backed JWT session signing, runtime AWS identity, and SES-backed transactional email on staging. Path I is the equivalent activation for production: it establishes a production AWS account posture with its own KMS signing key, runtime role, SES domain identity, and bounce/complaint handling, and stands up the production Lightsail host with the credential chain it needs. The shape of each step mirrors Path H; the names, ARNs, domain, and sender identity are production-scoped.

Several production-only operations have no staging equivalent and are covered here in full: domain acquisition and DNS delegation, Cloudflare Email Routing for the canonical sender, the SES production-access support ticket, SES domain identity with DKIM, and the bounce/complaint webhook subscription.

Like Path H, this is a one-time activation per environment, not part of the routine deploy workflow.

### 9.2 Scope

Production only. The work falls into two groups:

**Production-only procedures authored here (§9.4 through §9.7, §9.10):**
1. Domain acquisition and DNS delegation
2. Cloudflare Email Routing for `noreply@footbag.org`
3. SES production-access activation (AWS support ticket)
4. SES domain identity with DKIM
5. SES bounce/complaint webhook subscription

**Mirrors of Path H with production naming (§9.8, §9.9, §9.11, §9.12):**

| Path H entity (staging) | Path I entity (production) |
|---|---|
| `alias/footbag-staging-jwt` | `alias/footbag-production-jwt` |
| `footbag-staging-source-profile` | `footbag-production-source-profile` |
| `footbag-staging-app-runtime` | `footbag-production-app-runtime` |
| `footbag-staging-source-profile-assume-role` | `footbag-production-source-profile-assume-role` |
| SDK profile name `footbag-staging-runtime` | `footbag-production-runtime` |

Out of scope: code changes (the app already selects KMS signing and live SES adapters via env vars; no compilation difference between staging and production); migration cutover itself (see `docs/MIGRATION_PLAN.md` §23 State 4).

### 9.3 Preconditions

Before starting Path I, confirm:

- Path H on staging is complete and behaviorally smoke-validated end-to-end (login → KMS JWT; register → outbox → SES → recipient inbox).
- AWS account hardening from Path D applied to the production AWS account: root MFA enabled, named human operator identity in place, Terraform state bootstrapped for production.
- A production Lightsail instance exists and is reachable over SSH using a named operator account.
- IFPA has secured control of `footbag.org` (or the project's canonical public domain), including registrar-level ownership and access to configure authoritative DNS.
- Operator vault access is arranged for the production KMS key material, source-profile access keys, and backup credentials.

### 9.4 Domain acquisition and DNS delegation

Production cutover requires IFPA to own `footbag.org` at the registrar level and to delegate authoritative DNS to a provider the project operates. Two provider patterns are supported: Cloudflare (used for Email Routing in §9.5; recommended) and AWS Route 53 (used for ACM validation and CloudFront alias records).

1. Registrar ownership: IFPA confirms domain renewal and registrar credentials in the operator vault. Registrar choice is outside this runbook; the only requirement is that registrar-level NS record edits are possible.

2. Pick the authoritative DNS provider:
   - **Cloudflare**: free tier sufficient; needed anyway for Email Routing in §9.5. Create a Cloudflare account under an IFPA-owned email and add the `footbag.org` zone. Cloudflare returns two nameservers.
   - **AWS Route 53**: the existing staging `acm.tf` and `route53.tf` templates use Route 53. Create a hosted zone in Route 53 in the production AWS account.

   Mixing providers (Cloudflare for email + Route 53 for web) is possible but complicates ownership; prefer one provider authoritative for the whole zone.

3. Delegate DNS at the registrar by setting the domain's NS records to the chosen provider's nameservers. Propagation takes up to 48 hours globally; typically completes within an hour.

4. Confirm delegation:

   ```bash
   dig NS footbag.org +short
   ```

   Expect the chosen provider's nameservers.

5. Record in operator notes: registrar used, renewal contact, DNS provider, zone ID (if Route 53).

### 9.5 Cloudflare Email Routing for noreply@footbag.org

SES verifies a sender identity by sending a confirmation email to that address; the address must be deliverable. Cloudflare Email Routing (free) forwards `noreply@footbag.org` to an operator mailbox for the verification step and for any replies to operational emails.

1. In the Cloudflare dashboard, go to the `footbag.org` zone → Email → Email Routing.

2. Enable Email Routing. Cloudflare auto-provisions MX records and a `_cf-mailchannels` TXT record. Confirm the records appear in the zone.

3. Add a custom address route:
   - Custom address: `noreply@footbag.org`
   - Action: Send to an email (an operator inbox the project controls)
   - Save.

4. Confirm the destination address. Cloudflare sends a confirmation link to the operator inbox; open it and confirm.

5. Test end-to-end by sending a test message from a personal account to `noreply@footbag.org`. Confirm it arrives at the operator inbox.

6. Update SPF to authorize Cloudflare's forwarding so DKIM alignment continues to work after SES sends are added in §9.7. Accept Cloudflare's SPF prompt, or manually add the `include:_spf.mx.cloudflare.net` mechanism to the existing SPF record.

### 9.6 SES production-access activation

Production cutover is incompatible with SES sandbox (caps are 200 sends/day with per-recipient verification). Production access is an AWS support ticket with a typical 24 to 48-hour approval window.

1. Confirm the production AWS account has a verified SES identity in the target region (us-east-1). If not, verify `noreply@footbag.org` per Path H §8.8 first; AWS deprioritizes production-access requests from accounts with no verified identities.

2. In the AWS Console, go to SES → Account dashboard → Request production access.

3. Provide (paraphrase for the project):
   - Use case: Transactional email for a volunteer-run sports-community platform. Email types: registration verification, password reset, password-change confirmation, post-migration notification batch (one-time to legacy accounts with explicit consent).
   - Expected volume: initial steady state under 500 emails/day; one-time migration batch whose size equals the count of legacy accounts to be notified.
   - Recipient list: registered members (opt-in at registration; consent recorded in `members.email_verified_at`).
   - Bounce and complaint handling: described in §9.10.
   - Compliance: unsubscribe mechanism via account preferences (not applicable to transactional types).

4. AWS typically responds within 24 to 48 hours. Expect either approval with default limits (50,000 sends/day, 14 sends/second) or a request for more detail. Respond promptly; delays here extend the cutover timeline.

5. After approval, confirm:

   ```bash
   aws ses get-send-quota --region us-east-1
   ```

   Expect non-sandbox values (`Max24HourSend` well above 200).

### 9.7 SES domain identity with DKIM

A domain identity (distinct from the email identity verified in Path H §8.8) allows SES to send from any address at the domain and supports DKIM signing. DKIM signing improves deliverability and reputation. Verify the domain identity after §9.6 approves; some receiving providers reject DKIM-signed mail from sandbox accounts.

1. In SES → Identities → Create identity → Domain:
   - Identity: `footbag.org`
   - Enable DKIM. Accept Easy DKIM defaults (three CNAME records).

2. SES returns three CNAME records. Add them to the `footbag.org` zone:
   - **Cloudflare**: paste the three CNAME records into the DNS tab. Leave proxy status set to DNS only (gray cloud); DKIM must resolve to the AWS values, not Cloudflare's proxy.
   - **Route 53**: add them as standard CNAME records via Terraform or console.

3. SES polls DNS and confirms verification within 72 hours (usually within 15 minutes). Poll:

   ```bash
   aws ses get-identity-verification-attributes --identities footbag.org --region us-east-1
   ```

   Expect `VerificationStatus=Success` on the identity and on the three DKIM tokens.

4. Point the app's SES sender ARN at the domain identity (`arn:aws:ses:us-east-1:<account-id>:identity/footbag.org`) instead of the single-address identity. This broadens the allowed sender addresses; `SES_FROM_IDENTITY` still pins the From address to `noreply@footbag.org`.

5. Send a test DKIM-signed email. Inspect headers at the recipient to confirm `DKIM-Signature` is present and `dkim=pass` appears in `Authentication-Results`.

### 9.8 Production KMS key, source-profile, and runtime role

Mirror Path H §8.6 through §8.9 with production-scoped names. Execute each Path H step against the production AWS account, substituting per the table in §9.2.

Terraform: create a `terraform/production/` directory structurally mirroring `terraform/staging/` if one does not yet exist. Reuse all modules and resource shapes; change the `prefix` local and account/region as appropriate.

Exercise the source-profile → runtime-role chain locally with `aws sts get-caller-identity` before proceeding to §9.9.

### 9.9 Production SES sender identity and IAM pin

Mirror Path H §8.8 and §8.9 against the production identity.

1. Confirm `noreply@footbag.org` is deliverable via Cloudflare Email Routing (§9.5).
2. Verify the sender identity in SES (email identity, distinct from the domain identity in §9.7): add and confirm the verification link at the operator inbox.
3. Amend the `OutboundEmail` statement on the production runtime role's inline policy so `Resource` is the ARN of the `noreply@footbag.org` identity (`arn:aws:ses:us-east-1:<account-id>:identity/noreply@footbag.org`). If §9.7 is already complete, point to the domain identity ARN for broader sender flexibility; the app still pins the From address via `SES_FROM_IDENTITY`.
4. `terraform apply`.

### 9.10 SES bounce/complaint webhook subscription

Bounce and complaint rates determine SES sender reputation. Uncontrolled bounces get production access revoked. Subscribe an SNS topic to SES bounce and complaint notifications, and surface the events to the application's suppression list.

1. Create the SNS topic in `terraform/production/sns.tf`:

   ```hcl
   resource "aws_sns_topic" "ses_feedback" {
     name = "${local.prefix}-ses-feedback"
   }
   ```

2. In SES → Identities → `footbag.org` (or the email identity) → Notifications, set:
   - Bounce notifications: the `ses_feedback` topic.
   - Complaint notifications: the `ses_feedback` topic.
   - (Delivery notifications: optional; noisy.)
   - Include original headers: enabled.
   - Disable email feedback forwarding. With SNS enabled, SES will not also send bounce emails to the From address.

3. Choose a consumer pattern:
   - **Inline HTTPS subscription to the app** (simpler): expose `POST /internal/ses-feedback` with SigV4 signature validation and an SNS HTTPS subscription through CloudFront.
   - **Staged consumer via SQS** (more durable): an SQS queue subscribed to the SNS topic; a worker process drains the queue and updates the suppression list. Survives app restarts without losing events.

   Pick one and record the choice in operator notes.

4. Application handler (regardless of pattern):
   - Parse the SNS message payload per AWS's SES notification format.
   - For `Bounce` with `bounceType=Permanent`: mark the recipient as hard-bounced (`members.email_bounced_at` or equivalent suppression column); future sends are skipped.
   - For `Complaint`: mark the recipient as complained; suppress all future sends and surface to admin review.
   - Append an audit event for each action.

5. Validate end-to-end by sending to AWS's bounce simulator:

   ```bash
   aws ses send-email \
     --from noreply@footbag.org \
     --destination ToAddresses=bounce@simulator.amazonses.com \
     --message 'Subject={Data="test"},Body={Text={Data="test"}}' \
     --region us-east-1
   ```

   Confirm the SNS topic receives the bounce event (via CloudWatch logs or a temporary operator-email subscription) and confirm the suppression row is written for the simulated recipient.

### 9.11 Host credential wiring on the production Lightsail instance

Mirror Path H §8.10 against the production host.

1. Write `/root/.aws/credentials` and `/root/.aws/config` on the production host with production source-profile credentials (from §9.8) and the production runtime-role ARN.
2. Update `/srv/footbag/env` on production with:
   - `JWT_SIGNER=kms`
   - `JWT_KMS_KEY_ID=alias/footbag-production-jwt`
   - `SES_ADAPTER=live`
   - `SES_FROM_IDENTITY=noreply@footbag.org`
   - `AWS_REGION=us-east-1`
   - `AWS_PROFILE=footbag-production-runtime`
   - `SESSION_SECRET` set to a fresh production value (min 32 chars, never the staging value, never `changeme`).
3. Update the compose file on the production host to mount `/root/.aws` read-only per Path H §8.10.
4. Restart the app.

### 9.12 Post-setup validation

Mirror Path H §8.11 against production.

1. Verify the source-profile → runtime-role chain from the host:

   ```bash
   ssh footbag-production
   sudo -u root aws sts get-caller-identity
   ```

   Expect the production runtime role ARN.

2. Exercise the KMS signing path: issue a login against production and inspect the resulting `footbag_session` cookie's JWT `kid` header to confirm it matches the production KMS key ID.

3. Exercise the SES path: trigger a registration flow and confirm the verification email arrives at a test inbox with DKIM signature present.

4. Exercise the bounce path: send to `bounce@simulator.amazonses.com` via the outbox and confirm the suppression row is written (§9.10 step 5).

5. Run `tests/smoke/staging-readiness.test.ts` adapted against production, if a production smoke-readiness test exists.

6. Record in operator notes: production activation date, operator who performed the cutover, KMS key ID, SES production-access approval ticket ID, validated sender identity.

Path I is complete when all five validation steps pass. Production activation is now the canonical state; `docs/DEVOPS_GUIDE.md` covers routine operations from this point.

---

## 10. Appendices

### 10.1 Troubleshooting reference

#### Local newcomer setup mistakes

- WSL not installed, or the distro is not actually running in WSL 2 mode (`wsl.exe -l -v` to check)
- repo cloned under `/mnt/c/...` instead of the Linux filesystem
- `which node` resolves to the Windows binary under `/mnt/c/...`
- running `source ~/.nvm/nvm.sh` before restarting the terminal after nvm install — `nvm` will not be found; close and reopen the terminal first
- Node version drift breaks native addon builds (`better-sqlite3` requires Node 22 for the documented baseline)
- `sqlite3` CLI missing — `sudo apt install -y sqlite3`
- `.env` missing or `FOOTBAG_DB_PATH` wrong
- Docker Desktop installed on Windows but WSL integration not enabled for the Ubuntu distro
- `docker` command works in Windows but not in the Ubuntu shell
- the old standalone `docker-compose` v1 tool confused with the `docker compose` v2 plugin
- AWS CLI, Terraform, SSH, or `rsync` never installed in WSL — run the tooling gate from §4.2 to confirm
- shell scripts fail with `^M` because repo was cloned or edited outside WSL (CRLF issue)
- `ModuleNotFoundError: No module named 'apt_pkg'` on any command or after `apt-get update` — broken `command-not-found` handler; fix with `sudo apt-get install --reinstall python3-apt`; the `apt-get update` error is a harmless post-hook and can be ignored

#### Route and runtime mistakes

- public statuses leak non-public events
- `/events/year/:year` gets shadowed by `/events/:eventKey` — register the year route first
- historical no-results events hidden instead of rendered clearly
- controllers own business rules that belong in services
- templates own business logic that belongs in services
- `dotenv` loads too late and `FOOTBAG_DB_PATH` is empty when `db.ts` initializes — `import 'dotenv/config'` must be the first import in `server.ts`

#### Docker parity mistakes

- Docker parity skipped entirely before AWS work
- nginx not fronting the web container correctly
- DB mount path wrong
- `docker compose pull` used instead of `docker compose build` — no registry yet; images are built locally (accepted temporary deviation)

#### AWS/bootstrap mistakes

- continuing to use root after bootstrap
- creating or keeping root access keys
- leaving `footbag-operator` without MFA
- `export AWS_PROFILE=footbag-operator` not re-run after opening a new terminal — all Terraform and AWS CLI commands will use wrong credentials
- assuming runtime AWS credentials are optional; they are now required for KMS (JWT signing) and SES (transactional email); see Path H for activation and §4.5 "Lightsail runtime identity model" for the rationale
- assuming Lightsail gives you an EC2 instance-profile story identical to EC2 — it does not
- leaving SSH broadly exposed — verify `operator_cidrs` is set to real CIDRs before first apply (see §4.4 correction 2)
- forgetting to install `rsync` on the Lightsail host before running the rsync deployment step in §4.7
- updating Parameter Store and expecting the running app to change without also updating `/srv/footbag/env`
- copying files directly into the root-owned `/srv/footbag` without using a staging path and sudo promotion
- mixing staging and production state in the same Terraform path
- creating Terraform state storage without versioning or encryption
- relying on old Terraform DynamoDB locking patterns — this project uses `use_lockfile = true` (S3 native locking, requires `>= 1.11`)
- assuming `user_data` bootstraps the instance — it is intentionally omitted; all Docker install is manual via SSH (see §4.7)
- using raw IP as the CloudFront origin — CloudFront custom origins require a resolvable DNS hostname, not a raw IP
- assuming Lightsail provides a public DNS hostname like EC2 does —
  `aws lightsail get-instance --query 'instance.publicDnsName'` always
  returns `None`; construct the CloudFront origin hostname from the static
  IP Terraform output using nip.io for staging (see §4.6 step 4)
- naming the Lightsail static IP and instance the same — Lightsail rejects
  instance creation with "Some names are already in use" because static IPs
  and instances share a single namespace; `lightsail.tf` uses distinct names
  (`footbag-staging-web-ip` for the static IP, `footbag-staging-web` for
  the instance); do not change these to match
- skipping or mis-sequencing the two-pass CloudFront bootstrap
- running `sudo dnf install -y docker-compose-plugin` without first adding the Docker CE repo — the package is not in Amazon Linux 2023 default repos
- running `docker compose pull` instead of `docker compose build` when using locally built images
- SSH to the Lightsail instance timing out despite correct `operator_cidrs` and a running instance — some ISPs block outbound port 22 to AWS EC2 IP ranges; use `-p 2222` and the Lightsail browser SSH console to configure sshd if needed (see §4.4 note and §4.7 step 1)
- Claude Code hooks failing with a PreToolUse hook error on every Bash call — `jq` is required by the hook scripts; install with `sudo apt-get install -y jq`

### 10.2 Deterministic seed-data reference

These seeded routes are useful for local browser verification and integration tests. The deploy smoke check does not rely on them.


| Route                             | What it proves                               |
| --------------------------------- | -------------------------------------------- |
| /events/event_2025_beaver_open    | completed public event with results          |
| /events/event_2025_quiet_open     | completed public event with no results yet   |
| /events/event_2026_spring_classic | upcoming public event                        |
| /events/event_2026_draft_event    | draft event remains non-public; expected 404 |
| /events/event_9999_does_not_exist | unknown key returns 404                      |
| /events/year/1899                 | empty year still renders cleanly             |


These are reference checks, not the main onboarding story.

### 10.3 Smoke-check contract

`scripts/smoke-local.sh` is the canonical smoke-check baseline. All checks must be data-independent so the script runs against any staging DB without seed data. It should verify at least:

- `/health/live`
- `/health/ready`
- `/events`
- `/events/year/2025`
- one empty year page (year guaranteed to have no events, e.g. `/events/year/1899`)
- one non-public event returning 404
- one missing key returning 404
- one badly formatted key returning 404

Why this matters:

- it checks the documented public contract, not just “server responds”
- it keeps deterministic seeded scenarios from drifting silently
- it can be reused locally, in Docker parity mode, against the origin, and through CloudFront by changing `BASE_URL`

A `smoke-public.sh` script has not yet been created for this slice.

### 10.4 Authoritative project facts preserved by this guide

This guide preserves these project constraints:

- Express + Handlebars + TypeScript, server-rendered
- one SQLite DB module
- prepared statements prepared once
- thin controllers
- services own page shaping
- no ORM
- no repository layer
- canonical GET /events/:eventKey public route
- non-paginated whole-year archive page
- explicit no-results rendering for historical events with no result rows
- minimal readiness semantics (DB-only)
- Lightsail origin behind CloudFront
- /srv/footbag/env as the live runtime config source in non-local deployments
- Parameter Store as optional AWS-side reference storage, not the runtime source of truth
- hardened per-operator SSH for host access
- manual bootstrap only until Terraform authority is established

### 10.5 Official references

#### Windows / WSL

- [Microsoft Learn — Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install)

#### Git / GitHub

- [GitHub Docs — Cloning a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository)
- [Git — `git clone` documentation](https://git-scm.com/docs/git-clone)

#### AWS

- [AWS CLI install](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [AWS CLI quickstart](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-quickstart.html)
- [IAM Identity Center with AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [aws configure sso](https://docs.aws.amazon.com/cli/latest/reference/configure/sso.html)
- [Root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)
- [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Lightsail SSH keys and connection overview](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-ssh-in-amazon-lightsail.html)
- [Set up SSH keys for Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-ssh.html)
- [Lightsail firewall and port rules](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail)
- [Lightsail IAM / security overview](https://docs.aws.amazon.com/lightsail/latest/userguide/security_iam.html)
- [Lightsail instance creation](https://docs.aws.amazon.com/lightsail/latest/userguide/how-to-create-amazon-lightsail-instance-virtual-private-server-vps.html)
- [Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [SecureString and KMS](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html)
- [Parameter Store IAM access](https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-access.html)
- [CloudFront origin settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html)
- [CloudFront custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
- [CloudFront custom origin headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)
- [CloudFront custom error responses](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html)
- [CloudFront error-page procedure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-procedure.html)

#### Terraform

- [Install Terraform](https://developer.hashicorp.com/terraform/install)
- [Install tutorial](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli)
- [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)
- [State workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces)
- [CLI workspace overview](https://developer.hashicorp.com/terraform/cli/workspaces)
- [Resource targeting warning / guidance](https://developer.hashicorp.com/terraform/tutorials/state/resource-targeting)

#### Docker

- [Docker Desktop on WSL 2](https://docs.docker.com/desktop/features/wsl/)
- [Docker WSL best practices](https://docs.docker.com/desktop/features/wsl/best-practices/)
- [Docker Compose install overview](https://docs.docker.com/compose/install/)
- [Docker Compose plugin install on Linux](https://docs.docker.com/compose/install/linux/)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)

#### Node / npm

- [Node downloads](https://nodejs.org/en/download)
- [Node release status](https://nodejs.org/en/about/previous-releases)
- [npm install guidance](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/)

#### Cursor and Claude Code

- [Cursor downloads](https://cursor.com/docs/downloads)
- [Cursor docs home](https://cursor.com/docs)
- [Cursor quickstart](https://cursor.com/docs/get-started/quickstart)
- [Cursor rules](https://cursor.com/docs/context/rules)
- [Claude Code quickstart](https://docs.anthropic.com/en/docs/claude-code/quickstart)
- [Claude Code setup](https://docs.anthropic.com/en/docs/claude-code/setup)
- [Claude Code overview](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- [Claude Code common workflows](https://docs.anthropic.com/en/docs/claude-code/common-workflows)
- [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory)

