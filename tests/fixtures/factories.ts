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
import { signJwtLocalSync } from './signJwt';

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
  is_admin?: 0 | 1;
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
  password_version?: number;
}

export function insertMember(db: BetterSqlite3.Database, o: MemberOverrides = {}): string {
  const id      = o.id            ?? `member-test-${uid()}`;
  const slug    = o.slug          ?? `test_user_${uid()}`;
  const name    = o.real_name     ?? 'Test User';
  const display = o.display_name  ?? name;
  const purged  = o.personal_data_purged_at ?? null;

  // Two-way credential-state invariant: live OR purged. Purged => all credential fields NULL.
  const email            = purged ? null : (o.login_email ?? `test-${uid()}@example.com`);
  const emailNormalized  = email ? email.toLowerCase() : null;
  const emailVerifiedAt  = purged ? null : (o.email_verified_at !== undefined ? o.email_verified_at : TS);
  const passwordHash     = purged ? null : (o.password_hash ?? '[TEST_HASH]');
  const passwordChanged  = purged ? null : TS;

  if (o.legacy_member_id) {
    const existing = db.prepare(`SELECT 1 FROM legacy_members WHERE legacy_member_id = ?`).get(o.legacy_member_id);
    if (!existing) {
      insertLegacyMember(db, { legacy_member_id: o.legacy_member_id });
    }
  }

  db.prepare(`
    INSERT INTO members (
      id, slug,
      login_email, login_email_normalized, email_verified_at,
      password_hash, password_changed_at, password_version,
      real_name, display_name, display_name_normalized,
      bio, city, country,
      is_admin, is_hof, is_bap, is_deceased,
      searchable,
      deleted_at, personal_data_purged_at,
      show_competitive_results, legacy_member_id, first_competition_year,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id, slug,
    email, emailNormalized, emailVerifiedAt,
    passwordHash, passwordChanged, o.password_version ?? 1,
    name, display, display.toLowerCase(),
    o.bio ?? '', o.city ?? 'Testville', o.country ?? 'US',
    o.is_admin ?? 0, o.is_hof ?? 0, o.is_bap ?? 0, o.is_deceased ?? 0,
    o.searchable ?? 1,
    o.deleted_at ?? null, purged,
    o.show_competitive_results ?? 1, o.legacy_member_id ?? null, o.first_competition_year ?? null,
    TS, SYS, TS, SYS,
  );
  return id;
}

// ── Session JWT helper ──────────────────────────────────────────────────────
//
// Mints a JWT using the same LocalJwtAdapter keypair the app middleware verifies
// against. Tests that set `.set('Cookie', 'footbag_session=...')` should call
// this helper with the member's id + role + password_version.
//
// The target member row must already exist in the test DB: the middleware
// does a DB lookup and rejects unknown sub ids. Default passwordVersion=1
// matches insertMember's default.

export interface TestSessionJwtOpts {
  memberId: string;
  role?: 'admin' | 'member';
  passwordVersion?: number;
  kid?: string;
  ttlSeconds?: number;
}

export function createTestSessionJwt(opts: TestSessionJwtOpts): string {
  const keypairPath = process.env.JWT_LOCAL_KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error('JWT_LOCAL_KEYPAIR_PATH must be set (setTestEnv does this).');
  }
  return signJwtLocalSync(
    keypairPath,
    {
      sub: opts.memberId,
      role: opts.role ?? 'member',
      passwordVersion: opts.passwordVersion ?? 1,
    },
    {
      kid: opts.kid,
      ttlSeconds: opts.ttlSeconds,
    },
  );
}

// ── Legacy member (three-table design per DD §2.4) ───────────────────────────
//
// Row in legacy_members table — the imported-legacy-account entity.
// Returns the legacy_member_id (PK).
// ---------------------------------------------------------------------------
export interface LegacyMemberOverrides {
  legacy_member_id?: string;
  legacy_user_id?: string | null;
  legacy_email?: string | null;
  real_name?: string | null;
  display_name?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  street_address?: string | null;
  postal_code?: string | null;
  ifpa_join_date?: string | null;
  first_competition_year?: number | null;
  is_hof?: 0 | 1;
  is_bap?: 0 | 1;
  legacy_is_admin?: 0 | 1;
  import_source?: string | null;
  claimed_by_member_id?: string | null;
  claimed_at?: string | null;
}

export function insertLegacyMember(db: BetterSqlite3.Database, o: LegacyMemberOverrides = {}): string {
  const legacyId = o.legacy_member_id ?? `legmem-${uid()}`;
  const name     = o.real_name        ?? 'Legacy Member';
  const display  = o.display_name     ?? name;
  // Upsert: an earlier insertHistoricalPerson or insertMember may have
  // auto-created a stub legacy_members row; replace with this fuller row.
  db.prepare(`
    INSERT INTO legacy_members (
      legacy_member_id,
      legacy_user_id, legacy_email,
      real_name, display_name, display_name_normalized,
      city, region, country,
      bio, birth_date, street_address, postal_code,
      ifpa_join_date, first_competition_year,
      is_hof, is_bap, legacy_is_admin,
      import_source, imported_at,
      version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(legacy_member_id) DO UPDATE SET
      legacy_user_id = excluded.legacy_user_id,
      legacy_email = excluded.legacy_email,
      real_name = excluded.real_name,
      display_name = excluded.display_name,
      display_name_normalized = excluded.display_name_normalized,
      city = excluded.city,
      region = excluded.region,
      country = excluded.country,
      bio = excluded.bio,
      birth_date = excluded.birth_date,
      street_address = excluded.street_address,
      postal_code = excluded.postal_code,
      ifpa_join_date = excluded.ifpa_join_date,
      first_competition_year = excluded.first_competition_year,
      is_hof = excluded.is_hof,
      is_bap = excluded.is_bap,
      legacy_is_admin = excluded.legacy_is_admin,
      import_source = excluded.import_source,
      imported_at = excluded.imported_at
  `).run(
    legacyId,
    o.legacy_user_id ?? null,
    o.legacy_email ?? null,
    name,
    display,
    display.toLowerCase(),
    o.city ?? null,
    o.region ?? null,
    o.country ?? null,
    o.bio ?? null,
    o.birth_date ?? null,
    o.street_address ?? null,
    o.postal_code ?? null,
    o.ifpa_join_date ?? null,
    o.first_competition_year ?? null,
    o.is_hof ?? 0,
    o.is_bap ?? 0,
    o.legacy_is_admin ?? 0,
    o.import_source ?? 'test',
    TS,
  );
  if (o.claimed_by_member_id && o.claimed_at) {
    db.prepare(`
      UPDATE legacy_members
      SET claimed_by_member_id = ?, claimed_at = ?, version = version + 1
      WHERE legacy_member_id = ?
    `).run(o.claimed_by_member_id, o.claimed_at, legacyId);
  }
  return legacyId;
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
  source?: string | null;
  source_scope?: string;
  aliases?: string | null;
}

export function insertHistoricalPerson(db: BetterSqlite3.Database, o: HistoricalPersonOverrides = {}): string {
  const id = o.person_id ?? `person-test-${uid()}`;
  if (o.legacy_member_id) {
    const existing = db.prepare(`SELECT 1 FROM legacy_members WHERE legacy_member_id = ?`).get(o.legacy_member_id);
    if (!existing) {
      insertLegacyMember(db, { legacy_member_id: o.legacy_member_id, real_name: o.person_name });
    }
  }
  db.prepare(`
    INSERT INTO historical_persons (person_id, person_name, legacy_member_id, country, event_count, placement_count, bap_member, hof_member, source, source_scope, aliases)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.person_name     ?? 'Test Person',
    o.legacy_member_id ?? null,
    o.country         ?? 'US',
    o.event_count     ?? 0,
    o.placement_count ?? 0,
    o.bap_member      ?? 0,
    o.hof_member      ?? 0,
    o.source          ?? null,
    o.source_scope    ?? 'CANONICAL',
    o.aliases         ?? null,
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

// ── Consecutive Kicks Record ──────────────────────────────────────────────────

export interface ConsecutiveKicksRecordOverrides {
  sort_order?: number;
  section?: string;
  subsection?: string;
  division?: string;
  year?: string | null;
  rank?: number | null;
  player_1?: string | null;
  player_2?: string | null;
  score?: number | null;
  note?: string | null;
  event_date?: string | null;
  event_name?: string | null;
  location?: string | null;
}

let _sortOrderCounter = 9000;

export function insertConsecutiveKicksRecord(
  db: BetterSqlite3.Database,
  o: ConsecutiveKicksRecordOverrides = {},
): number {
  const sort_order = o.sort_order ?? ++_sortOrderCounter;
  db.prepare(`
    INSERT INTO consecutive_kicks_records
      (sort_order, section, subsection, division, year, rank,
       player_1, player_2, score, note, event_date, event_name, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sort_order,
    o.section    ?? 'Official World Records',
    o.subsection ?? 'Current Official World Records',
    o.division   ?? 'Open Singles',
    o.year       ?? null,
    o.rank       ?? null,
    o.player_1   ?? 'Test Player',
    o.player_2   ?? null,
    o.score      ?? 1000,
    o.note       ?? null,
    o.event_date ?? null,
    o.event_name ?? null,
    o.location   ?? null,
  );
  return sort_order;
}

// ── Net Team ──────────────────────────────────────────────────────────────────

export interface NetTeamOverrides {
  team_id?:          string;
  person_id_a?:      string;
  person_id_b?:      string;
  first_year?:       number | null;
  last_year?:        number | null;
  appearance_count?: number;
}

export function insertNetTeam(db: BetterSqlite3.Database, o: NetTeamOverrides = {}): string {
  const team_id   = o.team_id    ?? `net-team-${uid()}`;
  const pid_a     = o.person_id_a ?? `person-test-${uid()}`;
  const pid_b     = o.person_id_b ?? `person-test-${uid()}`;
  // Enforce CHECK (person_id_a < person_id_b) from schema
  const [sorted_a, sorted_b] = pid_a < pid_b ? [pid_a, pid_b] : [pid_b, pid_a];
  db.prepare(`
    INSERT INTO net_team
      (team_id, person_id_a, person_id_b, first_year, last_year,
       appearance_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    team_id, sorted_a, sorted_b,
    o.first_year       ?? 2010,
    o.last_year        ?? 2015,
    o.appearance_count ?? 1,
    TS, TS,
  );
  return team_id;
}

// ── Net Team Member ───────────────────────────────────────────────────────────

export interface NetTeamMemberOverrides {
  id?:        string;
  team_id:    string;
  person_id:  string;
  position?:  'a' | 'b';
}

export function insertNetTeamMember(
  db: BetterSqlite3.Database,
  o: NetTeamMemberOverrides,
): string {
  const id = o.id ?? `net-member-${uid()}`;
  db.prepare(`
    INSERT INTO net_team_member (id, team_id, person_id, position)
    VALUES (?, ?, ?, ?)
  `).run(id, o.team_id, o.person_id, o.position ?? 'a');
  return id;
}

// ── Net Team Appearance ───────────────────────────────────────────────────────

export interface NetTeamAppearanceOverrides {
  id?:              string;
  team_id:          string;
  event_id:         string;
  discipline_id:    string;
  result_entry_id?: string;
  placement?:       number;
  score_text?:      string | null;
  event_year?:      number;
  evidence_class?:  string;
}

export function insertNetTeamAppearance(
  db: BetterSqlite3.Database,
  o: NetTeamAppearanceOverrides,
): string {
  const id = o.id ?? `net-appearance-${uid()}`;
  db.prepare(`
    INSERT INTO net_team_appearance
      (id, team_id, event_id, discipline_id, result_entry_id,
       placement, score_text, event_year, evidence_class, extracted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.team_id,
    o.event_id,
    o.discipline_id,
    o.result_entry_id ?? `result-test-${uid()}`,
    o.placement       ?? 1,
    o.score_text      ?? null,
    o.event_year      ?? 2010,
    o.evidence_class  ?? 'canonical_only',
    TS,
  );
  return id;
}

// ── Net Raw Fragment ──────────────────────────────────────────────────────────

export interface NetRawFragmentOverrides {
  id?:            string;
  source_file?:   string;
  source_line?:   number | null;
  raw_text?:      string;
  fragment_type?: 'match_result' | 'bracket_line' | 'placement_block';
  event_hint?:    string | null;
  year_hint?:     number | null;
  parse_status?:  'pending' | 'parsed' | 'unparseable' | 'skipped';
}

export function insertNetRawFragment(
  db: BetterSqlite3.Database,
  o: NetRawFragmentOverrides = {},
): string {
  const id = o.id ?? `net-frag-${uid()}`;
  db.prepare(`
    INSERT INTO net_raw_fragment
      (id, source_file, source_line, raw_text, fragment_type, event_hint, year_hint, parse_status, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.source_file   ?? 'test-source.txt',
    o.source_line   ?? null,
    o.raw_text      ?? 'Doubles Net - 1st - Alice/Bob, 2nd - Carol/Dave',
    o.fragment_type ?? 'placement_block',
    o.event_hint    ?? null,
    o.year_hint     ?? null,
    o.parse_status  ?? 'pending',
    TS,
  );
  return id;
}

// ── Net Candidate Match ───────────────────────────────────────────────────────

export interface NetCandidateMatchOverrides {
  candidate_id?:       string;
  fragment_id?:        string | null;
  event_id?:           string | null;
  discipline_id?:      string | null;
  player_a_raw_name?:  string | null;
  player_b_raw_name?:  string | null;
  player_a_person_id?: string | null;
  player_b_person_id?: string | null;
  raw_text?:           string;
  extracted_score?:    string | null;
  round_hint?:         string | null;
  year_hint?:          number | null;
  confidence_score?:   number | null;
  review_status?:      'pending' | 'accepted' | 'rejected' | 'needs_info';
}

export function insertNetCandidateMatch(
  db: BetterSqlite3.Database,
  o: NetCandidateMatchOverrides = {},
): string {
  const id = o.candidate_id ?? `net-cand-${uid()}`;
  db.prepare(`
    INSERT INTO net_candidate_match
      (candidate_id, fragment_id, event_id, discipline_id,
       player_a_raw_name, player_b_raw_name,
       player_a_person_id, player_b_person_id,
       raw_text, extracted_score, round_hint, year_hint,
       confidence_score, evidence_class, review_status, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved_candidate', ?, ?)
  `).run(
    id,
    o.fragment_id        ?? null,
    o.event_id           ?? null,
    o.discipline_id      ?? null,
    o.player_a_raw_name  ?? null,
    o.player_b_raw_name  ?? null,
    o.player_a_person_id ?? null,
    o.player_b_person_id ?? null,
    o.raw_text           ?? 'Alice defeated Bob 15-10',
    o.extracted_score    ?? null,
    o.round_hint         ?? null,
    o.year_hint          ?? null,
    o.confidence_score   ?? null,
    o.review_status      ?? 'pending',
    TS,
  );
  return id;
}

// ── Net Curated Match ─────────────────────────────────────────────────────────

export interface NetCuratedMatchOverrides {
  curated_id?:          string;
  candidate_id:         string;   // required — must reference an existing net_candidate_match row
  curated_status?:      'approved' | 'rejected';
  event_id?:            string | null;
  discipline_id?:       string | null;
  player_a_person_id?:  string | null;
  player_b_person_id?:  string | null;
  extracted_score?:     string | null;
  raw_text?:            string;
  curator_note?:        string | null;
  curated_by?:          string;
}

// ── Freestyle Trick Dictionary ────────────────────────────────────────────────

export interface FreestyleTrickOverrides {
  slug?:           string;
  canonical_name?: string;
  adds?:           string | null;
  base_trick?:     string | null;
  trick_family?:   string | null;
  category?:       string | null;
  description?:    string | null;
  aliases_json?:   string;
  sort_order?:     number;
}

export function insertFreestyleTrick(
  db: BetterSqlite3.Database,
  o: FreestyleTrickOverrides = {},
): string {
  const slug = o.slug ?? `trick-${uid()}`;
  db.prepare(`
    INSERT INTO freestyle_tricks
      (slug, canonical_name, adds, base_trick, trick_family, category,
       description, aliases_json, sort_order, loaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug,
    o.canonical_name ?? slug.replace(/-/g, ' '),
    o.adds           ?? '3',
    o.base_trick     ?? null,
    o.trick_family   ?? null,
    o.category       ?? 'compound',
    o.description    ?? null,
    o.aliases_json   ?? '[]',
    o.sort_order     ?? 0,
    TS,
  );
  return slug;
}

// ── Net Review Queue Item ─────────────────────────────────────────────────────

export interface NetReviewQueueItemOverrides {
  id?:                       string;
  source_file?:              string;
  item_type?:                'quarantine_event' | 'qc_issue';
  priority?:                 1 | 2 | 3 | 4;
  event_id?:                 string | null;
  discipline_id?:            string | null;
  check_id?:                 string | null;
  severity?:                 string;
  reason_code?:              string | null;
  message?:                  string;
  raw_context?:              string | null;
  review_stage?:             string | null;
  resolution_status?:        'open' | 'resolved' | 'wont_fix' | 'escalated';
  resolution_notes?:         string | null;
  resolved_by?:              string | null;
  resolved_at?:              string | null;
  // Classification metadata
  classification?:            string | null;
  proposed_fix_type?:         string | null;
  classification_confidence?: string | null;
  decision_status?:           string | null;
  decision_notes?:            string | null;
  classified_by?:             string | null;
  classified_at?:             string | null;
}

export function insertNetReviewQueueItem(
  db: BetterSqlite3.Database,
  o: NetReviewQueueItemOverrides = {},
): string {
  const id = o.id ?? `net-review-${uid()}`;
  db.prepare(`
    INSERT INTO net_review_queue
      (id, source_file, item_type, priority, event_id, discipline_id, check_id,
       severity, reason_code, message, raw_context, review_stage,
       resolution_status, resolution_notes, resolved_by, resolved_at, imported_at,
       classification, proposed_fix_type, classification_confidence,
       decision_status, decision_notes, classified_by, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.source_file              ?? 'test',
    o.item_type                ?? 'qc_issue',
    o.priority                 ?? 3,
    o.event_id                 ?? null,
    o.discipline_id            ?? null,
    o.check_id                 ?? null,
    o.severity                 ?? 'medium',
    o.reason_code              ?? null,
    o.message                  ?? 'Test review item',
    o.raw_context              ?? null,
    o.review_stage             ?? null,
    o.resolution_status        ?? 'open',
    o.resolution_notes         ?? null,
    o.resolved_by              ?? null,
    o.resolved_at              ?? null,
    TS,
    o.classification           ?? null,
    o.proposed_fix_type        ?? null,
    o.classification_confidence ?? null,
    o.decision_status          ?? null,
    o.decision_notes           ?? null,
    o.classified_by            ?? null,
    o.classified_at            ?? null,
  );
  return id;
}

export function insertNetCuratedMatch(
  db: BetterSqlite3.Database,
  o: NetCuratedMatchOverrides,
): string {
  const id = o.curated_id ?? `net-curated-${uid()}`;
  db.prepare(`
    INSERT INTO net_curated_match
      (curated_id, candidate_id, curated_status, evidence_class,
       event_id, discipline_id, player_a_person_id, player_b_person_id,
       extracted_score, raw_text, curator_note,
       curated_at, curated_by)
    VALUES (?, ?, ?, 'curated_enrichment', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.candidate_id,
    o.curated_status      ?? 'approved',
    o.event_id            ?? null,
    o.discipline_id       ?? null,
    o.player_a_person_id  ?? null,
    o.player_b_person_id  ?? null,
    o.extracted_score     ?? null,
    o.raw_text            ?? 'Alice defeated Bob 15-10',
    o.curator_note        ?? null,
    TS,
    o.curated_by          ?? 'operator',
  );
  return id;
}

// ── Net Recovery Alias Candidate ─────────────────────────────────────────────

export interface NetRecoveryAliasCandidateOverrides {
  id?:                    string;
  stub_name?:             string;
  stub_person_id?:        string;
  suggested_person_id?:   string;
  suggested_person_name?: string;
  suggestion_type?:       string;
  confidence?:            string;
  appearance_count?:      number;
  operator_decision?:     string | null;
  operator_notes?:        string | null;
}

export function insertNetRecoveryAliasCandidate(
  db: BetterSqlite3.Database,
  o: NetRecoveryAliasCandidateOverrides = {},
): string {
  const id = o.id ?? `rc-${uid()}`;
  db.prepare(`
    INSERT INTO net_recovery_alias_candidate
      (id, stub_name, stub_person_id, suggested_person_id, suggested_person_name,
       suggestion_type, confidence, appearance_count,
       operator_decision, operator_notes, reviewed_by, reviewed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    o.stub_name             ?? 'J. Test',
    o.stub_person_id        ?? `stub-${uid()}`,
    o.suggested_person_id   ?? `known-${uid()}`,
    o.suggested_person_name ?? 'Jane Test',
    o.suggestion_type       ?? 'abbreviation',
    o.confidence            ?? 'high',
    o.appearance_count      ?? 2,
    o.operator_decision     ?? null,
    o.operator_notes        ?? null,
    o.operator_decision ? 'operator' : null,
    o.operator_decision ? TS : null,
    TS,
  );
  return id;
}
