import {
  PublicCompletedEventSummaryRow,
  PublicEventDetailRow,
  PublicEventDisciplineRow,
  PublicEventResultRow,
  PublicEventSummaryRow,
  publicEvents,
} from '../db/db';
import { NotFoundError, ValidationError } from './serviceErrors';
import { personHref } from './personLink';
import { runSqliteRead } from './sqliteRetry';
import { PageViewModel } from '../types/page';

const PUBLIC_EVENT_KEY_PATTERN = /^event_\d{4}_[a-z0-9_]+$/;

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
  teamTypeLabel: string | null;
  sortOrder: number;
}

export interface PublicEventResultParticipant {
  participantDisplayName: string;
  participantOrder: number;
  participantHref: string | null;
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

export interface FeaturedPromoCard {
  title: string;
  href: string;
  ctaLabel: string;
  description?: string;
  startDate: string;
  endDate: string;
  city: string;
  region?: string | null;
  country: string;
  external?: boolean;
  imageUrl?: string;
  imageAlt?: string;
}

export interface EventsLandingContent {
  featuredPromo?: FeaturedPromoCard;
  upcomingEvents: PublicEventSummary[];
  archiveYears: number[];
}

export interface EventsYearContent {
  year: number;
  events: PublicCompletedEventSummary[];
}

export interface EventDetailContent {
  event: PublicEvent;
  disciplines: PublicEventDiscipline[];
  hasResults: boolean;
  primarySection: 'details' | 'results';
  resultSections: PublicResultSection[];
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

function toTeamTypeLabel(teamType: string): string | null {
  if (teamType === 'doubles') return 'Doubles';
  if (teamType === 'mixed_doubles') return 'Mixed Doubles';
  return null;
}

function toPublicEventDiscipline(row: PublicEventDisciplineRow): PublicEventDiscipline {
  return {
    disciplineId: row.discipline_id,
    eventId: row.event_id,
    name: row.name,
    disciplineCategory: row.discipline_category,
    teamType: row.team_type,
    teamTypeLabel: toTeamTypeLabel(row.team_type),
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

const DISCIPLINE_CATEGORY_PRIORITY: Record<string, number> = {
  net: 1,
  freestyle: 2,
  golf: 3,
  sideline: 4,
};

// Priority 1: Open / Pro (word boundary for 'pro' to avoid "impromptu", "program")
// Priority 2: Men unqualified (top-level men's division)
// Priority 3: Women unqualified (top-level women's division)
// Priority 4: Masters
// Priority 5: Advanced / Amateur / Ultra
// Priority 6: Intermediate (many spelling variants and abbreviations)
// Priority 7: Novice / Beginner / Junior
// Priority 8: Unmatched (last)
const DIVISION_PRIORITY_RULES: Array<{ patterns: Array<string | RegExp>; priority: number }> = [
  { patterns: ['open', /\bpro\b/], priority: 1 },
  { patterns: ['master'], priority: 4 },
  { patterns: ['advanc', 'amateur', 'ultra'], priority: 5 },
  { patterns: ['interm', 'inter ', 'int '], priority: 6 },
  { patterns: ['novice', 'beginner', 'junior', 'novato'], priority: 7 },
];

// Women must be checked before men: 'wo-MEN' contains the men markers as a substring.
// Gendered names with no division qualifier are the top-level division for that gender.
const WOMEN_MARKERS = ['women', 'woman', 'ladies', 'girl'];
const MEN_MARKERS = ["men's", 'mens', ' men', "man's", 'gents'];

function disciplineSortKey(category: string | null, name: string | null): [number, number, string] {
  const catPriority = DISCIPLINE_CATEGORY_PRIORITY[category ?? ''] ?? 5;
  const lower = (name ?? '').toLowerCase();
  let divPriority = 8; // unmatched = last
  for (const rule of DIVISION_PRIORITY_RULES) {
    if (rule.patterns.some((p) => (typeof p === 'string' ? lower.includes(p) : p.test(lower)))) {
      divPriority = rule.priority;
      break;
    }
  }
  if (divPriority === 8) {
    if (WOMEN_MARKERS.some((m) => lower.includes(m))) divPriority = 3;
    else if (MEN_MARKERS.some((m) => lower.includes(m))) divPriority = 2;
  }
  return [catPriority, divPriority, name ?? ''];
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

    const participantHref = personHref(
      row.participant_member_slug,
      row.participant_historical_person_id,
    );

    placement.participants.push({
      participantDisplayName: row.participant_display_name,
      participantOrder: row.participant_order,
      participantHref,
    });
  }

  const mapped = sections.map((section) => ({
    disciplineId: section.disciplineId,
    disciplineName: section.disciplineName,
    disciplineCategory: section.disciplineCategory,
    teamType: section.teamType,
    placements: section.placements,
  }));

  mapped.sort((a, b) => {
    const [aCat, aDiv, aName] = disciplineSortKey(a.disciplineCategory, a.disciplineName);
    const [bCat, bDiv, bName] = disciplineSortKey(b.disciplineCategory, b.disciplineName);
    return aCat - bCat || aDiv - bDiv || aName.localeCompare(bName);
  });

  return mapped;
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

function toPublicEventPage(
  eventRow: PublicEventDetailRow,
  disciplineRows: PublicEventDisciplineRow[],
  resultRows: PublicEventResultRow[],
): PublicEventPage {
  const resultSections = groupPublicResultRows(resultRows);
  const hasResults = resultSections.length > 0;

  return {
    event: toPublicEvent(eventRow),
    disciplines: disciplineRows.map(toPublicEventDiscipline).sort((a, b) => {
      const [aCat, aDiv, aName] = disciplineSortKey(a.disciplineCategory, a.name);
      const [bCat, bDiv, bName] = disciplineSortKey(b.disciplineCategory, b.name);
      return aCat - bCat || aDiv - bDiv || aName.localeCompare(bName);
    }),
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

  listPublicCompletedEventsByYear(year: number): PublicCompletedEventSummary[] {
    assertArchiveYear(year);

    return runSqliteRead('listPublicCompletedEventsByYear', () => {
      const rows = publicEvents.listCompletedByYear.all(year) as PublicCompletedEventSummaryRow[];
      return rows.map(toPublicCompletedEventSummary);
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

  private getFeaturedPromo(): FeaturedPromoCard {
    return {
      title: '45th IFPA World Footbag Championships 2026',
      href: 'https://www.footbag.jp/FootbagWorlds2026',
      ctaLabel: 'Official Website',
      description: "Asia's first World Footbag Championship will be in Japan in August!",
      startDate: '2026-08-10',
      endDate: '2026-08-15',
      city: 'Tsukuba',
      region: 'Ibaraki',
      country: 'Japan',
      external: true,
      imageUrl: '/img/footbag-worlds-2026.jpg',
      imageAlt: '45th IFPA World Footbag Championships 2026, Tsukuba, Japan official poster',
    };
  }

  getPublicEventsLandingPage(nowIso: string): PageViewModel<EventsLandingContent> {
    return {
      seo: { title: 'Events' },
      page: {
        sectionKey: 'events',
        pageKey: 'events_index',
        title: 'Footbag Events',
        intro: 'Tournaments, competitions, and gatherings from around the world.',
      },
      content: {
        featuredPromo: this.getFeaturedPromo(),
        upcomingEvents: this.listPublicUpcomingEvents(nowIso),
        archiveYears: this.listPublicArchiveYears(),
      },
    };
  }

  getPublicEventsYearPage(year: number): PageViewModel<EventsYearContent> {
    const archiveYears = this.listPublicArchiveYears();
    const { previousYear, nextYear } = getAdjacentArchiveYears(archiveYears, year);

    return {
      seo: { title: `${year} Events` },
      page: { sectionKey: 'events', pageKey: 'events_year_archive', title: `Footbag Events from ${year}` },
      navigation: {
        siblings: {
          previous: previousYear !== null ? { label: String(previousYear), href: `/events/year/${previousYear}` } : undefined,
          next: nextYear !== null ? { label: String(nextYear), href: `/events/year/${nextYear}` } : undefined,
        },
      },
      content: {
        year,
        events: this.listPublicCompletedEventsByYear(year),
      },
    };
  }

  getPublicEventPage(eventKey: string): PageViewModel<EventDetailContent> {
    const detail = this.getPublicEventDetail(eventKey);
    const year = detail.event.startDate.slice(0, 4);
    return {
      seo: { title: detail.event.standardTagDisplay },
      page: { sectionKey: 'events', pageKey: 'event_detail', title: detail.event.title },
      navigation: {
        contextLinks: [{ label: `More events from ${year}`, href: `/events/year/${year}` }],
      },
      content: detail,
    };
  }
}

export const eventService = new EventService();
