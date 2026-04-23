import { SqliteDatabase, openDatabase } from './openDatabase';
import { config } from '../config/env';

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
 * - GET /freestyle
 * - GET /freestyle/about
 * - GET /freestyle/moves
 * - GET /freestyle/records
 * - GET /freestyle/leaders
 * - GET /freestyle/tricks/:slug
 * - GET /consecutive
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

const DB_FILENAME = config.dbPath;
const TRANSACTION_TIMEOUT_MS = 30_000;

import {
  PUBLIC_EVENT_DETAIL_VISIBLE_STATUSES,
  PUBLIC_UPCOMING_VISIBLE_STATUSES,
} from '../services/eventVisibility';
import { PUBLIC_FREESTYLE_RECORD_CONFIDENCES } from '../services/freestyleRecordVisibility';

const PUBLIC_EVENT_DETAIL_VISIBLE_STATUS_SQL = PUBLIC_EVENT_DETAIL_VISIBLE_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');

const PUBLIC_UPCOMING_VISIBLE_STATUS_SQL = PUBLIC_UPCOMING_VISIBLE_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');

const PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL = PUBLIC_FREESTYLE_RECORD_CONFIDENCES
  .map((c) => `'${c}'`)
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

export interface PlayerCareerStatRow {
  category:    string;
  events:      number;
  wins:        number;
  podiums:     number;
  appearances: number;
}

export interface PlayerPartnerRow {
  partner_person_id:   string;
  partner_name:        string;
  partner_country:     string | null;
  partner_member_slug: string | null;
  category:            string;
  appearances:         number;
  wins:                number;
  podiums:             number;
  first_year:          number | null;
  last_year:           number | null;
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
      COALESCE(m_linked.slug, m_via_hp.slug) AS participant_member_slug,
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
    LEFT JOIN members AS m_via_hp
      ON m_via_hp.historical_person_id = erp.historical_person_id
      AND m_via_hp.deleted_at IS NULL
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

export interface HistoricalPersonSearchRow {
  person_id: string;
  person_name: string;
  country: string | null;
  hof_member: number;
  bap_member: number;
  linked_member_slug: string | null;
}

export const publicPlayers = {
  searchByName: db.prepare(`
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      hp.hof_member,
      hp.bap_member,
      (SELECT m.slug
       FROM members AS m
       WHERE m.deleted_at IS NULL
         AND m.historical_person_id = hp.person_id
       LIMIT 1
      ) AS linked_member_slug
    FROM historical_persons AS hp
    WHERE hp.source_scope = 'CANONICAL'
      AND hp.person_name LIKE '%' || ? || '%' ESCAPE '\\'
    ORDER BY hp.person_name COLLATE NOCASE
    LIMIT ?
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
      COALESCE(m_co_linked.slug, m_co_via_hp.slug) AS participant_member_slug
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
    LEFT JOIN members AS m_co_via_hp
      ON m_co_via_hp.historical_person_id = erp_co.historical_person_id
      AND m_co_via_hp.deleted_at IS NULL
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
      AND m.historical_person_id = ?
    LIMIT 1
  `),

  findLinkedPersonId: db.prepare(`
    SELECT erp.historical_person_id AS person_id
    FROM event_result_entry_participants AS erp
    WHERE erp.member_id = ?
      AND erp.historical_person_id IS NOT NULL
    LIMIT 1
  `),

  findLinkedPersonByLegacyId: db.prepare(`
    SELECT person_id
    FROM historical_persons
    WHERE legacy_member_id = ?
      AND source_scope = 'CANONICAL'
    LIMIT 1
  `),

  /** Career stats by discipline category for a person. */
  listCareerStatsByCategory: db.prepare(`
    SELECT
      ed.discipline_category AS category,
      COUNT(DISTINCT ere.event_id) AS events,
      SUM(CASE WHEN ere.placement = 1 AND erp.participant_order = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ere.placement <= 3 AND erp.participant_order = 1 THEN 1 ELSE 0 END) AS podiums,
      COUNT(DISTINCT erp.result_entry_id) AS appearances
    FROM event_result_entry_participants erp
    JOIN event_result_entries ere ON ere.id = erp.result_entry_id
    JOIN event_disciplines ed ON ed.id = ere.discipline_id
    WHERE erp.historical_person_id = ?
    GROUP BY ed.discipline_category
    ORDER BY appearances DESC
  `),

  /** Top partnerships (doubles) for a person across all disciplines. */
  listTopPartnersByPersonId: db.prepare(`
    SELECT
      hp_partner.person_id   AS partner_person_id,
      hp_partner.person_name AS partner_name,
      hp_partner.country     AS partner_country,
      m_partner.slug         AS partner_member_slug,
      ed.discipline_category AS category,
      COUNT(DISTINCT erp_me.result_entry_id) AS appearances,
      SUM(CASE WHEN ere.placement = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ere.placement <= 3 THEN 1 ELSE 0 END) AS podiums,
      MIN(CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER)) AS first_year,
      MAX(CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER)) AS last_year
    FROM event_result_entry_participants erp_me
    JOIN event_result_entries ere ON ere.id = erp_me.result_entry_id
    JOIN event_disciplines ed ON ed.id = ere.discipline_id
    JOIN events e ON e.id = ere.event_id
    JOIN event_result_entry_participants erp_partner
      ON erp_partner.result_entry_id = erp_me.result_entry_id
      AND erp_partner.id != erp_me.id
    JOIN historical_persons hp_partner ON hp_partner.person_id = erp_partner.historical_person_id
    LEFT JOIN members m_partner
      ON m_partner.historical_person_id = hp_partner.person_id
      AND m_partner.deleted_at IS NULL
    WHERE erp_me.historical_person_id = ?
      AND ed.team_type = 'doubles'
      AND hp_partner.person_name != 'Unknown'
    GROUP BY hp_partner.person_id, ed.discipline_category, m_partner.slug
    ORDER BY appearances DESC, wins DESC
    LIMIT 15
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

// ---------------------------------------------------------------------------
// Freestyle records, public read path
//
// Public filter contract (enforced here, not in service layer):
//   confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
//   AND superseded_by IS NULL
//   AND (person_id IS NOT NULL OR display_name IS NOT NULL)
//
// Holder name: canonical person_name when person_id resolves; otherwise
// freestyle_records.display_name (raw player name from source CSV).
// ---------------------------------------------------------------------------
export interface FreestyleRecordRow {
  id: string;
  record_type: string;
  person_id: string | null;
  holder_name: string;
  holder_member_slug: string | null;
  trick_name: string | null;
  sort_name: string | null;
  adds_count: number | null;
  value_numeric: number;
  achieved_date: string | null;
  date_precision: string;
  confidence: string;
  video_url: string | null;
  video_timecode: string | null;
  notes: string | null;
  superseded_by?: string | null;
}

export const freestyleRecords = {
  listPublic: db.prepare(`
    SELECT
      fr.id,
      fr.record_type,
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      m.slug AS holder_member_slug,
      fr.trick_name,
      fr.sort_name,
      fr.adds_count,
      fr.value_numeric,
      fr.achieved_date,
      fr.date_precision,
      fr.confidence,
      fr.video_url,
      fr.video_timecode,
      fr.notes
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND fr.superseded_by IS NULL
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    ORDER BY fr.record_type ASC, fr.value_numeric DESC
  `),

  countPublicByType: db.prepare(`
    SELECT record_type, COUNT(*) AS n
    FROM freestyle_records
    WHERE confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND superseded_by IS NULL
      AND (person_id IS NOT NULL OR display_name IS NOT NULL)
    GROUP BY record_type
    ORDER BY record_type ASC
  `),

  listByPersonId: db.prepare(`
    SELECT
      fr.id,
      fr.record_type,
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      m.slug AS holder_member_slug,
      fr.trick_name,
      fr.sort_name,
      fr.adds_count,
      fr.value_numeric,
      fr.achieved_date,
      fr.date_precision,
      fr.confidence,
      fr.video_url,
      fr.video_timecode,
      fr.notes
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.person_id = ?
      AND fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND fr.superseded_by IS NULL
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    ORDER BY fr.value_numeric DESC
  `),

  listLeaders: db.prepare(`
    SELECT
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      MAX(m.slug)                                AS holder_member_slug,
      COUNT(*)                                   AS record_count,
      MAX(fr.value_numeric)                      AS top_value,
      MAX(CASE WHEN fr.value_numeric = (
            SELECT MAX(fr2.value_numeric)
            FROM freestyle_records fr2
            WHERE (fr2.person_id = fr.person_id OR (fr2.person_id IS NULL AND fr2.display_name = fr.display_name))
              AND fr2.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
              AND fr2.superseded_by IS NULL
          ) THEN fr.trick_name END)              AS top_trick
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND fr.superseded_by IS NULL
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    GROUP BY fr.person_id, fr.display_name
    ORDER BY record_count DESC, holder_name ASC
  `),

  listByTrickName: db.prepare(`
    SELECT
      fr.id,
      fr.record_type,
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      m.slug AS holder_member_slug,
      fr.trick_name,
      fr.sort_name,
      fr.adds_count,
      fr.value_numeric,
      fr.achieved_date,
      fr.date_precision,
      fr.confidence,
      fr.video_url,
      fr.video_timecode,
      fr.notes
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.trick_name = ?
      AND fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND fr.superseded_by IS NULL
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    ORDER BY fr.value_numeric DESC
  `),

  listAllByTrickName: db.prepare(`
    SELECT
      fr.id,
      fr.record_type,
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      m.slug AS holder_member_slug,
      fr.trick_name,
      fr.sort_name,
      fr.adds_count,
      fr.value_numeric,
      fr.achieved_date,
      fr.date_precision,
      fr.confidence,
      fr.video_url,
      fr.video_timecode,
      fr.notes,
      fr.superseded_by
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.trick_name = ?
      AND fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    ORDER BY fr.value_numeric DESC
  `),

  listRecentPublic: db.prepare(`
    SELECT
      fr.id,
      fr.record_type,
      fr.person_id,
      COALESCE(hp.person_name, fr.display_name) AS holder_name,
      m.slug AS holder_member_slug,
      fr.trick_name,
      fr.sort_name,
      fr.adds_count,
      fr.value_numeric,
      fr.achieved_date,
      fr.date_precision,
      fr.confidence,
      fr.video_url,
      fr.video_timecode,
      fr.notes
    FROM freestyle_records AS fr
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = fr.person_id
    LEFT JOIN members AS m
      ON m.historical_person_id = fr.person_id
      AND m.deleted_at IS NULL
    WHERE fr.confidence IN (${PUBLIC_FREESTYLE_RECORD_CONFIDENCE_SQL})
      AND fr.superseded_by IS NULL
      AND fr.achieved_date IS NOT NULL
      AND (fr.person_id IS NOT NULL OR fr.display_name IS NOT NULL)
    ORDER BY fr.achieved_date DESC
    LIMIT 5
  `),
} as const;

export interface FreestyleLeaderRow {
  person_id: string | null;
  holder_name: string;
  holder_member_slug: string | null;
  record_count: number;
  top_value: number;
  top_trick: string | null;
}

// ---------------------------------------------------------------------------
// freestyleTricks
//
// Canonical trick dictionary loaded by script 17 from tricks.csv (73 tricks).
// Slug = lowercase-hyphenated canonical name. aliases_json is a JSON array.
// trick_family: for compound/dex tricks = slug of base trick; for base tricks =
//   own slug; for modifiers = NULL.
// ---------------------------------------------------------------------------
export interface FreestyleTrickRow {
  slug:           string;
  canonical_name: string;
  adds:           string | null;
  base_trick:     string | null;
  trick_family:   string | null;
  category:       string | null;
  description:    string | null;
  aliases_json:   string | null;
  sort_order:     number;
}

export interface FreestyleTrickModifierRow {
  slug:                 string;
  modifier_name:        string;
  add_bonus:            number;
  add_bonus_rotational: number;
  modifier_type:        string;
  notes:                string | null;
}

export const freestyleTricks = {
  listAll: db.prepare(`
    SELECT slug, canonical_name, adds, base_trick, trick_family, category,
           description, aliases_json, sort_order
    FROM freestyle_tricks
    ORDER BY sort_order ASC
  `),

  getBySlug: db.prepare(`
    SELECT slug, canonical_name, adds, base_trick, trick_family, category,
           description, aliases_json, sort_order
    FROM freestyle_tricks
    WHERE slug = ?
  `),

  listByFamily: db.prepare(`
    SELECT slug, canonical_name, adds, base_trick, trick_family, category,
           description, aliases_json, sort_order
    FROM freestyle_tricks
    WHERE trick_family = ?
    ORDER BY sort_order ASC
  `),
} as const;

export const freestyleTrickModifiers = {
  listAll: db.prepare(`
    SELECT slug, modifier_name, add_bonus, add_bonus_rotational, modifier_type, notes
    FROM freestyle_trick_modifiers
    ORDER BY modifier_type ASC, modifier_name ASC
  `),

  getBySlug: db.prepare(`
    SELECT slug, modifier_name, add_bonus, add_bonus_rotational, modifier_type, notes
    FROM freestyle_trick_modifiers
    WHERE slug = ?
  `),
} as const;

// ---------------------------------------------------------------------------
// freestylePartnerships
//
// Freestyle doubles partnership data derived from canonical result tables.
// Filters to team_type='doubles' disciplines in the freestyle category,
// excluding trick contests, shred, circle, and timed events.
// ---------------------------------------------------------------------------

export interface FreestylePartnershipRow {
  person_id_a:      string;
  person_name_a:    string;
  country_a:        string | null;
  member_slug_a:    string | null;
  person_id_b:      string;
  person_name_b:    string;
  country_b:        string | null;
  member_slug_b:    string | null;
  appearance_count: number;
  win_count:        number;
  podium_count:     number;
  first_year:       number | null;
  last_year:        number | null;
}

export const freestylePartnerships = {
  /** Top freestyle doubles partnerships by appearances.
   *  Excludes trick/shred/circle contests and Unknown placeholders. */
  listTopPartnerships: db.prepare(`
    SELECT
      CASE WHEN pa.person_id < pb.person_id THEN pa.person_id ELSE pb.person_id END AS person_id_a,
      CASE WHEN pa.person_id < pb.person_id THEN pa.person_name ELSE pb.person_name END AS person_name_a,
      CASE WHEN pa.person_id < pb.person_id THEN pa.country ELSE pb.country END AS country_a,
      CASE WHEN pa.person_id < pb.person_id THEN ma.slug ELSE mb.slug END AS member_slug_a,
      CASE WHEN pa.person_id < pb.person_id THEN pb.person_id ELSE pa.person_id END AS person_id_b,
      CASE WHEN pa.person_id < pb.person_id THEN pb.person_name ELSE pa.person_name END AS person_name_b,
      CASE WHEN pa.person_id < pb.person_id THEN pb.country ELSE pa.country END AS country_b,
      CASE WHEN pa.person_id < pb.person_id THEN mb.slug ELSE ma.slug END AS member_slug_b,
      COUNT(*)                                              AS appearance_count,
      SUM(CASE WHEN re.placement = 1 THEN 1 ELSE 0 END)   AS win_count,
      SUM(CASE WHEN re.placement <= 3 THEN 1 ELSE 0 END)  AS podium_count,
      MIN(CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER))     AS first_year,
      MAX(CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER))     AS last_year
    FROM event_result_entries re
    JOIN event_disciplines ed ON ed.id = re.discipline_id
    JOIN events e ON e.id = re.event_id
    JOIN event_result_entry_participants p1 ON p1.result_entry_id = re.id AND p1.participant_order = 1
    JOIN event_result_entry_participants p2 ON p2.result_entry_id = re.id AND p2.participant_order = 2
    JOIN historical_persons pa ON pa.person_id = p1.historical_person_id
    JOIN historical_persons pb ON pb.person_id = p2.historical_person_id
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    WHERE ed.discipline_category = 'freestyle'
      AND ed.team_type = 'doubles'
      AND LOWER(ed.name) NOT LIKE '%sick%'
      AND LOWER(ed.name) NOT LIKE '%big trick%'
      AND LOWER(ed.name) NOT LIKE '%huge%'
      AND LOWER(ed.name) NOT LIKE '%combo%'
      AND LOWER(ed.name) NOT LIKE '%rewind%'
      AND LOWER(ed.name) NOT LIKE '%ironman%'
      AND LOWER(ed.name) NOT LIKE '%battle%'
      AND LOWER(ed.name) NOT LIKE '%circle%'
      AND LOWER(ed.name) NOT LIKE '%shred%'
      AND LOWER(ed.name) NOT LIKE '%30 second%'
      AND LOWER(ed.name) NOT LIKE '%timed consecutive%'
      AND LOWER(ed.name) NOT LIKE '%5-minute%'
      AND pa.person_name != 'Unknown'
      AND pb.person_name != 'Unknown'
      AND pa.person_id != pb.person_id
    GROUP BY person_id_a, person_id_b
    HAVING COUNT(*) >= 2
    ORDER BY appearance_count DESC, win_count DESC, last_year DESC
    LIMIT 50
  `),
} as const;

// ---------------------------------------------------------------------------
// freestyleCompetition
//
// Results-derived freestyle competition data. Queries canonical tables only
// no freestyle-domain tables are written; this is a read-only projection.
//
// Discipline filter: any discipline whose name contains 'freestyle', excluding
// doubles and team formats. This covers Open/Intermediate/Women's Singles
// Freestyle, Open Freestyle, Freestyle, etc.
//
// STATS FIREWALL: no evidence-class filtering needed here. These are canonical
// placement records, not enrichment data.
// ---------------------------------------------------------------------------
export interface FreestyleCompetitorRow {
  person_id:     string;
  person_name:   string;
  country:       string | null;
  member_slug:   string | null;
  golds:         number;
  silvers:       number;
  bronzes:       number;
  total_podiums: number;
}

export interface FreestyleEraRow {
  era:    string;
  events: number;
}

export interface FreestyleRecentEventRow {
  event_id:       string;
  event_title:    string;
  start_date:     string;
  city:           string;
  country:        string;
  tag_normalized: string;   // from tags.tag_normalized via events.hashtag_tag_id
}

export const freestyleCompetition = {
  // Top freestyle singles competitors by gold medals, then total podiums
  listTopCompetitors: db.prepare(`
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      MAX(m.slug)                                          AS member_slug,
      SUM(CASE WHEN ere.placement = 1 THEN 1 ELSE 0 END) AS golds,
      SUM(CASE WHEN ere.placement = 2 THEN 1 ELSE 0 END) AS silvers,
      SUM(CASE WHEN ere.placement = 3 THEN 1 ELSE 0 END) AS bronzes,
      COUNT(*)                                             AS total_podiums
    FROM event_result_entries ere
    JOIN event_disciplines ed ON ed.id = ere.discipline_id
    JOIN event_result_entry_participants erep ON erep.result_entry_id = ere.id
    JOIN historical_persons hp ON hp.person_id = erep.historical_person_id
    LEFT JOIN members m
      ON m.historical_person_id = hp.person_id
      AND m.deleted_at IS NULL
    WHERE (lower(ed.name) LIKE '%freestyle%'
           AND lower(ed.name) NOT LIKE '%doubles%'
           AND lower(ed.name) NOT LIKE '%team%')
      AND ere.placement BETWEEN 1 AND 3
    GROUP BY hp.person_id
    ORDER BY golds DESC, total_podiums DESC
    LIMIT 20
  `),

  // Event counts per era (decade buckets)
  listEventsByEra: db.prepare(`
    SELECT
      CASE
        WHEN substr(e.start_date,1,4) < '1990' THEN '1980s'
        WHEN substr(e.start_date,1,4) < '2000' THEN '1990s'
        WHEN substr(e.start_date,1,4) < '2010' THEN '2000s'
        WHEN substr(e.start_date,1,4) < '2020' THEN '2010s'
        ELSE '2020s'
      END AS era,
      COUNT(DISTINCT e.id) AS events
    FROM events e
    JOIN event_disciplines ed ON ed.event_id = e.id
    WHERE lower(ed.name) LIKE '%freestyle%'
      AND lower(ed.name) NOT LIKE '%doubles%'
      AND lower(ed.name) NOT LIKE '%team%'
    GROUP BY era
    ORDER BY era ASC
  `),

  // 10 most recent freestyle events
  listRecentEvents: db.prepare(`
    SELECT DISTINCT
      e.id         AS event_id,
      e.title      AS event_title,
      e.start_date,
      e.city,
      e.country,
      t.tag_normalized
    FROM events e
    JOIN tags t ON t.id = e.hashtag_tag_id
    JOIN event_disciplines ed ON ed.event_id = e.id
    WHERE lower(ed.name) LIKE '%freestyle%'
      AND lower(ed.name) NOT LIKE '%doubles%'
      AND lower(ed.name) NOT LIKE '%team%'
    ORDER BY e.start_date DESC
    LIMIT 10
  `),
} as const;

// ---------------------------------------------------------------------------
// consecutiveKicksRecords
//
// WFA-sanctioned consecutive kicks records loaded from the curated CSV.
// Four sections: Official World Records, Highest Official Scores,
// World Record Progression, Milestone Firsts.
// ---------------------------------------------------------------------------
export interface ConsecutiveKicksRow {
  sort_order: number;
  section: string;
  subsection: string;
  division: string;
  year: string | null;
  rank: number | null;
  player_1: string | null;
  player_2: string | null;
  score: number | null;
  note: string | null;
  event_date: string | null;
  event_name: string | null;
  location: string | null;
}

export const consecutiveKicksRecords = {
  listWorldRecords: db.prepare(`
    SELECT sort_order, section, subsection, division, year, rank,
           player_1, player_2, score, note, event_date, event_name, location
    FROM consecutive_kicks_records
    WHERE section = 'Official World Records'
    ORDER BY sort_order ASC
  `),

  listHighestScores: db.prepare(`
    SELECT sort_order, section, subsection, division, year, rank,
           player_1, player_2, score, note, event_date, event_name, location
    FROM consecutive_kicks_records
    WHERE section = 'Highest Official Scores'
    ORDER BY sort_order ASC
  `),

  listProgression: db.prepare(`
    SELECT sort_order, section, subsection, division, year, rank,
           player_1, player_2, score, note, event_date, event_name, location
    FROM consecutive_kicks_records
    WHERE section = 'World Record Progression'
    ORDER BY sort_order ASC
  `),

  listMilestones: db.prepare(`
    SELECT sort_order, section, subsection, division, year, rank,
           player_1, player_2, score, note, event_date, event_name, location
    FROM consecutive_kicks_records
    WHERE section = 'Milestone Firsts'
    ORDER BY sort_order ASC
  `),

  countBySection: db.prepare(`
    SELECT section, COUNT(*) AS n
    FROM consecutive_kicks_records
    GROUP BY section
    ORDER BY MIN(sort_order)
  `),
} as const;

// ---------------------------------------------------------------------------
// netTeams
//
// Net domain enrichment layer, additive, never modifies canonical tables.
// Evidence class: canonical_only only in phase 1.
//
// STATISTICS FIREWALL: all appearance queries use the net_team_appearance_canonical
// view, which enforces evidence_class = 'canonical_only' at the DB layer.
// Never query net_team_appearance directly from this statement group.
//
// Consumed by /net/teams and /net/teams/:teamId (netService.getTeamsPage,
// getTeamDetailPage) and by the /net home notable-teams buckets.
// ---------------------------------------------------------------------------
export interface NetTeamSummaryRow {
  team_id:          string;
  person_id_a:      string;
  person_name_a:    string;
  country_a:        string | null;
  member_slug_a:    string | null;
  person_id_b:      string;
  person_name_b:    string;
  country_b:        string | null;
  member_slug_b:    string | null;
  first_year:       number | null;
  last_year:        number | null;
  appearance_count: number;
}

export interface NetTeamAppearanceRow {
  appearance_id:        string;
  event_id:             string;
  event_tag_normalized: string;       // #event_{year}_{slug} — used to build /events/ hrefs
  event_title:          string;
  event_city:           string;
  event_country:        string;
  start_date:           string;
  discipline_name:      string;
  canonical_group:      string | null;
  conflict_flag:        number;       // 0 or 1 — 1 = use raw discipline_name
  placement:            number;
  score_text:           string | null;
  event_year:           number;
}

export interface NetTeamStatsRow {
  team_id:          string;
  person_id_a:      string;
  person_name_a:    string;
  country_a:        string | null;
  member_slug_a:    string | null;
  person_id_b:      string;
  person_name_b:    string;
  country_b:        string | null;
  member_slug_b:    string | null;
  appearance_count: number;
  win_count:        number;
  podium_count:     number;
  first_year:       number | null;
  last_year:        number | null;
}

export interface NetDivisionOptionRow {
  canonical_group:  string;
  appearance_count: number;
}

export const netTeams = {
  // STATS FIREWALL: queries net_team_appearance_canonical view (canonical_only enforced at DB layer)

  getById: db.prepare(`
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      ma.slug         AS member_slug_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      mb.slug         AS member_slug_b,
      t.first_year,
      t.last_year,
      t.appearance_count
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    WHERE t.team_id = ?
  `),

  listAppearancesByTeamId: db.prepare(`
    SELECT
      a.id            AS appearance_id,
      a.event_id,
      t.tag_normalized AS event_tag_normalized,
      e.title         AS event_title,
      e.city          AS event_city,
      e.country       AS event_country,
      e.start_date,
      ed.name         AS discipline_name,
      dg.canonical_group,
      COALESCE(dg.conflict_flag, 0) AS conflict_flag,
      a.placement,
      a.score_text,
      a.event_year
    FROM net_team_appearance_canonical a
    JOIN events e           ON e.id  = a.event_id
    JOIN tags t             ON t.id  = e.hashtag_tag_id
    JOIN event_disciplines ed ON ed.id = a.discipline_id
    LEFT JOIN net_discipline_group dg ON dg.discipline_id = a.discipline_id
    WHERE a.team_id = ?
    ORDER BY a.event_year DESC, e.start_date DESC, a.placement ASC
  `),

  /** All net teams (with ≥1 canonical appearance), sorted by appearance count desc.
   *  No HAVING threshold and no LIMIT: this is the single public entry for browsing
   *  all teams, with division/search filters handled via queryFilteredTeams. */
  listAll: db.prepare(`
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      MAX(ma.slug)    AS member_slug_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      MAX(mb.slug)    AS member_slug_b,
      COUNT(*)                                              AS appearance_count,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END)    AS win_count,
      SUM(CASE WHEN a.placement <= 3 THEN 1 ELSE 0 END)   AS podium_count,
      MIN(a.event_year)                                     AS first_year,
      MAX(a.event_year)                                     AS last_year
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN net_team_appearance_canonical a ON a.team_id = t.team_id
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    WHERE pa.person_name != 'Unknown' AND pb.person_name != 'Unknown'
    GROUP BY t.team_id
    ORDER BY appearance_count DESC, win_count DESC, last_year DESC, pa.person_name ASC
  `),

  /** Division filter options, distinct canonical groups with appearance counts. */
  listDivisionOptions: db.prepare(`
    SELECT dg.canonical_group, COUNT(DISTINCT a.id) AS appearance_count
    FROM net_discipline_group dg
    JOIN net_team_appearance_canonical a ON a.discipline_id = dg.discipline_id
    WHERE dg.conflict_flag = 0
    GROUP BY dg.canonical_group
    ORDER BY appearance_count DESC
  `),

  /** Wider pool for notable-team buckets, top 100 with >=3 appearances. */
  listNotablePool: db.prepare(`
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      MAX(ma.slug)    AS member_slug_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      MAX(mb.slug)    AS member_slug_b,
      COUNT(*)                                              AS appearance_count,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END)    AS win_count,
      SUM(CASE WHEN a.placement <= 3 THEN 1 ELSE 0 END)   AS podium_count,
      MIN(a.event_year)                                     AS first_year,
      MAX(a.event_year)                                     AS last_year
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN net_team_appearance_canonical a ON a.team_id = t.team_id
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    WHERE pa.person_name != 'Unknown' AND pb.person_name != 'Unknown'
    GROUP BY t.team_id
    HAVING COUNT(*) >= 3
    ORDER BY appearance_count DESC
    LIMIT 100
  `),
} as const;

/**
 * Dynamic team query with optional division (canonical_group) and player-search
 * filters. Uses runtime db.prepare() for the optional JOIN clause.
 */
export function queryFilteredTeams(filters: {
  division?: string;
  search?: string;
}): NetTeamStatsRow[] {
  const joins: string[] = [];
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.division) {
    joins.push('JOIN net_discipline_group dg ON dg.discipline_id = a.discipline_id AND dg.canonical_group = ?');
    params.push(filters.division);
  }
  if (filters.search) {
    conditions.push("(pa.person_name LIKE ? OR pb.person_name LIKE ?)");
    const like = `%${filters.search}%`;
    params.push(like, like);
  }

  // Always exclude Unknown placeholder
  conditions.push("pa.person_name != 'Unknown'");
  conditions.push("pb.person_name != 'Unknown'");

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      MAX(ma.slug)    AS member_slug_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      MAX(mb.slug)    AS member_slug_b,
      COUNT(*)                                              AS appearance_count,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END)    AS win_count,
      SUM(CASE WHEN a.placement <= 3 THEN 1 ELSE 0 END)   AS podium_count,
      MIN(a.event_year)                                     AS first_year,
      MAX(a.event_year)                                     AS last_year
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN net_team_appearance_canonical a ON a.team_id = t.team_id
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    ${joins.join('\n    ')}
    ${where}
    GROUP BY t.team_id
    HAVING COUNT(*) >= 2
    ORDER BY appearance_count DESC, win_count DESC, last_year DESC, pa.person_name ASC
    LIMIT 50
  `).all(...params) as NetTeamStatsRow[];
}

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netRecoverySignals
//
// Internal-only diagnostic queries for identity recovery.
// Detects stub persons (auto-generated, no real PT entry) by checking
// event_count IS NULL or 0. These are persons the seed builder created
// as placeholders for unresolved canonical participants.
// Route: /internal/net/recovery-signals
// ---------------------------------------------------------------------------

export interface RecoveryPartnerRepeatRow {
  known_player:      string;
  known_pid:         string;
  known_member_slug: string | null;
  stub_partner:      string;
  stub_pid:          string;
  co_count:          number;
  years:             string;
}

export interface RecoveryAbbreviationRow {
  stub_name:          string;
  stub_pid:           string;
  likely_match:       string;
  likely_pid:         string;
  likely_member_slug: string | null;
}

export interface RecoveryHighValueRow {
  person_name:  string;
  person_id:    string;
  appearances:  number;
  event_count:  number;
  years:        string;
}

export const netRecoverySignals = {
  /** Doubles entries where a known player is partnered with a stub person. */
  listUnresolvedPartnerRepeats: db.prepare(`
    SELECT
      hp_known.person_name AS known_player,
      hp_known.person_id   AS known_pid,
      MAX(m_known.slug)    AS known_member_slug,
      hp_stub.person_name  AS stub_partner,
      hp_stub.person_id    AS stub_pid,
      COUNT(DISTINCT p_stub.result_entry_id) AS co_count,
      GROUP_CONCAT(DISTINCT SUBSTR(ev.start_date, 1, 4)) AS years
    FROM event_result_entry_participants p_known
    JOIN event_result_entry_participants p_stub
      ON p_stub.result_entry_id = p_known.result_entry_id
      AND p_stub.id != p_known.id
    JOIN historical_persons hp_known ON hp_known.person_id = p_known.historical_person_id
    JOIN historical_persons hp_stub  ON hp_stub.person_id  = p_stub.historical_person_id
    JOIN event_result_entries re ON re.id = p_known.result_entry_id
    JOIN event_disciplines ed   ON ed.id = re.discipline_id AND ed.team_type = 'doubles'
    JOIN events ev              ON ev.id = re.event_id
    LEFT JOIN members m_known
      ON m_known.historical_person_id = hp_known.person_id
      AND m_known.deleted_at IS NULL
    WHERE hp_known.event_count > 0
      AND (hp_stub.event_count IS NULL OR hp_stub.event_count = 0)
      AND hp_stub.person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
    GROUP BY hp_known.person_id, hp_stub.person_id
    ORDER BY co_count DESC
    LIMIT 30
  `),

  /** Stub names that share a last name (4+ chars) with a known person.
   *  Initial+lastname abbreviation detection. */
  listAbbreviationClusters: db.prepare(`
    SELECT
      hp_stub.person_name  AS stub_name,
      hp_stub.person_id    AS stub_pid,
      hp_known.person_name AS likely_match,
      hp_known.person_id   AS likely_pid,
      m_likely.slug        AS likely_member_slug
    FROM historical_persons hp_stub
    JOIN historical_persons hp_known
      ON LOWER(SUBSTR(hp_known.person_name,
                      INSTR(hp_known.person_name, ' ') + 1))
         = LOWER(SUBSTR(hp_stub.person_name,
                        INSTR(hp_stub.person_name, ' ') + 1))
    LEFT JOIN members m_likely
      ON m_likely.historical_person_id = hp_known.person_id
      AND m_likely.deleted_at IS NULL
    WHERE (hp_stub.event_count IS NULL OR hp_stub.event_count = 0)
      AND hp_known.event_count > 0
      AND hp_stub.person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
      AND INSTR(hp_stub.person_name, ' ') > 0
      AND INSTR(hp_known.person_name, ' ') > 0
      AND LENGTH(SUBSTR(hp_known.person_name,
                        INSTR(hp_known.person_name, ' ') + 1)) >= 4
      AND LENGTH(hp_stub.person_name) < LENGTH(hp_known.person_name)
      AND LOWER(SUBSTR(hp_known.person_name, 1, 1))
          = LOWER(SUBSTR(REPLACE(hp_stub.person_name, '.', ''), 1, 1))
    ORDER BY hp_stub.person_name, hp_known.person_name
  `),

  /** Top stub persons by appearance count. */
  listHighValueCandidates: db.prepare(`
    SELECT
      hp.person_name,
      hp.person_id,
      COUNT(DISTINCT p.result_entry_id) AS appearances,
      COUNT(DISTINCT re.event_id)       AS event_count,
      GROUP_CONCAT(DISTINCT SUBSTR(ev.start_date, 1, 4)) AS years
    FROM historical_persons hp
    JOIN event_result_entry_participants p ON p.historical_person_id = hp.person_id
    JOIN event_result_entries re           ON re.id = p.result_entry_id
    JOIN events ev                        ON ev.id = re.event_id
    WHERE (hp.event_count IS NULL OR hp.event_count = 0)
      AND hp.person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
    GROUP BY hp.person_id
    ORDER BY appearances DESC
    LIMIT 30
  `),

  /** Total stub person count. */
  countStubs: db.prepare(`
    SELECT COUNT(*) AS stub_count
    FROM historical_persons
    WHERE (event_count IS NULL OR event_count = 0)
      AND person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
  `),
} as const;

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netRecoveryCandidates
//
// Internal-only: generates structured alias candidates from recovery signals.
// Route: /internal/net/recovery-candidates
// ---------------------------------------------------------------------------

export interface RecoveryCandidateAbbrevRow {
  stub_name:    string;
  stub_pid:     string;
  match_name:   string;
  match_pid:    string;
  match_count:  number;   // how many known persons share that last name + initial
  stub_appearances: number;
}

export interface RecoveryCandidateFreqRow {
  person_name:  string;
  person_id:    string;
  appearances:  number;
  event_count:  number;
  years:        string;
}

export const netRecoveryCandidates = {
  /** Unambiguous abbreviation candidates: stub shares last name + first initial
   *  with exactly ONE known person. */
  listAbbreviationCandidates: db.prepare(`
    SELECT
      hp_stub.person_name  AS stub_name,
      hp_stub.person_id    AS stub_pid,
      hp_known.person_name AS match_name,
      hp_known.person_id   AS match_pid,
      (SELECT COUNT(DISTINCT p.result_entry_id)
       FROM event_result_entry_participants p
       WHERE p.historical_person_id = hp_stub.person_id) AS stub_appearances
    FROM historical_persons hp_stub
    JOIN historical_persons hp_known
      ON LOWER(SUBSTR(hp_known.person_name, INSTR(hp_known.person_name, ' ') + 1))
       = LOWER(SUBSTR(hp_stub.person_name, INSTR(hp_stub.person_name, ' ') + 1))
    WHERE (hp_stub.event_count IS NULL OR hp_stub.event_count = 0)
      AND hp_known.event_count > 0
      AND hp_stub.person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
      AND INSTR(hp_stub.person_name, ' ') > 0
      AND INSTR(hp_known.person_name, ' ') > 0
      AND LENGTH(SUBSTR(hp_known.person_name, INSTR(hp_known.person_name, ' ') + 1)) >= 4
      AND LENGTH(hp_stub.person_name) < LENGTH(hp_known.person_name)
      AND LOWER(SUBSTR(hp_known.person_name, 1, 1))
          = LOWER(SUBSTR(REPLACE(hp_stub.person_name, '.', ''), 1, 1))
      AND (SELECT COUNT(DISTINCT hp2.person_id)
           FROM historical_persons hp2
           WHERE hp2.event_count > 0
             AND LOWER(SUBSTR(hp2.person_name, INSTR(hp2.person_name, ' ') + 1))
               = LOWER(SUBSTR(hp_stub.person_name, INSTR(hp_stub.person_name, ' ') + 1))
             AND INSTR(hp2.person_name, ' ') > 0
             AND LENGTH(SUBSTR(hp2.person_name, INSTR(hp2.person_name, ' ') + 1)) >= 4
             AND LENGTH(hp_stub.person_name) < LENGTH(hp2.person_name)
             AND LOWER(SUBSTR(hp2.person_name, 1, 1))
                 = LOWER(SUBSTR(REPLACE(hp_stub.person_name, '.', ''), 1, 1))
          ) = 1
    ORDER BY stub_appearances DESC, hp_stub.person_name ASC
  `),

  /** High-frequency stubs (>=3 appearances), likely real persons needing PT entries. */
  listHighFrequencyStubs: db.prepare(`
    SELECT
      hp.person_name,
      hp.person_id,
      COUNT(DISTINCT p.result_entry_id) AS appearances,
      COUNT(DISTINCT re.event_id)       AS event_count,
      GROUP_CONCAT(DISTINCT SUBSTR(ev.start_date, 1, 4)) AS years
    FROM historical_persons hp
    JOIN event_result_entry_participants p ON p.historical_person_id = hp.person_id
    JOIN event_result_entries re           ON re.id = p.result_entry_id
    JOIN events ev                        ON ev.id = re.event_id
    WHERE (hp.event_count IS NULL OR hp.event_count = 0)
      AND hp.person_name NOT IN ('[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__', '__NON_PERSON__', 'Unknown', '')
    GROUP BY hp.person_id
    HAVING appearances >= 3
    ORDER BY appearances DESC
  `),
} as const;

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netTeamCorrectionApproval
//
// Internal-only: operator approval for team anomaly corrections.
// Route: /internal/net/team-corrections
// ---------------------------------------------------------------------------

export const netTeamCorrectionApproval = {
  upsertCandidate: db.prepare(`
    INSERT INTO net_team_correction_candidate
      (id, event_key, discipline_key, placement, original_display, anomaly_type,
       suggested_player_a, suggested_player_b, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(event_key, discipline_key, placement) DO UPDATE SET
      original_display   = excluded.original_display,
      anomaly_type       = excluded.anomaly_type,
      suggested_player_a = COALESCE(net_team_correction_candidate.suggested_player_a, excluded.suggested_player_a),
      suggested_player_b = COALESCE(net_team_correction_candidate.suggested_player_b, excluded.suggested_player_b)
  `),

  getById: db.prepare(`SELECT id FROM net_team_correction_candidate WHERE id = ?`),

  updateDecision: db.prepare(`
    UPDATE net_team_correction_candidate
    SET decision       = ?,
        suggested_player_a = ?,
        suggested_player_b = ?,
        decision_notes = ?,
        decided_by     = ?,
        decided_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `),

  listAll: db.prepare(`
    SELECT id, event_key, discipline_key, placement, original_display, anomaly_type,
           suggested_player_a, suggested_player_b, decision, decision_notes
    FROM net_team_correction_candidate
    ORDER BY
      CASE decision WHEN 'approve' THEN 0 WHEN 'defer' THEN 1 ELSE 2 END,
      event_key, placement
  `),

  listApproved: db.prepare(`
    SELECT event_key, discipline_key, placement, original_display,
           suggested_player_a, suggested_player_b, anomaly_type, decision_notes
    FROM net_team_correction_candidate
    WHERE decision = 'approve'
      AND suggested_player_a IS NOT NULL AND suggested_player_a != ''
      AND suggested_player_b IS NOT NULL AND suggested_player_b != ''
    ORDER BY event_key, discipline_key, CAST(placement AS INTEGER)
  `),
} as const;

// ---------------------------------------------------------------------------
// netRecoveryApproval
//
// Internal-only: operator approval workflow for recovery alias candidates.
// Route: /internal/net/recovery-candidates
// ---------------------------------------------------------------------------

export interface RecoveryAliasCandidateRow {
  id:                     string;
  stub_name:              string;
  stub_person_id:         string;
  suggested_person_id:    string;
  suggested_person_name:  string;
  suggested_member_slug:  string | null;
  suggestion_type:        string;
  confidence:             string;
  appearance_count:       number;
  operator_decision:      string | null;
  operator_notes:         string | null;
  reviewed_by:            string | null;
  reviewed_at:            string | null;
}

export const netRecoveryApproval = {
  listAll: db.prepare(`
    SELECT rac.id, rac.stub_name, rac.stub_person_id,
           rac.suggested_person_id, rac.suggested_person_name,
           m_sug.slug AS suggested_member_slug,
           rac.suggestion_type, rac.confidence, rac.appearance_count,
           rac.operator_decision, rac.operator_notes, rac.reviewed_by, rac.reviewed_at
    FROM net_recovery_alias_candidate rac
    LEFT JOIN members m_sug
      ON m_sug.historical_person_id = rac.suggested_person_id
      AND m_sug.deleted_at IS NULL
    ORDER BY rac.appearance_count DESC, rac.stub_name ASC
  `),

  getById: db.prepare(`
    SELECT id FROM net_recovery_alias_candidate WHERE id = ?
  `),

  upsertCandidate: db.prepare(`
    INSERT INTO net_recovery_alias_candidate
      (id, stub_name, stub_person_id, suggested_person_id, suggested_person_name,
       suggestion_type, confidence, appearance_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(id) DO UPDATE SET
      appearance_count = excluded.appearance_count,
      suggested_person_name = excluded.suggested_person_name
  `),

  updateDecision: db.prepare(`
    UPDATE net_recovery_alias_candidate
    SET operator_decision = ?,
        operator_notes    = ?,
        reviewed_by       = ?,
        reviewed_at       = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `),

  listApproved: db.prepare(`
    SELECT stub_name, suggested_person_id, suggested_person_name,
           suggestion_type, operator_notes
    FROM net_recovery_alias_candidate
    WHERE operator_decision = 'approve'
    ORDER BY stub_name ASC
  `),
} as const;

// ---------------------------------------------------------------------------
// netEvents
//
// Event-centric reads for the net domain enrichment layer.
//
// STATISTICS FIREWALL: all appearance queries use the net_team_appearance_canonical
// view, which enforces evidence_class = 'canonical_only' at the DB layer.
// Never query net_team_appearance directly from this statement group.
//
// QC hints surfaced to public pages (safe summaries only, never raw review queue rows):
//   has_multi_stage_hint        = event contains multi-stage bracket results
//   unknown_team_excluded_count = count of results where team could not be linked
//   discipline_review_count     = count of disciplines flagged for review
//
// Routes: /net/events  |  /net/events/:eventId
// ---------------------------------------------------------------------------
export interface NetEventSummaryRow {
  event_id:                    string;
  event_tag_normalized:        string;   // #event_{year}_{slug} — used to build /events/ hrefs
  event_title:                 string;
  start_date:                  string;
  city:                        string;
  country:                     string;
  event_year:                  number;
  appearance_count:            number;
  discipline_count:            number;
  team_count:                  number;
  has_multi_stage_hint:        number;   // 0 or 1
  unknown_team_excluded_count: number;
  discipline_review_count:     number;
}

export interface NetEventAppearanceRow {
  appearance_id:   string;
  team_id:         string;
  person_id_a:     string;
  person_name_a:   string;
  country_a:       string | null;
  member_slug_a:   string | null;
  person_id_b:     string;
  person_name_b:   string;
  country_b:       string | null;
  member_slug_b:   string | null;
  discipline_id:   string;
  discipline_name: string;
  canonical_group: string | null;
  conflict_flag:   number;
  placement:       number;
  score_text:      string | null;
  event_year:      number;
}

const EVENT_SUMMARY_SELECT = `
    SELECT
      e.id                            AS event_id,
      t.tag_normalized                AS event_tag_normalized,
      e.title                         AS event_title,
      e.start_date,
      e.city,
      e.country,
      CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER) AS event_year,
      COUNT(a.id)                     AS appearance_count,
      COUNT(DISTINCT a.discipline_id) AS discipline_count,
      COUNT(DISTINCT a.team_id)       AS team_count,
      COALESCE((
        SELECT 1 FROM net_review_queue rq
        WHERE rq.event_id = e.id AND rq.reason_code = 'multi_stage_result' LIMIT 1
      ), 0) AS has_multi_stage_hint,
      (
        SELECT COUNT(*) FROM net_review_queue rq
        WHERE rq.event_id = e.id AND rq.reason_code = 'unknown_team'
      ) AS unknown_team_excluded_count,
      (
        SELECT COUNT(DISTINCT disc_id) FROM (
          SELECT a2.discipline_id AS disc_id
          FROM net_team_appearance_canonical a2
          JOIN net_discipline_group dg ON dg.discipline_id = a2.discipline_id
          WHERE a2.event_id = e.id AND dg.conflict_flag = 1
          UNION
          SELECT rq2.discipline_id AS disc_id
          FROM net_review_queue rq2
          WHERE rq2.event_id = e.id AND rq2.reason_code = 'discipline_team_type_mismatch'
            AND rq2.discipline_id IS NOT NULL
        )
      ) AS discipline_review_count
    FROM events e
    JOIN tags t                          ON t.id = e.hashtag_tag_id
    JOIN net_team_appearance_canonical a ON a.event_id = e.id
`;

export const netEvents = {
  // STATS FIREWALL: all appearance joins use net_team_appearance_canonical view.

  listEvents: db.prepare(
    EVENT_SUMMARY_SELECT + `
    GROUP BY e.id
    ORDER BY e.start_date DESC, e.title ASC
  `),

  getEventSummary: db.prepare(
    EVENT_SUMMARY_SELECT + `
    WHERE e.id = ?
    GROUP BY e.id
  `),

  listAppearancesByEventId: db.prepare(`
    -- STATS FIREWALL: uses net_team_appearance_canonical view
    SELECT
      a.id              AS appearance_id,
      a.team_id,
      t.person_id_a,
      pa.person_name    AS person_name_a,
      pa.country        AS country_a,
      ma.slug           AS member_slug_a,
      t.person_id_b,
      pb.person_name    AS person_name_b,
      pb.country        AS country_b,
      mb.slug           AS member_slug_b,
      a.discipline_id,
      ed.name           AS discipline_name,
      dg.canonical_group,
      COALESCE(dg.conflict_flag, 0) AS conflict_flag,
      a.placement,
      a.score_text,
      a.event_year
    FROM net_team_appearance_canonical a
    JOIN net_team t           ON t.team_id    = a.team_id
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN event_disciplines ed  ON ed.id        = a.discipline_id
    LEFT JOIN net_discipline_group dg ON dg.discipline_id = a.discipline_id
    LEFT JOIN members ma
      ON ma.historical_person_id = pa.person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = pb.person_id
      AND mb.deleted_at IS NULL
    WHERE a.event_id = ?
    ORDER BY ed.name ASC, a.placement ASC
  `),
} as const;

// ---------------------------------------------------------------------------
// netHome
//
// Summary queries for the /net landing page.
//
// STATISTICS FIREWALL: all queries use net_team_appearance_canonical.
// No inferred data, no rankings, no match-level reconstruction.
//
// Route: /net
// ---------------------------------------------------------------------------
export interface NetHomeTopTeamRow {
  team_id:          string;
  person_id_a:      string;
  person_name_a:    string;
  country_a:        string | null;
  person_id_b:      string;
  person_name_b:    string;
  country_b:        string | null;
  first_year:       number | null;
  last_year:        number | null;
  appearance_count: number;
  win_count:        number;
  podium_count:     number;
  best_placement:   number;
}

export interface NetHomeTopPlayerRow {
  person_id:        string;
  person_name:      string;
  country:          string | null;
  partner_count:    number;
  appearance_count: number;
}

export interface NetNotablePlayerRow {
  person_id:         string;
  person_name:       string;
  country:           string | null;
  member_slug:       string | null;
  total_appearances: number;
  total_wins:        number;
  total_podiums:     number;
  first_year:        number | null;
  last_year:         number | null;
  partner_count:     number;
}

export interface NetHomeRecentEventRow {
  event_id:             string;
  event_tag_normalized: string;   // #event_{year}_{slug} — used to build /events/ hrefs
  event_title:          string;
  start_date:           string;
  event_year:           number;
  appearance_count:     number;
  has_multi_stage_hint: number;   // 0 or 1
}

export interface NetHomeInterestingTeamRow {
  team_id:          string;
  person_id_a:      string;
  person_name_a:    string;
  country_a:        string | null;
  person_id_b:      string;
  person_name_b:    string;
  country_b:        string | null;
  first_year:       number | null;
  last_year:        number | null;
  appearance_count: number;
  year_span_length: number;
  win_count:        number;
  best_placement:   number;
}

export const netHome = {
  // STATS FIREWALL: all queries use net_team_appearance_canonical view.

  getTopTeams: db.prepare(`
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      t.first_year,
      t.last_year,
      t.appearance_count,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END) AS win_count,
      SUM(CASE WHEN a.placement <= 3 THEN 1 ELSE 0 END) AS podium_count,
      MIN(a.placement) AS best_placement
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN net_team_appearance_canonical a ON a.team_id = t.team_id
    WHERE pa.person_name != 'Unknown' AND pb.person_name != 'Unknown'
    GROUP BY t.team_id
    ORDER BY t.appearance_count DESC, t.last_year DESC
    LIMIT 10
  `),

  getTopPlayersByPartners: db.prepare(`
    -- STATS FIREWALL: counts partners only from canonical appearances.
    -- Uses team_id count as partner proxy (each team = one unique partner).
    -- Avoids expensive self-join on net_team_member.
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      COUNT(DISTINCT nm.team_id) AS partner_count,
      COUNT(a.id)                AS appearance_count
    FROM historical_persons hp
    JOIN net_team_member nm ON nm.person_id = hp.person_id
    JOIN net_team_appearance_canonical a ON a.team_id = nm.team_id
    GROUP BY hp.person_id
    ORDER BY partner_count DESC, appearance_count DESC
    LIMIT 10
  `),

  getRecentEvents: db.prepare(`
    -- STATS FIREWALL: only events with canonical appearances
    SELECT
      e.id                                AS event_id,
      t.tag_normalized                    AS event_tag_normalized,
      e.title                             AS event_title,
      e.start_date,
      CAST(SUBSTR(e.start_date, 1, 4) AS INTEGER) AS event_year,
      COUNT(a.id)                         AS appearance_count,
      COALESCE((
        SELECT 1 FROM net_review_queue rq
        WHERE rq.event_id = e.id AND rq.reason_code = 'multi_stage_result' LIMIT 1
      ), 0) AS has_multi_stage_hint
    FROM events e
    JOIN tags t                          ON t.id = e.hashtag_tag_id
    JOIN net_team_appearance_canonical a ON a.event_id = e.id
    GROUP BY e.id
    ORDER BY e.start_date DESC
    LIMIT 10
  `),

  getInterestingTeams: db.prepare(`
    -- Long-career teams: ordered by year span, then wins.
    -- STATS FIREWALL: uses net_team_appearance_canonical view.
    SELECT
      t.team_id,
      t.person_id_a,
      pa.person_name  AS person_name_a,
      pa.country      AS country_a,
      t.person_id_b,
      pb.person_name  AS person_name_b,
      pb.country      AS country_b,
      t.first_year,
      t.last_year,
      t.appearance_count,
      COALESCE(t.last_year, 0) - COALESCE(t.first_year, 0) AS year_span_length,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END) AS win_count,
      MIN(a.placement) AS best_placement
    FROM net_team t
    JOIN historical_persons pa ON pa.person_id = t.person_id_a
    JOIN historical_persons pb ON pb.person_id = t.person_id_b
    JOIN net_team_appearance_canonical a ON a.team_id = t.team_id
    WHERE t.first_year IS NOT NULL AND t.last_year IS NOT NULL
      AND pa.person_name != 'Unknown' AND pb.person_name != 'Unknown'
    GROUP BY t.team_id
    ORDER BY year_span_length DESC, win_count DESC, best_placement ASC
    LIMIT 10
  `),

  /** Player aggregate pool for notable player buckets, top 100 by appearances. */
  listNotablePlayerPool: db.prepare(`
    -- STATS FIREWALL: uses net_team_appearance_canonical view.
    -- Uses team_id count as partner proxy — avoids expensive self-join.
    SELECT
      hp.person_id,
      hp.person_name,
      hp.country,
      MAX(m.slug)                                            AS member_slug,
      COUNT(a.id)                                            AS total_appearances,
      SUM(CASE WHEN a.placement = 1 THEN 1 ELSE 0 END)     AS total_wins,
      SUM(CASE WHEN a.placement <= 3 THEN 1 ELSE 0 END)    AS total_podiums,
      MIN(a.event_year)                                      AS first_year,
      MAX(a.event_year)                                      AS last_year,
      COUNT(DISTINCT nm.team_id)                             AS partner_count
    FROM historical_persons hp
    JOIN net_team_member nm ON nm.person_id = hp.person_id
    JOIN net_team_appearance_canonical a ON a.team_id = nm.team_id
    LEFT JOIN members m
      ON m.historical_person_id = hp.person_id
      AND m.deleted_at IS NULL
    WHERE hp.person_name NOT IN ('Unknown', '__NON_PERSON__', '[UNKNOWN PARTNER]', '__UNKNOWN_PARTNER__')
    GROUP BY hp.person_id
    HAVING COUNT(a.id) >= 3
    ORDER BY total_appearances DESC
    LIMIT 100
  `),
} as const;

export const health = {
  checkReady: db.prepare(`
    SELECT 1 AS is_ready
  `),
} as const;

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netReview
//
// Internal / QC reads for the net enrichment review workflow.
// These queries are for operator review only; never exposed in public pages.
//
// Sources: net_review_queue, net_discipline_group, events, event_disciplines
// Route: GET /internal/net/review
// ---------------------------------------------------------------------------
export interface NetReviewSummaryRow {
  reason_code:       string | null;
  priority:          number;
  resolution_status: string;
  item_count:        number;
}

export interface NetReviewClassificationSummaryRow {
  classification: string;
  item_count:     number;
}

export interface NetReviewDecisionSummaryRow {
  decision_status: string;
  item_count:      number;
}

export interface NetReviewFixTypeSummaryRow {
  proposed_fix_type: string;
  item_count:        number;
}

export interface NetReviewTopEventRow {
  event_id:    string;
  event_title: string | null;
  item_count:  number;
}

export interface NetReviewTotalsRow {
  total:        number;
  classified:   number;
  decided:      number;
  unclassified: number;
}

export interface NetReviewItemRow {
  id:                string;
  item_type:         string;
  priority:          number;
  reason_code:       string | null;
  severity:          string;
  message:           string;
  event_id:          string | null;
  event_title:       string | null;
  discipline_id:     string | null;
  discipline_name:   string | null;
  review_stage:      string | null;
  resolution_status: string;
  imported_at:       string;
  // Classification metadata (all nullable)
  classification:             string | null;
  proposed_fix_type:          string | null;
  classification_confidence:  string | null;
  decision_status:            string | null;
  decision_notes:             string | null;
  classified_by:              string | null;
  classified_at:              string | null;
}

export interface NetReviewEventContextRow {
  event_id:   string;
  title:      string;
  start_date: string;
  city:       string;
  country:    string;
}

export interface NetReviewConflictDisciplineRow {
  discipline_id:   string;
  discipline_name: string;
  canonical_group: string;
  conflict_flag:   number;
  review_needed:   number;
  match_method:    string;
}

export interface NetReviewFilters {
  reason_code?:       string;
  priority?:          number;
  resolution_status?: string;
  event_id?:          string;
  classification?:    string;
  proposed_fix_type?: string;
  decision_status?:   string;
  limit?:             number;
  offset?:            number;
}

export const netReview = {
  listReviewSummary: db.prepare(`
    SELECT reason_code, priority, resolution_status, COUNT(*) AS item_count
    FROM net_review_queue
    GROUP BY reason_code, priority, resolution_status
    ORDER BY priority ASC, reason_code ASC, resolution_status ASC
  `),

  getReviewEventContext: db.prepare(`
    SELECT id AS event_id, title, start_date, city, country
    FROM events WHERE id = ?
  `),

  listConflictDisciplines: db.prepare(`
    SELECT
      dg.discipline_id,
      ed.name   AS discipline_name,
      dg.canonical_group,
      dg.conflict_flag,
      dg.review_needed,
      dg.match_method
    FROM net_discipline_group dg
    JOIN event_disciplines ed ON ed.id = dg.discipline_id
    WHERE dg.conflict_flag = 1 OR dg.review_needed = 1
    ORDER BY dg.conflict_flag DESC, dg.review_needed DESC, ed.name ASC
  `),

  listClassificationSummary: db.prepare(`
    SELECT classification, COUNT(*) AS item_count
    FROM net_review_queue
    WHERE classification IS NOT NULL
    GROUP BY classification
    ORDER BY item_count DESC
  `),

  listDecisionSummary: db.prepare(`
    SELECT decision_status, COUNT(*) AS item_count
    FROM net_review_queue
    WHERE decision_status IS NOT NULL
    GROUP BY decision_status
    ORDER BY item_count DESC
  `),

  getReviewItemById: db.prepare(`
    SELECT id FROM net_review_queue WHERE id = ?
  `),

  listFixTypeSummary: db.prepare(`
    SELECT proposed_fix_type, COUNT(*) AS item_count
    FROM net_review_queue
    WHERE proposed_fix_type IS NOT NULL
    GROUP BY proposed_fix_type
    ORDER BY item_count DESC
  `),

  listActionableFixSummary: db.prepare(`
    SELECT proposed_fix_type, COUNT(*) AS item_count
    FROM net_review_queue
    WHERE decision_status IN ('fix_encoded', 'fix_active')
      AND proposed_fix_type IS NOT NULL
    GROUP BY proposed_fix_type
    ORDER BY item_count DESC
  `),

  listTopEventIssues: db.prepare(`
    SELECT rq.event_id, e.title AS event_title, COUNT(*) AS item_count
    FROM net_review_queue rq
    LEFT JOIN events e ON e.id = rq.event_id
    WHERE rq.event_id IS NOT NULL
    GROUP BY rq.event_id
    ORDER BY item_count DESC
    LIMIT 20
  `),

  countTotals: db.prepare(`
    SELECT
      COUNT(*)                                              AS total,
      COUNT(classification)                                 AS classified,
      COUNT(CASE WHEN decision_status IS NOT NULL THEN 1 END) AS decided,
      COUNT(CASE WHEN classification IS NULL THEN 1 END)   AS unclassified
    FROM net_review_queue
  `),
} as const;

/**
 * Dynamic query for review items with optional filtering.
 * Uses runtime db.prepare() since filter combinations are not enumerable.
 * Acceptable for a low-frequency internal review tool.
 */
// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netCandidates
//
// Internal / operator reads for the net candidate match review page.
// These queries are operator-only; never exposed in public pages.
// All rows have evidence_class = 'unresolved_candidate'.
// ---------------------------------------------------------------------------

export interface NetCandidateSummaryRow {
  review_status:    string;
  linked_count:     number;
  total_count:      number;
}

export interface NetCandidateSourceSummaryRow {
  source_file:            string;
  fragment_count:         number;
  candidate_count:        number;
  high_conf_count:        number;
  medium_conf_count:      number;
  low_conf_count:         number;
  linked_candidate_count: number;
}

export interface NetCandidateEventSummaryRow {
  event_id:               string | null;
  event_title:            string | null;
  candidate_count:        number;
  linked_candidate_count: number;
  avg_confidence:         number | null;
  year_hint:              number | null;
}

export interface NetCandidateYearSummaryRow {
  year_hint:              number | null;
  candidate_count:        number;
  linked_candidate_count: number;
  avg_confidence:         number | null;
}

export interface NetCandidateRow {
  candidate_id:        string;
  fragment_id:         string | null;
  event_id:            string | null;
  discipline_id:       string | null;
  player_a_raw_name:   string | null;
  player_b_raw_name:   string | null;
  player_a_person_id:  string | null;
  player_b_person_id:  string | null;
  raw_text:            string;
  extracted_score:     string | null;
  round_hint:          string | null;
  year_hint:           number | null;
  confidence_score:    number | null;
  review_status:       string;
  imported_at:         string;
  source_file:         string | null;
  event_title:         string | null;
  person_name_a:       string | null;
  person_name_b:       string | null;
  member_slug_a:       string | null;
  member_slug_b:       string | null;
}

export interface NetCandidateFilters {
  review_status?:  string;
  event_id?:       string;
  source_file?:    string;
  linked_only?:    boolean;
  min_confidence?: number;
  limit?:          number;
  offset?:         number;
}

export const netCandidates = {
  listSummary: db.prepare(`
    SELECT
      review_status,
      SUM(CASE WHEN player_a_person_id IS NOT NULL AND player_b_person_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_count,
      COUNT(*) AS total_count
    FROM net_candidate_match
    GROUP BY review_status
    ORDER BY review_status ASC
  `),
  getTotalCount: db.prepare(`SELECT COUNT(*) AS cnt FROM net_candidate_match`),
  getTotalFragmentCount: db.prepare(`SELECT COUNT(*) AS cnt FROM net_raw_fragment`),

  listSummaryBySource: db.prepare(`
    SELECT
      f.source_file,
      COUNT(DISTINCT f.id) AS fragment_count,
      COUNT(c.candidate_id) AS candidate_count,
      SUM(CASE WHEN c.confidence_score >= 0.85 THEN 1 ELSE 0 END) AS high_conf_count,
      SUM(CASE WHEN c.confidence_score >= 0.70 AND c.confidence_score < 0.85 THEN 1 ELSE 0 END) AS medium_conf_count,
      SUM(CASE WHEN c.confidence_score IS NOT NULL AND c.confidence_score < 0.70 THEN 1 ELSE 0 END) AS low_conf_count,
      SUM(CASE WHEN c.player_a_person_id IS NOT NULL AND c.player_b_person_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_candidate_count
    FROM net_raw_fragment f
    LEFT JOIN net_candidate_match c ON c.fragment_id = f.id
    GROUP BY f.source_file
    ORDER BY candidate_count DESC, fragment_count DESC
  `),

  listSummaryByEvent: db.prepare(`
    SELECT
      c.event_id,
      e.title AS event_title,
      COUNT(*) AS candidate_count,
      SUM(CASE WHEN c.player_a_person_id IS NOT NULL AND c.player_b_person_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_candidate_count,
      AVG(c.confidence_score) AS avg_confidence,
      c.year_hint
    FROM net_candidate_match c
    LEFT JOIN events e ON e.id = c.event_id
    WHERE c.event_id IS NOT NULL
    GROUP BY c.event_id
    ORDER BY candidate_count DESC, c.event_id ASC
  `),

  listSummaryByYear: db.prepare(`
    SELECT
      c.year_hint,
      COUNT(*) AS candidate_count,
      SUM(CASE WHEN c.player_a_person_id IS NOT NULL AND c.player_b_person_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_candidate_count,
      AVG(c.confidence_score) AS avg_confidence
    FROM net_candidate_match c
    WHERE c.year_hint IS NOT NULL
    GROUP BY c.year_hint
    ORDER BY c.year_hint ASC
  `),
} as const;

/**
 * Dynamic candidate query, filter by review_status, event_id, linked_only.
 * Uses runtime db.prepare() since filter combinations are not enumerable.
 * Acceptable for a low-frequency internal review tool.
 */
export function queryCandidateItems(filters: NetCandidateFilters): NetCandidateRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.review_status) {
    conditions.push('c.review_status = ?');
    params.push(filters.review_status);
  }
  if (filters.event_id) {
    conditions.push('c.event_id = ?');
    params.push(filters.event_id);
  }
  if (filters.source_file) {
    conditions.push('f.source_file = ?');
    params.push(filters.source_file);
  }
  if (filters.linked_only) {
    conditions.push('c.player_a_person_id IS NOT NULL AND c.player_b_person_id IS NOT NULL');
  }
  if (filters.min_confidence !== undefined) {
    conditions.push('c.confidence_score >= ?');
    params.push(filters.min_confidence);
  }

  const where  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = Math.min(filters.limit  ?? 50, 200);
  const offset = filters.offset ?? 0;
  params.push(limit, offset);

  return db.prepare(`
    SELECT
      c.candidate_id, c.fragment_id,
      c.event_id,       e.title        AS event_title,
      c.discipline_id,
      c.player_a_raw_name, c.player_b_raw_name,
      c.player_a_person_id, pa.person_name AS person_name_a,
      c.player_b_person_id, pb.person_name AS person_name_b,
      ma.slug AS member_slug_a,
      mb.slug AS member_slug_b,
      c.raw_text, c.extracted_score, c.round_hint, c.year_hint,
      c.confidence_score, c.review_status, c.imported_at,
      f.source_file
    FROM net_candidate_match c
    LEFT JOIN events            e   ON e.id            = c.event_id
    LEFT JOIN net_raw_fragment  f   ON f.id             = c.fragment_id
    LEFT JOIN historical_persons pa ON pa.person_id     = c.player_a_person_id
    LEFT JOIN historical_persons pb ON pb.person_id     = c.player_b_person_id
    LEFT JOIN members ma
      ON ma.historical_person_id = c.player_a_person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = c.player_b_person_id
      AND mb.deleted_at IS NULL
    ${where}
    ORDER BY c.confidence_score DESC, c.imported_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as NetCandidateRow[];
}

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netCurated
//
// Internal / operator statements for the candidate → curated promotion workflow.
// evidence_class for net_curated_match rows is always 'curated_enrichment'.
// Both approvals and rejections are stored for a complete audit trail.
// ---------------------------------------------------------------------------

export interface NetCuratedDetailRow {
  candidate_id:        string;
  fragment_id:         string | null;
  event_id:            string | null;
  event_title:         string | null;
  discipline_id:       string | null;
  discipline_name:     string | null;
  player_a_raw_name:   string | null;
  player_b_raw_name:   string | null;
  player_a_person_id:  string | null;
  person_name_a:       string | null;
  member_slug_a:       string | null;
  player_b_person_id:  string | null;
  person_name_b:       string | null;
  member_slug_b:       string | null;
  raw_text:            string;
  extracted_score:     string | null;
  round_hint:          string | null;
  year_hint:           number | null;
  confidence_score:    number | null;
  review_status:       string;
  imported_at:         string;
  source_file:         string | null;
}

export interface NetCuratedMatchRow {
  curated_id:         string;
  candidate_id:       string;
  curated_status:     string;
  curator_note:       string | null;
  curated_at:         string;
  curated_by:         string;
}

export const netCurated = {
  getCandidateById: db.prepare(`
    SELECT
      c.candidate_id, c.fragment_id,
      c.event_id,       e.title       AS event_title,
      c.discipline_id,  ed.name       AS discipline_name,
      c.player_a_raw_name, c.player_b_raw_name,
      c.player_a_person_id, pa.person_name AS person_name_a,
      c.player_b_person_id, pb.person_name AS person_name_b,
      ma.slug AS member_slug_a,
      mb.slug AS member_slug_b,
      c.raw_text, c.extracted_score, c.round_hint, c.year_hint,
      c.confidence_score, c.review_status, c.imported_at,
      f.source_file
    FROM net_candidate_match c
    LEFT JOIN events             e   ON e.id         = c.event_id
    LEFT JOIN event_disciplines  ed  ON ed.id        = c.discipline_id
    LEFT JOIN net_raw_fragment   f   ON f.id         = c.fragment_id
    LEFT JOIN historical_persons pa  ON pa.person_id = c.player_a_person_id
    LEFT JOIN historical_persons pb  ON pb.person_id = c.player_b_person_id
    LEFT JOIN members ma
      ON ma.historical_person_id = c.player_a_person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = c.player_b_person_id
      AND mb.deleted_at IS NULL
    WHERE c.candidate_id = ?
  `),

  getCuratedByCandidate: db.prepare(`
    SELECT curated_id, candidate_id, curated_status, curator_note, curated_at, curated_by
    FROM net_curated_match
    WHERE candidate_id = ?
  `),

  insertCuratedMatch: db.prepare(`
    INSERT INTO net_curated_match
      (curated_id, candidate_id, curated_status, evidence_class,
       event_id, discipline_id, player_a_person_id, player_b_person_id,
       extracted_score, raw_text, curator_note,
       curated_at, curated_by)
    VALUES (?, ?, ?, 'curated_enrichment', ?, ?, ?, ?, ?, ?, ?,
            strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
  `),

  updateCandidateStatus: db.prepare(`
    UPDATE net_candidate_match SET review_status = ? WHERE candidate_id = ?
  `),
} as const;

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// netCuratedBrowse
//
// Internal / operator queries for browsing the net_curated_match collection.
// Read-only. Never exposed on public pages.
// source_file and year_hint are sourced via net_candidate_match / net_raw_fragment
// because net_curated_match snapshots only the identity fields needed for audit.
// ---------------------------------------------------------------------------

export interface NetCuratedStatusSummaryRow {
  curated_status: string;
  item_count:     number;
}

export interface NetCuratedSourceSummaryRow {
  source_file:    string | null;
  curated_count:  number;
  approved_count: number;
  rejected_count: number;
}

export interface NetCuratedEventSummaryRow {
  event_id:       string;
  event_title:    string | null;
  curated_count:  number;
  approved_count: number;
  rejected_count: number;
}

export interface NetCuratedYearSummaryRow {
  year_hint:      number;
  curated_count:  number;
  approved_count: number;
  rejected_count: number;
}

export interface NetCuratedBrowseRow {
  curated_id:          string;
  candidate_id:        string;
  curated_status:      string;
  curator_note:        string | null;
  curated_by:          string;
  curated_at:          string;
  event_id:            string | null;
  event_title:         string | null;
  discipline_id:       string | null;
  discipline_name:     string | null;
  player_a_person_id:  string | null;
  person_name_a:       string | null;
  member_slug_a:       string | null;
  player_b_person_id:  string | null;
  person_name_b:       string | null;
  member_slug_b:       string | null;
  player_a_raw_name:   string | null;
  player_b_raw_name:   string | null;
  extracted_score:     string | null;
  raw_text:            string;
  round_hint:          string | null;
  year_hint:           number | null;
  source_file:         string | null;
}

export interface NetCuratedBrowseFilters {
  curated_status?: string;
  source_file?:    string;
  event_id?:       string;
  year_hint?:      number;
  linked_only?:    boolean;
  limit?:          number;
  offset?:         number;
}

export const netCuratedBrowse = {
  getTotalCount: db.prepare(`SELECT COUNT(*) AS cnt FROM net_curated_match`),

  getLinkedCount: db.prepare(`
    SELECT COUNT(*) AS cnt FROM net_curated_match
    WHERE player_a_person_id IS NOT NULL AND player_b_person_id IS NOT NULL
  `),

  listStatusSummary: db.prepare(`
    SELECT curated_status, COUNT(*) AS item_count
    FROM net_curated_match
    GROUP BY curated_status
    ORDER BY curated_status ASC
  `),

  listBySource: db.prepare(`
    SELECT
      f.source_file,
      COUNT(*)                                                            AS curated_count,
      SUM(CASE WHEN cm.curated_status = 'approved' THEN 1 ELSE 0 END)   AS approved_count,
      SUM(CASE WHEN cm.curated_status = 'rejected' THEN 1 ELSE 0 END)   AS rejected_count
    FROM net_curated_match cm
    JOIN net_candidate_match  c ON c.candidate_id = cm.candidate_id
    LEFT JOIN net_raw_fragment f ON f.id          = c.fragment_id
    GROUP BY f.source_file
    ORDER BY curated_count DESC, f.source_file ASC
  `),

  listByEvent: db.prepare(`
    SELECT
      cm.event_id,
      e.title                                                             AS event_title,
      COUNT(*)                                                            AS curated_count,
      SUM(CASE WHEN cm.curated_status = 'approved' THEN 1 ELSE 0 END)   AS approved_count,
      SUM(CASE WHEN cm.curated_status = 'rejected' THEN 1 ELSE 0 END)   AS rejected_count
    FROM net_curated_match cm
    LEFT JOIN events e ON e.id = cm.event_id
    WHERE cm.event_id IS NOT NULL
    GROUP BY cm.event_id
    ORDER BY curated_count DESC, cm.event_id ASC
  `),

  listByYear: db.prepare(`
    SELECT
      c.year_hint,
      COUNT(*)                                                            AS curated_count,
      SUM(CASE WHEN cm.curated_status = 'approved' THEN 1 ELSE 0 END)   AS approved_count,
      SUM(CASE WHEN cm.curated_status = 'rejected' THEN 1 ELSE 0 END)   AS rejected_count
    FROM net_curated_match cm
    JOIN net_candidate_match c ON c.candidate_id = cm.candidate_id
    WHERE c.year_hint IS NOT NULL
    GROUP BY c.year_hint
    ORDER BY c.year_hint ASC
  `),
} as const;

/**
 * Dynamic curated-match browse query, filter by status, source, event, year, linked.
 * Uses runtime db.prepare() for filter flexibility on a low-frequency internal tool.
 */
export function queryCuratedItems(filters: NetCuratedBrowseFilters): NetCuratedBrowseRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.curated_status) {
    conditions.push('cm.curated_status = ?');
    params.push(filters.curated_status);
  }
  if (filters.event_id) {
    conditions.push('cm.event_id = ?');
    params.push(filters.event_id);
  }
  if (filters.source_file) {
    conditions.push('f.source_file = ?');
    params.push(filters.source_file);
  }
  if (filters.year_hint !== undefined) {
    conditions.push('c.year_hint = ?');
    params.push(filters.year_hint);
  }
  if (filters.linked_only) {
    conditions.push('cm.player_a_person_id IS NOT NULL AND cm.player_b_person_id IS NOT NULL');
  }

  const where  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = Math.min(filters.limit  ?? 50, 200);
  const offset = filters.offset ?? 0;
  params.push(limit, offset);

  return db.prepare(`
    SELECT
      cm.curated_id, cm.candidate_id, cm.curated_status,
      cm.curator_note, cm.curated_by, cm.curated_at,
      cm.event_id,       e.title        AS event_title,
      cm.discipline_id,  ed.name        AS discipline_name,
      cm.player_a_person_id, pa.person_name AS person_name_a,
      cm.player_b_person_id, pb.person_name AS person_name_b,
      ma.slug AS member_slug_a,
      mb.slug AS member_slug_b,
      cm.extracted_score, cm.raw_text,
      c.player_a_raw_name, c.player_b_raw_name,
      c.round_hint, c.year_hint,
      f.source_file
    FROM net_curated_match cm
    JOIN  net_candidate_match  c   ON c.candidate_id  = cm.candidate_id
    LEFT JOIN events             e   ON e.id           = cm.event_id
    LEFT JOIN event_disciplines  ed  ON ed.id          = cm.discipline_id
    LEFT JOIN net_raw_fragment   f   ON f.id           = c.fragment_id
    LEFT JOIN historical_persons pa  ON pa.person_id   = cm.player_a_person_id
    LEFT JOIN historical_persons pb  ON pb.person_id   = cm.player_b_person_id
    LEFT JOIN members ma
      ON ma.historical_person_id = cm.player_a_person_id
      AND ma.deleted_at IS NULL
    LEFT JOIN members mb
      ON mb.historical_person_id = cm.player_b_person_id
      AND mb.deleted_at IS NULL
    ${where}
    ORDER BY cm.curated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as NetCuratedBrowseRow[];
}

export function queryReviewItems(filters: NetReviewFilters): NetReviewItemRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.reason_code) {
    conditions.push('rq.reason_code = ?');
    params.push(filters.reason_code);
  }
  if (filters.priority !== undefined) {
    conditions.push('rq.priority = ?');
    params.push(filters.priority);
  }
  if (filters.resolution_status) {
    conditions.push('rq.resolution_status = ?');
    params.push(filters.resolution_status);
  }
  if (filters.event_id) {
    conditions.push('rq.event_id = ?');
    params.push(filters.event_id);
  }
  if (filters.classification) {
    conditions.push('rq.classification = ?');
    params.push(filters.classification);
  }
  if (filters.proposed_fix_type) {
    conditions.push('rq.proposed_fix_type = ?');
    params.push(filters.proposed_fix_type);
  }
  if (filters.decision_status) {
    conditions.push('rq.decision_status = ?');
    params.push(filters.decision_status);
  }

  const where   = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit   = Math.min(filters.limit  ?? 50, 200);
  const offset  = filters.offset ?? 0;
  params.push(limit, offset);

  return db.prepare(`
    SELECT
      rq.id, rq.item_type, rq.priority, rq.reason_code, rq.severity, rq.message,
      rq.event_id,      e.title      AS event_title,
      rq.discipline_id, ed.name      AS discipline_name,
      rq.review_stage,  rq.resolution_status, rq.imported_at,
      rq.classification, rq.proposed_fix_type, rq.classification_confidence,
      rq.decision_status, rq.decision_notes, rq.classified_by, rq.classified_at
    FROM net_review_queue rq
    LEFT JOIN events            e   ON e.id   = rq.event_id
    LEFT JOIN event_disciplines ed  ON ed.id  = rq.discipline_id
    ${where}
    ORDER BY rq.priority ASC, rq.imported_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as NetReviewItemRow[];
}

/**
 * Partial UPDATE of classification fields on a net_review_queue row.
 * Only fields present in `fields` are updated. `classified_by` and
 * `classified_at` are always stamped. Uses runtime db.prepare() for
 * partial-update flexibility; acceptable for a low-frequency internal tool.
 * Returns true if the row existed and was modified.
 */
export function updateReviewClassification(
  id: string,
  fields: Partial<{
    classification:            string | null;
    proposed_fix_type:         string | null;
    classification_confidence: string | null;
  }>,
  classifiedBy: string,
): boolean {
  const sets: string[] = [
    'classified_by = ?',
    "classified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ];
  const params: (string | null)[] = [classifiedBy];

  if (Object.prototype.hasOwnProperty.call(fields, 'classification')) {
    sets.push('classification = ?');
    params.push(fields.classification ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'proposed_fix_type')) {
    sets.push('proposed_fix_type = ?');
    params.push(fields.proposed_fix_type ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'classification_confidence')) {
    sets.push('classification_confidence = ?');
    params.push(fields.classification_confidence ?? null);
  }

  params.push(id);
  const result = db.prepare(
    `UPDATE net_review_queue SET ${sets.join(', ')} WHERE id = ?`,
  ).run(...params);
  return result.changes > 0;
}

/**
 * Partial UPDATE of decision fields on a net_review_queue row.
 * Only fields present in `fields` are updated. `classified_by` and
 * `classified_at` are always stamped.
 */
export function updateReviewDecisionFields(
  id: string,
  fields: Partial<{
    decision_status: string | null;
    decision_notes:  string | null;
  }>,
  classifiedBy: string,
): boolean {
  const sets: string[] = [
    'classified_by = ?',
    "classified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ];
  const params: (string | null)[] = [classifiedBy];

  if (Object.prototype.hasOwnProperty.call(fields, 'decision_status')) {
    sets.push('decision_status = ?');
    params.push(fields.decision_status ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'decision_notes')) {
    sets.push('decision_notes = ?');
    params.push(fields.decision_notes ?? null);
  }

  params.push(id);
  const result = db.prepare(
    `UPDATE net_review_queue SET ${sets.join(', ')} WHERE id = ?`,
  ).run(...params);
  return result.changes > 0;
}

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
  historical_person_id: string | null;
  login_email: string;
  avatar_thumb_key: string | null;
  avatar_media_id: string | null;
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

export interface MemberSearchRow {
  slug: string;
  display_name: string;
  country: string | null;
  is_hof: number;
  is_bap: number;
  is_board: number;
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
      m.historical_person_id,
      m.login_email,
      mi.s3_key_thumb AS avatar_thumb_key,
      mi.id           AS avatar_media_id,
      hp.person_name AS historical_person_name,
      hp.first_year AS historical_first_year,
      hp.bap_nickname AS historical_bap_nickname,
      hp.bap_induction_year AS historical_bap_induction_year,
      hp.hof_induction_year AS historical_hof_induction_year
    FROM members_active AS m
    LEFT JOIN media_items AS mi
      ON mi.id = m.avatar_media_id
    LEFT JOIN historical_persons AS hp
      ON hp.person_id = m.historical_person_id
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
      mi.s3_key_thumb AS avatar_thumb_key,
      mi.id           AS avatar_media_id
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
      COALESCE(m_co_linked.slug, m_co_via_hp.slug) AS participant_member_slug,
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
    LEFT JOIN members AS m_co_via_hp
      ON m_co_via_hp.historical_person_id = erp_co.historical_person_id
      AND m_co_via_hp.deleted_at IS NULL
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
      COALESCE(m_co_linked.slug, m_co_via_hp.slug) AS participant_member_slug,
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
    LEFT JOIN members AS m_co_via_hp
      ON m_co_via_hp.historical_person_id = erp_co.historical_person_id
      AND m_co_via_hp.deleted_at IS NULL
    WHERE hp.legacy_member_id = ?
    ORDER BY
      e.start_date DESC,
      COALESCE(ed.sort_order, 0) ASC,
      COALESCE(ed.name, '') COLLATE NOCASE ASC,
      ere.placement ASC,
      erp_co.participant_order ASC
  `),

  searchMembers: db.prepare(`
    SELECT slug, display_name, country, is_hof, is_bap, is_board
    FROM members_searchable
    WHERE display_name_normalized LIKE '%' || ? || '%' ESCAPE '\\'
    ORDER BY display_name_normalized
    LIMIT ?
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
  findUnverifiedMemberByEmail: db.prepare(`
    SELECT m.id
    FROM members_active AS m
    WHERE m.login_email_normalized = ?
      AND m.email_verified_at IS NULL
      AND m.is_deceased = 0
  `),

  markEmailVerified: db.prepare(`
    UPDATE members
    SET email_verified_at = ?,
        updated_at        = ?,
        updated_by        = 'system',
        version           = version + 1
    WHERE id = ? AND email_verified_at IS NULL
  `),

  findMemberForSessionAfterVerify: db.prepare(`
    SELECT id, slug, login_email, real_name, password_version, is_admin
    FROM members_active
    WHERE id = ?
  `),

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

  findMemberForSession: db.prepare(`
    SELECT
      m.id,
      m.slug,
      m.display_name,
      m.password_version,
      m.is_admin
    FROM members_active AS m
    WHERE m.id = ?
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

  findMemberForPasswordChange: db.prepare(`
    SELECT id, password_hash, password_version
    FROM members_active
    WHERE id = ?
  `),

  updateMemberPassword: db.prepare(`
    UPDATE members
    SET
      password_hash         = ?,
      password_version      = password_version + 1,
      password_changed_at   = ?,
      updated_at            = ?,
      updated_by            = 'member',
      version               = version + 1
    WHERE id = ?
  `),
} as const;

export const systemConfig = {
  getValueByKey: db.prepare(`
    SELECT value_json
    FROM system_config_current
    WHERE config_key = ?
  `),
} as const;

export interface OutboxRow {
  id: string;
  recipient_email: string | null;
  recipient_member_id: string | null;
  subject: string;
  body_text: string;
  from_identity: string | null;
  retry_count: number;
  idempotency_key: string | null;
}

export interface AccountTokenRow {
  id: string;
  member_id: string;
  token_type: string;
  expires_at: string;
  used_at: string | null;
}

export const accountTokens = {
  insert: db.prepare(`
    INSERT INTO account_tokens (
      id, created_at, created_by, updated_at, updated_by, version,
      member_id, target_legacy_member_id, token_type,
      token_hash, token_hash_version,
      issued_at, expires_at
    ) VALUES (?, ?, 'system', ?, 'system', 1,
      ?, ?, ?,
      ?, 1,
      ?, ?)
  `),

  findByHash: db.prepare(`
    SELECT id, member_id, token_type, expires_at, used_at
    FROM account_tokens
    WHERE token_hash = ? AND token_type = ?
  `),

  consumeIfUnused: db.prepare(`
    UPDATE account_tokens
    SET used_at    = ?,
        updated_at = ?,
        updated_by = 'system',
        version    = version + 1
    WHERE id = ? AND used_at IS NULL
  `),
} as const;

export const outbox = {
  insert: db.prepare(`
    INSERT INTO outbox_emails (
      id, created_at, created_by, updated_at, updated_by, version,
      idempotency_key,
      recipient_email, recipient_member_id, mailing_list_id,
      sender_member_id, from_identity,
      subject, body_text,
      status, retry_count, scheduled_for
    ) VALUES (?, ?, 'system', ?, 'system', 1,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      'pending', 0, ?)
  `),

  selectPendingBatch: db.prepare(`
    SELECT id, recipient_email, recipient_member_id, subject, body_text,
           from_identity, retry_count, idempotency_key
    FROM outbox_emails
    WHERE status = 'pending'
      AND (scheduled_for IS NULL OR scheduled_for <= ?)
    ORDER BY created_at ASC
    LIMIT ?
  `),

  findByIdempotencyKey: db.prepare(`
    SELECT id FROM outbox_emails WHERE idempotency_key = ?
  `),

  markSending: db.prepare(`
    UPDATE outbox_emails
    SET status = 'sending',
        last_attempt_at = ?,
        updated_at = ?,
        updated_by = 'system',
        version = version + 1
    WHERE id = ? AND status = 'pending'
  `),

  markSent: db.prepare(`
    UPDATE outbox_emails
    SET status = 'sent',
        sent_at = ?,
        updated_at = ?,
        updated_by = 'system',
        body_text = NULL,
        version = version + 1
    WHERE id = ?
  `),

  markFailedRetry: db.prepare(`
    UPDATE outbox_emails
    SET status = 'pending',
        retry_count = retry_count + 1,
        last_error = ?,
        updated_at = ?,
        updated_by = 'system',
        version = version + 1
    WHERE id = ?
  `),

  markDeadLetter: db.prepare(`
    UPDATE outbox_emails
    SET status = 'dead_letter',
        retry_count = retry_count + 1,
        last_error = ?,
        updated_at = ?,
        updated_by = 'system',
        version = version + 1
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

export interface AlreadyClaimedRow {
  legacy_member_id: string;
}

export interface HistoricalPersonClaimRow {
  person_id: string;
  person_name: string;
  legacy_member_id: string | null;
  country: string | null;
  hof_member: number;
  bap_member: number;
  hof_induction_year: number | null;
  bap_induction_year: number | null;
  first_year: number | null;
}

export const legacyClaim = {
  findHistoricalPersonByLegacyId: db.prepare(`
    SELECT person_id, person_name, legacy_member_id, country,
           hof_member, bap_member, hof_induction_year, bap_induction_year, first_year
    FROM historical_persons
    WHERE legacy_member_id = ?
    LIMIT 1
  `),

  findHistoricalPersonById: db.prepare(`
    SELECT person_id, person_name, legacy_member_id, country,
           hof_member, bap_member, hof_induction_year, bap_induction_year, first_year
    FROM historical_persons
    WHERE person_id = ?
    LIMIT 1
  `),

  checkLegacyIdAlreadyClaimed: db.prepare(`
    SELECT id
    FROM members
    WHERE legacy_member_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `),

  checkAlreadyClaimed: db.prepare(`
    SELECT legacy_member_id
    FROM members
    WHERE id = ?
      AND legacy_member_id IS NOT NULL
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

  // Copies identity-defining fields from a linked historical_persons row into
  // the claiming members row. Called in the same transaction as
  // setMemberHistoricalPersonId so search / hero / profile surfaces reflect
  // the HP's country, HoF/BAP status, and induction years on the member row.
  // Fill-if-empty for free-text fields, OR semantics for boolean honors.
  mergeHistoricalPersonFields: db.prepare(`
    UPDATE members
    SET
      country                = CASE WHEN country IS NULL OR country = '' THEN ? ELSE country END,
      is_hof                 = MAX(is_hof, ?),
      is_bap                 = MAX(is_bap, ?),
      hof_inducted_year      = COALESCE(hof_inducted_year, ?),
      first_competition_year = COALESCE(first_competition_year, ?),
      updated_at             = ?,
      updated_by             = 'claim_merge',
      version                = version + 1
    WHERE id = ?
  `),

  // Used by the HP-only claim flow (scenarios D and E): check that no other
  // live member already owns this HP. The partial UNIQUE index on
  // members.historical_person_id ultimately enforces this at write time; this
  // read is for a friendly error rather than a raw constraint failure.
  findMemberClaimingHp: db.prepare(`
    SELECT id, slug
    FROM members
    WHERE historical_person_id = ?
      AND deleted_at IS NULL
      AND personal_data_purged_at IS NULL
    LIMIT 1
  `),

  checkMemberHasHp: db.prepare(`
    SELECT historical_person_id
    FROM members
    WHERE id = ?
      AND historical_person_id IS NOT NULL
  `),

  // Read the identifying fields needed to evaluate a claim: the member's slug
  // (for post-claim redirect), real_name (for surname reconciliation against
  // the HP or legacy account), and existing linkage state.
  findClaimingMember: db.prepare(`
    SELECT id, slug, real_name, legacy_member_id, historical_person_id
    FROM members
    WHERE id = ?
      AND deleted_at IS NULL
      AND personal_data_purged_at IS NULL
  `),
} as const;

// ── legacy_members ──────────────────────────────────────────────────────────
//
// Permanent archival table of old footbag.org user accounts. Claim marks
// (claimed_by_member_id + claimed_at) but does not delete the row; PII purge
// clears the claim fields so the legacy account becomes claimable again.
// ---------------------------------------------------------------------------
export interface LegacyMemberRow {
  legacy_member_id: string;
  legacy_user_id: string | null;
  legacy_email: string | null;
  real_name: string | null;
  display_name: string | null;
  display_name_normalized: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  bio: string | null;
  birth_date: string | null;
  street_address: string | null;
  postal_code: string | null;
  ifpa_join_date: string | null;
  first_competition_year: number | null;
  is_hof: number;
  is_bap: number;
  legacy_is_admin: number;
  import_source: string | null;
  imported_at: string;
  version: number;
  claimed_by_member_id: string | null;
  claimed_at: string | null;
}

export const legacyMembers = {
  insert: db.prepare(`
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
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
    )
  `),

  findByIdentifier: db.prepare(`
    SELECT
      legacy_member_id,
      legacy_user_id, legacy_email,
      real_name, display_name,
      bio, birth_date, street_address, postal_code,
      city, region, country,
      ifpa_join_date, first_competition_year,
      is_hof, is_bap, legacy_is_admin,
      claimed_by_member_id, claimed_at
    FROM legacy_members
    WHERE claimed_by_member_id IS NULL
      AND (legacy_member_id = ? OR legacy_user_id = ? OR legacy_email = ?)
    LIMIT 1
  `),

  findByLegacyMemberId: db.prepare(`
    SELECT
      legacy_member_id,
      legacy_user_id, legacy_email,
      real_name, display_name,
      bio, birth_date, street_address, postal_code,
      city, region, country,
      ifpa_join_date, first_competition_year,
      is_hof, is_bap, legacy_is_admin,
      claimed_by_member_id, claimed_at
    FROM legacy_members
    WHERE legacy_member_id = ?
  `),

  markClaimed: db.prepare(`
    UPDATE legacy_members
    SET
      claimed_by_member_id = ?,
      claimed_at           = ?,
      version              = version + 1
    WHERE legacy_member_id = ?
      AND claimed_by_member_id IS NULL
  `),

  clearClaim: db.prepare(`
    UPDATE legacy_members
    SET
      claimed_by_member_id = NULL,
      claimed_at           = NULL,
      version              = version + 1
    WHERE legacy_member_id = ?
  `),

  // Written as part of the claim transaction when the claimed legacy_members
  // row has a matching historical_persons.legacy_member_id. Sets the
  // derived member↔HP link.
  setMemberHistoricalPersonId: db.prepare(`
    UPDATE members
    SET
      historical_person_id = ?,
      updated_at           = ?,
      updated_by           = 'claim_merge',
      version              = version + 1
    WHERE id = ?
      AND historical_person_id IS NULL
  `),
} as const;

// ---- QC-only (delete with pipeline-qc subsystem) ----
// ---------------------------------------------------------------------------
// personsQc
// ---------------------------------------------------------------------------─────

export interface PersonsQcRow {
  person_id: string;
  person_name: string;
  aliases: string | null;
  source: string | null;
  source_scope: string | null;
  country: string | null;
  event_count: number;
  placement_count: number;
}

export const personsQc = {
  listAll: db.prepare(`
    SELECT person_id, person_name, aliases, source, source_scope, country,
           event_count, placement_count
    FROM historical_persons
    ORDER BY person_name COLLATE NOCASE
  `),
} as const;

// Read-only auto-link candidate lookup. Rows in `name_variants` are loaded
// pre-normalized (NFKC+lower+trim+collapse), by contract of the loader.
// Symmetric table: a lookup must check both columns and return the opposite.
// `person_name` is stored unnormalized; the SQL uses `lower(trim(...))` as a
// safe approximation for current canonical data (NFC-composed, single-spaced).
export const nameVariants = {
  findByEitherColumn: db.prepare(`
    SELECT canonical_normalized, variant_normalized
    FROM name_variants
    WHERE canonical_normalized = ? OR variant_normalized = ?
  `),

  findHistoricalPersonsByNormalizedName: db.prepare(`
    SELECT person_id, person_name
    FROM historical_persons
    WHERE lower(trim(person_name)) = ?
    ORDER BY person_id
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
