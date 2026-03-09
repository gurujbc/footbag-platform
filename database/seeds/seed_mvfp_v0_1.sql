-- =============================================================================
-- MVFP v0.1 Deterministic Seed Data
-- =============================================================================
-- Purpose: Local development and integration test data for the public
--          Events + Results browsing slice.
--
-- Scenarios:
--   A) event_2026_spring_classic  — upcoming published event, no results
--   B) event_2025_beaver_open     — completed event WITH results (2 disciplines)
--   C) event_2025_quiet_open      — completed event WITHOUT results
--   D) event_2026_draft_event     — draft (non-public) event — must never appear
--
-- All IDs are hardcoded so smoke tests and integration tests can reference
-- specific keys. All personal data is obviously fake.
--
-- Schema rules observed:
--   - Every table needs: created_at, created_by, updated_at, updated_by, version
--   - tags.tag_normalized must be lowercase and start with '#'
--   - events.hashtag_tag_id must reference a tags row with is_standard=1, standard_type='event'
--   - event_results_uploads.uploaded_by_member_id is NOT NULL → stub member required
--   - members requires: real_name, display_name, display_name_normalized, city, country
--     and the password CHECK: if password_hash IS NOT NULL then
--     login_email + login_email_normalized + password_changed_at must also be NOT NULL
-- =============================================================================

PRAGMA foreign_keys = ON;

-- =============================================================================
-- STUB MEMBER
-- Required only as the FK target for event_results_uploads.uploaded_by_member_id.
-- Not a real user. Member functionality is out of scope for MVFP v0.1.
-- =============================================================================

INSERT INTO members (
  id,
  login_email, login_email_normalized,
  password_hash, password_changed_at,
  real_name, display_name, display_name_normalized,
  city, country,
  created_at, created_by,
  updated_at, updated_by,
  version
) VALUES (
  'seed-member-00000001',
  'seed-admin@example.com', 'seed-admin@example.com',
  '[SEED_HASH_NOT_A_REAL_PASSWORD]', '2025-01-01T00:00:00.000Z',
  'Seed Admin', 'Seed Admin', 'seed admin',
  'Seedville', 'US',
  '2025-01-01T00:00:00.000Z', 'system',
  '2025-01-01T00:00:00.000Z', 'system',
  1
);

-- =============================================================================
-- TAGS
-- Each event needs exactly one standard event tag.
-- tag_normalized is the canonical identity key (stored with # prefix).
-- The public eventKey strips the leading # (e.g. event_2026_spring_classic).
-- =============================================================================

INSERT INTO tags (
  id, tag_normalized, tag_display,
  is_standard, standard_type,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  -- Scenario A: upcoming
  (
    'tag-00000001',
    '#event_2026_spring_classic',
    '#Event_2026_Spring_Classic',
    1, 'event',
    '2025-01-01T00:00:00.000Z', 'system',
    '2025-01-01T00:00:00.000Z', 'system', 1
  ),
  -- Scenario B: completed with results
  (
    'tag-00000002',
    '#event_2025_beaver_open',
    '#Event_2025_Beaver_Open',
    1, 'event',
    '2025-01-01T00:00:00.000Z', 'system',
    '2025-01-01T00:00:00.000Z', 'system', 1
  ),
  -- Scenario C: completed without results
  (
    'tag-00000003',
    '#event_2025_quiet_open',
    '#Event_2025_Quiet_Open',
    1, 'event',
    '2025-01-01T00:00:00.000Z', 'system',
    '2025-01-01T00:00:00.000Z', 'system', 1
  ),
  -- Scenario D: draft (non-public)
  (
    'tag-00000004',
    '#event_2026_draft_event',
    '#Event_2026_Draft_Event',
    1, 'event',
    '2025-01-01T00:00:00.000Z', 'system',
    '2025-01-01T00:00:00.000Z', 'system', 1
  );

-- =============================================================================
-- SCENARIO A: Upcoming published event — no results
-- Public route: GET /events/event_2026_spring_classic
-- Appears on: GET /events (upcoming list)
-- =============================================================================

INSERT INTO events (
  id, hashtag_tag_id,
  title, description,
  start_date, end_date,
  city, region, country,
  status, registration_status,
  published_at,
  created_at, created_by, updated_at, updated_by, version
) VALUES (
  'event-00000001', 'tag-00000001',
  '2026 Spring Classic',
  'The premier footbag event of the 2026 season. Open to all skill levels.',
  '2026-04-15', '2026-04-17',
  'Portland', 'OR', 'US',
  'published', 'open',
  '2026-01-15T00:00:00.000Z',
  '2025-12-01T00:00:00.000Z', 'system',
  '2026-01-15T00:00:00.000Z', 'system', 2
);

INSERT INTO event_disciplines (
  id, event_id,
  name, discipline_category, team_type, sort_order,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  ('disc-00000001', 'event-00000001', 'Freestyle', 'freestyle', 'singles', 1,
   '2025-12-01T00:00:00.000Z', 'system', '2025-12-01T00:00:00.000Z', 'system', 1),
  ('disc-00000002', 'event-00000001', 'Net', 'net', 'singles', 2,
   '2025-12-01T00:00:00.000Z', 'system', '2025-12-01T00:00:00.000Z', 'system', 1);

-- =============================================================================
-- SCENARIO B: Completed event WITH results
-- Public route: GET /events/event_2025_beaver_open
-- Appears on: GET /events/year/2025 (with inline results)
-- =============================================================================

INSERT INTO events (
  id, hashtag_tag_id,
  title, description,
  start_date, end_date,
  city, region, country,
  status, registration_status,
  published_at,
  created_at, created_by, updated_at, updated_by, version
) VALUES (
  'event-00000002', 'tag-00000002',
  '2025 Beaver Open',
  'Annual footbag tournament held in the Willamette Valley. Great competition and community.',
  '2025-07-10', '2025-07-12',
  'Corvallis', 'OR', 'US',
  'completed', 'closed',
  '2025-03-01T00:00:00.000Z',
  '2025-02-15T00:00:00.000Z', 'system',
  '2025-07-13T00:00:00.000Z', 'system', 3
);

INSERT INTO event_disciplines (
  id, event_id,
  name, discipline_category, team_type, sort_order,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  ('disc-00000003', 'event-00000002', 'Freestyle', 'freestyle', 'singles', 1,
   '2025-02-15T00:00:00.000Z', 'system', '2025-02-15T00:00:00.000Z', 'system', 1),
  ('disc-00000004', 'event-00000002', 'Freestyle Doubles', 'freestyle', 'doubles', 2,
   '2025-02-15T00:00:00.000Z', 'system', '2025-02-15T00:00:00.000Z', 'system', 1);

INSERT INTO event_results_uploads (
  id, event_id, uploaded_by_member_id,
  uploaded_at, original_filename,
  created_at, created_by, updated_at, updated_by, version
) VALUES (
  'upload-00000001', 'event-00000002', 'seed-member-00000001',
  '2025-07-14T12:00:00.000Z', 'beaver_open_2025_results.csv',
  '2025-07-14T12:00:00.000Z', 'system',
  '2025-07-14T12:00:00.000Z', 'system', 1
);

-- Freestyle Singles results
INSERT INTO event_result_entries (
  id, event_id, results_upload_id, discipline_id,
  placement, score_text,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  ('entry-00000001', 'event-00000002', 'upload-00000001', 'disc-00000003',
   1, '98.4', '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('entry-00000002', 'event-00000002', 'upload-00000001', 'disc-00000003',
   2, '95.1', '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('entry-00000003', 'event-00000002', 'upload-00000001', 'disc-00000003',
   3, '91.7', '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1);

INSERT INTO event_result_entry_participants (
  id, result_entry_id,
  participant_order, display_name,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  ('part-00000001', 'entry-00000001', 1, 'Alice Footbag',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('part-00000002', 'entry-00000002', 1, 'Bob Hackysack',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('part-00000003', 'entry-00000003', 1, 'Carol Shredder',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1);

-- Freestyle Doubles results
INSERT INTO event_result_entries (
  id, event_id, results_upload_id, discipline_id,
  placement,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  ('entry-00000004', 'event-00000002', 'upload-00000001', 'disc-00000004',
   1, '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('entry-00000005', 'event-00000002', 'upload-00000001', 'disc-00000004',
   2, '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1);

INSERT INTO event_result_entry_participants (
  id, result_entry_id,
  participant_order, display_name,
  created_at, created_by, updated_at, updated_by, version
) VALUES
  -- 1st place team
  ('part-00000004', 'entry-00000004', 1, 'Alice Footbag',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('part-00000005', 'entry-00000004', 2, 'Dave Juggler',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  -- 2nd place team
  ('part-00000006', 'entry-00000005', 1, 'Bob Hackysack',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1),
  ('part-00000007', 'entry-00000005', 2, 'Eve Kicker',
   '2025-07-14T12:00:00.000Z', 'system', '2025-07-14T12:00:00.000Z', 'system', 1);

-- =============================================================================
-- SCENARIO C: Completed event WITHOUT results
-- Public route: GET /events/event_2025_quiet_open
-- Appears on: GET /events/year/2025 (with "Results are not yet available." message)
-- =============================================================================

INSERT INTO events (
  id, hashtag_tag_id,
  title, description,
  start_date, end_date,
  city, region, country,
  status, registration_status,
  published_at,
  created_at, created_by, updated_at, updated_by, version
) VALUES (
  'event-00000003', 'tag-00000003',
  '2025 Quiet Open',
  'A low-key regional footbag gathering. Results were not uploaded.',
  '2025-09-05', '2025-09-07',
  'Eugene', 'OR', 'US',
  'completed', 'closed',
  '2025-06-01T00:00:00.000Z',
  '2025-05-20T00:00:00.000Z', 'system',
  '2025-09-08T00:00:00.000Z', 'system', 3
);

-- =============================================================================
-- SCENARIO D: Draft event — must NEVER appear on any public route
-- GET /events/event_2026_draft_event must return 404
-- Must not appear in GET /events (upcoming) or GET /events/year/2026
-- =============================================================================

INSERT INTO events (
  id, hashtag_tag_id,
  title, description,
  start_date, end_date,
  city, country,
  status,
  created_at, created_by, updated_at, updated_by, version
) VALUES (
  'event-00000004', 'tag-00000004',
  '2026 Draft Event',
  'This event is in draft and must not appear publicly.',
  '2026-06-01', '2026-06-03',
  'Nowhere', 'US',
  'draft',
  '2026-01-01T00:00:00.000Z', 'system',
  '2026-01-01T00:00:00.000Z', 'system', 1
);
