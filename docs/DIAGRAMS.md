# Footbag Website Modernization Project -- Diagrams

Visual aids for understanding the system design. Eight diagrams cover production infrastructure, software layer architecture, authentication flows, request routing, the data model, read/write request lifecycles, development environment parity, and background worker jobs.

**Table of Contents**

1. Production Infrastructure Topology
2. Four-Layer Software Architecture
3. Authentication and Session Flow
4. Request Routing and Dispatch
5. Read and Write Request Flow
6. Development vs Production Environment Parity

---

## Figure 1: Production Infrastructure Topology

```
                        Internet Users
                    (Visitors & Members)

                             │ HTTPS (443)
                             ↓
┌─────────────────────────────────────────────────────────────────────┐
│  AWS CloudFront  (single distribution, global edge network)         │
│                                                                     │
│  footbag.org  Dynamic HTML/API → 5min TTL  →  Lightsail origin      │
│  footbag.org  Static assets   → 1yr TTL   →  S3 static bucket       │
│  archive.*    Archive HTML    → 1yr TTL   →  S3 archive bucket      │
│                               (Lambda@Edge: JWT auth check)         │
└─────────────────────────────────────────────────────────────────────┘
                Route 53 → CloudFront      origin requests (~5%)
                             ↓
╔═════════════════════════════════════════════════════════════════════╗
║  Lightsail 4GB Instance  (us-east-1)                                ║
║                                                                     ║
║  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────┐         ║
║  │    nginx    │ │     web     │ │   worker    │ │ image  │         ║
║  │   128 MB    │→│   512 MB    │ │   384 MB    │ │ 896 MB │         ║
║  │Reverse proxy│ │ Controllers │ │Email outbox │ │ Sharp  │         ║
║  │Rate limiting│ │ Services    │ │DB backup    │ │ Photo  │         ║
║  │TLS terminus │ │ db.ts       │ │Nightly sync │ │ proc.  │         ║
║  └─────────────┘ └─────────────┘ └─────────────┘ └────────┘         ║
║                        │                │              │            ║
║                        └────────────────┘              │            ║
║                                 │                      │            ║
║                   ┌─────────────────────┐              │            ║
║                   │   footbag.db        │              │            ║
║                   │   SQLite database   │              │            ║
║                   │   (all app state    │              │            ║
║                   │    except photos)   │              │            ║
║                   └─────────────────────┘              │            ║
╚═════════════════════════════════════════════════════════════════════╝

    SQLite snapshots (every 5 min)       photo variants (on upload)
             ↓                                      ↓
┌─────────────────────────────────────────────────────────────────────┐
│  S3: footbag-data-prod              S3: footbag-media-prod          │
│  SQLite backup snapshots (30d)      Thumbnail + display JPEG        │
│  WORM Object Lock protection        → auto-replicated to            │
│                                     footbag-media-backup (us-east-1)│
└─────────────────────────────────────────────────────────────────────┘

  AWS managed services (accessed via IAM role — no hardcoded secrets):

┌─────────────────────────────────────────────────────────────────────┐
│  AWS SES         Email delivery  (outbox poll every 5 minutes)      │
│  AWS KMS         JWT signing (asymmetric) · ballot encryption       │
│  Parameter Store Stripe API keys · webhook secrets (not JWT)        │
│  CloudWatch      Logs · metrics · backup-age alarm (>15 min)        │
└─────────────────────────────────────────────────────────────────────┘
```

**Caption:** A single AWS CloudFront distribution serves all traffic with different cache behaviors per path: dynamic HTML routes to Lightsail, static assets to S3, and the legacy archive to a separate S3 bucket protected by Lambda@Edge JWT validation. The Lightsail instance runs four Docker containers sharing a local SQLite database file. The worker and web containers both access `footbag.db` directly; the image container is isolated with no database access. Photos live in a dedicated S3 bucket and are never stored in SQLite. Runtime AWS service integrations use IAM roles with no hardcoded secrets. Operator shell access to the host uses hardened per-operator SSH to named host accounts.

---

## Figure 2: Four-Layer Software Architecture

```
  Browser  (HTTP request / form submit / AJAX)

  ↓
╔═════════════════════════════════════════════════════════════════════╗
║  PRESENTATION LAYER                                                 ║
║                                                                     ║
║  Handlebars .hbs templates                                          ║
║  • Renders HTML from view model (plain JS object, no HTTP types)    ║
║  • No business logic · no database access · no service calls        ║
║  • TypeScript required for interactive features (form validation,   ║
║    autocomplete, previews); forms submit via native browser POST    ║
╚═════════════════════════════════════════════════════════════════════╝

  ↑  viewModel  (assembled by controller, after service call)

╔═════════════════════════════════════════════════════════════════════╗
║  CONTROLLER LAYER  (Express route handlers)                         ║
║                                                                     ║
║  • Parse + validate request body  (Zod — compile + runtime)         ║
║  • Verify JWT signature  (KMS public key, cached at startup)        ║
║  • Read member from db → compare passwordVersion field              ║
║    (mismatch → clear cookie, 401, redirect /login)                  ║
║  • Authorize: tier / role / resource ownership                      ║
║  • Call service method(s) with typed domain objects                 ║
║  • Assemble view model → render template  OR  return JSON           ║
║  • On version conflict: return 409 with diff view                   ║
║  • Zero business logic lives in this layer                          ║
╚═════════════════════════════════════════════════════════════════════╝

  ↕  domain objects  (no HTTP types cross this boundary)

╔═════════════════════════════════════════════════════════════════════╗
║  SERVICE LAYER  (all business logic)                                ║
║                                                                     ║
║  • Authorization checks beyond basic auth                           ║
║  • Business rules, constraints, state machine transitions           ║
║  • Call db.ts prepared statements for reads and writes              ║
║  • Wrap multi-step writes in  transaction()  helper                 ║
║  • INSERT into outbox within same transaction as the write          ║
║  • INSERT into audit_entries on every state-changing action         ║
║  • Never touches  req / res / cookies / HTTP headers                ║
╚═════════════════════════════════════════════════════════════════════╝

  ↕  SQL params / rows  |  adapter interface calls

╔═════════════════════════════════════════════════════════════════════╗
║  INFRASTRUCTURE LAYER                                               ║
║                                                                     ║
║  db.ts — single module exporting all prepared statements:           ║
║    queries.memberByEmail.get(email)                                 ║
║    queries.eventsByOrganizer.all(memberId)                          ║
║    queries.createEvent.run(data)                                    ║
║    transaction(() => { /* all db ops sync; async after */ })        ║
║                                                                     ║
║  Adapters  (same interface; implementation switches by env):        ║
║    SesAdapter  ·  PhotoStorageAdapter  ·  PaymentAdapter            ║
║    SecretsAdapter  ·  JwtSigningAdapter  ·  LoggingAdapter          ║
╚═════════════════════════════════════════════════════════════════════╝

  ↕

  SQLite (footbag.db) · S3 (photos) · KMS · SES · Stripe
```

**Caption:** The codebase is organized into four strict layers with enforced boundaries. Presentation templates never call services. Controllers contain zero business logic — they orchestrate but do not decide. Services implement all rules and call `db.ts` prepared statements directly; they never touch HTTP objects. The infrastructure layer is the only place external services are invoked, and every external dependency has a swappable adapter so the system runs identically in development without AWS credentials.

---

## Figure 3: Authentication and Session Flow

```
════════════════════════════  LOGIN FLOW  ═════════════════════════════

  Browser:  POST /auth/login  { email, password }
  (No CSRF token needed — SameSite=Lax blocks cross-site POST)
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  web Controller                                                     │
│  1. Rate limit: 5 attempts / 15 min per account identifier          │
│  2. Validate input: email format, password length  (Zod)            │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  AuthService                                                        │
│  3. queries.memberByEmail.get(email)  →  member row or null         │
│  4. Not found?  → generic 'invalid credentials' error               │
│     (same message as wrong password — prevents enumeration)         │
│  5. Compare submitted password against stored passwordHash:         │
│       argon2id  (primary)  or  bcrypt  (legacy, auto-upgrades)      │
│       timing-safe comparison — prevents timing attacks              │
│  6. Hash mismatch?  → same generic error                            │
│  7. Legacy bcrypt?  → rehash to argon2id, UPDATE member row         │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Generate JWT  (signed via  kms:Sign  — key never leaves KMS)       │
│                                                                     │
│  {                                                                  │
│    memberId:        "uuid",                                         │
│    tier:            1,             // 0 | 1 | 2 | 3                 │
│    roles:           ["member"],    // + "admin" if applicable       │
│    passwordVersion: 4,             // incremented on pwd change     │
│    iat:             1234567890,    // issued-at timestamp           │
│    exp:             1234654290,    // +24 hours                     │
│    kid:             "kms-key-id"   // active key ID for rotation    │
│  }                                                                  │
│                                                                     │
│  Set-Cookie: session=<JWT>                                          │
│    HttpOnly · Secure · SameSite=Lax · Max-Age: 86400                │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Audit log  (INSERT into audit_entries — append-only)               │
│    event_type: 'auth.login' · actor_id: memberId                    │
│    timestamp: ISO-8601 UTC · result: 'success'                      │
│    (no IP address stored — privacy-safe audit log policy)           │
└─────────────────────────────────────────────────────────────────────┘

  Browser: 302 → /dashboard   +   session cookie set

════════════════════  AUTHENTICATED REQUEST FLOW  ═════════════════════

  Browser:  GET /events/123   Cookie: session=<JWT>
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  web Controller  (runs on every protected route)                    │
│  1. Extract JWT from session cookie                                 │
│  2. Verify signature  (KMS public key, cached at startup)           │
│  3. Check exp claim — reject if expired                             │
│  4. queries.memberById.get(memberId)  →  current member row         │
│  5. Compare JWT.passwordVersion  vs  member.passwordVersion         │
│       Mismatch → clear cookie · 401 · redirect to /login            │
│       Match   → session valid; use db row for authorization         │
└─────────────────────────────────────────────────────────────────────┘

  Request proceeds to service layer with authenticated member context

═══════════════════════  PASSWORD CHANGE FLOW  ════════════════════════

  Browser:  POST /account/password  { currentPassword, newPassword }
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  AuthService  (inside a db transaction)                             │
│  1. Verify currentPassword  (same argon2id check as login)          │
│  2. Hash newPassword with argon2id                                  │
│  3. transaction(() => {                                             │
│       queries.updateMemberPassword.run({                            │
│         passwordHash:    <new argon2id hash>,                       │
│         passwordVersion: member.passwordVersion + 1,  ← KEY         │
│         updatedAt:       now,                                       │
│       }, memberId)                                                  │
│       queries.insertAuditLog.run('auth.passwordChange', ...)        │
│     })                                                              │
│  4. Issue fresh JWT for current device  (new passwordVersion)       │
│     Set-Cookie: session=<new JWT>  (HttpOnly, Secure, SameSite=Lax) │
└─────────────────────────────────────────────────────────────────────┘

  Effect: all other devices receive 401 on next request.
  Their JWT.passwordVersion no longer matches the db value.
  Current device stays logged in — response carries fresh JWT.
```

**Caption:** Login signs a JWT via AWS KMS (`kms:Sign`) — the signing key never leaves KMS. The token carries a `passwordVersion` field that enables immediate cross-device logout: every authenticated request reads the member row from SQLite and compares the JWT's `passwordVersion` against the current database value. A mismatch immediately invalidates all sessions without maintaining a token blacklist. On password change, a fresh JWT with the new `passwordVersion` is issued to the current device so it remains logged in; all other devices are rejected on their next request. Cookies are `SameSite=Lax` — sufficient CSRF protection when combined with strict HTTP verb discipline; no synchronizer tokens are needed.

---

## Figure 4: Request Routing and Dispatch

```
  Note: these are Express route handlers for server-rendered pages,
  forms, and required callbacks — not a public REST API. JSON is
  returned only on designated webhook and AJAX endpoints.

  All requests → nginx → web container
┌─────────────────────────────────────────────────────────────────────┐
│  nginx  (reverse proxy)                                             │
│  CloudFront WAF:    DDoS protection, managed rule groups            │
│  App middleware:    per-account/per-IP rate limiting                │
│  nginx:             CloudFront-to-origin TLS termination            │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Express Router  (maps URL + HTTP method → controller function)     │
│                                                                     │
│  [A] Protected browser routes  (JWT required)                       │
│    GET  /events/:id         →  EventController.getEvent             │
│    GET  /events             →  EventController.listEvents           │
│    POST /events             →  EventController.createEvent          │
│    POST /events/:id         →  EventController.updateEvent          │
│    POST /account/password   →  AuthController.changePassword        │
│    POST /media/upload       →  MediaController.upload               │
│    …                                                                │
│                                                                     │
│  [B] Public browser routes  (no JWT required)                       │
│    GET  /events (public listings)  →  EventController.listEvents    │
│    POST /auth/login               →  AuthController.login           │
│    POST /auth/logout              →  AuthController.logout          │
│    GET  /health/live · /health/ready  →  HealthController           │
│    …                                                                │
│                                                                     │
│  [C] Webhook / JSON callbacks  (signature auth, not JWT)            │
│    POST /stripe/webhook    →  PaymentController.webhook             │
│    POST /ses/bounce        →  EmailController.sesWebhook            │
│    …  (no Handlebars rendering; JSON response; no cookie check)     │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  [A] Protected browser pipeline                                     │
│  1. JWT verify + passwordVersion check  (see Figure 3)              │
│     Origin/Referer allowlist validation for state-changing POSTs    │
│  2. Authorize: tier / role / resource ownership                     │
│  3. Validate request body  (Zod schema)                             │
│  4. Call service method(s)                                          │
│  5. Render Handlebars template → 200 HTML                           │
│     (POST → 303 Redirect → GET for all state-changing forms)        │
│                                                                     │
│  [B] Public browser pipeline                                        │
│  1. No JWT required; rate limiting still applies                    │
│  2. Validate request body  (Zod schema)                             │
│  3. Call service method(s)                                          │
│  4. Render Handlebars template → 200 HTML                           │
│                                                                     │
│  [C] Webhook pipeline                                               │
│  1. Validate payload signature  (HMAC or provider SDK)              │
│  2. No cookie, no session, no Handlebars                            │
│  3. Idempotency check  (stripe_events table)                        │
│  4. Call service method(s)                                          │
│  5. Return JSON  200 / 400 / 409                                    │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┬─────────────────────────┬────────────────────────┐
│  SUCCESS         │  STALE FORM [A only]    │  NOT AUTHENTICATED     │
│  200 HTML page   │  409 + diff view:       │  302 → /login?         │
│  or 303 redirect │  reload + reconcile     │  return=<orig URL>     │
└──────────────────┴─────────────────────────┴────────────────────────┘

  For POST /media/upload [A], step 4 routes to the image container:

┌─────────────────────────────────────────────────────────────────────┐
│  web container  →  image container  (internal Docker network)       │
│  Sends raw uploaded bytes; receives two processed variants.         │
│  image container has NO access to SQLite or other services.         │
└─────────────────────────────────────────────────────────────────────┘
```

**Caption:** These are Express route handlers for server-rendered pages and required callbacks — not a public REST API. Routes fall into three lanes with different authentication and response rules: protected browser routes use JWT + session validation and render Handlebars HTML with POST-Redirect-GET; public browser routes (login page, health checks) skip JWT; webhook callbacks use payload signature verification instead of cookies and return JSON only. Security controls are layered: CloudFront WAF handles DDoS, app middleware handles per-account rate limiting, and each lane handles its own auth check. The 409 stale-form outcome is an application-level UX reconciliation tool; SQLite ACID transactions provide the actual write safety guarantee.

---

## Figure 5: Read and Write Request Flow

```
════════════════  READ PATH  (e.g.  GET /events/123)  ═════════════════

  Two distinct cases depending on whether the request is authenticated:

  PUBLIC REQUEST  (no session cookie — visitor browsing)
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CloudFront default behavior: Managed-CachingDisabled               │
│  HTML always forwarded to Lightsail origin (no edge caching)        │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controller → EventService.getEvent(eventId, null)                  │
│  Returns public view; emits Cache-Control: max-age=300              │
│  (browser may cache; CloudFront does not)                           │
└─────────────────────────────────────────────────────────────────────┘

  AUTHENTICATED REQUEST  (session cookie present — logged-in member)
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CloudFront forwards to origin (CachingDisabled applies to all HTML)│
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controller  (JWT verify + passwordVersion check — see Figure 3)    │
│  → EventService.getEvent(eventId, member)                           │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  EventService  (no HTTP types, no req/res)                          │
│  1. queries.eventById.get(eventId)  →  event row                    │
│  2. Authorize: can this member view this event?                     │
│  3. Compute derived fields; filter by member tier/role              │
│  4. Return typed Event domain object                                │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controller  (assembles view model, renders template)               │
│  5. Build viewModel  (adds UI flags: canEdit, isOrganizer…)         │
│  6. res.render('event-detail', viewModel)                           │
│  7. Set Cache-Control: private, no-store                            │
│     (personalized — must not be cached at edge or shared)           │
└─────────────────────────────────────────────────────────────────────┘

  Browser: 200 HTML response

════════  WRITE PATH  (e.g.  POST /events/123 — update event)  ════════

  Browser:  POST /events/123  { title, description, expectedVersion: 5 }
  Cookie:   session=<JWT>  |  SameSite=Lax blocks cross-site POST
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CloudFront → nginx → web container                                 │
│  (write requests bypass CDN cache automatically)                    │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controller  (JWT verify + passwordVersion + Zod validation)        │
│  → EventService.updateEvent(eventId, data, expectedVersion, member) │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  EventService  (all inside one db transaction)                      │
│  1. queries.eventById.get(eventId)  →  current row                  │
│  2. Stale-form check:  row.version === expectedVersion ?            │
│     Mismatch → throw ConflictError (409)  ← UX reconciliation;      │
│     the entity changed since the form was loaded; show diff         │
│     (SQLite ACID transaction provides actual write-safety)          │
│  3. Validate business rules (date logic, status transitions…)       │
│  4. transaction(() => {                                             │
│       queries.updateEvent.run(newData, eventId)                     │
│       queries.insertAuditLog.run('event.update', actorId, …)        │
│       queries.insertOutbox.run(notification)  // if needed          │
│     })  // COMMIT; async ops (S3 etc.) run after commit             │
└─────────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controller  (after successful commit)                              │
│  res.redirect(303, '/events/' + eventId)                            │
│  (POST → Redirect → GET pattern: prevents double-submit)            │
└─────────────────────────────────────────────────────────────────────┘

  Browser: 303 → GET /events/123  (fresh read, new version visible)
  Other users see update on next page load (HTML not edge-cached)
```

**Caption:** The read path has two distinct cases at the origin. CloudFront's default behavior uses `Managed-CachingDisabled`, so HTML is not cached at the edge regardless of auth state — the cache decision lives entirely at origin. Authenticated requests must return `Cache-Control: private, no-store` from origin to prevent any browser or downstream cache from storing personalized view models. The write path uses SQLite ACID transactions for write safety — all database work commits atomically. The 409 stale-form path is a UX reconciliation tool: if a form was loaded before another user changed the entity, the controller detects the version mismatch and shows a diff to reconcile, but this is separate from the database-level write safety that SQLite transactions provide.

---

## Figure 6: Development vs Production Environment Parity

```
══════════════════  IDENTICAL IN BOTH ENVIRONMENTS  ═══════════════════

┌─────────────────────────────────────────────────────────────────────┐
│  • Same four Docker containers  (nginx · web · worker · image)      │
│  • Same SQLite schema and migration files                           │
│  • Same db.ts module with all prepared statements                   │
│  • Same service layer code  (AuthService, EventService, etc.)       │
│  • Same controllers and Handlebars templates                        │
│  • Same test suite; CI contract tests verify stub correctness       │
└─────────────────────────────────────────────────────────────────────┘

════════════  ADAPTER SWITCHES  (controlled by NODE_ENV)  ═════════════

┌─────────────────────────────────────────────────────────────────────┐
│  Adapter               Production                Development        │
│  ───────────────────────────────────────────────────────────────────│
│  SesAdapter           AWS SES (LiveSesAdapter)   StubSesAdapter     │
│  PhotoStorageAdapter  S3 (future S3 impl)        LocalPhotoStorage  │
│  PaymentAdapter       Stripe live/test SDK       Configurable mock  │
│  SecretsAdapter       Parameter Store (SSM)      local .env         │
│  JwtSigningAdapter    AWS KMS (KmsJwtAdapter)    LocalJwtAdapter    │
│  LoggingAdapter       CloudWatch Logs            Local log files    │
│  MetricsAdapter       CloudWatch Metrics         In-memory store    │
│  URLValidationAdapter Google Safe Browsing API   Syntax check only  │
└─────────────────────────────────────────────────────────────────────┘

═══════════════════════════  NOT SWITCHED  ════════════════════════════

┌─────────────────────────────────────────────────────────────────────┐
│  SQLite database                                                    │
│    Same footbag.db schema and db.ts on local filesystem.            │
│    S3 backup disabled via  ENABLE_S3_BACKUP=false.                  │
│    Migrations run identically:  node migrate.js                     │
│                                                                     │
│  Image processing                                                   │
│    Same image container with Sharp — identical re-encoding.         │
│    PhotoStorageAdapter routes output to local filesystem in dev.    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Default dev mode: no AWS credentials needed.                       │
│  Hybrid mode: set  AWS_PROFILE  to connect to real AWS services.    │
│  CI runs contract tests against stubs on every commit.              │
│  Pre-release: same tests run against real AWS services.             │
└─────────────────────────────────────────────────────────────────────┘
```

**Caption:** Every adapter has two implementations behind the same TypeScript interface: a production implementation that calls the real AWS service, and a development stub that works without credentials. The SQLite database and all four Docker containers run identically in both environments — only the adapter wiring changes. Contract tests in CI verify that each stub faithfully implements its production counterpart's behaviour. A developer can clone the repo, run `docker compose up`, and have a fully functional local system without any AWS account.


*END OF DIAGRAMS DOCUMENT*
