# Footbag Website Modernization Project -- Glossary

**Glossary of Technical Terms:** Definitions of technical jargon, acronyms, and specialized terminology used throughout the project documentation. Each entry provides a concise, plain-language explanation to help volunteers understand system concepts without requiring deep technical expertise.

**GLOSSARY:**

**ACID Transactions:** Database guarantee that operations are Atomic (all-or-nothing), Consistent (database rules always satisfied), Isolated (concurrent transactions don't interfere), and Durable (committed data survives failures). Footbag.org uses SQLite's ACID guarantees to replace the optimistic locking previously required by JSON-on-S3 file updates, simplifying write safety for operations like registration creation and tier changes.

**Adapter Pattern**: Design pattern abstracting external dependencies behind interfaces. Footbag.org uses adapters to isolate infrastructure concerns per DD §1.9: `PhotoStorageAdapter` (future S3 in production; `LocalPhotoStorageAdapter` in dev and current production-stub until S3 IAM is wired), `SesAdapter` (`LiveSesAdapter` sends via AWS SES in production; `StubSesAdapter` captures messages in memory for dev/test), PaymentAdapter (Stripe), `JwtSigningAdapter` (`KmsJwtAdapter` uses AWS KMS Sign/GetPublicKey in production; `LocalJwtAdapter` uses a file-based RSA keypair in dev/test), SecretsAdapter (Parameter Store in production; deferred — local dev reads from env vars via `src/config/env.ts` per DD §1.11). Enables testing without external services and dev/prod parity by configuration swap.

**AES-256-GCM**: Authenticated encryption algorithm providing both confidentiality and integrity through authentication tags. Used for voting ballot encryption with server-side envelope encryption: member submits vote over HTTPS, server requests a fresh data key from AWS KMS (GenerateDataKey), encrypts the ballot payload using AES-256-GCM, and stores only the ciphertext alongside the encrypted data key. The plaintext data key is never persisted. Admin tallying decrypts ballots using a separate privileged role after polls close.

**API (Application Programming Interface)**: A standardized way for different software systems to communicate with each other. Footbag.org uses APIs for internal module boundaries and selected integrations; the project does not have a public REST API.

**Argon2id**: Password hashing algorithm (preferred over bcrypt) that is memory-hard, requiring 64 MB memory with 3 iterations and parallelism factor of 4. Makes brute-force attacks computationally expensive while maintaining acceptable login performance (100-250ms).

**Audit Log**: An immutable, chronological record of all significant events and actions in the system. Footbag.org logs authentication, profile changes, admin actions, payment transactions, content moderation decisions, and all ballot decryption operations. Logs retained 7 years with IAM-restricted access. Audit entries record actor identity via authenticated member ID; IP addresses are intentionally excluded.

**AWS (Amazon Web Services)**: Cloud computing platform providing infrastructure services including S3 storage, CloudFront CDN, Lightsail hosting, SES email, Parameter Store, KMS, and CloudTrail.

**better-sqlite3**: Synchronous Node.js library for SQLite providing a simple, high-performance API. Footbag.org uses better-sqlite3 as its only database dependency; it auto-resets prepared statements after execution, supports typed results, and enforces synchronous-only transactions, which aligns with the platform's constraint that transactions cannot span async operations.

**CDN (Content Delivery Network)**: A geographically distributed network of servers that cache and deliver content from locations close to users. CloudFront serves Footbag.org content worldwide, reducing latency and offloading traffic from the origin server.

**CLI (Command Line Interface)**: Text-based interface for interacting with software through typed commands. Developers and administrators use CLI tools to manage Footbag.org infrastructure, run deployments, and execute maintenance tasks.

**CloudFront**: Amazon's content delivery network that serves Footbag.org from 400+ edge locations worldwide. CloudFront edge-caches static assets (CSS, JS, images, fonts) and user-uploaded media; HTML responses are routed to the Lightsail origin for rendering and not cached at the edge.

**CloudTrail**: AWS logging service that records all API calls to AWS services for security analysis and compliance. Footbag.org enables CloudTrail for Parameter Store access (tracking who retrieved voting encryption keys and when) and for backup/audit bucket operations.

**CloudWatch Logs**: AWS log aggregation service collecting structured application logs from Docker containers. Provides search, filtering, and alerting capabilities. Footbag.org retains application logs 30 days, audit logs 7 years.

**CMK (Customer Master Key)**: AWS KMS term for a named encryption key managed in the KMS service, backed by hardware security modules. Footbag.org uses one CMK per environment for ballot envelope encryption (kms:GenerateDataKey for encryption, kms:Decrypt in tally role only) and a separate CMK for JWT asymmetric signing (kms:Sign, kms:GetPublicKey).

**Content-Hash Filename**: Static asset filename that includes a hash of the file's content (e.g., app.a3f8b2c.js), making each version unique and immutable. Footbag.org's build pipeline generates content-hash filenames for CSS, JavaScript, and image assets, enabling CloudFront to cache them for one year without staleness concerns; the hash changes automatically whenever content changes.

**Controller**: Application layer component handling HTTP requests and responses. Footbag.org controllers receive requests from Express routes, validate inputs, invoke service layer methods, and format responses as JSON or HTML. Controllers contain no business logic—only request/response orchestration.

**Correlation ID**: Unique identifier attached to every incoming request and included in all log entries produced while handling that request. Footbag.org uses correlation IDs to trace a single user action across controllers, services, adapters, and background workers in CloudWatch Logs, making debugging significantly faster.

**Cross-Site Scripting (XSS)**: Security vulnerability where malicious scripts are injected into web pages and executed in users' browsers, potentially stealing credentials or performing unauthorized actions. Footbag.org prevents XSS through input sanitization, output encoding, and Handlebars automatic HTML escaping.

**CRUD (Create, Read, Update, Delete)**: Four basic operations for persistent storage. In Footbag.org, these operations are implemented primarily in service-layer business logic over the SQLite data model, with HTTP route shape determined by the documented UI and workflow contracts rather than by a blanket REST mapping rule.

**CSRF (Cross-Site Request Forgery)**: Security attack where unauthorized commands are transmitted from a user the web application trusts. Footbag.org prevents CSRF through SameSite=Lax cookie attribute combined with proper HTTP verb semantics: GET requests are strictly read-only, all state-changing operations use POST, and JSON-only endpoints validate Content-Type: application/json. No synchronizer tokens are required. State-changing requests also enforce an Origin/Referer allowlist against the canonical origin.

**CSS (Cascading Style Sheets)**: Language for describing visual presentation of HTML documents including colors, layout, fonts, and responsive design. Footbag.org uses CSS to style all web pages with mobile-first responsive design.

**CSV Injection**: Security vulnerability where formulas in CSV files (cells beginning with =, +, -, @) execute when opened in spreadsheet applications, potentially running malicious commands or exfiltrating data. Footbag.org prevents this by scanning event results CSVs for formula indicators and rejecting suspicious uploads.

**Cursor-Based Pagination**: Pagination technique using opaque tokens that encode the last item's sort key (e.g., base64 of {lastCreatedAt, lastId}). More consistent than offset-based pagination when underlying data changes between requests.

**Dead Letter**: Final status for an outbox email entry that has exhausted all retry attempts without successful delivery. Footbag.org moves failed outbox entries to dead-letter status after maximum retries, triggering an alert for admin review so no email is silently lost.

**DKIM (DomainKeys Identified Mail)**: Email authentication method verifying sender identity using cryptographic signatures. Footbag.org configures DKIM through AWS SES to improve email deliverability and prevent spoofing.

**DMARC (Domain-based Message Authentication, Reporting and Conformance)**: Email authentication policy framework building on SPF and DKIM. Footbag.org publishes DMARC policies instructing receiving servers to reject unauthenticated emails claiming to be from footbag.org.

**DNS (Domain Name System)**: Internet system translating human-readable domain names (footbag.org) into IP addresses computers use to locate servers. Footbag.org uses AWS Route 53 for DNS management with health checks and automatic failover.

**Docker**: Containerization platform that packages applications with their dependencies into isolated units that run consistently across different environments. Footbag.org uses Docker for local development, CI/CD builds, and production deployment.

**Docker Compose**: Tool for defining and running multi-container Docker applications using YAML configuration files. Footbag.org developers use docker compose up to start local development environment with web app, workers, and stub services.

**Edge Server**: A server in a Content Delivery Network located geographically close to users. CloudFront edge servers cache Footbag.org content in 400+ locations worldwide, reducing latency from 500ms (cross-continental) to under 100ms (local edge).

**Eligibility Snapshot**: Frozen list of voter member IDs captured when election opens, preventing manipulation by retroactively adjusting membership dates or tiers. Only members eligible at snapshot time can vote, even if their status changes during voting period.

**Encryption**: Converting data into secret code that only authorized parties can read. Footbag.org uses encryption for HTTPS connections (TLS), ballot storage (AES-256-GCM), and sensitive configuration values (AWS Parameter Store SecureString).

**Enumeration Protection**: Security pattern preventing account discovery attacks where attackers systematically test email addresses to find valid accounts. Footbag.org returns identical responses whether email exists or not during password reset, thwarting enumeration attempts.

**Envelope Encryption**: Cryptographic pattern where data is encrypted with a short-lived data key, and the data key itself is encrypted by a master key (KMS CMK) and stored alongside the ciphertext. Footbag.org uses envelope encryption for ballots: a fresh AES-256-GCM data key is generated per ballot via KMS GenerateDataKey, used immediately, and stored only in encrypted form (CiphertextBlob), so the plaintext data key never persists.

**EXIF (Exchangeable Image File Format)**: Metadata embedded in photos including camera settings, GPS coordinates, timestamps, and camera model. Footbag.org strips all EXIF data during image processing to protect member privacy and reduce file sizes.

**Express**: Minimal Node.js web framework providing straightforward HTTP routing, middleware support, and request/response handling. Footbag.org uses Express for thin controllers and server-rendered page routes, along with selected machine-readable operational endpoints where explicitly documented.

**Freeform Hashtag**: User-chosen hashtag without enforced format or validation beyond security checks. Members create organic vocabulary for content discovery, complementing standardized event/club hashtags. Clicking any hashtag shows all content with that tag.

**GDPR (General Data Protection Regulation)**: European Union privacy law granting individuals control over personal data including rights to access, correct, export, and delete data. Footbag.org implements 90-day soft delete grace period before permanent data removal to comply with GDPR deletion requests.

**Git**: Distributed version control system tracking code changes over time. Developers use Git to collaborate, maintain history, and coordinate work. Footbag.org code lives in GitHub repository with branching strategy supporting parallel development.

**GitHub Actions**: CI/CD automation platform integrated with GitHub repositories. Footbag.org uses GitHub Actions to automatically build, test, and publish Docker images on commits to main branch, eliminating manual deployment steps.

**GHCR (GitHub Container Registry)**: GitHub's built-in Docker image registry. Footbag.org CI pipelines publish Docker images to GHCR on every merge to main; deployment runbooks pull tagged images from GHCR to the Lightsail instance for staging and production rollouts.

**Grace Period**: Time window after soft delete where data remains recoverable before permanent removal. Footbag.org uses 90-day grace period for deleted member accounts and 30 days for deleted photos/videos, allowing accidental deletion recovery.

**Handlebars**: A simple templating system that generates HTML pages from templates plus data. Footbag.org controllers pass view models to Handlebars templates for server-side HTML rendering, keeping presentation logic separate from business logic.

**Hashtag**: An organizational tag beginning with # symbol used to categorize and discover content. Footbag.org uses standardized hashtags for events/clubs (enforced uniqueness) and freeform hashtags for member-driven content organization.

**Health Endpoint**: Lightweight HTTP endpoints reporting system status. Footbag.org exposes two endpoints: /health/live (liveness — confirms the process is running, no external calls) and /health/ready (readiness — validates database connectivity and last successful backup timestamp before accepting traffic). Used by deployment automation and CloudWatch monitoring.

**HMAC (Hash-based Message Authentication Code)**: Cryptographic technique ensuring message integrity and authenticity using secret key plus hash function. Footbag.org validates Stripe webhook signatures using HMAC-SHA256 to verify requests actually originated from Stripe.

**Homograph Protection**: Security measures preventing visually similar characters from different Unicode scripts (Cyrillic А vs Latin A) creating confusingly similar hashtags. Footbag.org normalizes Unicode to NFC form before storage, eliminating homograph attacks.

**HSTS (HTTP Strict Transport Security)**: Security header instructing browsers to only connect via HTTPS, never HTTP. Footbag.org enables HSTS with long max-age preventing protocol downgrade attacks even if users type http:// in address bar.

**HTML (HyperText Markup Language)**: Standard language for creating web pages, defining structure and content using tags like headers, paragraphs, links, and forms. Footbag.org generates HTML server-side using Handlebars templates.

**HTTP (HyperText Transfer Protocol)**: Protocol defining how web browsers and servers communicate and exchange data. Footbag.org uses HTTP for server-rendered page requests, form submissions, and selected machine-readable endpoints, with route semantics defined by the project’s documented contracts.

**HttpOnly Cookie**: Browser cookie attribute preventing JavaScript from accessing the cookie value, protecting it from XSS attacks. Footbag.org JWT session cookies are always set HttpOnly so client-side scripts cannot read or exfiltrate the token; the browser sends the cookie automatically on requests but the application's JavaScript never touches it.

**HTTPS**: Secure version of HTTP using TLS encryption to protect data in transit. All Footbag.org communication uses HTTPS enforced via CloudFront and nginx, preventing eavesdropping and tampering.

**IAM (Identity and Access Management)**: AWS service controlling who can access which AWS resources. Footbag.org uses IAM roles granting Lightsail instance permission to read S3 and Parameter Store without exposing static credentials in code.

**Idempotency Marker**: Unique client-generated token ensuring duplicate requests don't create duplicate side effects. Footbag.org uses idempotency keys for payment operations; if browser retries after network failure, second charge won't occur.

**Infrastructure as Code (IaC)**: Practice of defining cloud infrastructure in version-controlled configuration files rather than through manual console actions. Footbag.org uses Terraform under /terraform to manage Lightsail, S3, CloudFront, IAM, Route 53, Parameter Store, CloudWatch, and SNS resources; manual AWS console changes are prohibited except during emergency incident response and must be codified immediately afterward.

**ISO 8601**: International standard for date/time representation (YYYY-MM-DDTHH:MM:SSZ). Footbag.org stores all timestamps in ISO 8601 UTC format for timezone-independent sorting and filtering. Example: 2025-01-15T14:30:00Z represents January 15, 2025 at 2:30 PM UTC.

**JavaScript**: Programming language running in web browsers enabling interactive features. Footbag.org requires JavaScript for interactive features including client-side form validation; users with JavaScript disabled see a noscript message requesting enablement. TypeScript (which compiles to JavaScript) is used for all client-side code.

**JSON (JavaScript Object Notation)**: Lightweight text format for structured data using keys and values. Footbag.org uses JSON as the data interchange format for API responses, webhook payloads, and local development configuration files.

**JWT (JSON Web Token)**: Compact, URL-safe means of representing claims between parties using JSON and cryptographic signatures. Footbag.org uses JWTs in secure cookies for stateless authentication, including member ID, roles, and passwordVersion for immediate cross-device logout on password change.

**kid (Key ID)**: JWT header field identifying which signing key was used to create a token. Footbag.org includes kid in every JWT header referencing the active AWS KMS asymmetric key; during key rotation, the verification middleware uses kid to select the correct cached public key, allowing old and new keys to coexist for 24 hours without forcing mass logout.

**KMS (Key Management Service)**: AWS service managing cryptographic keys using hardware security modules (HSMs) with full audit trails. Footbag.org uses KMS for two purposes: JWT signing uses an asymmetric RSA or ECDSA key pair (kms:Sign at login, kms:GetPublicKey cached at startup for fast in-process verification); ballot encryption uses envelope encryption where kms:GenerateDataKey produces a fresh per-ballot AES-256-GCM data key that is used immediately and never stored in plaintext, with the encrypted data key (CiphertextBlob) stored alongside the ballot ciphertext. The web runtime role has kms:Sign and kms:GenerateDataKey permissions but not kms:Decrypt, so even a compromised container cannot decrypt stored ballots. In code, JWT signing is accessed through the `JwtSigningAdapter` interface (DD §1.9); production uses `KmsJwtAdapter`, dev/test uses `LocalJwtAdapter`.

**Lambda@Edge**: AWS service allowing small JavaScript functions to run inside CloudFront edge locations, executing on each request before it reaches the origin. Footbag.org uses a Lambda@Edge viewer-request function on the archive.footbag.org distribution to validate the JWT session cookie, redirecting unauthenticated users to the main site login page without the request ever reaching S3.

**Lightsail**: AWS managed virtual private server service providing compute, storage, and networking in simple monthly pricing. Footbag.org runs on single Lightsail 4GB instance ($20/month) hosting proxy, web app, and worker containers. Simpler and cheaper than EC2 for single-server deployments.

**Magic Byte Verification**: Security check that reads the first bytes of an uploaded file and confirms they match the known binary signature (magic bytes) for the declared file type (e.g., JPEG starts with FF D8 FF). Footbag.org rejects uploads whose magic bytes don't match their declared MIME type, preventing disguised executables from being processed by the Sharp image library.

**Middleware**: Express function executing during request/response cycle before reaching route handlers. Footbag.org uses middleware for authentication (JWT validation), logging (request/response tracking), error handling (consistent error responses), and request parsing (JSON body parsing).

**Nginx**: High-performance web server and reverse proxy. Footbag.org uses nginx container for TLS termination, static asset serving, rate limiting, and routing requests to Express application containers.

**Node.js:** JavaScript runtime built on Chrome's V8 engine enabling server-side JavaScript execution. Footbag.org uses Node.js LTS (Long Term Support) version as the application runtime for both web server and background workers. Single language (TypeScript/JavaScript) across frontend and backend.

**OOM (Out of Memory)**: Condition where a process attempts to allocate more memory than its limit allows. Docker kills a container that exceeds its mem_limit with an OOM error; Footbag.org configures restart policies so killed containers restart automatically and CloudWatch alerts fire when container memory usage approaches 80—90% to provide advance warning.

**Outbox Pattern**: Reliability pattern ensuring email delivery despite transient failures. Footbag.org inserts outbox records into the SQLite database within the same transaction as the business operation that triggers the email, guaranteeing that if the transaction commits the email is queued and if it rolls back neither the event nor the email record exists. A background worker scans for pending entries every 5 minutes, sends via SES with retries and exponential backoff, and moves entries to dead-letter status after maximum retries for admin review.

**Parameter Store**: AWS Systems Manager service storing configuration values and secrets with encryption and access control. Footbag.org stores Stripe API keys, Stripe webhook secrets, and other operational credentials in Parameter Store SecureString parameters. JWT signing and ballot encryption keys are managed exclusively in AWS KMS (non-exportable) and are never stored in Parameter Store.

**Payment Intent**: Stripe object tracking a single payment's lifecycle from creation through confirmation to settlement. Footbag.org creates payment intents for event registrations and membership upgrades, storing intent IDs in the database for reconciliation. All payment state transitions are keyed by Stripe's payment_intent_id to ensure idempotent handling regardless of webhook retry count.

**PCI DSS (Payment Card Industry Data Security Standard)**: Security standards governing credit card data handling. Footbag.org achieves PCI compliance by never touching card data; Stripe Checkout handles collection and processing entirely, card numbers never reach Footbag.org servers.

**PRAGMA**: SQLite configuration directive executed as a SQL statement to control database behavior. Footbag.org applies five startup PRAGMAs: journal_mode=WAL (concurrent reads during writes), foreign_keys=ON (referential integrity), busy_timeout=5000 (5-second lock wait), synchronous=NORMAL (safe faster writes), and cache_size=-64000 (64MB read cache). Operational PRAGMAs like wal_checkpoint are executed at runtime separately.

**Prepared Statement**: SQL query compiled into executable bytecode once at application startup and reused for every subsequent execution, with parameters bound at call time. Footbag.org prepares all statements in db.ts at startup (50—100 total, grouped by domain), calling them with positional parameters (?) via better-sqlite3 methods; this eliminates repeated SQL compilation overhead and provides complete SQL injection protection.

**Progressive Enhancement**: Web development approach where core functionality works with plain HTML and full page reloads, with JavaScript used only to enhance the experience. Footbag.org evaluated this approach and rejected it; the platform requires JavaScript for interactive features, and the no-JS path is not maintained. Users with JavaScript disabled see a noscript message. See also: JavaScript.

**Receipt Token**: UUID returned to voter after casting ballot, enabling verification that vote was recorded without revealing vote contents or linking voter identity to specific ballot. Voter can check that their receipt token appears in public election results.

**Reconciliation Job**: Nightly background job (runs 2 AM UTC) matching Stripe payment records against platform transaction records, detecting discrepancies from webhook failures or timing issues. Generates alert report for treasurer review if mismatches exceed threshold.

**Recovery Point Objective (RPO)**: The maximum acceptable amount of data that can be lost in a failure, measured in time. Footbag.org achieves an RPO of 5—10 minutes through a background worker that uploads a consistent SQLite database snapshot to S3 every 5 minutes. Cross-region disaster recovery sync runs nightly providing a 24-hour RPO for catastrophic regional failures.

**Recovery Time Objective (RTO)**: The maximum acceptable time to restore normal service after a failure. Footbag.org targets an RTO of approximately 5 minutes: download the latest S3 backup, run PRAGMA integrity_check to validate the snapshot, replace the local database file, restart application containers, and verify health endpoints return OK.

**REST (Representational State Transfer)**: Architectural style for web APIs using HTTP methods and stateless communication. Footbag.org does not have a REST API but could add on in the future to support a phone app for example.

**Route 53**: AWS DNS service providing domain name management and health-based routing. Footbag.org uses Route 53 for footbag.org DNS records, health checks on origin server, and automatic failover to static S3 site if origin fails.

**S3 (Simple Storage Service)**: AWS object storage service providing scalable, durable file storage. Footbag.org uses S3 to store uploaded photos (two processed variants per photo), SQLite database backup snapshots uploaded every 5 minutes, static assets (CSS, JavaScript, images), the legacy archive, and audit log archives. Application state (members, events, registrations, etc.) is stored in a SQLite database, not in S3.

**S3 Lifecycle Rules**: Automated policies transitioning objects between storage classes or deleting after expiration. Footbag.org uses lifecycle rules to transition old audit logs from Standard to Glacier Deep Archive after one year for cost optimization, and to expire old content-hash static asset versions after 90 days to prevent unbounded storage growth.

**S3 Object Lock (WORM)**: S3 feature preventing objects from being modified or deleted for a specified retention period, enforcing Write Once Read Many semantics. Footbag.org applies Object Lock to the cross-region disaster recovery backup bucket and to the audit log archive bucket, ensuring backups and audit records cannot be tampered with even by administrators.

**S3 One Zone-IA**: S3 storage class storing data in a single availability zone at lower cost than standard S3, suitable for data that can be recreated if lost. Footbag.org uses One Zone-IA for the photo backup bucket (cross-region replication target) to reduce backup storage costs.

**SameSite=Lax**: Cookie attribute instructing browsers to send the cookie on same-site requests and top-level navigations, but not on cross-site subrequests (e.g., image or form loads from other domains). Footbag.org relies on SameSite=Lax as its primary CSRF protection mechanism, replacing the synchronizer token pattern used in older applications; all session cookies are set with this attribute.

**Service Layer**: Business logic layer implementing domain rules and coordinating data operations. Footbag.org services contain all business logic (membership tier validation, event state transitions, payment processing workflows) isolated from controllers (HTTP concerns) and adapters (storage concerns). Services are pure TypeScript functions for easy testing.

**SES (Simple Email Service)**: AWS managed email service handling sending, receiving, and reputation management. Footbag.org uses SES for transactional emails (password reset, event notifications, payment receipts) with DKIM/SPF/DMARC authentication. SES sandbox mode for development, production mode for live system.

**Session Manager**: AWS service providing secure shell access to Lightsail instances without exposing SSH ports or managing SSH keys. The project could use this but this was designed for AWS EC2 not Lightsail, and this causes complexity.

**SSH (Secure Shell)**: Standard secure remote shell protocol for host administration. Footbag.org uses hardened per-operator SSH access to named host accounts on Lightsail for exceptional operational tasks such as troubleshooting, deployment verification, restore work, patching, and manual recovery. Private keys are never shared between operators; shell access is controlled through individual accounts, key lifecycle management, and source-IP-restricted port-22 rules.

**Sharp**: High-performance Node.js image processing library using libvips. Footbag.org uses Sharp to resize uploaded photos to two variants (thumbnail 300×300 pixels, display 800px width), re-encode at 85% JPEG quality, and strip all EXIF metadata. Re-encoding through Sharp also destroys any malware embedded in uploaded files by converting to raw pixels and back. Processing is synchronous; users wait 2—5 seconds and receive immediate success or failure feedback.

**SIGTERM**: Unix signal sent to a process requesting graceful shutdown. When Docker stops a container, it sends SIGTERM to allow the application to finish in-flight work before exiting. Footbag.org handles SIGTERM by stopping new request acceptance, waiting up to 30 seconds for active transactions to complete, running a final WAL checkpoint, closing the SQLite connection, uploading a final S3 backup, and then exiting cleanly.

**SNS (Simple Notification Service)**: AWS managed messaging service that delivers notifications to subscribers via email, SMS, or HTTP endpoints. Footbag.org uses SNS topics as the delivery mechanism for CloudWatch alarms, routing warning-level alerts to the operations team email and critical alerts to both email and SMS.

**Soft Delete**: Deletion pattern marking records as deleted without immediate physical removal. Footbag.org sets a deleted_at timestamp on deleted records; database views automatically filter WHERE deleted_at IS NULL so queries never accidentally expose deleted data. Member personal data is purged after a 30-day grace period while an anonymized stub row is retained for referential integrity. Foreign keys use ON DELETE NO ACTION to prevent accidental hard deletes while relationships exist.

**SPF (Sender Policy Framework)**: Email authentication method listing IP addresses authorized to send mail for a domain. Footbag.org publishes SPF record authorizing AWS SES, preventing spammers from forging footbag.org sender addresses.

**SQLite**: Lightweight, file-based relational database engine embedded directly in the application process, requiring no separate database server. Footbag.org stores all application state (except photos) in a single SQLite file (footbag.db) accessed through the better-sqlite3 library; it supports full SQL, ACID transactions, and foreign key constraints while eliminating connection management, replication lag, and database server costs.

**SSE-S3 (Server-Side Encryption with S3-Managed Keys)**: S3's default encryption mode that transparently encrypts all stored objects using AES-256 with keys managed entirely by Amazon. Footbag.org enables SSE-S3 on all S3 buckets; encryption and decryption are automatic and transparent to the application, meeting security requirements for non-regulated data at zero additional cost or configuration.

**Standardized Hashtag**: Enforced-format hashtag with uniqueness validation for events (for example `#event_2025_beaver_open`) and clubs (for example `#club_wellington_hack_crew`). Members uploading media can tag with these hashtags for automatic gallery linking; the system validates uniqueness at event or club creation.

Rationale

**Stateless JWT**: Authentication approach using self-contained tokens that carry claims (member ID, roles, passwordVersion) without requiring server-side session storage. Note that Footbag.org's implementation is not purely stateless: every authenticated request verifies the JWT signature cryptographically and then reads the member record from the database to confirm passwordVersion matches, enabling immediate cross-device invalidation on password change. JWT claims serve as routing hints; the database read is authoritative for access control.

**Stripe**: Payment processor handling credit card transactions, subscriptions, and payouts. Footbag.org uses Stripe Checkout for collecting event fees and membership payments, Stripe Subscriptions for Tier 2 annual auto-renewal, and Stripe webhooks (HMAC SHA-256 validated) for payment status notifications. PCI compliance handled by Stripe's hosted forms.

**Stripe Checkout**: Hosted payment page managed by Stripe collecting card details securely. Footbag.org redirects members to Stripe Checkout for payment; Stripe handles PCI compliance and returns to Footbag.org with payment result.

**Stripe Subscriptions**: Recurring billing feature automatically charging members monthly or annually. Footbag.org uses subscriptions for Tier 2 membership auto-renewal; cancellation stops future charges but preserves access through current billing period.

**Stripe Webhook**: HTTP callback from Stripe notifying Footbag.org of payment events (payment succeeded, subscription canceled, payment failed). Footbag.org validates webhook signatures using HMAC-SHA256 and processes events asynchronously through outbox pattern.

**Terraform**: Open-source infrastructure-as-code tool using declarative configuration files (.tf) to provision and manage cloud resources. Footbag.org defines all AWS infrastructure in Terraform under the /terraform directory; running terraform plan shows a diff of planned changes and terraform apply creates or updates resources, enabling reproducible environment creation and infrastructure change review via pull requests.

**TLS (Transport Layer Security)**: Cryptographic protocol encrypting internet communications between browsers and servers. Footbag.org uses TLS 1.2+ for all HTTPS connections via CloudFront and nginx, protecting credentials and personal data in transit.

**TypeScript**: Typed superset of JavaScript adding static type checking at compile time. Footbag.org uses TypeScript for all application code (server, worker, optional client enhancement) catching type errors during development instead of production. Compiles to JavaScript for Node.js execution.

**Unicode Normalization (NFC)**: Process converting Unicode text to canonical composed form, eliminating visually identical but byte-different representations. Footbag.org normalizes all user input (hashtags, captions, names) to NFC preventing homograph attacks and ensuring consistent string comparisons.

**UUID (Universally Unique Identifier)**: 128-bit identifier formatted as 32 hexadecimal digits in five groups (8-4-4-4-12). Footbag.org uses UUID v4 (random) for entity IDs (member IDs, event IDs, media IDs) eliminating collision risk and preventing ID enumeration attacks. Example: 550e8400-e29b-41d4-a716-446655440000.

**View Model**: A structured object that a controller passes to a template to render a page. The view model contains exactly the data and flags the template needs (member tier, role flags, labels) without exposing raw storage details such as S3 paths.

**WAF (Web Application Firewall)**: AWS managed firewall service filtering malicious web traffic at the CloudFront edge before requests reach the origin server. Footbag.org uses WAF managed rules to mitigate DDoS attacks and known threat patterns, complementing in-process rate limiting on the Lightsail instance.

**Webhook**: HTTP callback allowing external services to notify applications of events. Footbag.org receives Stripe webhooks for payment events (payment succeeded, subscription canceled) validated using HMAC SHA-256 signatures. Webhook handlers process events asynchronously through outbox pattern ensuring reliable processing despite retries.

**WAL (Write-Ahead Logging):** SQLite journal mode where changes are written to a separate WAL file before being committed to the main database file, allowing unlimited concurrent readers while a writer is active. Footbag.org enables WAL mode via journal_mode=WAL PRAGMA; the background worker periodically runs wal_checkpoint(TRUNCATE) to merge WAL changes back into the main database file, and the final checkpoint runs during graceful shutdown to ensure no data is lost before a backup upload.

**Zod**: TypeScript schema validation library providing runtime type checking. Footbag.org uses Zod at controller boundaries to validate all incoming request data (required fields, types, formats, lengths) before reaching business logic.

**END OF GLOSSARY DOCUMENT**
