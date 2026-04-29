# Footbag Website Modernization Project -- Design Decisions

**Document Purpose:**

This document captures technical decisions and rationale so that volunteers can understand why the design is the way it is, what trade-offs were made, and how future changes should be evaluated. Explains why major choices were made and which constraints are intentional. Source of Truth for design commitments from which the technical requirements follow. 

Scoping note: Numeric values in this document may represent fixed technical constants, deployment/infrastructure resource allocations and thresholds, or implementation notes. For Administrator-configurable operational, security, reminder, pricing, and retention values, normative defaults are defined in the User Stories document and loaded via configuration seeds. DD may describe parameterization, ranges, and ownership, but if a value is Administrator-configurable, DD does not define the normative default. Any numeric value in this document that conflicts with the User Stories normative defaults section is an error; User Stories wins.

Current implementation status and accepted temporary deviations are tracked in `IMPLEMENTATION_PLAN.md`. This document is the long-term architecture reference only.

## Table of Contents

- [1. Architectural Foundations](#1-architectural-foundations)
  - [1.1 SQLite Database](#11-sqlite-database)
  - [1.2 Backup Strategy](#12-backup-strategy)
  - [1.3 Transaction Model](#13-transaction-model)
  - [1.4 Development Parity](#14-development-parity)
  - [1.5 Photo Data in S3](#15-photo-data-in-s3)
  - [1.6 Single Lightsail Instance behind CloudFront](#16-single-lightsail-instance-behind-cloudfront)
  - [1.7 Docker Containers](#17-docker-containers)
  - [1.8 Container Memory Allocation](#18-container-memory-allocation)
  - [1.9 Layered Architecture: Controllers, Services, Middleware, Adapters](#19-layered-architecture-controllers-services-middleware-adapters)
  - [1.10 Catalog-governed Page and Service Contracts](#110-catalog-governed-page-and-service-contracts)
  - [1.11 Configuration Model](#111-configuration-model)
  - [1.12 Internal-only Subtrees](#112-internal-only-subtrees)
- [2. Data Model](#2-data-model)
  - [2.1 Schema and Versioning](#21-schema-and-versioning)
  - [2.2 Data Access Pattern](#22-data-access-pattern)
  - [2.3 Soft Deletes](#23-soft-deletes)
    - [Retention policy](#retention-policy)
  - [2.4 Member, Legacy Member, and Historical Person Entity Types](#24-member-legacy-member-and-historical-person-entity-types)
  - [2.5 Immutable Audit Logs with Privacy-safe Fields](#25-immutable-audit-logs-with-privacy-safe-fields)
  - [2.6 Hashtags and Media](#26-hashtags-and-media)
  - [2.7 Encryption at Rest](#27-encryption-at-rest)
- [3. Security, Authentication, and Sessions](#3-security-authentication-and-sessions)
  - [3.1 Password Hashing](#31-password-hashing)
  - [3.2 JWT sessions](#32-jwt-sessions)
  - [3.3 CSRF Protection via SameSite Cookies](#33-csrf-protection-via-samesite-cookies)
  - [3.4 JWT Token Lifecycle and Configuration](#34-jwt-token-lifecycle-and-configuration)
  - [3.5 JWT Signing with AWS KMS Asymmetric Keys](#35-jwt-signing-with-aws-kms-asymmetric-keys)
  - [3.6 Secrets Management via AWS Parameter Store](#36-secrets-management-via-aws-parameter-store)
  - [3.7 Ballot Encryption with AWS KMS](#37-ballot-encryption-with-aws-kms)
  - [3.8 Account Security Tokens](#38-account-security-tokens)
  - [3.9 Security, Privacy, and Historical Record Governance](#39-security-privacy-and-historical-record-governance)
  - [3.10 Trust-proxy strategy](#310-trust-proxy-strategy)
  - [3.11 Origin-verify shared-secret gate](#311-origin-verify-shared-secret-gate)
  - [3.12 Security header layering](#312-security-header-layering)
  - [3.13 Host header pinning at nginx](#313-host-header-pinning-at-nginx)
- [4. Front-End / UI Technology](#4-front-end--ui-technology)
  - [4.1 Server-rendered HTML with Handlebars Templates](#41-server-rendered-html-with-handlebars-templates)
  - [4.2 JavaScript Required for Interactivity](#42-javascript-required-for-interactivity)
  - [4.3 Explicit UI Restrictions](#43-explicit-ui-restrictions)
  - [4.4 Accessible, Responsive HTML-first Design](#44-accessible-responsive-html-first-design)
  - [4.5 Front-end TypeScript for Interactivity](#45-front-end-typescript-for-interactivity)
- [5. Back-End Services and Patterns](#5-back-end-services-and-patterns)
  - [5.1 Node.js with TypeScript](#51-nodejs-with-typescript)
  - [5.2 Express-based HTTP Controllers](#52-express-based-http-controllers)
  - [5.3 Dedicated Adapters for External Services](#53-dedicated-adapters-for-external-services)
  - [5.4 Outbox Pattern for Emails](#54-outbox-pattern-for-emails)
  - [5.5 Canonical Email Addresses](#55-canonical-email-addresses)
  - [5.6 Dev and Staging Email Preview](#56-dev-and-staging-email-preview)
- [6. External Services and Integrations](#6-external-services-and-integrations)
  - [6.1 Stripe Payments](#61-stripe-payments)
  - [6.2 CloudFront CDN](#62-cloudfront-cdn)
  - [6.3 CloudFront Error Pages](#63-cloudfront-error-pages)
  - [6.4 Legacy Archive (old footbag.org)](#64-legacy-archive-old-footbagorg)
  - [6.5 Legacy Data Migration](#65-legacy-data-migration)
  - [6.6 AWS Service Integration](#66-aws-service-integration)
  - [6.7 Static Assets and CDN Strategy](#67-static-assets-and-cdn-strategy)
  - [6.8 Image Processing](#68-image-processing)
  - [6.9 Voting](#69-voting)
- [7. DevOps](#7-devops)
  - [7.1 Dev/Prod Parity](#71-devprod-parity)
  - [7.2 AWS Lightsail and Credentials](#72-aws-lightsail-and-credentials)
  - [7.3 Docker](#73-docker)
  - [7.4 GitHub](#74-github)
  - [7.5 Local Development](#75-local-development)
  - [7.6 Health Endpoints](#76-health-endpoints)
- [8. Logging, Monitoring & Abuse Prevention](#8-logging-monitoring--abuse-prevention)
  - [8.1 Structured Logging](#81-structured-logging)
  - [8.2 Monitoring and Alerting](#82-monitoring-and-alerting)
  - [8.3 Rate Limiting and Abuse Prevention](#83-rate-limiting-and-abuse-prevention)
  - [8.4 Content Moderation Policy](#84-content-moderation-policy)
- [9. Performance, Cost and Scalability](#9-performance-cost-and-scalability)
  - [9.1 Performance Target Architecture](#91-performance-target-architecture)
  - [9.2 Cost Constraints](#92-cost-constraints)
  - [9.3 Scalability](#93-scalability)
  - [9.4 Backup and Recovery](#94-backup-and-recovery)
  - [9.5 Failure Modes](#95-failure-modes)
  - [9.6 Infrastructure as Code](#96-infrastructure-as-code)
  - [9.7 High Availability and Recovery](#97-high-availability-and-recovery)
  - [9.8 Monitoring and Alerting](#98-monitoring-and-alerting)

# 1. Architectural Foundations

## 1.1 SQLite Database

All application state (except photos) are stored in a single SQLite database file (footbag.db). All data access occurs through single database module (db.ts) that exports database connection, prepared SQL statements, and transaction helper. Services call prepared statements directly with parameters (see below for the Data Access Pattern). All statements prepared once at startup for maximum performance. Unless explicitly noted for integrity or tamper-resistance reasons, the database enforces structural integrity while application services enforce workflow and business rules, the goal being to keep the database as simple as possible.

Configuration: the platform uses only 5 startup configuration PRAGMAs. Operational PRAGMAs like wal_checkpoint (used during backups) are executed at runtime and are separate from these 5 startup settings:

- journal_mode=WAL: Write-Ahead Logging for concurrent reads during writes.

- foreign_keys=ON: Enforces referential integrity (prevents orphaned records).

- busy_timeout=5000: Wait 5 seconds when database is locked before timing out.

- synchronous=NORMAL: Safe with WAL mode, provides faster writes.

- cache_size=-64000: Allocates 64MB memory for faster reads.

**Rationale:**

Query Performance: SQL with indexes provides sub-100ms queries vs O(n) file scans. Indexes added reactively when queries exceed 500ms.

Transaction Safety: ACID guarantees replace complex optimistic locking. SQLite serializes transactions automatically.

Data Integrity: Foreign key constraints (ON DELETE NO ACTION) enforced by database. Member grace-period deletion via views prevents accidental exposure of deleted member records.

Simplicity: Single file, 5 PRAGMAs, no cluster, no Litestream sidecar, zero service fees. Inspectable with sqlite3 CLI. One dependency (better-sqlite3).

Operational Simplicity: No database server, no connection pooling, no replication lag. Backup is file upload. Recovery is download + restart (RTO ~5 minutes). Migrations require maintenance window (acceptable for community site).

Cost: \$2/month S3 storage. No RDS, no per-connection charges, no IOPS fees.

Prepared Statement Performance: Statements compiled once at startup eliminates repeated SQL parsing overhead. Official SQLite-recommended pattern. better-sqlite3 auto-resets statements after execution for immediate reuse.

Single Module Organization: All queries visible in one file (~200-500 lines for 50-100 queries). Easy to grep for "WHERE email". Descriptive names enable IDE autocomplete. Manageable for small volunteer team. Repository classes would add value at 500+ queries with large team, but add unnecessary complexity here.

**Trade-offs:**

Single-Writer: One write transaction at a time. Acceptable because expected write volume is low for the community site, read-heavy pages can be served efficiently via caching, and WAL allows unlimited concurrent reads.

SQL Knowledge Required: Volunteers need basic SQL for queries and migrations. Acceptable trade-off for performance and integrity. sqlite3 CLI widely known.

Migrations Require Maintenance: Brief downtime acceptable for community site. Backward-compatible migrations preferred.

Local Database Unencrypted: SQLite file on the instance is unencrypted at rest (S3 backups are encrypted). This is an explicit MVP trade-off for non-regulated data. Mitigations: restrict instance access (SSH/IAM), keep the instance private where feasible, apply OS security updates, limit who can access backups, and rely on encrypted backups and short backup retention.

No Encapsulation: Services access prepared statements directly. Code review catches violations. Acceptable for small volunteer team, risky for large team.

Synchronous Transactions Only: Cannot span async operations. Services must batch database work, commit, then do async. better-sqlite3 design constraint but also best practice for minimizing lock contention.

**Impact:**

Database Module: Single db.ts exports connection with PRAGMAs, prepared statements grouped by domain (members, events, registrations, etc.), transaction helper. Statements ordered: reads, writes, counts. Complex queries include inline SQL comments. Module is ~200-500 lines.

Service Layer: Import db module, call queries.memberByEmail.get(email), wrap multi-step operations in transaction(() =\> {...}). Catch specific error codes, throw meaningful business errors. Never call db.prepare() or write inline SQL.

Schema Design: refer to Data_Model md file.

Minimum Indexes (added when query \>500ms): members(login_email_normalized), members(display_name), events(start_date), events(hashtag), audit_entries(occurred_at), media(member_id), registrations(event_id, member_id).

Monitoring: Query latency P95, slow query log (\>500ms), transaction duration (alert if P95 \>10s), backup success rate and age (alert if \>15 min), database size (alert at 80%), WAL size (alert if \>1GB), checkpoint latency (alert if \>5s), SQLITE_BUSY frequency (alert if \>5%).

Health Endpoints: `/health/live` is a process check. `/health/ready` validates essential dependencies required to serve traffic; broader readiness coverage (backup freshness, memory pressure, dependency fan-out) remains later-phase operational design.

Recovery: Download the selected S3 snapshot, run `PRAGMA integrity_check`, replace the live file, restart services, and verify health plus smoke checks. Target RTO remains approximately five minutes for the common restore case.

Initial schema bootstrap for first public launch comes directly from `schema.sql`. A numbered migration chain is deferred until after the first stable deployed baseline (no migrations in scope).

**Follow-on Decisions:**

Schema Design: Data Model document for design standards, and the schema sql code for exact detail.

Complete Statement Catalog: All prepared statements with SQL, parameters, return types (src/db/db.ts)

S3 Backup Configuration: Retry policy, alert thresholds, recovery drill schedule (DevOps document)

Migration Procedures: SQL conventions, maintenance mode, rollback strategies (DevOps document)

Transaction Boundaries: Which operations require transactions, timeout policies, and temporary-unavailable / busy-handling boundaries (Service Catalog document)

Query Performance: Index selection criteria, profiling procedures, optimization triggers (Data Model and DevOps documents)

Testing Patterns: Test database setup, state isolation, mock strategies (Developer Onboarding document)

**Alternatives Considered:**

JSON Files: Rejected for O(n) query performance, no ACID transactions, no referential integrity, bespoke code instead of using a standard approach.

SQLite + Litestream: Rejected for sidecar complexity, operational overhead. 60-second RPO acceptable for community site.

PostgreSQL on RDS: Rejected for monthly cost, connection management complexity, network latency, DBA knowledge requirement, overkill for community scale.

## 1.2 Backup Strategy

Background worker runs every five minutes: (1) PRAGMA wal_checkpoint(TRUNCATE) commits WAL to main file, (2) SQLite backup API creates consistent snapshot, (3) Upload to S3 with retry (3 attempts, exponential backoff), (4) Update health timestamp. S3 versioning provides 30-day point-in-time recovery.

Transaction timeout: All transactions must complete within 30 seconds, enforced by application code. Code in db.ts wraps transaction execution and throws an error if the timeout is exceeded (defaults to 30000 ms). When timeout occurs, the wrapper executes ROLLBACK explicitly before throwing, ensuring the transaction releases locks immediately. This prevents indefinite database locks and ensures graceful failure for long-running operations.

Container shutdown (SIGTERM): Stop accepting new requests, wait up to 30 seconds for all in-flight transactions to complete (same timeout value for consistency). Any transaction still running after 30 seconds is aborted. Then checkpoint WAL, close connection, perform final S3 backup upload, and exit gracefully.

## 1.3 Transaction Model

ACID transactions provide the platform's core write-safety guarantees, but the application still needs explicit handling for temporary contention. SQLite serializes conflicting writers through the configured busy_timeout, yet under load the app can still receive SQLITE_BUSY or SQLITE_BUSY_TIMEOUT. The platform therefore uses BEGIN IMMEDIATE to acquire the write lock early, keeps write transactions short, and applies bounded retries only for idempotent operations when a busy condition occurs. The application also enforces a 30-second transaction timeout. Transactions must remain fully synchronous: all database work finishes before commit, and any async follow-up work such as email or S3 runs only after the transaction completes.

In this project, better-sqlite3 together with SQLite's configured busy timeout is the primary contention-management mechanism. Application code should not add a second general-purpose retry loop by default. Instead, service-layer database helpers should translate busy or locked database failures into a clear temporary-unavailable service error so controllers can render the standard safe failure path.

The version column on mutable tables supports optimistic lost-update detection for human-facing edit flows. When a submitted form includes a stale version, the update can be rejected so the user reloads and reviews intervening changes. This is a user-experience safeguard, not the platform's primary write-safety mechanism. The version column is intentionally not used on append-only, ledger, junction, or reference tables because those tables are not updated.

## 1.4 Development Parity

Local development and deployed environments use the same application code, the same fixed SQLite runtime filename (`footbag.db`), the same prepared statements, and the same Dockerized process boundaries. Docker/Compose mounts the host directory that contains the DB into the application working directory at `/app/db`, so the WAL and SHM sidecar files live on the host alongside the main DB file and are shared across the web and worker containers. Backup jobs may be disabled locally, but backup behavior is validated in staging and production.

## 1.5 Photo Data in S3

Decision:

Photos are stored separately from the SQLite database. The database stores media metadata (gallery name, paths, captions, tags, ownership) in a Photos table. Photo objects (thumbnail and display JPEG variants) are stored in Amazon S3 (production/staging) or local filesystem (development). A PhotoStorageAdapter provides environment abstraction.

Rationale:

Photo data is handled separately from application data, in a dedicated AWS S3 bucket (instead of the SQLite database hosted on the main AWS Lightsail container). The photo data is large and will grow over time, and so storing this together with Lightsail would blow out the size, and therefore the cost, and this is why we store photo data in S3. Each uploaded photo generates two variants (thumbnail at 300×300 pixels, display at 800px width) stored as JPEG at 85% quality on S3 (also processed to eliminate possible malware) . Original files are discarded after processing.

Separates structured metadata (benefits from SQL queries, transactions, referential integrity) from large binary objects (benefits from object storage scalability, CDN delivery, independent backup/replication). SQLite handles relational data well but is not optimized for large binary storage. S3 provides dedicated photo infrastructure (replication, lifecycle policies, CDN integration) without database bloat. Development filesystem maintains parity without AWS credentials.

Paths are stored as data, not calculated at runtime based on the member id and gallery name used at the time of upload.

CloudFront serves photos directly from the primary bucket via the `/media/*` cache behavior on the single site distribution. The cache-bust mechanism is URL-versioned via a `?v={media_id}` query string (a fresh UUID per upload), and the cache key includes the query string. S3 PUT sets `Cache-Control: public, max-age=31536000, immutable`. Photos are immutable from any cache's point of view because each emitted URL is unique to its upload; the URL is the cache identity, the S3 key is the storage location, decoupled.

Local filesystem at /data/photos/ mounted as Docker volume mirrors production S3 directory structure exactly. PhotoStorageAdapter reads identical database paths and constructs local URLs. No AWS credentials required for basic photo operations.

Backup and Replication:

Photos are backed up separately from database via S3 cross-region replication. The primary media bucket (us-east-1) replicates automatically to a dedicated media disaster-recovery bucket (us-west-2) using One Zone-IA storage class. Delete markers are replicated so account-erasure deletions propagate. Replication is continuous; per-object propagation typically completes within minutes. S3 Replication Time Control (RTC) is not enabled, so there is no formal RPO SLA. No backup job required; S3 native cross-region replication handles this automatically. Bucket names follow the `<env>-media` (primary) and `<env>-media-dr` (DR) Terraform convention; the SQLite-snapshot DR bucket is a separate `<env>-dr` resource.

Deletion and Retention: No referential integrity concerns from photo deletion because photos are leaf nodes in the data model. When member deletes account: member's photos automatically hard-deleted.

Access Control:

The media bucket is private. Viewer reads flow exclusively through CloudFront with Origin Access Control (OAC); the bucket policy grants `s3:GetObject` to the `cloudfront.amazonaws.com` service principal with an `aws:SourceArn` condition matching the distribution ARN, and grants nothing else. `s3:ListBucket` is intentionally omitted: with only `GetObject`, S3 returns 403 AccessDenied for both existing-but-forbidden and missing keys when the requester lacks permission, which prevents enumeration of bucket contents.

The application container's IAM grants `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject` on objects, plus `s3:ListBucket` on the bucket. `GetObject` is granted because S3's HeadObject is authorized by `s3:GetObject` per IAM; the application uses HeadObject for existence checks only and never reads object bytes through the SDK. Viewer reads always flow CloudFront → OAC → bucket.

CloudFront OAC is configured with `signing_behavior = always`, which overrides any viewer-supplied `Authorization` header. OAC does not override the `Host` header; for an S3 origin, the cache behavior must omit `origin_request_policy_id` (or use a policy that excludes `Host`) so CloudFront sets `Host` to the S3 origin domain itself. With the wrong `Host`, S3 cannot identify the bucket via virtual-host routing and returns generic `NotFound` before any bucket policy is evaluated. This applies to every cache behavior targeting an S3 origin, not only `/media/*`.

Trade-offs:

- Members cannot download original high-resolution photos.

- S3 dependency in production (mitigated by cross-region backup).

- Slightly more complex deployment than all-in-database (acceptable for storage cost savings and scalability).

- No soft delete for photo data.

Impact:

- PhotoStorageAdapter interface defined with methods: put(key, data), delete(key), constructURL(key), exists(key).

- Backup procedures updated to cover photos separately from database.

- CloudFront `/media/*` cache behavior uses OAC with no origin request policy. Operations in DEVOPS_GUIDE.

Alternative Considered:

- Storing photos in SQLite as BLOBs: Rejected due to database bloat and therefore Lightsail cost, as the database file is co-hosted.

## 1.6 Single Lightsail Instance behind CloudFront

Decision:

Production runs on a single modest AWS Lightsail instance hosting Docker containers (web app, workers, utilities), fronted by CloudFront for caching and TLS termination.

Rationale:

- Fits the cost ceiling and community-scale traffic profile.

- Greatly simplifies operations for volunteers: no multi-node clusters, no Kubernetes, no autoscaling groups, instead we use common and standard tech.

- CloudFront handles global delivery and offloads read traffic from Lightsail and S3.

- This design is the simplest and cheapest option that meets requirements.

Trade-offs:

- No automatic horizontal scaling; if the Lightsail instance fails, the site is down until restored (no automated failover).

- Capacity planning is capacity of a single instance (plus CloudFront), not a large cluster.

Impact:

- CI/CD and deployment scripts are written around "build a Docker image, deploy to one Lightsail host."

- CloudFront origin configuration points to this instance for dynamic content and to S3 buckets for static and archive content.

- Production uses 4GB Lightsail instance with 2 vCPUs, 80GB SSD, 4TB transfer allowance. This will provide adequate headroom for container allocations: 4GB provides sufficient memory for four Docker containers.

## 1.7 Docker Containers

Decision:

Application containers are stateless and immutable (except for the database file). All other durable state lives in S3 or AWS-managed services (Parameter Store, SES, Stripe, etc.). The Lightsail instance is treated as replaceable, except for the database file. The primary durable state is the SQLite database file on the Lightsail volume. S3 stores photo data and database snapshot backups (cross-region). The instance is recoverable by restoring SQLite from S3 snapshots.

Rationale:

- Enables simple, robust recovery: destroy and recreate containers (or the entire instance) without worrying about local state.

- Makes dev and prod more similar: containers behave the same across environments.

- Avoids "snowflake" servers with manual tweaks.

Trade-offs:

- No caching on local disks across restarts; everything persistent goes through adapters.

- Some performance advantages of local caching are not used.

Impact:

- All writes go through adapters to the database, S3, or external services. No code must assume persistent local files beyond temporary scratch space (or SQLite).

- Infrastructure runbooks treat instance rebuilds as routine, not emergencies.

## 1.8 Container Memory Allocation

Decision:

Container memory limits: Docker memory limits are explicitly set for each container preventing unbounded memory consumption. Authoritative allocation values are defined and implemented in docker-compose.yml. The following are deployment sizing estimates subject to tuning based on observed production usage.

Initial Allocations (Subject to Adjustment):

- nginx: 128MB - Reverse proxy, minimal footprint

- web: 512MB - Node.js app, concurrent request handling, database

- worker: 384MB - Background jobs, sequential processing

- image: 896MB - Sharp library, image processing buffers

- Total: 1,920MB (47 percent of 4GB instance)

These numeric allocations are deployment-time container resource sizing values for the AWS/Lightsail runtime and are implemented in runtime configuration (for example docker-compose.yml). They are not Administrator-configurable application parameters. The numbers provided in this document are all deployment sizing estimates and may be tuned in runtime configuration based on observed usage.

Rationale:

- **nginx** minimal allocation: handles origin HTTPS termination (CloudFront to origin) and reverse proxying; viewer TLS terminates at CloudFront. Reverse proxy performs simple request routing, and static file serving. Minimal memory footprint. 128MB provides adequate headroom for nginx process (approximately 50MB) plus connection buffers. 

- **web** needs concurrency headroom: Node.js/Express application handles business logic and concurrent HTTP requests. 512MB accommodates runtime (approximately 50MB), dependencies (approximately 80MB), application code (approximately 30MB), and 20-30 concurrent requests (approximately 100MB) with approximately 200MB headroom for spikes. SQLite database file (size TBD, but will be small enough initialy and will grow slowly). 

- **worker** is smaller due to asynchronous processing: Background jobs process sequentially or with limited concurrency. Email sending, nightly backups, do not require high memory. 384MB sufficient for runtime and job processing. 

- **image** is largest due to Sharp library: Image processing library loads entire image into memory, performs transformations, and outputs new format. Processing 5MB uploaded image requires approximately 500MB buffer space. Multiple concurrent uploads require additional headroom. 896MB provides safety margin. 

Trade-offs:

- Fixed allocations may not match actual usage: Initial estimates based on typical workload patterns, not load testing. Production monitoring required to validate and adjust allocations.

- Over-allocation risk: If containers use significantly less than allocated memory, instance is under-utilized. Acceptable for operational stability.

- Under-allocation risk: If containers exceed limits, Docker kills process (OOM).

- Requires careful monitoring and adjustment during early production operation.

- No dyamic allocation: Manual configuration updates required.

Impact:

- docker-compose.yml specifies memory limits for each container using mem_limit directive.

- Container will be killed (OOM) if exceeds allocated memory. Health checks and restart policies ensure container restarts automatically.

- CloudWatch agent monitors container-level memory usage via docker stats API.

- Alerts configured: Warning at 80 percent container memory, critical at 90 percent.

- Regular review of container memory utilization during first 6 months post-launch to validate allocations and adjust if needed.

## 1.9 Layered Architecture: Controllers, Services, Middleware, Adapters

Decision:

The platform uses a four-layer separation. Each layer has a specific responsibility. A function's signature, imports, and file location follow the layer it belongs to, not its semantic association with other code. Controllers call business services directly and return HTML (for browser requests) or JSON (for webhooks/AJAX). There is no separate REST API layer between HTML controllers and services. Only webhook callbacks use REST. All business services must be documented in the Service Catalog.

Layers:

1. Services (`src/services/`) — pure domain logic.

   - Functions take domain arguments (ids, strings, DTOs) and return domain values. No `Request`/`Response`/`NextFunction` parameters.
   - Never read cookies or headers. Never set cookies, redirect, or emit status codes.
   - Own business rules, validation, authorization checks, and page-model shaping.

2. Middleware (`src/middleware/`) — Express cross-cutting handlers.

   - Signature: `(req, res, next) => void` or `(err, req, res, next) => void`.
   - Apply across multiple routes: authentication, rate limiting, logging, CSRF checks, error handling.
   - May co-locate HTTP-layer constants they own (cookie names, cookie maxAge) because those are HTTP concerns.

3. Controllers (`src/controllers/`) — per-route HTTP glue.

   - Parse `req.body`/`req.params`/`req.query`, orchestrate service calls, decide response type.
   - Own `res.cookie(...)`, `res.redirect(...)`, `res.render(...)`, `res.status(...)` calls.
   - Thin: controllers do not own business rules, route-domain interpretation, or page-model shaping beyond trivial glue logic. When a page varies by authentication state or viewer role, the controller passes viewer context to the service and the service returns the appropriately shaped response. Controllers must not mutate service-returned view models based on auth state.

4. Adapters (`src/adapters/`) — external-service implementations behind typed interfaces.

   - Encapsulate SDK calls (AWS, Stripe, etc.) so services never import `@aws-sdk/*` or similar directly.
   - Paired structure: one interface plus one or more implementations selected by configuration.
   - Naming convention: `<Backend><Purpose>Adapter` for implementations; `<Purpose>Adapter` for interfaces.
   - File organization: one file per adapter at `src/adapters/<purpose>Adapter.ts`, containing the interface, all implementations (as factory functions, not classes), and a synchronous singleton getter `get<Purpose>Adapter()` that selects the configured implementation. Services import the getter and the interface from this single file; they do not construct adapters themselves.
   - Test hook: each adapter file also exports `reset<Purpose>AdapterForTests()` which clears the singleton so test suites can exercise fresh wiring per file.

Why this separation matters:

- Dev/prod parity. Adapter interfaces are the single swap point between dev and production behavior. The same interface is used by services in both environments, so service code is identical across environments and tests exercise the same path production runs. When adapter implementations are defined inline inside service files, this boundary erodes: services start importing SDK types directly, the adapter seam becomes harder to enforce as new services arrive, and dev/prod parity stops being a structural guarantee.

- Long-term clean code. Clear layer boundaries make it obvious where new code belongs. A new pure helper goes in services. A new Express middleware goes in middleware. A new external-service integration goes behind an adapter interface. Contributors do not have to guess.

- Testability. Services are pure — no HTTP mocking required. Middleware is narrow — tests inject `(req, res, next)` mocks. Controllers are thin and delegate — integration tests exercise them end-to-end. Adapters are swapped for deterministic stubs in dev and test.

Anti-patterns:

- Placing a pure helper inside `src/middleware/` because it relates conceptually to middleware (e.g., a JWT-minting helper next to the JWT-validating middleware). A function's layer is determined by its signature, not by its semantic neighborhood. Pure functions belong in `src/services/`.

- Defining adapter implementations inline inside a service file. Adapters belong in `src/adapters/`; services import the typed interface.

- Reading `req`/`res` inside a service. Services receive their dependencies as arguments from controllers.

- Reading `process.env` inside a service or any `src/` module outside `src/config/env.ts`. See §1.11 Configuration Model.

- Mixing HTTP constants (cookie names, cookie maxAge) into service files. HTTP constants belong in the HTTP layer (controllers or middleware).

Rationale:

- Services contain all business logic and route/domain interpretation.
- Thin controllers reduce drift, simplify testing, and keep request handling predictable.
- Adapter boundaries enable dev/prod parity, SDK evolution, and per-environment testing.
- Named middleware prevents per-route auth/logging/rate-limit drift.
- A single request path through the system reduces cognitive load and better fits the project's service structure.

Trade-offs:

- No public REST API (except for required webhook callbacks).
- Requires discipline to prevent convenience logic from creeping across layer boundaries.

Impact:

- Single controller per domain entity or public section (Member, Event, Club, HoF, Home, ...).
- Services remain pure domain logic with no HTTP knowledge (no request/response objects in service signatures).
- Controllers return HTML pages (via `res.render()` or `res.redirect()`) for browser navigation, JSON for webhooks/callbacks.
- Controllers should not become the place where page contracts are assembled.
- Adapters live in `src/adapters/` and are selected by configuration at service instantiation time.
- JavaScript validation runs client-side; forms submit via traditional POST with full-page navigation.

## 1.10 Catalog-governed Page and Service Contracts

Decision:
The platform uses catalog-governed architecture for page rendering and service ownership.

- `docs/VIEW_CATALOG.md` is the normative source for reusable public rendering primitives, page contracts, and page-specific view-model requirements.
- `docs/SERVICE_CATALOG.md` is the normative source for service ownership, service boundaries, service method contracts, and service-level route-interpretation responsibility.
- `IMPLEMENTATION_PLAN.md` is the normative source for current implementation status, accepted temporary deviations, and intentionally deferred work.

Controllers remain thin HTTP adapters. Templates remain logic-light rendering surfaces. Page shaping, route-domain interpretation, and page-specific read-model assembly belong in services or page-model builders owned by the service layer.

Home is the one intentional composition-page exception to the generic public page contract, but it is not an exception to shared shell/layout standards, service-owned shaping, or the Express + Handlebars + vanilla TypeScript architecture.

Any new page, section, or service boundary that materially changes the public architecture must be admitted by updating the relevant catalog in the same change or earlier.

Rationale:
- The project now has enough architectural structure that page contracts and service contracts need explicit governing documents.
- This reduces drift between docs and code.
- This keeps long-term catalogs future-facing while still allowing current-slice shortcuts to live in the implementation plan.
- This gives contributors and AI tools a clear source-of-truth order for page behavior and service responsibility.

Trade-offs:
- Requires more disciplined documentation updates when adding routes or services.
- Adds one more explicit architectural rule contributors must understand.

Impact:
- New public pages should not be added without catalog updates.
- Service ownership disputes should be resolved against the Service Catalog, not by ad hoc controller behavior.
- Current temporary exceptions belong in `IMPLEMENTATION_PLAN.md`, not as scattered one-off caveats throughout every cataloged page.

## 1.11 Configuration Model

Decision:

Configuration has two tiers with distinct lifecycles and distinct code entry points.

Deploy-time configuration (environment variables) is loaded once at process startup from the host environment into a single typed `config` singleton via `src/config/env.ts`. The singleton is constructed at module load, validated fail-fast, and `Object.freeze`d to prevent mutation. Every module in `src/` reads configuration through `config`; no module reads `process.env` directly. Changing a deploy-time value requires restart.

Runtime-mutable configuration (admin-tunable thresholds, windows, retention periods, pause flags, pricing) is stored in an append-only effective-dated `system_config` table, exposed through the `system_config_current` view, and read at request time via `src/services/configReader.ts` (`readIntConfig(key, fallback)`). Changing a runtime-mutable value is an admin operation; new rows supersede old rows with an `effective_start_at` timestamp; old rows are immutable. Changes take effect without restart.

Rules:

- No `process.env` reads in `src/` outside `src/config/env.ts`. Tests may set `process.env` via `tests/setup-env.ts` before importing config-consuming modules.

- Required env vars use `requireEnv()` in env.ts and throw at startup if missing. Optional env vars have explicit typed defaults inside `loadConfig()`.

- Production-critical env vars have stricter guards than simple non-empty checks (for example `SESSION_SECRET` rejects values containing `changeme` or shorter than 32 characters; `JWT_SIGNER` and `SES_ADAPTER` must be explicit in production with no fallback default).

- `config` is `Object.freeze`d after construction.

- No inline hardcoded thresholds for admin-tunable values in application code. Read via `readIntConfig`.

- `system_config` is append-only; change a value by inserting a new row, never `UPDATE`. Read via the `system_config_current` view only.

- No secrets in `system_config`. Secrets either live in env vars (dev: gitignored `.env`; production: host env file such as `/srv/footbag/env`, root-owned 0600) or are accessed via §3.6 KMS/Parameter Store mechanisms.

- Normative defaults. Defaults for required env vars live in `src/config/env.ts` (or are required explicit in production). Defaults for `system_config` keys are defined in USER_STORIES §6.7 "Configurable Parameters" and must be seeded into the database during initial database creation.

Rationale:

- Single validation point at startup; no scattered fallbacks or silent defaults for deploy-time config.
- Type-safe access via `AppConfig`.
- Fail-fast on misconfiguration catches issues at deploy time, not at first request.
- Separating deploy-time from runtime-mutable config keeps admin operations that do not require redeploy distinct from values that do.
- Testability: tests inject env vars before module load via `tests/setup-env.ts`; runtime config reads from a test-seeded SQLite view.

Trade-offs:

- Two loader paths (env.ts + configReader) instead of one. The separation is worth the overhead because deploy-time and runtime-mutable config have genuinely different audit, rotation, and operational workflows.
- Admin-tunable thresholds are DB reads on each use; cached where performance matters but not globally memoized (would defeat runtime mutability).

Impact:

- Services and controllers import from `config` (env.ts) or call `readIntConfig(...)` (runtime config). Never `process.env`.
- Secrets-handling rules (§3.6) apply to env-var secrets; system_config is not a secret store.
- SESSION_SECRET is the canonical example of an env-var secret that lives in the host's `/srv/footbag/env` outside Git. See §3.6.

## 1.12 Internal-only Subtrees

Decision:

Internal-only code (operator, maintainer, and QC tools that are not reachable from public navigation and are gated by role) lives under dedicated subtrees at `src/internal-<purpose>/**` with matching view trees at `src/views/internal-<purpose>/**`. It is kept separate from the permanent product surface in `src/services/**`, `src/controllers/**`, and `src/views/**`. Internal-only subtrees are present in every environment (dev, staging, production): the separation is role-based, not environment-based, and is orthogonal to the dev/staging/production adapter parity model defined in §1.9 and §5.3.

Current and reserved subtrees:

- `src/internal-qc/{controllers,services}/**` (live): historical-data QC tooling (net team corrections, persons data-quality review). Every file in this subtree carries the banner `// ---- QC-only (delete with pipeline-qc subsystem) ----` so the retirement scope (per `docs/MIGRATION_PLAN.md` §29) is mechanically greppable at retirement time.
- `src/internal-admin/**` (reserved, not yet created): future role-gated admin tooling covering work queue, audit viewer, alarm management, and config writes per `docs/SERVICE_CATALOG.md` §9.1. Follows the same subtree convention without the QC deletion banner.

Rationale:

- A distinct subtree signals at a glance whether code serves the public product or serves operator/maintainer needs. Nothing in `src/services/` or `src/controllers/` is silently QC-only.
- The QC-only banner on every source file makes the "delete with pipeline-qc subsystem" scope mechanically greppable at retirement time (MIGRATION_PLAN §29).
- Keeping internal-only code out of `src/services/` preserves the service-catalog invariant: `docs/SERVICE_CATALOG.md` covers permanent product surface only (see SC §1 "Catalog scope and organizational tiers"). Internal-only code is documented in its relevant runbook, not in the main service catalog.
- Role-based separation is orthogonal to environment-based adapter parity: dev, staging, and production differ only at the `<Purpose>Adapter` seam (§5.3). Internal-only surfaces exist in every environment and are gated by auth role, not by env config.

Trade-offs:

- Two parallel subtree roots (permanent product vs internal-only) to maintain. Minor, and is the point of the separation.
- A tool transitioning in or out of the QC lifecycle requires renaming its subtree (for example, migrating a tool from `src/internal-qc/` to `src/internal-admin/` if it survives QC retirement). Acceptable: it is a deliberate lifecycle transition and should not be silent.

Impact:

- `src/internal-qc/` already houses the Net QC and persons QC subsystems. `src/internal-admin/` is reserved, not yet created.
- `src/services/`, `src/controllers/`, `src/views/` hold permanent product code only. New internal-only code must land under the appropriate `src/internal-<purpose>/**` subtree on first commit. Do not merge an internal-only addition into the main trees with intent to move later.
- Integration tests for internal-only routes continue to live in `tests/integration/` alongside other route tests. Test-file paths do not mirror the src-layer separation today; if a convention for that is adopted later, it is a test-layout decision, not a change to this rule.
- `docs/SERVICE_CATALOG.md` §1 documents the catalog-scope consequence: internal-only subtrees are out of catalog scope. Permanent product services (including dev-mode shaping services such as `SimulatedEmailService` at SC §8.2) remain in-catalog.

# 2. Data Model

## 2.1 Schema and Versioning

Decision:

Standard metadata columns (for example id, created_at, created_by, updated_at, updated_by, version, and deleted_at, where applicable) are required on mutable domain tables following consistent naming conventions. Immutable, append-only, and certain junction and reference tables intentionally omit some or all mutable-table metadata columns, for example, version, updated_at, and updated_by are omitted from append-only ledger and audit tables. Base tables (with _base suffix) contain all records for their entity, including soft-deleted rows where that entity uses soft-delete semantics. Public views filter deleted_at as required for soft-deleted entities. Entity-specific lifecycle exceptions (for example clubs using status-based archival instead of deleted_at, and media, news items, and events without results using hard delete) are documented in their respective decisions. Tables use TEXT for UUIDs and timestamps (ISO-8601 format) for portability and human readability.

Rationale:

- Provides uniform metadata structure across all tables, enabling consistent tooling: migrations, audits, queries, debugging. The version field provides audit history tracking (incremented on each update).

- Supports schema evolution without bespoke data migrations for each change.

Trade-offs:

- Slight overhead, even for small or simple entities.

- Contributors must understand the metadata pattern to manipulate entities safely.

Impact:

- The domain data model defines tables with these standard columns. Data Model document specifies complete schema including column types, indexes, foreign keys, and constraints. Migrations create base tables and views following this pattern consistently.

## 2.2 Data Access Pattern

Decision:

All data access occurs through a single database module (db.ts) that exports the database connection, a collection of statement-group objects whose properties prepare SQL on first access, and a transaction helper function. Services import this module and execute queries by calling getters that resolve to prepared statements, then invoking `.all/.get/.run` with parameters. `db.prepare()` is only ever called inside a getter or a function body, never at module top level, so importing the database module against an unmigrated database does not fail at import time.

The database module prepares all SQL statements during initialization: member queries (find by email, find by ID, create, update, delete/restore), event queries (find upcoming, find by ID, search by filters), registration queries, media queries, audit log queries, and all other data access operations. Each prepared statement is exported with a descriptive name that clearly indicates its purpose.

Services import the database module and call prepared statements directly, passing parameters as needed. For multi-step operations requiring atomicity, services use the exported transaction helper function which wraps operations in BEGIN/COMMIT with automatic ROLLBACK on error.

Statement Naming Convention: Names follow consistent pattern for discoverability: entityByField for single-record queries (memberByEmail, eventById), entitiesByField (plural) for multi-record queries (eventsByOrganizer, mediaByHashtag), createEntity for inserts (createMember, createEvent), updateEntity for updates (updateMemberTier, updateEventStatus), deleteEntity for deletion operations, whether soft (deleteMember) or hard (deleteMedia, deleteEvent, deleteNewsItem).
 All names use camelCase. Queries returning counts use countEntitiesByField pattern (countRegistrationsByEvent). Boolean queries use hasEntity or isEntity pattern (hasMemberVoted, isEventPublished).

Parameter Binding: All queries use positional parameters (?) rather than named parameters for simplicity and consistency. Parameters are bound using better-sqlite3's automatic parameter binding: .get(param1, param2) for single row, .all(param1, param2) for multiple rows, .run(param1, param2) for modifications. Array parameters are spread: .all(...arrayOfParams). This follows SQLite best practices for SQL injection prevention and performance.

Error Handling: better-sqlite3 throws SqliteError with code property matching SQLite extended result codes. Services catch specific error codes and handle appropriately: SQLITE_CONSTRAINT_UNIQUE indicates duplicate key (map to 409 Conflict), SQLITE_CONSTRAINT_FOREIGNKEY indicates referential integrity violation (map to 400 Bad Request or handle as business logic error), SQLITE_BUSY indicates timeout waiting for lock (retry with exponential backoff up to 3 attempts), SQLITE_FULL indicates disk full (map to 507 Insufficient Storage), SQLITE_IOERR indicates I/O error (critical alert). Services never catch and ignore database errors. Unhandled errors propagate to controller layer where they are logged and mapped to 500 Internal Server Error.

Transaction Semantics: Transaction helper uses IMMEDIATE transaction mode (BEGIN IMMEDIATE) to acquire write lock immediately, preventing SQLITE_BUSY errors during transaction execution. Transactions do not span async operations - all database operations within transaction execute synchronously. better-sqlite3 does not support async functions in transactions because transaction would commit before async operations complete. Services structure transactions to batch all database operations, then perform async operations (email, S3 upload) after transaction commits. Transaction timeout is 30 seconds (enforced at application level), after which transaction is rolled back and error thrown.

Statement Reset: better-sqlite3 automatically resets prepared statements after execution. If a statement throws, it is automatically reset and remains usable. Each getter access compiles a fresh statement; statement objects are not retained across requests.

Example: memberByEmail: db.prepare('SELECT \* FROM members WHERE email = ?')

A service uses these prepared statements directly, wrapping multi-step operations in transactions with proper error handling. The complete pattern: prepared statements with consistent naming exported from central module, services calling them with positional parameters, transaction wrapper ensuring atomicity, and specific error handling for common database constraint violations.

Rationale:

Decoupled Module Load: Lazy preparation decouples application module load from database schema readiness. Tests, migration tooling, and any future code path that imports the database module before applying schema do not crash at import time. The single rule "no top-level `db.prepare()`" is uniformly applied across statement groups and dynamic-SQL helpers, removing the masking that per-test database isolation provided previously.

Simplicity and Transparency: All queries live in one file. Opening db.ts shows every query the application can execute. No hidden abstractions, no magic, no framework complexity. Volunteers can grep for "WHERE email" and immediately find relevant queries. Consistent naming convention makes queries discoverable through IDE autocomplete.

Small Project Appropriate: For a community site with 50-100 total queries, a single organized file is manageable and easier to navigate than dozens of repository files. Repository classes add organizational value when you have hundreds of queries and many developers, but create unnecessary complexity for small teams.

Direct Access: Services call prepared statements directly with no intermediate layers. No class instantiation, no dependency injection, no method dispatch overhead. Just import and call.

Self-Documenting: Descriptive statement names serve as documentation. queries.memberByEmail is immediately clear. The SQL is visible right next to the name for anyone who needs to understand the query. Naming convention eliminates ambiguity: singular names return one record, plural names return arrays.

SQL Injection Protection: Positional parameters (?) with bound values provide complete SQL injection protection. better-sqlite3 handles parameter escaping automatically. Services never concatenate strings into SQL.

Error Clarity: Catching specific SQLite error codes (SQLITE_CONSTRAINT_UNIQUE, SQLITE_BUSY, etc.) enables precise error handling and meaningful error messages to users. Generic catch-all error handling obscures root causes and prevents proper recovery.

Transaction Safety: BEGIN IMMEDIATE mode prevents common concurrency bugs by acquiring write lock immediately. Synchronous-only transaction restriction prevents bugs where async operations cause transactions to commit prematurely. 30-second timeout prevents runaway transactions from blocking other operations.

Testing Simplicity: Tests import the same db module. For integration tests, point at test database. For unit tests that need mocking, the module can be mocked at the import level using standard Node.js testing tools.

Trade-offs:

Per-access SQL Compilation: Lazy preparation re-runs `db.prepare(SQL)` on every getter access. better-sqlite3's prepare is a C-level operation and no statement is used in a hot loop, so the per-request cost is small. Boot-time SQL validation that eager prepares provided is recovered by an explicit test that walks every getter against the current schema.

Single File Growth: As the application grows, db.ts could contain 100+ prepared statement definitions. This remains manageable for small projects but would become unwieldy for large applications with 500+ queries. At that scale, splitting into repository modules would be appropriate.

No Encapsulation: Services directly access database connection and prepared statements. There is no enforcement preventing services from calling db.prepare() and writing ad-hoc SQL. This is acceptable for small volunteer teams where code review catches violations, but would be risky for large teams.

Global State: The database module exports singleton instances (connection and prepared statements). This is simple and performant but means tests must carefully manage database state. No issue for applications with clear test setup/teardown procedures.

Synchronous Transactions Only: Transactions cannot span async operations (HTTP calls, S3 uploads, email sending). Services must complete all database work, commit transaction, then perform async operations. This is a better-sqlite3 design constraint but also a best practice - keeping transactions short minimizes lock contention.

Positional Parameters Only: Using positional (?) rather than named (:param) parameters means parameter order matters. Developer must ensure parameters passed in correct order. Named parameters would be more readable for queries with many parameters, but positional parameters are simpler and consistent across all queries. Trade-off favors simplicity.

Manual Error Code Handling: Services must know SQLite error codes (SQLITE_CONSTRAINT_UNIQUE, etc.) and catch them explicitly. More verbose than ORM-style exceptions, but provides precise control over error handling and recovery. Better for debugging and operational troubleshooting.

Impact:

Database Module Implementation: Single db.ts file exports database connection configured with required PRAGMAs, exports object containing all prepared statements with descriptive names following naming convention, exports transaction helper function using BEGIN IMMEDIATE. Module initialization prepares all statements synchronously at startup. Module is ~200-500 lines for typical application with 50-100 queries.

Service Layer Usage: Services import database module and call prepared statements: queries.memberByEmail.get(email), queries.createMember.run(data), transaction(() =\> { ... }). Services wrap error-prone operations in try-catch blocks, catch specific SQLite error codes, throw business logic errors with meaningful messages. Services never call db.prepare() directly or write SQL inline.

Query Organization: Statements grouped by domain within the exports object (members, events, registrations, media, audit logs, etc.). Comments separate sections for readability. Statements ordered logically: reads before writes, simple before complex. Complex joins include inline SQL comments explaining logic.

Error Handling Pattern: Services catch SqliteError, inspect error.code property, handle known error codes (SQLITE_CONSTRAINT_UNIQUE → meaningful business error, SQLITE_BUSY → retry with backoff, SQLITE_FULL → critical alert), propagate unknown errors to controller layer. Controllers log all database errors with safe context only: query name, operation, correlation ID, and redacted parameter summaries (never raw PII, secrets, tokens, emails, or payment details).

Transaction Pattern: Transaction helper executes BEGIN IMMEDIATE, runs provided function synchronously, commits on success or rolls back on error. Services wrap multi-step operations requiring atomicity: create registration + log audit entry, update member tier + log tier change + create payment record. Services never put async operations (await fetch, await sendEmail) inside transaction callback. All async operations occur after transaction commits.

Testing Strategy: Integration tests import db module and execute against test database (:memory: or temporary file). Setup creates schema, seeds test data. Teardown closes connection and deletes file. Unit tests that need to mock database use test doubles or module mocking (jest.mock, sinon). Each test resets database state for isolation.

Monitoring and Debugging: All database errors logged with error.code, query name, and parameters (sanitized). Slow query monitoring wraps statement execution with timing (log if \>500ms). SQLITE_BUSY errors tracked in metrics (alert if \>5% of operations). Query execution counts tracked per statement name for optimization analysis.

## 2.3 Soft Deletes

Decision:

User-facing "delete" operations follow one of three lifecycle patterns depending on the entity type:

1. **Grace-period deletion with restore** (members only): sets a deleted_at timestamp. The account is immediately inaccessible but can be restored by the member during the configurable grace period. Database views for members filter WHERE deleted_at IS NULL, making this transparent to queries. After the grace period, a background job purges PII while retaining the anonymized row for referential integrity.

2. **Status-based archival** (clubs only): sets status = 'archived'. No deleted_at column is used. Club records are never removed from the database.

3. **Hard delete** (events without results, news items, media, and all association/link rows): the record is immediately and permanently removed. Events with published results are explicitly excluded and preserved permanently.

Foreign keys use ON DELETE NO ACTION for entities under the grace-period deletion pattern (members) to prevent accidental hard deletes while the grace period is active. Hard-delete entities are structured as leaf nodes or are handled via explicit application-level cascade logic at deletion time.

Rationale:

- Grace-period deletion for members protects against accidental account deletion and supports member-initiated restore within the configured window.

- The grace period lets administrators reconcile audits and payments before PII is permanently purged.

- Historical record for members is preserved as an anonymized row even after PII purge, maintaining referential integrity for audit logs, event results, and payments.

- Hard delete is appropriate for entities with no restore story and no referential integrity concerns (events without results, news items, media). Association/link rows are always hard-deleted, with changes captured in the audit log. Operational logs and ledgers are append-only and not deletable.

Trade-offs:

- Database views handle grace-period deletion for members with deleted_at filtering, eliminating the need for explicit WHERE deleted_at IS NULL in every member query.

- Hard-deleting events and news items simplifies the cleanup job and eliminates grace-period configuration for those entities at the cost of no admin undo for those deletions (confirmation dialogs are the safeguard).

Impact:

- Controllers and services apply each entity's defined lifecycle action: grace-period deletion via deleted_at for members, status = 'archived' for clubs, and immediate hard delete for events (without results), news items, and media.

- A background job can enforce retention policies and/or permanently remove entities after the configured window according to business rules.

- SQLite UNIQUE treats NULLs as distinct; therefore UNIQUE(email, deleted_at) does not prevent multiple active rows. Enforce active uniqueness with partial unique indexes on canonical normalized values (e.g., lower(email) WHERE deleted_at IS NULL), and define reuse rules explicitly.

- Reuse rules must be explicit: email addresses remain reserved during the account grace period and may be reused only after personal data is purged. Standardized event/club hashtags are reserved permanently and are never reused. Enforce active uniqueness with partial unique indexes on canonical normalized values (e.g., lower(email) WHERE deleted_at IS NULL AND personal_data_purged_at IS NULL), and enforce permanent hashtag uniqueness via normalized unique indexes.

### Retention policy

Member personal data: retained for a configurable grace period (Administrator-configurable default 90 days, parameter key: member_cleanup_grace_days) after soft delete, then purged from primary storage. Purge sets credential and contact fields (email, phone, passwordHash) to NULL. For non-nullable identity/location columns retained for referential integrity, the application overwrites values with anonymized placeholders (not original data). Exception: members with HoF or BAP flags preserve `displayName` and `bio` after purge per User Stories deletion policy; credential/contact fields are still nulled and other required retained identity/location fields are anonymized as needed. The member row is retained as an anonymized record for referential integrity and audit history.

- Deceased members: memberStatus="deceased" disables login immediately; private contact information is permanently removed after a configurable grace period (parameter key: `deceased_cleanup_grace_days`; in case of error), while historical contributions and honor data (HoF, BAP) are preserved.

- Club records: Club records are never permanently deleted and do not use the deleted_at soft-delete pattern. Club archival is performed by setting status = 'archived'. The deleted_at column is not present on clubs_base database table. Club operability/contactability policy: clubs_base.contact_email remains nullable by design for legacy import, remediation, and exceptional cases. Club creation requires a contact email at the application/workflow level. A club with no current leader and/or no contact email is treated as non-operable and is flagged to the admin work queue for remediation (assign/reassign leader, obtain/update contact email, or archive if defunct).  

- Photos and video links: retained while member is active; when deleted by the member (or via account deletion), photo data is removed from primary storage immediately. Deleted items persist in backups until backup retention expiry (operational constraint).

- News items: hard-deleted immediately on admin action. No grace period or restore. Deletion is audit-logged.

- Events: events without published results are hard-deleted immediately by the organizer. Events with published results are preserved permanently and are never deleted. No grace period applies to events.

- Audit logs: retained 7 years; entries include authenticated actor identity (member id) and event metadata, and intentionally exclude IP address.

- Financial records: retained as required for reconciliation/compliance, but after deletion windows, personal identifiers are removed/anonymized where feasible while keeping transaction integrity.

- Member-to-historical_person link: `members.historical_person_id` is a nullable foreign key with ON DELETE NO ACTION; historical_person rows are never deleted. The link is retained during the grace period to support member-initiated restore. On PII purge, `historical_person_id` is set to NULL on the anonymized member row, and subsequent person-context pages render from the historical_person record only (URL reverts from `/members/{slug}` to `/history/{historical_person_id}`). See §2.4 (entity rules), USER_STORIES `M_View_Profile`, and `M_Delete_Account`.

## 2.4 Member, Legacy Member, and Historical Person Entity Types

Decision:

The platform represents people using three distinct entity types stored in three tables: `members` (authenticated accounts), `legacy_members` (imported old-site accounts from the mirror and future data dump), and `historical_persons` (archival identity records of past participants sourced from event data and club data). These entity types have different primary keys, different URL namespaces, and different privacy and capability rules. Three FK linkages (rule 3) express the identity overlaps between them; unlinked rows in `legacy_members` and `historical_persons` remain archival read-only records.

Rules:

1. Three entity types. The identity model uses three distinct tables, one per entity. A given real-world person may correspond to rows in any combination of the three, via the FK linkages in rule 3.

   - `members` = authenticated accounts on this platform. Identified by `members.id`; addressable by `members.slug`. Hold credentials, tier, profile fields, optional avatar, mailing-list subscriptions.

   - `legacy_members` = imported archival records of old footbag.org user accounts (from the mirror and the forthcoming legacy data dump). Identified by `legacy_members.legacy_member_id` (the old-site account id). Read-only after import; never deleted; hold no live credentials. Persist as the permanent audit record of a legacy account even after a current member claims it.

   - `historical_persons` = archival records of past participants sourced from event data and (future) mirror club-roster extraction. Identified by `historical_persons.person_id`. Read-only; never deleted; hold no credentials. Contact information, if present, is admin-surface only and never publicly rendered.

2. URL namespaces. Two general person URL namespaces exist:

   - Member profile URL: `/members/{slug}`.

   - Historical-person URL: `/history/{personId}`.

   Every general-purpose person link in any service MUST go through `personLink.personHref(memberSlug, historicalPersonId)`, which dispatches: `/members/{slug}` when a claimed member exists, `/history/{personId}` otherwise, or null. No service constructs person URLs directly.

   Sport-specific pages render person-related aggregates (event results, partnerships, records, etc.) as SECTIONS on the canonical person page (`/history/{personId}` or `/members/{slug}`), not under their own sport-scoped person namespaces. Sport-specific URL namespaces own sport CONTENT only: events, aggregated team/partnership lists, record tables, trick catalogs, sport landings, and informational pages. They do NOT include per-person deep-dive URLs; per-person data belongs on the canonical person page as sections, not under parallel sport-scoped person URLs.

3. Linkages. Three FK relationships express the identity overlaps between entity types. All three are nullable; `ON DELETE NO ACTION` throughout. Rows in `historical_persons` and `legacy_members` are never deleted.

   - `members.historical_person_id` → `historical_persons(person_id)`. Non-NULL = this member claims that historical identity. Partial UNIQUE index enforces at most one live member per historical person.

   - `members.legacy_member_id` → `legacy_members(legacy_member_id)`. Non-NULL = this member has claimed that legacy account. Partial UNIQUE index enforces at most one live member per legacy account.

   - `historical_persons.legacy_member_id` → `legacy_members(legacy_member_id)`. Non-NULL = the mirror/dump named this historical person with that legacy account id (archival provenance). Partial UNIQUE index enforces 1:1.

4. Claimed historical persons redirect to member profile. When `members.historical_person_id` is non-NULL for a given historical person, the canonical URL is the member's `/members/{slug}`. `GET /history/{personId}` for a claimed historical person redirects (302) to `/members/{slug}`.

5. Reversion on account deletion. When a member's PII is purged (after the grace period per §2.3 Soft Deletes), the application, in one transaction: (a) sets `members.historical_person_id = NULL` and `members.legacy_member_id = NULL` on the anonymized row; (b) clears the claim pointer on the corresponding `legacy_members` row by setting `claimed_by_member_id = NULL` and `claimed_at = NULL`, returning that legacy account to the claimable pool. Subsequent `personHref()` resolution reverts from `/members/{slug}` to `/history/{personId}`.

6. Historical persons confer no member capabilities. A row in `historical_persons` — whether claimed or unclaimed — does NOT confer authentication, inclusion in member search, contactability, profile ownership, mailing-list subscriptions, or any current-member privilege. See §3.9 and GOVERNANCE.md §4.

7. Imported legacy accounts live in `legacy_members`, never in `members`. Legacy migration imports old footbag.org user-account rows into the `legacy_members` table (§4.14b of DATA_MODEL). `legacy_members` rows are permanent archival records; they are never deleted. They do not grant authentication and are not visible on current-member surfaces. When a current member completes the claim flow (§6.5 and SC §10.1) for a legacy account, the application sets `legacy_members.claimed_by_member_id` and `claimed_at`, copies merge-eligible fields to the claiming `members` row per MIGRATION_PLAN §8, and (if the legacy account's `legacy_member_id` matches a `historical_persons.legacy_member_id`) also sets the claiming member's `historical_person_id`. The `legacy_members` row itself is not mutated at claim beyond the two claim-state columns.

Rationale:

- Prevents the conceptual slippage where "historical person" and "member" get conflated, which would leak member-only capabilities (contactability, search inclusion) onto archival records.

- Gives `personHref()` a single documented contract: general person URL dispatch. Every person link in any service obeys the same dispatcher.

- Aligns deletion-reversion behavior with the URL dispatch rule so a claimed-then-unclaimed member's links work correctly without ad-hoc per-service logic.

- Reuses the HP-vs-member pattern consistently: one person → one canonical URL → all data about them rendered as sections on that single page. Prevents per-sport duplication of person-centric data across parallel URL namespaces.

## 2.5 Immutable Audit Logs with Privacy-safe Fields

Decision:

Security and governance-sensitive actions (elections, payments, admin actions, account deletion, configuration changes, etc.) produce immutable, append-only audit log entries that include: actor’s member id, timestamps, action type, entity IDs, reason provided.

Rationale:

- Audit log database table (append-only, never edited) simplifies governance and investigations.

- Member IDs are necessary for administrative reconciliation and dispute resolution.  
  Audit logs intentionally exclude IP data; actor identity is recorded via authenticated account context (member id) rather than network identifiers.

Trade-offs:

- 7-year retention increases storage costs (acceptable for compliance).

- Immutability is enforced at the application-code boundary: no service method issues UPDATE or DELETE against `audit_entries`. Database-level tampering by an actor with direct SQLite write access (for example a Lightsail host compromise) is a residual risk bounded by the SSH access posture (§7.2) and backup retention (§9.4). For tally audit records specifically, WORM storage in S3 Object Lock (§6.9) is the stronger commitment.

Impact:

- All state-changing operations generate audit entries.

- Audit schema includes full actor context for investigations.

- Compliance procedures rely on audit log immutability.

- Audit log display surfaces must render the 'reason' field (and any free-form admin-authored text) with Handlebars default escaping. Raw HTML rendering (triple-stache, SafeString, or client-side innerHTML) of admin-authored audit content is forbidden.

## 2.6 Hashtags and Media

Decision:

Events and clubs must define unique, standardized hashtags. These are validated at creation to prevent collisions. Member-uploaded media tagged with a standard hashtag auto-links to corresponding event/club galleries on page load, leveraging this convention. Users may also invent new hashtags, and these may be discoverable by other members. Also, the \#tutorial hashtag will receive special attention for member-created educational media. The User Stories document provides the rest of the detail for these use cases.

Rationale:

- Unique hashtags provide unambiguous linking between media and entities.

- Member self-tagging leverages community participation.

- Suggested hashtags at creation time guide correct tagging (it is possible to build an auto-fill feature using AJAX as an optional extra usability detail).

Trade-offs:

- Hashtag uniqueness validation enforced by database.

- Auto-linking query on every page load adds latency.

- Mis-tagged media won't appear in correct galleries (user education required).

Impact:

- Event/club creation validates proposed hashtag uniqueness.

- Media upload accepts multiple freeform tags.

- Gallery page load scans media by hashtag to build display list.

- Popular hashtag views and the Browse page use aggregated hashtag statistics computed by background job.

- Events use `#event_{year}_{event_slug}`.

- Clubs use `#club_{location_slug}`.

- Hashtag validation applies to all hashtags (standardized and freeform): maximum 100 characters per tag, must start with '#' character, and may contain letters, numbers, and underscores only after the leading '#'. Validation prevents excessively long tags, script injection, spaces/punctuation, and other disallowed special characters. Tag matching is case-insensitive but original capitalization is preserved for display quality.

## 2.7 Encryption at Rest

Decision:

Use AWS S3 default encryption (SSE-S3).

Rationale:

- SSE-S3 uses AES-256 encryption with Amazon S3-managed keys.

- Enabled by default on all S3 buckets.

- Zero configuration or cost required.

- Transparent to application (encryption/decryption automatic).

- Meets security requirements for non-regulated data.

Alternative Considered:

- SSE-KMS with customer-managed keys: Rejected due to added complexity, cost, and key rotation overhead, not justified for this use case.

Implementation:

- S3 buckets have default encryption enabled for data backup snapshots. Local SQLite database file on the instance is stored unencrypted as an explicit MVP trade-off; mitigations include restricted instance access, least-privilege IAM, OS hardening/patching, and encrypted S3 backups with defined retention.

# 3. Security, Authentication, and Sessions

## 3.1 Password Hashing

Decision:

Member passwords are hashed using a modern slow algorithm (argon2id) with a per-user salt and safe cost factor. No server-side pepper is used.

Rationale:

- Slow hash with per-user salt is a well-understood protection against offline attacks.

- For this project's threat model and community scale, the incremental benefit of a pepper does not justify the extra operational complexity and risk (e.g., losing the pepper would invalidate all passwords).

- We already rely on other strong controls: IAM, HTTPS, limited blast radius.

Trade-offs:

- If an attacker obtains the hashed passwords and has sufficient compute, they can attempt offline cracking. This risk is mitigated by strong hashing parameters and general AWS hardening.

- We do not get the extra defense-in-depth layer that a pepper can provide in some partial compromise scenarios.

Impact:

- Member data includes only salted hashes and metadata (e.g., hashVersion).

- Migration to stronger parameters or a different algorithm would be managed via versioning and rehash-on-login logic, not via introducing a pepper.

## 3.2 JWT sessions

Decision:

Sessions are represented by JWTs stored in HttpOnly, Secure, SameSite=Lax cookies, with a 24-hour expiry; during active use the server may re-issue the session JWT near expiry as described in 3.4. Sessions are not individually revocable, but password change MUST invalidate all existing JWTs by incrementing passwordVersion. The password-change flow should also issue a fresh JWT to the current browser session (so the member is not logged out on the device where they changed the password).

Rationale:

- Fits the stateless container model; no central session store.

- HttpOnly + Secure protects tokens from JS access; SameSite reduces CSRF exposure.

- JWT claims (e.g., member ID, roles, passwordVersion) allow simple authorization checks.

- This architecture uses "JWT-based sessions with per-request validation," not "truly stateless sessions." Each authenticated request validates JWT signature (stateless cryptographic verification) then reads member data to verify passwordVersion matches (stateful lookup for immediate invalidation).

- No session table required.

- No session cleanup jobs.

- No session fixation concerns.

- No distributed session state synchronization.

- Immediate cross-device logout on password change.

- The per-request member read is the only stateful component and provides essential security.

Trade-offs:

- Cannot revoke a single JWT immediately across the system; revocation is coarse (password reset, secret rotation, or expiry).

- Token payload must be kept minimal to avoid bloat in every request.

Impact:

- UI never handles raw JWTs; the backend manages cookies completely.

- All authenticated routes verify JWTs and version claims before proceeding.

- Admin tools that change credentials or access levels bump claimed versions so old tokens no longer pass checks.

- Per-Request Validation Flow: Middleware extracts JWT from HttpOnly cookie, validates JWT signature, calls AuthService.getCurrentMember which extracts memberId and passwordVersion from JWT claims, reads Member entity, compares member.passwordVersion with JWT claim, and returns member object if match or isValid=false if mismatch. If valid, request proceeds. If invalid, returns 401 Unauthorized.

- Authorization from database, not JWT claims: While JWTs contain tier and role claims for routing efficiency, authorization middleware queries the member table on every authenticated request to retrieve current tier, tier_expires_at, passwordVersion, and flags. This ensures tier expiration, permission changes, and password resets take effect immediately on the next request. JWT claims serve as performance hints, not authoritative access control data.

## 3.3 CSRF Protection via SameSite Cookies

Decision:

CSRF protection relies on SameSite=Lax cookie attribute combined with proper HTTP verb semantics. No synchronizer tokens required.

Rationale:

- SameSite=Lax prevents cookies from being sent with cross-site POST requests, blocking CSRF attacks at browser level.

- Modern browsers have 97%+ support for SameSite (CSRF dropped from OWASP Top 10 in 2017).

- Proper HTTP verb discipline (GETs are non-side-effecting; mutations use POST, including POST with method override to represent PUT/DELETE semantics) ensures GET requests cannot perform state changes.

- Content-Type validation on JSON endpoints (require application/json) prevents simple form-based CSRF.

Requirements:

- All cookies set with SameSite=Lax attribute.

- GET requests must be strictly read-only (no state changes).

- All state-changing operations use POST (including POST with method override where PUT/DELETE semantics are desired).

- JSON-only routes (webhooks and explicitly-designated JSON-only progressive-enhancement endpoints) validate Content-Type: application/json.

Trade-offs:

- Requires discipline in HTTP verb usage. No protection for ancient browsers (IE 10 and older); acceptable given browser baseline.

Cookie integrity for display state:

- Server-issued cookies that carry display state (flash banners today; preferences or remember-me in the future) are HMAC-signed with the per-host `SESSION_SECRET` via `cookie-parser`'s signed-cookie mechanism. This is distinct from synchronizer tokens, which are not used: signing defends against client-side cookie-jar tampering of state the server will later echo, not against cross-site request forgery (which SameSite handles).

- Cookie policy (name, format, options) lives in `src/lib/*Cookie.ts` helpers; controllers and middleware call helpers rather than hand-rolling cookie options. Services are unaware of flash cookies (HTTP-layer concern).

## 3.4 JWT Token Lifecycle and Configuration

Decision:

JWT tokens have 24-hour lifetime, stored in HttpOnly, Secure, SameSite cookies. Tokens include memberId, roles, passwordVersion (for immediate invalidation on password change). No separate refresh token mechanism is used; instead, the session JWT itself may be re-issued near expiry during normal authenticated requests (see session refresh behavior).

Rationale:

- 24-hour lifetime balances security (regular re-authentication) with convenience.

- HttpOnly prevents JavaScript access (XSS mitigation).

- Secure flag enforces HTTPS-only transmission.

- SameSite=Lax prevents CSRF via cookie isolation.

- passwordVersion enables immediate token invalidation without token blacklist.

Trade-offs:

- Users must re-authenticate every 24 hours (acceptable for community site).

- No "remember me" or extended session capability.

- Password change invalidates all other sessions immediately; the current session continues via immediate JWT re-issue on the password-change response.

Impact:

- Authentication middleware validates token on every request.

- Token generation centralizes passwordVersion from member record.

- Password change flow increments passwordVersion, auto-invalidating old tokens.

- JWT Payload Structure: JWT contains: memberId, roles array, passwordVersion, tierStatus, iat (issued at), exp (expires at, 24 hours later). Controllers and middleware can access these claims after JWT validation. The passwordVersion claim enables immediate session invalidation without token blacklist.

- Session refresh triggers on every authenticated request. If the JWT expires in less than 6 hours, the system issues a new JWT with extended 24-hour expiration. If the JWT expires in 6 hours or more, the existing JWT is retained. Refresh is transparent to the user through automatic cookie replacement in the response.

- The middleware checks expiration time on each authenticated request and generates a new JWT when needed, setting the session cookie with httpOnly, secure, sameSite lax attributes and 24-hour maxAge. This provides simple implementation without separate refresh tokens, good user experience preventing logout during active use, and security through short expiry for inactive sessions.

- Cookie configuration: name is 'footbag_session', httpOnly true prevents JavaScript access, secure true enforces HTTPS only, sameSite lax provides CSRF protection, and maxAge is 86400000 milliseconds for 24 hours.

- Password change atomicity: Password changes update the password hash and increment passwordVersion in a single atomic transaction. Authorization middleware checks passwordVersion on every request, comparing the JWT's embedded passwordVersion claim against the current database value. If they differ, the JWT is rejected immediately, forcing re-authentication. This pattern invalidates all existing JWTs instantly when a password changes, preventing use of stolen tokens after password reset.

- JWT signing key rotation: JWT signing uses AWS KMS asymmetric keys identified by kid (key ID) headers. During key rotation, multiple valid keys exist simultaneously: the new key signs new JWTs, while the old key remains valid for verification. Old signing keys remain enabled for 24 hours after new key deployment to allow natural JWT expiry without forcing mass logout. After 24 hours, the old key is disabled and JWTs signed with it are rejected, requiring re-authentication.

- JWTs are used as session cookies with a 24-hour expiration. The platform does not use a separate refresh token. Instead, for active sessions the server may re-issue the session JWT (same cookie, new token) during normal authenticated requests when the existing token is near expiry. Users must log in again once the token expires and is not renewed through normal activity.

## 3.5 JWT Signing with AWS KMS Asymmetric Keys

Decision:

JWTs are signed using an AWS KMS asymmetric key (RSA-2048). Login flow calls KMS Sign to produce the token signature. Token verification uses the exported public key (KMS GetPublicKey) cached in memory; verification does not call KMS on every request. Token header includes kid referencing the active KMS key identifier used for signing to support rotation.

Rationale:

- Lightsail has no EC2 instance profile; KMS integration is simpler on EC2 (instance profile attaches automatically) and requires explicit runtime credential wiring on Lightsail (see §7.2). The offline-forgery protection of non-exportable HSM-backed key material is worth that wiring cost for session signing.
- Private key material never leaves KMS/HSM. A container compromise cannot exfiltrate a reusable signing key. Public-key verification is fast and can be done in-process without KMS round trips.

Trade-offs:

- Container compromise can still sign tokens while the runtime AWS credentials for the assumed runtime role remain usable (an attacker can still call KMS Sign through that role). KMS prevents offline forging after incident response because the private key is non-exportable.

- Requires KMS key provisioning and rotation procedures (public key refresh and kid changes).

Impact:

AuthService signs tokens via the `JwtSigningAdapter` interface (KMS-backed `KmsJwtAdapter` in production via `kms:Sign`; file-backed `LocalJwtAdapter` in dev/test) using the runtime assumed role defined by the AWS Lightsail and Credentials decision. Auth middleware verifies using cached public key (`kms:GetPublicKey` during startup/rotation only).

## 3.6 Secrets Management via AWS Parameter Store

Decision:

Sensitive credentials (e.g., Stripe API keys, Stripe webhook secret, administrative bootstrap tokens) are stored in AWS SSM Parameter Store as SecureString parameters and retrieved at container startup via SecretsAdapter. Cryptographic operations that must not allow key exfiltration use AWS KMS (JWT signing and ballot encryption). No secrets are stored in source code, Dockerfiles, committed environment files, or version control.

In production, the workload reads Parameter Store by using the runtime assumed role. The host-level source credential/config material used to assume that role is root-owned and is not the authoritative runtime principal.

Rationale:

- Lightsail has no EC2 instance profile. Parameter Store reads require activating an AWS runtime credential path (long-lived IAM-user keys in `/root/.aws/credentials` (root-owned, 0600) used as a source profile to assume the runtime role, or SSM Hybrid Activation); on EC2 an instance profile handles this automatically. The host env file `/srv/footbag/env` carries only the runtime profile name (`AWS_PROFILE`) and other non-secret config, never the access keys themselves. The Lightsail credential-path cost is accepted for secrets where rotation-without-redeploy or multi-consumer access justifies it.
- Encryption at rest via AWS-managed KMS keys (transparent to application).
- IAM access control with a least-privilege runtime assumed role.
- Parameter versioning enables rollback and controlled rotation.
- Simple API (GetParameter) with values cached in memory after retrieval.
- AWS-native service (no additional infrastructure to maintain).

Threat Model Clarification: Parameter Store does not protect against an attacker who gains shell access inside the production container while usable runtime AWS credentials are available to that container. An attacker in the container can call SSM GetParameter for any SecureString values allowed to the runtime assumed role. For secrets that must remain non-exportable even under container compromise, the system uses KMS/HSM-backed keys (non-exportable asymmetric signing keys) and IAM separation (normal web runtime cannot decrypt ballots).

Implementation: Parameter paths are organized by environment (`/footbag/prod/`, `/footbag/staging/`, `/footbag/dev/`).

In development, Parameter Store is replaced with environment-variable loading from a gitignored `.env` file at the repo root via `dotenv`. A committed `.env.example` template enumerates expected keys with placeholder values (the literal substring `changeme` is reserved for placeholder text and is rejected by production startup guards on `SESSION_SECRET`). Per-host non-secret runtime config and per-host operational secrets like `SESSION_SECRET` live in `/srv/footbag/env` on the production host (root:root 0600).

Secrets are fetched once at container startup via SecretsAdapter (SSM GetParameter in production, local JSON file in development).

Parameter Store contains:

- Stripe API keys (test/live by environment).
- Stripe webhook secret (HMAC verification).
- Email delivery configuration (if any), admin bootstrap tokens, and other exportable credentials and configuration that must not be committed to source control.

Per-host application secrets that are environment-unique and rotation-on-restart-acceptable may live directly in the host env file `/srv/footbag/env` (root:root 0600) rather than in Parameter Store. `SESSION_SECRET` is the canonical example: it is generated fresh per environment, never reused across staging and production, and rotated by editing the host env file and restarting the service. The application and the deploy script both reject any value containing the literal placeholder substring `changeme` or shorter than 32 characters. Rotation runbook: DEVOPS_GUIDE §5.8.

KMS is used for:

- JWT signing (`kms:Sign`, `kms:GetPublicKey`) – no JWT signing secret is stored in Parameter Store.
- Ballot envelope encryption (`kms:GenerateDataKey`, `kms:Decrypt` in tally role only) – no ballot master key is stored in Parameter Store.

Trade-offs:

- Manual rotation vs automatic (acceptable for a small number of secrets).
- AWS lock-in for secrets (acceptable given AWS infrastructure commitment).
- Runtime secret access now depends on explicit host bootstrap and runtime credential wiring on Lightsail.

Impact:

- SecretsAdapter abstracts Parameter Store in production and local JSON file in development.
- Cryptographic signing/encryption paths depend on KMS-backed adapters (`JwtSigningAdapter` for sessions today; `BallotEncryptionAdapter` for envelope encryption when ballots land), not Parameter Store.
- CloudTrail/CloudWatch monitoring should watch for unusual Parameter Store access patterns and KMS error rates.
- Parameter Store secrets rotate through new parameter version + controlled container restart / redeploy.
- KMS keys rotate through an explicit key-rotation procedure (update kid/public key cache; deploy archive verifier update if applicable).


## 3.7 Ballot Encryption with AWS KMS

Decision:

Ballots are submitted as plaintext over HTTPS and then encrypted on the server before persistence. For each ballot, the server requests a fresh data key from AWS KMS (GenerateDataKey) under a dedicated KMS CMK. The plaintext data key is used immediately to encrypt the ballot payload using AES-256-GCM and is not persisted. The encrypted data key (CiphertextBlob) is stored alongside the ballot ciphertext.

Ballots at rest consist only of: ciphertext, nonce (IV), authentication tag, encrypted data key, KMS key ID, and minimal metadata (election ID, member ID reference, timestamps). No plaintext ballot contents are persisted.

Decryption is performed only during controlled tally operations, using a separate privileged role that has kms:Decrypt permission. The normal web application runtime assumed role does not have `kms:Decrypt` and therefore cannot decrypt stored ballots, even if the container is compromised. Every ballot decryption is audit logged per the audit logging decisions.

Rationale:

- Envelope encryption removes the need to store an exportable symmetric ballot key in Parameter Store.

- KMS key material is non-exportable and protected by AWS-managed HSMs.

- IAM separation limits blast radius: the public web runtime can encrypt ballots but cannot decrypt them.

- AES-256-GCM provides confidentiality and integrity with a well-reviewed, standard construction.

Trade-offs:

- Requires KMS availability for ballot creation (GenerateDataKey) and for tally operations (Decrypt).

- Adds operational complexity: separate IAM roles and a controlled execution path for tallying.

- Per-ballot encrypted data keys slightly increase stored ballot size and code complexity.

Impact:

- Ballot schema adds encryptedDataKey and kmsKeyId fields.

- VotingService encrypts ballots using `BallotEncryptionAdapter.generateDataKey` (KMS-backed in production; locally-keyed in dev/test) + AES-256-GCM; no ballot key retrieved from Parameter Store.

- Tally operations run under a privileged admin/tally role with kms:Decrypt permission and are exposed only through explicit admin flows.

- AuditLogService records every decrypt operation (who/when/why) without logging plaintext.

Receipt Token Handling: Each accepted ballot generates a cryptographic receipt token that allows the voter to later confirm their ballot was included in the tally. The receipt mechanism follows the hash-before-storage pattern.

- The server generates a cryptographically random UUID v4 receipt token using crypto.randomUUID().

- The raw token is emailed to the member's verified address immediately after the ballot is accepted.

- The server stores SHA-256(token) in ballots_base.receipt_token_hash alongside the encrypted ballot. The raw token is never written to the database.

- receipt_token_hash_version supports future algorithm migration without re-issuing tokens.

Verification (M_Verify_Vote_And_View_Results): the member submits their raw token via the verification page; the server computes SHA-256(submitted) and queries WHERE vote_id = ? AND receipt_token_hash = ?. A row match confirms participation without revealing vote content. No rate-limiting is required because the token has 122 bits of entropy and is not linked to any member-enumerable identifier.

The receipt token is distinct from ballot *content*. "No plaintext ballot contents are persisted" (above) refers to vote selections; receipt tokens are participation metadata, not selections, and are handled separately under this hashing scheme.

Export: because the raw token is never persisted, the GDPR data export (M_Download_Data) cannot include it. The export includes vote participation metadata (vote ID, title, submission timestamp) with a note that receipt verification requires the original email.

## 3.8 Account Security Tokens

Decision:

Email verification tokens, password reset tokens, personal data export download-link tokens, and legacy account claim tokens are cryptographically random, single-use tokens, not JWTs. Tokens are generated with crypto.randomBytes(32) providing 256 bits of cryptographic randomness, encoded for URLs, and hashed before storage using SHA-256 so that the database never stores a usable raw token. This prevents account takeover if the database is compromised.

Semantics:

- Email verification token TTL: 24 hours.

- Password reset token TTL: one hour.

- Legacy account claim token TTL: 24 hours (configurable via `account_claim_expiry_hours`). The claim token carries a dual binding: `member_id` (the requesting authenticated account) and `target_legacy_member_id` (the `legacy_members` row being claimed). A claim token may only be consumed while authenticated as the same `member_id` that initiated the request; consuming while authenticated as a different account is rejected. `target_legacy_member_id` uses `ON DELETE NO ACTION`; `legacy_members` rows are never deleted in normal flow (they are marked claimed, not removed, per the three-table design).

- Tokens are single-use: on successful consumption, the token record is marked consumed (timestamp) and cannot be reused.

- Multiple outstanding tokens are allowed, but consumption invalidates only the consumed token; rate limiting prevents spam.

- Rate limiting: Password reset requests limited to five per email per hour, applied regardless of whether email exists in system to prevent enumeration attacks. Claim initiation and resend are rate-limited per requesting account, per target imported row, and per session/IP to prevent abuse of legacy mailboxes and limit side-channel enumeration.

- Rate limiting is in-process only; state is not persisted and resets on restart (acceptable for single-instance deployment).

Storage format: Store token_hash, member_id, token_type (email_verify, password_reset, data_export, account_claim), target_legacy_member_id (nullable; account_claim only), created_at, expires_at, used_at (nullable). Index on token_hash (unique) and on expires_at for cleanup.

Validation: A presented token is hashed and compared to stored hashes; validation requires used_at IS NULL and now \< expires_at. If hashes match and token is not expired or consumed, verification succeeds. Otherwise, verification fails with a generic error message that does not reveal whether the token was invalid, expired, or already used.

Cleanup: A background cleanup job runs daily to delete expired or consumed token rows (tokens older than 7 days).

Impact: Token generation/validation logic is centralized in an AuthService helper to avoid copy/paste drift across flows (verification, reset, onboarding).

## 3.9 Security, Privacy, and Historical Record Governance

Decision:

Privacy is part of the platform's security model. Current member data, discoverability, contactability, exports, rosters, participant lists, and imported historical identities must be governed by explicit visibility rules.

The platform preserves and publicly exposes official footbag history, including public event results, year archives, permanent honors such as Hall of Fame and Big Add Posse, and other explicitly approved historical-record surfaces such as world records.

Public historical discoverability does not authorize a public current-member directory, public current-member search, public current-member profiles, or public contact discovery.

Imported historical people and result-linked identities may appear publicly only as historical-record surfaces. They do not thereby become activated members, profile owners, searchable current members, or publicly contactable accounts.

Any public or member-visible data surface must follow privacy-by-design and data-minimization rules. Contact fields, roster visibility, participant visibility, exports, and discoverability must be scoped to the minimum audience required for the product use case.

Visibility taxonomy — the platform uses five tiers:

1. **Public official historical record** — official event results, year archives, HoF/BAP honors, world records, minimal historical-person pages needed to make public results intelligible.
2. **Authenticated current-member lookup** — logged-in-only search for current members; anti-enumeration; non-directory; minimal result fields.
3. **Role-scoped operational surfaces** — organizer participant management, club-leader rosters, workflow exports; scoped to role.
4. **Internal/admin only** — full member history, remediation/audit workflows, broad exports, identity resolution.
5. **Archived member-only legacy** — immutable old archive; authenticated only; no search; no public indexing.

Implementation note — derived statistics and incomplete historical data:

Official result facts, honor rolls, and approved record tables are primary historical sources. Derived statistics are secondary editorial outputs and must not be treated as canonical merely because data fields exist in storage. The platform must not publish misleading or false-precision historical statistics from incomplete datasets. Public or member-visible stats are justified only when they are useful and interesting for historians of footbag or clearly valuable to the community's official historical record, and either (a) the underlying source scope is sufficiently complete for the claim being made, or (b) the UI presents clear caveats about scope, missing data, and interpretation limits. Where those conditions are not met, the platform must prefer raw official results, honors, and record listings over aggregate summaries.

Two distinct risks apply to incomplete historical statistics. **Statistical accuracy risk:** misleading or uncaveated aggregates make false claims about real people's competitive records. **Privacy pressure risk:** misleading aggregates create pressure to over-link person-level identities to fill data holes, driving the system toward overexposure of person-level data. Both risks share the same policy response (caveat clearly or suppress) but are separate failure modes.

No auth-bypass toggles: environment variables must not gate route-level authorization behavior. Auth is either fully stubbed (with the stub designed to mirror the real path) or real. Boolean env toggles that change what content is served are not allowed.

Legacy migration security rules:

- Legacy passwords are never imported, stored, or used regardless of how they were stored on the legacy system.
- `legacy_email` is migration metadata only, not a login credential. It is used solely to deliver the one-time claim link during the self-serve claim flow.
- Mailbox control is the proof step for self-serve claim regardless of which identifier type (email address, username, or member ID) the member submitted. Submitting a username or member ID still requires proving control of the matched `legacy_email` before any merge occurs.
- Imported placeholder rows cannot log in, are not searchable, and do not receive any member communications before claim.

Rationale:

The platform handles real people's competitive history, identity, and contact information. Privacy violations in this domain carry reputational and potentially legal consequences. Treating privacy as part of the security model ensures that visibility rules are enforced at architecture boundaries rather than applied inconsistently across features.

Public historical records are legitimate and required: the footbag community's history belongs to the community. But historical discoverability is categorically different from current-member discoverability. The platform must maintain that distinction explicitly in both code and docs.

For normative policy detail, implementation rules, and reference tables, see `docs/GOVERNANCE.md`.

Cross-references:

- **2.5** Immutable Audit Logs with Privacy-safe Fields — extend audit guidance to member-search, export, and sensitive visibility checks.
- **3.2/3.4** JWT Sessions / Token Lifecycle — session and auth boundaries protect current-member-only surfaces, not public historical record surfaces.
- **6.4** Legacy Archive — member-only because it contains private legacy member information; explicitly distinct from public migrated historical results.
- **6.5** Legacy Data Migration — imported people and imported stat fields do not automatically become public current-member data or authoritative public statistics.
- **7.1** Dev/Prod Parity — forbids auth gating by env boolean toggles that bypass the real session path.
- **8.3** Rate Limiting and Abuse Prevention — anti-enumeration controls for authenticated member search and any record/search surfaces vulnerable to scraping.

## 3.10 Trust-proxy strategy

Decision:

Express's `trust proxy` setting in production is the named-range string `'loopback, linklocal, uniquelocal'` (loopback, link-local, RFC1918). Integer hop-count and the boolean `true` form are rejected. The setting is environment-variable driven via `TRUST_PROXY` in `/srv/footbag/env`, with the named-range string as the production default in `src/config/env.ts`.

Rationale:

- The structural property "the immediate peer is a private/loopback IP" matches the deployment topology: nginx peers Express over the docker bridge (172.16/12, inside `uniquelocal`); CloudFront and any external caller terminates at nginx, not Express. A trusted-peer test is therefore equivalent to a "this came through nginx" test.
- Integer hop-count form (e.g. `2`) breaks silently if an inline service is added or removed. Named-range form is stable under topology changes that preserve the private-peer property.
- The `true` form trusts every peer, which would honor `X-Forwarded-For` from a public-IP attacker if origin firewall enforcement ever fails open. Named-range form fails closed: a public-IP peer's spoofed XFF is rejected.

Requirements:

- Production default lives in `src/config/env.ts`. `docker-compose.prod.yml` sets `TRUST_PROXY` explicitly to the same string; the explicit set is documentation, not config redundancy.
- Tests exercise the compiled trust function with crafted addresses (loopback peer + spoofed XFF, public peer + spoofed XFF) so a regression that broadens the trust set is caught regardless of the integration test's peering posture.

Trade-offs:

- Adds a topology assumption (nginx is on the docker bridge inside RFC1918). Any move to a multi-instance or non-bridge networking model must re-evaluate trust scope.
- Does not protect against an attacker who can reach nginx directly (i.e. bypass CloudFront and the Lightsail firewall). Defense-in-depth via §3.11 origin-verify and the Lightsail port-80 prefix-list firewall closes that surface.

Impact:

- Auth and rate-limit middleware key on `req.ip`; trust-proxy correctness directly bounds the brute-force surface.
- Login rate limiting partitions on `req.ip`, so spoofed XFF would let an attacker target the victim's IP with throttling while making unbounded attempts from their own.

## 3.11 Origin-verify shared-secret gate

Decision:

CloudFront injects an `X-Origin-Verify` header on every origin request. The value is a 64-character lowercase hex shared secret stored in SSM (`/footbag/{env}/secrets/origin_verify_secret`, `SecureString`, KMS-encrypted) and generated by the `random_id.origin_verify_secret` Terraform resource. nginx returns 444 (silent close) on any direct-to-origin request whose header is missing or wrong. The host's `/srv/footbag/env` mirror of the secret is rewritten by the deploy remote-half on every deploy from the canonical SSM value.

Rationale:

- The Lightsail static IP and origin DNS hostname are publicly resolvable; CloudFront is not the only network path to nginx. Without an authentication signal at the origin, an attacker who reaches port 80 can bypass CloudFront's security and reach Express directly.
- A shared secret in a private header is operationally simpler than mTLS or signed-request schemes for a single-CDN single-origin topology. CloudFront natively supports `custom_header` injection; nginx natively supports `if ($http_*)` matching.
- Terraform-managed value (`random_id.hex` referenced directly, no `lifecycle.ignore_changes`) closes the bootstrap-placeholder window where a hand-typed `"TODO-..."` placeholder would otherwise be publicly committed and live in CloudFront until the operator manually rotates.

Requirements:

- Secret format is exactly `^[0-9a-f]{64}$`. The nginx render shim (`docker/nginx/40-render-nginx-conf.sh`) shape-validates before substituting; mismatch fails container startup before the gate is rendered.
- Rotation is `terraform apply -replace=random_id.origin_verify_secret` followed by a deploy. Manual `aws ssm put-parameter --overwrite` is not the canonical path because Terraform reverts it on next apply.
- The deploy remote-half re-fetches SSM on every deploy and atomically rewrites the env-file line so a Terraform-driven rotation propagates without an operator step.

Trade-offs:

- A leaked secret bypasses the gate until rotated. Mitigation: the secret is one of three perimeter layers; the Lightsail port-80 CloudFront-prefix-list firewall and the trust-proxy named-range trust set are the others. Belt-and-suspenders, not single-point-of-failure.
- A 30-to-90-second window exists during rotation where CloudFront sends the new secret and nginx still expects the old (every CloudFront request returns 444). Acceptable for an infrequent per-environment rotation; the rotation runbook in DEVOPS_GUIDE §5.9 sequences the two commands adjacent.

Impact:

- nginx is the enforcement point; Express is unaware of `X-Origin-Verify`.
- DEVOPS_GUIDE §5.9 holds the rotation runbook.
- The secret never appears as a literal string in committed code or docs.

## 3.12 Security header layering

Decision:

Helmet middleware in Express (`src/app.ts`) is the single source of every security response header (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, Origin-Agent-Cluster, X-Powered-By removal, and CSP). nginx and CloudFront add no security headers; nginx-config templates do not introduce `add_header` lines.

Rationale:

- Single source of truth: headers live next to the code that knows whether the response is HTML, JSON, or an asset, and whether the user is authenticated.
- Per-response variation (e.g. `Cache-Control: private, no-store` for authenticated responses) is naturally expressed as middleware, not as CDN/proxy config.
- nginx and CloudFront layers stay focused on routing, caching, and origin authentication, not on response content shape.

Requirements:

- Integration tests assert the helmet header set on a representative public route and a health route (`tests/integration/security-headers.test.ts`).
- HSTS preload is conditional on the custom domain landing; with the CloudFront default URL as the public host, preload is off because the `*.cloudfront.net` domain is not eligible for the HSTS preload list.

Trade-offs:

- Multiple application services would each need to import the same helmet config; mitigated by keeping the config in a single module.
- CDN-cached static assets bypass Express and do not carry Express-set headers; static-asset cache behavior must be reviewed when CDN config changes.

Impact:

- Adding a new security header is a code change in `src/app.ts`, not a CDN or nginx config change.
- Reviewing nginx-template changes includes a check that no `add_header` directive has been introduced.

## 3.13 Host header pinning at nginx

Decision:

nginx pins the upstream `Host` header to a configured canonical value via `proxy_set_header Host ${PUBLIC_HOST}` in both location blocks (`/health/` and `/`). `PUBLIC_HOST` is rendered by `docker/nginx/40-render-nginx-conf.sh` from `PUBLIC_BASE_URL`. Express therefore always sees the canonical hostname on `req.hostname`, regardless of which domain the viewer used.

Rationale:

- The threat is Host-header injection: a viewer-supplied `Host` flowing into code that builds absolute URLs from `req.hostname` (canonical case: password-reset email links). Pinning at nginx normalizes the value at the perimeter so downstream code is structurally safe, not enforcement-dependent.
- A CloudFront distribution legitimately serves traffic on multiple hostnames (custom CNAME, the default `*.cloudfront.net` domain, future aliases). An allowlist that enumerates accepted hosts is fragile across topology changes; pinning is invariant.
- nginx already speaks HTTP host conventions and owns the upstream proxy contract. Pushing the policy down to Express duplicates a perimeter concern.

Requirements:

- nginx container receives `PUBLIC_BASE_URL` via compose env (`docker/docker-compose.prod.yml` fail-fast `:?`; `docker/docker-compose.yml` defaults to `http://localhost`).
- `40-render-nginx-conf.sh` derives `PUBLIC_HOST` from `PUBLIC_BASE_URL` (strips scheme, port, path), validates the result as `[a-z0-9.-]+`, and substitutes via sed into both `proxy_set_header Host` directives.
- `PUBLIC_BASE_URL` is the same canonical-host source the app reads via `config.publicBaseUrl`, so nginx and Express agree by construction.

Trade-offs:

- Policy lives in nginx config, not unit-testable TypeScript. Rendered output is verifiable via the shim's dry-run path.
- Multi-domain support (e.g. www. + apex on the same origin) requires per-server-block nginx routing rather than a single `PUBLIC_HOST`. Not needed today; defer.

Impact:

- `req.hostname` is always the canonical value. Password-reset, email-verify, and canonical-redirect URL builders can use it directly without external Host-header validation.
- Viewer-supplied `Host` (via the CDN default domain or any alias mapped to this distribution) is normalized at the perimeter, not rejected.

# 4. Front-End / UI Technology

## 4.1 Server-rendered HTML with Handlebars Templates

Decision:

All primary pages are rendered on the server using Handlebars templates and strongly-typed view models surfaced through TypeScript controllers and shaped by the service layer.

Home-page exception note:
The Home page may use richer editorial composition and limited client-side media behavior (for example image/video treatments, inline embeds, or motion treatments) within the same Express + Handlebars + vanilla TypeScript stack. This does not authorize a separate SPA architecture, a separate Home-only framework, or a separate chrome/navigation system.

Rationale:

- Handlebars is logic-light and easy for non-expert volunteers to understand.

- Server rendering works on all devices and fits the CloudFront caching model.

- Simplicity-first design calls for a standard, non-exotic stack.

- Handlebars templates with vanilla TypeScript for interactivity provides optimal balance of simplicity, maintainability, and sufficiently meets all requirements for the use cases.

- Service-shaped page models keep templates cleaner and make page contracts easier to document in the View Catalog.

Alternatives Considered:

- Lit Web Components (islands architecture): Rejected for Phase 1 due to build tooling complexity (bundlers, TypeScript compilation), web component learning curve for volunteers, and risk of scope creep toward SPA patterns.

- Enhance Framework: Rejected due to framework lock-in concerns, smaller contributor pool, and learning curve. Philosophy alignment appealing but does not justify long-term commitment for platform where most pages are simple content and forms.

- React/Vue/Angular (SPA frameworks): Rejected due to complexity overhead (heavy build tooling, state management, client routing). If the goal were SSR with hydration, frameworks like Next.js/Remix are designed for that, but they still require JavaScript and introduce significant framework surface area. The project achieves SSR with Express + Handlebars and uses minimal client TypeScript for interactivity.

Trade-offs:

- We do not get highly dynamic page state by default. We do not need this.

Impact:

- Each screen in the UI Requirements document maps to a template + view model pair, plus an Express controller.

- Any proposal to introduce React/Vue/Angular or a SPA architecture is a major change requiring a new decision.

## 4.2 JavaScript Required for Interactivity

Decision:

JavaScript provides client-side usability enhancements (autocomplete, media previews, dynamic filters, some validation checks, and limited page-specific interactive media behavior) on top of server-rendered HTML. Core pages and form submissions function without JavaScript, as server-side validation is authoritative and all forms submit via native browser POST regardless. JavaScript acts as a client-side validation gate to improve UX by catching errors before submission, not as the submission mechanism. The one functional exception is Stripe's hosted checkout page, which requires JavaScript as a third-party dependency outside this platform's control.

For the Home page, richer media/interactivity may be added within this same progressive-enhancement model. It must not become a separate client-side application architecture.

Rationale:

- Simpler development: Single interaction path eliminates dual server-only vs client-enhanced implementations.

- Volunteer contributors maintain one implementation per feature, reducing complexity and long-term maintenance burden.

- SSR provides fast first paint and CloudFront caching; JavaScript provides validation gate before submission.

- Standard web pattern (POST/redirect/render) is familiar, debuggable, and works with browser back button.

- JavaScript is the validation gate, not the submission mechanism.

Trade-offs:

- Users who explicitly disable JavaScript lose client-side validation and usability enhancements but can still submit forms and navigate the site (server-side validation remains authoritative). Stripe checkout requires JavaScript and is unavailable without it.

- Page reloads visible on form submission (no optimistic UI updates).

- Cannot provide "modern SPA feel" with instant transitions.

- Legacy archive (archive.footbag.org) remains static HTML-only.

Implementation:

- Forms use traditional HTML form elements with action and method attributes.

- JavaScript validation runs on submit event; prevents submission if validation fails.

- On successful validation, browser performs native POST submission.

- Controllers handle POST, validate server-side, and either redirect (success) or re-render form with errors (validation failure).

- The \<noscript\> tag displays: "This site requires JavaScript for interactive features. Please enable JavaScript in your browser settings."

- Forms work like this. User fills form. User clicks submit. JavaScript validates (required fields, format checks, etc.). If invalid: highlight errors, prevent submission. If valid: allow native browser POST. Server validates again (authoritative). Server returns redirect (success) or re-rendered form (errors). This is simple, maintainable, and aligns with volunteer contributor skill expectations.

Browser Support:

Chrome/Edge 90+, Firefox 88+, Safari 14+, iOS Safari 14+, Chrome Android 90+. JavaScript must be enabled. This baseline provides 95%+ market coverage.

Alternative Considered:

Progressive Enhancement rejected because: Doubles development effort and testing surface. Many modern sites require JavaScript; handling the exceptional case is not worth the ongoing complexity for this project.

## 4.3 Explicit UI Restrictions

Decision:

The UI intentionally avoids certain flashy or high-complexity design and interaction patterns, in order to keep the system simple, accessible, and volunteer-friendly. Specifically, the following are out of scope given the technology constraints: No SPA frameworks (React, Vue, Angular, etc.) or client-side routers. No infinite scroll that lacks a straightforward paginated fallback. No parallax scrolling effects or scroll-based animation frameworks. No auto-playing background videos or audio on core pages. No UI flows that rely solely on hover, drag-and-drop, or complex gestures without keyboard/desktop-friendly alternatives. No heavily customized JS-only form controls that break standard keyboard/screen-reader behavior. No dependence on heavyweight front-end build tools beyond what is required to bundle TypeScript and CSS.

Rationale:

- UI Requirements emphasize accessibility, responsiveness, and keyboard operability.

- Project goals explicitly state No exotic frameworks.

- Avoiding these patterns keeps code and tech stack as simple as possible.

Trade-offs:

- The site will feel more like a classic, modern website than a slick web "app."

- Designers must work within a more constrained visual and interaction vocabulary, emphasizing clarity and content over spectacle.

Impact:

- Documentation for contributors explicitly states these constraints so that front-end work remains consistent with the overall philosophy.

## 4.4 Accessible, Responsive HTML-first Design

Decision:

Pages are built with semantic HTML and responsive layouts that work across devices. All interactive elements must be reachable and operable via keyboard. When JavaScript drives interactions, templates and client code must preserve accessibility via ARIA labels, focus management, and keyboard navigation support.

Rationale:

- Accessibility is a core requirement. Modern screen readers and assistive technology operate within JavaScript-enabled browsers; users with JavaScript disabled (including a subset of users requiring assistive technology) cannot access the interactive site.

- Responsive design supports global access from a wide variety of devices.

Trade-offs:

- Some visually complex layouts or hover-only interactions are constrained or require alternative representations.

- Implementing proper ARIA semantics and keyboard ordering requires discipline.

Impact:

- Templates must use appropriate elements (headings, labels, buttons, lists) and avoid div-only structures for interactive controls.

- CSS must handle responsive breakpoints without relying on JavaScript for layout.

## 4.5 Front-end TypeScript for Interactivity

Decision:

Client-side TypeScript handles user interactions: validation before form submission, dynamic form behavior, client-side previews, and autocomplete (phase 2 optional). Pages are server-rendered; TypeScript attaches event handlers and manages client behavior on top of server-rendered HTML. Forms submit via traditional browser POST with full-page reloads.

Rationale:

TypeScript provides type safety and improved developer experience for client code while keeping dependencies minimal. Standard POST/redirect/render pattern is simple, debuggable, and familiar to volunteer contributors. Compilation to JavaScript ensures broad browser compatibility. Browser back button works correctly (no client-side routing state to manage).

Trade-offs:

- No framework-provided state management or optimistic updates.

- Compilation adds build step, but provides compile-time error checking and consistent bundling.

- Full-page reloads visible on submission (network latency visible to user).

- Cannot provide optimistic UI updates or instant client-side transitions.

Implementation:

- Forms use standard HTML form elements with action="/path" method="POST".

- TypeScript attaches event listeners to validate on submit event.

- If validation fails: prevent default submission, highlight errors, user corrects and resubmits.

- If validation passes: allow native browser submission (no event.preventDefault(), no fetch()).

- Server receives POST request, performs authoritative validation, returns redirect or re-rendered form.

Impact:

- Build pipeline compiles TypeScript into JavaScript bundles referenced by hashed filenames.

- Forms submit via standard POST; JavaScript validates before allowing submission.

- Server responses remain source of truth for persisted state.

- Controllers return HTML pages (not JSON) for standard navigation flows.

- Testing validates POST/redirect/render flows with full request/response cycles.

# 5. Back-End Services and Patterns

## 5.1 Node.js with TypeScript

Decision:

All application logic (controllers, services, adapters) is implemented in Node.js with TypeScript.

Rationale:

- Widely known stack with abundant documentation.

- TypeScript improves readability and code development (compile-time debugging).

Trade-offs:

- Requires a compilation step and some TS familiarity for contributors.

- Runtime is single-threaded per process; concurrency model relies on the event loop.

Impact:

- Repository includes TS configuration and build steps for both server and client.

- Adapters and services expose typed interfaces used by controllers and tests.

## 5.2 Express-based HTTP Controllers

Decision:

Express is used as the HTTP framework for routing, middleware, and request handling. Controllers are thin wrappers that delegate to business services and rendering surfaces.

Controllers own HTTP concerns only: request parsing, middleware coordination, auth/session boundary enforcement, choosing the response type, and invoking rendering or redirect paths. Controllers do not own business rules, service-boundary decisions, page-model shaping beyond trivial glue logic, or ad hoc route-domain interpretation.

Rationale:

- Express is simple, mainstream, and well-documented.
- Keeps HTTP concerns (routing, headers, status codes) separate from business logic.
- Thin-controller discipline makes the service catalog and page/view contracts more stable over time.

Trade-offs:

- Does not provide advanced framework features (e.g., DI containers) out of the box.
- Requires explicit wiring for validation, error handling, and auth checks.
- Requires discipline to prevent controller convenience logic from expanding over time.

Impact:

- Routes map method + path to controller functions.
- Middleware layers handle JWT validation, rate limiting, and similar cross-cutting concerns.
- Controllers should remain small and easy to reason about.
- Complex page composition belongs in services or explicitly owned page-model builders, not in controllers.

Authorization Middleware Pattern:

All role-based authorization occurs in Express middleware after JWT validation. The pattern uses a middleware chain: first requireAuth validates the JWT and confirms decoded claims exist, then other app-based authorization requirements (for example member tier) are checked, then the controller executes. Middleware functions return 401 for missing authentication or 403 for other app-permission failure. Controllers apply these rules to routes that need protection. Services implement defense-in-depth by also validating app-based autorization rules, preventing application errors from exposing restricted features to unauthorized members.

## 5.3 Dedicated Adapters for External Services

Decision:

All communication with AWS services (S3, SES, SNS, Parameter Store, CloudFront), Stripe, and other external systems is encapsulated in dedicated adapter modules. Services never call SDKs directly.

Rationale:

- Centralizes error handling, retries, logging, and configuration.

- Makes it possible to stub or mock external services in dev and tests.

Trade-offs:

- Additional indirection and boilerplate when compared to calling SDKs directly.

- Adapter boundaries must be maintained consistently over time.

Impact:

- There is a clear "adapter" layer in the codebase; any new external integration must add an adapter.

- Service-level tests can mock adapters; integration tests validate adapter + SDK behavior end-to-end.

- For URL Validation, no server-side fetching; validate https-only + block private/reserved + Safe Browsing lookup; deterministic dev stub.

## 5.4 Outbox Pattern for Emails

Decision:

The platform sends all transactional and bulk email via AWS SES using an Outbox pattern.

Rationale:

- Outbox pattern decouples user-facing flows from SES latency and transient failures.

- A small set of explicit MailingList and MailingListSubscription entities provides a clear, query-friendly model while staying lightweight and simple.

- Security-critical and governance-critical flows such as account verification, password reset, and election communications rely on reliable email delivery with retries and auditability, which the Outbox pattern provides.

- Member-controlled subscription preferences, stored via MailingListSubscription and projected into Member.subscriptions, provide transparency and control.

- SES bounce and complaint handling keeps email lists clean automatically by updating MailingListSubscription records.

- Simple metrics and alarms provide operational visibility without heavy analytics infrastructure.

Trade-offs:

- Requires running a separate worker process and monitoring its health.

- Email delivery is not instantaneous; there can be a delay due to polling and retries.

- No advanced email marketing features like A/B testing, detailed open/click tracking, or sophisticated segmentation.

- Mailing list counts are computed by aggregating MailingListSubscription records rather than stored denormalized in MailingList; this keeps the model simple but requires scan-based aggregation for some admin views.

Impact:

- Subscription email is modeled with lightweight MailingList and MailingListSubscription entities: MailingList defines each subscription category (for example, newsletter, board-announcements), and MailingListSubscription records each member’s status (subscribed, unsubscribed, bounced, complained) for a list.

- Member.subscriptions is a simple projection of a member’s current MailingListSubscription slugs, used mainly by the profile UI.

- Bounce and complaint notifications update MailingListSubscription records (and, indirectly, Member.subscriptions), and simple metrics and alarms are maintained for delivery health.

- We intentionally avoid marketing automation and analytics tooling.

- Controllers only enqueue outbox entries; they never call SES directly.

- Services enqueue emails by creating outbox entities with recipient, subject, body, status. The background worker scans for pending entries on a system-wide configurable interval (default: every 30 seconds; configuration key `outbox_poll_interval_seconds`). After successful send via SES, it updates entry status. After failure, it increments retryCount and updates status. Maximum retries are controlled by the system-wide configuration value outbox_max_retry_attempts (not a per-row outbox override field); when retryCount reaches the configured limit, the worker moves the entry to dead_letter for admin review.

- Member profiles include subscription preferences derived from MailingList and MailingListSubscription: the UI renders checkboxes from MailingList records that are flagged as member-manageable (for example, newsletter, board-announcements, event-notifications, technical-updates in Phase 1), and changes are applied by updating MailingListSubscription and keeping Member.subscriptions in sync.

- SES webhooks update MailingListSubscription records (status, bounce/complaint fields) and any global member email status as needed, and the projection in Member.subscriptions is updated accordingly so future sends skip problematic addresses. SES bounce and complaint notifications arrive via SNS; the webhook endpoint verifies the SNS message signature against the AWS-published signing certificate before processing, and rejects any message that fails signature verification. This parallels the Stripe webhook signature verification in §6.1.

- Bounce state transitions: hard bounces (SES permanent-failure type) auto-flag the `MailingListSubscription` as `bounced` and block further sends to that list for that member. Soft bounces (SES transient-failure type) do not auto-flag on a single event; the worker tracks a sliding bounce count per address and flags as `bounced` only after a configurable threshold (USER_STORIES key `soft_bounce_threshold`). Complaints auto-flag immediately and block all lists for that member pending admin review.

- Bounce and complaint webhook idempotency: inbound SNS messages carry a `messageId`; the webhook handler tracks processed `messageId` values in a `ses_events` table with `messageId` as primary key. Duplicate arrivals return 200 immediately without reprocessing. Parallel to the `stripe_events` idempotency in §6.1.

- Alerting: bounce rate exceeding `bounce_rate_alarm_threshold` (USER_STORIES) and complaint rate exceeding `complaint_rate_alarm_threshold` (USER_STORIES) emit CloudWatch alarms per §8.2.

- Member soft-delete behavior for subscriptions and outbox: during the grace period, `MailingListSubscription` state (including `subscribed`, `unsubscribed`, `bounced`, and `complained` flags) is frozen and preserved. The soft-deleted member cannot change subscriptions because the account is inaccessible. New outbox entries are not enqueued for a soft-deleted member; queued entries addressed to them at the time of soft-delete are moved to `dead_letter` with reason `recipient_soft_deleted`. Missed sends during the grace period are not replayed.

- On member-initiated restore within the grace period: subscription states resume exactly as they were at soft-delete time. Intent is preserved; no re-opt-in is required. Outbox enqueuing reactivates immediately. Bounce and complaint flags persist across soft-delete and restore because they are facts about the email address, not about member intent.

- On PII purge (grace period expiry or explicit purge): `MailingListSubscription` rows are hard-deleted along with other member PII. Restore is no longer possible after this point.

- Admin dashboard shows basic email metrics: sent count, bounce rate, complaint rate, overall delivery health.

- Operational dashboards track pending, sent, and failed outbox entries and expose a “pause sending” emergency toggle.

- Email records are inserted into the outbox table within the same transaction as the business operation that triggers the email. This guarantees that if the transaction commits, the email is queued; if the transaction rolls back, neither the event nor the email record exists.

- Outbox body scrub (APP-019): security-sensitive emails (account verification, password reset, data-export download links, voting receipt tokens) carry single-use tokens in the body text. After successful send, the worker MUST set `outbox_emails.body_text = NULL` so the raw token does not persist in the live DB or in DB backups beyond the moment of delivery. The schema column is nullable specifically to support this scrub. Subject lines never contain tokens by design, so they are preserved.

## 5.5 Canonical Email Addresses

Decision:

The platform uses a small, enumerated set of `@footbag.org` addresses with distinct, non-overlapping purposes. All platform code, documentation, and terraform configuration references these canonical addresses. New email addresses are added to this list before they are introduced into the codebase.

Outbound send is handled by AWS SES (see §5.4). Inbound receive for all role addresses is handled by Cloudflare Email Routing, which forwards each address to an operator-designated personal or ops inbox. SES is not used for inbound ingestion.

| Address | Purpose | Direction | Used by |
|---|---|---|---|
| `admin@footbag.org` | Legal, administrative, privacy, copyright, and trademark contact for members and the public | Receives | `/legal` page (Privacy, Terms, Copyright sections); operator of record contact |
| `announce@footbag.org` | IFPA community announce list; a Tier 2+ member may send here; used as both sender and recipient for archived community announcements | Sends + Receives | `CommunicationService.sendAnnounceEmail` (`M_Send_Announce_Email`) |
| `brat@footbag.org` | Legacy footbag.org webmaster (operator of record for the pre-migration site); must remain deliverable through and after cutover for migration coordination and any ongoing legacy-recovery correspondence | Receives | Carried over from the legacy site; in-use contact for the current webmaster |
| `directors@footbag.org` | IFPA Board of Directors contact for governance, board inquiries, and director correspondence | Receives | Carried over from the legacy site; in-use public contact for the Board |
| `noreply@footbag.org` | Transactional sender (account verification, password reset, receipts, system notifications); never monitored, never a reply target | Sends | `CommunicationService.processSendQueue` via SES |
| `ops-alert@footbag.org` | Operational alarm recipient (system health, backup failures, worker errors, SES bounce/complaint thresholds) | Receives | Terraform alarms (CloudWatch), `OperationsPlatformService` alarm flows |
| `sanctioning@footbag.org` | Event sanctioning contact for organizers applying for IFPA-sanctioned events and related correspondence | Receives | Carried over from the legacy site; in-use public contact for event sanctioning |

Rationale:

- A single canonical list prevents drift between code, docs, and terraform. A future maintainer or handover to IFPA can find every address in one place.
- Splitting receiving addresses by purpose (admin, announce, ops-alert) allows selective filtering, forwarding, and escalation without comingling legal inquiries with ops alerts or community mail.
- A dedicated `noreply@` sender preserves the convention that transactional messages are not a reply channel. Members who need to respond are directed to the appropriate purpose-specific address.
- Privacy and legal requests (GDPR export, CCPA deletion, copyright inquiries, trademark questions) are consolidated under `admin@footbag.org`; the `/legal` page surfaces this address in all three sections.

Trade-offs:

- Additional alias configuration at Cloudflare Email Routing (one forwarding rule per receive address rather than one catch-all). Cloudflare Email Routing provides forwarding only, with no hosted mailboxes or shared web UI; if a role address later needs collaborative shared-inbox workflows, a hosted provider (for example Google Workspace, Fastmail, Zoho Mail) may replace Cloudflare for that specific address without changing the canonical list.
- Requires discipline in code review to avoid introducing new addresses without updating this list.

Impact:

- `admin@footbag.org` is named in the `/legal` page Privacy, Terms, and Copyright sections as the legal/administrative contact.
- `announce@footbag.org` is documented in `docs/USER_STORIES.md` (`M_Send_Announce_Email`, Tier 2 benefits) and `docs/SERVICE_CATALOG.md` (`CommunicationService.sendAnnounceEmail`).
- `noreply@footbag.org` and `ops-alert@footbag.org` are referenced as TODO values in `terraform/staging/ssm.tf`, `terraform/production/ssm.tf`, and `terraform/production/terraform.tfvars.example`; activation of these addresses is part of the Phase 4 email activation work.
- Cloudflare Email Routing is configured with one forwarding rule per receive address (`admin@`, `announce@` inbound, `brat@`, `directors@`, `ops-alert@`, `sanctioning@`) pointing to an operator-designated destination inbox. `brat@`, `directors@`, and `sanctioning@` are in-use contacts carried over from the legacy site and must be routed at cutover so no mail is lost.
- Any additional address (e.g., `privacy@`, `legal@`, `support@`, `info@`) must be justified against this list and added here before it is introduced. The default is to route new purposes to `admin@footbag.org` unless volume or scope warrants a split.
- Handover to IFPA: ownership of these addresses transfers as part of the operational handover; the addresses themselves and their purposes do not change.

## 5.6 Dev and Staging Email Preview

Decision:

Email-gated landing pages (e.g., post-registration `/register/check-email`, and future equivalents for password reset and change-email) render a conditional in-page preview card whose content is driven by two configuration flags: `config.sesAdapter` and `config.sesSandboxMode`. A single shared service (`simulatedEmailService.getEmailPreview()`) and Handlebars partial (`simulated-email-card`) produce the three rendering modes so every email-gated page in the application uses the same preview pattern.

| `sesAdapter` | `sesSandboxMode` | Card | Purpose |
|---|---|---|---|
| `stub` | (ignored) | Dev preview | Table of captured `StubSesAdapter` in-memory messages with subject, body, and extracted action link. Newest first. Empty state when no messages have been sent. |
| `live` | `true` | Staging sandbox warning | Warning card naming the SES sandbox constraint, the tester-allow-list contact, and the four AWS SES mailbox-simulator recipient addresses (success, bounce, complaint, suppressionlist) with a link to AWS documentation. |
| `live` | `false` | (no card) | Real production. Page renders the standard "check your email" copy with no developer or staging affordance. |

Rationale:

- Dev needs to see the just-sent email inline to complete email-gated flows quickly. A separate dev-outbox page requires an extra navigation hop and hides the fact that an email was actually captured.
- Staging runs under AWS SES sandbox until production access is granted (see §5.4 and `docs/MIGRATION_PLAN.md` §28.8). Testers who register with an unverified address otherwise receive a silently broken flow: account is saved, no email arrives, no indication why. The staging card explains the constraint and steers testers to either the allow-list or the AWS mailbox simulator.
- Decoupling the sandbox-state signal (`SES_SANDBOX_MODE`) from the adapter choice (`SES_ADAPTER`) means a future staging-with-production-access or pre-prod-with-sandbox environment renders correctly without code changes.
- The AWS SES mailbox-simulator addresses (`success@`, `bounce@`, `complaint@`, `suppressionlist@` at `simulator.amazonses.com`) work in sandbox without recipient verification, do not count against the daily quota, and do not affect reputation metrics. They are the AWS-documented way to exercise delivery, bounce, and complaint paths during staging testing.

Requirements:

- `simulatedEmailService.getEmailPreview()` returns a discriminated-union view-model: `{mode: 'dev', messages}` when `sesAdapter === 'stub'`; `{mode: 'sandbox', contactEmail, simulatorAddresses, docsUrl}` when `sesAdapter === 'live'` and `sesSandboxMode === true`; `null` otherwise.
- The partial is reusable across any email-gated page. Controllers pass the result as `content.emailPreview` on the `PageViewModel`; the template renders the partial when the value is truthy.
- Dev-mode preview reads from the `StubSesAdapter` in-memory buffer, not from `outbox_emails`. This preserves the §5.4 body-text scrub contract: the scrub operates on the DB row, while adapter memory is scrub-exempt and holds the original content for the lifetime of the process.
- Sandbox-mode copy enumerates the four mailbox-simulator addresses explicitly. Testers do not need to consult AWS documentation to exercise delivery-path variants.
- `SES_SANDBOX_MODE` env var is boolean (accepts `1`, `0`, `true`, `false`), default `false`, fail-fast on any other value. The flag is ignored when `SES_ADAPTER === 'stub'`.

Trade-offs:

- Two SES-related env vars (`SES_ADAPTER` and `SES_SANDBOX_MODE`) instead of one. Separation is intentional: `SES_ADAPTER` chooses the code path; `SES_SANDBOX_MODE` signals the AWS account state. Conflating them would require a code change to handle post-production-access staging or pre-prod-with-sandbox combinations.
- An in-app dev preview rather than an external mail catcher (MailHog, Mailpit, Mailtrap) keeps local setup zero-dependency but means emails cannot be inspected in a real email client during dev. An operator who needs real-client rendering can point the staging host at a test inbox.

Impact:

- Currently wired on `/register/check-email`. Any future email-gated landing page (password-reset-sent, change-email-confirmation, announce-send-receipt, event-registration-confirmation) reuses the same service and partial.
- The previously separate `/internal/dev-outbox` page and its route, controller, service, template, and tests are retired.
- CommunicationService and the outbox worker are unchanged; the preview is a read-only view of `StubSesAdapter` memory in dev and a static warning in staging.

# 6. External Services and Integrations

## 6.1 Stripe Payments

Decision:

Stripe handles all credit card processing with separate Live/Test API keys per environment. IFPA acts as intermediary: platform collects event registration payments, holds funds, distributes to organizers post-event. No Stripe Connect automated payouts.

Rationale:

- Offloads PCI compliance to Stripe (no card data touches our systems).

- Test mode in dev/staging enables safe payment testing.

- Manual distribution provides IFPA oversight and reconciliation capability.

- This integration is required in order to process membership dues, event registrations, and donations.

The platform uses two distinct Stripe payment models:

- One-time payments (membership dues, event registrations, one-time donations): Implemented via Stripe Checkout in payment mode. State transitions are keyed by payment_intent_id. The enforced state machine is: pending → completed on payment_intent.succeeded; pending → failed on payment_intent.payment_failed; completed → refunded on charge.refunded.

- Recurring annual donations: Implemented via Stripe Subscriptions. The platform creates or reuses a Stripe Customer object for each member (stripeCustomerId stored on the member record) and creates a yearly Stripe Subscription via Stripe Checkout in subscription mode. The platform does not manage the billing schedule or retries. Stripe owns the annual renewal cycle, dunning configuration, and retry logic. Local state transitions are driven entirely by incoming webhooks: active on customer.subscription.created; a new payment record created on invoice.payment_succeeded; local status set to past_due on invoice.payment_failed; local status set to canceled on customer.subscription.deleted. The Stripe Billing dunning schedule (number of retries, intervals) is configured by a System Administrator in the Stripe Dashboard and is not replicated in application configuration.

Payment recurrence is derived from Stripe subscription linkage, not duplicated on individual payment rows. payments_base identifies recurring-donation charges via recurring_subscription_id and joins to the subscription tables for current subscription lifecycle state. The schema intentionally does not duplicate subscription recurrence fields (for example recurrence type/active/start state) on each payment row to avoid drift between payment records and subscription state.  

- Stripe webhook idempotency is enforced by tracking processed event IDs in a stripe_events table with event_id as primary key. When webhooks arrive, the handler first checks if the event_id already exists. If found, the handler returns 200 immediately without reprocessing, preventing duplicate tier upgrades, duplicate payment records, and duplicate refund processing. For one-time payments: insert into stripe_events first; on conflict return 200. In one DB transaction, load/update local payment by payment_intent_id. Apply a monotonic state machine; record last_stripe_event_created to ignore older events. For subscription events: insert into stripe_events first; on conflict return 200. In one DB transaction, load/update the local donation subscription record by stripeSubscriptionId and process the event type. Mark each event processed with attempts and last_error.

Trade-offs:

- Manual payout process creates administrative overhead.

- No direct organizer-to-participant payment flow.

- Future Stripe Connect integration will require architectural changes.

Impact:

- Payment adapter wraps Stripe SDK with environment-aware configuration.

- Webhook handler validates signatures and processes payment events.

- Payment reconciliation and distribution handled outside automated system.

## 6.2 CloudFront CDN

Decision:

Single CloudFront distribution fronts all content with different cache behaviors. All HTML responses from the Lightsail origin (public, mixed-state, and authenticated) use the AWS managed `CachingDisabled` cache policy (TTL 0/0/0): server-rendered HTML in this app frequently shapes content by viewer state (auth, role, tier, ownership), and per-route classification of cacheability would be brittle as the route surface grows; routing all HTML to the origin keeps cache decisions out of CloudFront and lets the Express middleware at `src/app.ts` enforce `Cache-Control: private, no-store` on every authenticated response without coordination with edge config. Static assets (CSS, JS, images) use the AWS managed `CachingOptimized` policy with content-hash filenames for long-lived edge caching. Health probes use `CachingDisabled`. Archive content uses 1-year TTL with origin S3 archive bucket and members-only access controls. Cache behaviors targeting S3 origins must omit `origin_request_policy_id` (or use only a policy that excludes `Host`).

Rationale:

- Reduces origin load by serving static assets and user-uploaded media from edge locations.

- Static assets use content-hash filenames enabling long-lived caching.

- Archive is immutable so extremely long cache is safe.

- For OAC-fronted S3 origins, omitting `origin_request_policy_id` is required because S3 uses the `Host` header for virtual-host bucket routing and OAC overrides only `Authorization`. Forwarding the viewer's `Host` (the CloudFront edge domain) to S3 makes S3 unable to identify the bucket and return generic `NotFound` before bucket policy evaluation.

Trade-offs:

- Cache invalidation required for emergency content changes.

- CloudFront costs proportional to traffic (acceptable at community scale).

Impact:

- Origin server sees fraction of actual traffic.

- Global latency improved significantly.

- Cache invalidation procedures must be documented in DevOps runbooks.

## 6.3 CloudFront Error Pages

Decision:

CloudFront is configured to serve custom error pages for server failures (5xx status codes). For GET/HEAD requests, when the Lightsail origin returns 500, 502, 503, or 504 errors (or is unreachable), CloudFront automatically displays a branded maintenance page stored in S3, informing users that the site is temporarily unavailable. State-changing requests (POST/PUT/DELETE) may instead fail with connection errors/timeouts and will not reliably receive the maintenance page.

Rationale:

Simplicity: Custom error pages provide graceful degradation during outages without a large maintenance burden. We assume a single-instance origin and accept occasional downtime as a trade-off for reduced complexity; availability is achieved through automated backups, rapid recovery procedures, and monitoring rather than redundant compute infrastructure.

Clear failure modes: With custom error pages, the system has two states: working or maintenance mode. Browsing requests (GET/HEAD) see either the live application or a clear maintenance message, while state-changing requests may fail with connection errors/timeouts during outages. This is easier to understand, monitor, and troubleshoot than hybrid read-only failover states.

Cost efficiency: Custom error pages cost \$0.10 per month (S3 storage for error page).

Trade-offs:

No content access during outages: Users cannot browse events, clubs, or media galleries when the Lightsail instance is down. They see only the maintenance page. For a community site where outages are rare and brief, this is an acceptable trade-off for significantly simpler operations.

No partial degradation: Unlike a static mirror approach, there's no "read-only" mode where some functionality remains available. The site is either fully operational or completely in maintenance mode.

Outage visibility: Browsing users (GET/HEAD) immediately see the maintenance page during failures, whereas a static mirror might allow continued browsing. However, this visibility is also a benefit for transparency about system status.

Impact:

Terraform Configuration: CloudFront distribution configured with error page responses:

- 500 Internal Server Error → maintenance.html (10 second cache TTL)

- 502 Bad Gateway → maintenance.html (10 second cache TTL)

- 503 Service Unavailable → maintenance.html (10 second cache TTL)

- 504 Gateway Timeout → maintenance.html (10 second cache TTL)

Short cache TTL ensures error pages don't persist after recovery.

S3 Bucket for Error Page: dedicated S3 bucket (footbag-error-pages) contains:

- maintenance.html - Branded maintenance page with Footbag.org styling

- error.css - Minimal styling

- logo.png - Footbag logo

CloudFront exit from maintenance is automatic. When Lightsail instance returns to health and responds with 2xx or 3xx status codes, CloudFront immediately resumes serving live content. No manual intervention required. Error page cache TTL of 10 seconds ensures stale error pages clear quickly after recovery. Restoring the origin may require admin intervention (restart/rollback/restore).

Alternative considered:

A static, read-only mirror of key site content (e.g., events, clubs, media galleries) hosted in S3 and configured as a secondary CloudFront origin (Origin Group failover) was evaluated as a way to preserve limited browsing during Lightsail outages. This approach was not selected.

## 6.4 Legacy Archive (old footbag.org)

Decision:

Legacy site HTML-only mirror to be preserved as static content in a dedicated S3 bucket, served via CloudFront at archive.footbag.org. Access restricted to authenticated members only. Legacy URLs redirect via 301 to archive equivalents.

Rationale:

- Preserves community history permanently without maintaining old database stack.

- Separate bucket isolates archive from active platform (security, billing).

- Members-only access protects (old) member contact information.

- 301 redirects preserve SEO value and existing links.

- All video content in the mirror has been converted to mp4 (all images converted to jpg).

- All Javascript in the mirror has been removed and made unnecessary.

Trade-offs:

- No search capability in archive (acceptable for static preservation).

- Migration was one-time capture; archive won't be refreshed.

- Authentication requirement means public can't browse history, because the content has private member data.

Impact:

- Redirect mapping maintained as simple text file.

- CloudFront distribution configured for archive origin and authentication.

- Archive bucket has restrictive IAM policies and no write access post-migration.

- Access to archive.footbag.org requires member login on the main site. Implementation uses Lambda@Edge viewer request function attached to the CloudFront distribution: Lambda@Edge checks footbag_session cookie (JWT from main site). Cookie domain set to ".footbag.org" (shared across main site and archive subdomain). If valid JWT: allow request to proceed to S3 origin. If invalid or missing: HTTP 302 redirect to https://footbag.org/login?return=archive.footbag.org.

- This approach reuses the main site's authentication system without duplicating member auth state. Lambda@Edge validates the session JWT using the exported public key from the KMS signing key (no shared secret at the edge). The public key is packaged with the function and refreshed as part of the JWT key rotation deployment procedure. Security Limitation: Lambda@Edge functions are stateless and cannot query the SQLite database. Therefore, archive access does NOT perform the passwordVersion database lookup that the main application uses to validate JWTs. A member who changes their password will have their main site sessions invalidated immediately, but their archive access remains valid until the JWT expires (up to jwt_expiry_hours, default 24 hours). This is an accepted trade-off given the read-only, static, member-only nature of archive content. 

## 6.5 Legacy Data Migration

Decision:

The platform absorbs legacy data from two sources before or at production go-live:

**Historical pipeline.** Persons, events, results, honors (Hall of Fame, BAP), clubs, club affiliations, and club leadership. Person truth comes from human-curated CSV files. Club data comes from mirror extraction scripts integrated into the same pipeline. The pipeline also creates historical person records for ~1,600 club-only members who never competed in events. A historical person may exist without a claimed modern account; historical data is published regardless. Bootstrap-eligible clubs are created at go-live with leaders in `club_bootstrap_leaders`. Leaders can manage the club once they register. If a leader has not registered, the first affiliated member who registers can accept leadership during onboarding (Tier 1+, no admin confirmation).

**Legacy member import.** All legacy registered member accounts are imported as rows in the `legacy_members` table. These rows hold the legacy-account identity and import-era profile snapshot as a permanent archival record; they cannot log in (there is no credential material in `legacy_members` at all) and do not appear in any current-member surface. The source is a one-time export from the legacy site webmaster, used first as a test load for validation, then as the final production import after write freeze. Legacy passwords are never imported or used.

The two sources share the same identity key (`legacy_member_id`) and converge via FK: `historical_persons.legacy_member_id` and `legacy_members.legacy_member_id` point at the same namespace, and a modern `members` row links into both at claim time via `members.legacy_member_id` and `members.historical_person_id`.

**Self-serve legacy claim flow.** A logged-in member visits "Link Legacy Account" in profile settings and submits a legacy identifier (email address, username, or member ID). The system looks up the matching imported placeholder row and, if eligible, emails a time-limited single-use claim link to the `legacy_email` on that row. Mailbox control is the proof step regardless of which identifier type was submitted. On confirmation, the merge transaction runs atomically: `legacy_member_id` and allowed profile fields are merged into the active account, tier entitlements are reconciled via the ledger, confirmed club affiliations are written to `member_club_affiliations`, bootstrap leadership may be promoted to `club_leaders`, and the imported placeholder row is deleted. User-visible messaging never reveals whether the submitted identifier matched zero rows, multiple rows, or an ineligible row.

**Tier handling.** Tier state is written as ledger rows in `member_tier_grants` at import time (`reason_code = 'migration.legacy_import'`) and reconciled at claim time if the imported tier exceeds the current tier (`reason_code = 'migration.legacy_claim_reconcile'`). No tier cache columns exist on `members`; all tier reads go through `calculateTierStatus(memberId)`.

**Operational sequencing.** The legacy site enters write freeze; the final export is imported; schema changes are applied to production; clubs are bootstrapped; DNS switches to the new platform. Rollback lever before DNS switch: abort and retry. Rollback lever after DNS switch: manual DNS reversion to the legacy site. No automated rollback is provided after the DNS switch.

Rationale:

- Separating the historical pipeline from the legacy member import allows historical content and clubs to proceed independently, reducing go-live risk.
- The imported-row model preserves legacy identity without granting premature access. Mailbox verification is the minimal proof step that is both secure and feasible given the data available.
- Club bootstrap ensures clubs are present on day one. Leaders can manage clubs once they register.
- Ledger-only tier handling eliminates the cache-sync complexity that existed in earlier designs and makes imported-row tier state auditable from day one.

Trade-offs:

- Members must take an active step to claim their legacy identity (cannot be auto-matched without mailbox verification).
- Members without access to their legacy email address must contact an admin for manual recovery.
- Club bootstrap depends on mirror-derived data quality; clubs with ambiguous or low-confidence leader data require admin review.
- No automated rollback after DNS switch; rollback requires manual DNS reversion and coordination.

Cross-references:

- **3.8** Account Security Tokens — `account_claim` token type, dual binding, `ON DELETE NO ACTION` on `target_legacy_member_id`.
- **3.9** Security, Privacy, and Historical Record Governance — legacy migration security rules (passwords never imported; `legacy_email` is metadata only; mailbox control is proof step).
- **6.4** Legacy Archive — the static mirror archive is separate from the migrated live data; archive access is authenticated member-only.

## 6.6 AWS Service Integration

Decision:

All AWS services (S3, SES, Parameter Store, KMS, CloudWatch) are accessed through dedicated adapter modules. No direct AWS SDK calls from business logic.

Rationale:

- Enables environment-specific configuration (dev, staging, prod buckets differ).

- Facilitates testing via adapter mocking.

- Centralizes error handling, retries, and logging for external calls.

- Maintains clean separation of concerns between business logic and infrastructure.

Trade-offs:

- Additional abstraction layer adds code volume.

- Adapters require maintenance when AWS SDKs change.

Impact:

- Services layer never imports AWS SDKs directly.

- Test strategy can mock adapters without AWS dependencies.

- Configuration changes isolated to adapter initialization.

## 6.7 Static Assets and CDN Strategy

Decision:

Static assets (CSS, JS, images) use content-hash filenames (e.g., app.a3f8b2c.js) enabling aggressive CloudFront caching (1-year TTL). Build process generates hashed filenames, updates references in HTML templates.

Rationale:

- Content-hash filenames make assets immutable (hash changes when content changes).

- Immutable assets enable long-lived caching without staleness concerns.

- Eliminates cache invalidation complexity.

- CloudFront edge caching dramatically reduces origin load.

Trade-offs:

- Build process must generate hashed filenames and update references.

- Old asset versions accumulate in S3 (cleanup required periodically).

- Deployment must be atomic (templates and assets must match).

Impact:

- Build pipeline includes asset hashing step.

- Template rendering resolves asset references to hashed filenames.

- CloudFront serves assets from edge with near-zero origin requests.

- S3 cleanup job periodically removes old content-hash versions older than 90 days. Each deployment generates new hashed filenames; old versions accumulate in S3 but are never referenced after HTML updates. Cleanup prevents unbounded storage growth while maintaining 90-day rollback window.

- Bundling Constraint: JavaScript is delivered as a single hashed bundle per page (or per feature area) to avoid partial-script-load failure modes. Code splitting is allowed only when it does not create broken intermediate states; a page must either be fully interactive (JS loaded) or clearly non-interactive with a \<noscript\> message.

Cache control header strategy:

- Static assets (CSS, JavaScript, images with content hashes): Cache-Control: public, max-age=31536000, immutable.

- Public cacheable HTML / public GET content (for example, public event listings, public galleries, non-personalized pages): origin emits Cache-Control: public, max-age=300, must-revalidate as a hint for browser-side caching. CloudFront's default behavior uses the AWS managed `CachingDisabled` cache policy per §6.2, so the response is not edge-cached. A high-traffic public route that warrants edge caching may receive a dedicated `ordered_cache_behavior` with a cache policy that respects this header.

- API endpoints, authenticated HTML, and any personalized/user-specific content: Cache-Control: private, no-store, set by Express middleware on every authenticated response. CloudFront's default cache behavior uses the AWS managed `CachingDisabled` cache policy for all HTML routes (public, mixed-state, and authenticated alike): the app frequently varies HTML by viewer state across many routes, and rather than per-route classification, all HTML is routed to origin so the middleware is the single mechanism for HTML cache control. Static assets (which never vary by viewer) continue to be edge-cached aggressively per the next bullet. User-uploaded media (`/media/*`) is edge-cached via a CloudFront cache policy that includes the query string in the cache key, supporting URL-versioned cache-bust (e.g. `?v={media_id}`).

- Public unauthenticated routes that render a single-use token in HTML (the password-reset form is the canonical example: it embeds the reset token in a hidden form field and in the form `action` URL) MUST also send `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache`. Without this, a shared HTTP proxy or browser back-button cache could capture an unconsumed token. The app middleware that sets `private, no-store` for authenticated responses does not apply here because the route is anonymous; controllers must set the headers explicitly on both the GET render and any 422 re-render that includes the token.

- Cache invalidation: After publishing event results or vote tallies, the system programmatically invalidates CloudFront cache for affected URLs using the CloudFront invalidation API. Manual cache purge for emergency updates is a System Administrator / DevOps operational action (AWS tooling/runbooks), not an Application Administrator UI control. Invalidation requests are batched where possible and limited to 1000 per month to control costs.

## 6.8 Image Processing

Decision:

Images are processed synchronously on upload to eliminate malware and generate two variants: Thumbnail (300×300 pixels) and Display (800px width), both stored as JPEG at 85% quality in S3. Original files are discarded after processing.

Rationale:

Re-encoding through the Sharp library destroys malware by converting images to raw pixels and back, discarding everything except visual content. This eliminates the need for antivirus scanning (ClamAV container, 500MB RAM, ongoing updates, performance overhead). Processing is synchronous, users wait 2-5 seconds for completion and receive immediate success or failure feedback, simplifying implementation by avoiding background workers and notification systems.

Multiple size variants optimize bandwidth and page load times. JPEG output at 85% quality balances visual quality with file size, achieving approximately 85% storage reduction per photo. Metadata stripping removes all EXIF data (GPS, camera info) and ICC profiles for privacy and security.

Security Pipeline:

- Format restriction: JPEG and PNG only (GIF excluded due to Sharp animation limitations)

- Magic byte verification: File headers must match declared type

- Size limits: Maximum 10MB file size, 4096×4096 pixels

- Re-encoding: Sharp converts to raw pixels and back, destroying malware

- Metadata stripping: All EXIF and ICC profiles removed

- Variant generation: 300×300px thumbnail, 800px width display (or smaller if original is smaller)

Trade-offs Accepted:

- Users wait 2-5 seconds during synchronous processing (acceptable for immediate feedback)

- Quality loss from 85% JPEG compression (acceptable for web display)

- No animated GIF support (use video embedding instead)

- No video file uploads (YouTube/Vimeo embedding reduces complexity and cost)

- Members cannot download original high-resolution photos (only processed variants available)

Benefits:

- Zero antivirus maintenance burden

- Standardized image quality across platform

- Simpler deployment (no separate antivirus container)

- 85% storage reduction per photo

- Immediate user feedback on upload success/failure

Impact:

Upload controller validates format and size limits. Image processing occurs server-side via Sharp library.

Malformed image protection: Attackers can upload crafted images with corrupted headers that cause image processing libraries to allocate excessive memory or enter infinite loops. Protection measures for synchronous image processing:

Pre-processing validation: Reject uploads exceeding 10MB before processing begins. Validate magic bytes to ensure only JPEG and PNG formats are accepted, preventing processing of disguised executables.

Processing resource limits: Set processing timeout of 30 seconds per image via sharp's timeout option. Any processing exceeding this duration throws an exception, preventing infinite loops. Configure sharp library with limitInputPixels(16777216) preventing processing of images larger than 4096×4096 pixels (enforces the documented size policy limit).

Concurrency control: Limit concurrent image processing to five simultaneous uploads using a semaphore. If the semaphore is full, the upload endpoint returns a 429 Too Many Requests with a clear message instructing the user to retry shortly. This prevents resource exhaustion when multiple users upload simultaneously during high-traffic events.

Error handling: Processing failures return clear user-facing errors ('Image processing failed, please try a different image') without exposing implementation details or library error messages that could aid attackers.

CloudFront cache rules differ by variant (thumbnails cache longer). Error responses: 400 for validation errors, 500 for processing errors, 504 for S3 timeout.

Path Structure: s3://footbag-media/{member-id}/{gallery-name}/{photo-id}-{variant}.jpg

## 6.9 Voting

This is not an external service integration, except to the extent that we rely on AWS. Voting is implemented entirely in-house. This section is grouped with external services for structural convenience only; no third-party voting service is used. AWS KMS (an external service) is used for ballot encryption.

Decision:

All Voting implemented in-house using server-side ballot encryption. Ballots submitted as plaintext over HTTPS and encrypted by application before storage. Platform provides complete election administration: ballot casting UI, vote encryption, secure tallying, and cryptographic verification.

Rationale:

Full platform control over critical democratic infrastructure ensures governance independence and long-term sovereignty. One-time development investment eliminates permanent vendor dependency and ongoing costs. Server-side encryption keeps keys secure (never exposed to browser). Bespoke implementation aligns with project philosophy: simplicity, transparency, member ownership.

Trade-offs:

- Security responsibility: Cryptographic implementation correctness becomes platform responsibility (mitigated by using well-reviewed libraries).

- KMS dependency: Ballot encryption uses KMS envelope encryption. The public web runtime can encrypt ballots but cannot decrypt them; decrypt permission exists only in controlled tally operations under a separate role.

Impact:

- VotingService implements lifecycle, server-side encryption/decryption, tallying, verification.

- Admin interface for management, tallying operations (explicit decrypt flows), results publication.

- Audit logging for all decryption operations and election administration actions.

- KMS CMK used for ballot envelope encryption per environment. Web runtime role has kms:GenerateDataKey but not kms:Decrypt. Tally operations run with a privileged role that has kms:Decrypt.

- Allow results totals stored as a single JSON blob per vote.

Ballot encryption key management: The system uses AWS KMS envelope encryption per ballot. For each ballot submission, the server requests a fresh data key from KMS (GenerateDataKey), encrypts the ballot using AES-256-GCM, and stores only the ciphertext plus the encrypted data key alongside it.

Decryption pattern: Tally operations retrieve each ballot’s encrypted data key and ciphertext, call KMS Decrypt (privileged role only) to recover the per-ballot data key, then decrypt the ciphertext. This keeps the web runtime unable to decrypt ballots, supports key rotation via KMS, and ensures each ballot remains independently decryptable only during controlled tally operations.

Ballot submission atomicity: Submission uses atomic validation within a write transaction. BEGIN IMMEDIATE acquires a write lock, then vote status and close_datetime are checked within the transaction before inserting the ballot. This ensures the vote cannot close between validation and insertion. Unique constraint on (vote_id, member_id) prevents duplicate ballot submissions under concurrent requests.

Tally authorization and audit: Only administrators (users holding the admin role) may decrypt ballots. The `can_tally_votes` permission is implied by the admin role and is not a separately managed flag. Tallying is permitted only when vote.status equals 'closed' AND current timestamp exceeds vote.close_datetime. Audit events record TALLY_VOTE_START and TALLY_VOTE_COMPLETE with admin_id, vote_id, and timestamps. Individual decrypted ballots are never logged; the system aggregates totals in memory and discards ballot contents immediately. The canonical immutable audit log is stored in S3 with Object Lock (WORM), providing tamper-proof preservation.

These authorization and timing checks are enforced in application services. The database schema provides the required vote state, timestamps, and immutable audit-supporting structures but does not implement the voting workflow state machine.

Alternative Considered: Third-Party Vendor (ElectionBuddy): Evaluated to reduce development effort. Would provide hosted ballot casting, encryption, tallying, integrity verification. Rejected because: Development savings consumed by ongoing vendor costs, and also the ElectionBuddy integration would not be a small effort either. Vendor dependency for critical democratic infrastructure creates governance risk. Data sovereignty concerns. Architectural inconsistency (external API vs file-based simplicity). Server-side encryption approach keeps keys secure vs vendor-controlled encryption. One-time investment of time preferred over permanent vendor relationship.

# 7. DevOps

## 7.1 Dev/Prod Parity

Decision:

Development, staging, and production use the same application architecture, the same major service boundaries, and the same containerized deployment shape where practical. Differences are limited to environment-specific configuration, infrastructure sizing, live-vs-stub adapter wiring, and the documented runtime credential mechanism, not to divergent business logic or route behavior.

Rationale:

- Developers should be able to reproduce production behavior locally or in staging with minimal surprises.
- Reduces "works in dev, fails in prod" issues caused by diverging stacks.
- Preserves the adapter model: the code should behave the same whether it is wired to local stubs or to production AWS services.

Trade-offs:

- Configuration complexity is managed through explicit environment-scoped settings, including environment name, bucket names, sender identities, CloudFront distribution identifiers, feature flags, and Parameter Store paths under the `/footbag/{env}/...` hierarchy.
- Production Lightsail runtime access to AWS differs from local development: local development may use stubs by default and may optionally use a local AWS profile for hybrid testing, while production uses the explicit runtime assumed-role model defined by the AWS Lightsail and Credentials decision.
- Resource usage in staging may be smaller than production while still preserving architectural parity.

Impact:

- CI builds one primary set of application images used across environments.
- Environment selection is done via configuration and adapter wiring, not via conditional feature implementation or alternate business logic.
- Test plans should validate that staging uses the same routes, adapters, and behavioral expectations as production.
- JWT signing remains KMS-based in production; no `JWT_SECRET` production design is introduced by this decision.


## 7.2 AWS Lightsail and Credentials

Decision:

Production runs on AWS Lightsail, but operator shell access and workload AWS API access use two distinct mechanisms. For operator shell access, the Lightsail host uses hardened per-operator SSH, not Session Manager. SSH access exists only for documented operational tasks such as deployment, restore, patching, and incident diagnostics; it is not the general administration model for the system.

Routine host administration uses named non-root Linux operator accounts with `sudo`. Shared shell accounts are not allowed. Shared private SSH keys are not allowed. Each approved System Administrator gets a separate SSH key pair and a separately attributable host-access path. Password authentication must be disabled, direct root login must not be the normal operator path, and port 22 must be restricted to approved operator source IPs or CIDR ranges.

If the cloud image or Lightsail default login account is used during first bootstrap, that account is bootstrap-only and must not remain the long-term shared administration path once the named operator account model is established.

Operator SSH has two routine paths. The first is direct CLI SSH from the declared operator IP CIDR list, which may carry multiple narrow `/32` entries or wider CIDRs to cover an operator who roams between networks. The second is Lightsail Console browser SSH, opened by declaring the `lightsail-connect` source-IP alias permanently on port 22 in the firewall HCL. Browser SSH is a permanent operator path, not a recovery-only fallback, and provides stable shell access when the operator workstation IP changes faster than the CIDR allow-list can be updated. Both paths still require the host's authorized public key; browser SSH additionally requires AWS Console MFA on the operator IAM identity. Routine administration uses the CLI path; the browser path serves operators on VPN, mobile networks, or other transient routings.

The runtime role's trust policy may also list a non-host AWS principal (typically the operator's own IAM user) so the operator workstation can chain into the runtime role for read-only health probes such as the staging readiness smoke test. The chained AssumeRole derives short-lived credentials and inherits only the runtime role's narrowly scoped permissions. Where the runtime role's permissions are a strict subset of the operator's existing permissions, MFA on the chained AssumeRole is not load-bearing and may be omitted to permit unattended smoke runs; where the runtime role grants permissions the operator would not otherwise hold, MFA on the chain remains required.

For workload AWS API access, the deployed application does not rely on an implicit EC2-style instance role attached to the Lightsail host. Instead, production uses one or more explicit runtime IAM roles assumed through the AWS shared config/shared credentials chain. A root-owned host AWS config/credentials setup provides the source profile needed to assume the runtime role, and the deployed services use the assumed role as the runtime principal via standard AWS SDK / CLI credential resolution (`role_arn`, `source_profile`, `AWS_PROFILE`, or equivalent SDK configuration).

The authoritative production runtime principal is therefore the assumed runtime role, not the source profile, not the human operator identity, and not a host-attached instance role. Runtime permissions remain narrowly scoped to only the AWS APIs the application actually needs, such as S3, SES, Parameter Store, CloudWatch, and KMS, depending on the environment and service path.

Terraform's role as the authority for IAM, firewall, and related infrastructure is established in §9.6. The host-user creation and public-key installation path may begin as documented bootstrap work but must be reproducible, reviewable, and reflected in the runbooks.

Rationale:

- The platform intentionally uses Lightsail for cost and operational simplicity, but still needs a documented host shell-access path and controlled runtime use of AWS APIs.
- For this project’s scale, hardened per-operator SSH is proportionate and simpler than treating the Lightsail host as a non-EC2 managed node for Session Manager.
- Separating human operator access from workload runtime access keeps the design easier to reason about and audit.
- A documented AssumeRole-based runtime model preserves temporary credentials and least privilege without removing the existing AWS integrations from the design.
- Even if there is only one operator initially, the named-account / per-key model avoids future shared-access cleanup when additional System Administrators are onboarded.

Trade-offs:

- SSH requires opening port 22 to approved operator source IPs and maintaining that allowlist deliberately.
- The project must document host-account and SSH-key lifecycle procedures clearly: how a public key is approved and installed, how ownership and key fingerprints are recorded, and how access is removed immediately during offboarding.
- Private keys remain in the custody of the individual operator and must never be committed to the repository, stored in Parameter Store, copied into application containers, or placed in shared team storage.
- If operator source IPs change often, firewall maintenance is more manual than a no-inbound-port model.
- If the host or a privileged container is compromised while runtime credentials remain usable, the attacker can still call the AWS APIs allowed to the assumed runtime role until those temporary credentials expire or are cut off. This is still a better posture than storing exportable private keys in the app, but it is not a magic isolation boundary.
- Least-privilege claims are strongest if the web and worker services use separate runtime roles. Sharing one runtime role across both is an acceptable minimal-fix simplification, but increases blast radius.

Impact:

- Session Manager, hybrid activation, managed-node, and SSM-agent baseline wording elsewhere in the document suite must be removed or replaced with the SSH-based operator access model.
- DevOps and onboarding documentation must define the canonical SSH operating rules: named non-root operator accounts, `sudo` usage, public-key installation flow, private-key custody rules, firewall source-IP restriction, host-access inventory, onboarding steps, offboarding steps, and break-glass expectations.
- Docker and deployment configuration must mount only the required AWS config/credentials material into the containers that need AWS access, read-only, and must select the intended runtime profile explicitly.
- Parameter Store, KMS, SES, S3, and CloudWatch decisions elsewhere in this document remain valid, but their wording must refer to the runtime assumed role and not confuse it with the host operator path.
- Terraform-managed infrastructure must include the IAM roles/policies, Lightsail firewall restrictions, and any documented bootstrap inputs required by the SSH access model; it no longer depends on Systems Manager managed-node registration or Session Manager logging as a baseline requirement.

Alternatives Considered:

- Session Manager on the Lightsail host through the non-EC2 managed-node / hybrid activation path: Rejected because it adds hybrid-registration complexity (activation ceremony, orphan managed-node registrations, outbound network dependency for credential refresh), SSM Agent CVE history requiring ongoing Agent updates, and IAM privilege-minimization pitfalls, without enough compensating value for the expected single-operator workflow. Cost of the Session Manager service itself is not the driver; Advanced Instances Tier charges apply only if Advanced Instances are enabled.
- EC2 instead of Lightsail to preserve a no-inbound-port Session Manager shell path: Rejected for this stage because it increases platform complexity and moves the project away from the intentionally proportionate Lightsail-first deployment posture.
- Shared SSH private key or shared shell account: Rejected because it weakens accountability, complicates offboarding, and conflicts with the project rule against shared privileged identities.

## 7.3 Docker

Decision:

Local development uses Docker and docker compose to start the stack (web app, worker, test stubs) with a single command.

The minimum required Docker artifact set is:
- `docker/web/Dockerfile`
- `docker/worker/Dockerfile`
- `docker/nginx/nginx.conf.template` (rendered to `/etc/nginx/nginx.conf` at container start by `docker/nginx/40-render-nginx-conf.sh`; rendering substitutes `${X_ORIGIN_VERIFY_SECRET}` after shape-validating it as 64 lowercase hex chars)
- root `docker-compose.yml` for local development
- root `docker-compose.prod.yml` for Lightsail deployment overrides
- a documented service wrapper (for example `ops/systemd/footbag.service`) for the production compose stack

The minimum required runtime containers are:
- `nginx`
- `web`
- `worker`
- `image`

Rationale:

- Rapid onboarding for volunteers; no need to install and configure multiple services manually.

- Local environment closely matches production container environment.

Environment differences limited to:

- STORAGE_BACKEND=filesystem (dev) vs s3 (prod).

- STRIPE_MODE=test (dev) vs live (prod).

- SES_MODE=stub (dev) vs live (prod).

- AWS credentials: local stubbed adapters in development, versus the documented runtime assumed-role model in production. 

- Feature flags: May differ for testing unreleased features.

All other configuration (application code, adapters, business logic) identical across environments.

Trade-offs:

- Requires Docker installed and some familiarity with container tooling.

- Local resource usage can be higher than a bare-metal setup.

Impact:

- Repository includes docker-compose configs for dev. docker compose --profile dev up launches a working system on http://localhost.

- Dev images use local file-system and stub services in place of AWS, but interfaces remain the same.

Health Checks and Restart Policies:

All containers configured with health checks (30-60s intervals, 3 retries) and restart policies. Web/worker/nginx use restart: unless-stopped for continuous availability. Image container uses restart: on-failure with max 5 attempts to prevent restart loops. CloudWatch monitors container health status and alerts on persistent failures.

## 7.4 GitHub

Decision:

CI builds, tests, and publishes Docker images using GitHub Actions, targeting GitHub Container Registry (GHCR). We will make an open-source GitHub repository for all Footbag project code.

Rationale:

- Integrated with GitHub; no separate CI service required.

- GHCR is free and adequate for this project's needs.

- GitHub is the standard place to store project code and track code changes.

Trade-offs:

- None. GitHub is standard and works great.

- Some deployment steps (e.g., actual Lightsail rollout) remain scripted/manual.

Impact:

- Merges to main branch trigger CI pipelines that validate tests and publish images with predictable tags.

- Deployment runbooks describe pulling correct tagged images from GHCR into staging/production.

## 7.5 Local Development

Decision:

Local development supports two modes: (1) default fast-iteration mode with Docker Compose using filesystem storage and local service stubs, (2) optional high-fidelity mode with real AWS services for integration testing. Environment variables control which backend implementation is used. All environmental differences hidden behind abstraction layer.

Rationale:

- Fast default workflow: Local stubs provide instant feedback (no network latency, no AWS API calls) without requiring AWS credentials for basic development.

- High-fidelity option: Real AWS services validate actual integration behavior, email rendering, payment flows, and secrets management before staging deployment.

- Flexible development: Contributors choose appropriate testing level based on what they're working on (frontend changes use stubs, payment integration uses real Stripe test mode).

AWS Credentials:

- Developers use AWS profiles configured via aws configure or ~/.aws/credentials.

- Credentials passed to containers via environment variables (AWS_PROFILE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY), never committed to code or baked into images.

KMS Development Environment:

JWT signing uses KMS asymmetric keys in production and ballot encryption uses KMS envelope encryption. Development supports: Default mode: local stubs (no AWS required). High-fidelity mode: local-kms (for zero-cost KMS API parity) or staging AWS KMS keys.

In development the `JwtSigningAdapter` selects its `LocalJwtAdapter` implementation, which uses a file-based RSA-2048 keypair generated on first startup at `database/dev-jwt-keypair.pem` (gitignored). In staging/production the same interface selects `KmsJwtAdapter`, which calls real KMS via the runtime assumed role. No `local-kms` Docker service is required because the adapter abstraction makes the dev impl self-contained; if a future ballot-encryption path needs API-level KMS parity in dev, a local-kms container (e.g., LocalStack) can be added behind `BallotEncryptionAdapter` at that time.

Required IAM permissions for dev profile:

- SES: SendEmail, SendRawEmail on verified test domain.

- Parameter Store: GetParameter on /footbag/dev/\* path.

- KMS: Sign, GetPublicKey (JWT); GenerateDataKey, Decrypt (ballots, in dev only).

- S3: Limited to dev/test buckets only (no production access for devs).

- Stripe: Test mode API keys only (no live keys in dev environments).

Trade-offs:

- Developers need AWS credentials (dev/staging account access) for hybrid mode; onboarding includes AWS account setup.

- Must maintain both local stub implementations and real adapter implementations (doubles adapter test surface).

- Real AWS services incur small development costs (\$1-2/month per active developer for SES, Parameter Store access).

- Potential for dev/staging environment pollution if developers don't clean up test resources.

Impact:

- CI/CD strategy: CI pipeline uses local stubs for speed (test suite completes in \<2 minutes). Staging deployments use real AWS services for integration validation. Production never uses stubs.

- Stub implementations must match real AWS service behavior.

## 7.6 Health Endpoints

Decision:  
The application exposes HTTP health endpoints for use by AWS health checks and deployment automation:  
- GET /health/live = liveness check (process is running).  
- GET /health/ready = readiness check (safe to receive traffic).

Rationale:  
AWS best practice is to build health checks into every service to support safe deployments and automated recovery.

Constraints:  
- `/health/live` is cheap and does not call external dependencies.  
- `/health/ready` Validates essential dependencies required to serve traffic, only (e.g., ability to read required configuration and perform minimal S3 read access). Long-term target includes memory-pressure gating and broader dependency checks.
- Health endpoints must avoid calling Stripe, SES, S3, and any expensive dependency fan-out.
- Backup freshness, restore posture, and memory-pressure alarms are operational concerns, not current readiness gates.

Impact:  
- Deployment runbooks and any load balancer, target health checks use these endpoints.  
- Alarms may trigger on sustained readiness failures.

# 8. Logging, Monitoring & Abuse Prevention

## 8.1 Structured Logging

Decision:

Application logs structured JSON to stdout/stderr, aggregated into CloudWatch Logs. All log entries include: timestamp, level, correlation ID (used fracing a single user request across multiple systems and log files), actor context (when available), message, and structured metadata.

Rationale:

- JSON enables programmatic parsing and querying in CloudWatch Insights.

- Correlation IDs trace requests across layers.

- stdout/stderr follows 12-factor app principles.

- CloudWatch provides managed aggregation without operating log infrastructure.

Trade-offs:

- JSON logs less human-readable than plain text for casual inspection.

- CloudWatch costs scale with log volume (mitigated by retention policies).

- No sophisticated log analysis tools (ELK stack).

Impact:

- All services use shared logger module with consistent structure.

- CloudWatch retention policies configured per log group.

- Troubleshooting relies on CloudWatch Insights queries.

- Logs MUST redact tokens, JWTs, cookies, Stripe secrets, webhook signatures, AWS access key IDs and secret access keys, the value of `SESSION_SECRET`, raw JWT cookie values, and any §3.8 single-use account-security token (email verify, password reset, data export, legacy claim) regardless of whether the token appears in URL path, query string, or request body; use allowlist logging; never log raw email or full message subjects. KMS key ARNs are not secrets but should not be logged at request scope.

## 8.2 Monitoring and Alerting

Decision:

CloudWatch metrics and alarms monitor key system health indicators: application errors (5xx rates, exceptions), Lightsail instance health (CPU, memory, disk), S3 operation failures, SES bounce rates, backup job failures or missed runs, Stripe webhook processing failures. SNS topics deliver alarms to administrator email/SMS, including alarms for KMS error rates/latency (auth signing, ballot encryption) and alerts for unusual Parameter Store access patterns.

Rationale:

- CloudWatch native integration with AWS services requires no additional infrastructure.

- Threshold-based alarms catch operational issues before user impact.

- SNS provides reliable notification delivery.

Trade-offs:

- No sophisticated APM (Application Performance Monitoring).

- Manual investigation required after alarm fires.

- CloudWatch limited compared to commercial monitoring platforms.

Impact:

- Alarm configuration documented in infrastructure-as-code.

- On-call procedures reference specific alarms and runbook responses.

- Metrics inform capacity planning decisions.

## 8.3 Rate Limiting and Abuse Prevention

Decision:

In-process rate limiting middleware: 60 requests/min for anonymous, 120 for authenticated. App-side rate limiting state (including IP-based counters for login/reset) is kept in memory only and is not persisted to the database or logs. Cloudflare Turnstile CAPTCHA gates login, register, password-reset, claim-lookup, and verify-email-resend form submissions; the server verifies the Turnstile response token before any DB read. Turnstile runs in Managed mode (Cloudflare-recommended default), which completes without user interaction for low-risk sessions and escalates to a checkbox challenge for higher-risk sessions. AWS Shield Standard, automatic on the CloudFront distribution, covers volumetric L3/L4 DDoS at no additional cost. A CloudWatch origin-spike alarm pages the operator when sustained per-minute origin request volume exceeds the configured threshold. No edge-layer application abuse rule engine. No managed WAF or AI-based bot detection beyond Turnstile's risk scoring.

Rationale:

- In-process limiting protects origin from overload.

- Per-IP and per-user limits cover different attack vectors.

- Shield Standard handles volumetric DDoS at the CDN edge for free.

- Turnstile is the compensating control for distributed app-layer abuse that stays under per-IP limits. It operates at the form boundary on the credential and identity-discovery endpoints attackers target, regardless of how request load is spread across IPs. Chosen over hCaptcha for unlimited free volume, no user-data resale, and Cloudflare-managed risk scoring.

- Managed mode chosen over Invisible mode because Managed renders a visible spinner that gives users a recovery affordance (a checkbox challenge to click) when risk scoring escalates, while Invisible mode has no failure UI for users blocked by privacy tools or accessibility software.

- The CloudWatch origin-spike alarm is the detective backstop for general traffic floods that bypass form-based gates, such as unauthenticated GET storms. Application controls block; the alarm escalates anything that gets through.

- Community scale doesn't justify a managed WAF.

Trade-offs:

- Legitimate users behind shared IPs may hit anonymous limits.

- Sophisticated attackers can bypass simple rate limiting.

- Distributed app-layer abuse on non-form routes cannot be blocked above the application; the origin-spike alarm escalates rather than auto-blocks.

- Turnstile depends on a third-party service. Fail-mode is fail-open with an alarm: if the siteverify endpoint is unreachable, the form submission proceeds without the CAPTCHA check, preserving user access during a Cloudflare outage. An env override flips to fail-closed during an active attack.

- Turnstile may escalate to an interactive checkbox for users on privacy-hardened browsers, Tor, or accessibility software, adding friction for a small fraction of legitimate users.

- Manual admin intervention required for coordinated abuse; admin response is account-level (member suspension), not network-layer blocking.

Impact:

- Rate limiting configuration tunable via Parameter Store.

- CloudWatch tracks rate limit hits for capacity planning.

- Upload operation caps (application-level, per member): 10 photo uploads per hour, and 5 video link submissions per hour.

- In-process counters of operations per member are memory-only.

- Turnstile site key rendered server-side into the five protected forms; secret key held in Parameter Store (read at boot, never logged); siteverify called server-side from the route handler before any DB read.

- CloudWatch origin-spike alarm fires to the existing operator SNS topic per §28.2 baseline.

## 8.4 Content Moderation Policy

Decision:

Member-flagging system for inappropriate content with admin review queue. No automated content moderation. All moderation actions logged immutably.

Rationale:

- Community-scale content volume manageable via manual review.

- Member flagging leverages community self-regulation.

- Transparent moderation maintains trust (all actions logged with reason).

- AI moderation complexity and cost unjustified.

Trade-offs:

- Inappropriate content may remain visible until flagged and reviewed.

- Admin workload scales with content volume.

- No proactive detection of problematic content.

Impact:

- Admin interface provides flag queue with context for review decisions.

- Moderation actions recorded in audit logs.

- Future AI moderation could augment, not replace, this system.

# 9. Performance, Cost and Scalability

## 9.1 Performance Target Architecture

Decision:

All query operations target less than 1 second response time (an optimistic goal not a promise).

Rationale:

- 1-second threshold provides acceptable UX for community site.

- Server-Side Rendering: HTML rendered on the server and delivered immediately. CloudFront CDN caches rendered HTML at edge locations.

- Lightweight JavaScript: Vanilla TypeScript bundles are intentionally small. Fast parse and execution time avoids heavy framework overhead.

- SQLite has low latency compared to database server alternatives.

- Important: JavaScript downloads, parses, and executes on all devices. Performance gains come from lightweight JavaScript (fast parse), not from maintaining a no-JavaScript path.

Trade-offs:

- Performance degrades linearly with data growth.

- Complex queries (multi-attribute searches) may approach or exceed 1-second target.

- No text search capability beyond simple substring matching for member names.

Impact:

- Query implementations must be profiled against 1-second budget.

- User expectations set for "adequate" not "instant" performance.

## 9.2 Cost Constraints

Decision:

Target operational cost: \$50-100/month. Single Lightsail instance (\$40/month), S3 storage/transfer, CloudFront, SES. No high-availability cluster, no managed database, no sophisticated monitoring tools.

Rationale:

- Cost ceiling sustainable on volunteer-run organization budget.

- Single-instance simplicity dramatically reduces infrastructure costs.

- AWS managed services (S3, SES) eliminate operational overhead.

- Community scale doesn't require enterprise infrastructure.

Trade-offs:

- Single point of failure (instance outage equals site down).

- Manual intervention required for scaling beyond single instance.

- Limited monitoring compared to commercial APM solutions.

- Performance ceiling constrained by vertical scaling limits.

Impact:

- Infrastructure decisions evaluated against cost impact.

- Monitoring tracks actual spend vs budget.

- Future growth may require architectural changes if costs exceed ceiling.

- Must configure an AWS CloudWatch alarm for cost threshhold.

## 9.3 Scalability

Decision:

Vertical scaling only (up to 8GB RAM on Lightsail). No horizontal auto-scaling, no multi-instance architecture.

Rationale:

- Community traffic patterns (hundreds of active users) fit single-instance capacity.

- Vertical scaling simpler operationally than horizontal (no load balancer, session management, distributed state).

- File-based storage on S3 separates data from compute (instance replaceable).

Trade-offs:

- Hard capacity ceiling (8GB instance max on Lightsail).

- Downtime required for vertical scaling (instance recreation).

- No automatic response to traffic spikes.

- Future horizontal scaling requires architectural changes (load balancer, session management, stateless design already supports this).

Impact:

- Capacity planning based on single-instance limits.

- Traffic growth monitored against vertical scaling headroom.

- Migration to multi-instance architecture documented as future decision point.

## 9.4 Backup and Recovery

Decision:

Two backup operations provide data protection with minimal cost. This approach balances cost (estimated \$3/month total) with comprehensive protection.

Continuous Database Backup (every 5 minutes):

Purpose: Fast recovery from common issues (corruption, bugs, accidental deletion).

Process: Background worker executes: (1) PRAGMA wal_checkpoint(TRUNCATE) commits WAL to main database file, (2) SQLite backup API (better-sqlite3 .backup() ) creates consistent snapshot, (3) Upload to primary S3 bucket with retry (3 attempts, exponential backoff), (4) Update health timestamp.  

Cost: estimated \$1/month for S3 storage with a default 30-day primary snapshot version-history window (versioning lifecycle setting; configurable).

Recovery: RPO 5 to 10 minutes, restore any snapshot within the configured primary snapshot version-history window (default: 30 days).

Cross-Region Disaster Recovery Sync (nightly):

Purpose: Protection against catastrophic regional failures.

Process: Nightly job syncs primary S3 bucket to cross-region backup bucket with S3 Object Lock (WORM) and lifecycle rules.

Cost: Marginal (replication + storage in backup region).

Recovery: RPO 24 hours for cross-region disaster recovery sync; frequent snapshot backups provide RPO 5–10 minutes for primary-region recovery.

S3 bucket configuration: Versioning enabled on the primary backup bucket (default 30-day version-history window for database snapshot point-in-time recovery). The cross-region backup bucket uses Object Lock (WORM - Write Once Read Many) and lifecycle rules for retained backup objects. Cross-region protection is provided via the nightly disaster recovery sync job.

Container shutdown (SIGTERM): On shutdown signal, the application performs graceful shutdown to prevent data loss: (1) Stop accepting new requests. (2) Wait for in-flight transactions to complete (30-second timeout). (3) Execute PRAGMA wal_checkpoint(TRUNCATE) to commit final transactions. (4) Close database connection cleanly. (5) Perform final S3 backup upload. (6) Exit. This ensures no data loss during planned restarts or deployments.

Backup failure handling: Retry with exponential backoff (3 attempts: 1s, 2s, 4s delays). Alert CRITICAL after 3 consecutive failures. Health endpoint exposes last successful backup timestamp. CloudWatch alarm if backup age exceeds 15 minutes. This ensures operators are immediately aware of backup issues.

Recovery procedure: Download latest S3 backup version, run PRAGMA integrity_check to validate database integrity, replace local database file, restart application containers, verify health endpoints return OK. Target RTO (Recovery Time Objective): ~5 minutes from failure detection to service restoration.

Automated daily verification: A daily job verifies backup integrity by comparing primary and backup S3 buckets: compares object counts and total size (allowing 1% variance for in-flight operations), randomly samples 10 objects and verifies MD5 checksums match between primary and backup, checks S3 replication lag metrics. If discrepancies exceed thresholds, alerts CRITICAL priority.

Quarterly restoration drills: Download backup, verify integrity, restore to test environment, run smoke tests, document results and update procedures. These drills validate that recovery procedures work correctly and identify gaps in runbooks.

Rationale: Five minute backup interval provides acceptable RPO (Recovery Point Objective), which is acceptable for community site operations. SQLite backup API guarantees consistency by handling WAL files correctly during snapshot creation. Single file upload is simple and reliable compared to multi-file or incremental approaches. S3 versioning provides point-in-time recovery capability. Graceful shutdown with final WAL checkpoint prevents data loss during deployments and restarts.

The selected approach using S3 Intelligent-Tiering costs approximately $1/month, providing acceptable RPO (5-10 minutes) and a configurable point-in-time recovery window (default: 30 days) at minimal cost appropriate for a volunteer-maintained platform.

Daily automated verification provides continuous confidence that backups are actually working without waiting for a disaster to discover issues. Quarterly restoration drills validate end-to-end recovery procedures and uncover gaps in runbooks before they matter. This balanced approach provides assurance without excessive operational burden.

Trade-offs:

- Data loss of up to 5 minutes if instance fails between backups.

- Costs are mitigated by S3 versioning lifecycle rules that transition old backups to cheaper storage tiers automatically.

- RTO of 5 minutes requires manual intervention (download, verify, restore, restart). There is no automated failover to a standby instance. This trade-off favors operational simplicity over automatic recovery, which is appropriate for volunteer-maintained community platform.

- Manual recovery procedures introduce human error risk. This is mitigated through comprehensive runbooks, quarterly drills, and automated verification that catches backup issues before recovery is needed.

Impact:

BackupWorker service runs in worker container and executes backup sequence every five minutes. CloudWatch monitors backup success rate, backup age. Alerts trigger on backup failures (3 consecutive) or stale backups (\>15 minutes old). Health endpoint exposes last successful backup timestamp for external monitoring.

DevOps runbooks document step-by-step recovery procedures with validation checklists. Quarterly drills validate recovery process works as documented and identify needed updates to procedures.

Integration tests validate S3 upload contract (retry logic, error handling, health timestamp updates). Daily verification job provides ongoing assurance that backups are complete and consistent.

Backup retention windows support data deletion policy. The normative defaults for backup retention are defined in User Stories 6.7: `primary_snapshot_version_days` (default: 30 days) governs the primary bucket version-history window; `cross_region_backup_retention_days` (default: 90 days) governs the Object Lock retention on the cross-region disaster-recovery bucket. The normative default for audit log retention is adefined in (`audit_retention_days`, default 7 years / 2555 days). Lifecycle rules automatically transition audit logs older than 1 year to Glacier Deep Archive for cost optimization while maintaining compliance.

WAL checkpoint failure handling: If a long-running transaction holds locks, the WAL checkpoint cannot complete. The backup worker attempts wal_checkpoint(TRUNCATE) with busy_timeout=10000 (10 seconds). If checkpoint fails, the worker logs a warning, skips that backup cycle, and retries in the next five-minute interval. After three consecutive checkpoint failures, an administrator alert is sent indicating potential database contention issues. Backups only proceed after successful WAL checkpoint to ensure consistency. The health check endpoint reports time_since_last_successful_backup enabling monitoring systems to detect extended backup failures.

Alternative considered: The AWS free tier does not provide viable continuous database backup at required RPO. Free tier S3 includes 5GB storage and 20,000 GET requests monthly, insufficient for 5-minute backup uploads (8,640 uploads monthly) and a default 30-day primary snapshot version-history window (requires approximately 50GB storage at scale). Trade-off analysis: Free tier would require 60+ minute backup intervals (unacceptable RPO) or complex custom backup rotation logic (operational complexity). Paid minimal-cost solution ($1/month) is appropriate given budget constraints and simplicity goals.

Photo Backup (S3 replication):

Photos are backed up separately from database due to data volume. Amazon S3 cross-region replication handles photo backup automatically and continuously. The primary media bucket (`<env>-media`, us-east-1) replicates all photo objects to a dedicated DR bucket (`<env>-media-dr`, us-west-2) using S3 One Zone-IA storage class for cost savings on DR storage. Replication is continuous; per-object propagation typically completes within minutes. S3 Replication Time Control (RTC) is not enabled, so there is no formal RPO SLA. No backup job or cron process is required; S3's native cross-region replication feature handles this automatically. Photo backup is completely decoupled from database backup cycle. The DR bucket preserves the primary's S3 key structure exactly (replication preserves keys), so a recovery scenario can restore objects without remapping. Object Lock is intentionally not applied to the photo DR bucket: photo deletion must propagate to the DR side to honor member-account-erasure (§1.5 "When member deletes account: member's photos automatically hard-deleted"). Operator-recovery headroom is provided by S3 Versioning plus 30-day `NoncurrentVersionExpiration` on both buckets.

Recovery procedure: Promote the DR bucket to primary by updating the CloudFront `/media/*` origin and the `PHOTO_STORAGE_S3_BUCKET` env var, or restore objects from the DR bucket to a new primary bucket (replication-preserved keys make either path mechanical).

## 9.5 Failure Modes

Decision:

The platform uses two operational states:

- Normal (all features available).

- Maintenance (CloudFront error page displayed).

Rationale:

Binary operational states (working vs. down) are simpler to understand, monitor, troubleshoot, and communicate than hybrid degraded states. For a volunteer-maintained platform, complex degradation handling is not justified; we prefer clear maintenance mode plus fast restore procedures.

Trade-offs:

Complete outages vs. partial degradation: Users cannot access site during origin failures. Complete maintenance mode is simpler and clearer than attempting read-only access, and reduces operational and testing complexity.

Impact:

Simplified monitoring (binary availability states), simplified troubleshooting (clear recovery procedures), simplified codebase (no degraded-mode state management), reduced testing surface.

Container memory limits: Docker memory limits are explicitly set for each container preventing unbounded memory consumption. Configuration: web container mem_limit: 1536m (1.5 GB), mem_reservation: 1024m; worker container mem_limit: 1024m (1 GB), mem_reservation: 768m. These are deployment configuration values for container resource management, not Administrator-configurable application parameters.

Health check integration: The /health/ready endpoint returns 503 when memory usage exceeds 90 percent. During this condition, the origin responds with 503 and CloudFront serves the configured maintenance/error experience; alerts fire so operators can intervene or restart containers. (CloudFront does not perform active health checks.)

Monitoring and alerts: Alert if memory usage remains above 80 percent for five consecutive minutes indicating sustained pressure requiring investigation. Container restart policy configured for automatic recovery with maximum three restart attempts preventing restart loops from persistent issues.

## 9.6 Infrastructure as Code

Decision:

All steady-state AWS infrastructure is defined in Terraform configuration files version-controlled in the repository under `/terraform`. A one-time manual bootstrap is allowed only to provision the AWS account baseline, the operator IAM identity that subsequently runs Terraform, and the Terraform remote-state S3 bucket; all steady-state IAM (source-profile users, runtime roles, policies, instance profiles) is defined in Terraform. After that handoff, manual console changes are prohibited except for emergency incident response, and any emergency change must be reconciled back into Terraform before the next `terraform plan` or `apply`. Terraform remote state is held in an S3 bucket with S3 native locking (`use_lockfile = true`, Terraform >= 1.11); DynamoDB locking and Terraform Cloud are excluded.

Rationale:

- Reproducible environments: Dev, staging, production created identically from code (eliminates "works in staging but not production" issues).
- Infrastructure changes reviewed via pull requests with visual diff of planned changes (terraform plan output).
- Disaster recovery through code: complete AWS-side rebuild possible from Terraform state. Host-side state recovers separately.
- Eliminates tribal knowledge; infrastructure documented as executable code with comments explaining rationale.
- Supports long-term volunteer maintainability (new admins can understand infrastructure by reading .tf files).
- Enables infrastructure testing in isolated environments before production deployment.

Infrastructure Managed by Terraform:

- Lightsail instance configuration (size, region, OS, firewall rules, static IP allocation).
- S3 buckets with complete configuration (including backup bucket for SQLite snapshots with versioning and Object Lock enabled).
- CloudFront distributions.
- IAM roles and policies, including the runtime assumed role model and any distinct privileged roles.
- Lightsail firewall rules and any approved infrastructure-side inputs needed for the documented SSH operator-access posture.
- Parameter Store structure.
- KMS keys and key policies.
- CloudWatch resources, including log groups and alerting resources used by operations and application/platform monitoring.
- Route53 DNS records.
- SES email identities (sender, plus future bounce and complaint webhook configuration).
- Budget alerts and SNS topics.

Host-State Boundary:

Terraform manages AWS API resources. Host-side filesystem and systemd state on the Lightsail VM (installed packages, agent config files, daemon lifecycle) are managed by idempotent shell scripts under `scripts/` and by documented procedures in `docs/DEV_ONBOARDING.md`. Terraform `remote-exec` and `local-exec` provisioners are excluded as a canonical pattern.

Constraints driving the split:

- Lightsail provides no `user_data` mechanism, so the EC2 cloud-init bootstrap pattern is unavailable.
- SSM Hybrid Activation is deferred. Documented CVE history (CVE-2022-29527 sudoers privilege escalation, March 2025 path-traversal RCE-to-root, CVE-2025-21613 go-git dependency); the SSM Agent vends credentials at `/root/.aws/credentials`, widening the host's attack surface; the 30-minute credential refresh has no cached fallback under network disruption. Re-evaluate when a second SSM-driven need amortizes the activation cost.
- Terraform provisioners couple state to SSH reachability, fail opaquely on partial success, and resist safe re-running. HashiCorp recommends them as last resort.

Canonical pattern: idempotent scripts in `scripts/` are reviewable, version-controlled, and re-runnable; host-state changes share the same git history as the AWS-side declarations. Examples include `scripts/install-cwagent-staging.sh` for the CloudWatch Agent and `scripts/deploy-code.sh` for application code.

Secrets Management:

Terraform creates Parameter Store parameters (paths and metadata) but does not store secret values in version control. Secret values (Stripe API keys, Stripe webhook secrets, and other non-KMS credentials) are set manually via AWS CLI or secure deployment pipeline after Terraform creates parameter structure. Terraform references secrets via parameter names; actual values never appear in `.tf` files or state files. JWT signing keys and ballot encryption keys use AWS KMS (non-exportable key material) and are provisioned via Terraform KMS resources; they are never stored in Parameter Store.

Trade-offs:

- Initial setup cost: must define all infrastructure as code.
- Learning curve: Contributors must understand basic Terraform syntax and workflow.
- State file management requires multi-operator coordination on the shared S3 backend. Native locking serializes concurrent applies; operators still coordinate before invasive changes.
- Requires discipline: Manual console changes create drift requiring reconciliation. Manual AWS console changes are prohibited except for emergency troubleshooting. Any permanent changes must be made via Terraform.
- AWS provider major version is pinned (currently `~> 5.0`). Provider major upgrades require explicit review of the migration guide and a coordinated apply across all workspaces, not a casual `terraform init -upgrade`.
- Two control surfaces: AWS-side resources land via `terraform apply`, host-side state via on-host script execution. Operators run scripts on each host after the corresponding apply for a full bootstrap. Script-side failures are not visible in `terraform apply` output.

Impact:

- Terraform must remain the authority for IAM roles, policies, Parameter Store structure (per §3.6), KMS resources, CloudWatch resources, Lightsail instance configuration, Lightsail firewall rules, and any infrastructure-side inputs required by the SSH operator-access posture and the runtime-credential model in §7.2.
- Deployment/bootstrap documentation must clearly separate one-time bootstrap actions from steady-state Terraform-managed infrastructure.
- Workspace layout: `terraform/shared/` for one-time bootstrap (state bucket, account baseline); `terraform/staging/` and `terraform/production/` for per-environment resources, each with its own remote state.
- Drift reconciliation procedure (`terraform import` flow, plan-clean verification, PR review) lives in DEVOPS_GUIDE §6.5. The design rule above is enforced by the requirement that `terraform plan` returns "No changes" before any further apply.
- Any agent or daemon needing host-level access (e.g. CloudWatch Agent reading host CPU/memory/disk) is bootstrapped through an idempotent script under `scripts/`, not through Terraform provisioners or AWS Console clicks.


## 9.7 High Availability and Recovery

Decision:

The platform uses a single-instance architecture with CloudFront custom error pages for graceful degradation during failures. High availability is achieved through rapid recovery procedures, automated monitoring, and backups rather than redundant compute infrastructure.

Rationale:

- Volunteer-run community platform does not justify operational complexity of multi-instance architecture.

- Additional cost (financial and volunteer time) of redundant infrastructure outweighs benefit of avoiding approximately 52 minutes of downtime per year.

- Design prioritizes rapid recovery over failure prevention through comprehensive monitoring, automated alerting, and documented recovery procedures.

- Transparent failure modes: users see either fully functional site or clear maintenance page, no ambiguous partial failure states.

Trade-offs:

- No automatic horizontal scaling or multi-instance redundancy.

- Site unavailable during Lightsail failures (approximately 52 minutes per year expected).

- POST/PUT/DELETE requests receive connection errors during outages (CloudFront limitation).

- Recovery requires manual admin intervention for most scenarios.

Impact:

- CloudWatch Monitoring: Key metrics tracked: OriginAvailability, Origin5xxErrorRate, ApplicationErrorRate, CPUUtilization, S3OperationFailures, StripeAPIErrors.

- Critical alarms: Origin availability / 5xx rate \>5% for 2 minutes, CPU \>80% for 10 minutes.

- Complete recovery procedures documented in DevOps runbooks with diagnostic commands, rollback procedures, and validation checklists.

- Use AWS tools and DevOps runbooks to get infrastructure details and perform operational actions. Admin user dashboard remains application-level only: active alarms summary, system health, recent application-visible errors, and origin availability indicators. No AWS console links or infrastructure quick actions are exposed in the Application Administrator UI.

## 9.8 Monitoring and Alerting

Decision:

The platform implements three-tier monitoring covering infrastructure health, application behavior, and business operations. CloudWatch provides the monitoring substrate with custom metrics published by application code. Alerts route through CloudWatch Alarms to SNS topics with email and SMS notification. Two alert tiers (warning, critical) have different response time expectations and escalation paths. CloudWatch is the primary monitoring system; optional external error tracking/APM tooling may be adopted if it is budget-appropriate and reduces operational risk.

Rationale:

Proactive monitoring detects issues before user impact and enables data-driven capacity planning. Three-tier structure provides visibility at appropriate abstraction levels for different audiences (operations team vs administrators). CloudWatch native integration minimizes operational overhead compared to external monitoring services.

Tier 1 - Infrastructure Metrics (CloudWatch Default): Lightsail instance: CPU utilization, memory utilization, network traffic, status checks. Container-level: per-container memory, per-container CPU, restart counts. S3: 4xx/5xx error rates, request rates. These detect resource exhaustion and infrastructure failures.

Tier 2 - Application Metrics (Custom CloudWatch Metrics): Request rates and error rates (4xx, 5xx) broken down by route. Response latency (P50, P95, P99) per route. Authentication: login success/failure rates, JWT verification failures. Background jobs: last successful run timestamp per job type, job execution duration. These detect application bugs and performance degradation. Database: query latency (P50, P95, P99 per repository method), slow queries (\>500ms), transaction rate and duration, SQLITE_BUSY frequency, WAL file size, checkpoint latency, database file size and growth rate.

Tier 3 - Business Metrics (Custom CloudWatch Metrics): Member registrations (started, completed, completion rate). Photo uploads (count, success rate, error breakdown). Payment transactions (attempts, successes, failure rate, daily revenue). Email delivery (enqueued, sent, bounces, complaints). Event registrations. These detect business process issues and usage anomalies.

Alert Tiers: Warning-level: Email to operations team, 1-hour response expectation, indicates

degraded but functional state. Examples: CPU \>80% for 10 minutes, P95 latency \>2 seconds for 5 minutes, background job missed 1 execution.

Critical-level: Email and SMS to on-call, 15-minute response expectation, indicates service disruption or imminent failure. Examples: CPU \>90% for 5 minutes, 5xx rate \>5% for 1 minute, any background job missed 3+ consecutive executions, container restart loop (3+ restarts in 10 minutes). Database: backup age \>15 minutes, 3 consecutive backup failures, WAL file \>1GB (checkpoint issues), SQLITE_BUSY rate \>5% of operations, checkpoint latency \>5 seconds, database file approaching disk capacity (80%/90% thresholds).

Dashboards:

Operations Dashboard: Infrastructure and application metrics, alert status, recent errors, container health. Updated every 30 seconds. Technical team only. Administrator Dashboard: Business metrics, member activity, payment summary, email delivery, moderation queue. Updated every 5 minutes.

Alert Configuration Principle:

Alerts are tuned to minimize false positives while catching real issues. Warning alerts use 5-10 minute windows to avoid flapping on transient spikes. Critical alerts use shorter windows (1-5 minutes) for rapid response. Thresholds are reviewed quarterly based on operational experience and adjusted as usage patterns evolve.

**END OF Design Decisions DOCUMENT**
