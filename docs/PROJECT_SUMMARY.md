# Footbag Website Modernization Project — Project Summary

**Last updated:** March 16, 2026

**Prepared by:** David Leberknight / [DavidLeberknight@gmail.com](mailto:DavidLeberknight@gmail.com)

**Document Purpose:**

This Footbag Website Modernization Project will upgrade footbag.org as the new global community hub for the sport of footbag. The project will create a secure, open-source, low-cost platform designed for volunteer maintenance over decades. The architecture deliberately prioritizes simplicity over sophisticated features, with the goal being that future volunteer developers should have minimal skill requirements. Features include secure voting, money collection, member-maintained media galleries, and more, all hosted in the AWS cloud, and designed with best-practice design patterns and technologies.

## Table of Contents

1. Document Relationships
2. Design Philosophy
3. Functionality
  3.1 Media Content
  3.2 Membership Tiers
  3.3 Voting
  3.4 Payments
  3.5 Emails
4. Solution Architecture
  4.1 Core Design Decisions
  4.2 SQLite Database
  4.3 Front to Back Design
  4.4 AWS Overview
  4.5 Controllers and Business Services
  4.6 Technology Stack
  4.7 Distributed System Patterns
  4.8 Runtime Infrastructure and Cost
5. Development and Production Parity
  5.1 Why Perfect Parity Matters
  5.2 How Parity Works
6. Security
  6.1 Authentication Design
  6.2 Image Upload Strategy
  6.3 Additional Security Protections
  6.4 Video Content
  6.5 Privacy-First Design
  6.6 Audit Logging
  6.7 Data Encryption
  6.8 Threat Model
7. DevOps
  7.1 Backup Strategy
  7.2 High Availability
  7.3 Operational Documentation
  7.4 Infrastructure as Code
  7.5 Testing
  7.6 Continuous Integration
8. Legacy Archive
9. Volunteer Development

---

# 1. Document Relationships

The project documentation suite consists of the following documents:

**View Catalog:** Defines the authoritative page/UI/view/route/view-model specification for the cataloged views. It documents which pages exist, which route renders each page, what the page is for, what the page-level boundaries are, and what data shape the rendered view requires. 

**User Stories:** Defines complete feature scope, and describes what users must be able to achieve, and acceptance criteria (system side effects). Source of Truth for Functional Requirements.

**Service Catalog:** This defines the back-end services that meet all Functional Requirements as defined by User Stories and Design Decisions. It defines the boundaries and method contracts used by Controllers and background jobs to invoke these business services. This document is the source of Truth for business logic, Controller to Service conventions and behaviors, persistence adapter expectations, and error semantics at the boundary between the front and back end systems. The level of detail is such that it can drive the AI implementation of the user-facing functionality in a way that is separate from UI layouts and from Server technology specifics.

**Project Summary (this document):** Provides a high-level introduction to the Footbag Website Modernization Project, explaining what the system does, why it is designed this way, and the major solution architecture choices that follow from the Design Decisions and User Stories documents. Together, these three documents define the high-level requirements from which all other documents must be consistent. 

**Glossary:** Jargon definitions and acronym reference for technical terms for humans.

**Diagrams:** Visual aids to understand system design including system context, infrastructure topology, the data model, data flow diagrams, and security boundaries.

**DevOps:** Covers develop, test, build, release, operate, and recover procedures across environments (dev, stage, prod). Includes operational runbooks, CI/CD pipeline implementation, and infrastructure management procedures.

**Developer Onboarding:** Guidance for software developers joining the project, specifically targetting the Minimum Viable First Page of functionality, to stand up the full tech stack for the first time. Covers technology-specific tutorials, architecture walkthroughs, contribution workflows, troubleshooting, and tips.

**Design Decisions:** Captures technology and design decisions and their rationale. It explains why major choices were made, and which constraints are intentional, with implementation details where known or applicable. It is the Source of Truth for design commitments and non-functional requirements from which the Solution Architecture follows.

**Data Model:** Defines canonical data schemas and conventions for all persisted entities. It is the Source of Truth for entity types, common fields, storage layout, key structure, relationships between entities. The Service Catalog document elaborates on the expected queries into the data and their requirements that are used to derive this model. The schema sql file goes with this, to create the SQLite database.

---

# 2. Design Philosophy

**The Maintenance Problem:**

Traditional community websites use databases, application frameworks, and complex architectures requiring specialized expertise. When volunteer developers move on, institutional knowledge leaves with them. New volunteers face steep learning curves. Systems become unmaintainable, requiring expensive contractors or eventual replacement. This Footbag Website Modernization Project inverts this to optimize for volunteer maintainability, not technical sophistication.

**Transparency Over Abstraction:**

All system state lives in a SQLite database file with human-readable schema. Any volunteer can inspect data using the standard sqlite3 command-line tool, understand state through SQL queries, and verify correctness without specialized tools beyond basic SQL knowledge.

**Simplicity Over Features:**

The platform deliberately avoids complexity. Minimal database configuration. No message queues requiring monitoring (except for email outbox). No complex frameworks. No sophisticated design patterns. Minimal derived data structures requiring synchronization. Instead: the system stores code and operational artifacts as simple files in folders, while application data lives in a single SQLite database file (except photo data which lives in an AWS S3 bucket), runs on standard Docker containers in a straightforward AWS environment, coded using popular languages and frameworks, all with clear documentation.

**Community Trust Over Control:**

Members can upload media content (photos and links to videos), lead clubs, and launch events, with administrator approval required only to set up sanctioned, paid event pages. Rather than creating moderator hierarchies, the system trusts members to flag problematic content. Admins provide oversight, not gatekeeping (by reviewing member-flagged content for possible deletion). All administrative actions are logged, with reason provided, in a way that is tamper proof.

---

# 3. Functionality

Complete functional requirements with acceptance criteria are in the User Stories document. The functionality closely follows the legacy footbag.org site, but with usability improvements for members, payments and email integration, secure voting, and much improved admin powers.

The site is a public-facing community hub with a tiered membership model: Visitors can browse public clubs, events, news, tutorials, and media. Members (Tier 0+) authenticate to participate (create a profile, club affiliation, event registration, email preferences, donations/payments, and personal data controls). Tier 1+ Members add community creation (media uploads, galleries/hashtags) and can take on leadership roles by creating clubs and free events. Tier 2+ members unlock advanced eligibility, including the ability to apply for IFPA event sanctioning and sponsorship; payments are a separate capability that may be enabled for events via admin approval.

Club Leaders manage a club's presence and lifecycle with a small co-leader team, and Event Organizers run an event end-to-end (registration operations, attendee communications, and results publication), with sanctioned/paid events gated through an admin-approved process. Platform governance is supported by Administrators who handle moderation, approvals, finance operations, vote administration, communications, and system configuration, with strong auditability across privileged actions.

Discovery and content are unified by a shared media model: the platform hosts uploaded photos while videos are link-based, and everything (clubs, events, tutorials, and media) ties together through hashtags and galleries so event/club activity naturally aggregates into browsable collections. Community safety is human-reviewed: members can flag content and admins take explicit, reasoned actions if required.

Money and governance are first-class: Stripe-backed payments support donations (one-time/recurring), membership upgrades, and paid event registration, with member-visible payment history and admin reconciliation/controls. The site also includes privacy-preserving voting (encrypted ballots with verifiable participation), where eligibility can be tier-based and influenced by special flags, including Hall of Fame (HoF), Big Add Posse (BAP), and Board/Admin status.

When system events require administrator attention (event sanction requests, flagged media, leadership reassignments, payment reconciliation issues, election management tasks, etcetera), the system creates work queue items visible on the admin dashboard. When an item is added to the queue, the system sends an email notification to the admin-alerts mailing list containing only the task type and entity ID (no sensitive member data such as email addresses, payment amounts, or personal information). This ensures timely admin awareness while preserving data privacy.

**Out of Scope (Phase 1):**

- Real-time features (WebSockets, live updates).
- Mobile native apps.
- OAuth/SSO authentication.
- Forums/discussion boards.
- AI/ML content moderation.
- Multi-language support (English only, except event info).
- Advanced analytics and BI.
- Third-party REST API.
- Video hosting (except legacy archive).
- Animated GIFs (use video links).
- Direct organizer payouts (Stripe Connect).
- Archive search.
- Marketplace beyond event registrations and donations.
- E-Commerce (a store) will be a big feature for Phase Two. We can raise money and provide cool merch to the community. This might include adding PayPal as a second payment option (after Stripe) for user convenience.
- Merging the full content from FootbagHallOfFame.net onto Footbag.org will be a feature for Phase Two, which will eliminate the cost of hosting that site on SquareSpace.

## 3.1 Media Content

Members upload photos and share links to videos into named galleries, and then use hashtags to further drive organization and discovery. Standardized hashtags provide reliable structure for event and club galleries, while freeform hashtags let members create organic community vocabulary and organization.

**Standardized hashtags** (social-platform format)

- Event tags: #event_{year}_{event_slug} (e.g., #event_2025_beaver_open)
- Club tags: #club_{location_slug} (e.g., #club_san_francisco).
- These tags are validated at event/club creation to prevent duplicates and become the canonical identifier used for automatic gallery linking.
- Tag matching is case-insensitive, while preserving original capitalization for display quality.

**Freeform hashtags**

- Members can add any tags (e.g., #ripwalk, #tutorial) with only basic security/length checks; freeform tags do not create entity linking, but power browsing and discovery.

**Discovery and browsing**

- Tags are clickable everywhere and open a tag gallery (photos + videos) plus Related Tags (top co-occurring tags). A public /tags page provides Popular Tags and All Tags, and only lists "community tags" used by at least two distinct members.

**Auto-generated event/club galleries**

- Event/club pages detect whether at least one media item exists for the standardized hashtag and show "View Event Gallery / View Club Gallery" links accordingly. Galleries are built from metadata scanning and optimized for fast loads (caching + progressive enhancement).

**Ownership and change propagation**

- A single media item can appear in a member's personal collection and multiple event/club galleries simultaneously (no duplication). Members can delete media anytime, and tag edits immediately move content into/out of galleries (with short CDN caching delays for visibility).

**Data Storage**

Photo data is handled separately from application data, in a dedicated AWS S3 bucket (not the SQLite database). The photo data is large and will grow over time, and so storing this together with Lightsail would blow out the size, and therefore the cost, and this is why we store photo data in S3. Uploaded photos are processed into standardized display variants, security-processed before storage, and stored in S3. Original files are discarded after processing. 

## 3.2 Membership Tiers

The platform supports four IFPA membership tiers with clear capabilities. The following bullets summarize tier capabilities; the detailed member, administrator, event organizer, and club leader user stories define the exact behavior.

- **Tier 0:** Can log in, manage profile, use authenticated member search (anti-enumeration, non-directory), join one club, view and register for events, read news feed, access historical archive, and manage email subscriptions. Tier 0 is free and non-expiring, but is non-voting and not counted in the official IFPA roster.
- **Tier 1:** All Tier 0 privileges plus upload photos and video links, flag questionable media content, create a club, vote, create basic (free) events. Tier 1 includes Annual and Lifetime variants. Tier 1 Annual is earned by attending IFPA-sanctioned events or via Tier 2+ recognition vouching; each sanctioned event attended extends Tier 1 Annual for 365 days from event date.
- **Tier 2:** All Tier 1 privileges plus the ability to apply for event sanctioning/sponsorship, create paid events, send emails to the IFPA announce mailing list, access organizer-only areas, and recognize other members as Tier 1 Annual. Tier 2 members have limited roster access (by IFPA rules). Tier 2 includes Annual and Lifetime variants. Any Tier 2 dues payment permanently grants Tier 1 Lifetime.
- **Tier 3:** IFPA directors (elected/appointed per By-Laws). Includes Tier 2 privileges plus board-level voting privileges and direct roster access.

**Tier Lifecycle Rules:**

- Tier 1 Annual expires after 365 days unless extended by attending an IFPA-sanctioned event or via Tier 2+ vouching recognition. Upon expiry, the member falls back to Tier 0.
- If Tier 2 Annual expires after one year, the member falls back to Tier 1 Lifetime without gap because any Tier 2 dues payment permanently grants Tier 1 Lifetime. Renewal notifications use two Administrator-configurable pre-expiry offsets (defaults: T-30 days and T-7 days) plus a built-in day-of expiry notification (T+0, not separately configurable). Early renewals stack from current expiry date, not purchase date.

**Special Designations:**

- Hall of Fame (HoF): Permanent honor that automatically confers Tier 2 Lifetime.
- Big Add Posse (BAP): Permanent honor that automatically confers Tier 2 Lifetime.
- Board Members: Tier 3 while serving, with fallback to prior tier when boardMember flag removed.
- Site Administrators: Must be IFPA members (Tier 2 Lifetime or Tier 3) to be assigned the role.

Standardized Flags for members: boardMember (Tier 3), clubLeader (per club), eventOrganizer (per event), HoF (Hall of Fame), BAP (Big Add Posse), tierStatus (with date obtained and expiry for annual tiers).

## 3.3 Voting

The platform provides Admin-configurable voting services, using server-side ballot encryption with voter privacy protections and audit logging, giving IFPA full control. Ballots submitted as plaintext over HTTPS and encrypted server-side using AWS KMS envelope encryption before storage. Decryption requires separate privileged role used only in tally operations.

A vote could be run for IFPA Board elections, Hall of Fame elections, or single-topic votes for IFPA Board members (for example a rule change). It's all configurable based on member attributes (Tier status, HoF/BAP/Board flags) or explicit inclusion lists, as defined when creating a vote configuration. Admins can run a vote and then act on the results manually.

Full platform control ensures governance independence and long-term sovereignty. One-time development investment eliminates permanent vendor dependency and ongoing costs. Server-side encryption keeps keys secure (never exposed to browser). Bespoke implementation aligns with project philosophy: simplicity, transparency, member ownership.

Ballots are encrypted server-side using AWS KMS envelope encryption. Decryption requires a separate privileged IAM role used only during controlled tally operations, ensuring vote privacy is maintained even from platform administrators during the active voting period. 

## 3.4 Payments

Stripe handles all credit card processing with separate Live/Test API keys per environment. IFPA acts as intermediary. The platform collects event registration payments via Stripe and records/reconciles transactions. Transfer of funds to event organizers occurs outside this system, a manual IFPA process.

Admin approval required before payment features activate for any event. Funds flow to IFPA's Stripe account, not to individual organizers. Manual distribution provides IFPA oversight and reconciliation capability. Organizers never directly handle money. All transactions logged with comprehensive audit trail.

Using Stripe offloads PCI compliance (no card data touches our systems). Test mode in dev/staging enables safe payment testing. Required for processing membership dues, event registrations, and donations.

Stripe webhooks are treated as durable input events; the system records them, applies idempotent payment state transitions, and runs nightly reconciliation that produces durable discrepancy reports for admins. Duplicate deliveries from Stripe retries do not cause duplicate payments or refund processing. A webhook handler validates signatures and processes payment events to update local payment records and trigger downstream effects (tier upgrades, receipts, registration confirmation).

All payment state transitions are tracked to prevent financial reconciliation failures. A nightly reconciliation job compares local payment records against Stripe to detect discrepancies.

Note that it is possible to add PayPal as a second option for user convenience in Phase Two.

## 3.5 Emails

The platform sends all transactional and bulk email via AWS SES using an Outbox pattern that decouples email reliability from request processing. This provides reliable delivery with retries, auditability, and operational controls. Full implementation details (poll interval, retry behavior, dead-letter handling, pause toggle) are in Design Decisions and User Stories SYS_Send_Email. SES bounce/complaint webhooks keep mailing list subscription status current.

Mailing Lists: Lightweight MailingList and MailingListSubscription entities provide clear, query-friendly model. Event participant lists (organizers only), club member lists (leaders only), IFPA announce list (admins only). Member-controlled subscription preferences stored via MailingListSubscription provide transparency and control. SES bounce and complaint handling keeps email lists clean automatically.

---

# 4. Solution Architecture

The modernized Footbag.org is a traditional web application in which the pages are rendered on the server. Visitors and members use a browser to request pages from AWS CloudFront, which forwards dynamic requests to the Lightsail-hosted web application. The Presentation Layer renders HTML using Handlebars templates, then TypeScript provides interactive behavior in the browser (for usability-enhancing features that need validation/autocomplete/media previews) while page navigation remains server-rendered.

Controllers handle HTTP requests, calling services and returning HTML or JSON based on request context. Services implement the business rules, and all persistent state is stored in SQLite except for photos. A single TypeScript file, db.ts exports prepared SQL statements, database connection, and transaction helpers. This separation keeps the front end (pages, forms, interactions) clearly distinct from the business logic, which is separated from the back end storage, and AWS infrastructure.

## 4.1 Core Design Decisions

The following key solution architecture decisions define how the new Footbag.org is built. This subsection is a summary only, as later sections of this document and the Design Decisions document provide the full rationale.

- Data storage: All application data (except photos) is stored in a single SQLite database file named `footbag.db`. The application runtime opens that filename directly. Local and production host paths may differ, but Docker/Compose must mount the chosen host file into the application working directory as `./footbag.db`. Photo data is stored in a separate AWS S3 bucket. Queries are expressed as prepared SQL statements in a single `db.ts` module (plus transaction helpers) that services call directly by query name. 
- Server-rendered web application: The site is a traditional multi-page web application. HTML pages are rendered on the server using Handlebars templates. Client-side TypeScript/JavaScript is used for validation, autocomplete (optional), media previews, and similar conveniences.
- Four-layer software architecture: The code is organized into Presentation Views, HTTP Controllers, Business Logic Services, and Infrastructure Adapters.
- JWT-based sessions with per-request validation: Members authenticate via short-lived JSON Web Tokens stored in secure cookies, including a passwordVersion field so password changes immediately invalidate old tokens, like this: per-request validation compares JWT passwordVersion claim with the current passwordVersion datum; a password change increments passwordVersion, immediately invalidating all sessions across all devices. Authorization decisions (tier/role) are evaluated against the current database state on each request, not only JWT claims.
- Immutable audit logs: All state-changing actions are recorded in append-only immutable audit table.
- Single Lightsail origin with CloudFront CDN: A single Docker-based application instance on AWS Lightsail handles dynamic requests behind an AWS CloudFront distribution.
- Archive.footbag.org: The legacy Footbag.org site is preserved as a static HTML mirror in a dedicated S3 bucket and delivered via CloudFront at archive.footbag.org.

These decisions are summarized here for context. Full rationale, trade-offs, and alternatives considered are documented in the Design Decisions document.

## 4.2 SQLite Database

This is a key decision that balances simplicity with query performance, transaction safety, and data integrity. Our approach uses the industry-standard SQLite database with minimal configuration and maximum benefit. All the database data is stored in a single file (footbag.db) with a straightforward relational schema.

All data access is invoked from Service-Catalog methods that in turn call prepared SQL statements (and transaction helpers) defined in a single code module (db.ts).

With moderate data volumes and CloudFront caching, SQLite provides excellent query performance while maintaining operational simplicity.

**What We Gain:**

- Query performance: SQL with indexes.
- Transaction safety: ACID guarantees.
- Data integrity: Foreign key constraints enforced by database.
- Minimal configuration: no complex tuning required.
- Inspectable data: Standard sqlite3 CLI tool shows schema and data.
- Simple backups: Single file uploaded to S3 every 5 minutes.
- No database licensing or managed service costs.

**What We Accept:**

- Single-writer constraint.
- RPO 5 to 10 minutes.
- Basic SQL knowledge required.
- Schema migrations require maintenance window, brief downtime.

For a community site at this scale, the design, development, maintainability, and cost gains outweigh the minimal added complexity of a relational database (as opposed to a strictly JSON-file-based approach). SQLite requires no server processes, no connection pooling, no replication configuration.

**Data Access Pattern:**

All data access occurs through a single database module (db.ts) that exports prepared SQL statements and a transaction helper. Services call prepared statements directly with parameters. All statements are prepared once at application startup for maximum performance (SQLite compiles SQL to bytecode once, reused forever).

Statement naming follows consistent pattern: entityByField (memberByEmail, eventById), entitiesByField for arrays (eventsByOrganizer), createEntity (createMember), updateEntity, deleteEntity. Positional parameters (?) prevent SQL injection attacks. Error handling catches specific code for consistency. Transactions acquire write lock immediately, wrapping multi-step operations with automatic commit or rollback.

## 4.3 Front to Back Design

The code follows a four-layer structure separating concerns:

**Presentation Layer (Frontend):**

JavaScript is required for interactive features. Core pages are server-rendered HTML. JavaScript validates form fields before allowing submission via traditional browser POST (not fetch). Server-side validation remains authoritative (defense-in-depth). Users with JavaScript disabled see a noscript message requesting enablement. This is simple for volunteer maintainability, with traditional multi-page navigation. It is SEO-friendly, fast initial load, and simple to understand.

The platform targets modern browsers and requires JavaScript for interactive features (including pre-submit form validation, optional enhancements such as hashtag autocomplete/progressive image loading, and Stripe's hosted checkout page). Exact browser support baseline versions are defined in the Design Decisions document.

**How Page Loads Work:**

Every primary view (home page, event listings, club directory, member dashboard, admin dashboards) is reachable via a stable, bookmarkable URL. When the browser requests such a URL, the server resolves it to a TypeScript Controller function, which invokes a Service method for the business logic if authorized. Page-access authorization decisions are always derived from the current member record in the database on each authenticated request, not from cached JWT claims. This ensures member tier or role changes, and password resets take effect immediately (rather than waiting for JWT expiry). Controllers render full HTML pages using Handlebars templates. Services call prepared SQL statements exported from db.ts (via named query objects) against the SQLite database.

**TypeScript Enhancement:**

Browser-side TypeScript/JavaScript attaches to specific pages for usability enhancements such as inline validation, autocomplete, dynamic filters for lists, file previews, and drag-and-drop for media uploads (if implemented). Templates remain server-rendered by Handlebars. Forms submit via native browser POST; JavaScript acts as a client-side validation gate to catch errors before submission, improving UX but not blocking functionality, as server-side validation is authoritative. The site functions without JavaScript; users with JavaScript disabled see a noscript message recommending enablement and can still submit forms and navigate the site. The one functional exception is Stripe's hosted checkout page, which requires JavaScript as a third-party dependency.

**Page Navigation:**

On the site, each meaningful URL corresponds to a real server-rendered page. There is no client-side router that intercepts links and simulates navigation. When the user clicks a link or submits a form, the browser performs a normal HTTP request and receives an HTML response. Some pages may use JavaScript-driven interactions (for example filters or "Load more" controls) where explicitly implemented, but core navigation remains normal link/form HTTP requests to server-rendered pages (no client-side router).

**Static Assets and CDN:**

CSS, JavaScript bundles, images, and fonts are served as static assets via CloudFront CDN using versioned filenames. HTML pages are rendered at the origin; public cacheable pages may be cached briefly at CloudFront, while authenticated/personalized pages and API responses are not cached.

Templates reference assets using versioned URLs so that new deployments do not break older pages that are still cached. Old content-hash asset versions are removed after a configurable retention window (default defined in User Stories); exact cleanup mechanism and lifecycle details are specified in the Design Decisions document.

**Controllers Layer (HTTP Interface):**

Handles HTTP request/response cycle. Parses and validates input using Zod schemas (TypeScript-based validation providing compile-time and runtime safety). Extracts and verifies JWT authentication tokens. Calls appropriate service methods. Maps service responses and errors to HTTP responses. Enforces rate limits and security policies. Controllers act as the reception desk; they receive requests, verify credentials, route appropriately, and format responses.

**Controller Pipeline for Form Submissions:**

Controllers validate authentication/authorization and enforce HTTP verb discipline (no mutations on GET). State-changing requests are permitted only when authorized. If the origin is unavailable or returning 5xx errors, CloudFront serves the maintenance page (normal ↔ maintenance is the only operational state).

**Response Format Negotiation:**

Default: server-rendered HTML redirect/rerender flows. JSON responses are returned only on designated webhook/callback or AJAX endpoints where they are functionally required. For JSON-only routes, enforce Content-Type: application/json.

**Form Handling:**

On success: performs the operation using services, then returns a redirect (Post/Redirect/Get pattern) to the next page (for example a confirmation page) that shows the updated state.

On failure: prepares a view model that includes the original user input, field-level errors, and any global error messages, then renders the same form with highlighted errors and preserved values.

**Authentication and Sessions:**

Login and logout flows use the same form + controller + template pattern. After successful login, subsequent requests reflect the authenticated member's state in navigation and views (for example "My Account", "Dashboard", "My Clubs", "My Events"). If a member attempts to access a protected URL without a valid session, the UI redirects them to the login page and, after successful login, returns them to the originally requested URL when appropriate. When a session expires or becomes invalid (for example after password change), the UI consistently redirects to login with a clear message.

**Services Layer (Business Logic):**

Contains all domain logic and business rules (documented in Service Catalog as derived from User Stories). Performs authorization checks beyond basic authentication. Validates business constraints (single club membership, event capacity, email uniqueness, hashtag uniqueness, etcetera). Reads and writes data via prepared SQL statements (and transaction helpers) exposed by the shared db.ts code module. Manages cross-cutting concerns: email queueing and audit logging. Services are the back office; they do the actual work while controllers handle communication.

**Infrastructure Layer:**

Provides abstractions for External Services making them look identical whether running locally (development) or in production. These are code-level abstraction layers in the back end which provide developer-production parity, and allow developers to build and test code without using AWS credentials or live links to the other systems.

- EmailAdapter: AWS SES in production, in-memory capture in development.
- PaymentAdapter: Stripe SDK in production, mock responses in development.
- SecretsAdapter: AWS Parameter Store in production, local JSON in development.
- CloudTrailAdapter: surfaces AWS CloudTrail audit events for AWS activity; in development, writes simulated audit events to local files.
- LoggingAdapter: In production, sends structured application and technical logs to CloudWatch Logs; in development, writes the same structured logs to local files.
- MetricsAdapter: In production, sends metrics (counters, timers, gauges) to CloudWatch Metrics; in development, records the same metrics in local in-memory or file-based storage.
- URLValidationAdapter: In production, performs URL validation including format checks and allowed host patterns; in development, uses a deterministic stub that validates syntax and known patterns without making outbound network calls.
- PhotoStorageAdapter: Abstracts photo storage between environments. Production uses S3 buckets; development uses local filesystem with identical structure.

This layer is the translation service. Services call generic interfaces; infrastructure routes to appropriate implementation based on environment (dev, stage, prod).

## 4.4 AWS Overview

**Why AWS Was Selected**

The platform could run on any cloud provider (Azure, Google Cloud, DigitalOcean) or on-premises infrastructure. AWS was selected because:

- Maturity and Stability: Twenty years of proven reliability with extensive documentation and community knowledge.
- AWS has all the features we need at a low price.
- Pay-As-You-Go Pricing: No minimum commitments or enterprise contracts.
- Free Tier Benefits: First year includes substantial free usage.
- Service Integration: Native integration between services reduces complexity.
- Portability: Design uses standard S3 APIs and Docker containers.

**Key AWS Services:**

- AWS Lightsail: Simplified virtual server (4GB RAM, 2 vCPUs) hosting all Docker containers in us-east-1 region.
- AWS S3: Object storage with 99.999999999% durability; primary bucket (us-east-1), backup bucket (us-west-2), and archive bucket for footbag.org mirror.
- AWS CloudFront - Global CDN for caching content at edge locations globally, and serving custom error pages when the origin is unavailable. When the Lightsail origin returns 5xx errors or is unreachable, CloudFront serves a maintenance page from S3. 
- AWS SES: Email delivery with authentication (SPF, DKIM, DMARC) and bounce handling.
- AWS Parameter Store: Stores webhook/Stripe secrets and non-key config. JWT tokens are signed with an AWS KMS asymmetric key; signing keys are not stored in Parameter Store. SecureString secrets (organized hierarchically under /footbag/ namespace with /prod/, /staging/, /dev/ environment subpaths) can hold sensitive configuration details that must not be checked into source control.
- AWS CloudWatch: Unified monitoring service for logs, metrics, and alarms.
- AWS Route 53: DNS service routing traffic to CloudFront distributions.
- AWS Systems Manager Session Manager: Secure admin access replacing traditional SSH (no exposed port 22).

**IAM Security Approach:**

All AWS services accessed with least-privilege IAM (Identity and Access Management) policies:

- Deployed workload runtime assumed role(s) limited to: S3 operations on primary/backup buckets only, SES send operations on verified domain only, Parameter Store read-only on /footbag/ namespace, and CloudWatch put metrics/logs as required. The Lightsail host does not rely on an EC2-style instance role attachment; runtime AWS access uses explicit runtime role assumption.
- Parameter Store uses AWS SecureString encryption.
- KMS keys have minimal access per security rules.
- S3 bucket policies deny access except from the application runtime assumed role(s) and approved administrator IAM principals (different from the application-administrator role).
- MFA delete enabled on backup bucket.

**System Administrator vs Application Administrator Roles:**

The platform distinguishes between two distinct administrative roles with different responsibilities and access levels:

- System Administrator (Developer Role): Technical staff responsible for AWS account setup, IAM policy configuration, billing management, infrastructure provisioning, and deployment operations. This role is necessary for initial platform setup and ongoing infrastructure maintenance but does not require access to application-level member data or business operations. Examples: configure CloudWatch job schedules, rotate Stripe keys in Parameter Store via CLI, adjust container memory limits in docker-compose.yml, set up budget alerts and SNS topics, configure SES domain authentication. System administrators have AWS console and CLI access with permissions to manage Parameter Store secrets, S3 bucket policies, CloudWatch configurations, and other infrastructure components.
- Application Administrator (User Role): IFPA Board members or designated volunteers who manage day-to-day platform operations through the web interface. Application administrators can moderate content, manage member flags, approve event sanctions, handle payment disputes, and access audit logs for governance purposes. This role operates entirely through the web application and has no direct AWS infrastructure access.

This separation follows AWS security best practices for least-privilege access: system administrators manage infrastructure but cannot directly access or modify member data without audit trails, while application administrators manage community operations without infrastructure permissions. All system administrator AWS actions are logged via CloudTrail, and all application administrator actions are logged via the platform's audit logging system.

## 4.5 Controllers and Business Services

The platform uses a single controller layer that handles all HTTP interactions. Controllers are HTTP request handlers that:

- Receive and validate HTTP requests (query parameters, form data, JSON payloads)
- Perform authentication (validate session cookies) and authorization (check member permissions)
- Call business services with domain objects
- Return responses in appropriate format: HTML pages (server-rendered via Handlebars) for browser navigation, JSON data for AJAX requests and webhooks, Proper HTTP status codes and headers.

**Service Layer Independence:**

Controllers delegate all business logic to services. Services are completely HTTP-agnostic, accepting domain objects as input, returning domain objects or errors. Services never touch HTTP requests, responses, cookies, or headers. Services orchestrate business logic by calling prepared statements from db.ts (for example queries.memberByEmail.get(email)) and never call db.prepare() or write inline SQL.

## 4.6 Technology Stack

The platform uses a focused, mainstream technology stack chosen for volunteer maintainability and long-term sustainability.

**Front end:**

- Handlebars templates - Server-rendered HTML, no build step required for templates.
- TypeScript - Required for interactive features; provides client-side validation, type safety, and dynamic behavior. Compiled to JavaScript bundles with content-hash filenames.

**Back end:**

- Node.js + TypeScript - Unified language stack, strong typing, async-first.
- Express.js - Industry standard HTTP framework with extensive ecosystem.

**Data and Storage:**

- SQLite database (better-sqlite3) - Single database file with minimal configuration, prepared statements for performance.
- Single db.ts module exports all prepared statements with descriptive names (memberByEmail, createEvent, etc.).

**Infrastructure:**

- AWS Lightsail - Single 4GB instance with simple, predictable pricing.
- AWS CloudFront - Global CDN for caching and custom error-page handling (maintenance-mode UX) when the origin is unavailable.
- AWS S3 - Primary storage for photo data (with cross-region replication for backup) and storage for SQLite database snapshot backups.
- AWS SES - Transactional and bulk email delivery with bounce/complaint handling.
- AWS Parameter Store -- keeps some secrets out of source control; access is controlled by IAM. It does not protect against in-container compromise.
- AWS KMS -- keeps secrets out of source control; access is controlled by IAM. Used for cryptographic operations needing non-exportable key custody.
- AWS IAM -- Enforces security, role-based and minimal system permissions.
- Docker - Container orchestration for local development and production.
- Stripe - Payment processing with PCI compliance offloaded.

Why These Choices: Mature, well-documented, widely-adopted technologies. Millions of developers know this stack. Extensive community support and learning resources available. No exotic frameworks or custom tools. Optimizes for volunteer onboarding speed and long-term maintainability. These also provide the simplest design to meet requirements with the lowest-cost technology, a viable approach given the very stable functional requirement set.

## 4.7 Distributed System Patterns

The following design patterns solve fundamental distributed systems problems.

**Transaction Safety:**

SQLite ACID transactions provide the primary write-safety guarantees. SQLite serializes conflicting transactions automatically via busy_timeout. Application enforces a (configurable) 30-second transaction timeout to prevent runaway operations, and services use bounded retry handling for SQLITE_BUSY where appropriate (especially idempotent operations). Services wrap multi-step operations in the transaction helper.

**Outbox Pattern (Reliable Email Delivery):**

The Problem: Sending email during request processing creates issues. If email fails, should request fail? If we retry, might we duplicate emails?

The Solution: When action requires email, write an outbox record (in the database outbox table) and respond to the user immediately. Background worker polls the outbox, sends emails, and retries failures with exponential backoff before eventually moving permanently failed messages to dead-letter handling. This decouples email reliability from request processing and prevents complicated asynchronous design patterns in the code. It also gives visibility to all emails sent for internal records and auditing / debugging.

**High Availability:**

The Problem: Single compute instance means site unavailability during failures.

The Solution: CloudFront serves a custom maintenance page from S3 when the origin is down. Users see a clear message: "Footbag.org is temporarily unavailable. Please try again in a few minutes." Automatic recovery occurs when the origin returns to health---CloudFront resumes serving live content within 10 seconds (error page cache TTL).

Limitations: This design accepts brief downtime (estimated 52 minutes per year based on AWS Lightsail 99.99% SLA) in exchange for operational simplicity appropriate to volunteer maintenance.

**Deletion Lifecycles (Referential Integrity):**

The Problem: Deleting records breaks references (event references organizer, registration references member). In a relational database, cascade deletes or foreign key constraints can solve this, but we must take care with the details.

The Solution: Each entity follows one of three deletion lifecycles depending on its referential and recovery requirements:

- **Grace-period deletion with restore** (members): sets a deleted_at timestamp. The account is immediately inaccessible but can be restored by the member within the configurable grace period. After the grace period, PII is purged and the row is anonymized but retained for referential integrity. Foreign keys use ON DELETE NO ACTION to prevent accidental hard deletes during the grace period.
- **Status-based archival** (clubs): sets status = 'archived'. Records are never removed from the database.
- **Hard delete** (events without results, news items, media): records are immediately and permanently removed. Events with results are always preserved permanently.

Trade-offs: Database table views filter member deleted_at for transparent query safety. Hard-deleting events and news items eliminates cleanup job complexity and configurable grace periods for those entities; confirmation dialogs are the undo safeguard.

## 4.8 Runtime Infrastructure and Cost

Four Docker containers run on a single AWS Lightsail instance (4GB RAM): nginx (reverse proxy), web (Node.js application), worker (background tasks), and image (isolated image processor). Authoritative memory allocations are defined in Design Decisions. At initial allocations, total container memory is approximately 1,920MB (~47% of 4GB), leaving over 2GB headroom for OS and traffic spikes. Memory limits are enforced via docker-compose.yml mem_limit directives. Containers exceeding limits are killed (OOM) with automatic restart. CloudWatch monitors per-container memory with alerts at 80% (warning) and 90% (critical) utilisation. These are initial estimates based on typical workload patterns. Production monitoring will validate allocations and inform adjustments. 

**Operational Simplicity:**

This single-instance architecture eliminates common operational burdens: no load balancer configuration, no session state synchronization, no distributed cache invalidation, no multi-region failover procedures, no read replica lag management. Administrators focus on single application instance health. Deployment is single-instance container update. Debugging traces single request path. This simplicity enables volunteer maintenance over decades without specialized DevOps expertise.

**Container Memory Allocation Rationale:**

Docker containers share host resources. Without explicit limits, one container can consume all available memory, crashing others. The specific memory limits for the nginx, web, worker, and image containers are defined in the Runtime Infrastructure section; this section explains why those limits exist and how they protect overall system stability and cost.

Memory limits provide:

- Resource Isolation: Each container gets guaranteed minimum; cannot starve others.
- Predictable Performance: Known memory bounds enable capacity planning.
- Failure Containment: Out-of-memory in one container doesn't crash entire host.
- Cost Optimization: Right-sizing limits means smaller instance required.

**Estimated Monthly Costs:**

- AWS Lightsail (4GB instance): $40.00 (2 vCPUs, 80GB SSD, 4TB transfer).
- AWS S3 storage: approximately $3.20 (database backups: approximately $3/month for primary and cross-region backup storage using S3 Intelligent-Tiering and Object Lock; photos: approximately $0.18/month with 2-variant storage and One Zone-IA backup replication). 
- AWS S3 requests: $0.05 (Normal read/write volume).
- AWS CloudFront: $0.00 (Free tier covers expected usage).
- AWS SES email: $0.00 (Free 62k emails/month from Lightsail).
- AWS data transfer: $0.00 (Covered by Lightsail allowance).
 
**Estimated TOTAL approximately $43 USD.** This estimate DOES NOT INCLUDE domain name costs, and assumes moderate community activity. Costs scale gradually with usage. All services pay-as-you-go.

**Cost Optimization Strategies:**

**No Managed Database:** SQLite runs on same container instance as main application code.

**CloudFront Caching:** Aggressive caching reduces origin requests by 95%, minimizing compute costs and enabling smaller instance size.

**Image Processing:** Re-encoding at 85% quality with metadata stripping reduces storage by 50 to 70%. Smaller storage, lower bandwidth costs.

**No Monitoring Services:** AWS CloudWatch native tooling eliminates need for third-party monitoring subscriptions (DataDog, New Relic: $50 to 200/month avoided).

**Single Instance:** No load balancer, no auto-scaling group complexity. Single Lightsail instance with predictable flat-rate pricing.

**No Auto-Scaling Overhead:** Single instance avoids load balancer costs, auto-scaling group complexity, and distributed coordination overhead. Acceptable trade-off: cannot automatically scale horizontally (but vertical scaling available if needed).

**Limited Commercial Tools:** CloudWatch-First Tooling Policy: Monitoring, alerting, and observability default to AWS CloudWatch-native tooling to minimize recurring overhead. Optional third-party tooling (e.g., error tracking/APM) may be adopted if it is budget-appropriate and materially reduces operational risk.

**Pay-As-You-Go:** All AWS services are consumption-based. Growing community increases costs proportionally but predictably. No fixed enterprise license fees.

This cost model remains sustainable even if community doubles or triples in size. At 3,000+ active members, may need to optimize (add selective indexes for specific high-frequency queries) or scale (8GB instance), but architectural changes not required.

**Cost Monitoring:** CloudWatch monitors actual memory usage continuously. If utilization stays consistently below 50%, could down-scale to 2GB in future. If regularly exceeds 80%, would up-scale to 8GB ($40/month). Current allocation based on load testing and conservative estimates for production launch.

AWS CloudWatch alarms notify administrators if:

- Monthly costs exceed $75 (150 percent of $50 projection), configurable.
- Any single service exceeds 2x expected cost.
- Unexpected AWS services appear (indicates misconfiguration).

---

# 5. Development and Production Parity

## 5.1 Why Perfect Parity Matters

A common problem in volunteer software projects is that code works on developer laptops but fails in production due to environmental differences. Debugging production issues requires production access. New volunteers spend days setting up environments before contributing.

This project achieves perfect environment parity: identical Docker containers, identical code, identical folder structures in development and production. All environmental differences are hidden behind an abstraction layer.

## 5.2 How Parity Works

**Storage Parity:** Same SQLite database file in development (local filesystem) and production (Lightsail local storage). Same schema (run same migration SQL files). Same db.ts module with prepared statements. S3 backup disabled in development via feature flag (ENABLE_S3_BACKUP=false). Perfect parity except backup mechanism. No AWS credentials required for local development (but hybrid mode is possible for integration testing).

Implementation switches based on environment. Production uses SQLite database file on Lightsail local storage with S3 backup. Development uses SQLite database file on local filesystem without S3 backup. Services call the same db.ts prepared-statement query objects (wrapped by services) whether running locally or in production and
receive the same domain data. Services do not depend on environment-specific infrastructure wiring beyond injected adapters/config.

External Service Stubs implement identical interfaces for dev or production services. Code calls email.send(message) whether running locally or in production. Infrastructure layer routes appropriately. Development and test environments use in-memory stubs (fake or mock implementations) for external services:

- AWS SES: Writes to in-memory queue instead of sending; tests inspect queued emails.
- Stripe: Returns mock successful payments; can simulate webhooks with fixture files.
- Parameter Store: Reads from local JSON file instead of AWS API.
- Logging and metrics: Development writes to local files instead of AWS CloudWatch.
- URL validation: Deterministic stub validates syntax and patterns without external network requests.
- AWS KMS (signing): Uses a local stub signer in default dev mode (same JWT algorithm and claims shape). Optional hybrid mode uses real KMS for end-to-end integration testing.

**Contract Testing Validates Parity:** Contract tests verify development stubs correctly implement production behavior. CI pipeline runs contract tests against stubs on every commit (fast feedback under 30 seconds).

**Hybrid Development Mode:** Developers can optionally integrate with real AWS services during local development by setting a non-production `AWS_PROFILE`. Default mode uses local stubs (fast, no AWS credentials needed). Optional hybrid mode connects to actual S3, SES, Parameter Store, or KMS for integration testing. This local developer-profile path is distinct from the production Lightsail runtime model, where deployed services use root-owned host AWS config/credential material to assume the documented runtime role.

---

# 6. Security

## 6.1 Authentication Design

**Password Hashing:** User passwords are hashed using argon2id with a per-user random salt. No server-side pepper is used. The threat model assumes strong hashing (argon2id) combined with AWS IAM restrictions, HTTPS encryption in transit, and limited blast radius (one compromised database does not compromise all passwords) provides appropriate security without operational complexity and key rotation risks of server-side peppers.

**Session Tokens (JWT) with Password Version Field:** After login, system issues JSON Web Token signed using AWS KMS asymmetric keys and stored as HttpOnly, Secure, SameSite=Lax cookie (24-hour expiration).

Token contains member ID, roles, and critically: passwordVersion. JWTs are signed via KMS (kms:Sign) with verification using cached public key (kms:GetPublicKey), not Parameter Store secrets. This architecture uses JWT-based sessions with per-request validation, where each authenticated request validates JWT signature cryptographically, then reads the member record from the SQLite database to verify passwordVersion matches (stateful lookup for immediate invalidation).

Email verification and password reset tokens use cryptographic randomness, are hashed before storage, and expire automatically (24 hours for email verification, one hour for password reset). Password reset requests are rate-limited to prevent enumeration attacks. JWT signing keys support rotation without forcing mass logout. Password changes immediately invalidate all existing sessions.

Challenge: JWTs cannot be revoked once issued. Solution: every member has passwordVersion field. When password changes, increment version. Token validation compares token version against current version in storage by reading member record on every request. Mismatch equals invalid token. This achieves immediate cross-device logout on password change without maintaining token blacklist.

Trade-off: every request reads member record to check version. For community scale, this single-file read is acceptable overhead for security benefit.

Login and password-reset endpoints use application-level rate limiting keyed by email/account identifier and ephemeral network signals (such as IP address) for abuse prevention, without storing IP-derived data in audit logs or member records. Thresholds, windows, and cooldown durations are Administrator-configurable (safe defaults are defined in User Stories).

## 6.2 Image Upload Strategy

Members (Tier 1+) can upload photos in JPEG or PNG format, with maximum 10MB file size and 4096×4096 pixel dimensions. Images are processed synchronously during upload, users wait 2-5 seconds while the system generates two optimized variants: a 300×300 pixel thumbnail and an 800-pixel-width display version, both saved as JPEG at 85% quality.

Processing eliminates malware through re-encoding that converts images to raw pixels and back, discarding everything except visual content. This approach removes the need for antivirus scanning infrastructure. All metadata (EXIF, GPS, camera information, ICC profiles) is stripped for privacy and security. Original uploaded files are discarded after processing, reducing storage requirements.

The platform does not host video files, members can embed videos from YouTube or Vimeo instead. Animated GIFs are not supported due to processing library limitations. Members can view and share processed images but cannot download original high-resolution versions.

Benefits Gained: Zero antivirus maintenance, Standardized image quality, Simple deployment, Photo data size reduction.

## 6.3 Additional Security Protections

**CSRF Protection:** The application uses SameSite=Lax cookies combined with strict HTTP verb discipline (no state change over GET) rather than synchronizer CSRF tokens. SameSite=Lax prevents cookies from being sent with cross-site POST requests while allowing them on same-site requests and top-level navigations.

**Content Security Policy:** The platform implements Content Security Policy headers restricting which sources can load scripts, styles, and resources. This prevents cross-site scripting attacks by rendering injected malicious code inert even if input validation were bypassed.

**Rate Limiting:** Upload operations enforce rate limits to prevent abuse. This protects against spam, denial of service attempts, and ensures fair resource usage across the community.

**Text Sanitization:** All user text inputs (captions, bios, names, descriptions, comments) undergo sanitization and validation to prevent injection attacks: HTML tags are stripped, Unicode is normalized to reduce homograph risks, control characters are removed, and length limits are enforced. Output encoding via the Handlebars template engine ensures user content is always rendered as data, never executed as code. CSV uploads (such as event results) are validated to detect and reject formula indicators. Together, input sanitization, safe templating, and CSV validation provide a defense in depth approach that prevents script and injection attacks while maintaining usability for legitimate international content and avoiding dependence on external libraries.

**Data Access Pattern:** All data access occurs through single database module (db.ts) exporting prepared SQL statements. Services call statements directly: queries.memberByEmail.get(email), queries.createMember.run(data). Parameter binding prevents SQL injection.

Uniqueness is enforced via database constraints and case-insensitive unique indexes on canonical, normalized identifiers such as email. Database views automatically filter member records in their deletion grace period.

## 6.4 Video Content 

The platform does not host user-uploaded video files. Instead, members submit YouTube or Vimeo links, the system validates those URLs, extracts the video IDs, and embeds sandboxed players. This approach avoids the storage and transcoding complexity of hosting video, reduces infrastructure costs, and takes advantage of the global delivery and playback features provided by YouTube and Vimeo.

Exception: The legacy videos that have been hosted on footbag.org for decades will be hosted on the new platform's archive. These have all been converted to mp4 format by the mirror program.

## 6.5 Privacy-First Design

**Minimal Data Collection:** Platform collects only essential information for functionality. No phone numbers, physical addresses, birth dates (unless age verification required). No payment card numbers (Stripe collects). City and country are required, phone is optional.

**No Tracking:** Zero tracking cookies, analytics scripts, session replay tools, or heatmaps. Only first-party authentication cookie. This eliminates tracking liability and respects user privacy maximally.

**Data Rights Implementation:** Members can view all stored data, edit profile information, download complete export as JSON, request account deletion (90-day grace period during which the account can be restored, followed by permanent PII purge), and restrict searchability/visibility through profile flags. Public member search shows display name with city and country by default, email is private unless the member opts in.

**Member Data Export and Deletion:** Members can export their data and request account deletion. Member-requested account deletions enter a 90-day grace period during which the member can restore the account by logging in. After the grace period, PII is permanently purged and the anonymized member row is retained for referential integrity. Photo deletion is immediate and permanent when requested by members. Deleted data may persist in historical database backups until backup retention expiry (90 days). This operational reality is documented in the privacy policy to provide accurate expectations about data removal timelines.

**External URL Support:** Members can publish up to 3 external web page URLs with custom labels (example: "Personal Site", "Instagram", "YouTube Channel") in their profiles. Events, clubs, and galleries can each publish one optional external web page URL. All URLs validated before publication using strict syntax checks (https-only, max length, no credentials, no localhost/private/reserved targets), plus Google Safe Browsing API malware check (free tier). All URLs display with rel="nofollow" attribute for SEO. Failed validation shows clear error message with retry option. The system does **not** fetch user-provided URLs server-side.

**Data Retention Policy:** Active member data: indefinite until deletion requested.

- Deleted member personal data: 90-day grace period (configurable), then PII permanently purged from primary storage; anonymized row retained for referential integrity. Deleted data may persist in historical backups until backup retention expiry, which is documented as an operational constraint.
- Financial/audit records: anonymized after 90-day member deletion grace period, transaction IDs retained 7 years for compliance.
- Audit logs retain actorMemberId and entity IDs only, for traceability, and do not store email addresses or hashed emails.
- Photos and video links: indefinite while member active; immediately and permanently deleted on member request.
- News items: immediately and permanently deleted on admin action; no grace period.
- Events: immediately and permanently deleted by organizer if no published results; permanently preserved if results have been published.

This policy supports GDPR privacy requirements while retaining required financial and audit records in anonymized form.

## 6.6 Audit Logging

**Immutable Append-Only Logs:** Every state-changing action appends an entry to an audit log database table. Immutability and privacy are enforced at the application and infrastructure level.

**What Gets Logged:** Authentication events, profile changes, club membership, event operations, photo and video actions, payment transactions, admin decisions, event-organizer/club-leader additions and acceptances, URL validation results, membership tier changes, price edits and price change events, Board add and remove, election creation, ballot tallying operations, results publication, cancellation, event sanction approvals and denials, administrator overrides and batch operations, announce-list sends, event results publication, login failures over threshold, price configuration reads and exports, email template edits, election settings edits after creation, organizer assignment or removal on events, ClubLeader set or unset, archive access policy changes, payment gateway keys and webhook URL changes, ballot encryption key rotations.

Administrators may edit member data (as permitted by rules) and all such actions must have a reason, and will be audit-logged, the point being that the admin can manually apply BAP and HoF flags, fix Tier status or other data problems. Note that this includes the case where a member dies; we will add a special flag for deceased, and the admin can set this.

Each log entry includes: timestamp (ISO-8601 UTC), event type, actor ID, resource affected, action details, result, request correlation ID. Audit logs are privacy-safe, so they do not store IP addresses or network identifiers.

This design creates complete accountability trail. Disputes resolved definitively. Security incidents enable forensic investigation. Transparent governance through verifiable history.

## 6.7 Data Encryption

AWS S3 default (SSE-S3) encrypts all data backup snapshots at rest. The local SQLite database file on Lightsail is stored unencrypted on the instance volume, which is an acceptable trade-off given that backups are encrypted, instance access is restricted via IAM, and the data is not financial or regulated.

Ballot encryption uses AWS KMS envelope encryption with per-ballot data keys; store ciphertext plus encrypted data keys. Ballots are encrypted server-side before storage, providing strong cryptographic privacy protections independent of S3 encryption. This ensures ballot secrecy: even with S3 access, ballots remain encrypted without Parameter Store key access. Double-layer encryption (application-level ballot encryption plus S3-level storage encryption) provides defense in depth but absolute secrecy is not claimed under privileged-role compromise scenarios.

This approach is appropriate for the platform's threat model: Community membership data is not regulated (not HIPAA, not PCI, not financial records). Encryption at rest protects against physical disk theft and some insider threats. AWS handles key management, rotation, and security.

Customer-managed keys via AWS KMS were considered but rejected. Benefits (more control over key rotation, ability to disable keys) do not justify costs (complexity of key management, rotation procedures, additional failure modes, AWS KMS API costs). SSE-S3 with S3-managed keys provides appropriate security for this use case.

## 6.8 Threat Model

**Primary Threats Mitigated:**

- Account takeover via credential theft: argon2id password hashing + HttpOnly JWT.
- CSRF attacks: SameSite=Lax cookies + strict HTTP verb discipline.
- Malicious file uploads: Isolated image processor + format validation.
- Ballot tampering: AES-256-GCM encryption + audit logging.
- SQL injection: Mitigated by prepared statements with parameter binding.

**Accepted Risks:**

- Tier 0 members gain limited free access (acceptable for community building).
- Single compute instance (mitigated by CloudFront error pages and rapid recovery procedures).
- DDoS/abuse mitigation is layered but intentionally lightweight: AWS WAF at CloudFront plus application-level rate limiting; no complex multi-region active-active mitigation architecture.

**Secrets Management:**

Sensitive credentials (Stripe API keys, webhook secrets) are stored in AWS Parameter Store SecureString. Cryptographic operations requiring non-exportable key custody use AWS KMS instead (JWT signing, ballot encryption). Parameter Store does not protect against attacker shell access inside production containers or host paths that expose runtime credential/config material, so operations requiring non-exportable keys use KMS/HSM-backed asymmetric signing keys with IAM separation.

---

# 7. DevOps

## 7.1 Backup Strategy

The system backs up the SQLite database file every 5 minutes by creating a consistent snapshot and uploading it to an S3 backup bucket. These frequent snapshots provide the primary short-RPO recovery path. Cross-region disaster recovery for database backups is handled by a separate sync process (nightly, per current design decisions), not by continuous replication of the SQLite database file. Backups proceed only after a successful checkpoint to ensure consistency.

Photos are backed up via Amazon S3 cross-region replication separate from database backups. Primary bucket replicates continuously to backup bucket in different region using cost-optimized storage class. RPO less than 15 minutes. No manual backup jobs required.

**Monitoring and Alerts:** If backups fail 3 times in a row, administrators receive a CRITICAL alert. The system health page shows when the last successful backup completed. CloudWatch monitoring triggers alarms if backups become more than 15 minutes old, ensuring backup issues are detected immediately.

**Safe Application Restarts:** When the application needs to restart (for updates or maintenance), it follows a graceful shutdown process to prevent any data loss: stop accepting new web requests, wait for active operations to finish (up to 30 seconds), save all pending database changes, close the database cleanly, perform one final backup upload, then shut down. This ensures deployments never lose data.

**Backup Protection and Retention:** Backup files are protected using AWS S3 Object Lock, which prevents anyone (including administrators) from accidentally or maliciously deleting or modifying retained backup objects. Retention windows are configurable: the primary S3 bucket uses a 30-day snapshot version-history window for point-in-time recovery (configurable via `primary_snapshot_version_days`); the cross-region backup bucket uses a 90-day Object Lock retention for disaster-recovery backup objects. Audit logs are retained for 7 years. Normative defaults for all configurable retention windows are defined in the User Stories Configurable Parameters section. After one year, old audit logs automatically move to cheaper long-term storage (Glacier Deep Archive) to reduce costs.

**Recovery Point Objectives (RPO)** include two recovery scenarios:

**Primary Recovery (most common):** Restore from primary S3 bucket using versioned snapshots uploaded every 5 minutes. RPO is 5 to 10 minutes maximum for all data. Use this for: database corruption, accidental deletion, application bugs.

**Disaster Recovery (rare):** Restore from cross-region backup bucket synced nightly. RPO = 24 hours for database backups (per nightly sync), while photos use S3 cross-region replication with 15 minute RPO. Use this for: complete AWS region failure, S3 bucket deletion, catastrophic infrastructure loss.

**Recovery Time Objective (RTO):** Depends on failure scope: routine application/database recovery targets minutes-scale restoration (about 5 minutes for database file restore once operators begin recovery), whereas full regional disaster recovery is hours-scale (2-4 hours).

The AWS free tier does not provide viable continuous database backup at the required RPO. The selected 5-minute backup interval provides acceptable RPO (5-10 minutes) at minimal cost (approximately $1/month using S3 Intelligent-Tiering for automated cost optimization). This approach balances data protection requirements with budget constraints.

## 7.2 High Availability

**Single-Instance Architecture:** Production runs on one Lightsail instance fronted by CloudFront CDN. This design prioritizes simplicity and volunteer maintainability over maximum uptime. AWS Lightsail provides 99.99% uptime SLA (approximately 52 minutes downtime per year). For a volunteer-maintained community platform, the trade-off between operational complexity and availability favors simplicity.

**Failure Modes:** The platform has two operational states:

- Normal Operation: All features available. Origin serves requests successfully (HTTP 2xx/3xx responses). Users interact with site normally.
- Maintenance Mode: Origin unavailable or returning server errors (5xx). CloudFront automatically serves the maintenance page from the S3 error bucket for GET/HEAD requests. State-changing requests (POST/PUT/DELETE) may instead fail with connection errors/timeouts until the origin recovers.

CloudFront exit from maintenance is automatic. When Lightsail origin returns to health, CloudFront resumes normal operation within 10 seconds (error page cache TTL). Restoring the origin typically requires admin intervention (restart/rollback/restore).

**CloudFront Error Page Configuration:** When the Lightsail origin returns server errors (500, 502, 503, 504) or is unreachable, CloudFront automatically displays a custom maintenance page stored in S3 for GET/HEAD requests. Error page cached for 10 seconds, ensuring users see restored service quickly after recovery. Connection timeout set to 10 seconds with 3 retry attempts, so browsing requests typically see the maintenance page within ~30 seconds of origin failure (state-changing requests may instead fail with connection errors/timeouts).

**Recovery:** CloudFront exit from maintenance is automatic. When the origin returns to health, CloudFront resumes normal operation within 10 seconds (error page cache TTL). Origin recovery may require admin intervention (restart/rollback/restore); this procedure will be defined in a DevOps runbook.

**Monitoring and Alerting:** CloudWatch monitors origin error rates, application health, and resource utilization. Alarms trigger within 2 minutes of failures, notifying administrators via email and SMS. Documented recovery procedures enable rapid restoration (typically 15-30 minutes for application issues, up to 2 hours for complete infrastructure restore).

**Regional Outage Handling:** In the extremely unlikely event of extended AWS regional outage, recovery process: restore from cross-region backup bucket (us-east-1) to new Lightsail instance in any available region using documented procedures (2-4 hours). No pre-planned regional failover maintained---probability too low to justify ongoing complexity.

This approach provides high availability appropriate to community scale: reliable infrastructure, rapid recovery, transparent failure modes. NOT achieved through redundant compute instances, multi-region failover, or 24/7 operations.

## 7.3 Operational Documentation

Refer to the DevOps document for more details. This will serve as the authoritative guide for all build, release, operate, and recover procedures, with detailed specifications for:

- Environment model and lifecycle (Dev, Test/Staging, Production).
- Configuration management and secrets handling.
- CI/CD pipeline implementation.
- Container orchestration and resource management.
- CloudFront behavior matrices and caching strategies.
- Monitoring dashboards and alerting thresholds (CloudWatch-first, with optional tooling guidance).
- Health endpoints (/health/live and /health/ready) and how they are used in deployment/health checks.
- Backup validation and disaster recovery drills.
- Staging data refresh procedures and anonymization policy.
- Promotion flows and deployment checklists.

## 7.4 Infrastructure as Code

All AWS infrastructure for the platform is defined as code using Terraform configuration files, version-controlled in the repository under /terraform directory. This approach provides several critical benefits:

**Reproducible AWS environments:** The staging and production AWS environments can be recreated from reviewed Terraform configuration after the one-time bootstrap handoff. Local developer environments are reproduced through the repository’s Docker/SQLite/bootstrap scripts rather than through Terraform.

**Infrastructure review in pull requests:** Changes to infrastructure go through code review process. Team members can see exactly what will change before applying updates.

**Disaster recovery:** If AWS resources are accidentally deleted or an entire AWS account is compromised, infrastructure can be rebuilt from version-controlled Terraform files.

**Documentation through code:** The Terraform files serve as authoritative documentation of what infrastructure exists and how it's configured. No documentation drift.

**Eliminates tribal knowledge:** New volunteers can understand infrastructure by reading Terraform configuration rather than relying on institutional knowledge from long-time administrators.

**Managed Infrastructure Components:**

- Lightsail instance configuration (size, OS image, networking, static IP).
- S3 buckets with complete configuration (versioning, lifecycle policies, CORS rules, public access blocks, backup bucket for SQLite snapshots).
- CloudFront distributions (origins, cache behaviors, TLS certificates, custom domain).
- IAM roles and policies for human operators, Systems Manager managed-node registration/service-role resources, and application runtime assumed roles, plus the documented runtime credential mechanism for deployed hosts and operators.
- Parameter Store structure (paths, types, encryption configuration).
- CloudWatch log groups and metric alarms.
- Route53 DNS records.
- Budget alerts and cost allocation tags.

**Secrets Management:** Terraform creates AWS Parameter Store parameter structures (paths, encryption configuration) but does not store secret values in version control. Secret values (Stripe API keys, Stripe webhook secrets, and other non-KMS credentials) are set manually via AWS CLI after Terraform creates the infrastructure. JWT signing keys and ballot encryption keys use AWS KMS and are not stored in Parameter Store; their key material remains non-exportable within KMS. KMS keys for JWT signing and ballot encryption are provisioned via Terraform, but key material remains non-exportable within AWS KMS. This separates infrastructure definition (version-controlled) from secret data (not version-controlled).

**Operational Discipline:** Manual AWS console changes are prohibited except for emergency troubleshooting. Any permanent changes must be made via Terraform. This discipline ensures Terraform state remains accurate. If manual changes are made, they create drift between Terraform state and actual infrastructure, leading to confusing errors on next terraform apply. For emergency fixes, document the manual change and create a Terraform PR immediately after to bring configuration back in sync.

Terraform Cloud free tier provides remote state storage with locking, preventing concurrent applies that could corrupt state. Team members authenticate via GitHub OAuth.

## 7.5 Testing

Automated testing ensures reliability while enabling rapid volunteer development with fast feedback loops.

**Unit Tests:** Validate business logic in services and utilities. Test individual functions and methods in isolation.

**Integration Tests:** Verify HTTP endpoints work end-to-end. Test complete request/response cycles through controllers and services.

**Contract Tests:** Ensure adapter stubs match production service behavior. Validate that development stubs correctly implement production API contracts.

## 7.6 Continuous Integration

Every code commit triggers automated GitHub Actions workflow. Runs all tests (unit, integration, contract), performs security scanning, validates TypeScript types, checks code style, builds Docker images, publishes to container registry. Tests must pass before code can merge to main branch.

Contract tests run against local stubs in CI (fast feedback, approximately 30 seconds total). Same contract tests run against real AWS services in pre-release validation (confirms production behavior matches stub expectations).

This approach enables rapid local development (no AWS credentials needed) with high confidence in production deployment (real services validated before release).

---

# 8. Legacy Archive

A custom Python-based crawler was developed to capture the complete Footbag.org website before decommissioning. This mirror program:

- Systematically crawled all accessible pages starting from the homepage.
- Downloaded HTML pages, images, videos, stylesheets, documents.
- All images converted to JPG, all videos to MP4.
- Preserved complete directory structure and file organization, modified only to eliminate the database and javascript used in the legacy system.
- Maintained relative links between pages so navigation works.
- Generated pure HTML output with no JavaScript or database dependencies.
- There is no search feature in the archive.
- Note: this backup contains some member's details such as contact info, and so therefore access is limited to logged-in members only.

**Migration Limitations:**

- The mirror could not access all members, only members with public presence (club members, event participants with results, published media galleries).
- The mirror cannot fetch members' login credentials.
- Full member migration will be completed via a separate Footbag.org data export, technical specifics are out of scope for this document.
- Other data such as historical event results will be migrated from the legacy site to the new site via data clean-up and migration scripts (out of scope for now).
- After the data migration from old members to the new site, all such members must complete a password-reset onboarding process at the time of first login.

**Archive Hosting Architecture:**

- Archive stored in dedicated S3 bucket (separate from active platform data).
- CloudFront distribution serves archive at archive.footbag.org.
- Aggressive caching (1-year TTL) since content never changes.
- Minimal ongoing costs.
- Authentication reuses the main site's member session across the .footbag.org domain and is enforced at CloudFront edge for archive access. Exact cookie naming and JWT validation implementation details are specified in the Design Decisions document.

**URL Redirects:**

- Legacy Footbag.org URLs automatically redirect to archive equivalents at archive.footbag.org via 301 Permanent Redirect.
- footbagworldwide.net redirects to footbag.org.
- Redirect mapping stored in simple text file, easy to maintain.
- 301 status tells search engines content moved permanently.

**Access and Governance:**

- Archive accessible to members only, not public (read-only, authentication required).
- No modifications possible (immutable preservation).
- Some historical content will be migrated to the new live site for public access, unifying old and new content where appropriate. This will include historical event results, for example.
- Archive pages are protected from public indexing via robots and noindex.
- Initial mirror capture is one-time for launch, no future refresh possible once we switch over to new site.

This approach ensures permanent preservation of community history, protecting member privacy from the public Internet, with minimal ongoing maintenance or cost.

Legacy data contains private member information not suitable for public viewing. Archive access requires member login. Maintains historical record without migration complexity or data model contamination. Members log in to new platform, then access archive through authenticated link.

---

# 9. Volunteer Development

**Volunteer-Driven Schedule:** Development proceeds on volunteer availability (estimated hundreds of hours). Project structured for parallel work by multiple contributors through clear module boundaries and comprehensive documentation.

**Standard Technology Stack:** Docker, Node.js, TypeScript, Express, Handlebars, AWS, Stripe; widely adopted technologies familiar to millions of developers. Extensive documentation and community support available. No exotic frameworks or custom tools. The platform code and documentation will be open source and version controlled, hosted on Git at https://github.com/davidleberknight/footbag-platform

**Clear Solution Architecture:** Uses standard design patterns with obvious separation of concerns. Presentation layer handles front-end layout and user interactivity in the browser, controllers handle HTTP communications with the back end code, services contain business logic and authorization rules, all data operations use prepared SQL statements in a thin database-access layer, all external services accessed through suitable abstract interfaces that allow local development and testing mock services.

**Fast Feedback Loops:** One-command local setup. Live reload of a browser page shows changes immediately. Contract tests verify behavior. Integration tests validate full flows. Data generated via scripts based on legacy footbag.org data creates testing datasets. Best practice DevOps standardized for industry standard CI/CD pipeline.

---

**END OF Project Summary DOCUMENT**