import {
  PublicCompletedEventSummaryRow,
  PublicEventDetailRow,
  PublicEventDisciplineRow,
  PublicEventResultRow,
  PublicEventSummaryRow,
  publicEvents,
} from '../db/db';
import { NotFoundError, ValidationError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';

const PUBLIC_EVENT_KEY_PATTERN = /^[a-z0-9_]+$/;
const NO_RESULTS_MESSAGE = 'Results are not yet available.';

export interface PublicEventSummary {
  eventId: string;
  eventKey: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  city: string;
  region: string | null;
  country: string;
  hostClub: string | null;
  externalUrl: string | null;
  registrationDeadline: string | null;
  capacityLimit: number | null;
  status: string;
  registrationStatus: string;
  publishedAt: string | null;
  hashtagTagId: string;
  standardTagNormalized: string;
  standardTagDisplay: string;
}

export interface PublicCompletedEventSummary extends PublicEventSummary {
  hasResults: boolean;
}

export interface PublicEventDiscipline {
  disciplineId: string;
  eventId: string;
  name: string;
  disciplineCategory: string;
  teamType: string;
  sortOrder: number;
}

export interface PublicEventResultParticipant {
  participantDisplayName: string;
  participantOrder: number;
  participantPersonId: string | null;
}

export interface PublicResultPlacement {
  placement: number;
  scoreText: string | null;
  participants: PublicEventResultParticipant[];
}

export interface PublicResultSection {
  disciplineId: string | null;
  disciplineName: string | null;
  disciplineCategory: string | null;
  teamType: string | null;
  placements: PublicResultPlacement[];
}

export interface PublicEvent extends PublicEventSummary {
  isAttendeeRegistrationOpen: boolean;
  isTshirtSizeCollected: boolean;
  sanctionStatus: string;
  paymentEnabled: boolean;
  currency: string;
  competitorFeeCents: number | null;
  attendeeFeeCents: number | null;
}

export interface PublicEventPage {
  event: PublicEvent;
  disciplines: PublicEventDiscipline[];
  hasResults: boolean;
  primarySection: 'details' | 'results';
  resultSections: PublicResultSection[];
}

export interface PublicYearPageEvent extends PublicCompletedEventSummary {
  resultSections: PublicResultSection[];
  noResultsMessage: string | null;
}

export interface PublicEventsLandingPage {
  upcomingEvents: PublicEventSummary[];
  archiveYears: number[];
}

export interface PublicEventsYearPage {
  year: number;
  previousYear: number | null;
  nextYear: number | null;
  archiveYears: number[];
  events: PublicYearPageEvent[];
}

function assertArchiveYear(year: number): void {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new ValidationError('year must be a four-digit integer.', {
      field: 'year',
      value: year,
    });
  }
}

function normalizePublicEventKeyToStoredTag(eventKey: string): string {
  if (!PUBLIC_EVENT_KEY_PATTERN.test(eventKey)) {
    throw new ValidationError('eventKey must match pattern event_{year}_{event_slug}.', {
      field: 'eventKey',
      value: eventKey,
    });
  }

  return `#${eventKey.toLowerCase()}`;
}

function toPublicEventSummary(row: PublicEventSummaryRow): PublicEventSummary {
  return {
    eventId: row.event_id,
    eventKey: row.tag_normalized.startsWith('#') ? row.tag_normalized.slice(1) : row.tag_normalized,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    city: row.city,
    region: row.region,
    country: row.country,
    hostClub: row.host_club,
    externalUrl: row.external_url,
    registrationDeadline: row.registration_deadline,
    capacityLimit: row.capacity_limit,
    status: row.status,
    registrationStatus: row.registration_status,
    publishedAt: row.published_at,
    hashtagTagId: row.hashtag_tag_id,
    standardTagNormalized: row.tag_normalized,
    standardTagDisplay: row.tag_display,
  };
}

function toPublicCompletedEventSummary(row: PublicCompletedEventSummaryRow): PublicCompletedEventSummary {
  return {
    ...toPublicEventSummary(row),
    hasResults: row.has_results === 1,
  };
}

function toPublicEventDiscipline(row: PublicEventDisciplineRow): PublicEventDiscipline {
  return {
    disciplineId: row.discipline_id,
    eventId: row.event_id,
    name: row.name,
    disciplineCategory: row.discipline_category,
    teamType: row.team_type,
    sortOrder: row.sort_order,
  };
}

function toPublicEvent(eventRow: PublicEventDetailRow): PublicEvent {
  return {
    ...toPublicEventSummary(eventRow),
    isAttendeeRegistrationOpen: eventRow.is_attendee_registration_open === 1,
    isTshirtSizeCollected: eventRow.is_tshirt_size_collected === 1,
    sanctionStatus: eventRow.sanction_status,
    paymentEnabled: eventRow.payment_enabled === 1,
    currency: eventRow.currency,
    competitorFeeCents: eventRow.competitor_fee_cents,
    attendeeFeeCents: eventRow.attendee_fee_cents,
  };
}

function groupPublicResultRows(resultRows: PublicEventResultRow[]): PublicResultSection[] {
  type MutablePlacement = {
    placement: number;
    scoreText: string | null;
    participants: PublicEventResultParticipant[];
  };

  type MutableSection = {
    disciplineId: string | null;
    disciplineName: string | null;
    disciplineCategory: string | null;
    teamType: string | null;
    placements: MutablePlacement[];
    placementsByResultEntryId: Map<string, MutablePlacement>;
  };

  const sections: MutableSection[] = [];
  const sectionsByKey = new Map<string, MutableSection>();

  for (const row of resultRows) {
    const sectionKey = [
      row.discipline_id ?? '',
      row.discipline_name ?? '',
      row.discipline_category ?? '',
      row.team_type ?? '',
    ].join('|');

    let section = sectionsByKey.get(sectionKey);
    if (!section) {
      section = {
        disciplineId: row.discipline_id,
        disciplineName: row.discipline_name,
        disciplineCategory: row.discipline_category,
        teamType: row.team_type,
        placements: [],
        placementsByResultEntryId: new Map<string, MutablePlacement>(),
      };
      sectionsByKey.set(sectionKey, section);
      sections.push(section);
    }

    let placement = section.placementsByResultEntryId.get(row.result_entry_id);
    if (!placement) {
      placement = {
        placement: row.placement,
        scoreText: row.score_text,
        participants: [],
      };
      section.placementsByResultEntryId.set(row.result_entry_id, placement);
      section.placements.push(placement);
    }

    placement.participants.push({
      participantDisplayName: row.participant_display_name,
      participantOrder: row.participant_order,
      participantPersonId: row.participant_historical_person_id ?? null,
    });
  }

  return sections.map((section) => ({
    disciplineId: section.disciplineId,
    disciplineName: section.disciplineName,
    disciplineCategory: section.disciplineCategory,
    teamType: section.teamType,
    placements: section.placements,
  }));
}

function getAdjacentArchiveYears(
  archiveYears: number[],
  year: number,
): { previousYear: number | null; nextYear: number | null } {
  const index = archiveYears.indexOf(year);

  if (index === -1) {
    return {
      previousYear: null,
      nextYear: null,
    };
  }

  return {
    previousYear: index < archiveYears.length - 1 ? archiveYears[index + 1] : null,
    nextYear: index > 0 ? archiveYears[index - 1] : null,
  };
}

function toPublicYearPageEvent(
  row: PublicCompletedEventSummaryRow,
  resultRows: PublicEventResultRow[],
): PublicYearPageEvent {
  const summary = toPublicCompletedEventSummary(row);
  const resultSections = groupPublicResultRows(resultRows);
  const hasResults = resultSections.length > 0;

  return {
    ...summary,
    hasResults,
    resultSections,
    noResultsMessage: hasResults ? null : NO_RESULTS_MESSAGE,
  };
}

function toPublicEventPage(
  eventRow: PublicEventDetailRow,
  disciplineRows: PublicEventDisciplineRow[],
  resultRows: PublicEventResultRow[],
): PublicEventPage {
  const resultSections = groupPublicResultRows(resultRows);
  const hasResults = resultSections.length > 0;

  return {
    event: toPublicEvent(eventRow),
    disciplines: disciplineRows.map(toPublicEventDiscipline),
    hasResults,
    primarySection: hasResults ? 'results' : 'details',
    resultSections,
  };
}

export class EventService {
  listPublicUpcomingEvents(nowIso: string): PublicEventSummary[] {
    return runSqliteRead('listPublicUpcomingEvents', () => {
      const rows = publicEvents.listUpcoming.all(nowIso) as PublicEventSummaryRow[];
      return rows.map(toPublicEventSummary);
    });
  }

  listPublicArchiveYears(): number[] {
    return runSqliteRead('listPublicArchiveYears', () => {
      const rows = publicEvents.listArchiveYears.all() as Array<{ archive_year: number }>;
      return rows.map((row) => row.archive_year);
    });
  }

  listPublicCompletedEventsByYear(year: number): PublicYearPageEvent[] {
    assertArchiveYear(year);

    return runSqliteRead('listPublicCompletedEventsByYear', () => {
      const rows = publicEvents.listCompletedByYear.all(year) as PublicCompletedEventSummaryRow[];

      return rows.map((row) => {
        const resultRows = publicEvents.listPublicResultRowsByEventId.all(row.event_id) as PublicEventResultRow[];
        return toPublicYearPageEvent(row, resultRows);
      });
    });
  }

  getPublicEventDetail(eventKey: string): PublicEventPage {
    const normalizedStoredTag = normalizePublicEventKeyToStoredTag(eventKey);

    return runSqliteRead('getPublicEventDetail', () => {
      const eventRow = publicEvents.getByStandardTag.get(normalizedStoredTag) as PublicEventDetailRow | undefined;

      if (!eventRow) {
        throw new NotFoundError('Public event not found.', {
          field: 'eventKey',
          value: eventKey,
        });
      }

      const disciplineRows = publicEvents.listDisciplinesByEventId.all(eventRow.event_id) as PublicEventDisciplineRow[];
      const resultRows = publicEvents.listPublicResultRowsByEventId.all(eventRow.event_id) as PublicEventResultRow[];

      return toPublicEventPage(eventRow, disciplineRows, resultRows);
    });
  }

  getPublicEventsLandingPage(nowIso: string): PublicEventsLandingPage {
    return {
      upcomingEvents: this.listPublicUpcomingEvents(nowIso),
      archiveYears: this.listPublicArchiveYears(),
    };
  }

  getPublicEventsYearPage(year: number): PublicEventsYearPage {
    const archiveYears = this.listPublicArchiveYears();
    const { previousYear, nextYear } = getAdjacentArchiveYears(archiveYears, year);

    return {
      year,
      previousYear,
      nextYear,
      archiveYears,
      events: this.listPublicCompletedEventsByYear(year),
    };
  }

  getPublicEventPage(eventKey: string): PublicEventPage {
    return this.getPublicEventDetail(eventKey);
  }
}

export const eventService = new EventService();
