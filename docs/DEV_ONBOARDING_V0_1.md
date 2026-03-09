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

## Quick start — codebase already exists

If you are cloning a repository that already has a working implementation, skip Parts C–E and use this five-step path instead:

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.example .env
# Edit .env — at minimum confirm FOOTBAG_DB_PATH=./database/footbag.db

# 3. Bootstrap the local database (requires sqlite3 CLI — see §13.3)
./scripts/reset-local-db.sh

# 4. Start the dev server
npm run dev
# → http://localhost:3000/events

# 5. Run the integration test suite
npm test
```

All five routes should respond correctly. Continue to Part F for AWS/Terraform bootstrap.

---

# Part A — Orientation and project understanding

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
- **AWS Systems Manager Parameter Store** for environment config and secrets in non-local environments
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

### Mode 1 — fast host-run development
Use this when you want the fastest edit-run-debug loop in WSL Ubuntu.

Typical shape:

- run Node directly in WSL
- use the local SQLite file
- render the public slice quickly
- debug controllers, services, templates, and SQL without rebuilding containers every minute

### Mode 2 — Docker parity mode
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
Used for **staging and production configuration** and **secrets**.

You should think of it as the source for environment values that must not live in the repository and should not be hand-edited in random places on the server.

### SSH
Used for **exceptional operator shell access** on the Lightsail host.

The project standard is:

- do not treat the Lightsail host like a hand-maintained pet box
- do use named non-root operator accounts with `sudo`
- do use separate SSH key pairs per System Administrator
- do restrict port 22 to approved operator source IPs or CIDR ranges
- do keep host shell access for deployment, restore, patching, and incident diagnostics rather than everyday browser/app administration
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

# Part B — MVFP v0.1 slice explanation

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

---

# Part C — Developer environment and tools

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

### Step 1 — read authority docs first
Before generating code, read:

- `USER_STORIES_V0_1.md`
- `VIEW_CATALOG_V0_1.md`
- `SERVICE_CATALOG_V0_1.md`
- `DESIGN_DECISIONS_V0_1.md`
- `schema_v0_1.sql`

Optionally also read `DATA_MODEL_V0_1.md` when working on SQLite runtime behavior.

### Step 2 — ask for one small batch at a time
Good batch prompts:

- “Create the repository skeleton, package.json, tsconfig, and baseline scripts only.”
- “Create only the db module and prepared statement catalog for public event read paths.”
- “Create only the EventService public read methods and tests.”
- “Create only the Handlebars templates and minimal controllers for the three public routes.”

Bad batch prompt:

- “Build the entire app, Docker, Terraform, and AWS deployment in one go.”

### Step 3 — review the diff yourself
Check for forbidden inventions:

- ORM
- repository layer
- alternate event routes
- `event_slug` column
- template business logic
- controller-owned visibility rules
- async work inside SQLite transactions

### Step 4 — run tests and smoke checks
After each batch:

- run the tests that exist
- run or repeat the local smoke checks
- verify the rendered behavior manually

### Step 5 — keep ownership boundaries clear
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

# Part D — Local project bootstrap

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
│  │  └─ statements.ts
│  ├─ routes/
│  │  └─ publicRoutes.ts
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
Use Parameter Store for staging and production:

- secret values
- environment-specific public base URLs
- runtime feature flags
- operational config that should not be hand-edited on the host

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

# Part E — Implementation order and artifact plan

## 24. Build in this order

This order is deliberate. Follow it.

## Batch 1 — repository skeleton and toolchain
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

## Batch 2 — app bootstrap
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

## Batch 3 — database bootstrap and seed path
Create:

- `database/schema_v0_1.sql` copy-in
- `database/seeds/seed_mvfp_v0_1.sql`
- `scripts/reset-local-db.sh`
- `src/db/db.ts`
- `src/db/statements.ts`

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

## Batch 4 — EventService public read models
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

## Batch 5 — controllers, routes, and templates
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

## Batch 6 — integration tests and smoke scripts
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

## Batch 7 — Docker parity artifacts
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

## Batch 8 — Terraform and ops artifacts
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

| File | Purpose |
|---|---|
| `src/app.ts` | Express app construction, view engine, middleware, route registration |
| `src/server.ts` | process startup and shutdown |
| `src/config/env.ts` | environment loading and validation |
| `src/config/logger.ts` | structured logging |
| `src/db/db.ts` | one SQLite connection module, PRAGMAs, transaction helper |
| `src/db/statements.ts` | prepared statement catalog |
| `src/services/EventService.ts` | public events browse/detail business rules and page shaping |
| `src/controllers/eventsController.ts` | route-to-service rendering bridge |
| `src/controllers/healthController.ts` | liveness/readiness JSON handlers |
| `src/routes/publicRoutes.ts` | public route wiring |
| `src/views/events/*.hbs` | server-rendered public HTML templates |
| `database/seeds/seed_mvfp_v0_1.sql` | deterministic local seed scenarios |
| `scripts/reset-local-db.sh` | local DB rebuild |
| `scripts/smoke-local.sh` | local smoke checks |
| `docker/web/Dockerfile` | web runtime image |
| `docker/worker/Dockerfile` | worker runtime image |
| `docker/nginx/nginx.conf` | reverse proxy config |
| `docker/docker-compose.yml` | local parity stack |
| `docker/docker-compose.prod.yml` | deployment overrides |
| `ops/systemd/footbag.service` | production compose wrapper |
| `terraform/*` | environment infrastructure definitions |

---

# Part F — AWS bootstrap and Terraform handoff

## 26. The bootstrap principle

A blank AWS account cannot be fully “Terraformed from nothing” without a little initial setup. This guide therefore uses a two-phase model:

### Phase 1 — one-time human bootstrap
Do the minimum manual work needed to:

- secure the account
- establish a named human operator identity
- install and verify local AWS tooling
- create the Terraform remote-state foundation
- prepare Terraform authority handoff

### Phase 2 — Terraform-owned steady state
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

Immediately after creating the AWS account:

1. sign in as root
2. set a strong unique password
3. enable MFA on the root user
4. do **not** create root access keys
5. use the root user only for root-only tasks

Then stop using root for routine work.

That is the project’s baseline posture.

---

## 28. Create the first named human operator identity

You need a human identity for normal administrative work.

### Preferred model
If you already have AWS Organizations / IAM Identity Center available, use it and configure the AWS CLI with `aws configure sso`.

### Acceptable single-account bootstrap fallback
If you are starting from a plain single account with no organizational identity layer yet, create a **named bootstrap administrator identity** for yourself only:

- not shared
- MFA-protected
- used for account preparation and Terraform handoff
- not embedded into application runtime

This guide supports both patterns because blank-account reality varies. What the project forbids is **shared** AWS user identities and shared shell access.

### Verify local CLI identity
After configuring a profile, run:

```bash
aws sts get-caller-identity --profile footbag-admin
```

If you are using IAM Identity Center, first log in:

```bash
aws sso login --profile footbag-admin
aws sts get-caller-identity --profile footbag-admin
```

---

## 29. Configure AWS CLI profiles deliberately

Use explicit profiles from the start.

A good starting convention is:

- `footbag-admin` — human operator profile
- `footbag-staging-web` — runtime web profile on the host
- `footbag-staging-worker` — runtime worker profile on the host
- `footbag-production-web`
- `footbag-production-worker`

You may begin with one app runtime role if necessary, but separate web and worker roles are the stronger end state.

### Human profile
Used for:

- Terraform
- one-time bootstrap actions
- operator troubleshooting
- AWS-side tasks that support the documented SSH host-access posture

### Runtime profiles
Used by the deployed services inside containers for AWS API access.

Do **not** mount or use your human profile inside application containers.

---

## 30. Create the Terraform remote-state foundation

Before the main Terraform stack can own steady-state resources, create the remote-state bucket.

You can do this in the console or with the CLI. CLI example:

```bash
export AWS_PROFILE=footbag-admin
export AWS_REGION=us-east-1
export STATE_BUCKET=footbag-terraform-state-<unique-suffix>
```

For most regions:

```bash
aws s3api create-bucket \
  --bucket "$STATE_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
```

For `us-east-1`, omit the `--create-bucket-configuration` flag.

Then enable versioning:

```bash
aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
```

Then enable default encryption:

```bash
aws s3api put-bucket-encryption \
  --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }'
```

### Why this remains manual at first
This bucket must exist before the rest of the Terraform configuration can safely use it as a backend.

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
- `use_lockfile` is stable in Terraform ≥ 1.11 (experimental in 1.10). Add `required_version = ">= 1.11"` to your root module.
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

This project intentionally does **not** document the runtime as if Lightsail had an EC2 instance profile magically attached to the host.

Instead, the project design is:

- human operator profile is one thing
- runtime AWS role is another thing
- deployed services use an assumed runtime role via the standard AWS shared config / credentials chain
- the source credentials material on the host is root-owned and mounted only where needed

### Why this matters
If you blur these identities, two bad things happen:

1. operators start troubleshooting with the wrong identity
2. containers inherit broader permissions than they need

### Practical host-side shape
On the host, you may end up with root-owned AWS config that looks conceptually like:

```ini
[profile footbag-host-source]
region = us-east-1

[profile footbag-staging-web]
role_arn = arn:aws:iam::<account-id>:role/footbag-staging-web
source_profile = footbag-host-source
region = us-east-1

[profile footbag-staging-worker]
role_arn = arn:aws:iam::<account-id>:role/footbag-staging-worker
source_profile = footbag-host-source
region = us-east-1
```

Containers then receive only the read-only config they need and set `AWS_PROFILE` explicitly.

That is the core human/runtime separation to preserve.

---

# Part G — Parameter Store, Lightsail, CloudFront

## 34. Parameter Store path structure

Use a path structure that makes environment and sensitivity obvious.

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
  --profile footbag-admin
```

```bash
aws ssm put-parameter \
  --name /footbag/staging/secrets/SESSION_SIGNING_KEY_ARN \
  --type SecureString \
  --value arn:aws:kms:... \
  --overwrite \
  --profile footbag-admin
```

```bash
aws ssm get-parameter \
  --name /footbag/staging/secrets/SESSION_SIGNING_KEY_ARN \
  --with-decryption \
  --profile footbag-admin
```

### Local `.env` versus Parameter Store
Use local `.env` in development. Use Parameter Store in staging and production. Do not turn production configuration into handwritten `.env` files copied between hosts.

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
- Docker / Docker Compose runtime
- mounted SQLite file location
- root-owned AWS runtime config material
- service wrapper for starting the compose stack
- documented named operator accounts and public-key installation path
- minimal deployment scripts

### What should not live on the host as ad hoc sprawl
- random copies of secrets
- unversioned deployment commands
- unexplained manual edits to container config

---

## 36. SSH setup and normal usage

This project’s design requires you to think about Lightsail host access in **named operator account + per-operator SSH key** terms, not managed-node / hybrid-activation terms.

### Why this matters
The project still separates the human operator path from the application runtime AWS principal, but does not require Session Manager on the Lightsail host.

### Practical setup flow

1. generate a separate SSH key pair for each System Administrator
2. keep the private key with the individual operator; distribute only the public key
3. create or enable the named non-root host account that the operator will use
4. install the approved public key for that account
5. restrict Lightsail port 22 to the operator’s approved source IP or CIDR
6. verify SSH login and `sudo`
7. record the operator name, host account, fingerprint, environments, and approval details in the host-access inventory
8. use SSH only for documented operational tasks

### Verify access
From your operator machine: ssh operator-user at host-or-static-ip

### Project rule
Use named-account SSH for documented host-admin work. Do not share private keys, do not use shared shell accounts, and do not leave SSH broadly exposed.

### Rationale
This removes the managed-node tutorial path and replaces it with the actual host-access model.

---

## 37. CloudFront in front of the Lightsail origin

CloudFront’s job in this project is to front the single origin cleanly.

> **ACM certificate region requirement.** The ACM certificate attached to a CloudFront distribution must be provisioned in `us-east-1` regardless of where your origin or other resources live. Provisioning it in any other region will produce a confusing "Certificate not found" error when associating it with the distribution. In Terraform, use a provider alias (`aws.us_east_1`) for the `aws_acm_certificate` resource.

At minimum, the distribution should:

- point at the Lightsail origin
- forward the headers/cookies/query behavior the app actually needs
- support public delivery of the site
- provide a clean place to define custom error responses

### Maintenance and safe-failure posture
For early phases, keep this simple:

- return friendly maintenance/error pages for origin 502/503/504 conditions
- use short error caching TTLs so recovery is not hidden behind long cache retention
- keep the maintenance behavior obvious and documented

You do not need an elaborate “maintenance platform” to stand up the first slice.

---

## 38. Origin validation and public validation

When the stack is deployed, verify both layers.

### Origin validation
Confirm the application is healthy on the origin host:

- service is running
- nginx is routing
- web container is healthy
- `/health/live` returns success
- `/health/ready` returns success

### Public validation
Then confirm the public path through CloudFront:

- `/events` loads
- one year archive loads
- one canonical event page loads
- no-results state behaves correctly
- non-public event route returns not found
- public HTML and styling are correct
- no stack traces or internal details leak

---

# Part H — Verification, troubleshooting, deferred work

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
- confusing the human operator profile with the app runtime role
- assuming Lightsail gives you an EC2 instance-profile story identical to EC2
- leaving SSH broadly exposed instead of restricting it to approved operator IPs and named accounts
- hand-editing production config instead of using Parameter Store
- mixing staging and production state in the same Terraform path
- creating Terraform state storage without versioning or encryption
- relying on old Terraform DynamoDB locking patterns in a new setup

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
- a named human operator identity exists
- AWS CLI and SSH are working
- Terraform remote state exists
- Terraform configuration validates

### First public deployment success
- Lightsail origin is up
- CloudFront fronts it
- public routes work through the public URL
- SSH access works for the host
- runtime AWS profile separation is documented and applied
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

## 46. Human / engineer / AI handoff boundaries

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
- runtime credentials model
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

# Appendix A — Current official references used to verify this guide

## AWS
- AWS CLI install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- AWS CLI quickstart: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-quickstart.html
- IAM Identity Center with AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html
- `aws configure sso`: https://docs.aws.amazon.com/cli/latest/reference/configure/sso.html
- Root user best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html
- IAM best practices: https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- Lightsail SSH keys and connection overview: https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-ssh-in-amazon-lightsail.html
- Set up SSH keys for Lightsail: https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-how-to-set-up-ssh.html
- Lightsail firewall and port rules: https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.
- Parameter Store: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
- SecureString and KMS: https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html
- Parameter Store IAM access: https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-access.html
- Lightsail instance creation: https://docs.aws.amazon.com/lightsail/latest/userguide/how-to-create-amazon-lightsail-instance-virtual-private-server-vps.html
- CloudFront custom error responses: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/GeneratingCustomErrorResponses.html
- CloudFront error-page procedure: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-procedure.html

## Terraform
- Install Terraform: https://developer.hashicorp.com/terraform/install
- Install tutorial: https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli
- S3 backend: https://developer.hashicorp.com/terraform/language/backend/s3
- State workspaces: https://developer.hashicorp.com/terraform/language/state/workspaces
- CLI workspace overview: https://developer.hashicorp.com/terraform/cli/workspaces

## Docker
- Docker Desktop on WSL 2: https://docs.docker.com/desktop/features/wsl/
- Docker WSL best practices: https://docs.docker.com/desktop/features/wsl/best-practices/
- Docker “Use WSL”: https://docs.docker.com/desktop/features/wsl/use-wsl/
- Docker Compose install on Linux: https://docs.docker.com/compose/install/linux/
- Docker build best practices: https://docs.docker.com/build/building/best-practices/
- Docker multi-stage builds: https://docs.docker.com/build/building/multi-stage/

## Node / npm
- Node downloads: https://nodejs.org/en/download
- Node release status: https://nodejs.org/en/about/previous-releases
- npm install guidance: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/

## Cursor and Claude Code
- Cursor downloads: https://cursor.com/docs/downloads
- Cursor docs home: https://cursor.com/docs
- Cursor quickstart: https://cursor.com/docs/get-started/quickstart
- Cursor rules: https://cursor.com/docs/context/rules
- Claude Code quickstart: https://docs.anthropic.com/en/docs/claude-code/quickstart
- Claude Code setup: https://docs.anthropic.com/en/docs/claude-code/setup
- Claude Code overview: https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview
- Claude Code common workflows: https://docs.anthropic.com/en/docs/claude-code/common-workflows
- Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings
- Claude Code memory: https://docs.anthropic.com/en/docs/claude-code/memory

---

## Appendix B — Authoritative project facts this guide preserves

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
- Parameter Store for non-local config
- hardened per-operator SSH for operator shell access
- manual bootstrap only until Terraform authority is established
