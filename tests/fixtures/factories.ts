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
  slug?: string;
  login_email?: string;
  real_name?: string;
  display_name?: string;
  city?: string;
  country?: string;
  password_hash?: string;
  email_verified_at?: string | null;
  is_hof?: 0 | 1;
  is_bap?: 0 | 1;
  is_deceased?: 0 | 1;
  deleted_at?: string | null;
  personal_data_purged_at?: string | null;
  show_competitive_results?: 0 | 1;
  legacy_member_id?: string | null;
  first_competition_year?: number | null;
  bio?: string;
  searchable?: 0 | 1;
}

export function insertMember(db: BetterSqlite3.Database, o: MemberOverrides = {}): string {
  const id      = o.id            ?? `member-test-${uid()}`;
  const slug    = o.slug          ?? `test_user_${uid()}`;
  const name    = o.real_name     ?? 'Test User';
  const display = o.display_name  ?? name;
  const purged  = o.personal_data_purged_at ?? null;

  // Three-way credential-state invariant: when purged, all credential fields must be NULL.
  const email            = purged ? null : (o.login_email ?? `test-${uid()}@example.com`);
  const emailNormalized  = email ? email.toLowerCase() : null;
  const emailVerifiedAt  = purged ? null : (o.email_verified_at !== undefined ? o.email_verified_at : TS);
  const passwordHash     = purged ? null : (o.password_hash ?? '[TEST_HASH]');
  const passwordChanged  = purged ? null : TS;

  db.prepare(`
    INSERT INTO members (
      id, slug,
      login_email, login_email_normalized, email_verified_at,
      password_hash, password_changed_at,
      real_name, display_name, display_name_normalized,
      bio, city, country,
      is_hof, is_bap, is_deceased,
      searchable,
      deleted_at, personal_data_purged_at,
      show_competitive_results, legacy_member_id, first_competition_year,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id, slug,
    email, emailNormalized, emailVerifiedAt,
    passwordHash, passwordChanged,
    name, display, display.toLowerCase(),
    o.bio ?? '', o.city ?? 'Testville', o.country ?? 'US',
    o.is_hof ?? 0, o.is_bap ?? 0, o.is_deceased ?? 0,
    o.searchable ?? 1,
    o.deleted_at ?? null, purged,
    o.show_competitive_results ?? 1, o.legacy_member_id ?? null, o.first_competition_year ?? null,
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Imported placeholder (pre-credential legacy member) ──────────────────────

export interface ImportedPlaceholderOverrides {
  id?: string;
  display_name?: string;
  real_name?: string;
  legacy_member_id?: string;
  legacy_user_id?: string;
  legacy_email?: string;
  bio?: string;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  birth_date?: string | null;
  ifpa_join_date?: string | null;
  is_hof?: 0 | 1;
  is_bap?: 0 | 1;
}

export function insertImportedPlaceholder(db: BetterSqlite3.Database, o: ImportedPlaceholderOverrides = {}): string {
  const id      = o.id              ?? `placeholder-${uid()}`;
  const name    = o.real_name       ?? 'Legacy Player';
  const display = o.display_name    ?? name;
  db.prepare(`
    INSERT INTO members (
      id, slug,
      login_email, login_email_normalized, email_verified_at,
      password_hash, password_changed_at,
      real_name, display_name, display_name_normalized,
      legacy_member_id, legacy_user_id, legacy_email,
      bio, city, region, country,
      birth_date, ifpa_join_date,
      is_hof, is_bap,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, 'import', 1)
  `).run(
    id,
    name, display, display.toLowerCase(),
    o.legacy_member_id ?? null,
    o.legacy_user_id ?? null,
    o.legacy_email ?? null,
    o.bio ?? '',
    o.city ?? null,
    o.region ?? null,
    o.country ?? null,
    o.birth_date ?? null,
    o.ifpa_join_date ?? null,
    o.is_hof ?? 0,
    o.is_bap ?? 0,
    TS, TS,
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
  region?: string | null;
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
      city, region, country, status, registration_status, sanction_status,
      payment_enabled, currency,
      is_attendee_registration_open, is_tshirt_size_collected,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'USD', 0, 0, ?, ?, ?, ?, 1)
  `).run(
    id, tagId,
    o.title              ?? 'Test Event',
    o.description        ?? 'A test event.',
    o.start_date         ?? '2026-06-01',
    o.end_date           ?? '2026-06-03',
    o.city               ?? 'Testville',
    o.region             ?? null,
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

// ── Media item ───────────────────────────────────────────────────────────────

export interface MediaItemOverrides {
  id?: string;
  uploader_member_id: string;
  is_avatar?: 0 | 1;
  s3_key_thumb?: string;
  s3_key_display?: string;
  width_px?: number;
  height_px?: number;
}

export function insertMediaItem(db: BetterSqlite3.Database, o: MediaItemOverrides): string {
  const id = o.id ?? `media-test-${uid()}`;
  db.prepare(`
    INSERT INTO media_items (
      id, created_at, created_by, updated_at, updated_by, version,
      uploader_member_id, gallery_id, media_type, is_avatar, caption, uploaded_at,
      s3_key_thumb, s3_key_display, width_px, height_px
    ) VALUES (?, ?, 'test', ?, 'test', 1, ?, NULL, 'photo', ?, NULL, ?, ?, ?, ?, ?)
  `).run(
    id, TS, TS,
    o.uploader_member_id,
    o.is_avatar ?? 0,
    TS,
    o.s3_key_thumb   ?? `test/thumb_${id}.jpg`,
    o.s3_key_display ?? `test/display_${id}.jpg`,
    o.width_px  ?? 800,
    o.height_px ?? 600,
  );
  return id;
}

// ── Historical person ─────────────────────────────────────────────────────────

export interface HistoricalPersonOverrides {
  person_id?: string;
  person_name?: string;
  legacy_member_id?: string | null;
  country?: string;
  event_count?: number;
  placement_count?: number;
  bap_member?: 0 | 1;
  hof_member?: 0 | 1;
  source_scope?: string;
}

export function insertHistoricalPerson(db: BetterSqlite3.Database, o: HistoricalPersonOverrides = {}): string {
  const id = o.person_id ?? `person-test-${uid()}`;
  db.prepare(`
    INSERT INTO historical_persons (person_id, person_name, legacy_member_id, country, event_count, placement_count, bap_member, hof_member, source_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.person_name     ?? 'Test Person',
    o.legacy_member_id ?? null,
    o.country         ?? 'US',
    o.event_count     ?? 0,
    o.placement_count ?? 0,
    o.bap_member      ?? 0,
    o.hof_member    ?? 0,
    o.source_scope  ?? 'CANONICAL',
  );
  return id;
}

// ── Freestyle record ──────────────────────────────────────────────────────────

export interface FreestyleRecordOverrides {
  id?: string;
  record_type?: string;
  person_id?: string | null;
  display_name?: string | null;
  trick_name?: string | null;
  sort_name?: string | null;
  adds_count?: number | null;
  value_numeric?: number;
  achieved_date?: string | null;
  date_precision?: string;
  source?: string;
  confidence?: string;
  video_url?: string | null;
  video_timecode?: string | null;
  notes?: string | null;
  superseded_by?: string | null;
}

export function insertFreestyleRecord(
  db: BetterSqlite3.Database,
  o: FreestyleRecordOverrides = {},
): string {
  const id = o.id ?? `fr-test-${uid()}`;
  db.prepare(`
    INSERT INTO freestyle_records (
      id, record_type, person_id, display_name,
      trick_name, sort_name, adds_count,
      value_numeric, achieved_date, date_precision,
      source, confidence,
      video_url, video_timecode, notes,
      superseded_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.record_type    ?? 'trick_consecutive',
    o.person_id      ?? null,
    o.display_name   ?? 'Test Player',
    o.trick_name     ?? 'Test Trick',
    o.sort_name      ?? null,
    o.adds_count     ?? null,
    o.value_numeric  ?? 10,
    o.achieved_date  ?? '2024-01-01',
    o.date_precision ?? 'day',
    o.source         ?? 'passback',
    o.confidence     ?? 'probable',
    o.video_url      ?? null,
    o.video_timecode ?? null,
    o.notes          ?? null,
    o.superseded_by  ?? null,
    TS, TS,
  );
  return id;
}
