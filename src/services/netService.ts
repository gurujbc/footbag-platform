import {
  netTeams,      NetTeamSummaryRow, NetTeamAppearanceRow,
  netPartnerships, NetPartnershipRow, NetDivisionOptionRow,
  queryFilteredPartnerships,
  netRecoverySignals, RecoveryPartnerRepeatRow, RecoveryAbbreviationRow,
                      RecoveryHighValueRow,
  netRecoveryCandidates, RecoveryCandidateAbbrevRow, RecoveryCandidateFreqRow,
  netRecoveryApproval, RecoveryAliasCandidateRow,
  netPlayers,    NetPlayerSummaryRow, NetPartnerRow, NetPartnerNetworkRow,
  netEvents,     NetEventSummaryRow, NetEventAppearanceRow,
  netHome,       NetHomeTopTeamRow, NetHomeTopPlayerRow,
                 NetHomeRecentEventRow, NetHomeInterestingTeamRow,
                 NetNotablePlayerRow,
  netReview,     NetReviewSummaryRow, NetReviewClassificationSummaryRow,
                 NetReviewDecisionSummaryRow, NetReviewFixTypeSummaryRow,
                 NetReviewTopEventRow, NetReviewTotalsRow, NetReviewItemRow,
                 NetReviewEventContextRow, NetReviewConflictDisciplineRow,
                 NetReviewFilters, queryReviewItems,
                 updateReviewClassification, updateReviewDecisionFields,
  netCandidates, NetCandidateSummaryRow, NetCandidateRow,
                 NetCandidateSourceSummaryRow, NetCandidateEventSummaryRow,
                 NetCandidateYearSummaryRow,
                 NetCandidateFilters, queryCandidateItems,
  netCurated,    NetCuratedDetailRow, NetCuratedMatchRow,
  netCuratedBrowse,
                 NetCuratedStatusSummaryRow, NetCuratedSourceSummaryRow,
                 NetCuratedEventSummaryRow, NetCuratedYearSummaryRow,
                 NetCuratedBrowseFilters, queryCuratedItems, NetCuratedBrowseRow,
  transaction,
} from '../db/db';
import { NotFoundError, ConflictError, ValidationError } from './serviceErrors';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Evidence disclaimer — always rendered on net pages (not conditioned on data)
// ---------------------------------------------------------------------------
const TEAM_DISCLAIMER =
  'Team identities are algorithmically constructed from placement data and may not reflect official partnerships.';

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export interface NetHomeTopTeamViewModel {
  teamId:             string;
  teamName:           string;
  teamHref:           string;
  yearSpan:           string | null;
  appearanceCount:    number;
  winCount:           number;
  podiumCount:        number;
  bestPlacementLabel: string;
}

export interface NetHomeTopPlayerViewModel {
  personId:        string;
  personName:      string;
  country:         string | null;
  partnerCount:    number;
  appearanceCount: number;
  href:            string;
}

export interface NetHomeRecentEventViewModel {
  eventId:             string;
  eventTitle:          string;
  eventHref:           string;
  eventYear:           number;
  appearanceCount:     number;
  hasMultiStageHint:   boolean;
}

export interface NetHomeInterestingTeamViewModel {
  teamId:             string;
  teamName:           string;
  teamHref:           string;
  yearSpan:           string | null;
  winCount:           number;
  bestPlacementLabel: string;
}

interface NotableBucketViewModel {
  title:        string;
  partnerships: NetPartnershipViewModel[];
}

interface NotablePlayerItemViewModel {
  personId:         string;
  personName:       string;
  country:          string | null;
  href:             string;
  totalAppearances: number;
  totalWins:        number;
  totalPodiums:     number;
  yearSpan:         string | null;
  partnerCount:     number;
}

interface NotablePlayerBucketViewModel {
  title:   string;
  players: NotablePlayerItemViewModel[];
}

interface NetHomePageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    topTeams:              NetHomeTopTeamViewModel[];
    topPlayers:            NetHomeTopPlayerViewModel[];
    recentEvents:          NetHomeRecentEventViewModel[];
    interestingTeams:      NetHomeInterestingTeamViewModel[];
    notablePartnerships:   NotableBucketViewModel[];
    notablePlayers:        NotablePlayerBucketViewModel[];
    disclaimer:            string;
  };
}

export interface NetTeamViewModel {
  teamId:          string;
  teamName:        string;       // "Smith / Jones"
  personIdA:       string;
  personNameA:     string;
  countryA:        string | null;
  hrefA:           string | null;
  personIdB:       string;
  personNameB:     string;
  countryB:        string | null;
  hrefB:           string | null;
  firstYear:       number | null;
  lastYear:        number | null;
  yearSpan:        string | null;  // "2005–2012" or "2010" for single-year
  appearanceCount: number;
  teamHref:        string;
}

export interface NetAppearanceViewModel {
  eventId:        string;
  eventTitle:     string;
  eventHref:      string;
  eventCity:      string;
  eventCountry:   string;
  startDate:      string;
  disciplineLabel: string;   // raw name if conflict_flag=1, canonical_group label otherwise
  disciplineRaw:  string;    // always the raw name (for tooltip/title)
  placement:      number;
  placementLabel: string;    // "1st", "2nd", etc.
  scoreText:      string | null;
  eventYear:      number;
}

export interface NetAppearanceYearGroup {
  year:        number;
  appearances: NetAppearanceViewModel[];
}

interface NetTeamsPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string; intro: string };
  content: {
    teams:      NetTeamViewModel[];
    totalTeams: number;
    disclaimer: string;
  };
}

interface NetTeamDetailViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    team:        NetTeamViewModel;
    byYear:      NetAppearanceYearGroup[];
    disclaimer:  string;
  };
}

interface NetPartnershipSummaryViewModel {
  appearanceCount: number;
  winCount:        number;
  podiumCount:     number;
  yearSpan:        string | null;
}

interface NetPartnershipDetailPageViewModel {
  seo:  { title: string };
  page: { sectionKey: string; pageKey: string; title: string };
  content: {
    team:         NetTeamViewModel;
    summary:      NetPartnershipSummaryViewModel;
    appearances:  NetAppearanceViewModel[];
    disclaimer:   string;
  };
}

export interface NetPartnershipViewModel {
  teamId:          string;
  teamName:        string;
  teamHref:        string;
  personIdA:       string;
  personNameA:     string;
  hrefA:           string | null;
  personIdB:       string;
  personNameB:     string;
  hrefB:           string | null;
  appearanceCount: number;
  winCount:        number;
  podiumCount:     number;
  yearSpan:        string | null;
}

interface DivisionFilterOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

interface NetPartnershipsPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string; intro: string };
  content: {
    partnerships:    NetPartnershipViewModel[];
    totalShown:      number;
    divisionOptions: DivisionFilterOption[];
    activeDivision:  string | null;
    activeSearch:    string | null;
    disclaimer:      string;
  };
}

// ── Recovery signals (internal) ──────────────────────────────────────────────

interface RecoveryPartnerRepeatVM {
  knownPlayer:  string;
  knownHref:    string | null;
  stubPartner:  string;
  stubPid:      string;
  coCount:      number;
  years:        string;
}

interface RecoveryAbbreviationVM {
  stubName:    string;
  stubPid:     string;
  likelyMatch: string;
  likelyHref:  string | null;
}

interface RecoveryHighValueVM {
  personName:  string;
  personId:    string;
  appearances: number;
  eventCount:  number;
  years:       string;
}

interface NetRecoverySignalsPageViewModel {
  seo:  { title: string };
  page: { sectionKey: string; pageKey: string; title: string };
  content: {
    stubCount:                number;
    unresolvedPartnerRepeats: RecoveryPartnerRepeatVM[];
    abbreviationClusters:     RecoveryAbbreviationVM[];
    highValueCandidates:      RecoveryHighValueVM[];
  };
}

interface RecoveryCandidateVM {
  id:              string;
  stubName:        string;
  stubPid:         string;
  suggestedName:   string;
  suggestedPid:    string;
  suggestedHref:   string | null;
  suggestionType:  string;
  confidence:      string;
  appearances:     number;
  operatorDecision: string | null;
  operatorNotes:   string | null;
}

interface RecoveryNewPersonVM {
  personName:  string;
  personId:    string;
  appearances: number;
  eventCount:  number;
  years:       string;
}

interface NetRecoveryCandidatesPageViewModel {
  seo:  { title: string };
  page: { sectionKey: string; pageKey: string; title: string };
  content: {
    aliasCandidates:     RecoveryCandidateVM[];
    newPersonCandidates: RecoveryNewPersonVM[];
    totalAlias:          number;
    totalApproved:       number;
    totalNewPerson:      number;
  };
}

export interface NetPlayerViewModel {
  personId:         string;
  personName:       string;
  country:          string | null;
  totalAppearances: number;
  href:             string;   // /net/players/:personId
}

export interface NetPartnerViewModel {
  partnerPersonId:   string;
  partnerName:       string;
  partnerCountry:    string | null;
  partnerHref:       string;  // /net/players/:partnerId
  teamId:            string;
  teamHref:          string;  // /net/players/:personId/partners/:teamId
  appearanceCount:   number;
  firstYear:         number | null;
  lastYear:          number | null;
  yearSpan:          string | null;
  bestPlacement:     number;
  bestPlacementLabel: string;
}

export interface NetPartnerNetworkViewModel {
  partnerPersonId: string;
  partnerName:     string;
  partnerCountry:  string | null;
  partnerHref:     string;
  appearanceCount: number;
  winCount:        number;
  podiumCount:     number;
  yearSpan:        string | null;
}

interface CareerHighlightPartner {
  partnerName: string;
  partnerHref: string;
  stat:        string;   // e.g. "33 appearances", "22 wins", "1985–2025"
}

interface CareerHighlightsViewModel {
  mostFrequentPartner:    CareerHighlightPartner | null;
  mostSuccessfulPartner:  CareerHighlightPartner | null;
  longestPartnership:     CareerHighlightPartner | null;
  careerSpan:             string | null;   // "1985–2025 (40 years)"
  hasHighlights:          boolean;
}

interface NetPlayerPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    player:           NetPlayerViewModel;
    partners:         NetPartnerViewModel[];
    topPartners:      NetPartnerNetworkViewModel[];
    careerHighlights: CareerHighlightsViewModel;
    totalPartners:    number;
    disclaimer:       string;
  };
}

export interface NetEventQcHints {
  hasMultiStageHint:         boolean;
  unknownTeamExcludedCount:  number;
  disciplineReviewCount:     number;
}

export interface NetEventViewModel {
  eventId:          string;
  eventTitle:       string;
  eventHref:        string;
  startDate:        string;
  city:             string;
  country:          string;
  eventYear:        number;
  appearanceCount:  number;
  disciplineCount:  number;
  teamCount:        number;
  qcHints:          NetEventQcHints;
}

export interface NetEventAppearanceViewModel {
  teamId:           string;
  teamName:         string;
  teamHref:         string;
  personIdA:        string;
  personNameA:      string;
  hrefA:            string;
  personIdB:        string;
  personNameB:      string;
  hrefB:            string;
  placement:        number;
  placementLabel:   string;
  scoreText:        string | null;
}

export interface NetEventDisciplineGroup {
  disciplineId:    string;
  disciplineLabel: string;
  hasConflictFlag: boolean;
  appearances:     NetEventAppearanceViewModel[];
}

interface NetEventsPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string; intro: string };
  content: {
    events:      NetEventViewModel[];
    totalEvents: number;
    disclaimer:  string;
  };
}

interface NetEventDetailViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    event:         NetEventViewModel;
    byDiscipline:  NetEventDisciplineGroup[];
    disclaimer:    string;
  };
}

interface NetPlayerPartnerDetailViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    player:           NetPlayerViewModel;
    partner: {
      personId:    string;
      personName:  string;
      country:     string | null;
      href:        string;
    };
    teamId:           string;
    teamDetailHref:   string;  // /net/teams/:teamId — canonical team page
    appearanceCount:  number;
    bestPlacement:    number | null;
    bestPlacementLabel: string | null;
    yearSpan:         string | null;
    byYear:           NetAppearanceYearGroup[];
    disclaimer:       string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function netPlayerHref(personId: string): string {
  return `/net/players/${personId}`;
}

function netPartnerDetailHref(personId: string, teamId: string): string {
  return `/net/players/${personId}/partners/${teamId}`;
}

function eventHref(eventId: string): string {
  return `/events/${eventId}`;
}

function netEventHref(eventId: string): string {
  return `/net/events/${eventId}`;
}

function teamName(nameA: string, nameB: string): string {
  return `${nameA} / ${nameB}`;
}

function yearSpan(first: number | null, last: number | null): string | null {
  if (first === null) return null;
  if (last === null || first === last) return String(first);
  return `${first}–${last}`;
}

function placementLabel(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// Canonical group labels for display — used only when conflict_flag=0
const GROUP_LABELS: Record<string, string> = {
  open_doubles:          'Open Doubles',
  mixed_doubles:         'Mixed Doubles',
  womens_doubles:        "Women's Doubles",
  intermediate_doubles:  'Intermediate Doubles',
  novice_doubles:        'Novice Doubles',
  masters_doubles:       'Masters Doubles',
  other_doubles:         'Doubles',
  open_singles:          'Open Singles',
  womens_singles:        "Women's Singles",
  intermediate_singles:  'Intermediate Singles',
  novice_singles:        'Novice Singles',
  masters_singles:       'Masters Singles',
  other_singles:         'Singles',
  uncategorized:         '',
};

function disciplineLabel(disciplineName: string, canonicalGroup: string | null, conflictFlag: number): string {
  // If conflict_flag=1 or no canonical_group, use the raw discipline name
  if (conflictFlag || !canonicalGroup) return disciplineName;
  return GROUP_LABELS[canonicalGroup] || disciplineName;
}

function shapeTeam(row: NetTeamSummaryRow): NetTeamViewModel {
  return {
    teamId:          row.team_id,
    teamName:        teamName(row.person_name_a, row.person_name_b),
    personIdA:       row.person_id_a,
    personNameA:     row.person_name_a,
    countryA:        row.country_a,
    hrefA:           netPlayerHref(row.person_id_a),
    personIdB:       row.person_id_b,
    personNameB:     row.person_name_b,
    countryB:        row.country_b,
    hrefB:           netPlayerHref(row.person_id_b),
    firstYear:       row.first_year,
    lastYear:        row.last_year,
    yearSpan:        yearSpan(row.first_year, row.last_year),
    appearanceCount: row.appearance_count,
    teamHref:        `/net/teams/${row.team_id}`,
  };
}

function shapeAppearance(row: NetTeamAppearanceRow): NetAppearanceViewModel {
  return {
    eventId:         row.event_id,
    eventTitle:      row.event_title,
    eventHref:       eventHref(row.event_id),
    eventCity:       row.event_city,
    eventCountry:    row.event_country,
    startDate:       row.start_date,
    disciplineLabel: disciplineLabel(row.discipline_name, row.canonical_group, row.conflict_flag),
    disciplineRaw:   row.discipline_name,
    placement:       row.placement,
    placementLabel:  placementLabel(row.placement),
    scoreText:       row.score_text,
    eventYear:       row.event_year,
  };
}

function groupAppearancesByYear(
  appearances: NetAppearanceViewModel[],
): NetAppearanceYearGroup[] {
  const map = new Map<number, NetAppearanceViewModel[]>();
  for (const a of appearances) {
    const group = map.get(a.eventYear) ?? [];
    group.push(a);
    map.set(a.eventYear, group);
  }
  // Sort years descending
  const years = [...map.keys()].sort((a, b) => b - a);
  return years.map(year => ({ year, appearances: map.get(year)! }));
}

function shapePlayer(row: NetPlayerSummaryRow): NetPlayerViewModel {
  return {
    personId:         row.person_id,
    personName:       row.person_name,
    country:          row.country,
    totalAppearances: row.total_net_appearances,
    href:             netPlayerHref(row.person_id),
  };
}

function shapePartner(personId: string, row: NetPartnerRow): NetPartnerViewModel {
  return {
    partnerPersonId:    row.partner_person_id,
    partnerName:        row.partner_name,
    partnerCountry:     row.partner_country,
    partnerHref:        netPlayerHref(row.partner_person_id),
    teamId:             row.team_id,
    teamHref:           netPartnerDetailHref(personId, row.team_id),
    appearanceCount:    row.appearance_count,
    firstYear:          row.first_year,
    lastYear:           row.last_year,
    yearSpan:           yearSpan(row.first_year, row.last_year),
    bestPlacement:      row.best_placement,
    bestPlacementLabel: placementLabel(row.best_placement),
  };
}

function buildCareerHighlights(networkRows: NetPartnerNetworkRow[]): CareerHighlightsViewModel {
  if (networkRows.length === 0) {
    return {
      mostFrequentPartner: null,
      mostSuccessfulPartner: null,
      longestPartnership: null,
      careerSpan: null,
      hasHighlights: false,
    };
  }

  function makeHighlight(r: NetPartnerNetworkRow, stat: string): CareerHighlightPartner {
    return {
      partnerName: r.partner_name,
      partnerHref: netPlayerHref(r.partner_person_id) ?? `/net/players/${r.partner_person_id}`,
      stat,
    };
  }

  // Most frequent: max appearance_count
  const byApps = [...networkRows].sort((a, b) =>
    b.appearance_count - a.appearance_count || b.win_count - a.win_count);
  const mostFrequent = byApps[0];

  // Most successful: max win_count (skip if 0 wins across all partners)
  const byWins = [...networkRows].sort((a, b) =>
    b.win_count - a.win_count || b.podium_count - a.podium_count || b.appearance_count - a.appearance_count);
  const mostSuccessful = byWins[0].win_count > 0 ? byWins[0] : null;

  // Longest partnership: max span
  const bySpan = [...networkRows].sort((a, b) => {
    const spanA = (a.last_year ?? 0) - (a.first_year ?? 0);
    const spanB = (b.last_year ?? 0) - (b.first_year ?? 0);
    return spanB - spanA || b.appearance_count - a.appearance_count;
  });
  const longest = bySpan[0];
  const longestSpanYears = (longest.last_year ?? 0) - (longest.first_year ?? 0);

  // Career span across all partnerships
  let minYear: number | null = null;
  let maxYear: number | null = null;
  for (const r of networkRows) {
    if (r.first_year !== null && (minYear === null || r.first_year < minYear)) minYear = r.first_year;
    if (r.last_year !== null && (maxYear === null || r.last_year > maxYear)) maxYear = r.last_year;
  }

  let careerSpanStr: string | null = null;
  if (minYear !== null && maxYear !== null) {
    const spanLen = maxYear - minYear;
    if (minYear === maxYear) {
      careerSpanStr = `${minYear}`;
    } else {
      careerSpanStr = `${minYear}–${maxYear} (${spanLen} years)`;
    }
  }

  return {
    mostFrequentPartner:   makeHighlight(mostFrequent, `${mostFrequent.appearance_count} appearances`),
    mostSuccessfulPartner: mostSuccessful
      ? makeHighlight(mostSuccessful, `${mostSuccessful.win_count} wins`)
      : null,
    longestPartnership:    longestSpanYears > 0
      ? makeHighlight(longest, yearSpan(longest.first_year, longest.last_year) ?? '')
      : null,
    careerSpan:            careerSpanStr,
    hasHighlights:         true,
  };
}

function shapeHomeTopTeam(row: NetHomeTopTeamRow): NetHomeTopTeamViewModel {
  return {
    teamId:             row.team_id,
    teamName:           teamName(row.person_name_a, row.person_name_b),
    teamHref:           `/net/teams/${row.team_id}`,
    yearSpan:           yearSpan(row.first_year, row.last_year),
    appearanceCount:    row.appearance_count,
    winCount:           row.win_count,
    podiumCount:        row.podium_count,
    bestPlacementLabel: placementLabel(row.best_placement),
  };
}

function shapeHomeTopPlayer(row: NetHomeTopPlayerRow): NetHomeTopPlayerViewModel {
  return {
    personId:        row.person_id,
    personName:      row.person_name,
    country:         row.country,
    partnerCount:    row.partner_count,
    appearanceCount: row.appearance_count,
    href:            netPlayerHref(row.person_id),
  };
}

function shapeHomeRecentEvent(row: NetHomeRecentEventRow): NetHomeRecentEventViewModel {
  return {
    eventId:           row.event_id,
    eventTitle:        row.event_title,
    eventHref:         netEventHref(row.event_id),
    eventYear:         row.event_year,
    appearanceCount:   row.appearance_count,
    hasMultiStageHint: row.has_multi_stage_hint === 1,
  };
}

function shapeHomeInterestingTeam(row: NetHomeInterestingTeamRow): NetHomeInterestingTeamViewModel {
  return {
    teamId:             row.team_id,
    teamName:           teamName(row.person_name_a, row.person_name_b),
    teamHref:           `/net/teams/${row.team_id}`,
    yearSpan:           yearSpan(row.first_year, row.last_year),
    winCount:           row.win_count,
    bestPlacementLabel: placementLabel(row.best_placement),
  };
}

function shapeEventSummary(row: NetEventSummaryRow): NetEventViewModel {
  return {
    eventId:         row.event_id,
    eventTitle:      row.event_title,
    eventHref:       netEventHref(row.event_id),
    startDate:       row.start_date,
    city:            row.city,
    country:         row.country,
    eventYear:       row.event_year,
    appearanceCount: row.appearance_count,
    disciplineCount: row.discipline_count,
    teamCount:       row.team_count,
    qcHints: {
      hasMultiStageHint:        row.has_multi_stage_hint === 1,
      unknownTeamExcludedCount: row.unknown_team_excluded_count,
      disciplineReviewCount:    row.discipline_review_count,
    },
  };
}

function shapeEventAppearance(row: NetEventAppearanceRow): NetEventAppearanceViewModel {
  return {
    teamId:        row.team_id,
    teamName:      teamName(row.person_name_a, row.person_name_b),
    teamHref:      `/net/partnerships/${row.team_id}`,
    personIdA:     row.person_id_a,
    personNameA:   row.person_name_a,
    hrefA:         netPlayerHref(row.person_id_a),
    personIdB:     row.person_id_b,
    personNameB:   row.person_name_b,
    hrefB:         netPlayerHref(row.person_id_b),
    placement:     row.placement,
    placementLabel: placementLabel(row.placement),
    scoreText:     row.score_text,
  };
}

function groupAppearancesByDiscipline(
  rows: NetEventAppearanceRow[],
): NetEventDisciplineGroup[] {
  const map = new Map<string, { label: string; hasConflictFlag: boolean; appearances: NetEventAppearanceViewModel[] }>();
  for (const row of rows) {
    if (!map.has(row.discipline_id)) {
      map.set(row.discipline_id, {
        label:          disciplineLabel(row.discipline_name, row.canonical_group, row.conflict_flag),
        hasConflictFlag: row.conflict_flag === 1,
        appearances:    [],
      });
    }
    map.get(row.discipline_id)!.appearances.push(shapeEventAppearance(row));
  }
  return [...map.entries()].map(([disciplineId, v]) => ({
    disciplineId,
    disciplineLabel: v.label,
    hasConflictFlag: v.hasConflictFlag,
    appearances:     v.appearances,
  }));
}

// ---------------------------------------------------------------------------
// Service
// ── Review / QC view-model types ──────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Structural',
  4: 'Low',
};

interface FilterOption {
  value: string;
  label: string;
  selected: boolean;
}

interface NetReviewSummaryViewModel {
  byReason:         { reasonCode: string | null; count: number }[];
  byPriority:       { priority: number; label: string; count: number }[];
  byStatus:         { status: string; count: number }[];
  byClassification: { label: string; value: string; count: number }[];
  byDecision:       { label: string; value: string; count: number }[];
  totalItems:       number;
}

interface NetReviewItemViewModel {
  id:             string;
  priority:       number;
  priorityLabel:  string;
  reasonCode:     string | null;
  severity:       string;
  message:        string;
  eventId:        string | null;
  eventTitle:     string | null;
  eventHref:      string | null;
  disciplineId:   string | null;
  disciplineName: string | null;
  reviewStage:    string | null;
  status:         string;
  importedAt:     string;
  // Classification fields (all nullable)
  classification:            string | null;
  classificationLabel:       string | null;
  proposedFixType:           string | null;
  proposedFixTypeLabel:      string | null;
  classificationConfidence:  string | null;
  confidenceLabel:           string | null;
  decisionStatus:            string | null;
  decisionStatusLabel:       string | null;
  decisionNotes:             string | null;
  classifiedBy:              string | null;
  classifiedAt:              string | null;
}

interface NetReviewConflictDisciplineViewModel {
  disciplineId:   string;
  disciplineName: string;
  canonicalGroup: string;
  conflictFlag:   boolean;
  reviewNeeded:   boolean;
  matchMethod:    string;
}

interface NetReviewEventContextViewModel {
  eventId:   string;
  title:     string;
  startDate: string;
  city:      string;
  country:   string;
  href:      string;
}

interface NetReviewPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    summary:              NetReviewSummaryViewModel;
    items:                NetReviewItemViewModel[];
    totalFiltered:        number;
    eventContext:         NetReviewEventContextViewModel | null;
    conflictDisciplines:  NetReviewConflictDisciplineViewModel[];
    filterOptions: {
      reasonCodes:      FilterOption[];
      priorities:       FilterOption[];
      statuses:         FilterOption[];
      classifications:  FilterOption[];
      fixTypes:         FilterOption[];
      decisionStatuses: FilterOption[];
    };
    activeFilters: {
      reasonCode:        string | null;
      priority:          number | null;
      resolutionStatus:  string | null;
      eventId:           string | null;
      classification:    string | null;
      proposedFixType:   string | null;
      decisionStatus:    string | null;
    };
  };
}

interface NetReviewSummaryPageViewModel {
  seo:  { title: string };
  page: { sectionKey: string; pageKey: string; title: string };
  content: {
    totals: {
      total:        number;
      classified:   number;
      decided:      number;
      unclassified: number;
      classifiedPct: string;
    };
    byClassification: { label: string; value: string; count: number; href: string }[];
    byFixType:        { label: string; value: string; count: number; href: string }[];
    byDecision:       { label: string; value: string; count: number; href: string }[];
    actionableFixes:  { label: string; value: string; count: number; href: string }[];
    topEvents:        { eventId: string; eventTitle: string; count: number; href: string }[];
  };
}

// ── Candidate view-model types ─────────────────────────────────────────────

interface NetCuratedBrowseItemViewModel {
  curatedId:       string;
  candidateId:     string;
  candidateHref:   string;
  curatedStatus:   string;
  curatorNote:     string | null;
  curatedBy:       string;
  curatedAt:       string;
  eventId:         string | null;
  eventTitle:      string | null;
  eventHref:       string | null;
  disciplineId:    string | null;
  disciplineName:  string | null;
  playerAPersonId: string | null;
  playerAName:     string | null;
  playerARawName:  string | null;
  playerBPersonId: string | null;
  playerBName:     string | null;
  playerBRawName:  string | null;
  extractedScore:  string | null;
  roundHint:       string | null;
  yearHint:        number | null;
  sourceFile:      string | null;
  rawText:         string;
  isFullyLinked:   boolean;
}

interface NetCuratedMetricsViewModel {
  totalCurated:  number;
  approvedCount: number;
  rejectedCount: number;
  linkedCount:   number;
  approvedPct:   string;
  rejectedPct:   string;
  linkedPct:     string;
}

interface NetCuratedSourceSummaryViewModel {
  sourceFile:    string;
  curatedCount:  number;
  approvedCount: number;
  rejectedCount: number;
  filterHref:    string;
}

interface NetCuratedEventSummaryViewModel {
  eventId:       string;
  eventTitle:    string | null;
  curatedCount:  number;
  approvedCount: number;
  rejectedCount: number;
  filterHref:    string;
}

interface NetCuratedYearSummaryViewModel {
  yearHint:      number;
  curatedCount:  number;
  approvedCount: number;
  rejectedCount: number;
  filterHref:    string;
}

interface NetCuratedBrowseFilterOptions {
  statuses:      { value: string; label: string; selected: boolean }[];
  linkedFilter:  { value: string; label: string; selected: boolean }[];
}

interface NetCuratedBrowsePageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    metrics:         NetCuratedMetricsViewModel;
    summaryBySource: NetCuratedSourceSummaryViewModel[];
    summaryByEvent:  NetCuratedEventSummaryViewModel[];
    summaryByYear:   NetCuratedYearSummaryViewModel[];
    items:           NetCuratedBrowseItemViewModel[];
    totalFiltered:   number;
    filterOptions:   NetCuratedBrowseFilterOptions;
    activeFilters: {
      curatedStatus: string | null;
      sourceFile:    string | null;
      eventId:       string | null;
      yearHint:      number | null;
      linkedOnly:    boolean;
    };
  };
}

interface NetCuratedViewModel {
  curatedId:     string;
  curatedStatus: string;
  curatorNote:   string | null;
  curatedAt:     string;
  curatedBy:     string;
}

interface NetCandidateDetailViewModel {
  candidateId:      string;
  rawText:          string;
  playerARawName:   string | null;
  playerBRawName:   string | null;
  playerAPersonId:  string | null;
  playerBPersonId:  string | null;
  playerAName:      string | null;
  playerBName:      string | null;
  extractedScore:   string | null;
  roundHint:        string | null;
  confidenceScore:  number | null;
  confidenceLabel:  string;
  confidenceClass:  string;
  eventId:          string | null;
  eventTitle:       string | null;
  eventHref:        string | null;
  disciplineId:     string | null;
  disciplineName:   string | null;
  sourceFile:       string | null;
  yearHint:         number | null;
  reviewStatus:     string;
  importedAt:       string;
  isFullyLinked:    boolean;
}

interface NetCandidateDetailPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    candidate:       NetCandidateDetailViewModel;
    existing:        NetCuratedViewModel | null;
    isAlreadyCurated: boolean;
    backHref:        string;
  };
}

interface NetCandidateViewModel {
  candidateId:       string;
  rawText:           string;
  playerARawName:    string | null;
  playerBRawName:    string | null;
  playerAPersonId:   string | null;
  playerBPersonId:   string | null;
  playerAName:       string | null;
  playerBName:       string | null;
  extractedScore:    string | null;
  roundHint:         string | null;
  confidenceScore:   number | null;
  confidenceLabel:   string;
  confidenceClass:   string;     // 'conf-high' | 'conf-medium' | 'conf-low' | 'conf-unknown'
  eventId:           string | null;
  eventTitle:        string | null;
  eventHref:         string | null;
  sourceFile:        string | null;
  yearHint:          number | null;
  reviewStatus:      string;
  importedAt:        string;
  isFullyLinked:     boolean;
}

interface NetCandidatesMetricsViewModel {
  totalFragments:  number;
  totalCandidates: number;
  promoteRatePct:  string;
  linkedRatePct:   string;
  highConfCount:   number;
  mediumConfCount: number;
  lowConfCount:    number;
  unknownConfCount: number;
}

interface NetCandidatesSourceSummaryViewModel {
  sourceFile:      string;
  fragmentCount:   number;
  candidateCount:  number;
  highConfCount:   number;
  mediumConfCount: number;
  lowConfCount:    number;
  linkedCount:     number;
  linkedPct:       string;
  filterHref:      string;
}

interface NetCandidatesEventSummaryViewModel {
  eventId:        string | null;
  eventTitle:     string | null;
  eventHref:      string | null;
  candidateCount: number;
  linkedCount:    number;
  linkedPct:      string;
  avgConfidence:  string;
  yearHint:       number | null;
  filterHref:     string;
}

interface NetCandidatesYearSummaryViewModel {
  yearHint:       number | null;
  yearLabel:      string;
  candidateCount: number;
  linkedCount:    number;
  linkedPct:      string;
  avgConfidence:  string;
}

interface NetCandidateGroup {
  groupKey:   string;
  groupLabel: string;
  items:      NetCandidateViewModel[];
}

interface NetCandidatesSummaryViewModel {
  totalCandidates:   number;
  byStatus: Array<{ status: string; linkedCount: number; totalCount: number }>;
}

interface NetCandidatesFilterOptions {
  statuses:        FilterOption[];
  linkedFilter:    FilterOption[];
  groupByOptions:  FilterOption[];
  confOptions:     FilterOption[];
}

interface NetCandidatesPageViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string };
  content: {
    metrics:         NetCandidatesMetricsViewModel;
    summaryBySource: NetCandidatesSourceSummaryViewModel[];
    summaryByEvent:  NetCandidatesEventSummaryViewModel[];
    summaryByYear:   NetCandidatesYearSummaryViewModel[];
    summary:         NetCandidatesSummaryViewModel;
    items:           NetCandidateViewModel[];
    groups:          NetCandidateGroup[] | null;
    totalFiltered:   number;
    filterOptions:   NetCandidatesFilterOptions;
    activeFilters: {
      reviewStatus:  string | null;
      eventId:       string | null;
      sourceFile:    string | null;
      linkedOnly:    boolean;
      minConfidence: number | null;
      groupBy:       string | null;
    };
  };
}

// ── Review helpers ─────────────────────────────────────────────────────────

const CLASSIFICATION_LABELS: Record<string, string> = {
  retag_team_type:              'Retag Team Type',
  split_merged_discipline:      'Split Merged Discipline',
  quarantine_non_results_block: 'Quarantine Non-Results Block',
  parser_improvement:           'Parser Improvement',
  unresolved:                   'Unresolved',
};

const FIX_TYPE_LABELS: Record<string, string> = {
  retag_team_type:              'Retag Team Type',
  rename_discipline:            'Rename Discipline',
  rename_and_retag:             'Rename & Retag',
  reshape_doubles_to_singles:   'Reshape Doubles → Singles',
  split_merged_discipline:      'Split Merged Discipline',
  quarantine_non_results_block: 'Quarantine Non-Results Block',
  parser_improvement:           'Parser Improvement',
};

const DECISION_STATUS_LABELS: Record<string, string> = {
  fix_encoded: 'Fix Encoded',
  fix_active:  'Fix Active',
  deferred:    'Deferred',
  wont_fix:    "Won't Fix",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  tentative: 'Tentative',
};

function buildReviewSummary(rows: NetReviewSummaryRow[]): NetReviewSummaryViewModel {
  const reasonMap   = new Map<string | null, number>();
  const priorityMap = new Map<number, number>();
  const statusMap   = new Map<string, number>();

  for (const row of rows) {
    const rc = row.reason_code ?? null;
    reasonMap.set(rc,         (reasonMap.get(rc)             ?? 0) + row.item_count);
    priorityMap.set(row.priority, (priorityMap.get(row.priority) ?? 0) + row.item_count);
    statusMap.set(row.resolution_status, (statusMap.get(row.resolution_status) ?? 0) + row.item_count);
  }

  const totalItems = [...statusMap.values()].reduce((a, b) => a + b, 0);

  const classificationRows = netReview.listClassificationSummary.all() as NetReviewClassificationSummaryRow[];
  const decisionRows       = netReview.listDecisionSummary.all() as NetReviewDecisionSummaryRow[];

  return {
    byReason: [...reasonMap.entries()]
      .sort(([a], [b]) => String(a ?? '').localeCompare(String(b ?? '')))
      .map(([reasonCode, count]) => ({ reasonCode, count })),
    byPriority: [...priorityMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([priority, count]) => ({
        priority,
        label: PRIORITY_LABELS[priority] ?? String(priority),
        count,
      })),
    byStatus: [...statusMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => ({ status, count })),
    byClassification: classificationRows.map(r => ({
      value: r.classification,
      label: CLASSIFICATION_LABELS[r.classification] ?? r.classification,
      count: r.item_count,
    })),
    byDecision: decisionRows.map(r => ({
      value: r.decision_status,
      label: DECISION_STATUS_LABELS[r.decision_status] ?? r.decision_status,
      count: r.item_count,
    })),
    totalItems,
  };
}

function shapeReviewItem(row: NetReviewItemRow): NetReviewItemViewModel {
  return {
    id:             row.id,
    priority:       row.priority,
    priorityLabel:  PRIORITY_LABELS[row.priority] ?? String(row.priority),
    reasonCode:     row.reason_code,
    severity:       row.severity,
    message:        row.message,
    eventId:        row.event_id,
    eventTitle:     row.event_title,
    eventHref:      row.event_id ? `/net/events/${row.event_id}` : null,
    disciplineId:   row.discipline_id,
    disciplineName: row.discipline_name,
    reviewStage:    row.review_stage,
    status:         row.resolution_status,
    importedAt:     row.imported_at.slice(0, 10),  // date portion only
    classification:            row.classification,
    classificationLabel:       row.classification ? (CLASSIFICATION_LABELS[row.classification] ?? row.classification) : null,
    proposedFixType:           row.proposed_fix_type,
    proposedFixTypeLabel:      row.proposed_fix_type ? (FIX_TYPE_LABELS[row.proposed_fix_type] ?? row.proposed_fix_type) : null,
    classificationConfidence:  row.classification_confidence,
    confidenceLabel:           row.classification_confidence ? (CONFIDENCE_LABELS[row.classification_confidence] ?? row.classification_confidence) : null,
    decisionStatus:            row.decision_status,
    decisionStatusLabel:       row.decision_status ? (DECISION_STATUS_LABELS[row.decision_status] ?? row.decision_status) : null,
    decisionNotes:             row.decision_notes,
    classifiedBy:              row.classified_by,
    classifiedAt:              row.classified_at ? row.classified_at.slice(0, 10) : null,
  };
}

function shapeConflictDiscipline(
  row: NetReviewConflictDisciplineRow,
): NetReviewConflictDisciplineViewModel {
  return {
    disciplineId:   row.discipline_id,
    disciplineName: row.discipline_name,
    canonicalGroup: row.canonical_group,
    conflictFlag:   row.conflict_flag === 1,
    reviewNeeded:   row.review_needed === 1,
    matchMethod:    row.match_method,
  };
}

function buildFilterOptions(
  summary: NetReviewSummaryViewModel,
  filters: NetReviewFilters,
): NetReviewPageViewModel['content']['filterOptions'] {
  const reasonCodes: FilterOption[] = [
    { value: '', label: 'All reasons', selected: !filters.reason_code },
    ...summary.byReason
      .filter(r => r.reasonCode !== null)
      .map(r => ({
        value:    r.reasonCode as string,
        label:    `${r.reasonCode} (${r.count})`,
        selected: r.reasonCode === filters.reason_code,
      })),
  ];

  const priorities: FilterOption[] = [
    { value: '', label: 'All priorities', selected: filters.priority === undefined },
    ...[1, 2, 3, 4].map(p => ({
      value:    String(p),
      label:    `${p} — ${PRIORITY_LABELS[p]}`,
      selected: filters.priority === p,
    })),
  ];

  const STATUSES = ['open', 'resolved', 'wont_fix', 'escalated'];
  const statuses: FilterOption[] = [
    { value: '', label: 'All statuses', selected: !filters.resolution_status },
    ...STATUSES.map(s => ({
      value:    s,
      label:    s,
      selected: s === filters.resolution_status,
    })),
  ];

  const classifications: FilterOption[] = [
    { value: '', label: 'All classifications', selected: !filters.classification },
    ...Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => ({
      value,
      label,
      selected: value === filters.classification,
    })),
  ];

  const fixTypes: FilterOption[] = [
    { value: '', label: 'All fix types', selected: !filters.proposed_fix_type },
    ...Object.entries(FIX_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
      selected: value === filters.proposed_fix_type,
    })),
  ];

  const decisionStatuses: FilterOption[] = [
    { value: '', label: 'All decisions', selected: !filters.decision_status },
    ...Object.entries(DECISION_STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
      selected: value === filters.decision_status,
    })),
  ];

  return { reasonCodes, priorities, statuses, classifications, fixTypes, decisionStatuses };
}

// ── Candidate helpers ──────────────────────────────────────────────────────

function confidenceLabel(score: number | null): string {
  if (score === null) return 'unknown';
  if (score >= 0.85) return 'high';
  if (score >= 0.70) return 'medium';
  return 'low';
}

function confidenceClass(score: number | null): string {
  if (score === null) return 'conf-unknown';
  if (score >= 0.85) return 'conf-high';
  if (score >= 0.70) return 'conf-medium';
  return 'conf-low';
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

function fmtConf(avg: number | null): string {
  if (avg === null) return '—';
  return avg.toFixed(2);
}

function shapeCandidate(row: NetCandidateRow): NetCandidateViewModel {
  return {
    candidateId:     row.candidate_id,
    rawText:         row.raw_text,
    playerARawName:  row.player_a_raw_name,
    playerBRawName:  row.player_b_raw_name,
    playerAPersonId: row.player_a_person_id,
    playerBPersonId: row.player_b_person_id,
    playerAName:     row.person_name_a,
    playerBName:     row.person_name_b,
    extractedScore:  row.extracted_score,
    roundHint:       row.round_hint,
    confidenceScore: row.confidence_score,
    confidenceLabel: confidenceLabel(row.confidence_score),
    confidenceClass: confidenceClass(row.confidence_score),
    eventId:         row.event_id,
    eventTitle:      row.event_title,
    eventHref:       row.event_id ? `/net/events/${row.event_id}` : null,
    sourceFile:      row.source_file,
    yearHint:        row.year_hint,
    reviewStatus:    row.review_status,
    importedAt:      row.imported_at,
    isFullyLinked:   row.player_a_person_id !== null && row.player_b_person_id !== null,
  };
}

function shapeCuratedBrowseItem(row: NetCuratedBrowseRow): NetCuratedBrowseItemViewModel {
  return {
    curatedId:       row.curated_id,
    candidateId:     row.candidate_id,
    candidateHref:   `/internal/net/candidates/${row.candidate_id}`,
    curatedStatus:   row.curated_status,
    curatorNote:     row.curator_note,
    curatedBy:       row.curated_by,
    curatedAt:       row.curated_at.slice(0, 10),
    eventId:         row.event_id,
    eventTitle:      row.event_title,
    eventHref:       row.event_id ? `/net/events/${row.event_id}` : null,
    disciplineId:    row.discipline_id,
    disciplineName:  row.discipline_name,
    playerAPersonId: row.player_a_person_id,
    playerAName:     row.person_name_a,
    playerARawName:  row.player_a_raw_name,
    playerBPersonId: row.player_b_person_id,
    playerBName:     row.person_name_b,
    playerBRawName:  row.player_b_raw_name,
    extractedScore:  row.extracted_score,
    roundHint:       row.round_hint,
    yearHint:        row.year_hint,
    sourceFile:      row.source_file,
    rawText:         row.raw_text,
    isFullyLinked:   row.player_a_person_id !== null && row.player_b_person_id !== null,
  };
}

function buildCandidatesSummary(rows: NetCandidateSummaryRow[], totalCandidates: number): NetCandidatesSummaryViewModel {
  return {
    totalCandidates,
    byStatus: rows.map(r => ({
      status:       r.review_status,
      linkedCount:  r.linked_count,
      totalCount:   r.total_count,
    })),
  };
}

function buildMetrics(
  totalFragments: number,
  totalCandidates: number,
  sourceRows: NetCandidateSourceSummaryRow[],
): NetCandidatesMetricsViewModel {
  const highConf    = sourceRows.reduce((a, r) => a + r.high_conf_count,   0);
  const mediumConf  = sourceRows.reduce((a, r) => a + r.medium_conf_count, 0);
  const lowConf     = sourceRows.reduce((a, r) => a + r.low_conf_count,    0);
  const unknownConf = totalCandidates - highConf - mediumConf - lowConf;
  const linked      = sourceRows.reduce((a, r) => a + r.linked_candidate_count, 0);
  return {
    totalFragments,
    totalCandidates,
    promoteRatePct:  fmtPct(totalCandidates, totalFragments),
    linkedRatePct:   fmtPct(linked, totalCandidates),
    highConfCount:   highConf,
    mediumConfCount: mediumConf,
    lowConfCount:    lowConf,
    unknownConfCount: Math.max(0, unknownConf),
  };
}

function shapeSourceSummary(row: NetCandidateSourceSummaryRow): NetCandidatesSourceSummaryViewModel {
  return {
    sourceFile:      row.source_file,
    fragmentCount:   row.fragment_count,
    candidateCount:  row.candidate_count,
    highConfCount:   row.high_conf_count,
    mediumConfCount: row.medium_conf_count,
    lowConfCount:    row.low_conf_count,
    linkedCount:     row.linked_candidate_count,
    linkedPct:       fmtPct(row.linked_candidate_count, row.candidate_count),
    filterHref:      `/internal/net/candidates?source=${encodeURIComponent(row.source_file)}`,
  };
}

function shapeCandEventSummary(row: NetCandidateEventSummaryRow): NetCandidatesEventSummaryViewModel {
  return {
    eventId:        row.event_id,
    eventTitle:     row.event_title ?? row.event_id ?? '(no event)',
    eventHref:      row.event_id ? `/net/events/${row.event_id}` : null,
    candidateCount: row.candidate_count,
    linkedCount:    row.linked_candidate_count,
    linkedPct:      fmtPct(row.linked_candidate_count, row.candidate_count),
    avgConfidence:  fmtConf(row.avg_confidence),
    yearHint:       row.year_hint,
    filterHref:     row.event_id
      ? `/internal/net/candidates?event=${encodeURIComponent(row.event_id)}`
      : '/internal/net/candidates',
  };
}

function shapeYearSummary(row: NetCandidateYearSummaryRow): NetCandidatesYearSummaryViewModel {
  return {
    yearHint:       row.year_hint,
    yearLabel:      row.year_hint !== null ? String(row.year_hint) : '(unknown)',
    candidateCount: row.candidate_count,
    linkedCount:    row.linked_candidate_count,
    linkedPct:      fmtPct(row.linked_candidate_count, row.candidate_count),
    avgConfidence:  fmtConf(row.avg_confidence),
  };
}

function groupCandidates(
  items: NetCandidateViewModel[],
  groupBy: string,
): NetCandidateGroup[] {
  const map = new Map<string, NetCandidateViewModel[]>();
  for (const item of items) {
    let key: string;
    if (groupBy === 'event') {
      key = item.eventId ?? '(no event)';
    } else if (groupBy === 'source') {
      key = item.sourceFile ?? '(unknown source)';
    } else {
      key = item.yearHint !== null ? String(item.yearHint) : '(unknown year)';
    }
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  return [...map.entries()].map(([key, groupItems]) => {
    let label = key;
    if (groupBy === 'event') {
      label = groupItems[0]?.eventTitle ?? key;
    }
    return { groupKey: key, groupLabel: label, items: groupItems };
  });
}

function buildCandidatesFilterOptions(
  filters: NetCandidateFilters & { group_by?: string },
): NetCandidatesFilterOptions {
  const CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected', 'needs_info'];
  const statuses: FilterOption[] = [
    { value: '', label: 'All statuses', selected: !filters.review_status },
    ...CANDIDATE_STATUSES.map(s => ({
      value:    s,
      label:    s,
      selected: s === filters.review_status,
    })),
  ];
  const linkedFilter: FilterOption[] = [
    { value: '',      label: 'All candidates', selected: !filters.linked_only },
    { value: 'true',  label: 'Fully linked',   selected: !!filters.linked_only },
  ];
  const groupByOptions: FilterOption[] = [
    { value: '',       label: 'No grouping', selected: !filters.group_by },
    { value: 'event',  label: 'By event',    selected: filters.group_by === 'event' },
    { value: 'source', label: 'By source',   selected: filters.group_by === 'source' },
    { value: 'year',   label: 'By year',     selected: filters.group_by === 'year' },
  ];
  const CONF_THRESHOLDS = [
    { value: '',     label: 'Any confidence' },
    { value: '0.65', label: '≥ 0.65 (low+)' },
    { value: '0.70', label: '≥ 0.70 (medium+)' },
    { value: '0.85', label: '≥ 0.85 (high)' },
  ];
  const minConfStr = filters.min_confidence !== undefined ? String(filters.min_confidence) : '';
  const confOptions: FilterOption[] = CONF_THRESHOLDS.map(t => ({
    value:    t.value,
    label:    t.label,
    selected: t.value === minConfStr,
  }));
  return { statuses, linkedFilter, groupByOptions, confOptions };
}

// ---------------------------------------------------------------------------

export const netService = {
  getNetHomePage(): NetHomePageViewModel {
    const topTeamRows        = netHome.getTopTeams.all()             as NetHomeTopTeamRow[];
    const topPlayerRows      = netHome.getTopPlayersByPartners.all()  as NetHomeTopPlayerRow[];
    const recentEventRows    = netHome.getRecentEvents.all()          as NetHomeRecentEventRow[];
    const interestingTeamRows = netHome.getInterestingTeams.all()     as NetHomeInterestingTeamRow[];
    const notablePool        = netPartnerships.listNotablePool.all()  as NetPartnershipRow[];

    // Build notable buckets from the shared pool (different sort orders, top 5 each)
    const BUCKET_SIZE = 5;

    function shapePoolRow(r: NetPartnershipRow): NetPartnershipViewModel {
      return {
        teamId:          r.team_id,
        teamName:        teamName(r.person_name_a, r.person_name_b),
        teamHref:        `/net/partnerships/${r.team_id}`,
        personIdA:       r.person_id_a,
        personNameA:     r.person_name_a,
        hrefA:           netPlayerHref(r.person_id_a),
        personIdB:       r.person_id_b,
        personNameB:     r.person_name_b,
        hrefB:           netPlayerHref(r.person_id_b),
        appearanceCount: r.appearance_count,
        winCount:        r.win_count,
        podiumCount:     r.podium_count,
        yearSpan:        yearSpan(r.first_year, r.last_year),
      };
    }

    const byWins = [...notablePool].sort((a, b) =>
      b.win_count - a.win_count || b.podium_count - a.podium_count || b.appearance_count - a.appearance_count);

    const byPodiums = [...notablePool].sort((a, b) =>
      b.podium_count - a.podium_count || b.win_count - a.win_count || b.appearance_count - a.appearance_count);

    const bySpan = [...notablePool].sort((a, b) => {
      const spanA = (a.last_year ?? 0) - (a.first_year ?? 0);
      const spanB = (b.last_year ?? 0) - (b.first_year ?? 0);
      return spanB - spanA || b.appearance_count - a.appearance_count;
    });

    // Each bucket independently picks its top entries
    const notablePartnerships: NotableBucketViewModel[] = [];

    const winsB = byWins.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (winsB.length) notablePartnerships.push({ title: 'Most Wins', partnerships: winsB });

    const podiumsB = byPodiums.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (podiumsB.length) notablePartnerships.push({ title: 'Most Podium Finishes', partnerships: podiumsB });

    const spanB = bySpan.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (spanB.length) notablePartnerships.push({ title: 'Longest Spans', partnerships: spanB });

    // Notable players — buckets from player aggregate pool
    const playerPool = netHome.listNotablePlayerPool.all() as NetNotablePlayerRow[];

    function shapeNotablePlayer(r: NetNotablePlayerRow): NotablePlayerItemViewModel {
      return {
        personId:         r.person_id,
        personName:       r.person_name,
        country:          r.country,
        href:             netPlayerHref(r.person_id) ?? `/net/players/${r.person_id}`,
        totalAppearances: r.total_appearances,
        totalWins:        r.total_wins,
        totalPodiums:     r.total_podiums,
        yearSpan:         yearSpan(r.first_year, r.last_year),
        partnerCount:     r.partner_count,
      };
    }

    const playerByWins = [...playerPool].sort((a, b) =>
      b.total_wins - a.total_wins || b.total_podiums - a.total_podiums || b.total_appearances - a.total_appearances);

    const playerBySpan = [...playerPool].sort((a, b) => {
      const sa = (a.last_year ?? 0) - (a.first_year ?? 0);
      const sb = (b.last_year ?? 0) - (b.first_year ?? 0);
      return sb - sa || b.total_appearances - a.total_appearances;
    });

    const playerByPartners = [...playerPool].sort((a, b) =>
      b.partner_count - a.partner_count || b.total_appearances - a.total_appearances);

    const playerByPodiums = [...playerPool].sort((a, b) =>
      b.total_podiums - a.total_podiums || b.total_wins - a.total_wins || b.total_appearances - a.total_appearances);

    const notablePlayers: NotablePlayerBucketViewModel[] = [];

    const pwB = playerByWins.slice(0, BUCKET_SIZE).map(shapeNotablePlayer);
    if (pwB.length) notablePlayers.push({ title: 'Most Wins', players: pwB });

    const ppB = playerByPodiums.slice(0, BUCKET_SIZE).map(shapeNotablePlayer);
    if (ppB.length) notablePlayers.push({ title: 'Most Podium Finishes', players: ppB });

    const psB = playerBySpan.slice(0, BUCKET_SIZE).map(shapeNotablePlayer);
    if (psB.length) notablePlayers.push({ title: 'Longest Active Spans', players: psB });

    const pcB = playerByPartners.slice(0, BUCKET_SIZE).map(shapeNotablePlayer);
    if (pcB.length) notablePlayers.push({ title: 'Most Partner Connections', players: pcB });

    return {
      seo:  { title: 'Net Doubles' },
      page: {
        sectionKey: 'net',
        pageKey:    'net_home',
        title:      'Net Doubles',
      },
      content: {
        topTeams:            topTeamRows.map(shapeHomeTopTeam),
        topPlayers:          topPlayerRows.map(shapeHomeTopPlayer),
        recentEvents:        recentEventRows.map(shapeHomeRecentEvent),
        interestingTeams:    interestingTeamRows.map(shapeHomeInterestingTeam),
        notablePartnerships,
        notablePlayers,
        disclaimer:          TEAM_DISCLAIMER,
      },
    };
  },


  getNetReviewPage(filters: NetReviewFilters): NetReviewPageViewModel {
    const summaryRows     = netReview.listReviewSummary.all() as NetReviewSummaryRow[];
    const summary         = buildReviewSummary(summaryRows);
    const items           = queryReviewItems(filters).map(shapeReviewItem);
    const disciplineRows  = netReview.listConflictDisciplines.all() as NetReviewConflictDisciplineRow[];

    let eventContext: NetReviewEventContextViewModel | null = null;
    if (filters.event_id) {
      const evRow = netReview.getReviewEventContext.get(filters.event_id) as NetReviewEventContextRow | undefined;
      if (evRow) {
        eventContext = {
          eventId:   evRow.event_id,
          title:     evRow.title,
          startDate: evRow.start_date,
          city:      evRow.city,
          country:   evRow.country,
          href:      `/net/events/${evRow.event_id}`,
        };
      }
    }

    return {
      seo:  { title: 'Net Review / QC' },
      page: {
        sectionKey: '',
        pageKey:    'net_review',
        title:      'Net Review / QC',
      },
      content: {
        summary,
        items,
        totalFiltered:       items.length,
        eventContext,
        conflictDisciplines: disciplineRows.map(shapeConflictDiscipline),
        filterOptions:       buildFilterOptions(summary, filters),
        activeFilters: {
          reasonCode:       filters.reason_code       ?? null,
          priority:         filters.priority          ?? null,
          resolutionStatus: filters.resolution_status ?? null,
          eventId:          filters.event_id          ?? null,
          classification:   filters.classification    ?? null,
          proposedFixType:  filters.proposed_fix_type ?? null,
          decisionStatus:   filters.decision_status   ?? null,
        },
      },
    };
  },

  getNetReviewSummaryPage(): NetReviewSummaryPageViewModel {
    const totalsRow          = netReview.countTotals.get() as NetReviewTotalsRow;
    const classificationRows = netReview.listClassificationSummary.all() as NetReviewClassificationSummaryRow[];
    const fixTypeRows        = netReview.listFixTypeSummary.all() as NetReviewFixTypeSummaryRow[];
    const decisionRows       = netReview.listDecisionSummary.all() as NetReviewDecisionSummaryRow[];
    const actionableRows     = netReview.listActionableFixSummary.all() as NetReviewFixTypeSummaryRow[];
    const topEventRows       = netReview.listTopEventIssues.all() as NetReviewTopEventRow[];

    const classifiedPct = totalsRow.total > 0
      ? `${Math.round((totalsRow.classified / totalsRow.total) * 100)}%`
      : '—';

    return {
      seo:  { title: 'Net Review Summary' },
      page: {
        sectionKey: '',
        pageKey:    'net_review_summary',
        title:      'Net Review — Priority Summary',
      },
      content: {
        totals: { ...totalsRow, classifiedPct },
        byClassification: classificationRows.map(r => ({
          value: r.classification,
          label: CLASSIFICATION_LABELS[r.classification] ?? r.classification,
          count: r.item_count,
          href:  `/internal/net/review?classification=${encodeURIComponent(r.classification)}`,
        })),
        byFixType: fixTypeRows.map(r => ({
          value: r.proposed_fix_type,
          label: FIX_TYPE_LABELS[r.proposed_fix_type] ?? r.proposed_fix_type,
          count: r.item_count,
          href:  `/internal/net/review?fix_type=${encodeURIComponent(r.proposed_fix_type)}`,
        })),
        byDecision: decisionRows.map(r => ({
          value: r.decision_status,
          label: DECISION_STATUS_LABELS[r.decision_status] ?? r.decision_status,
          count: r.item_count,
          href:  `/internal/net/review?decision=${encodeURIComponent(r.decision_status)}`,
        })),
        actionableFixes: actionableRows.map(r => ({
          value: r.proposed_fix_type,
          label: FIX_TYPE_LABELS[r.proposed_fix_type] ?? r.proposed_fix_type,
          count: r.item_count,
          href:  `/internal/net/review?decision=fix_active&fix_type=${encodeURIComponent(r.proposed_fix_type)}`,
        })),
        topEvents: topEventRows.map(r => ({
          eventId:    r.event_id,
          eventTitle: r.event_title ?? r.event_id,
          count:      r.item_count,
          href:       `/internal/net/review?event=${encodeURIComponent(r.event_id)}`,
        })),
      },
    };
  },

  /**
   * Update classification fields on a review queue item.
   * Only fields present in the payload are written; others are preserved.
   * Always stamps classified_by='operator' and classified_at=now.
   * Throws NotFoundError if the item does not exist.
   * Throws ValidationError if any value is not in the allowed set.
   */
  classifyReviewItem(id: string, payload: {
    classification?:            string | null;
    proposed_fix_type?:         string | null;
    classification_confidence?: string | null;
  }): void {
    const VALID_CLASSIFICATIONS = new Set(Object.keys(CLASSIFICATION_LABELS));
    const VALID_FIX_TYPES       = new Set(Object.keys(FIX_TYPE_LABELS));
    const VALID_CONFIDENCES     = new Set(Object.keys(CONFIDENCE_LABELS));

    if (payload.classification != null && !VALID_CLASSIFICATIONS.has(payload.classification)) {
      throw new ValidationError(`Invalid classification: ${payload.classification}`);
    }
    if (payload.proposed_fix_type != null && !VALID_FIX_TYPES.has(payload.proposed_fix_type)) {
      throw new ValidationError(`Invalid proposed_fix_type: ${payload.proposed_fix_type}`);
    }
    if (payload.classification_confidence != null && !VALID_CONFIDENCES.has(payload.classification_confidence)) {
      throw new ValidationError(`Invalid classification_confidence: ${payload.classification_confidence}`);
    }

    const row = netReview.getReviewItemById.get(id);
    if (!row) throw new NotFoundError(`Review item not found: ${id}`);

    updateReviewClassification(id, payload, 'operator');
  },

  /**
   * Update decision fields on a review queue item.
   * Only fields present in the payload are written; others are preserved.
   * Always stamps classified_by='operator' and classified_at=now.
   * Throws NotFoundError if the item does not exist.
   * Throws ValidationError if any value is not in the allowed set.
   */
  updateReviewDecision(id: string, payload: {
    decision_status?: string | null;
    decision_notes?:  string | null;
  }): void {
    const VALID_DECISION_STATUSES = new Set(Object.keys(DECISION_STATUS_LABELS));

    if (payload.decision_status != null && !VALID_DECISION_STATUSES.has(payload.decision_status)) {
      throw new ValidationError(`Invalid decision_status: ${payload.decision_status}`);
    }

    const row = netReview.getReviewItemById.get(id);
    if (!row) throw new NotFoundError(`Review item not found: ${id}`);

    updateReviewDecisionFields(id, payload, 'operator');
  },

  getTeamsPage(): NetTeamsPageViewModel {
    const rows = netTeams.listAll.all() as NetTeamSummaryRow[];
    return {
      seo:  { title: 'Net Teams' },
      page: {
        sectionKey: 'net',
        pageKey:    'net_teams',
        title:      'Net Doubles Teams',
        intro:      'Doubles partnerships from IFPA net competition results.',
      },
      content: {
        teams:      rows.map(shapeTeam),
        totalTeams: rows.length,
        disclaimer: TEAM_DISCLAIMER,
      },
    };
  },

  getPartnershipsPage(division?: string, search?: string): NetPartnershipsPageViewModel {
    const hasFilter = !!(division || search);
    const rows = hasFilter
      ? queryFilteredPartnerships({ division, search })
      : netPartnerships.listTopPartnerships.all() as NetPartnershipRow[];

    const partnerships: NetPartnershipViewModel[] = rows.map(r => ({
      teamId:          r.team_id,
      teamName:        teamName(r.person_name_a, r.person_name_b),
      teamHref:        `/net/partnerships/${r.team_id}`,
      personIdA:       r.person_id_a,
      personNameA:     r.person_name_a,
      hrefA:           netPlayerHref(r.person_id_a),
      personIdB:       r.person_id_b,
      personNameB:     r.person_name_b,
      hrefB:           netPlayerHref(r.person_id_b),
      appearanceCount: r.appearance_count,
      winCount:        r.win_count,
      podiumCount:     r.podium_count,
      yearSpan:        yearSpan(r.first_year, r.last_year),
    }));

    const divisionRows = netPartnerships.listDivisionOptions.all() as NetDivisionOptionRow[];
    const divisionOptions: DivisionFilterOption[] = [
      { value: '', label: 'All divisions', count: 0, selected: !division },
      ...divisionRows.map(r => ({
        value:    r.canonical_group,
        label:    GROUP_LABELS[r.canonical_group] || r.canonical_group,
        count:    r.appearance_count,
        selected: r.canonical_group === division,
      })),
    ];

    const divisionLabel = division ? (GROUP_LABELS[division] || division) : null;
    const titleSuffix = divisionLabel ? ` — ${divisionLabel}` : '';

    return {
      seo:  { title: `Net Partnerships${titleSuffix}` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_partnerships',
        title:      `Top Net Partnerships${titleSuffix}`,
        intro:      'The most significant doubles partnerships in footbag net history, ranked by competitive appearances.',
      },
      content: {
        partnerships,
        totalShown:      partnerships.length,
        divisionOptions,
        activeDivision:  division ?? null,
        activeSearch:    search ?? null,
        disclaimer:      TEAM_DISCLAIMER,
      },
    };
  },

  getRecoverySignalsPage(): NetRecoverySignalsPageViewModel {
    const stubCountRow = netRecoverySignals.countStubs.get() as { stub_count: number };
    const partnerRows  = netRecoverySignals.listUnresolvedPartnerRepeats.all() as RecoveryPartnerRepeatRow[];
    const abbrRows     = netRecoverySignals.listAbbreviationClusters.all() as RecoveryAbbreviationRow[];
    const highRows     = netRecoverySignals.listHighValueCandidates.all() as RecoveryHighValueRow[];

    return {
      seo:  { title: 'Net Recovery Signals' },
      page: {
        sectionKey: '',
        pageKey:    'net_recovery_signals',
        title:      'Net Recovery Signals',
      },
      content: {
        stubCount: stubCountRow.stub_count,
        unresolvedPartnerRepeats: partnerRows.map(r => ({
          knownPlayer: r.known_player,
          knownHref:   netPlayerHref(r.known_pid),
          stubPartner: r.stub_partner,
          stubPid:     r.stub_pid,
          coCount:     r.co_count,
          years:       r.years,
        })),
        abbreviationClusters: abbrRows.map(r => ({
          stubName:    r.stub_name,
          stubPid:     r.stub_pid,
          likelyMatch: r.likely_match,
          likelyHref:  netPlayerHref(r.likely_pid),
        })),
        highValueCandidates: highRows.map(r => ({
          personName:  r.person_name,
          personId:    r.person_id,
          appearances: r.appearances,
          eventCount:  r.event_count,
          years:       r.years,
        })),
      },
    };
  },

  getRecoveryCandidatesPage(): NetRecoveryCandidatesPageViewModel {
    const abbrevRows = netRecoveryCandidates.listAbbreviationCandidates.all() as RecoveryCandidateAbbrevRow[];
    const freqRows   = netRecoveryCandidates.listHighFrequencyStubs.all() as RecoveryCandidateFreqRow[];

    // Upsert abbreviation candidates into the approval table so decisions persist
    for (const r of abbrevRows) {
      const candidateId = `rc_${r.stub_pid.slice(0, 24)}`;
      netRecoveryApproval.upsertCandidate.run(
        candidateId, r.stub_name, r.stub_pid,
        r.match_pid, r.match_name,
        'abbreviation', 'high', r.stub_appearances,
      );
    }

    // Read back from approval table (includes operator decisions)
    const persistedRows = netRecoveryApproval.listAll.all() as RecoveryAliasCandidateRow[];
    const aliasCandidates: RecoveryCandidateVM[] = persistedRows.map(r => ({
      id:               r.id,
      stubName:         r.stub_name,
      stubPid:          r.stub_person_id,
      suggestedName:    r.suggested_person_name,
      suggestedPid:     r.suggested_person_id,
      suggestedHref:    netPlayerHref(r.suggested_person_id),
      suggestionType:   r.suggestion_type,
      confidence:       r.confidence,
      appearances:      r.appearance_count,
      operatorDecision: r.operator_decision,
      operatorNotes:    r.operator_notes,
    }));

    // High-frequency stubs → likely new persons (not alias candidates)
    const aliasStubPids = new Set(aliasCandidates.map(c => c.stubPid));
    const newPersonCandidates: RecoveryNewPersonVM[] = freqRows
      .filter(r => !aliasStubPids.has(r.person_id))
      .map(r => ({
        personName:  r.person_name,
        personId:    r.person_id,
        appearances: r.appearances,
        eventCount:  r.event_count,
        years:       r.years,
      }));

    const totalApproved = aliasCandidates.filter(c => c.operatorDecision === 'approve').length;

    return {
      seo:  { title: 'Net Recovery Candidates' },
      page: {
        sectionKey: '',
        pageKey:    'net_recovery_candidates',
        title:      'Recovery Candidates',
      },
      content: {
        aliasCandidates,
        newPersonCandidates,
        totalAlias:     aliasCandidates.length,
        totalApproved,
        totalNewPerson: newPersonCandidates.length,
      },
    };
  },

  /**
   * Update the operator decision on a recovery alias candidate.
   * Throws NotFoundError if the candidate does not exist.
   * Throws ValidationError if the decision value is invalid.
   */
  updateRecoveryDecision(candidateId: string, payload: {
    decision: string;
    notes?: string | null;
  }): void {
    const VALID = new Set(['approve', 'reject', 'defer']);
    if (!VALID.has(payload.decision)) {
      throw new ValidationError(`Invalid decision: ${payload.decision}`);
    }
    const row = netRecoveryApproval.getById.get(candidateId);
    if (!row) throw new NotFoundError(`Recovery candidate not found: ${candidateId}`);

    netRecoveryApproval.updateDecision.run(
      payload.decision,
      payload.notes?.trim() || null,
      'operator',
      candidateId,
    );
  },

  getTeamDetailPage(teamId: string): NetTeamDetailViewModel {
    const teamRow = netTeams.getById.get(teamId) as NetTeamSummaryRow | undefined;
    if (!teamRow) throw new NotFoundError(`Net team not found: ${teamId}`);

    const appearanceRows = netTeams.listAppearancesByTeamId.all(teamId) as NetTeamAppearanceRow[];
    const shaped = appearanceRows.map(shapeAppearance);

    return {
      seo:  { title: `${teamName(teamRow.person_name_a, teamRow.person_name_b)} — Net Team` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_team_detail',
        title:      teamName(teamRow.person_name_a, teamRow.person_name_b),
      },
      content: {
        team:       shapeTeam(teamRow),
        byYear:     groupAppearancesByYear(shaped),
        disclaimer: TEAM_DISCLAIMER,
      },
    };
  },

  getPartnershipDetailPage(teamId: string): NetPartnershipDetailPageViewModel {
    const teamRow = netTeams.getById.get(teamId) as NetTeamSummaryRow | undefined;
    if (!teamRow) throw new NotFoundError(`Partnership not found: ${teamId}`);

    const appearanceRows = netTeams.listAppearancesByTeamId.all(teamId) as NetTeamAppearanceRow[];
    const shaped = appearanceRows.map(shapeAppearance);

    // Sort ascending by year then placement for timeline view
    shaped.sort((a, b) => a.eventYear - b.eventYear || a.placement - b.placement);

    // Compute summary from appearances
    const winCount   = shaped.filter(a => a.placement === 1).length;
    const podiumCount = shaped.filter(a => a.placement <= 3).length;

    const title = teamName(teamRow.person_name_a, teamRow.person_name_b);

    return {
      seo:  { title: `${title} — Partnership` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_partnership_detail',
        title,
      },
      content: {
        team:    shapeTeam(teamRow),
        summary: {
          appearanceCount: shaped.length,
          winCount,
          podiumCount,
          yearSpan: yearSpan(teamRow.first_year, teamRow.last_year),
        },
        appearances: shaped,
        disclaimer:  TEAM_DISCLAIMER,
      },
    };
  },

  getPlayerPage(personId: string): NetPlayerPageViewModel {
    const playerRow = netPlayers.getPlayerSummary.get(personId) as NetPlayerSummaryRow | undefined;
    if (!playerRow) throw new NotFoundError(`Net player not found: ${personId}`);

    const partnerRows  = netPlayers.listPartnersByPersonId.all(personId) as NetPartnerRow[];
    const networkRows  = netPlayers.listPartnerNetworkByPersonId.all(personId) as NetPartnerNetworkRow[];

    const topPartners: NetPartnerNetworkViewModel[] = networkRows.map(r => ({
      partnerPersonId: r.partner_person_id,
      partnerName:     r.partner_name,
      partnerCountry:  r.partner_country,
      partnerHref:     netPlayerHref(r.partner_person_id) ?? `/net/players/${r.partner_person_id}`,
      appearanceCount: r.appearance_count,
      winCount:        r.win_count,
      podiumCount:     r.podium_count,
      yearSpan:        yearSpan(r.first_year, r.last_year),
    }));

    // Compute career highlights from network data
    const careerHighlights = buildCareerHighlights(networkRows);

    return {
      seo:  { title: `${playerRow.person_name} — Net` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_player',
        title:      playerRow.person_name,
      },
      content: {
        player:           shapePlayer(playerRow),
        partners:         partnerRows.map(r => shapePartner(personId, r)),
        topPartners,
        careerHighlights,
        totalPartners:    partnerRows.length,
        disclaimer:       TEAM_DISCLAIMER,
      },
    };
  },

  getEventsPage(): NetEventsPageViewModel {
    const rows = netEvents.listEvents.all() as NetEventSummaryRow[];
    return {
      seo:  { title: 'Net Events' },
      page: {
        sectionKey: 'net',
        pageKey:    'net_events',
        title:      'Net Events',
        intro:      'Doubles net competition results by event.',
      },
      content: {
        events:      rows.map(shapeEventSummary),
        totalEvents: rows.length,
        disclaimer:  TEAM_DISCLAIMER,
      },
    };
  },

  getEventDetailPage(eventId: string): NetEventDetailViewModel {
    const eventRow = netEvents.getEventSummary.get(eventId) as NetEventSummaryRow | undefined;
    if (!eventRow) throw new NotFoundError(`Net event not found: ${eventId}`);

    const appearanceRows = netEvents.listAppearancesByEventId.all(eventId) as NetEventAppearanceRow[];

    return {
      seo:  { title: `${eventRow.event_title} — Net` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_event_detail',
        title:      eventRow.event_title,
      },
      content: {
        event:        shapeEventSummary(eventRow),
        byDiscipline: groupAppearancesByDiscipline(appearanceRows),
        disclaimer:   TEAM_DISCLAIMER,
      },
    };
  },

  getPlayerPartnerDetail(personId: string, teamId: string): NetPlayerPartnerDetailViewModel {
    const playerRow = netPlayers.getPlayerSummary.get(personId) as NetPlayerSummaryRow | undefined;
    if (!playerRow) throw new NotFoundError(`Net player not found: ${personId}`);

    const teamRow = netTeams.getById.get(teamId) as NetTeamSummaryRow | undefined;
    if (!teamRow) throw new NotFoundError(`Net team not found: ${teamId}`);

    // Validate person is a member of this team
    if (teamRow.person_id_a !== personId && teamRow.person_id_b !== personId) {
      throw new NotFoundError(`Player ${personId} is not a member of team ${teamId}`);
    }

    const appearanceRows = netTeams.listAppearancesByTeamId.all(teamId) as NetTeamAppearanceRow[];
    const shaped = appearanceRows.map(shapeAppearance);

    const isPersonA    = teamRow.person_id_a === personId;
    const partnerId    = isPersonA ? teamRow.person_id_b    : teamRow.person_id_a;
    const partnerName  = isPersonA ? teamRow.person_name_b  : teamRow.person_name_a;
    const partnerCountry = isPersonA ? teamRow.country_b    : teamRow.country_a;

    const placements   = shaped.map(a => a.placement);
    const best         = placements.length > 0 ? Math.min(...placements) : null;

    return {
      seo:  { title: `${playerRow.person_name} / ${partnerName} — Net` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_player_partner',
        title:      `${playerRow.person_name} / ${partnerName}`,
      },
      content: {
        player:    shapePlayer(playerRow),
        partner: {
          personId:   partnerId,
          personName: partnerName,
          country:    partnerCountry,
          href:       netPlayerHref(partnerId),
        },
        teamId,
        teamDetailHref:     `/net/teams/${teamId}`,
        appearanceCount:    teamRow.appearance_count,
        bestPlacement:      best,
        bestPlacementLabel: best !== null ? placementLabel(best) : null,
        yearSpan:           yearSpan(teamRow.first_year, teamRow.last_year),
        byYear:             groupAppearancesByYear(shaped),
        disclaimer:         TEAM_DISCLAIMER,
      },
    };
  },

  getNetCandidatesPage(
    filters: NetCandidateFilters & { group_by?: string },
  ): NetCandidatesPageViewModel {
    const summaryRows     = netCandidates.listSummary.all()         as NetCandidateSummaryRow[];
    const totalRow        = netCandidates.getTotalCount.get()        as { cnt: number };
    const fragRow         = netCandidates.getTotalFragmentCount.get() as { cnt: number };
    const sourceRows      = netCandidates.listSummaryBySource.all()  as NetCandidateSourceSummaryRow[];
    const eventRows       = netCandidates.listSummaryByEvent.all()   as NetCandidateEventSummaryRow[];
    const yearRows        = netCandidates.listSummaryByYear.all()    as NetCandidateYearSummaryRow[];

    const items           = queryCandidateItems(filters).map(shapeCandidate);
    const summary         = buildCandidatesSummary(summaryRows, totalRow.cnt);
    const metrics         = buildMetrics(fragRow.cnt, totalRow.cnt, sourceRows);

    const groups = filters.group_by
      ? groupCandidates(items, filters.group_by)
      : null;

    return {
      seo:  { title: 'Net Candidates' },
      page: {
        sectionKey: '',
        pageKey:    'net_candidates',
        title:      'Net Match Candidates',
      },
      content: {
        metrics,
        summaryBySource: sourceRows.map(shapeSourceSummary),
        summaryByEvent:  eventRows.map(shapeCandEventSummary),
        summaryByYear:   yearRows.map(shapeYearSummary),
        summary,
        items:           groups ? [] : items,   // flat items only when no grouping
        groups,
        totalFiltered:   items.length,
        filterOptions:   buildCandidatesFilterOptions(filters),
        activeFilters: {
          reviewStatus:  filters.review_status  ?? null,
          eventId:       filters.event_id       ?? null,
          sourceFile:    filters.source_file    ?? null,
          linkedOnly:    filters.linked_only    ?? false,
          minConfidence: filters.min_confidence ?? null,
          groupBy:       filters.group_by       ?? null,
        },
      },
    };
  },

  getCandidateDetailPage(candidateId: string): NetCandidateDetailPageViewModel {
    const row = netCurated.getCandidateById.get(candidateId) as NetCuratedDetailRow | undefined;
    if (!row) throw new NotFoundError(`Candidate not found: ${candidateId}`);

    const curatedRow = netCurated.getCuratedByCandidate.get(candidateId) as NetCuratedMatchRow | undefined;

    const candidate: NetCandidateDetailViewModel = {
      candidateId:     row.candidate_id,
      rawText:         row.raw_text,
      playerARawName:  row.player_a_raw_name,
      playerBRawName:  row.player_b_raw_name,
      playerAPersonId: row.player_a_person_id,
      playerBPersonId: row.player_b_person_id,
      playerAName:     row.person_name_a,
      playerBName:     row.person_name_b,
      extractedScore:  row.extracted_score,
      roundHint:       row.round_hint,
      confidenceScore: row.confidence_score,
      confidenceLabel: confidenceLabel(row.confidence_score),
      confidenceClass: confidenceClass(row.confidence_score),
      eventId:         row.event_id,
      eventTitle:      row.event_title,
      eventHref:       row.event_id ? `/net/events/${row.event_id}` : null,
      disciplineId:    row.discipline_id,
      disciplineName:  row.discipline_name,
      sourceFile:      row.source_file,
      yearHint:        row.year_hint,
      reviewStatus:    row.review_status,
      importedAt:      row.imported_at,
      isFullyLinked:   row.player_a_person_id !== null && row.player_b_person_id !== null,
    };

    const existing: NetCuratedViewModel | null = curatedRow
      ? {
          curatedId:     curatedRow.curated_id,
          curatedStatus: curatedRow.curated_status,
          curatorNote:   curatedRow.curator_note,
          curatedAt:     curatedRow.curated_at,
          curatedBy:     curatedRow.curated_by,
        }
      : null;

    return {
      seo:  { title: `Candidate ${candidateId}` },
      page: { sectionKey: '', pageKey: 'net_candidate_detail', title: 'Candidate Detail' },
      content: {
        candidate,
        existing,
        isAlreadyCurated: existing !== null,
        backHref: '/internal/net/candidates',
      },
    };
  },

  approveCandidate(candidateId: string, payload: { note?: string }): void {
    const row = netCurated.getCandidateById.get(candidateId) as NetCuratedDetailRow | undefined;
    if (!row) throw new NotFoundError(`Candidate not found: ${candidateId}`);

    const existing = netCurated.getCuratedByCandidate.get(candidateId) as NetCuratedMatchRow | undefined;
    if (existing) throw new ConflictError(`Candidate ${candidateId} has already been curated`);

    const curatedId = `curated_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    transaction(() => {
      netCurated.insertCuratedMatch.run(
        curatedId,
        candidateId,
        'approved',
        row.event_id,
        row.discipline_id,
        row.player_a_person_id,
        row.player_b_person_id,
        row.extracted_score,
        row.raw_text,
        payload.note ?? null,
        'operator',
      );
      netCurated.updateCandidateStatus.run('accepted', candidateId);
    });
  },

  rejectCandidate(candidateId: string, payload: { note?: string }): void {
    const row = netCurated.getCandidateById.get(candidateId) as NetCuratedDetailRow | undefined;
    if (!row) throw new NotFoundError(`Candidate not found: ${candidateId}`);

    const existing = netCurated.getCuratedByCandidate.get(candidateId) as NetCuratedMatchRow | undefined;
    if (existing) throw new ConflictError(`Candidate ${candidateId} has already been curated`);

    const curatedId = `curated_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

    transaction(() => {
      netCurated.insertCuratedMatch.run(
        curatedId,
        candidateId,
        'rejected',
        row.event_id,
        row.discipline_id,
        row.player_a_person_id,
        row.player_b_person_id,
        row.extracted_score,
        row.raw_text,
        payload.note ?? null,
        'operator',
      );
      netCurated.updateCandidateStatus.run('rejected', candidateId);
    });
  },

  getNetCuratedPage(filters: NetCuratedBrowseFilters): NetCuratedBrowsePageViewModel {
    const totalRow   = netCuratedBrowse.getTotalCount.get()    as { cnt: number };
    const linkedRow  = netCuratedBrowse.getLinkedCount.get()   as { cnt: number };
    const statusRows = netCuratedBrowse.listStatusSummary.all() as NetCuratedStatusSummaryRow[];
    const sourceRows = netCuratedBrowse.listBySource.all()     as NetCuratedSourceSummaryRow[];
    const eventRows  = netCuratedBrowse.listByEvent.all()      as NetCuratedEventSummaryRow[];
    const yearRows   = netCuratedBrowse.listByYear.all()       as NetCuratedYearSummaryRow[];
    const items      = queryCuratedItems(filters).map(shapeCuratedBrowseItem);

    const totalCurated  = totalRow.cnt;
    const linkedCount   = linkedRow.cnt;
    const approvedCount = statusRows.find(r => r.curated_status === 'approved')?.item_count ?? 0;
    const rejectedCount = statusRows.find(r => r.curated_status === 'rejected')?.item_count ?? 0;

    const metrics: NetCuratedMetricsViewModel = {
      totalCurated,
      approvedCount,
      rejectedCount,
      linkedCount,
      approvedPct: fmtPct(approvedCount, totalCurated),
      rejectedPct: fmtPct(rejectedCount, totalCurated),
      linkedPct:   fmtPct(linkedCount,   totalCurated),
    };

    const summaryBySource: NetCuratedSourceSummaryViewModel[] = sourceRows.map(r => ({
      sourceFile:    r.source_file ?? '(no source)',
      curatedCount:  r.curated_count,
      approvedCount: r.approved_count,
      rejectedCount: r.rejected_count,
      filterHref:    `/internal/net/curated?source=${encodeURIComponent(r.source_file ?? '')}`,
    }));

    const summaryByEvent: NetCuratedEventSummaryViewModel[] = eventRows.map(r => ({
      eventId:       r.event_id,
      eventTitle:    r.event_title,
      curatedCount:  r.curated_count,
      approvedCount: r.approved_count,
      rejectedCount: r.rejected_count,
      filterHref:    `/internal/net/curated?event=${encodeURIComponent(r.event_id)}`,
    }));

    const summaryByYear: NetCuratedYearSummaryViewModel[] = yearRows.map(r => ({
      yearHint:      r.year_hint,
      curatedCount:  r.curated_count,
      approvedCount: r.approved_count,
      rejectedCount: r.rejected_count,
      filterHref:    `/internal/net/curated?year=${r.year_hint}`,
    }));

    const filterOptions: NetCuratedBrowseFilterOptions = {
      statuses: [
        { value: '',         label: 'All statuses',  selected: !filters.curated_status },
        { value: 'approved', label: 'Approved',      selected: filters.curated_status === 'approved' },
        { value: 'rejected', label: 'Rejected',      selected: filters.curated_status === 'rejected' },
      ],
      linkedFilter: [
        { value: '',     label: 'All',          selected: !filters.linked_only },
        { value: 'true', label: 'Linked only',  selected: !!filters.linked_only },
      ],
    };

    return {
      seo:  { title: 'Net Curated Matches' },
      page: { sectionKey: '', pageKey: 'net_curated', title: 'Net Curated Matches' },
      content: {
        metrics,
        summaryBySource,
        summaryByEvent,
        summaryByYear,
        items,
        totalFiltered: items.length,
        filterOptions,
        activeFilters: {
          curatedStatus: filters.curated_status ?? null,
          sourceFile:    filters.source_file    ?? null,
          eventId:       filters.event_id       ?? null,
          yearHint:      filters.year_hint      ?? null,
          linkedOnly:    filters.linked_only    ?? false,
        },
      },
    };
  },
};
