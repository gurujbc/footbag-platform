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
 * - GET /events
 * - GET /events/year/:year
 * - GET /events/:eventKey
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
  participant_display_name: string;
}

export interface HealthReadyRow {
  is_ready: number;
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
      erp.display_name AS participant_display_name
    FROM events AS e
    INNER JOIN event_result_entries AS ere
      ON ere.event_id = e.id
    LEFT JOIN event_disciplines AS ed
      ON ed.id = ere.discipline_id
    INNER JOIN event_result_entry_participants AS erp
      ON erp.result_entry_id = ere.id
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

export const health = {
  checkReady: db.prepare(`
    SELECT 1 AS is_ready
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
