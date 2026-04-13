# Footbag Website Modernization Project —  Developer Onboarding Guide

**Last updated:** March 29, 2026

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
- [8. Appendices](#8-appendices)
  - [8.1 Troubleshooting reference](#81-troubleshooting-reference)
  - [8.2 Deterministic seed-data reference](#82-deterministic-seed-data-reference)
  - [8.3 Smoke-check contract](#83-smoke-check-contract)
  - [8.4 Authoritative project facts preserved by this guide](#84-authoritative-project-facts-preserved-by-this-guide)
  - [8.5 Official references](#85-official-references)

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

For the active slice, accepted deviations, and current route list, see `IMPLEMENTATION_PLAN.md`. Bootstrap shortcuts documented in this guide are the authoritative source for those accepted deviations.

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

For the current public slice:

- `footbag-operator` is the human AWS/Terraform identity
- the running app serves pages from process env plus SQLite
- the slice does not require runtime AWS API calls

Do not mount your human AWS CLI profile into containers.
Do not invent runtime IAM plumbing the current slice does not use.

Also note: Lightsail does not support EC2 instance profiles. Any instance-profile-shaped resources in Terraform are deferred groundwork, not minimum runtime bootstrap.

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
sudo tee /srv/footbag/env > /dev/null <<EOF
NODE_ENV=production
LOG_LEVEL=info
FOOTBAG_DB_PATH=/srv/footbag/footbag.db
PUBLIC_BASE_URL=https://<cloudfront_domain from terraform output>
EOF
sudo chown root:root /srv/footbag/env
sudo chmod 600 /srv/footbag/env
```

Required values in this minimum deployment:

- `NODE_ENV`
- `LOG_LEVEL`
- `FOOTBAG_DB_PATH`
- `PUBLIC_BASE_URL`

Do not add runtime AWS credentials for the current public slice. They are not needed.

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
sudo sqlite3 /srv/footbag/footbag.db < /srv/footbag/database/schema.sql
```

To load seed data (run the seed pipeline from the repo root):

```bash
bash scripts/reset-local-db.sh
```

Then lock down the DB file:

```bash
sudo chown root:root /srv/footbag/footbag.db
sudo chmod 600 /srv/footbag/footbag.db
```

On later deploys, reuse the existing DB file.

> [!NOTE]
> **Runtime user note:**
>
> If the web container runs as root and systemd runs as root, the bind-mounted root-owned SQLite file and any WAL/SHM sidecar files are writable as deployed. If you later add a non-root `USER` to the Dockerfile, update host ownership and modes on `/srv/footbag/` and `/srv/footbag/footbag.db` to match.

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
- runtime AWS credentials are still absent because the slice does not need them
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
- you are working from `IMPLEMENTATION_PLAN.md`
- you are planning legacy-data migration, member import, account-claim, or password-reset work
- you are doing refactor planning, sequencing analysis, or "what should we build next?" work

Skip Plan Mode when the change is small, obvious, and describable in one sentence.

How to use it:

- In an active Claude Code session, press `Shift+Tab` until `plan mode on` appears.
- Or type `/plan mode` in the Claude Code prompt.

Recommended prompt pattern for this repo:

- Tell Claude to read `IMPLEMENTATION_PLAN.md`, `CLAUDE.md`, the nearest local `CLAUDE.md`, and the likely touched code and tests first.
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
- `PUBLIC_BASE_URL`
- `SESSION_SECRET`

`docker/docker-compose.prod.yml` bind-mounts `${FOOTBAG_DB_PATH}` into `/app/footbag.db`, and `footbag.service` starts Docker Compose with `--env-file /srv/footbag/env`. If the env file is wrong, the deploy can succeed mechanically but still fail at runtime.

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

Update `AWS_PROJECT_SPECIFICS.md` (local only, gitignored):

- Section 5: update tfvars values (`enable_cloudfront = true`, `lightsail_origin_dns`)
- Section 6: add `aws_cloudfront_distribution.main` to resources in state
- Section 6 outputs table: fill in `cloudfront_domain` and `cloudfront_distribution_id`
- Section 8: update status from "NOT YET CREATED" to "ACTIVE" with the domain
- Section 13: move CloudFront pass 2 from "Still outstanding" to "Complete"

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

After CloudFront is active and validated, continue with:

- attach the final custom domain and ACM certificate
- add Route 53 records
- update `PUBLIC_BASE_URL` to the final public URL
- implement origin-bypass protection and maintenance path:
  - generate a shared secret: `openssl rand -hex 32`
  - add the secret as a `custom_header` (`X-Origin-Verify`) on the CloudFront origin in `cloudfront.tf`
  - add the secret to `/srv/footbag/env` on the host (Lightsail cannot use SSM at runtime; the env file is the runtime source of truth)
  - optionally store a copy in SSM at `/footbag/staging/secrets/origin_verify_secret` for reference only
  - enforce the header in `docker/nginx/nginx.conf`: reject requests that lack the correct `X-Origin-Verify` value (blocks direct-to-origin bypass)
  - S3-hosted maintenance page with CloudFront Origin Access Control (OAC)
  - `ordered_cache_behavior` for `/maintenance.html` routing to the S3 origin

Until that is complete, do not rely on the maintenance page as a graceful-downtime path.

### 7.3 GitHub and operator governance hardening

Initial CI now exists, but the governance around it still needs to be closed.

Remaining work:

- verify the current GitHub Actions checks from real PR runs
- configure branch protection on `main`
- require the current CI checks:
  - `Type-check and test`
  - `Terraform fmt / validate`
- require branches to be up to date before merge
- scope down `footbag-operator` from `AdministratorAccess` to a least-privilege policy covering only the services actually used: Lightsail, CloudFront, S3 (state bucket and project buckets), SSM, KMS, SNS, CloudWatch, and IAM (for its own key rotation)
- remove long-lived access keys after a short-lived or IAM Identity Center path is in place
- retire `ec2-user` once the named operator account is fully validated
- consider disabling Lightsail browser SSH after normal operator access is confirmed

### 7.4 Reliability and recovery

The staging deploy workflow exists, but durable recovery still does not.

Remaining work:

- add host-side SQLite backups using SQLite's online backup mechanism
- use dedicated backup credentials scoped only to the backup bucket
- schedule backups with cron or a systemd timer
- rehearse a full restore in staging
- document exact restore commands and timing in a restore runbook

Concrete backup command (run on the host as root):

```bash
sqlite3 "$FOOTBAG_DB_PATH" ".backup /tmp/footbag-backup-$(date +%Y%m%dT%H%M%S).db"
aws s3 cp /tmp/footbag-backup-*.db s3://<backup-bucket>/backups/
```

Concrete restore drill (rehearse this in staging before any migration work):

1. Stop the service: `sudo systemctl stop footbag`
2. Copy the backup down from S3: `aws s3 cp s3://<backup-bucket>/backups/<filename>.db /tmp/restore.db`
3. Verify the backup: `sqlite3 /tmp/restore.db 'PRAGMA integrity_check;'`
4. Replace the live DB: `sudo install -o root -g root -m 600 /tmp/restore.db "$FOOTBAG_DB_PATH"`
5. Restart the service: `sudo systemctl start footbag`
6. Run the smoke check: `BASE_URL=http://<host-ip> bash scripts/smoke-local.sh`

The goal here is to move from "we can redeploy" to "we can recover." Completing this section is also a prerequisite for implementing `scripts/deploy-migrate.sh`.

### 7.5 Runtime configuration maturity

The current runtime contract is still intentionally simple.

Remaining work:

- keep `/srv/footbag/env` as the current runtime source of truth for now
- decide when manual host edits become too fragile
- if needed later, add a helper that materializes `/srv/footbag/env` from Parameter Store
- keep local `.env`, host `/srv/footbag/env`, and optional AWS-side reference storage clearly distinct
- only add runtime AWS credentials if the application actually begins using AWS APIs at runtime

### 7.6 Monitoring maturity

Some monitoring exists in concept, but the full loop is not yet closed.

Remaining work:

- keep the CloudFront 5xx alarm active once CloudFront is in use
- enable CWAgent CPU/memory alarms only after CWAgent actually exists on the host
- add backup freshness metrics only after the backup job is real
- emit `BackupAgeMinutes` after each successful backup
- verify that SNS alert delivery reaches the operator
- document the minimal operator dashboard and health-check locations

### 7.7 Delivery maturity beyond on-host builds

The current deploy scripts still rely on on-host image builds.

Remaining work:

- move image builds into CI
- publish images to a registry such as ECR
- change the host deploy path from `docker compose build` to `docker compose pull`
- keep the deploy scripts aligned with that future registry-backed flow

This is the natural handoff point from onboarding into the longer-lived operational guidance in `docs/DEVOPS_GUIDE.md`.

---

## 8. Appendices

### 8.1 Troubleshooting reference

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
- assuming the current public slice needs runtime AWS credentials when it does not (the app reads `process.env` and SQLite only)
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

### 8.2 Deterministic seed-data reference

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

### 8.3 Smoke-check contract

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

### 8.4 Authoritative project facts preserved by this guide

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
- minimal readiness semantics (DB-only; accepted temporary deviation — see IMPLEMENTATION_PLAN.md)
- Lightsail origin behind CloudFront
- /srv/footbag/env as the live runtime config source in non-local deployments
- Parameter Store as optional AWS-side reference storage, not the runtime source of truth
- hardened per-operator SSH for host access
- manual bootstrap only until Terraform authority is established

### 8.5 Official references

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

