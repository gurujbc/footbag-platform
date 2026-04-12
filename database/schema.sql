-- =============================================================================
-- Footbag.org — SQLite database schema
-- International Footbag Players Association (IFPA) platform
--
-- Required at every connection before any reads or writes:
--   PRAGMA foreign_keys = ON;
--
-- Initialize a fresh database:
--   sqlite3 footbag.db < schema.sql
--
-- All timestamps are stored as ISO-8601 UTC text: 'YYYY-MM-DDTHH:MM:SS.sssZ'
-- Views and triggers that compare timestamps use strftime('%Y-%m-%dT%H:%M:%fZ','now')
-- so that lexical ordering matches chronological ordering. Writers MUST use this
-- same format; mixing space-separated datetime() output breaks sort correctness.

PRAGMA foreign_keys = ON;

-- =============================================================================
-- SECTION 1: TAGS
-- =============================================================================

-- Globally unique hashtag registry used for media tagging and discovery.
-- Standard tags (#event_*, #club_*) are platform-managed identities that link
-- media, events, and clubs. Freeform tags are member-created. Tags are never
-- soft-deleted; uniqueness of tag_normalized is enforced globally (no WHERE clause).
-- Standard tags must not be hard-deleted (application-enforced; see APP-024):
-- the unique index cannot prevent normalized-form reuse if a row is removed.
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  tag_normalized TEXT NOT NULL,
  tag_display    TEXT NOT NULL,

  is_standard   INTEGER NOT NULL DEFAULT 0 CHECK (is_standard IN (0,1)),
  standard_type TEXT CHECK (standard_type IN ('event','club')),

  CHECK (tag_normalized = lower(tag_normalized)),
  CHECK (substr(tag_normalized,1,1) = '#')
);

CREATE UNIQUE INDEX ux_tags_normalized ON tags(tag_normalized);

-- =============================================================================
-- SECTION 2: CLUBS
-- =============================================================================

-- Registered footbag clubs with location, contact, and branding information.
-- Uses status-based archival (active/inactive/archived) instead of soft-delete.
-- Each club has a unique hashtag that serves as its canonical media-linking identity.
-- clubs_open excludes archived rows; clubs_all includes them for admin queries.
CREATE TABLE clubs (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL,
  region      TEXT,
  country     TEXT NOT NULL,

  contact_email             TEXT,
  whatsapp                  TEXT,
  external_url              TEXT,
  external_url_validated_at TEXT,

  -- ON DELETE SET NULL: deleting a media item detaches the club logo without
  -- requiring a before-delete trigger. The application stamps updated_at/updated_by
  -- on the club row when it deliberately removes a logo; the FK action handles
  -- the case where media is deleted directly (e.g., by the uploader or an admin).
  logo_media_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,

  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  hashtag_tag_id TEXT NOT NULL REFERENCES tags(id)
);

-- clubs_open: active and inactive rows (excludes archived clubs)
CREATE VIEW clubs_open AS
  SELECT * FROM clubs WHERE status IN ('active', 'inactive');

-- clubs_all: all rows including archived; use for admin queries and audits
CREATE VIEW clubs_all AS
  SELECT * FROM clubs;

CREATE INDEX        idx_clubs_geo    ON clubs(country, region, city);
CREATE INDEX        idx_clubs_status ON clubs(status);
CREATE UNIQUE INDEX ux_clubs_hashtag ON clubs(hashtag_tag_id);

-- =============================================================================
-- SECTION 3: EVENTS
-- =============================================================================

-- Footbag events with lifecycle (draft → published → completed/canceled),
-- optional sanctioning workflow, payment configuration, and registration controls.
-- Events use hard-delete; published events with results are preserved by
-- application workflow constraints. Each event has a unique hashtag identity.
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  city        TEXT NOT NULL,
  region      TEXT,
  country     TEXT NOT NULL,
  host_club_id TEXT REFERENCES clubs(id),

  external_url              TEXT,
  external_url_validated_at TEXT,

  registration_deadline             TEXT,
  capacity_limit                    INTEGER,
  is_attendee_registration_open     INTEGER NOT NULL DEFAULT 0 CHECK (is_attendee_registration_open IN (0,1)),
  is_tshirt_size_collected          INTEGER NOT NULL DEFAULT 0 CHECK (is_tshirt_size_collected IN (0,1)),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','published','registration_full','closed','completed','canceled')),
  registration_status TEXT NOT NULL DEFAULT 'open' CHECK (registration_status IN ('open','closed')),
  published_at TEXT,

  sanction_status TEXT NOT NULL DEFAULT 'none'
    CHECK (sanction_status IN ('none','pending','approved','rejected')),
  sanction_requested_at           TEXT,
  sanction_requested_by_member_id TEXT REFERENCES members(id),
  sanction_justification          TEXT,
  sanction_decided_at             TEXT,
  sanction_decided_by_member_id   TEXT REFERENCES members(id),
  sanction_decision_reason        TEXT,

  payment_enabled              INTEGER NOT NULL DEFAULT 0 CHECK (payment_enabled IN (0,1)),
  payment_enabled_at           TEXT,
  payment_enabled_by_member_id TEXT REFERENCES members(id),

  currency             TEXT NOT NULL DEFAULT 'USD',
  competitor_fee_cents INTEGER,
  attendee_fee_cents   INTEGER,

  hashtag_tag_id TEXT NOT NULL REFERENCES tags(id)
);

CREATE INDEX        idx_events_start_date      ON events(start_date);
CREATE INDEX        idx_events_geo             ON events(country, region, city);
CREATE INDEX        idx_events_status          ON events(status);
CREATE UNIQUE INDEX ux_events_hashtag          ON events(hashtag_tag_id);
CREATE INDEX        idx_events_sanction_status ON events(sanction_status);
CREATE INDEX        idx_events_host_club       ON events(host_club_id);

-- Disciplines offered at a specific event (e.g., freestyle singles, net doubles).
-- Each discipline defines the participation format (singles/doubles/mixed_doubles)
-- used at registration time to enforce partner requirements.
-- No soft-delete: disciplines are hard-deleted when removed from a draft event.
CREATE TABLE event_disciplines (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  event_id            TEXT NOT NULL REFERENCES events(id),
  name                TEXT NOT NULL,
  discipline_category TEXT NOT NULL,
  team_type TEXT NOT NULL DEFAULT 'singles'
    CHECK (team_type IN ('singles', 'doubles', 'mixed_doubles')),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- idx_event_disciplines_event dropped (left-prefix redundant with ux_event_discipline_name)
CREATE UNIQUE INDEX ux_event_discipline_name ON event_disciplines(event_id, name);

-- =============================================================================
-- SECTION 4: TIER 1 VOUCH REQUESTS
-- =============================================================================

-- Pending and decided requests to grant a member Tier 1 status via admin approval
-- (Pathway B vouching). Stores the requester, target member, rationale, and admin
-- decision. reason_text is the required brief rationale on all requests; notes_text
-- is optional elaboration available only for Pathway B submissions.
-- A DB CHECK prevents structurally malformed self-vouch rows as defense-in-depth.
CREATE TABLE tier1_vouch_requests (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  requested_by_member_id     TEXT NOT NULL REFERENCES members(id),
  target_member_id           TEXT NOT NULL REFERENCES members(id),
  reason_text                TEXT NOT NULL,
  notes_text                 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by_admin_member_id TEXT REFERENCES members(id),
  decided_at                 TEXT,
  decision_reason            TEXT,

  -- Structural integrity: a member cannot vouch for themselves.
  -- App also validates this; DB provides defense-in-depth.
  CHECK (requested_by_member_id <> target_member_id)
);

CREATE INDEX idx_vouch_requests_status ON tier1_vouch_requests(status);

-- =============================================================================
-- SECTION 5: VOTES & ELECTIONS
-- =============================================================================

-- An election or issue vote. Captures the ballot type, timing windows
-- (nomination phase, voting phase, options visibility), eligibility rules,
-- and lifecycle status. DB CHECK constraints enforce ordering invariants
-- across nomination and voting windows to protect election integrity.
-- vote_eligibility_snapshot is frozen at vote-open time; tier expiry
-- during an open vote does NOT revoke eligibility — the snapshot is authoritative.
-- options_visible_at: when set, options are visible before vote_open_at
-- (application enforces options_visible_at <= vote_open_at).
CREATE TABLE votes (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  vote_type   TEXT NOT NULL CHECK (vote_type IN ('election','issue')),
  ballot_type TEXT NOT NULL CHECK (ballot_type IN ('single_choice','multi_choice')),
  nomination_open_at  TEXT,
  nomination_close_at TEXT,
  vote_open_at        TEXT NOT NULL,
  vote_close_at       TEXT NOT NULL,
  options_visible_at  TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','closed','published','canceled')),

  eligibility_rule_json TEXT NOT NULL DEFAULT '{}',
  background_text       TEXT NOT NULL DEFAULT '',

  -- Vote window ordering invariants (election integrity; DB-enforced because
  -- multiple admin paths can write votes).
  CHECK (vote_open_at < vote_close_at),
  CHECK (
    nomination_open_at IS NULL OR nomination_close_at IS NULL
    OR nomination_open_at < nomination_close_at
  ),
  CHECK (
    nomination_close_at IS NULL
    OR nomination_close_at <= vote_open_at
  )
);

CREATE INDEX idx_votes_status     ON votes(status);
CREATE INDEX idx_votes_open_close ON votes(vote_open_at, vote_close_at);

-- Candidate or choice options available for a vote. Immutable once voting opens:
-- INSERT, UPDATE, and DELETE are blocked by triggers for any vote in status
-- open/closed/published/canceled, preventing retroactive changes to cast ballots.
CREATE TABLE vote_options (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  vote_id           TEXT NOT NULL REFERENCES votes(id),
  option_type       TEXT NOT NULL CHECK (option_type IN ('candidate','choice')),
  title             TEXT NOT NULL,
  description       TEXT,
  nominee_member_id TEXT REFERENCES members(id),
  nomination_id     TEXT REFERENCES hof_nominations(id),
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_vote_options_vote ON vote_options(vote_id);

-- vote_options immutability once voting opens.
-- Blocks INSERT, UPDATE, and DELETE on vote_options when the parent vote
-- has reached status 'open', 'closed', 'published', or 'canceled'.
-- Prevents retroactive option changes from corrupting cast ballots.
-- Kept in DB because election integrity requires this invariant regardless of
-- which code path (admin API, background job, direct SQL) touches the table.
CREATE TRIGGER trg_vote_options_lock_insert
BEFORE INSERT ON vote_options
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM votes WHERE id = NEW.vote_id)
         IN ('open','closed','published','canceled')
    THEN RAISE(ABORT,
      'vote_options: cannot add options after voting has opened')
  END;
END;

CREATE TRIGGER trg_vote_options_lock_update
BEFORE UPDATE ON vote_options
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.vote_id <> OLD.vote_id
    THEN RAISE(ABORT,
      'vote_options: vote_id is immutable after creation')
    WHEN (SELECT status FROM votes WHERE id = OLD.vote_id)
         IN ('open','closed','published','canceled')
    THEN RAISE(ABORT,
      'vote_options: cannot modify options after voting has opened')
  END;
END;

CREATE TRIGGER trg_vote_options_lock_delete
BEFORE DELETE ON vote_options
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM votes WHERE id = OLD.vote_id)
         IN ('open','closed','published','canceled')
    THEN RAISE(ABORT,
      'vote_options: cannot delete options after voting has opened')
  END;
END;

-- Eligibility snapshot frozen at vote-open time: one row per member per vote,
-- recording whether the member was eligible when voting opened. Immutable after
-- insert — UPDATE and DELETE are blocked by triggers to protect election integrity.
-- Tier changes after vote-open do not alter this snapshot.
CREATE TABLE vote_eligibility_snapshot (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  vote_id       TEXT NOT NULL REFERENCES votes(id),
  member_id     TEXT NOT NULL REFERENCES members(id),
  eligible      INTEGER NOT NULL CHECK (eligible IN (0,1)),
  reason_code   TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(vote_id, member_id)
);

CREATE INDEX idx_vote_eligibility_vote ON vote_eligibility_snapshot(vote_id);

CREATE TRIGGER trg_vote_eligibility_no_update
BEFORE UPDATE ON vote_eligibility_snapshot
BEGIN
  SELECT RAISE(ABORT, 'vote_eligibility_snapshot is immutable; frozen at vote open time');
END;

CREATE TRIGGER trg_vote_eligibility_no_delete
BEFORE DELETE ON vote_eligibility_snapshot
BEGIN
  SELECT RAISE(ABORT, 'vote_eligibility_snapshot is immutable; rows may not be deleted');
END;

-- Cast ballots: one row per member per vote, immutable after insert.
-- Each ballot is AES-256-GCM envelope-encrypted with a per-ballot KMS data key.
-- Voter identity (voter_member_id) is stored as plaintext alongside the encrypted
-- ballot — this is intentional; participation fact is not hidden, only content is.
-- UPDATE and DELETE are blocked by triggers to prevent tampering.
CREATE TABLE ballots (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  vote_id         TEXT NOT NULL REFERENCES votes(id),
  -- voter_member_id: plaintext participation metadata (intentional).
  -- ballots is NOT anonymous-ballot storage. Voter identity is co-located
  -- with the encrypted ballot by design. Ballot content confidentiality is provided
  -- by AES-256-GCM encryption; participation fact (who voted) is not hidden.
  voter_member_id TEXT NOT NULL REFERENCES members(id),
  cast_at         TEXT NOT NULL,

  receipt_token_hash         TEXT NOT NULL,
  receipt_token_hash_version INTEGER NOT NULL DEFAULT 1,

  -- AES-256-GCM envelope encryption per ballot.
  -- Each ballot uses a fresh data key from KMS (GenerateDataKey).
  -- All four fields are required to decrypt a ballot during tally operations.
  encrypted_ballot_b64   TEXT NOT NULL,
  encrypted_data_key_b64 TEXT NOT NULL,
  kms_key_id             TEXT NOT NULL,
  encryption_version     INTEGER NOT NULL DEFAULT 1,
  -- AES-GCM nonce (IV), base64-encoded. Required for decryption.
  ballot_nonce_b64       TEXT NOT NULL,
  -- AES-GCM authentication tag, base64-encoded. Required for integrity verification.
  ballot_auth_tag_b64    TEXT NOT NULL,

  UNIQUE(vote_id, voter_member_id),
  UNIQUE(vote_id, receipt_token_hash)
);

CREATE TRIGGER trg_ballots_no_update
BEFORE UPDATE ON ballots
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ballots is immutable: UPDATE not permitted');
END;

CREATE TRIGGER trg_ballots_no_delete
BEFORE DELETE ON ballots
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ballots is immutable: DELETE not permitted');
END;

CREATE INDEX idx_ballots_vote  ON ballots(vote_id);
CREATE INDEX idx_ballots_voter ON ballots(voter_member_id);

-- Tally outcome record for a completed vote: one row per vote, written when
-- the tally is finalized and published. Stores publication metadata, a summary,
-- and optionally a full result_json blob. Normalized per-option counts are in
-- vote_result_option_totals; both representations may coexist.
CREATE TABLE vote_results (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  vote_id                      TEXT NOT NULL UNIQUE REFERENCES votes(id),
  published_at                 TEXT,
  published_by_admin_member_id TEXT REFERENCES members(id),
  summary_text                 TEXT,

  -- Optional single-blob JSON tally result per vote.
  -- Complementary to the normalized vote_result_option_totals rows;
  -- the application may populate both or only the normalized form.
  result_json TEXT
);

-- Normalized per-option vote counts for a tally result.
-- One row per option per vote result, complementing the optional result_json
-- blob in vote_results with a structured, queryable breakdown.
CREATE TABLE vote_result_option_totals (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  vote_results_id TEXT NOT NULL REFERENCES vote_results(id),
  option_id       TEXT NOT NULL REFERENCES vote_options(id),
  vote_count      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(vote_results_id, option_id)
);

CREATE INDEX idx_vote_totals_results ON vote_result_option_totals(vote_results_id);

-- =============================================================================
-- SECTION 6: HALL OF FAME
-- =============================================================================

-- Hall of Fame nominations submitted by members each year.
-- vote_id links a nomination to the associated HoF election vote (NULL for
-- legacy nominations that predate the platform). Snapshot fields capture the
-- nominee's name and contact at submission time, ensuring records remain
-- complete even if the member's profile is later changed or GDPR-purged.
-- UNIQUE(nomination_year, nominee_member_id) prevents duplicate nominations per year.
CREATE TABLE hof_nominations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  nomination_year     INTEGER NOT NULL,
  nominator_member_id TEXT NOT NULL REFERENCES members(id),
  nominee_member_id   TEXT NOT NULL REFERENCES members(id),
  nomination_category TEXT NOT NULL CHECK (nomination_category IN ('player','contributor')),
  nomination_text     TEXT,
  status TEXT NOT NULL DEFAULT 'pending_admin_approval'
    CHECK (status IN ('pending_admin_approval','approved','rejected','withdrawn')),
  decided_by_admin_member_id TEXT REFERENCES members(id),
  decided_at      TEXT,
  decision_reason TEXT,

  vote_id TEXT REFERENCES votes(id),

  -- Snapshot fields: capture nominee identity at submission time.
  -- nominee_member_id provides the FK for platform members but their profile
  -- data (name, contact) can change or be GDPR-purged after nomination.
  -- nominee_snapshot_name is required on new rows (NOT NULL).
  -- For legacy pre-platform rows inserted during data migration, populate
  -- nominee_snapshot_name from the member's real_name at import time.
  -- nominee_snapshot_contact is free text (email, phone, or other); nullable
  -- because some legacy nominees may have no contact record.
  nominee_snapshot_name    TEXT NOT NULL,
  nominee_snapshot_contact TEXT,

  UNIQUE(nomination_year, nominee_member_id)
);

CREATE INDEX idx_hof_nominations_status  ON hof_nominations(status);
CREATE INDEX idx_hof_nominations_year    ON hof_nominations(nomination_year);
CREATE INDEX idx_hof_nominations_nominee ON hof_nominations(nominee_member_id);

-- Supporting affidavit submitted for a Hall of Fame nomination.
-- One affidavit per nomination (UNIQUE on nomination_id). Stores the full
-- affidavit text and submission metadata.
CREATE TABLE hof_affidavits (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  nomination_id          TEXT NOT NULL UNIQUE REFERENCES hof_nominations(id),
  submitted_by_member_id TEXT NOT NULL REFERENCES members(id),
  submitted_at           TEXT NOT NULL,
  affidavit_text         TEXT NOT NULL
);

-- =============================================================================
-- SECTION 7: NEWS
-- =============================================================================

-- Platform news feed items: auto-generated by primary entity workflows (event
-- published, results posted, club created/archived, HoF/BAP grant, vote results)
-- and manually authored admin announcements. Hard-delete only — no soft-delete.
-- entity_type/entity_id link an item to its source entity where applicable.
CREATE TABLE news_items (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  published_at TEXT NOT NULL,
  news_type    TEXT NOT NULL
    -- 'club_archived' fires when an admin archives a club (A_Archive_Club).
    CHECK (news_type IN ('event_published','event_results','club_created','club_archived',
                         'member_honor','vote_results','announcement','system')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id   TEXT,
  is_public   INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1))
);

CREATE INDEX idx_news_published_at ON news_items(published_at);

-- =============================================================================
-- SECTION 8: MAILING LISTS & EMAIL
-- =============================================================================

-- Named mailing lists used for broadcasts, newsletters, and system alerts.
-- slug is the natural primary key and the stable reference used by outbox_emails,
-- email_archives, and mailing_list_subscriptions. is_member_manageable controls
-- whether members can self-subscribe/unsubscribe. Six core lists are seeded
-- at initialization (admin-alerts, all-members, newsletter, board-announcements,
-- event-notifications, technical-updates); see Section 23.
CREATE TABLE mailing_lists (
  slug       TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,

  name              TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  is_member_manageable INTEGER NOT NULL DEFAULT 1 CHECK (is_member_manageable IN (0,1)),
  from_identity     TEXT,
  rules_text        TEXT
);

-- Transactional email send queue (outbox pattern). All outbound emails are written
-- here first; a background worker picks up pending rows, delivers them, and updates
-- status. Supports retry with dead-lettering and an admin pause toggle.
-- body_text for voting confirmation emails contains a plaintext receipt token that
-- MUST be scrubbed by the sender worker after successful delivery (see APP-019).
-- At least one of recipient_email, recipient_member_id, or mailing_list_id
-- must be non-NULL (enforced by CHECK below).
CREATE TABLE outbox_emails (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  idempotency_key TEXT,

  recipient_email     TEXT,
  recipient_member_id TEXT REFERENCES members(id),
  mailing_list_id     TEXT REFERENCES mailing_lists(slug),

  sender_member_id TEXT REFERENCES members(id),
  from_identity    TEXT,

  subject   TEXT NOT NULL,
  body_text TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','dead_letter')),
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  last_attempt_at TEXT,
  sent_at         TEXT,
  scheduled_for   TEXT,

  CHECK (
    recipient_email     IS NOT NULL
    OR recipient_member_id IS NOT NULL
    OR mailing_list_id     IS NOT NULL
  )
);

CREATE INDEX        idx_outbox_status     ON outbox_emails(status);
CREATE INDEX        idx_outbox_scheduled  ON outbox_emails(status, scheduled_for);
CREATE UNIQUE INDEX ux_outbox_idempotency
  ON outbox_emails(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Archive record of bulk email sends (mailing list blasts, event participant
-- emails, announcements). One row per bulk send, capturing sender, subject,
-- body, recipient count, and a reference to the originating list or event.
-- Not a delivery log; records intent and content of each broadcast.
CREATE TABLE email_archives (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  archive_type    TEXT NOT NULL
    CHECK (archive_type IN ('mailing_list','event_participants','announce')),
  mailing_list_id TEXT REFERENCES mailing_lists(slug),
  event_id        TEXT REFERENCES events(id),

  sender_member_id TEXT REFERENCES members(id),
  from_identity    TEXT,
  subject          TEXT NOT NULL,
  body_text        TEXT NOT NULL,
  sent_at          TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL DEFAULT 0,

  CHECK (archive_type <> 'mailing_list'       OR mailing_list_id IS NOT NULL),
  CHECK (archive_type <> 'event_participants' OR event_id IS NOT NULL)
);

CREATE INDEX idx_email_archives_sent  ON email_archives(sent_at);
CREATE INDEX idx_email_archives_event ON email_archives(event_id);

-- Admin-editable email subject and body templates keyed by template_key.
-- The email_templates_enabled view exposes only enabled templates. Disabled templates
-- suppress the corresponding automated email type without deleting the content.
CREATE TABLE email_templates (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  template_key     TEXT NOT NULL UNIQUE,
  subject_template TEXT NOT NULL,
  body_template    TEXT NOT NULL,
  is_enabled       INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  updated_by_label TEXT,
  updated_at_label TEXT
);

-- email_templates_enabled: only templates with is_enabled = 1.
-- Setting is_enabled = 0 suppresses the template from automated email flows
-- without deleting the content.
CREATE VIEW email_templates_enabled AS
  SELECT * FROM email_templates WHERE is_enabled = 1;

-- =============================================================================
-- SECTION 9: ADMIN OPERATIONS
-- =============================================================================

-- Admin task queue for items requiring human review or decision across all
-- platform domains (events, media, membership, payments, elections, system).
-- Each item is categorized by queue_category and task_type, linked to an entity,
-- and resolved or dismissed by an admin. A notification is sent to the
-- admin-alerts mailing list when any item is enqueued.
CREATE TABLE work_queue_items (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  queue_category TEXT NOT NULL
    CHECK (queue_category IN ('events','media','membership','payments','elections','system')),
  task_type   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,

  status   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  priority INTEGER NOT NULL DEFAULT 0,
  opened_at             TEXT NOT NULL,
  resolved_at           TEXT,
  resolved_by_member_id TEXT REFERENCES members(id),
  decision_label        TEXT,
  reason_text           TEXT
);

CREATE INDEX idx_work_queue_status ON work_queue_items(status, queue_category);
CREATE INDEX idx_work_queue_entity ON work_queue_items(entity_type, entity_id);

-- Platform-wide runtime configuration: append-only effective-dated rows.
-- One row per (config_key, effective_start_at) pair. The current effective
-- value for a key is the row with the latest effective_start_at <= now.
-- All rows are immutable once inserted; UPDATE and DELETE are blocked by triggers.
-- Seeded with all required defaults at initialization (see Section 23).
-- Missing keys cause runtime errors; seed data must be complete.
--
-- Actor attribution: changed_by_member_id is a typed FK to members (admins only).
-- System-seeded rows at initialization use NULL with a documented reason_text
-- explaining the system origin.
--
-- config_key vocabulary: see data model §4.9 for full key reference.
-- Pricing keys: tier1_lifetime_price_cents, tier2_annual_price_cents,
--   tier2_lifetime_price_cents (stored as integer cents, not USD decimals).
CREATE TABLE system_config (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,

  config_key         TEXT NOT NULL,
  value_json         TEXT NOT NULL,
  effective_start_at TEXT NOT NULL,
  reason_text        TEXT NOT NULL,

  -- Typed FK: only admins (or NULL for system-seeded rows) may author config changes.
  changed_by_member_id TEXT REFERENCES members(id),

  UNIQUE (config_key, effective_start_at)
);

-- Immutability: all rows are permanent once inserted.
CREATE TRIGGER trg_system_config_no_update
BEFORE UPDATE ON system_config
BEGIN
  SELECT RAISE(ABORT, 'system_config is append-only: UPDATE not permitted');
END;

CREATE TRIGGER trg_system_config_no_delete
BEFORE DELETE ON system_config
BEGIN
  SELECT RAISE(ABORT, 'system_config is append-only: DELETE not permitted');
END;

CREATE INDEX idx_system_config_actor
  ON system_config(changed_by_member_id)
  WHERE changed_by_member_id IS NOT NULL;

-- system_config_current: the current effective value per config_key.
-- Returns the row with the latest effective_start_at <= now for each key.
-- This is the authoritative read surface for all runtime config lookups.
-- Use this view for all application reads; never query system_config directly
-- unless building admin history UIs or audit reports.
CREATE VIEW system_config_current AS
SELECT s.*
FROM system_config s
WHERE s.effective_start_at = (
  SELECT MAX(s2.effective_start_at)
  FROM system_config s2
  WHERE s2.config_key = s.config_key
    AND s2.effective_start_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- Privacy-safe, append-only audit ledger. Records who did what to which entity
-- and when, with structured metadata. IP addresses and user-agent strings are
-- NEVER stored. UPDATE and DELETE are blocked by triggers; rows are permanent.
-- Actor context uses actor_type + actor_member_id (NULL for system actors).
CREATE TABLE audit_entries (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  occurred_at     TEXT NOT NULL,
  actor_type      TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system','member','admin')),
  actor_member_id TEXT REFERENCES members(id),
  action_type     TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  reason_text     TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_audit_occurred_at ON audit_entries(occurred_at);
CREATE INDEX idx_audit_category    ON audit_entries(category);
CREATE INDEX idx_audit_actor_member
  ON audit_entries(actor_member_id)
  WHERE actor_member_id IS NOT NULL;

CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is immutable; use append only');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_entries
BEGIN
  SELECT RAISE(ABORT, 'audit_entries is immutable; rows may not be deleted');
END;

-- Execution history for background/scheduled system jobs.
-- Each row records one job run: start time, finish time, outcome, and any
-- error detail. Used for operational monitoring and alerting.
CREATE TABLE system_job_runs (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  job_name    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  details_json TEXT NOT NULL DEFAULT '{}',
  last_error   TEXT
);

CREATE INDEX idx_job_runs_job_name ON system_job_runs(job_name, started_at);

-- Infrastructure and operational alarms raised by the platform.
-- Each alarm has a severity level, a lifecycle (active → acknowledged/cleared),
-- and optional admin acknowledgment notes. Used for operational incident tracking.
CREATE TABLE system_alarm_events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  alarm_type TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  raised_at  TEXT NOT NULL,
  cleared_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cleared','acknowledged')),
  acknowledged_by_member_id TEXT REFERENCES members(id),
  acknowledged_at           TEXT,
  acknowledgment_note       TEXT,
  details_json              TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_alarm_status ON system_alarm_events(status, severity);

-- =============================================================================
-- SECTION 10: PAYMENTS
-- =============================================================================
-- Table ordering: recurring_donation_subscriptions is defined first because
-- payments.recurring_subscription_id references it.
--
-- stripe_events: Stripe webhook idempotency store; prevents duplicate
--   processing of redelivered events. Not an audit substitute.
-- recurring_donation_subscriptions: current-state mirror of each Stripe
--   Subscription. Updated on every relevant webhook event.
-- recurring_donation_subscription_transitions: append-only subscription
--   lifecycle audit ledger. UPDATE and DELETE blocked by triggers.
-- payments: Stripe-backed payment record for donations, membership dues,
--   and event registrations. Uses 'succeeded' (not 'completed') to align with
--   Stripe payment_intent vocabulary.
-- payment_status_transitions: append-only payment status-change audit ledger.
--   Application MUST write a transition row in the same transaction as every
--   payments.status change.
--
-- Payment state machine (enforced by DB trigger trg_payments_status_monotonicity):
--   pending → succeeded | failed | canceled
--   succeeded → refunded
--   Same-status no-ops are allowed (idempotent webhook redelivery).
--   No backward transitions are permitted.
--   The trigger lives in the DB because multiple independent code paths (webhook
--   handler, admin tools, refund worker) can mutate payments.status, and a
--   DB guard prevents silent backward transitions regardless of which path runs.

-- Stripe webhook event idempotency store. One row per received Stripe event_id,
-- preventing duplicate processing on redelivery. Tracks processing outcome
-- (processed/failed) and retry count. Not a substitute for transition audit tables.
CREATE TABLE stripe_events (
  event_id          TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  -- Stripe event creation time as ISO-8601 UTC text (converted from Stripe Unix epoch at write time).
  -- Use strftime('%Y-%m-%dT%H:%M:%fZ', stripe_event.created, 'unixepoch') when writing.
  stripe_created    TEXT NOT NULL,
  processed_at      TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('processed','failed')),
  -- Number of processing attempts for this event. Incremented on each retry.
  attempts  INTEGER NOT NULL DEFAULT 1,
  last_error TEXT
);

CREATE INDEX idx_stripe_events_created ON stripe_events(stripe_created);

-- ---------------------------------------------------------------------------
-- RECURRING DONATION SUBSCRIPTIONS
-- Current-state mirror of a member's recurring donation subscription in Stripe.
-- One row per active-or-historical subscription; updated on each relevant
-- webhook event. Lifecycle history is in the transitions table below.
-- ---------------------------------------------------------------------------

CREATE TABLE recurring_donation_subscriptions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  member_id TEXT NOT NULL REFERENCES members(id),

  stripe_customer_id     TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  last_stripe_event_id   TEXT REFERENCES stripe_events(event_id),

  -- Current state; updated on each relevant webhook event
  status TEXT NOT NULL CHECK (status IN ('active','past_due','canceled')),
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('yearly')),
  started_at        TEXT NOT NULL,
  status_updated_at TEXT NOT NULL,

  is_cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (is_cancel_at_period_end IN (0,1)),
  cancel_requested_at     TEXT,
  canceled_at             TEXT,

  donation_comment TEXT,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  metadata_json    TEXT NOT NULL DEFAULT '{}',

  CHECK (canceled_at IS NULL OR status = 'canceled'),
  CHECK (cancel_requested_at IS NULL OR is_cancel_at_period_end = 1)
);

CREATE UNIQUE INDEX ux_recurring_subs_stripe  ON recurring_donation_subscriptions(stripe_subscription_id);
CREATE INDEX        idx_recurring_subs_member ON recurring_donation_subscriptions(member_id);
CREATE INDEX        idx_recurring_subs_status ON recurring_donation_subscriptions(status);

-- recurring_donation_subscriptions_active: non-canceled subscriptions.
-- Named explicitly so that the WHERE clause is visible in the view name.
-- Use the table directly to query canceled rows.
CREATE VIEW recurring_donation_subscriptions_active AS
  SELECT * FROM recurring_donation_subscriptions
  WHERE status <> 'canceled';

-- ---------------------------------------------------------------------------
-- RECURRING DONATION SUBSCRIPTION TRANSITIONS
-- Append-only audit ledger of every subscription lifecycle event (activation,
-- charges, cancellations, updates). One row per event per subscription.
-- UPDATE and DELETE are blocked by triggers.
-- ---------------------------------------------------------------------------

CREATE TABLE recurring_donation_subscription_transitions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  recurring_subscription_id TEXT NOT NULL
    REFERENCES recurring_donation_subscriptions(id),

  -- Denormalized for audit queries without joins
  member_id TEXT NOT NULL REFERENCES members(id),

  stripe_event_id        TEXT REFERENCES stripe_events(event_id),
  stripe_subscription_id TEXT NOT NULL,
  stripe_invoice_id      TEXT,

  -- Raw Stripe event type, e.g. 'customer.subscription.created'
  event_type TEXT NOT NULL,

  -- App-controlled semantic code; see data model §4.4 for controlled vocabulary.
  -- Values: 'activated','charge_succeeded','charge_failed','cancel_requested',
  --         'canceled','updated'
  lifecycle_event_code TEXT NOT NULL
    CHECK (lifecycle_event_code IN (
      'activated','charge_succeeded','charge_failed',
      'cancel_requested','canceled','updated'
    )),

  old_status TEXT CHECK (old_status IN ('active','past_due','canceled')),
  new_status TEXT CHECK (new_status IN ('active','past_due','canceled')),
  occurred_at     TEXT NOT NULL,
  reason_text     TEXT,
  correlation_key TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER trg_recurring_sub_transitions_no_update
BEFORE UPDATE ON recurring_donation_subscription_transitions
BEGIN
  SELECT RAISE(ABORT,
    'recurring_donation_subscription_transitions is append-only: UPDATE not permitted');
END;

CREATE TRIGGER trg_recurring_sub_transitions_no_delete
BEFORE DELETE ON recurring_donation_subscription_transitions
BEGIN
  SELECT RAISE(ABORT,
    'recurring_donation_subscription_transitions is append-only: DELETE not permitted');
END;

CREATE INDEX idx_recurring_sub_trans_subscription
  ON recurring_donation_subscription_transitions(recurring_subscription_id, occurred_at);
CREATE INDEX idx_recurring_sub_trans_member
  ON recurring_donation_subscription_transitions(member_id, occurred_at);
CREATE INDEX idx_recurring_sub_trans_stripe_event
  ON recurring_donation_subscription_transitions(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- Stripe-backed payment record for donations, membership dues, and event
-- registrations. recurring_donation_subscriptions must be defined above.
-- ---------------------------------------------------------------------------

-- One row per Stripe payment transaction. Covers one-time donations, membership
-- dues purchases, and event registration fees. Status transitions are enforced
-- by trg_payments_status_monotonicity (forward-only; no backward transitions).
-- 'succeeded' is used in place of the functional term "completed" to align with
-- Stripe payment_intent vocabulary. See §4.10 of the data model.
CREATE TABLE payments (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  member_id TEXT REFERENCES members(id),

  payment_type TEXT NOT NULL
    CHECK (payment_type IN ('donation','membership','event_registration')),
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',

  -- Status vocabulary: 'succeeded' maps to what the US calls "completed".
  -- This aligns with Stripe payment_intent status vocabulary.
  -- State machine: pending → succeeded|failed|canceled; succeeded → refunded.
  -- Enforced by trg_payments_status_monotonicity (see below).
  status TEXT NOT NULL
    CHECK (status IN ('pending','succeeded','failed','canceled','refunded')),
  descriptor TEXT NOT NULL,

  stripe_payment_intent_id   TEXT UNIQUE,
  stripe_checkout_session_id TEXT,
  stripe_customer_id         TEXT,
  stripe_subscription_id     TEXT,
  -- ISO-8601 UTC text (converted from Stripe Unix epoch at write time; see SCH-06).
  last_stripe_event_created  TEXT,

  -- Non-null only for per-cycle charges against a recurring donation subscription.
  -- App discipline: set both this FK and stripe_subscription_id for such payments.
  recurring_subscription_id TEXT
    REFERENCES recurring_donation_subscriptions(id),

  -- Inlined donation detail (NULL for non-donation payments)
  donation_note         TEXT,

  -- Inlined membership detail (NULL for non-membership payments)
  purchased_tier_status TEXT
    CHECK (purchased_tier_status IN ('tier1_annual','tier1_lifetime','tier2_annual','tier2_lifetime')),

  metadata_json TEXT NOT NULL DEFAULT '{}',

  CHECK (payment_type <> 'membership' OR purchased_tier_status IS NOT NULL),
  CHECK (recurring_subscription_id IS NULL OR payment_type = 'donation')
);

CREATE INDEX idx_payments_member  ON payments(member_id);
CREATE INDEX idx_payments_created ON payments(created_at);
CREATE INDEX idx_payments_type    ON payments(payment_type);
CREATE INDEX idx_payments_recurring_subscription
  ON payments(recurring_subscription_id)
  WHERE recurring_subscription_id IS NOT NULL;

-- Payment status monotonicity guard.
-- Enforces: pending → succeeded|failed|canceled; succeeded → refunded.
-- Same-status no-ops are allowed (idempotent Stripe webhook redelivery).
-- Kept in the DB because webhook handler, admin tools, and refund worker all
-- mutate payments.status independently; the DB guard is the last line of
-- defence against silent backward transitions.
CREATE TRIGGER trg_payments_status_monotonicity
BEFORE UPDATE OF status ON payments
BEGIN
  SELECT CASE
    WHEN OLD.status = NEW.status THEN NULL
    WHEN OLD.status = 'pending'
      AND NEW.status IN ('succeeded','failed','canceled') THEN NULL
    WHEN OLD.status = 'succeeded'
      AND NEW.status = 'refunded' THEN NULL
    ELSE RAISE(ABORT,
      'payments.status transition not permitted; see allowed state machine in data model')
  END;
END;

-- ---------------------------------------------------------------------------
-- PAYMENT STATUS TRANSITIONS
-- Append-only audit ledger of every payment status change.
-- UPDATE and DELETE are blocked by triggers.
-- The application MUST insert a transition row in the same transaction as every
-- payments.status change (see APP-003).
-- ---------------------------------------------------------------------------

CREATE TABLE payment_status_transitions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  payment_id TEXT NOT NULL REFERENCES payments(id),

  stripe_event_id          TEXT REFERENCES stripe_events(event_id),
  stripe_payment_intent_id TEXT,
  stripe_invoice_id        TEXT,
  stripe_subscription_id   TEXT,

  event_type TEXT NOT NULL,

  from_status TEXT
    CHECK (from_status IN ('pending','succeeded','failed','canceled','refunded')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('pending','succeeded','failed','canceled','refunded')),
  transition_at        TEXT NOT NULL,
  transition_reason_text TEXT,

  correlation_key TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TRIGGER trg_payment_transitions_no_update
BEFORE UPDATE ON payment_status_transitions
BEGIN
  SELECT RAISE(ABORT,
    'payment_status_transitions is append-only: UPDATE not permitted');
END;

CREATE TRIGGER trg_payment_transitions_no_delete
BEFORE DELETE ON payment_status_transitions
BEGIN
  SELECT RAISE(ABORT,
    'payment_status_transitions is append-only: DELETE not permitted');
END;

CREATE INDEX idx_payment_transitions_payment
  ON payment_status_transitions(payment_id, transition_at);
CREATE INDEX idx_payment_transitions_stripe_event
  ON payment_status_transitions(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
CREATE INDEX idx_payment_transitions_intent
  ON payment_status_transitions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payment_transitions_invoice
  ON payment_status_transitions(stripe_invoice_id, stripe_subscription_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- Payment reconciliation flags raised when a Stripe event cannot be matched
-- to an expected payment record. Tracks outstanding and resolved discrepancies
-- for admin review. expires_at is computed at INSERT (created_at + reconciliation_expiry_days);
-- resolved rows are purged by cleanup job after expiry.
CREATE TABLE reconciliation_issues (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  issue_type               TEXT NOT NULL,
  payment_id               TEXT REFERENCES payments(id),
  stripe_payment_intent_id TEXT,
  stripe_subscription_id   TEXT,
  status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding','resolved')),
  details_json             TEXT NOT NULL DEFAULT '{}',
  resolved_at              TEXT,
  resolved_by_member_id    TEXT REFERENCES members(id),
  resolution_notes         TEXT,
  expires_at               TEXT
);

CREATE INDEX idx_recon_status ON reconciliation_issues(status);

-- =============================================================================
-- SECTION 11: MEMBERSHIP PRICING (stored in system_config)
-- =============================================================================
-- Membership pricing is stored as config keys in system_config:
--   tier1_lifetime_price_cents   (integer cents, e.g., 1000 = $10.00)
--   tier2_annual_price_cents     (integer cents, e.g., 2500 = $25.00)
--   tier2_lifetime_price_cents   (integer cents, e.g., 15000 = $150.00)
-- Values are stored as integer cents consistent with all payment tables.
-- UI layers convert cents to USD for display.
-- Like all config, pricing is changed by inserting a new row with a new
-- effective_start_at. Past rows are immutable.

-- =============================================================================
-- SECTION 12: MEMBER TIER GRANTS
-- =============================================================================
-- Append-only ledger of all membership tier changes (grants, extensions, revocations,
-- expirations). Each row is a full before/after snapshot: old_* columns capture
-- state before the change; new_* columns capture state after. The view
-- member_tier_current reads the latest row's new_* values as the authoritative
-- current tier. UPDATE and DELETE are blocked by triggers.
--
-- change_type values:
--   grant  — new tier awarded (purchase, vouch, admin override, board flag, HoF/BAP grant)
--   extend — annual tier expiry extended
--   revoke — tier removed by admin
--   expire — system-detected tier expiry
--
-- No 'reinstate' change_type: there is no reinstatement flow.
-- Admin error correction and board-flag reversion use 'grant' + reason_code 'admin.override'.
-- Refunds do not alter tier (completed payments are not retroactively altered).
--
-- Source linkage (all nullable): the combination of non-null FKs encodes the pathway.
-- At most one source FK may be non-NULL (enforced by CHECK).
--   related_payment_id IS NOT NULL                              → purchase-origin
--   related_vouch_request_id IS NOT NULL                       → admin-approved vouch (Pathway B)
--   related_event_id IS NOT NULL, vouch_request_id IS NULL     → direct roster vouch (Pathway A)
--   all NULL                                                   → admin override or system-driven
--
-- Source FKs for vouch/event origin are only valid on positive application rows.
-- revoke and expire rows always have NULL for related_vouch_request_id and
-- related_event_id (DB-enforced by CHECK; app convention must match).
--
-- reason_code is a namespaced free-text vocabulary (no DB CHECK — extensible without
-- migration). Documented values: 'purchase.dues', 'vouch.direct', 'vouch.admin',
-- 'admin.override', 'admin.hof_bap_grant', 'board.flag_set', 'board.flag_removed',
-- 'system.tier_expired', 'system.tier2_fallback'.
--   system.tier_expired   — Tier 1 Annual expired → tier0
--   system.tier2_fallback — Tier 2 Annual expired → tier1_lifetime
--   admin.hof_bap_grant   — HoF/BAP badge assigned → tier2_lifetime auto-upgrade
--   board.flag_removed    — Board flag removed → revert to fallback paid tier (change_type='grant')
--
-- UPDATE and DELETE are blocked by triggers.

CREATE TABLE member_tier_grants (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,

  member_id       TEXT NOT NULL REFERENCES members(id),
  actor_member_id TEXT REFERENCES members(id),

  change_type TEXT NOT NULL
    CHECK (change_type IN ('grant','extend','revoke','expire')),

  old_tier_status          TEXT,
  old_tier_expires_at      TEXT,
  old_fallback_tier_status TEXT,
  new_tier_status          TEXT NOT NULL,
  new_tier_expires_at      TEXT,
  new_fallback_tier_status TEXT,

  reason_code TEXT NOT NULL,
  reason_text TEXT,

  related_payment_id       TEXT REFERENCES payments(id),
  related_vouch_request_id TEXT REFERENCES tier1_vouch_requests(id),
  related_event_id         TEXT REFERENCES events(id),

  -- At most one source FK may be non-NULL (structural provenance guard;
  -- app is primary validator of pathway consistency).
  CHECK (
    (CASE WHEN related_payment_id       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN related_vouch_request_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN related_event_id         IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  ),
  -- Source FKs for vouch/event origin are only valid on positive application rows.
  -- revoke and expire rows are admin/system actions with no originating source FK.
  CHECK (
    change_type IN ('grant','extend')
    OR (related_vouch_request_id IS NULL AND related_event_id IS NULL)
  )
);

CREATE TRIGGER trg_tier_grants_no_update
BEFORE UPDATE ON member_tier_grants
BEGIN
  SELECT RAISE(ABORT,
    'member_tier_grants is append-only: UPDATE not permitted');
END;

CREATE TRIGGER trg_tier_grants_no_delete
BEFORE DELETE ON member_tier_grants
BEGIN
  SELECT RAISE(ABORT,
    'member_tier_grants is append-only: DELETE not permitted');
END;

-- idx_tier_grants_member dropped (left-prefix redundant with idx_tier_grants_member_type
-- and idx_tier_grants_member_created_id, both of which lead with member_id)
CREATE INDEX idx_tier_grants_member_type
  ON member_tier_grants(member_id, change_type);
CREATE INDEX idx_tier_grants_payment
  ON member_tier_grants(related_payment_id)
  WHERE related_payment_id IS NOT NULL;
-- Safety-net idempotency guard: at most one ledger row per approved vouch request.
-- related_vouch_request_id is only ever populated on the initial application row
-- (grant or extend); revoke/expire rows never carry this FK (DB-enforced by CHECK).
-- App is the primary idempotency controller; this index is the last-line safety net.
CREATE UNIQUE INDEX ux_tier_grants_vouch_once
  ON member_tier_grants(related_vouch_request_id)
  WHERE related_vouch_request_id IS NOT NULL;
-- Safety-net idempotency guard: at most one ledger row per member-event pair.
-- related_event_id is only ever populated on the attendance/vouch application row;
-- revoke/expire rows never carry this FK (DB-enforced by CHECK).
-- Enforces the rule that a unique member may not be listed on the roster more than once.
CREATE UNIQUE INDEX ux_tier_grants_event_once
  ON member_tier_grants(member_id, related_event_id)
  WHERE related_event_id IS NOT NULL;
-- Performance: supports the latest_ledger NOT EXISTS correlated subquery in
-- member_tier_current (latest row per member lookup).
CREATE INDEX idx_tier_grants_member_created_id
  ON member_tier_grants(member_id, created_at, id);
CREATE INDEX idx_tier_grants_event
  ON member_tier_grants(related_event_id)
  WHERE related_event_id IS NOT NULL;
CREATE INDEX idx_tier_grants_created
  ON member_tier_grants(created_at);

-- =============================================================================
-- SECTION 13: MEMBER TIER CURRENT VIEW
-- =============================================================================
-- Computed view: derives the effective current tier for every member from the
-- latest member_tier_grants snapshot row, applies an in-view expiry safety
-- net for annual tiers not yet processed by the daily job, and overlays the
-- "ever paid dues → Tier 1 Lifetime" rule for all members who have completed
-- a dues payment. Includes all members; those with no ledger entry return tier0.
-- This is the authoritative read model for tier data.
--
-- Latest-row approach: reads new_tier_status / new_tier_expires_at /
-- new_fallback_tier_status from the most recent member_tier_grants row
-- (ties broken by id). Revoke and expire rows are therefore respected because
-- they become the latest row and their new_* snapshot values are authoritative.
--
-- In-view expiry safety net: if the latest row is an annual tier whose
-- new_tier_expires_at has passed (i.e., the daily SYS_Check_Tier_Expiry job
-- has not yet written an expire row), the view falls back to the stored
-- new_fallback_tier_status inline. This eliminates the up-to-24-hour gap
-- between a tier technically expiring and the batch job writing the expire row.
--
-- Purchase overlay: any member who has ever had a purchase-origin grant
-- (change_type IN ('grant','extend') AND reason_code LIKE 'purchase.%')
-- receives an implicit Tier 1 Lifetime that persists regardless of later
-- revoke/expire rows. Unconditional — no refund exception.
--
-- Output columns: member_id, tier_status, tier_expires_at, fallback_tier_status
-- Output scope: all members. Tier 1+ members are derived from the ledger; members
-- with no ledger entry are included via UNION ALL with tier_status = 'tier0'.

CREATE VIEW member_tier_current AS
WITH
dues_members AS (
  -- Members who have ever completed a dues payment (purchase-origin positive row).
  -- Intentionally historical: includes members whose latest row is a revoke.
  -- Includes 'extend' defensively: purchases should produce 'grant' rows, but
  -- including 'extend' ensures no dues-paying member is silently excluded if the
  -- app convention is ever not followed exactly.
  SELECT DISTINCT member_id
  FROM member_tier_grants
  WHERE change_type IN ('grant','extend')
    AND reason_code LIKE 'purchase.%'
),
latest_ledger AS (
  -- Most recent ledger row per member (latest created_at; id breaks ties).
  SELECT g.*
  FROM member_tier_grants g
  WHERE NOT EXISTS (
    SELECT 1
    FROM member_tier_grants g2
    WHERE g2.member_id = g.member_id
      AND (
        g2.created_at > g.created_at
        OR (g2.created_at = g.created_at AND g2.id > g.id)
      )
  )
),
latest_state AS (
  -- Resolve the effective tier from the latest snapshot, applying the
  -- in-view expiry safety net for annual tiers not yet processed by the job.
  SELECT
    l.member_id,
    l.new_tier_status,
    l.new_tier_expires_at,
    CASE
      WHEN l.new_fallback_tier_status = 'tier0' THEN NULL
      ELSE l.new_fallback_tier_status
    END AS fallback_tier_status,
    CASE
      WHEN l.new_tier_status IN ('tier1_annual','tier2_annual')
       AND l.new_tier_expires_at IS NOT NULL
       AND l.new_tier_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
      THEN CASE
        WHEN l.new_fallback_tier_status IN ('tier1_annual','tier1_lifetime','tier2_annual','tier2_lifetime')
        THEN l.new_fallback_tier_status
        ELSE 'tier0'
      END
      ELSE l.new_tier_status
    END AS effective_tier_status,
    CASE
      WHEN l.new_tier_status IN ('tier1_annual','tier2_annual')
       AND l.new_tier_expires_at IS NOT NULL
       AND l.new_tier_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
      THEN NULL
      ELSE l.new_tier_expires_at
    END AS effective_tier_expires_at
  FROM latest_ledger l
),
resolved AS (
  -- Apply purchase overlay: dues-paying members are never below tier1_lifetime.
  SELECT
    ls.member_id,
    CASE
      WHEN dm.member_id IS NOT NULL
       AND ls.effective_tier_status IN ('tier0','tier1_annual')
      THEN 'tier1_lifetime'
      ELSE ls.effective_tier_status
    END AS tier_status,
    CASE
      WHEN dm.member_id IS NOT NULL
       AND ls.effective_tier_status IN ('tier0','tier1_annual')
      THEN NULL
      ELSE ls.effective_tier_expires_at
    END AS tier_expires_at,
    COALESCE(
      ls.fallback_tier_status,
      CASE WHEN dm.member_id IS NOT NULL THEN 'tier1_lifetime' END
    ) AS fallback_tier_status
  FROM latest_state ls
  LEFT JOIN dues_members dm ON dm.member_id = ls.member_id
)
SELECT member_id, tier_status, tier_expires_at, fallback_tier_status
FROM resolved
WHERE tier_status IS NOT NULL

UNION ALL

SELECT
  m.id    AS member_id,
  'tier0' AS tier_status,
  NULL    AS tier_expires_at,
  NULL    AS fallback_tier_status
FROM members m
WHERE NOT EXISTS (
  SELECT 1 FROM resolved r WHERE r.member_id = m.id
);

-- =============================================================================
-- SECTION 14: MEMBERS & AUTHENTICATION
-- =============================================================================
-- Core member record: identity, credentials, profile, privacy controls, tier
-- cache, governance/honor flags, and GDPR PII-purge support.
--
-- password_version: session/JWT invalidation counter. INCREMENT on every
--   password reset or change. All JWTs embedding an older value are invalid.
--   NOT the same as password_hash_version (algorithm tracking only).
-- password_hash_version: hash algorithm/format version. INCREMENT only when
--   the hashing algorithm changes. MUST NOT be used for session invalidation.
-- stripe_customer_id: member-level canonical Stripe Customer identity. Set when
--   a recurring donation is first created. payments.stripe_customer_id is
--   a per-payment snapshot and is not the canonical customer ID.
--
-- login_email, login_email_normalized, password_hash, password_changed_at are
-- nullable to support GDPR/PII purge. A CHECK enforces they are non-NULL for
-- all un-purged members and NULL once personal_data_purged_at is set.
--
-- avatar_media_id: ON DELETE SET NULL ensures that deleting a media item
-- automatically detaches it as the member's avatar without requiring a trigger.

-- Member account: credentials, profile, privacy settings, governance
-- flags (is_admin, is_board, is_hof, is_bap, is_deceased), and GDPR lifecycle.
-- Soft-delete (deleted_at); PII purge nullifies credential and contact fields.
CREATE TABLE members (
  id         TEXT PRIMARY KEY,
  slug       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  deleted_by TEXT,

  login_email            TEXT,
  login_email_normalized TEXT,
  email_verified_at      TEXT,
  email_status           TEXT NOT NULL DEFAULT 'ok'
    CHECK (email_status IN ('ok','bounced','complained','suppressed')),

  password_hash         TEXT,
  password_hash_version INTEGER NOT NULL DEFAULT 1,
  password_version      INTEGER NOT NULL DEFAULT 1,
  password_changed_at   TEXT,
  last_login_at         TEXT,

  real_name               TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  display_name_normalized TEXT NOT NULL,
  bio                     TEXT NOT NULL DEFAULT '',
  city                    TEXT,
  region                  TEXT,
  country                 TEXT,
  sex                     TEXT CHECK (sex IN ('male', 'female')),
  phone                   TEXT,
  whatsapp                TEXT,

  email_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (email_visibility IN ('private','members','public')),
  searchable INTEGER NOT NULL DEFAULT 1 CHECK (searchable IN (0,1)),

  -- ON DELETE SET NULL: see section header comment.
  avatar_media_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,

  is_admin    INTEGER NOT NULL DEFAULT 0 CHECK (is_admin    IN (0,1)),
  is_board    INTEGER NOT NULL DEFAULT 0 CHECK (is_board    IN (0,1)),
  is_hof      INTEGER NOT NULL DEFAULT 0 CHECK (is_hof      IN (0,1)),
  -- Most recent Hall of Fame nomination year (nullable; application-managed).
  hof_last_nominated_year INTEGER,
  -- Hall of Fame induction year (nullable; set when is_hof becomes 1).
  hof_inducted_year       INTEGER,
  is_bap      INTEGER NOT NULL DEFAULT 0 CHECK (is_bap      IN (0,1)),
  is_deceased INTEGER NOT NULL DEFAULT 0 CHECK (is_deceased IN (0,1)),
  deceased_at   TEXT,
  deceased_note TEXT,

  stripe_customer_id TEXT,

  deletion_requested_at     TEXT,
  deletion_grace_expires_at TEXT,
  personal_data_purged_at   TEXT,

  first_competition_year INTEGER,
  show_competitive_results INTEGER NOT NULL DEFAULT 1 CHECK (show_competitive_results IN (0,1)),

  legacy_member_id TEXT,
  legacy_user_id   TEXT,
  legacy_email     TEXT,
  ifpa_join_date   TEXT,
  birth_date       TEXT,
  street_address   TEXT,
  postal_code      TEXT,
  legacy_is_admin  INTEGER NOT NULL DEFAULT 0 CHECK (legacy_is_admin IN (0,1)),

  -- Three-way credential-state invariant:
  -- (1) live account: all credential fields present, not purged
  -- (2) pre-credential imported placeholder: no credentials, not purged
  -- (3) purged row: all credential fields NULL, personal_data_purged_at set
  CHECK (
    (
      personal_data_purged_at IS NULL
      AND login_email            IS NOT NULL
      AND login_email_normalized IS NOT NULL
      AND password_hash          IS NOT NULL
      AND password_changed_at    IS NOT NULL
    )
    OR
    (
      personal_data_purged_at IS NULL
      AND login_email            IS NULL
      AND login_email_normalized IS NULL
      AND password_hash          IS NULL
      AND password_changed_at    IS NULL
    )
    OR
    (
      personal_data_purged_at IS NOT NULL
      AND login_email            IS NULL
      AND login_email_normalized IS NULL
      AND password_hash          IS NULL
      AND password_changed_at    IS NULL
    )
  )
);

CREATE UNIQUE INDEX ux_members_stripe_customer
  ON members(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX ux_members_email
  ON members(login_email_normalized)
  WHERE personal_data_purged_at IS NULL
    AND login_email_normalized IS NOT NULL;
CREATE INDEX idx_members_display_name ON members(display_name_normalized);
CREATE UNIQUE INDEX ux_members_slug
  ON members(slug)
  WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX ux_members_legacy_id
  ON members(legacy_member_id)
  WHERE legacy_member_id IS NOT NULL;
-- Provisional unique indexes for legacy migration fields; validated at test load.
-- Replace with non-unique indexes + ambiguity handling if uniqueness fails validation.
CREATE UNIQUE INDEX ux_members_legacy_email
  ON members(legacy_email)
  WHERE legacy_email IS NOT NULL;
CREATE UNIQUE INDEX ux_members_legacy_user_id
  ON members(legacy_user_id)
  WHERE legacy_user_id IS NOT NULL;

-- members_active: active rows (excludes soft-deleted accounts)
CREATE VIEW members_active AS
  SELECT * FROM members WHERE deleted_at IS NULL;

-- members_all: all rows including soft-deleted; use for admin queries
CREATE VIEW members_all AS
  SELECT * FROM members;

-- members_searchable: the ONLY view that should be queried by the member search
-- endpoint. Filters five conditions that must exclude a member from search:
-- soft-deleted, deceased, opted-out (searchable=0), PII-purged, and unverified
-- (email_verified_at IS NULL). The last condition is the primary enforcement
-- preventing imported placeholder rows from appearing in search results;
-- searchable=0 is defense-in-depth. Do not add extra WHERE clauses on top of
-- members or the bare table.
CREATE VIEW members_searchable AS
  SELECT * FROM members
  WHERE deleted_at IS NULL
    AND is_deceased = 0
    AND searchable = 1
    AND personal_data_purged_at IS NULL
    AND email_verified_at IS NOT NULL;

-- =============================================================================
-- SECTION 15: MEMBER LINKS
-- =============================================================================

-- External profile URLs for a member (e.g., personal website, social media).
-- Maximum 3 per member (application-enforced; see APP-008). URLs are validated
-- by the application before insertion.
CREATE TABLE member_links (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  member_id    TEXT NOT NULL REFERENCES members(id),
  label        TEXT NOT NULL,
  url          TEXT NOT NULL,
  validated_at TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_member_links_member ON member_links(member_id);

-- =============================================================================
-- SECTION 16: REGISTRATIONS & EVENT RESULTS
-- =============================================================================

-- Discipline selections for a competitor registration: which disciplines a
-- competitor has entered, and partner info for doubles/mixed_doubles disciplines.
-- One row per (registration, discipline) pair.
CREATE TABLE registration_discipline_selections (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  registration_id      TEXT NOT NULL REFERENCES registrations(id),
  discipline_id        TEXT NOT NULL REFERENCES event_disciplines(id),
  partner_member_id    TEXT REFERENCES members(id),
  partner_display_name TEXT,
  UNIQUE(registration_id, discipline_id)
);

CREATE INDEX idx_reg_sel_registration ON registration_discipline_selections(registration_id);
CREATE INDEX idx_reg_sel_discipline   ON registration_discipline_selections(discipline_id);

-- Metadata record for a results file uploaded to an event by an organizer.
-- Tracks who uploaded, when, and from what file. Individual placement rows
-- are in event_result_entries.
CREATE TABLE event_results_uploads (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  event_id              TEXT NOT NULL REFERENCES events(id),
  uploaded_by_member_id TEXT NOT NULL REFERENCES members(id),
  uploaded_at           TEXT NOT NULL,
  original_filename     TEXT,
  notes                 TEXT
);

CREATE INDEX idx_results_uploads_event ON event_results_uploads(event_id);

-- One placement row per (event, discipline, placement) combination.
-- discipline_id is nullable (NULL = discipline-agnostic / general ranking).
-- A partial unique index prevents duplicate general placements where discipline_id IS NULL,
-- because SQLite treats NULLs as distinct in standard UNIQUE constraints.
CREATE TABLE event_result_entries (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  event_id          TEXT NOT NULL REFERENCES events(id),
  -- NULL = discipline-agnostic (general ranking)
  discipline_id     TEXT REFERENCES event_disciplines(id),
  results_upload_id TEXT REFERENCES event_results_uploads(id),

  placement  INTEGER NOT NULL,
  score_text TEXT,

  UNIQUE(event_id, discipline_id, placement)
);

CREATE INDEX idx_result_entries_event      ON event_result_entries(event_id);
CREATE INDEX idx_result_entries_discipline ON event_result_entries(discipline_id);
-- SQLite treats NULLs as distinct in UNIQUE constraints, so
-- UNIQUE(event_id, discipline_id, placement) does not prevent duplicate
-- general placements when discipline_id IS NULL. This partial index fills that gap.
CREATE UNIQUE INDEX ux_result_entries_general_placement
  ON event_result_entries(event_id, placement)
  WHERE discipline_id IS NULL;

-- Registry of historical competitive players imported from the legacy dataset.
-- Populated by the data pipeline (08_load_mvfp_seed_full_to_sqlite.py).
-- event_count IS NULL indicates a minimal stub record auto-assigned by the pipeline.
CREATE TABLE historical_persons (
  person_id            TEXT PRIMARY KEY,
  person_name          TEXT NOT NULL,
  aliases              TEXT,
  legacy_member_id     TEXT,
  country              TEXT,
  first_year           INTEGER,
  last_year            INTEGER,
  event_count          INTEGER,
  placement_count      INTEGER,
  bap_member           INTEGER NOT NULL DEFAULT 0,
  bap_nickname         TEXT,
  bap_induction_year   INTEGER,
  hof_member         INTEGER NOT NULL DEFAULT 0,
  hof_induction_year INTEGER,
  freestyle_sequences      INTEGER,
  freestyle_max_add        REAL,
  freestyle_unique_tricks  INTEGER,
  freestyle_diversity_ratio REAL,
  signature_trick_1    TEXT,
  signature_trick_2    TEXT,
  signature_trick_3    TEXT,
  notes                TEXT,
  source               TEXT,
  source_scope         TEXT
);

-- Participants (members or named non-members) for a single result entry.
-- Supports singles (1 row) and team formats (2 rows). member_id is nullable
-- for non-platform participants; display_name is always required.
-- historical_person_id links to the legacy player registry when known.
CREATE TABLE event_result_entry_participants (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  result_entry_id      TEXT NOT NULL REFERENCES event_result_entries(id),
  participant_order    INTEGER NOT NULL,
  member_id            TEXT REFERENCES members(id),
  display_name         TEXT NOT NULL,
  historical_person_id TEXT REFERENCES historical_persons(person_id),
  UNIQUE(result_entry_id, participant_order)
);

CREATE INDEX idx_result_participants_entry  ON event_result_entry_participants(result_entry_id);
CREATE INDEX idx_result_participants_member ON event_result_entry_participants(member_id);
CREATE INDEX idx_result_participants_person ON event_result_entry_participants(historical_person_id);

-- =============================================================================
-- SECTION 17: MEDIA & GALLERIES
-- =============================================================================
-- Photos and video links uploaded by members, organized into galleries.
-- Photo binaries are stored in object storage (S3); the DB stores metadata and
-- S3 keys only. Hard-delete only for both media_items and member_galleries.
--
-- Referential cleanup on delete is handled declaratively:
--   members.avatar_media_id  REFERENCES media_items(id) ON DELETE SET NULL
--   clubs.logo_media_id      REFERENCES media_items(id) ON DELETE SET NULL
--   media_items.gallery_id   REFERENCES member_galleries(id) ON DELETE CASCADE
--
-- CASCADE on gallery_id: deleting a gallery removes all its media items.
-- Avatar photos (is_avatar=1) are never gallery-assigned, so CASCADE cannot
-- accidentally remove avatar content.
--
-- media_tags and media_flags cascade-delete on media_id.
-- gallery_external_links cascade-deletes on gallery_id.
--
-- Video cap: max 5 video embeds per named gallery (application-enforced; APP-009).

-- Photo and video media items uploaded by members. Photo fields (s3_key_thumb,
-- s3_key_display) are required for photos; video fields (video_platform, video_id,
-- video_url) are required for videos. Avatars are always photos and are never
-- gallery-assigned (enforced by CHECK constraints).
CREATE TABLE media_items (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  uploader_member_id TEXT NOT NULL REFERENCES members(id),
  -- NULL = media is not assigned to any gallery (detached or avatar-only)
  -- ON DELETE CASCADE: deleting a gallery deletes all its media items (US M_Delete_Own_Media).
  -- Avatar photos (is_avatar=1) are never gallery-assigned, so cascade cannot delete them.
  gallery_id TEXT REFERENCES member_galleries(id) ON DELETE CASCADE,

  media_type TEXT NOT NULL CHECK (media_type IN ('photo','video')),
  is_avatar  INTEGER NOT NULL DEFAULT 0 CHECK (is_avatar IN (0,1)),
  caption    TEXT,
  uploaded_at TEXT NOT NULL,

  -- Photo fields (required when media_type = 'photo')
  s3_key_thumb   TEXT,
  s3_key_display TEXT,
  width_px       INTEGER,
  height_px      INTEGER,

  -- Video fields (required when media_type = 'video')
  video_platform TEXT CHECK (video_platform IN ('youtube','vimeo')),
  video_id       TEXT,
  video_url      TEXT,
  thumbnail_url  TEXT,

  moderation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (moderation_status IN ('active','removed_by_admin')),
  moderation_reason TEXT,

  CHECK (media_type <> 'photo'
    OR (s3_key_thumb IS NOT NULL AND s3_key_display IS NOT NULL)),
  CHECK (media_type <> 'video'
    OR (video_platform IS NOT NULL AND video_id IS NOT NULL AND video_url IS NOT NULL)),
  -- Avatar integrity: avatars must be photos and cannot be gallery-assigned
  -- (enforces the cascade-safety invariant documented in DM §4.17).
  CHECK (is_avatar = 0 OR media_type = 'photo'),
  CHECK (is_avatar = 0 OR gallery_id IS NULL)
);

-- Named collections of media items owned by a member. Each member may have
-- one default gallery and any number of named galleries. Hard-delete only.
-- Deleting a gallery cascades to all its media items and external links.
CREATE TABLE member_galleries (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  owner_member_id TEXT NOT NULL REFERENCES members(id),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),

  -- Hard-delete frees the name immediately, so no partial UNIQUE needed.
  UNIQUE(owner_member_id, name)
);

-- External URLs associated with a gallery (e.g., links to off-platform albums).
-- Cascade-deleted when the parent gallery is deleted.
CREATE TABLE gallery_external_links (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  -- CASCADE: gallery hard-delete removes all its external links.
  gallery_id TEXT NOT NULL REFERENCES member_galleries(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  validated_at TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX        idx_media_uploader          ON media_items(uploader_member_id);
CREATE INDEX        idx_media_gallery           ON media_items(gallery_id) WHERE gallery_id IS NOT NULL;
CREATE INDEX        idx_media_moderation        ON media_items(moderation_status) WHERE moderation_status = 'active';
CREATE UNIQUE INDEX ux_media_avatar_per_member  ON media_items(uploader_member_id) WHERE is_avatar = 1;
CREATE UNIQUE INDEX ux_galleries_default_per_member ON member_galleries(owner_member_id) WHERE is_default = 1;
CREATE INDEX        idx_galleries_owner         ON member_galleries(owner_member_id);
CREATE INDEX        idx_gallery_links_gallery   ON gallery_external_links(gallery_id);

-- =============================================================================
-- SECTION 18: CLUBS & EVENTS — LEADERS, ORGANIZERS, ROSTER ACCESS, REGISTRATIONS
-- =============================================================================

-- Club leadership assignments: one leader and up to 4 co-leaders per club
-- (max 5 total; application-enforced). DB enforces that only one member holds
-- role='leader' per club and that a member leads at most one club.
-- Uniqueness invariants (DB-enforced):
--   ux_one_leader_per_club        → only one member may hold role='leader' per club
--   ux_one_club_leader_per_member → a member may be 'leader' of at most one club
--   ux_club_leaders               → a member appears at most once per club
-- Max-5 cap is application-enforced; the application MUST reject inserts and
-- club_id reassignments that would exceed 5 total rows per club.
CREATE TABLE club_leaders (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  club_id    TEXT NOT NULL REFERENCES clubs(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  role TEXT NOT NULL DEFAULT 'leader' CHECK (role IN ('leader','co-leader')),
  added_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_club_leaders               ON club_leaders(club_id, member_id);
-- idx_club_leaders_club dropped (left-prefix redundant with ux_club_leaders)
CREATE INDEX        idx_club_leaders_member        ON club_leaders(member_id);
CREATE UNIQUE INDEX ux_one_leader_per_club         ON club_leaders(club_id)   WHERE role = 'leader';
CREATE UNIQUE INDEX ux_one_club_leader_per_member  ON club_leaders(member_id) WHERE role = 'leader';

-- Event organizer assignments: one organizer and up to 4 co-organizers per event
-- (max 5 total; application-enforced). DB enforces that only one member holds
-- role='organizer' per event and that a member appears at most once per event.
-- Uniqueness invariants (DB-enforced):
--   ux_one_organizer_per_event  → only one member may hold role='organizer' per event
--   ux_event_organizers         → a member appears at most once per event
-- Max-5 cap is application-enforced; the application MUST reject inserts and
-- event_id reassignments that would exceed 5 total rows per event.
CREATE TABLE event_organizers (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  event_id   TEXT NOT NULL REFERENCES events(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  role TEXT NOT NULL DEFAULT 'organizer' CHECK (role IN ('organizer','co-organizer')),
  added_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_event_organizers        ON event_organizers(event_id, member_id);
-- idx_event_organizers_event dropped (left-prefix redundant with ux_event_organizers)
CREATE UNIQUE INDEX ux_one_organizer_per_event ON event_organizers(event_id) WHERE role = 'organizer';

-- Member registration for an event (competitor or attendee/supporter).
-- Tracks registration type, payment, status lifecycle, and optional attendance
-- confirmation. One registration per member per event (DB-enforced by UNIQUE index).
CREATE TABLE registrations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  event_id   TEXT NOT NULL REFERENCES events(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  registered_at  TEXT NOT NULL,
  registration_type TEXT NOT NULL
    CHECK (registration_type IN ('competitor','attendee_supporter')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','canceled','rejected')),
  tshirt_size           TEXT,
  donation_amount_cents INTEGER,
  payment_id            TEXT REFERENCES payments(id),
  attended_at           TEXT,
  attended_marked_by_member_id TEXT REFERENCES members(id)
);

CREATE UNIQUE INDEX ux_registrations
  ON registrations(event_id, member_id);
CREATE UNIQUE INDEX ux_registrations_payment
  ON registrations(payment_id)
  WHERE payment_id IS NOT NULL;
-- idx_registrations_event dropped (left-prefix redundant with ux_registrations)
CREATE INDEX idx_registrations_member   ON registrations(member_id);
CREATE INDEX idx_registrations_status   ON registrations(event_id, status);
CREATE INDEX idx_registrations_attended
  ON registrations(event_id, attended_at)
  WHERE attended_at IS NOT NULL;

-- Temporary roster-access windows granted to Tier 2+ event organizers after
-- uploading results for a sanctioned event (Pathway A vouching). expires_at is
-- set by the application at creation (granted_at + vouch_window_days config value).
-- A DB CHECK enforces that the access window is a valid positive interval.
CREATE TABLE roster_access_grants (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  event_id   TEXT NOT NULL REFERENCES events(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Enforce a valid positive access window (app sets expires_at = granted_at + config duration).
  CHECK (expires_at > granted_at)
);

CREATE UNIQUE INDEX ux_roster_access           ON roster_access_grants(event_id, member_id);
CREATE INDEX        idx_roster_access_event    ON roster_access_grants(event_id);
CREATE INDEX        idx_roster_access_member   ON roster_access_grants(member_id);
CREATE INDEX        idx_roster_access_expires  ON roster_access_grants(expires_at);

-- =============================================================================
-- SECTION 19: ACCOUNT TOKENS
-- =============================================================================

-- Short-lived security tokens for email verification, password reset, and
-- personal data export requests. Token plaintext is never persisted; only
-- the SHA-256 hash is stored. Multiple outstanding tokens per member per type
-- are allowed (single-use via used_at; validity requires used_at IS NULL AND now < expires_at).
-- A background cleanup job deletes expired or consumed tokens older than the
-- configured threshold (token_cleanup_threshold_days).
CREATE TABLE account_tokens (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  member_id  TEXT NOT NULL REFERENCES members(id),
  -- target_member_id: for account_claim tokens only; the imported placeholder row being claimed.
  -- ON DELETE CASCADE: when the imported row is deleted after a successful claim,
  -- all outstanding claim tokens pointing at it are removed automatically.
  target_member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  -- token_type maps to the token "purpose" concept.
  token_type TEXT NOT NULL
    CHECK (token_type IN ('email_verify','password_reset','data_export','account_claim')),
  token_hash         TEXT NOT NULL,
  token_hash_version INTEGER NOT NULL DEFAULT 1,
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- used_at: set when the token is consumed (single-use); NULL = not yet consumed.
  used_at    TEXT
);

-- Index strategy: a UNIQUE index on token_hash alone (globally unique per hash)
-- covers the token-validation lookup, and a separate non-unique index on
-- (member_id, token_type) covers per-member token listing. Multiple outstanding
-- tokens per member per type are allowed; the per-member index is non-unique.
CREATE INDEX        idx_account_tokens_active  ON account_tokens(member_id, token_type);
CREATE UNIQUE INDEX ux_account_tokens_hash     ON account_tokens(token_hash);
CREATE INDEX        idx_account_tokens_member  ON account_tokens(member_id);
-- Index on expires_at for background cleanup job (purges expired/consumed tokens).
CREATE INDEX        idx_account_tokens_expires ON account_tokens(expires_at);
CREATE INDEX        idx_account_tokens_target_member ON account_tokens(target_member_id)
  WHERE target_member_id IS NOT NULL;

-- =============================================================================
-- SECTION 20: MAILING LIST SUBSCRIPTIONS
-- =============================================================================

-- Member subscription status for each mailing list. One row per member per list.
-- Tracks subscription lifecycle including bounces, complaints, and suppressions.
-- Admin role changes affect admin-alerts subscription as a transactional side effect.
CREATE TABLE mailing_list_subscriptions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  mailing_list_id TEXT NOT NULL REFERENCES mailing_lists(slug),
  member_id       TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed','unsubscribed','bounced','complained','suppressed')),
  status_updated_at TEXT NOT NULL,
  bounce_detail     TEXT,
  complaint_detail  TEXT
);

CREATE UNIQUE INDEX ux_mailing_list_subscriptions ON mailing_list_subscriptions(mailing_list_id, member_id);
CREATE INDEX        idx_mls_list_status            ON mailing_list_subscriptions(mailing_list_id, status);
CREATE INDEX        idx_mls_member                 ON mailing_list_subscriptions(member_id);

-- =============================================================================
-- SECTION 21: MEDIA FLAGS & TAGS
-- =============================================================================

-- Member-submitted content reports against a media item, routed to admin for
-- review. One flag per (media, reporter) pair. Cascade-deleted when the media
-- item is hard-deleted. Resolved flags record the admin's resolution label and reason.
CREATE TABLE media_flags (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  media_id           TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  reporter_member_id TEXT NOT NULL REFERENCES members(id),
  reason_text        TEXT,
  reported_at        TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at                 TEXT,
  resolved_by_admin_member_id TEXT REFERENCES members(id),
  resolution_label            TEXT,
  resolution_reason           TEXT
);

CREATE UNIQUE INDEX ux_media_flags        ON media_flags(media_id, reporter_member_id);
-- idx_media_flags_media dropped (left-prefix redundant with ux_media_flags)
CREATE INDEX        idx_media_flags_status ON media_flags(status) WHERE status = 'open';

-- Tag applications linking a media item to a tag for discovery and organization.
-- One row per (media, tag) pair. Cascade-deleted when the media item is hard-deleted.
-- tag_display is denormalized at insert time from tags.tag_display.
CREATE TABLE media_tags (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  media_id    TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  tag_display TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_media_tags        ON media_tags(media_id, tag_id);
-- idx_media_tags_media dropped (left-prefix redundant with ux_media_tags)
CREATE INDEX        idx_media_tags_tag   ON media_tags(tag_id);

-- =============================================================================
-- SECTION 22: TAG STATS CACHE
-- =============================================================================
-- Denormalized read cache for tag discovery and browsing on the public /tags page.
-- One row per tag, tracking usage_count, distinct_member_count, and last_used_at.
-- distinct_member_count drives the "community tag" threshold (≥2 distinct members).
-- computed_at records the last recomputation. Fully recomputable from source tables;
-- a background job upserts rows. The application owns recomputation cadence.
-- Note: tag_id is the PK; no id or version column (no optimistic concurrency needed —
-- always upserted by background job).
CREATE TABLE tag_stats (
  tag_id TEXT PRIMARY KEY REFERENCES tags(id),

  usage_count           INTEGER NOT NULL DEFAULT 0,
  distinct_member_count INTEGER NOT NULL DEFAULT 0,
  last_used_at          TEXT,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

-- =============================================================================
-- SECTION 23: REQUIRED SEED DATA
-- =============================================================================
-- These INSERTs are part of schema initialization. A fresh database running
-- this file will have all mandatory defaults in place.
--
-- IMPORTANT — membership pricing defaults: the pricing key values below are placeholders
-- (values in integer cents). Update before going live by calling setConfigValue() through
-- AdminGovernanceService to insert a new row with the correct effective_start_at and values.
--
-- Seed rows use INSERT OR IGNORE, so the seed INSERT statements below are
-- idempotent when re-applied. However, the full schema file is NOT rerunnable on
-- an existing database because CREATE TABLE/VIEW/INDEX/TRIGGER statements are
-- unguarded (no IF NOT EXISTS). system_config seed IDs are stable strings (not
-- UUIDs) so INSERT OR IGNORE seed re-runs remain idempotent without UUID generation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- MAILING LISTS
-- Six core lists required for platform operation:
--   admin-alerts          : system notifications to admins; is_member_manageable=0
--   all-members           : opt-outable broadcast list; is_member_manageable=1
--   newsletter            : editorial newsletter; is_member_manageable=1
--   board-announcements   : board communications; is_member_manageable=1
--   event-notifications   : event updates; is_member_manageable=1
--   technical-updates     : platform/technical notices; is_member_manageable=1
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO mailing_lists
  (updated_at, slug, name, description, status, is_member_manageable)
VALUES
  (
   '2000-01-01T00:00:00.000Z',
   'admin-alerts', 'Admin Alerts',
   'System notifications sent to all platform administrators. Not member-manageable.',
   'active', 0
  ),

  (
   '2000-01-01T00:00:00.000Z',
   'all-members', 'All Members',
   'Platform-wide broadcast list. Members may unsubscribe.',
   'active', 1
  ),

  (
   '2000-01-01T00:00:00.000Z',
   'newsletter', 'Newsletter',
   'Editorial newsletter. Members may subscribe or unsubscribe.',
   'active', 1
  ),

  (
   '2000-01-01T00:00:00.000Z',
   'board-announcements', 'Board Announcements',
   'Communications from the board of directors. Members may subscribe or unsubscribe.',
   'active', 1
  ),

  (
   '2000-01-01T00:00:00.000Z',
   'event-notifications', 'Event Notifications',
   'Event updates and announcements. Members may subscribe or unsubscribe.',
   'active', 1
  ),

  (
   '2000-01-01T00:00:00.000Z',
   'technical-updates', 'Technical Updates',
   'Platform and technical notices. Members may subscribe or unsubscribe.',
   'active', 1
  );

-- ---------------------------------------------------------------------------
-- SYSTEM CONFIG
-- All operational defaults and pricing. One row per config key, using the
-- platform-epoch effective_start_at of '2000-01-01T00:00:00.000Z'.
-- changed_by_member_id is NULL for all system-seeded rows (no admin actor at init).
-- Seed INSERTs below are idempotent via INSERT OR IGNORE on stable string IDs; the full schema file is not rerunnable on an existing DB.
--
-- Key reference:
--   vouch_window_days               Pathway A roster-access window after results upload
--   ballot_retention_days           Ballot retention window before policy cleanup allowed
--   audit_retention_days            Audit log retention window
--   reconciliation_expiry_days      Resolved reconciliation issue TTL
--   email_sending_paused            0=sending active, 1=paused (admin toggle)
--   tier_expiry_grace_days          Grace days before tier-expiry job fires after expires_at
--   event_registration_reminder_days Days before event start to send registration reminder
--   member_cleanup_grace_days       Grace days after soft-delete before PII purge job runs
--   payment_retention_days          Payment record compliance retention window
--   password_reset_expiry_hours     Password reset token TTL (hours)
--   email_verify_expiry_hours       Email verification token TTL (hours)
--   tier_expiry_reminder_days_1     First tier-expiry reminder offset (days before expiry)
--   tier_expiry_reminder_days_2     Second tier-expiry reminder offset (days before expiry)
--   outbox_max_retry_attempts       Max email retries before dead-letter queue
--   outbox_poll_interval_minutes    Outbox worker polling interval (minutes)
--   token_cleanup_threshold_days    Age threshold (days) for expired/consumed token cleanup
--   deceased_cleanup_grace_days     Grace period (days) before PII removal after marked deceased
--   data_export_link_expiry_hours   Hours before a data export download link expires
--   account_claim_expiry_hours      Legacy account claim token TTL (hours)
--   login_rate_limit_max_attempts   Max failed login attempts before account lockout
--   login_rate_limit_window_minutes Sliding window (minutes) for failed login counting
--   login_cooldown_minutes          Lockout duration (minutes) after rate-limit exceeded
--   password_reset_rate_limit_max_attempts  Max password reset requests per window
--   password_reset_rate_limit_window_minutes Window for password reset rate limiting
--   jwt_expiry_hours                Main site session JWT lifetime (hours)
--   photo_upload_rate_limit_per_hour Max photo uploads per member per hour
--   video_submission_rate_limit_per_hour Max video submissions per member per hour
--   media_flag_rate_limit_per_hour  Max media flags per member per hour
--   reconciliation_summary_interval_days Cadence for reconciliation digest email
--   primary_snapshot_version_days   S3 versioning retention for primary bucket
--   cross_region_backup_retention_days Object Lock retention for DR bucket
--   continuous_backup_interval_minutes Interval between SQLite backup runs
-- Pricing keys:
--   tier1_lifetime_price_cents      Tier 1 Lifetime dues (integer cents; $10.00 = 1000)
--   tier2_annual_price_cents        Tier 2 Annual dues (integer cents; $25.00 = 2500)
--   tier2_lifetime_price_cents      Tier 2 Lifetime dues (integer cents; $150.00 = 15000)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO system_config
  (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
VALUES
  (
   'seed-vouch-window-days',
   '2000-01-01T00:00:00.000Z',
   'vouch_window_days', '14',
   '2000-01-01T00:00:00.000Z',
   'Default Pathway A roster-access window (14 days after results upload).',
   NULL
  ),

  (
   'seed-ballot-retention-days',
   '2000-01-01T00:00:00.000Z',
   'ballot_retention_days', '2555',
   '2000-01-01T00:00:00.000Z',
   'Ballot retention window (~7 years).',
   NULL
  ),

  (
   'seed-audit-retention-days',
   '2000-01-01T00:00:00.000Z',
   'audit_retention_days', '2555',
   '2000-01-01T00:00:00.000Z',
   'Audit log retention window (~7 years).',
   NULL
  ),

  (
   'seed-reconciliation-expiry-days',
   '2000-01-01T00:00:00.000Z',
   'reconciliation_expiry_days', '90',
   '2000-01-01T00:00:00.000Z',
   'Resolved reconciliation issues expire after 90 days.',
   NULL
  ),

  (
   'seed-email-sending-paused',
   '2000-01-01T00:00:00.000Z',
   'email_sending_paused', '0',
   '2000-01-01T00:00:00.000Z',
   'Email sending active by default. Set to 1 to pause all outbound email.',
   NULL
  ),

  (
   'seed-tier-expiry-grace-days',
   '2000-01-01T00:00:00.000Z',
   'tier_expiry_grace_days', '0',
   '2000-01-01T00:00:00.000Z',
   'Grace period before tier-expiry job fires after expires_at (0 = immediate).',
   NULL
  ),

  (
   'seed-event-registration-reminder-days',
   '2000-01-01T00:00:00.000Z',
   'event_registration_reminder_days', '7',
   '2000-01-01T00:00:00.000Z',
   'Days before event start to send registration reminder email (default: 7 days).',
   NULL
  ),

  (
   'seed-member-cleanup-grace-days',
   '2000-01-01T00:00:00.000Z',
   'member_cleanup_grace_days', '90',
   '2000-01-01T00:00:00.000Z',
   'Grace period (days) before PII purge runs after member soft-delete (default: 90 days).',
   NULL
  ),

  (
   'seed-payment-retention-days',
   '2000-01-01T00:00:00.000Z',
   'payment_retention_days', '2555',
   '2000-01-01T00:00:00.000Z',
   'Payment record compliance retention window (~7 years).',
   NULL
  ),

  (
   'seed-password-reset-expiry-hours',
   '2000-01-01T00:00:00.000Z',
   'password_reset_expiry_hours', '1',
   '2000-01-01T00:00:00.000Z',
   'Password reset token TTL in hours (default: 1 hour).',
   NULL
  ),

  (
   'seed-email-verify-expiry-hours',
   '2000-01-01T00:00:00.000Z',
   'email_verify_expiry_hours', '24',
   '2000-01-01T00:00:00.000Z',
   'Email verification token TTL in hours (default: 24 hours).',
   NULL
  ),

  (
   'seed-tier-expiry-reminder-days-1',
   '2000-01-01T00:00:00.000Z',
   'tier_expiry_reminder_days_1', '30',
   '2000-01-01T00:00:00.000Z',
   'First tier-expiry reminder email offset in days before expiry (default: 30 days).',
   NULL
  ),

  (
   'seed-tier-expiry-reminder-days-2',
   '2000-01-01T00:00:00.000Z',
   'tier_expiry_reminder_days_2', '7',
   '2000-01-01T00:00:00.000Z',
   'Second tier-expiry reminder email offset in days before expiry (default: 7 days).',
   NULL
  ),

  (
   'seed-outbox-max-retry-attempts',
   '2000-01-01T00:00:00.000Z',
   'outbox_max_retry_attempts', '5',
   '2000-01-01T00:00:00.000Z',
   'Maximum email send retry attempts before moving to dead-letter queue (default: 5).',
   NULL
  ),

  (
   'seed-outbox-poll-interval-minutes',
   '2000-01-01T00:00:00.000Z',
   'outbox_poll_interval_minutes', '5',
   '2000-01-01T00:00:00.000Z',
   'Outbox worker polling interval in minutes (default: 5).',
   NULL
  ),

  (
   'seed-token-cleanup-threshold-days',
   '2000-01-01T00:00:00.000Z',
   'token_cleanup_threshold_days', '7',
   '2000-01-01T00:00:00.000Z',
   'Age threshold in days for cleanup job to purge expired or consumed account tokens (default: 7).',
   NULL
  ),

  (
   'seed-deceased-cleanup-grace-days',
   '2000-01-01T00:00:00.000Z',
   'deceased_cleanup_grace_days', '30',
   '2000-01-01T00:00:00.000Z',
   'Grace period in days before PII removal runs after member is marked deceased (default: 30 days).',
   NULL
  );

-- ---------------------------------------------------------------------------
-- SYSTEM CONFIG — ADDITIONAL KEYS
-- Auth/security tokens, rate limits, backup retention.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO system_config
  (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
VALUES
  (
   'seed-data-export-link-expiry-hours',
   '2000-01-01T00:00:00.000Z',
   'data_export_link_expiry_hours', '72',
   '2000-01-01T00:00:00.000Z',
   'Hours before a personal data export download link expires (default: 72).',
   NULL
  ),

  (
   'seed-account-claim-expiry-hours',
   '2000-01-01T00:00:00.000Z',
   'account_claim_expiry_hours', '24',
   '2000-01-01T00:00:00.000Z',
   'Legacy account claim token TTL in hours (default: 24 hours).',
   NULL
  ),

  (
   'seed-login-rate-limit-max-attempts',
   '2000-01-01T00:00:00.000Z',
   'login_rate_limit_max_attempts', '10',
   '2000-01-01T00:00:00.000Z',
   'Max failed login attempts within the window before account lockout (default: 10).',
   NULL
  ),

  (
   'seed-login-rate-limit-window-minutes',
   '2000-01-01T00:00:00.000Z',
   'login_rate_limit_window_minutes', '15',
   '2000-01-01T00:00:00.000Z',
   'Sliding window in minutes for counting failed login attempts (default: 15).',
   NULL
  ),

  (
   'seed-login-cooldown-minutes',
   '2000-01-01T00:00:00.000Z',
   'login_cooldown_minutes', '30',
   '2000-01-01T00:00:00.000Z',
   'Lockout duration in minutes after login rate-limit threshold exceeded (default: 30).',
   NULL
  ),

  (
   'seed-password-reset-rate-limit-max-attempts',
   '2000-01-01T00:00:00.000Z',
   'password_reset_rate_limit_max_attempts', '5',
   '2000-01-01T00:00:00.000Z',
   'Max password reset requests per email per window before silent rate-limiting (default: 5).',
   NULL
  ),

  (
   'seed-password-reset-rate-limit-window-minutes',
   '2000-01-01T00:00:00.000Z',
   'password_reset_rate_limit_window_minutes', '60',
   '2000-01-01T00:00:00.000Z',
   'Sliding window in minutes for counting password reset requests per email (default: 60).',
   NULL
  ),

  (
   'seed-jwt-expiry-hours',
   '2000-01-01T00:00:00.000Z',
   'jwt_expiry_hours', '24',
   '2000-01-01T00:00:00.000Z',
   'Main site session JWT lifetime in hours; also governs legacy archive access expiry (default: 24).',
   NULL
  ),

  (
   'seed-photo-upload-rate-limit-per-hour',
   '2000-01-01T00:00:00.000Z',
   'photo_upload_rate_limit_per_hour', '10',
   '2000-01-01T00:00:00.000Z',
   'Max photo uploads per member per hour (default: 10).',
   NULL
  ),

  (
   'seed-video-submission-rate-limit-per-hour',
   '2000-01-01T00:00:00.000Z',
   'video_submission_rate_limit_per_hour', '5',
   '2000-01-01T00:00:00.000Z',
   'Max video link submissions per member per hour (default: 5).',
   NULL
  ),

  (
   'seed-media-flag-rate-limit-per-hour',
   '2000-01-01T00:00:00.000Z',
   'media_flag_rate_limit_per_hour', '10',
   '2000-01-01T00:00:00.000Z',
   'Max media flags per member per hour (admin-configurable; default: 10).',
   NULL
  ),

  (
   'seed-reconciliation-summary-interval-days',
   '2000-01-01T00:00:00.000Z',
   'reconciliation_summary_interval_days', '7',
   '2000-01-01T00:00:00.000Z',
   'Cadence in days for automated reconciliation digest email to admins (default: 7).',
   NULL
  ),

  (
   'seed-primary-snapshot-version-days',
   '2000-01-01T00:00:00.000Z',
   'primary_snapshot_version_days', '30',
   '2000-01-01T00:00:00.000Z',
   'S3 versioning retention window in days for primary backup bucket (default: 30).',
   NULL
  ),

  (
   'seed-cross-region-backup-retention-days',
   '2000-01-01T00:00:00.000Z',
   'cross_region_backup_retention_days', '90',
   '2000-01-01T00:00:00.000Z',
   'Object Lock retention window in days for cross-region disaster-recovery S3 bucket (default: 90).',
   NULL
  ),

  (
   'seed-continuous-backup-interval-minutes',
   '2000-01-01T00:00:00.000Z',
   'continuous_backup_interval_minutes', '5',
   '2000-01-01T00:00:00.000Z',
   'Interval in minutes between continuous SQLite backup runs (default: 5).',
   NULL
  );

-- ---------------------------------------------------------------------------
-- SYSTEM CONFIG — MEMBERSHIP PRICING KEYS
-- Stored as integer cents consistent with all payment tables.
-- IMPORTANT: Values below are IFPA defaults; update before launch by calling
-- setConfigValue() through AdminGovernanceService with appropriate effective_start_at.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO system_config
  (id, created_at, config_key, value_json, effective_start_at, reason_text, changed_by_member_id)
VALUES
  (
   'seed-tier1-lifetime-price',
   '2000-01-01T00:00:00.000Z',
   'tier1_lifetime_price_cents', '1000',
   '2000-01-01T00:00:00.000Z',
   'Tier 1 Lifetime dues: $10.00 USD (IFPA default; stored as integer cents). Update before launch.',
   NULL
  ),

  (
   'seed-tier2-annual-price',
   '2000-01-01T00:00:00.000Z',
   'tier2_annual_price_cents', '2500',
   '2000-01-01T00:00:00.000Z',
   'Tier 2 Annual dues: $25.00 USD (IFPA default; stored as integer cents). Update before launch.',
   NULL
  ),

  (
   'seed-tier2-lifetime-price',
   '2000-01-01T00:00:00.000Z',
   'tier2_lifetime_price_cents', '15000',
   '2000-01-01T00:00:00.000Z',
   'Tier 2 Lifetime dues: $150.00 USD (IFPA default; stored as integer cents). Update before launch.',
   NULL
  );

-- =============================================================================
-- SECTION 25: LEGACY DATA MIGRATION TABLES
-- =============================================================================

-- Permanent operational table: live club membership for members.
-- Written at legacy claim time, by admin, or by member self-service. Never dropped.
CREATE TABLE member_club_affiliations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  member_id  TEXT NOT NULL REFERENCES members(id),
  club_id    TEXT NOT NULL REFERENCES clubs(id),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  is_contact INTEGER NOT NULL DEFAULT 0 CHECK (is_contact IN (0,1)),
  source     TEXT NOT NULL DEFAULT 'legacy_claim'
    CHECK (source IN ('legacy_claim','admin','member_self_service')),

  UNIQUE(member_id, club_id)
);

CREATE INDEX idx_member_club_affiliations_member ON member_club_affiliations(member_id);
CREATE INDEX idx_member_club_affiliations_club   ON member_club_affiliations(club_id);
-- One-current-club invariant: at most one is_current=1 row per member.
CREATE UNIQUE INDEX ux_member_club_affiliations_one_current
  ON member_club_affiliations(member_id)
  WHERE is_current = 1;

-- Migration-only staging table: normalized mirror-derived club identities.
-- May be dropped once all bootstrap decisions are finalized and no staging review is pending.
CREATE TABLE legacy_club_candidates (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  legacy_club_key  TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  city             TEXT,
  region           TEXT,
  country          TEXT,
  confidence_score REAL,
  mapped_club_id   TEXT REFERENCES clubs(id),
  bootstrap_eligible INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_eligible IN (0,1))
);

CREATE UNIQUE INDEX ux_legacy_club_candidates_key
  ON legacy_club_candidates(legacy_club_key);
CREATE INDEX idx_legacy_club_candidates_mapped
  ON legacy_club_candidates(mapped_club_id)
  WHERE mapped_club_id IS NOT NULL;

-- Migration-only staging table: mirror-derived scored person-to-club affiliation suggestions.
-- At least one of historical_person_id or legacy_member_id must be non-NULL.
-- Uniqueness enforced via two partial indexes (not a single UNIQUE) because SQLite
-- treats NULLs as distinct in UNIQUE constraints, which would allow duplicate rows
-- when historical_person_id IS NULL.
-- May be dropped once all affiliation suggestions are resolved.
CREATE TABLE legacy_person_club_affiliations (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  historical_person_id     TEXT REFERENCES historical_persons(person_id),
  legacy_member_id         TEXT,
  legacy_club_candidate_id TEXT NOT NULL REFERENCES legacy_club_candidates(id),
  inferred_role            TEXT NOT NULL
    CHECK (inferred_role IN ('member','contact','leader','co-leader')),
  confidence_score         REAL,
  resolution_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN (
      'pending','confirmed_current','former_only','not_mine',
      'needs_review','promoted','rejected','superseded'
    )),
  resolved_club_id TEXT REFERENCES clubs(id),
  display_name     TEXT,
  notes            TEXT,

  CHECK(historical_person_id IS NOT NULL OR legacy_member_id IS NOT NULL)
);

CREATE INDEX idx_legacy_person_club_affiliations_member
  ON legacy_person_club_affiliations(legacy_member_id)
  WHERE legacy_member_id IS NOT NULL;
CREATE INDEX idx_legacy_person_club_affiliations_person
  ON legacy_person_club_affiliations(historical_person_id)
  WHERE historical_person_id IS NOT NULL;
CREATE INDEX idx_legacy_person_club_affiliations_resolution
  ON legacy_person_club_affiliations(resolution_status);
-- Uniqueness by historical_person_id when known.
CREATE UNIQUE INDEX ux_lpca_by_person
  ON legacy_person_club_affiliations(historical_person_id, legacy_club_candidate_id, inferred_role)
  WHERE historical_person_id IS NOT NULL;
-- Uniqueness by legacy_member_id when historical_person_id is absent.
CREATE UNIQUE INDEX ux_lpca_by_member
  ON legacy_person_club_affiliations(legacy_member_id, legacy_club_candidate_id, inferred_role)
  WHERE legacy_member_id IS NOT NULL AND historical_person_id IS NULL;

-- Operational table (migration-origin): provisional legacy leadership for bootstrapped clubs.
-- Does not grant live club-management permissions.
-- legacy_member_id is NOT NULL: it is the stable identifier that survives deletion of the
-- imported placeholder row after a successful claim.
-- imported_member_id is ON DELETE SET NULL for the same reason.
-- May be dropped only after all rows reach a terminal state (claimed, superseded, rejected).
CREATE TABLE club_bootstrap_leaders (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,

  club_id            TEXT NOT NULL REFERENCES clubs(id),
  imported_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  claimed_member_id  TEXT REFERENCES members(id),
  legacy_member_id   TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('leader','co-leader')),
  confidence_score   REAL,
  status             TEXT NOT NULL DEFAULT 'provisional'
    CHECK (status IN ('provisional','claimed','superseded','rejected')),
  claim_confirmed_at TEXT,
  notes              TEXT,

  UNIQUE(club_id, legacy_member_id, role)
);

CREATE INDEX idx_club_bootstrap_leaders_club   ON club_bootstrap_leaders(club_id);
CREATE INDEX idx_club_bootstrap_leaders_member ON club_bootstrap_leaders(imported_member_id);
CREATE INDEX idx_club_bootstrap_leaders_status ON club_bootstrap_leaders(status);

-- =============================================================================
-- FREESTYLE DOMAIN LAYER
-- Additive tables. No existing tables are modified.
-- Canonical results remain authoritative for placements.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- freestyle_records
--
-- Verified or probable per-trick best performances, sourced from the passback
-- records pipeline. Each row is a current record for a specific trick.
--
-- record_type values (passback source):
--   trick_consecutive       — best consecutive completions of the trick
--   trick_consecutive_dex   — best consecutive completions, dex variant
--   trick_consecutive_juggle — best consecutive juggle variant
--
-- confidence → public visibility:
--   verified    — fully public
--   probable    — visible with disclaimer (passback 'medium' maps here)
--   provisional — not surfaced publicly (passback 'low' maps here)
--   disputed    — not surfaced publicly
--
-- person_id is nullable: unresolved players use display_name only.
-- CHECK enforces at least one of person_id or display_name is present.
-- ---------------------------------------------------------------------------
CREATE TABLE freestyle_records (
  id              TEXT PRIMARY KEY,
  record_type     TEXT NOT NULL,
  person_id       TEXT REFERENCES historical_persons(person_id),
  display_name    TEXT,
  trick_name      TEXT,    -- common trick name (e.g. "Alpine Blurry Whirl")
  sort_name       TEXT,    -- canonical structured name (e.g. "Stepping Whirl (op) (ducking)")
  adds_count      INTEGER, -- number of adds on the trick; NULL if not applicable
  value_numeric   REAL,
  value_text      TEXT,
  achieved_date   TEXT,    -- ISO date YYYY-MM-DD (may be approximate; see date_precision)
  date_precision  TEXT NOT NULL DEFAULT 'day'
    CHECK (date_precision IN ('day', 'month', 'year', 'approximate')),
  source          TEXT NOT NULL,
  confidence      TEXT NOT NULL
    CHECK (confidence IN ('verified', 'probable', 'provisional', 'disputed')),
  video_url       TEXT,
  video_timecode  TEXT,    -- e.g. "1:43" timestamp within the video
  notes           TEXT,
  superseded_by   TEXT REFERENCES freestyle_records(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (person_id IS NOT NULL OR display_name IS NOT NULL)
);

CREATE INDEX idx_freestyle_records_person
  ON freestyle_records(person_id);
CREATE INDEX idx_freestyle_records_type_confidence
  ON freestyle_records(record_type, confidence);

-- =============================================================================
-- CONSECUTIVE KICKS DOMAIN LAYER
-- Additive tables. No existing tables are modified.
-- Source: legacy_data/inputs/curated/records/consecutives_records.csv
-- =============================================================================

-- ---------------------------------------------------------------------------
-- consecutive_kicks_records
--
-- WFA-sanctioned consecutive kicks records. Covers four sections:
--   Official World Records   — 12 current WFA world records with event details
--   Highest Official Scores  — elite ranked lists (20000+ clubs, timed top-10)
--   World Record Progression — full progression history per division
--   Milestone Firsts         — first player to reach milestone kick counts
--
-- sort_order is the primary key, derived from the source CSV and encodes
-- section+subsection ordering (100s=Singles 20K+, 200s=Timed, 300s=Doubles,
-- 400s=Official WR, 500s–1200s=Progression, 1300s=Milestones).
-- ---------------------------------------------------------------------------
CREATE TABLE consecutive_kicks_records (
  sort_order  INTEGER PRIMARY KEY,
  section     TEXT NOT NULL,    -- Highest Official Scores | Official World Records | World Record Progression | Milestone Firsts
  subsection  TEXT NOT NULL,
  division    TEXT NOT NULL,    -- Open Singles | Women's Singles | Open Doubles | Women's Doubles | etc.
  year        TEXT,             -- year of record (progression rows only)
  rank        INTEGER,          -- rank within subsection (ranked-list rows only)
  player_1    TEXT,
  player_2    TEXT,
  score       INTEGER,          -- kicks count (NULL for some milestone-firsts rows without score)
  note        TEXT,
  event_date  TEXT,             -- ISO or raw text from source
  event_name  TEXT,
  location    TEXT
);

CREATE INDEX idx_consecutive_kicks_section
  ON consecutive_kicks_records(section, sort_order);

-- =============================================================================
-- NET DOMAIN LAYER  (additive — canonical tables are never modified)
-- Evidence classes: canonical_only | curated_enrichment | inferred_partial | unresolved_candidate
-- STATISTICS FIREWALL: service layer enforces evidence_class = 'canonical_only' for all
--   user-facing stats. inferred_partial is never exposed in phase 1 routes.
--   DB-level guard: use net_team_appearance_canonical view instead of the table directly.
-- =============================================================================

-- Policy registry (populated by script 12, queried by service layer for disclaimers)
CREATE TABLE IF NOT EXISTS net_stat_policy (
  evidence_class      TEXT PRIMARY KEY
    CHECK (evidence_class IN ('canonical_only','curated_enrichment','inferred_partial','unresolved_candidate')),
  display_label       TEXT NOT NULL,
  may_show_public     INTEGER NOT NULL CHECK (may_show_public IN (0,1)),
  requires_disclaimer INTEGER NOT NULL CHECK (requires_disclaimer IN (0,1)),
  disclaimer_text     TEXT,
  may_use_in_stats    INTEGER NOT NULL CHECK (may_use_in_stats IN (0,1)),
  created_at          TEXT NOT NULL
);

-- Canonical group mapping for net disciplines (~50 name variants → 13 groups)
-- SAFETY: conflict_flag=1 means this discipline matched multiple patterns ambiguously.
-- These rows MUST be reviewed before their canonical_group is trusted.
-- This table never overrides canonical event_disciplines data — it only annotates gaps.
CREATE TABLE IF NOT EXISTS net_discipline_group (
  discipline_id   TEXT PRIMARY KEY REFERENCES event_disciplines(id),
  canonical_group TEXT NOT NULL,   -- open_doubles | mixed_doubles | womens_doubles |
                                   -- intermediate_doubles | novice_doubles | masters_doubles |
                                   -- other_doubles | open_singles | womens_singles |
                                   -- intermediate_singles | novice_singles | masters_singles |
                                   -- other_singles | uncategorized
  match_method    TEXT NOT NULL CHECK (match_method IN ('exact','pattern','fallback')),
  review_needed   INTEGER NOT NULL DEFAULT 0 CHECK (review_needed IN (0,1)),
  conflict_flag   INTEGER NOT NULL DEFAULT 0 CHECK (conflict_flag IN (0,1)),
                                   -- 1 = matched multiple patterns; canonical_group is best guess only
  mapped_at       TEXT NOT NULL,
  mapped_by       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_net_discipline_group_group    ON net_discipline_group(canonical_group);
CREATE INDEX IF NOT EXISTS idx_net_discipline_group_conflict ON net_discipline_group(conflict_flag);

-- Stable doubles team entity (sorted person_id pair)
-- team_id = UUID5(NAMESPACE, f"{person_id_a}|{person_id_b}")
-- NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')  ← fixed constant in script 13
-- person_id_a is always lexicographically < person_id_b  (CHECK enforced)
-- NOTE: team_instance (same pair reforming after a multi-year gap) is NOT modeled here.
--   If needed in a future phase, add a team_instance table referencing net_team.
CREATE TABLE IF NOT EXISTS net_team (
  team_id          TEXT PRIMARY KEY,
  person_id_a      TEXT NOT NULL REFERENCES historical_persons(person_id),
  person_id_b      TEXT NOT NULL REFERENCES historical_persons(person_id),
  first_year       INTEGER,
  last_year        INTEGER,
  appearance_count INTEGER NOT NULL DEFAULT 0,  -- count(distinct event_id, discipline_id), not raw entries
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (person_id_a < person_id_b),
  UNIQUE (person_id_a, person_id_b)
);
CREATE INDEX IF NOT EXISTS idx_net_team_person_a ON net_team(person_id_a);
CREATE INDEX IF NOT EXISTS idx_net_team_person_b ON net_team(person_id_b);

-- Explicit membership (2 rows per team; enables person→teams index)
CREATE TABLE IF NOT EXISTS net_team_member (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES net_team(team_id),
  person_id TEXT NOT NULL REFERENCES historical_persons(person_id),
  position  TEXT NOT NULL CHECK (position IN ('a','b')),
  UNIQUE (team_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_net_team_member_person ON net_team_member(person_id);

-- One row per (team × event_discipline); denormalized placement cache
-- appearance_count on net_team = count(distinct event_id, discipline_id) across these rows.
-- STATISTICS FIREWALL: query via net_team_appearance_canonical view, not this table directly.
CREATE TABLE IF NOT EXISTS net_team_appearance (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES net_team(team_id),
  event_id        TEXT NOT NULL REFERENCES events(id),
  discipline_id   TEXT NOT NULL REFERENCES event_disciplines(id),
  result_entry_id TEXT NOT NULL REFERENCES event_result_entries(id),
  placement       INTEGER NOT NULL,
  score_text      TEXT,
  event_year      INTEGER NOT NULL,
  evidence_class  TEXT NOT NULL DEFAULT 'canonical_only'
    CHECK (evidence_class IN ('canonical_only','curated_enrichment','inferred_partial','unresolved_candidate')),
  extracted_at    TEXT NOT NULL,
  UNIQUE (team_id, result_entry_id),
  UNIQUE (team_id, event_id, discipline_id)   -- prevents duplicate ingestion and malformed joins
);
CREATE INDEX IF NOT EXISTS idx_net_team_appearance_team  ON net_team_appearance(team_id);
CREATE INDEX IF NOT EXISTS idx_net_team_appearance_event ON net_team_appearance(event_id);
CREATE INDEX IF NOT EXISTS idx_net_team_appearance_year  ON net_team_appearance(event_year);

-- Defensive view: enforces evidence_class = 'canonical_only' at the DB layer.
-- db.ts queries MUST use this view instead of net_team_appearance directly.
-- Protects against future dev mistakes and ad-hoc SQL bypassing the service layer.
CREATE VIEW IF NOT EXISTS net_team_appearance_canonical AS
  SELECT * FROM net_team_appearance WHERE evidence_class = 'canonical_only';

-- net_relative_performance: DEFERRED. Not in phase 1.
-- Placement-derived pairwise ordering is inferred_partial evidence and cannot be
-- displayed without risk of being misread as match outcomes. Re-evaluate in phase 2 only
-- after a curator review workflow exists. Table intentionally NOT created here.

-- QC items and quarantined events for manual review
-- priority: 1=critical data conflict, 2=discipline ambiguity,
--           3=structural issue, 4=low-priority cleanup
CREATE TABLE IF NOT EXISTS net_review_queue (
  id                TEXT PRIMARY KEY,
  source_file       TEXT NOT NULL,
  item_type         TEXT NOT NULL CHECK (item_type IN ('quarantine_event','qc_issue')),
  priority          INTEGER NOT NULL DEFAULT 3
    CHECK (priority IN (1,2,3,4)),
  event_id          TEXT,
  discipline_id     TEXT,
  check_id          TEXT,
  severity          TEXT NOT NULL,
  reason_code       TEXT,
  message           TEXT NOT NULL,
  raw_context       TEXT,        -- JSON blob (opaque QC metadata — never queried structurally)
  review_stage      TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open','resolved','wont_fix','escalated')),
  resolution_notes  TEXT,
  resolved_by       TEXT,
  resolved_at       TEXT,
  imported_at       TEXT NOT NULL,
  -- Classification metadata (all nullable; populated by curator or remediation workflow)
  -- classification valid values: retag_team_type | split_merged_discipline |
  --   quarantine_non_results_block | parser_improvement | unresolved
  classification            TEXT,
  -- proposed_fix_type mirrors fix_type values in canonical_discipline_fixes.csv
  proposed_fix_type         TEXT,
  -- classification_confidence valid values: confirmed | tentative
  classification_confidence TEXT,
  -- decision_status valid values: fix_encoded | fix_active | deferred | wont_fix
  decision_status           TEXT,
  decision_notes            TEXT,
  classified_by             TEXT,
  classified_at             TEXT   -- ISO-8601 timestamp
);
CREATE INDEX IF NOT EXISTS idx_net_review_event          ON net_review_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_net_review_status         ON net_review_queue(resolution_status);
CREATE INDEX IF NOT EXISTS idx_net_review_priority       ON net_review_queue(priority);
CREATE INDEX IF NOT EXISTS idx_net_review_classification ON net_review_queue(classification);
CREATE INDEX IF NOT EXISTS idx_net_review_decision       ON net_review_queue(decision_status);

-- Phase 2 stub: raw text fragments from unstructured sources (OLD_RESULTS.txt etc.)
CREATE TABLE IF NOT EXISTS net_raw_fragment (
  id             TEXT PRIMARY KEY,
  source_file    TEXT NOT NULL,
  source_line    INTEGER,
  raw_text       TEXT NOT NULL,
  fragment_type  TEXT NOT NULL
    CHECK (fragment_type IN ('match_result','bracket_line','placement_block')),
  event_hint     TEXT,
  year_hint      INTEGER,
  parse_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending','parsed','unparseable','skipped')),
  imported_at    TEXT NOT NULL
);

-- Phase 2 stub: extracted match candidates from noise/unstructured sources.
-- Populated by script 16 (phase 2). Created now so schema is stable.
-- evidence_class is always 'unresolved_candidate' until manually curated.
-- Extraction guard: a candidate is only inserted when BOTH conditions hold:
--   1. Two distinct player/team names detected in the fragment
--   2. A numeric score OR explicit win/loss verb (defeated, def., bt, beat, lost to) present
CREATE TABLE IF NOT EXISTS net_candidate_match (
  candidate_id         TEXT PRIMARY KEY,
  fragment_id          TEXT REFERENCES net_raw_fragment(id),
  event_id             TEXT,                        -- nullable: linked after disambiguation
  discipline_id        TEXT,                        -- nullable: linked after disambiguation
  player_a_raw_name    TEXT,                        -- extracted name before person linking
  player_b_raw_name    TEXT,                        -- extracted name before person linking
  player_a_person_id   TEXT,                        -- nullable: linked after name resolution
  player_b_person_id   TEXT,                        -- nullable: for doubles
  raw_text             TEXT NOT NULL,
  extracted_score      TEXT,                        -- raw score string, not normalized
  round_hint           TEXT,                        -- 'final','semi','quarter','pool', etc.
  year_hint            INTEGER,
  confidence_score     REAL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  evidence_class       TEXT NOT NULL DEFAULT 'unresolved_candidate'
    CHECK (evidence_class = 'unresolved_candidate'),
  review_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','accepted','rejected','needs_info')),
  imported_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_net_candidate_event  ON net_candidate_match(event_id);
CREATE INDEX IF NOT EXISTS idx_net_candidate_status ON net_candidate_match(review_status);

-- Promoted / rejected candidates — full audit trail of curator decisions.
-- evidence_class is always 'curated_enrichment'.
-- UNIQUE(candidate_id) prevents double-promotion at the DB level.
-- Both approvals and rejections are stored; curated_status distinguishes them.
-- Key fields from the candidate are snapshotted here for audit continuity
-- even if the source candidate row is later modified.
CREATE TABLE IF NOT EXISTS net_curated_match (
  curated_id          TEXT PRIMARY KEY,
  candidate_id        TEXT NOT NULL REFERENCES net_candidate_match(candidate_id),
  curated_status      TEXT NOT NULL
    CHECK (curated_status IN ('approved', 'rejected')),
  evidence_class      TEXT NOT NULL DEFAULT 'curated_enrichment'
    CHECK (evidence_class = 'curated_enrichment'),
  event_id            TEXT,
  discipline_id       TEXT,
  player_a_person_id  TEXT,
  player_b_person_id  TEXT,
  extracted_score     TEXT,
  raw_text            TEXT NOT NULL,
  curator_note        TEXT,
  curated_at          TEXT NOT NULL,
  curated_by          TEXT NOT NULL,
  UNIQUE (candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_net_curated_candidate ON net_curated_match(candidate_id);
CREATE INDEX IF NOT EXISTS idx_net_curated_status    ON net_curated_match(curated_status);

-- =============================================================================
-- FREESTYLE TRICK DICTIONARY
-- Loaded by legacy_data/event_results/scripts/17_load_trick_dictionary.py
-- Source: legacy_data/inputs/noise/tricks.csv (74 tricks)
-- Keyed on slug (lowercase-hyphenated canonical name); separate from freestyle_records.
-- =============================================================================

CREATE TABLE IF NOT EXISTS freestyle_tricks (
  slug            TEXT PRIMARY KEY,                -- e.g. 'blurry-whirl'
  canonical_name  TEXT NOT NULL,                   -- e.g. 'blurry whirl'
  adds            TEXT,                            -- numeric ADD value or 'modifier'
  base_trick      TEXT,                            -- immediate base trick name (may equal canonical_name)
  trick_family    TEXT,                            -- family grouping slug (= base_trick for compounds, self for base tricks)
  category        TEXT,                            -- 'dex' | 'body' | 'set' | 'compound' | 'modifier'
  description     TEXT,                            -- from notes column in tricks.csv
  aliases_json    TEXT,                            -- JSON array of alias strings (may be '[]')
  sort_order      INTEGER NOT NULL DEFAULT 0,      -- load order from source CSV
  loaded_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freestyle_tricks_category ON freestyle_tricks(category);
CREATE INDEX IF NOT EXISTS idx_freestyle_tricks_adds     ON freestyle_tricks(adds);
CREATE INDEX IF NOT EXISTS idx_freestyle_tricks_family   ON freestyle_tricks(trick_family);

-- Modifier reference table — loaded from trick_modifiers.csv (21 rows).
-- Each modifier applies a flat ADD bonus to any base trick,
-- with a higher bonus when the base is rotational (blurry, spinning, swirling).
-- NOT a duplicate of freestyle_tricks modifier rows — this table carries the ADD rules.
CREATE TABLE IF NOT EXISTS freestyle_trick_modifiers (
  slug                  TEXT PRIMARY KEY,          -- e.g. 'blurry'
  modifier_name         TEXT NOT NULL,             -- e.g. 'blurry'
  add_bonus             INTEGER NOT NULL,          -- ADD added to non-rotational base tricks
  add_bonus_rotational  INTEGER NOT NULL,          -- ADD added to rotational base tricks (mirage, whirl, torque…)
  modifier_type         TEXT NOT NULL              -- 'body' | 'set'
    CHECK (modifier_type IN ('body', 'set')),
  notes                 TEXT,
  loaded_at             TEXT NOT NULL
);

-- Recovery alias candidates — operator-reviewed identity recovery workflow.
-- Populated from recovery signal analysis; operator marks approve/reject/defer.
-- Approved rows are exported to overrides/person_aliases.csv via pipeline script.
CREATE TABLE IF NOT EXISTS net_recovery_alias_candidate (
  id                    TEXT PRIMARY KEY,
  stub_name             TEXT NOT NULL,
  stub_person_id        TEXT NOT NULL,
  suggested_person_id   TEXT NOT NULL,
  suggested_person_name TEXT NOT NULL,
  suggestion_type       TEXT NOT NULL,     -- abbreviation | partner_cooccurrence | frequency
  confidence            TEXT NOT NULL,     -- high | medium | low
  appearance_count      INTEGER NOT NULL DEFAULT 0,
  operator_decision     TEXT,              -- approve | reject | defer
  operator_notes        TEXT,
  reviewed_by           TEXT,
  reviewed_at           TEXT,              -- ISO-8601 timestamp
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_net_recovery_decision ON net_recovery_alias_candidate(operator_decision);

-- =============================================================================
-- END OF SCHEMA v0.1
-- =============================================================================
