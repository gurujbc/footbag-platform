import { DEFAULT_DB_FILENAME, SqliteDatabase, openDatabase } from './openDatabase';

/**
 * DATABASE MODULE
 *
 * This file owns:
 * - opening the single SQLite connection for application use at startup
 * - preparing the explicit statement groups needed by services
 * - exporting the shared transaction helper used by services
 * - providing the minimal database-readiness probe used as one readiness input
 *
 * This file does NOT own:
 * - HTTP/controller concerns
 * - request parsing or route validation
 * - business logic
 * - eventKey parsing or validation (belongs in services)
 * - result grouping or template/view shaping (belongs in services)
 * - archive page composition beyond returning flat rows
 * - readiness composition beyond the minimal DB probe
 * - backup/checkpoint orchestration
 * - a repository layer, ORM, or generic query-builder abstraction
 *
 * Currently supported route/use-case slice:
 * - GET /clubs
 * - GET /clubs/:countrySlug
 * - GET /clubs/club_:clubSlug
 * - GET /events
 * - GET /events/year/:year
 * - GET /events/:eventKey
 * - GET /history
 * - GET /history/:personId
 * - GET /members/:memberId
 * - GET /members/:memberId/edit + POST
 * - GET /health/live   (process-only; this file does not participate)
 * - GET /health/ready  (minimal DB-readiness input only)
 *
 * Architectural rules preserved here:
 * - Services call prepared statements exported by this module directly.
 * - There is no repository layer.
 * - There is no ORM.
 * - Event key parsing / validation belongs in services.
 * - Result grouping / display shaping belongs in services.
 * - Future expansion should add explicit statement groups rather than abstract
 *   frameworks or hidden data-access layers.
 */

const DB_FILENAME = process.env.FOOTBAG_DB_PATH ?? DEFAULT_DB_FILENAME;
const TRANSACTION_TIMEOUT_MS = 30_000;

const PUBLIC_EVENT_DETAIL_VISIBLE_STATUSES = [
  'published',
  'registration_full',
  'closed',
  'completed',
] as const;

const PUBLIC_UPCOMING_VISIBLE_STATUSES = [
  'published',
  'registration_full',
  'closed',
] as const;

const PUBLIC_EVENT_DETAIL_VISIBLE_STATUS_SQL = PUBLIC_EVENT_DETAIL_VISIBLE_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');

const PUBLIC_UPCOMING_VISIBLE_STATUS_SQL = PUBLIC_UPCOMING_VISIBLE_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');

const ARCHIVE_YEAR_SQL = `CAST(substr(e.start_date, 1, 4) AS INTEGER)`;

export interface PublicEventSummaryRow {
  event_id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  city: string;
  region: string | null;
  country: string;
  host_club: string | null;
  external_url: string | null;
  registration_deadline: string | null;
  capacity_limit: number | null;
  status: string;
  registration_status: string;
  published_at: string | null;
  hashtag_tag_id: string;
  tag_normalized: string;
  tag_display: string;
}

export interface PublicCompletedEventSummaryRow extends PublicEventSummaryRow {
  has_results: number;
}

export interface PublicArchiveYearRow {
  archive_year: number;
}

export interface PublicCompletedEventCountRow {
  completed_event_count: number;
}

export interface PublicEventDetailRow extends PublicEventSummaryRow {
  is_attendee_registration_open: number;
  is_tshirt_size_collected: number;
  sanction_status: string;
  payment_enabled: number;
  currency: string;
  competitor_fee_cents: number | null;
  attendee_fee_cents: number | null;
}

export interface PublicEventDisciplineRow {
  discipline_id: string;
  event_id: string;
  name: string;
  discipline_category: string;
  team_type: string;
  sort_order: number;
}

export interface PublicEventResultRow {
  event_id: string;
  result_entry_id: string;
  results_upload_id: string | null;
  discipline_id: string | null;
  discipline_name: string | null;
  discipline_category: string | null;
  team_type: string | null;
  discipline_sort_order: number | null;
  placement: number;
  score_text: string | null;
  participant_row_id: string;
  participant_order: number;
  member_id: string | null;
  participant_member_slug: string | null;
  participant_display_name: string;
  participant_historical_person_id: string | null;
}

export interface PublicPlayerRow {
  person_id: string;
  person_name: string;
  country: string | null;
  event_count: number | null;
  placement_count: number | null;
  bap_member: number;
  bap_nickname: string | null;
  bap_induction_year: number | null;
  hof_member: number;
  hof_induction_year: number | null;
}

export interface PublicPlayerResultRow {
  event_id: string;
  event_title: string;
  start_date: string;
  city: string;
  event_region: string | null;
  event_country: string;
  discipline_name: string | null;
  discipline_category: string | null;
  team_type: string | null;
  discipline_sort_order: number | null;
  placement: number;
  score_text: string | null;
  participant_order: number;
  participant_display_name: string;
  participant_person_id: string | null;
  participant_member_slug: string | null;
  event_tag_normalized: string;
}

export interface HealthReadyRow {
  is_ready: number;
}

export interface PublicClubRow {
  club_id: string;
  name: string;
  description: string;
  city: string;
  region: string | null;
  country: string;
  external_url: string | null;
  tag_normalized: string;
  tag_display: string;
}

export interface PublicClubMemberRow {
  person_id: string | null;
  person_name: string;
}

export const db: SqliteDatabase = openDatabase(DB_FILENAME);

export const publicEvents = {
  listUpcoming: db.prepare(`
    SELECT
      e.id AS event_id,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.city,
      e.region,
      e.country,
      c.name AS host_club,
      e.external_url,
      e.registration_deadline,
      e.capacity_limit,
      e.status,
      e.registration_status,
      e.published_at,
      e.hashtag_tag_id,
      t.tag_normalized,
      t.tag_display
    FROM events AS e
    INNER JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN clubs AS c
      ON c.id = e.host_club_id
    WHERE
      e.status IN (${PUBLIC_UPCOMING_VISIBLE_STATUS_SQL})
      AND e.start_date >= date(?)
      AND t.is_standard = 1
      AND t.standard_type = 'event'
    ORDER BY
      e.start_date ASC,
      e.end_date ASC,
      e.title COLLATE NOCASE ASC,
      e.id ASC
  `),

  listArchiveYears: db.prepare(`
    SELECT DISTINCT
      ${ARCHIVE_YEAR_SQL} AS archive_year
    FROM events AS e
    INNER JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    WHERE
      e.status = 'completed'
      AND t.is_standard = 1
      AND t.standard_type = 'event'
    ORDER BY archive_year DESC
  `),

  countCompletedByYear: db.prepare(`
    SELECT
      COUNT(*) AS completed_event_count
    FROM events AS e
    INNER JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN clubs AS c
      ON c.id = e.host_club_id
    WHERE
      e.status = 'completed'
      AND ${ARCHIVE_YEAR_SQL} = ?
      AND t.is_standard = 1
      AND t.standard_type = 'event'
  `),

  listCompletedByYear: db.prepare(`
    SELECT
      e.id AS event_id,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.city,
      e.region,
      e.country,
      c.name AS host_club,
      e.external_url,
      e.registration_deadline,
      e.capacity_limit,
      e.status,
      e.registration_status,
      e.published_at,
      e.hashtag_tag_id,
      t.tag_normalized,
      t.tag_display,
      EXISTS(
        SELECT 1
        FROM event_result_entries AS ere
        WHERE ere.event_id = e.id
        LIMIT 1
      ) AS has_results
    FROM events AS e
    INNER JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN clubs AS c
      ON c.id = e.host_club_id
    WHERE
      e.status = 'completed'
      AND ${ARCHIVE_YEAR_SQL} = ?
      AND t.is_standard = 1
      AND t.standard_type = 'event'
    ORDER BY
      e.start_date ASC,
      e.end_date ASC,
      e.title COLLATE NOCASE ASC,
      e.id ASC
  `),

  getByStandardTag: db.prepare(`
    SELECT
      e.id AS event_id,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.city,
      e.region,
      e.country,
      c.name AS host_club,
      e.external_url,
      e.registration_deadline,
      e.capacity_limit,
      e.is_attendee_registration_open,
      e.is_tshirt_size_collected,
      e.status,
      e.registration_status,
      e.published_at,
      e.sanction_status,
      e.payment_enabled,
      e.currency,
      e.competitor_fee_cents,
      e.attendee_fee_cents,
      e.hashtag_tag_id,
      t.tag_normalized,
      t.tag_display
    FROM events AS e
    INNER JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN clubs AS c
      ON c.id = e.host_club_id
    WHERE
      t.tag_normalized = ?
      AND t.is_standard = 1
      AND t.standard_type = 'event'
      AND e.status IN (${PUBLIC_EVENT_DETAIL_VISIBLE_STATUS_SQL})
  `),

  listDisciplinesByEventId: db.prepare(`
    SELECT
      ed.id AS discipline_id,
      ed.event_id,
      ed.name,
      ed.discipline_category,
      ed.team_type,
      ed.sort_order
    FROM events AS e
    INNER JOIN event_disciplines AS ed
      ON ed.event_id = e.id
    WHERE
      e.id = ?
      AND e.status IN (${PUBLIC_EVENT_DETAIL_VISIBLE_STATUS_SQL})
    ORDER BY
      ed.sort_order ASC,
      ed.name COLLATE NOCASE ASC,
      ed.id ASC
  `),

  listPublicResultRowsByEventId: db.prepare(`
    SELECT
      ere.event_id,
      ere.id AS result_entry_id,
      ere.results_upload_id,
      ere.discipline_id,
      ed.name AS discipline_name,
      ed.discipline_category,
      ed.team_type,
      ed.sort_order AS discipline_sort_order,
      ere.placement,
      ere.score_text,
      erp.id AS participant_row_id,
      erp.participant_order,
      erp.member_id,
      COALESCE(m_linked.slug, m_legacy.slug) AS participant_member_slug,
      erp.display_name AS participant_display_name,
      erp.historical_person_id AS participant_historical_person_id
    FROM events AS e
    INNER JOIN event_result_entries AS ere
      ON ere.event_id = e.id
    LEFT JOIN event_disciplines AS ed
      ON ed.id = ere.discipline_id
    INNER JOIN event_result_entry_participants AS erp
      ON erp.result_entry_id = ere.id
    LEFT JOIN members AS m_linked
      ON m_linked.id = erp.member_id
    LEFT JOIN historical_persons AS hp_link
      ON hp_link.person_id = erp.historical_person_id
      AND hp_link.legacy_member_id IS NOT NULL
    LEFT JOIN members AS m_legacy
      ON m_legacy.legacy_member_id = hp_link.legacy_member_id
      AND m_legacy.deleted_at IS NULL
      AND m_legacy.login_email IS NOT NULL
    WHERE
      e.id = ?
      AND e.status IN (${PUBLIC_EVENT_DETAIL_VISIBLE_STATUS_SQL})
    ORDER BY
      CASE WHEN ere.discipline_id IS NULL THEN 0 ELSE 1 END ASC,
      COALESCE(ed.sort_order, 0) ASC,
      COALESCE(ed.name, '') COLLATE NOCASE ASC,
      ere.placement ASC,
      ere.id ASC,
      erp.participant_order ASC,
      erp.id ASC
  `),
} as const;

export const publicPlayers = {
  listAll: db.prepare(`
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      COUNT(DISTINCT ere.event_id)       AS event_count,
      COUNT(DISTINCT erp.result_entry_id) AS placement_count,
      hp.bap_member,
      hp.hof_member,
      (SELECT m.slug
       FROM members AS m
       WHERE m.deleted_at IS NULL
         AND m.login_email IS NOT NULL
         AND m.legacy_member_id = hp.legacy_member_id
         AND hp.legacy_member_id IS NOT NULL
       LIMIT 1
      ) AS linked_member_slug
    FROM historical_persons AS hp
    LEFT JOIN event_result_entry_participants AS erp
      ON erp.historical_person_id = hp.person_id
    LEFT JOIN event_result_entries AS ere
      ON ere.id = erp.result_entry_id
    GROUP BY
      hp.person_id, hp.person_name, hp.country,
      hp.bap_member, hp.hof_member
    HAVING COUNT(DISTINCT erp.result_entry_id) > 0
        OR hp.first_year IS NOT NULL
        OR hp.country IS NOT NULL
        OR hp.source_scope LIKE 'PRE1997%'
    ORDER BY hp.person_name COLLATE NOCASE
  `),

  getById: db.prepare(`
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      COUNT(DISTINCT ere.event_id)       AS event_count,
      COUNT(DISTINCT erp.result_entry_id) AS placement_count,
      hp.bap_member,
      hp.bap_nickname,
      hp.bap_induction_year,
      hp.hof_member,
      hp.hof_induction_year
    FROM historical_persons AS hp
    LEFT JOIN event_result_entry_participants AS erp
      ON erp.historical_person_id = hp.person_id
    LEFT JOIN event_result_entries AS ere
      ON ere.id = erp.result_entry_id
    WHERE hp.person_id = ?
    GROUP BY
      hp.person_id, hp.person_name, hp.country,
      hp.bap_member, hp.bap_nickname, hp.bap_induction_year,
      hp.hof_member, hp.hof_induction_year
  `),

  listResultsByPersonId: db.prepare(`
    SELECT
      e.id                        AS event_id,
      e.title                     AS event_title,
      e.start_date,
      e.city,
      e.region                    AS event_region,
      e.country                   AS event_country,
      t.tag_normalized            AS event_tag_normalized,
      ed.name                     AS discipline_name,
      ed.discipline_category,
      ed.team_type,
      ed.sort_order               AS discipline_sort_order,
      ere.placement,
      ere.score_text,
      erp_co.participant_order,
      erp_co.display_name         AS participant_display_name,
      erp_co.historical_person_id AS participant_person_id,
      COALESCE(m_co_linked.slug, m_co_legacy.slug) AS participant_member_slug
    FROM event_result_entry_participants AS erp_me
    JOIN event_result_entries AS ere
      ON ere.id = erp_me.result_entry_id
    JOIN events AS e
      ON e.id = ere.event_id
    JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN event_disciplines AS ed
      ON ed.id = ere.discipline_id
    JOIN event_result_entry_participants AS erp_co
      ON erp_co.result_entry_id = ere.id
    LEFT JOIN members AS m_co_linked
      ON m_co_linked.id = erp_co.member_id
    LEFT JOIN historical_persons AS hp_co
      ON hp_co.person_id = erp_co.historical_person_id
      AND hp_co.legacy_member_id IS NOT NULL
    LEFT JOIN members AS m_co_legacy
      ON m_co_legacy.legacy_member_id = hp_co.legacy_member_id
      AND m_co_legacy.deleted_at IS NULL
      AND m_co_legacy.login_email IS NOT NULL
    WHERE erp_me.historical_person_id = ?
    ORDER BY
      e.start_date DESC,
      COALESCE(ed.sort_order, 0) ASC,
      COALESCE(ed.name, '') COLLATE NOCASE ASC,
      ere.placement ASC,
      erp_co.participant_order ASC
  `),
  findLinkedMemberSlug: db.prepare(`
    SELECT m.slug
    FROM members AS m
    WHERE m.deleted_at IS NULL
      AND m.login_email IS NOT NULL
      AND m.legacy_member_id IS NOT NULL
      AND m.legacy_member_id = (
        SELECT hp.legacy_member_id
        FROM historical_persons AS hp
        WHERE hp.person_id = ?
          AND hp.legacy_member_id IS NOT NULL
      )
    LIMIT 1
  `),

  findLinkedPersonId: db.prepare(`
    SELECT erp.historical_person_id AS person_id
    FROM event_result_entry_participants AS erp
    WHERE erp.member_id = ?
      AND erp.historical_person_id IS NOT NULL
    LIMIT 1
  `),
} as const;

export const clubs = {
  listOpen: db.prepare(`
    SELECT
      c.id          AS club_id,
      c.name,
      c.description,
      c.city,
      c.region,
      c.country,
      c.external_url,
      t.tag_normalized,
      t.tag_display
    FROM clubs_open AS c
    INNER JOIN tags AS t
      ON t.id = c.hashtag_tag_id
    WHERE
      t.is_standard = 1
      AND t.standard_type = 'club'
    ORDER BY
      c.country COLLATE NOCASE ASC,
      CASE WHEN c.region IS NULL OR c.region = '' THEN 1 ELSE 0 END ASC,
      c.region  COLLATE NOCASE ASC,
      c.city    COLLATE NOCASE ASC,
      c.name    COLLATE NOCASE ASC
  `),

  getByTagNormalized: db.prepare(`
    SELECT
      c.id          AS club_id,
      c.name,
      c.description,
      c.city,
      c.region,
      c.country,
      c.external_url,
      t.tag_normalized,
      t.tag_display
    FROM clubs_open AS c
    INNER JOIN tags AS t
      ON t.id = c.hashtag_tag_id
    WHERE
      t.tag_normalized = ?
      AND t.is_standard = 1
      AND t.standard_type = 'club'
  `),

  listMembersByClubId: db.prepare(`
    SELECT
      lpca.historical_person_id AS person_id,
      COALESCE(hp.person_name, lpca.display_name) AS person_name
    FROM legacy_person_club_affiliations AS lpca
    INNER JOIN legacy_club_candidates AS lcc
      ON lcc.id = lpca.legacy_club_candidate_id
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = lpca.historical_person_id
    WHERE
      lcc.mapped_club_id = ?
      AND lpca.resolution_status IN ('confirmed_current', 'promoted')
    ORDER BY person_name ASC
  `),
} as const;

export const health = {
  checkReady: db.prepare(`
    SELECT 1 AS is_ready
  `),
} as const;

export interface MemberAuthRow {
  id: string;
  slug: string | null;
  display_name: string;
  password_hash: string;
  password_version: number;
  is_admin: number;
}

export interface MemberProfileRow {
  id: string;
  slug: string | null;
  display_name: string;
  bio: string;
  city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  email_visibility: string;
  is_admin: number;
  is_hof: number;
  is_bap: number;
  first_competition_year: number | null;
  show_competitive_results: number;
  legacy_member_id: string | null;
  login_email: string;
  avatar_thumb_key: string | null;
  historical_person_name: string | null;
  historical_first_year: number | null;
  historical_bap_nickname: string | null;
  historical_bap_induction_year: number | null;
  historical_hof_induction_year: number | null;
}

export interface MemberResultRow {
  event_id: string;
  event_title: string;
  start_date: string;
  city: string;
  event_region: string | null;
  event_country: string;
  event_tag_normalized: string;
  discipline_name: string | null;
  discipline_category: string | null;
  team_type: string | null;
  placement: number;
  score_text: string | null;
  participant_display_name: string;
  participant_person_id: string | null;
  participant_member_slug: string | null;
  participant_member_id: string | null;
}

export const account = {
  findMemberBySlug: db.prepare(`
    SELECT
      m.id,
      m.slug,
      m.display_name,
      m.bio,
      m.city,
      m.region,
      m.country,
      m.phone,
      m.email_visibility,
      m.is_admin,
      m.is_hof,
      m.is_bap,
      m.first_competition_year,
      m.show_competitive_results,
      m.legacy_member_id,
      m.login_email,
      mi.s3_key_thumb AS avatar_thumb_key,
      hp.person_name AS historical_person_name,
      hp.first_year AS historical_first_year,
      hp.bap_nickname AS historical_bap_nickname,
      hp.bap_induction_year AS historical_bap_induction_year,
      hp.hof_induction_year AS historical_hof_induction_year
    FROM members_active AS m
    LEFT JOIN media_items AS mi
      ON mi.id = m.avatar_media_id
    LEFT JOIN historical_persons AS hp
      ON hp.legacy_member_id = m.legacy_member_id
      AND m.legacy_member_id IS NOT NULL
    WHERE m.slug = ?
      AND m.personal_data_purged_at IS NULL
  `),

  findMemberById: db.prepare(`
    SELECT
      m.id,
      m.slug,
      m.display_name,
      m.bio,
      m.city,
      m.region,
      m.country,
      m.phone,
      m.email_visibility,
      m.is_admin,
      m.is_hof,
      m.is_bap,
      mi.s3_key_thumb AS avatar_thumb_key
    FROM members_active AS m
    LEFT JOIN media_items AS mi
      ON mi.id = m.avatar_media_id
    WHERE m.id = ?
      AND m.personal_data_purged_at IS NULL
  `),

  listResultsByMemberId: db.prepare(`
    SELECT
      e.id                        AS event_id,
      e.title                     AS event_title,
      e.start_date,
      e.city,
      e.region                    AS event_region,
      e.country                   AS event_country,
      t.tag_normalized            AS event_tag_normalized,
      ed.name                     AS discipline_name,
      ed.discipline_category,
      ed.team_type,
      ere.placement,
      ere.score_text,
      erp_co.display_name         AS participant_display_name,
      erp_co.historical_person_id AS participant_person_id,
      COALESCE(m_co_linked.slug, m_co_legacy.slug) AS participant_member_slug,
      erp_co.member_id            AS participant_member_id
    FROM event_result_entry_participants AS erp_me
    JOIN event_result_entries AS ere
      ON ere.id = erp_me.result_entry_id
    JOIN events AS e
      ON e.id = ere.event_id
    JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN event_disciplines AS ed
      ON ed.id = ere.discipline_id
    JOIN event_result_entry_participants AS erp_co
      ON erp_co.result_entry_id = ere.id
    LEFT JOIN members AS m_co_linked
      ON m_co_linked.id = erp_co.member_id
    LEFT JOIN historical_persons AS hp_co
      ON hp_co.person_id = erp_co.historical_person_id
      AND hp_co.legacy_member_id IS NOT NULL
    LEFT JOIN members AS m_co_legacy
      ON m_co_legacy.legacy_member_id = hp_co.legacy_member_id
      AND m_co_legacy.deleted_at IS NULL
      AND m_co_legacy.login_email IS NOT NULL
    WHERE erp_me.member_id = ?
    ORDER BY
      e.start_date DESC,
      COALESCE(ed.sort_order, 0) ASC,
      COALESCE(ed.name, '') COLLATE NOCASE ASC,
      ere.placement ASC,
      erp_co.participant_order ASC
  `),

  listResultsByLegacyMemberId: db.prepare(`
    SELECT
      e.id                        AS event_id,
      e.title                     AS event_title,
      e.start_date,
      e.city,
      e.region                    AS event_region,
      e.country                   AS event_country,
      t.tag_normalized            AS event_tag_normalized,
      ed.name                     AS discipline_name,
      ed.discipline_category,
      ed.team_type,
      ere.placement,
      ere.score_text,
      erp_co.display_name         AS participant_display_name,
      erp_co.historical_person_id AS participant_person_id,
      COALESCE(m_co_linked.slug, m_co_legacy.slug) AS participant_member_slug,
      erp_co.member_id            AS participant_member_id
    FROM event_result_entry_participants AS erp_me
    JOIN historical_persons AS hp
      ON hp.person_id = erp_me.historical_person_id
    JOIN event_result_entries AS ere
      ON ere.id = erp_me.result_entry_id
    JOIN events AS e
      ON e.id = ere.event_id
    JOIN tags AS t
      ON t.id = e.hashtag_tag_id
    LEFT JOIN event_disciplines AS ed
      ON ed.id = ere.discipline_id
    JOIN event_result_entry_participants AS erp_co
      ON erp_co.result_entry_id = ere.id
    LEFT JOIN members AS m_co_linked
      ON m_co_linked.id = erp_co.member_id
    LEFT JOIN historical_persons AS hp_co
      ON hp_co.person_id = erp_co.historical_person_id
      AND hp_co.legacy_member_id IS NOT NULL
    LEFT JOIN members AS m_co_legacy
      ON m_co_legacy.legacy_member_id = hp_co.legacy_member_id
      AND m_co_legacy.deleted_at IS NULL
      AND m_co_legacy.login_email IS NOT NULL
    WHERE hp.legacy_member_id = ?
    ORDER BY
      e.start_date DESC,
      COALESCE(ed.sort_order, 0) ASC,
      COALESCE(ed.name, '') COLLATE NOCASE ASC,
      ere.placement ASC,
      erp_co.participant_order ASC
  `),

  updateMemberProfile: db.prepare(`
    UPDATE members
    SET
      bio                     = ?,
      city                    = ?,
      region                  = ?,
      country                 = ?,
      phone                   = ?,
      email_visibility        = ?,
      first_competition_year  = ?,
      show_competitive_results = ?,
      updated_at              = ?,
      updated_by              = 'member',
      version                 = version + 1
    WHERE id = ?
  `),
} as const;

export const registration = {
  checkEmailExists: db.prepare(`
    SELECT 1 AS exists_flag
    FROM members
    WHERE login_email_normalized = ?
      AND personal_data_purged_at IS NULL
  `),

  checkSlugExists: db.prepare(`
    SELECT 1 AS exists_flag
    FROM members
    WHERE slug = ?
  `),

  insertMember: db.prepare(`
    INSERT INTO members (
      id, slug,
      login_email, login_email_normalized, email_verified_at,
      password_hash, password_changed_at,
      real_name, display_name, display_name_normalized,
      searchable,
      created_at, created_by, updated_at, updated_by, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'registration', ?, 'registration', 1)
  `),
} as const;

export const auth = {
  findMemberByEmail: db.prepare(`
    SELECT
      m.id,
      m.slug,
      m.display_name,
      m.password_hash,
      m.password_version,
      m.is_admin
    FROM members_active AS m
    WHERE
      m.login_email_normalized = ?
      AND m.email_verified_at IS NOT NULL
      AND m.is_deceased = 0
  `),

  updateMemberLastLogin: db.prepare(`
    UPDATE members
    SET
      last_login_at = ?,
      updated_at    = ?,
      updated_by    = 'system',
      version       = version + 1
    WHERE id = ?
  `),
} as const;

export const media = {
  insertMediaItem: db.prepare(`
    INSERT INTO media_items (
      id, created_at, created_by, updated_at, updated_by, version,
      uploader_member_id, gallery_id, media_type, is_avatar, caption, uploaded_at,
      s3_key_thumb, s3_key_display, width_px, height_px
    ) VALUES (?, ?, 'member', ?, 'member', 1, ?, NULL, 'photo', 1, NULL, ?, ?, ?, ?, ?)
  `),

  setMemberAvatar: db.prepare(`
    UPDATE members
    SET avatar_media_id = ?, updated_at = ?, updated_by = 'member', version = version + 1
    WHERE id = ?
  `),

  getExistingAvatarMediaId: db.prepare(`
    SELECT id, s3_key_thumb, s3_key_display
    FROM media_items
    WHERE uploader_member_id = ? AND is_avatar = 1
  `),

  deleteMediaItem: db.prepare(`
    DELETE FROM media_items WHERE id = ?
  `),

  countRecentAvatarUploads: db.prepare(`
    SELECT COUNT(*) AS upload_count
    FROM media_items
    WHERE uploader_member_id = ? AND is_avatar = 1 AND uploaded_at > ?
  `),
} as const;

export interface ExistingAvatarRow {
  id: string;
  s3_key_thumb: string;
  s3_key_display: string;
}

export interface AvatarUploadCountRow {
  upload_count: number;
}

// ── Legacy claim ────────────────────────────────────────────────────────────────

export interface LegacyPlaceholderRow {
  id: string;
  display_name: string;
  legacy_member_id: string | null;
  legacy_user_id: string | null;
  legacy_email: string | null;
  bio: string;
  birth_date: string | null;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ifpa_join_date: string | null;
  is_hof: number;
  is_bap: number;
  legacy_is_admin: number;
}

export interface AlreadyClaimedRow {
  legacy_member_id: string;
}

export interface HistoricalPersonClaimRow {
  person_id: string;
  person_name: string;
  legacy_member_id: string;
  country: string | null;
  hof_member: number;
  bap_member: number;
  first_year: number | null;
}

export const legacyClaim = {
  findHistoricalPersonByLegacyId: db.prepare(`
    SELECT person_id, person_name, legacy_member_id, country, hof_member, bap_member, first_year
    FROM historical_persons
    WHERE legacy_member_id = ?
    LIMIT 1
  `),

  checkLegacyIdAlreadyClaimed: db.prepare(`
    SELECT id
    FROM members
    WHERE legacy_member_id = ?
      AND deleted_at IS NULL
      AND login_email IS NOT NULL
    LIMIT 1
  `),

  findPlaceholderByIdentifier: db.prepare(`
    SELECT
      id, display_name,
      legacy_member_id, legacy_user_id, legacy_email,
      bio, birth_date, street_address, postal_code,
      city, region, country,
      ifpa_join_date, is_hof, is_bap, legacy_is_admin
    FROM members
    WHERE deleted_at IS NULL
      AND personal_data_purged_at IS NULL
      AND login_email IS NULL
      AND password_hash IS NULL
      AND (legacy_member_id = ? OR legacy_user_id = ? OR legacy_email = ?)
    LIMIT 1
  `),

  findPlaceholderById: db.prepare(`
    SELECT
      id, display_name,
      legacy_member_id, legacy_user_id, legacy_email,
      bio, birth_date, street_address, postal_code,
      city, region, country,
      ifpa_join_date, is_hof, is_bap, legacy_is_admin
    FROM members
    WHERE id = ?
      AND deleted_at IS NULL
      AND personal_data_purged_at IS NULL
      AND login_email IS NULL
      AND password_hash IS NULL
  `),

  checkAlreadyClaimed: db.prepare(`
    SELECT legacy_member_id
    FROM members
    WHERE id = ?
      AND legacy_member_id IS NOT NULL
  `),

  softDeletePlaceholder: db.prepare(`
    UPDATE members
    SET
      deleted_at       = ?,
      deleted_by       = 'claim_merge',
      legacy_member_id = NULL,
      legacy_user_id   = NULL,
      legacy_email     = NULL,
      updated_at       = ?,
      updated_by       = 'claim_merge',
      version          = version + 1
    WHERE id = ?
      AND deleted_at IS NULL
      AND login_email IS NULL
      AND password_hash IS NULL
  `),

  transferLegacyFields: db.prepare(`
    UPDATE members
    SET
      legacy_member_id = ?,
      legacy_user_id   = COALESCE(legacy_user_id, ?),
      legacy_email     = COALESCE(legacy_email, ?),
      bio              = CASE WHEN bio = '' THEN ? ELSE bio END,
      birth_date       = COALESCE(birth_date, ?),
      street_address   = COALESCE(street_address, ?),
      postal_code      = COALESCE(postal_code, ?),
      city             = CASE WHEN city IS NULL OR city = '' THEN ? ELSE city END,
      region           = CASE WHEN region IS NULL OR region = '' THEN ? ELSE region END,
      country          = CASE WHEN country IS NULL OR country = '' THEN ? ELSE country END,
      ifpa_join_date   = COALESCE(ifpa_join_date, ?),
      is_hof           = MAX(is_hof, ?),
      is_bap           = MAX(is_bap, ?),
      first_competition_year = COALESCE(first_competition_year, ?),
      updated_at       = ?,
      updated_by       = 'claim_merge',
      version          = version + 1
    WHERE id = ?
  `),
} as const;

let helperTransactionOpen = false;

function rollbackHelperTransaction(): void {
  try {
    db.exec('ROLLBACK');
  } finally {
    helperTransactionOpen = false;
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function transaction<T>(work: () => T, timeoutMs = TRANSACTION_TIMEOUT_MS): T {
  if (helperTransactionOpen) {
    throw new Error('Nested transactions are not supported by the db.ts transaction helper.');
  }

  const startedAt = Date.now();

  db.exec('BEGIN IMMEDIATE');
  helperTransactionOpen = true;

  try {
    const result = work();

    if (isThenable(result)) {
      rollbackHelperTransaction();
      throw new TypeError(
        'db.ts transaction callbacks must be synchronous and must not return a Promise.',
      );
    }

    if (Date.now() - startedAt > timeoutMs) {
      rollbackHelperTransaction();
      throw new Error(`SQLite transaction exceeded ${timeoutMs}ms timeout.`);
    }

    db.exec('COMMIT');
    helperTransactionOpen = false;

    return result;
  } catch (error) {
    if (helperTransactionOpen) {
      rollbackHelperTransaction();
    }

    throw error;
  }
}
