/**
 * Test data factories.
 *
 * Each factory inserts one row with sensible defaults and returns the inserted ID.
 * Pass overrides to customize only the fields you care about.
 *
 * Cleanup: the temp DB is dropped in afterAll for the whole file, so per-row
 * cleanup is only needed when a test mutates shared state that a later test reads.
 * For mutation tests, use a fresh per-test DB or wrap in a transaction and roll back.
 */
import BetterSqlite3 from 'better-sqlite3';

const TS  = '2025-01-01T00:00:00.000Z';
const SYS = 'system';

let _counter = 0;
function uid(): string {
  return (++_counter).toString().padStart(4, '0');
}

// ── Member ────────────────────────────────────────────────────────────────────

export interface MemberOverrides {
  id?: string;
  login_email?: string;
  real_name?: string;
  display_name?: string;
  city?: string;
  country?: string;
}

export function insertMember(db: BetterSqlite3.Database, o: MemberOverrides = {}): string {
  const id      = o.id            ?? `member-test-${uid()}`;
  const email   = o.login_email   ?? `test-${uid()}@example.com`;
  const name    = o.real_name     ?? 'Test User';
  const display = o.display_name  ?? name;
  db.prepare(`
    INSERT INTO members (
      id,
      login_email, login_email_normalized, email_verified_at,
      password_hash, password_changed_at,
      real_name, display_name, display_name_normalized,
      city, country,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, '[TEST_HASH]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    email, email.toLowerCase(), TS,
    TS,
    name, display, display.toLowerCase(),
    o.city ?? 'Testville', o.country ?? 'US',
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Tag ───────────────────────────────────────────────────────────────────────

export interface TagOverrides {
  id?: string;
  tag_normalized?: string;
  tag_display?: string;
  standard_type?: string;
}

export function insertTag(db: BetterSqlite3.Database, o: TagOverrides = {}): string {
  const id         = o.id             ?? `tag-test-${uid()}`;
  const normalized = o.tag_normalized ?? `#event_test_${uid()}`;
  const display    = o.tag_display    ?? normalized;
  db.prepare(`
    INSERT INTO tags (id, tag_normalized, tag_display, is_standard, standard_type, created_at, created_by, updated_at, updated_by, version)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 1)
  `).run(id, normalized, display, o.standard_type ?? 'event', TS, SYS, TS, SYS);
  return id;
}

// ── Event ─────────────────────────────────────────────────────────────────────

export interface EventOverrides {
  id?: string;
  hashtag_tag_id?: string;
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  city?: string;
  country?: string;
  status?: 'draft' | 'published' | 'completed' | 'cancelled';
  registration_status?: string;
  sanction_status?: string;
}

export function insertEvent(db: BetterSqlite3.Database, o: EventOverrides = {}): string {
  const id    = o.id             ?? `event-test-${uid()}`;
  const tagId = o.hashtag_tag_id ?? insertTag(db);
  db.prepare(`
    INSERT INTO events (
      id, hashtag_tag_id, title, description, start_date, end_date,
      city, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'USD', 0, 0, ?, ?, ?, ?, 1)
  `).run(
    id, tagId,
    o.title              ?? 'Test Event',
    o.description        ?? 'A test event.',
    o.start_date         ?? '2026-06-01',
    o.end_date           ?? '2026-06-03',
    o.city               ?? 'Testville',
    o.country            ?? 'US',
    o.status             ?? 'published',
    o.registration_status ?? 'open',
    o.sanction_status    ?? 'none',
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Event discipline ──────────────────────────────────────────────────────────

export interface DisciplineOverrides {
  id?: string;
  name?: string;
  discipline_category?: string;
  team_type?: string;
  sort_order?: number;
}

export function insertDiscipline(db: BetterSqlite3.Database, eventId: string, o: DisciplineOverrides = {}): string {
  const id = o.id ?? `disc-test-${uid()}`;
  db.prepare(`
    INSERT INTO event_disciplines (id, event_id, name, discipline_category, team_type, sort_order, created_at, created_by, updated_at, updated_by, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id, eventId,
    o.name                ?? 'Freestyle',
    o.discipline_category ?? 'freestyle',
    o.team_type           ?? 'singles',
    o.sort_order          ?? 1,
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Results upload ────────────────────────────────────────────────────────────

export function insertResultsUpload(
  db: BetterSqlite3.Database,
  eventId: string,
  memberId: string,
  o: { id?: string; filename?: string } = {},
): string {
  const id = o.id ?? `upload-test-${uid()}`;
  db.prepare(`
    INSERT INTO event_results_uploads (
      id, event_id, uploaded_by_member_id, uploaded_at,
      original_filename, created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, eventId, memberId, TS, o.filename ?? 'results.csv', TS, SYS, TS, SYS);
  return id;
}

// ── Result entry ──────────────────────────────────────────────────────────────

export function insertResultEntry(
  db: BetterSqlite3.Database,
  eventId: string,
  uploadId: string,
  disciplineId: string,
  o: { id?: string; placement?: number } = {},
): string {
  const id = o.id ?? `entry-test-${uid()}`;
  db.prepare(`
    INSERT INTO event_result_entries (id, event_id, results_upload_id, discipline_id, placement, created_at, created_by, updated_at, updated_by, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, eventId, uploadId, disciplineId, o.placement ?? 1, TS, SYS, TS, SYS);
  return id;
}

// ── Result entry participant ──────────────────────────────────────────────────

export function insertResultParticipant(
  db: BetterSqlite3.Database,
  resultEntryId: string,
  displayName: string,
  o: { id?: string; participant_order?: number; historical_person_id?: string | null } = {},
): string {
  const id = o.id ?? `part-test-${uid()}`;
  db.prepare(`
    INSERT INTO event_result_entry_participants (id, result_entry_id, participant_order, display_name, historical_person_id, created_at, created_by, updated_at, updated_by, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, resultEntryId, o.participant_order ?? 1, displayName, o.historical_person_id ?? null, TS, SYS, TS, SYS);
  return id;
}

// ── Club ──────────────────────────────────────────────────────────────────────

export interface ClubOverrides {
  id?: string;
  hashtag_tag_id?: string;
  name?: string;
  city?: string;
  region?: string | null;
  country?: string;
  external_url?: string | null;
  status?: 'active' | 'inactive' | 'archived';
}

export function insertClub(db: BetterSqlite3.Database, o: ClubOverrides = {}): string {
  const id    = o.id             ?? `club-test-${uid()}`;
  const tagId = o.hashtag_tag_id ?? insertTag(db, { standard_type: 'club', tag_normalized: `#club_test_${uid()}` });
  db.prepare(`
    INSERT INTO clubs (
      id, hashtag_tag_id, name, description, city, region, country,
      external_url, status,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id, tagId,
    o.name         ?? 'Test Club',
    o.city         ?? 'Testville',
    o.region       !== undefined ? o.region : null,
    o.country      ?? 'USA',
    o.external_url !== undefined ? o.external_url : null,
    o.status       ?? 'active',
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Legacy club candidate ─────────────────────────────────────────────────────

export interface LegacyClubCandidateOverrides {
  id?: string;
  legacy_club_key?: string;
  display_name?: string;
  mapped_club_id?: string | null;
}

export function insertLegacyClubCandidate(db: BetterSqlite3.Database, o: LegacyClubCandidateOverrides = {}): string {
  const id = o.id ?? `lcc-test-${uid()}`;
  db.prepare(`
    INSERT INTO legacy_club_candidates (
      id, legacy_club_key, display_name, mapped_club_id,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    o.legacy_club_key ?? `legacy_club_${uid()}`,
    o.display_name    ?? 'Test Club',
    o.mapped_club_id  !== undefined ? o.mapped_club_id : null,
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Legacy person–club affiliation ────────────────────────────────────────────

export interface LegacyPersonClubAffiliationOverrides {
  id?: string;
  historical_person_id?: string;
  legacy_club_candidate_id: string;
  resolution_status?: string;
  inferred_role?: string;
  display_name?: string;
}

export function insertLegacyPersonClubAffiliation(
  db: BetterSqlite3.Database,
  o: LegacyPersonClubAffiliationOverrides,
): string {
  const id = o.id ?? `lpca-test-${uid()}`;
  db.prepare(`
    INSERT INTO legacy_person_club_affiliations (
      id, historical_person_id, legacy_club_candidate_id,
      inferred_role, resolution_status, display_name,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    o.historical_person_id        ?? null,
    o.legacy_club_candidate_id,
    o.inferred_role                ?? 'member',
    o.resolution_status            ?? 'confirmed_current',
    o.display_name                 ?? null,
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Historical person ─────────────────────────────────────────────────────────

export interface HistoricalPersonOverrides {
  person_id?: string;
  person_name?: string;
  country?: string;
  event_count?: number;
  placement_count?: number;
  bap_member?: 0 | 1;
  fbhof_member?: 0 | 1;
}

export function insertHistoricalPerson(db: BetterSqlite3.Database, o: HistoricalPersonOverrides = {}): string {
  const id = o.person_id ?? `person-test-${uid()}`;
  db.prepare(`
    INSERT INTO historical_persons (person_id, person_name, country, event_count, placement_count, bap_member, fbhof_member)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.person_name     ?? 'Test Person',
    o.country         ?? 'US',
    o.event_count     ?? 0,
    o.placement_count ?? 0,
    o.bap_member      ?? 0,
    o.fbhof_member    ?? 0,
  );
  return id;
}
