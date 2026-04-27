import {
  netTeams,      NetTeamSummaryRow, NetTeamAppearanceRow,
                 NetTeamStatsRow, NetDivisionOptionRow,
  queryFilteredTeams,
  netEvents,     NetEventSummaryRow,
  netHome,       NetHomeRecentEventRow,
                 NetNotablePlayerRow,
} from '../db/db';
import { NotFoundError } from './serviceErrors';
import { personHref } from './personLink';
import { shapePartnershipPair } from './playerShaping';
import { PageViewModel } from '../types/page';

// ---------------------------------------------------------------------------
// Evidence disclaimer, always rendered on net pages (not conditioned on data)
// ---------------------------------------------------------------------------
export const TEAM_DISCLAIMER =
  'Team identities are algorithmically constructed from placement data and may not reflect official partnerships.';

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export interface NetHomeRecentEventViewModel {
  eventId:             string;
  eventTitle:          string;
  eventHref:           string;
  eventYear:           number;
  appearanceCount:     number;
  hasMultiStageHint:   boolean;
}

interface NotableBucketViewModel {
  title: string;
  teams: NetTeamListViewModel[];
}

interface NotablePlayerItemViewModel {
  personId:         string;
  personName:       string;
  country:          string | null;
  href:             string | null;
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

interface NetLandingExplainer {
  heading:    string;
  paragraphs: string[];
}

interface NetCompetitionFormat {
  slug:           'singles' | 'doubles';
  title:          string;
  paragraph:      string;
  videoEmbedUrl:  string;
  videoTitle:     string;
}

interface NetDemoVideo {
  webmUrl:   string;
  mp4Url:    string;
  posterUrl: string;
  caption:   string;
}

interface NetExploreCard {
  slug:       'teams' | 'events';
  label:      string;
  href:       string;
  paragraph:  string;
  linkLabel:  string;
  comingSoon: boolean;
}

interface NetHomeContent {
  mascotSrc:             string;
  mascotAlt:             string;
  intro:                 NetLandingExplainer;
  demoVideo:             NetDemoVideo;
  competitionFormats:    NetCompetitionFormat[];
  exploreCards:          NetExploreCard[];
  recentEvents:          NetHomeRecentEventViewModel[];
  notableTeams:          NotableBucketViewModel[];
  notablePlayers:        NotablePlayerBucketViewModel[];
}

// ---------------------------------------------------------------------------
// Landing-page static content (adapted from FootbagWorldwide /games/net,
// IFPA 2025). Held in-file so the landing stays thin and no DB call is needed.
// ---------------------------------------------------------------------------
const NET_LANDING_INTRO: NetLandingExplainer = {
  heading: 'What is Footbag Net?',
  paragraphs: [
    'Footbag Net is an acrobatic sport played on a badminton court. Players volley the footbag back and forth using only their feet or lower leg. Similar to Sepak Takraw, footbag net blends the court strategy of beach volleyball with the jumping and kicking skills of martial arts. Players demonstrate remarkable agility by flying through the air to spike the footbag over the net, or to block that spike on defense.',
  ],
};

const NET_COMPETITION_FORMATS: NetCompetitionFormat[] = [
  {
    slug:          'singles',
    title:         'Singles',
    paragraph:     'In singles, each player has one or two kicks to return the footbag over the net. Skilled players can often use the first kick to set up a spike with the second kick.',
    videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/Rep-1rQbX-o',
    videoTitle:    'IFPA World Footbag Championships 2019 — Open Singles Net Finals',
  },
  {
    slug:          'doubles',
    title:         'Doubles',
    paragraph:     'In doubles, teams have three kicks total to return the footbag, and teammates must alternate kicks. Doubles opens the door to set-and-spike plays, crossing blocks, and dramatic rallies.',
    videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/lcDP3JGvkP0',
    videoTitle:    'IFPA World Footbag Championships 2019 — Mixed Doubles Net Final',
  },
];

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

interface NetTeamStatsViewModel {
  appearanceCount: number;
  winCount:        number;
  podiumCount:     number;
  yearSpan:        string | null;
}

interface NetTeamDetailContent {
  team:         NetTeamViewModel;
  summary:      NetTeamStatsViewModel;
  appearances:  NetAppearanceViewModel[];   // timeline asc
  byYear:       NetAppearanceYearGroup[];   // grouped desc
  disclaimer:   string;
}

export interface NetTeamListViewModel {
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

interface NetTeamsContent {
  teams:           NetTeamListViewModel[];
  totalShown:      number;
  divisionOptions: DivisionFilterOption[];
  activeDivision:  string | null;
  activeSearch:    string | null;
  disclaimer:      string;
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

interface NetEventsContent {
  events:      NetEventViewModel[];
  totalEvents: number;
  disclaimer:  string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Canonical public event URL is /events/{eventKey} where eventKey is
// tag_normalized with any leading '#' stripped. The stored events.id (e.g.
// "1980_worlds") does not match the public route pattern and must not be
// used as a URL fragment. Match the pattern used in playerShaping.ts.
function publicEventHref(tagNormalized: string): string {
  const key = tagNormalized.startsWith('#')
    ? tagNormalized.slice(1)
    : tagNormalized;
  return `/events/${key}`;
}

export function teamName(nameA: string, nameB: string): string {
  return `${nameA} / ${nameB}`;
}

function yearSpan(first: number | null, last: number | null): string | null {
  if (first === null) return null;
  if (last === null || first === last) return String(first);
  return `${first}–${last}`;
}

export function placementLabel(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// Canonical group labels for display, used only when conflict_flag=0
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

export function disciplineLabel(disciplineName: string, canonicalGroup: string | null, conflictFlag: number): string {
  // If conflict_flag=1 or no canonical_group, use the raw discipline name
  if (conflictFlag || !canonicalGroup) return disciplineName;
  return GROUP_LABELS[canonicalGroup] || disciplineName;
}

function shapeTeam(row: NetTeamSummaryRow): NetTeamViewModel {
  return {
    teamId:          row.team_id,
    teamName:        teamName(row.person_name_a, row.person_name_b),
    ...shapePartnershipPair(row),
    countryA:        row.country_a,
    countryB:        row.country_b,
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
    eventHref:       publicEventHref(row.event_tag_normalized),
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

function shapeHomeRecentEvent(row: NetHomeRecentEventRow): NetHomeRecentEventViewModel {
  return {
    eventId:           row.event_id,
    eventTitle:        row.event_title,
    eventHref:         publicEventHref(row.event_tag_normalized),
    eventYear:         row.event_year,
    appearanceCount:   row.appearance_count,
    hasMultiStageHint: row.has_multi_stage_hint === 1,
  };
}

export function shapeEventSummary(row: NetEventSummaryRow): NetEventViewModel {
  return {
    eventId:         row.event_id,
    eventTitle:      row.event_title,
    eventHref:       publicEventHref(row.event_tag_normalized),
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

// ---------------------------------------------------------------------------

export const netService = {
  getNetHomePage(): PageViewModel<NetHomeContent> {
    const recentEventRows = netHome.getRecentEvents.all()      as NetHomeRecentEventRow[];
    const notablePool     = netTeams.listNotablePool.all()     as NetTeamStatsRow[];

    // Build notable buckets from the shared pool (different sort orders, top 5 each)
    const BUCKET_SIZE = 5;

    function shapePoolRow(r: NetTeamStatsRow): NetTeamListViewModel {
      return {
        teamId:          r.team_id,
        teamName:        teamName(r.person_name_a, r.person_name_b),
        teamHref:        `/net/teams/${r.team_id}`,
        ...shapePartnershipPair(r),
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
    const notableTeams: NotableBucketViewModel[] = [];

    const winsB = byWins.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (winsB.length) notableTeams.push({ title: 'Most Wins', teams: winsB });

    const podiumsB = byPodiums.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (podiumsB.length) notableTeams.push({ title: 'Most Podium Finishes', teams: podiumsB });

    const spanB = bySpan.slice(0, BUCKET_SIZE).map(shapePoolRow);
    if (spanB.length) notableTeams.push({ title: 'Longest Spans', teams: spanB });

    // Notable players, buckets from player aggregate pool
    const playerPool = netHome.listNotablePlayerPool.all() as NetNotablePlayerRow[];

    function shapeNotablePlayer(r: NetNotablePlayerRow): NotablePlayerItemViewModel {
      return {
        personId:         r.person_id,
        personName:       r.person_name,
        country:          r.country,
        href:             personHref(r.member_slug, r.person_id),
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

    // Grey-out rule: an explore card is "coming soon" when its underlying
    // data is thin enough that the linked sub-page would be an empty stub.
    const hasTeams  = notablePool.length > 0;
    const hasEvents = recentEventRows.length > 0;

    const exploreCards: NetExploreCard[] = [
      { slug: 'teams',  label: 'Teams',  href: '/net/teams',  paragraph: 'Doubles teams with full competition records: wins, podiums, and active span. Filter by division or search by player.', linkLabel: 'Browse teams',   comingSoon: !hasTeams },
      { slug: 'events', label: 'Events', href: '/net/events', paragraph: 'Archive of net doubles competitions with per-event appearance counts.',                                                linkLabel: 'Event archive',  comingSoon: !hasEvents },
    ];

    return {
      seo:  { title: 'Footbag Net' },
      page: {
        sectionKey: 'net',
        pageKey:    'net_home',
        title:      'Footbag Net',
        intro:      'Fast-paced foot volleyball over a 5-foot net.',
      },
      content: {
        mascotSrc:           '/img/net-mascot.svg',
        mascotAlt:           'Footbag net icon',
        intro:               NET_LANDING_INTRO,
        demoVideo:           {
          webmUrl:   '/media/demo-net.webm',
          mp4Url:    '/media/demo-net.mp4',
          posterUrl: '/media/demo-net-poster.jpg',
          caption:   'Demonstration of footbag net',
        },
        competitionFormats:  NET_COMPETITION_FORMATS,
        exploreCards,
        recentEvents:        recentEventRows.map(shapeHomeRecentEvent),
        notableTeams,
        notablePlayers,
      },
    };
  },

  getTeamsPage(division?: string, search?: string): PageViewModel<NetTeamsContent> {
    const hasFilter = !!(division || search);
    const rows = hasFilter
      ? queryFilteredTeams({ division, search })
      : netTeams.listAll.all() as NetTeamStatsRow[];

    const teams: NetTeamListViewModel[] = rows.map(r => ({
      teamId:          r.team_id,
      teamName:        teamName(r.person_name_a, r.person_name_b),
      teamHref:        `/net/teams/${r.team_id}`,
      ...shapePartnershipPair(r),
      appearanceCount: r.appearance_count,
      winCount:        r.win_count,
      podiumCount:     r.podium_count,
      yearSpan:        yearSpan(r.first_year, r.last_year),
    }));

    const divisionRows = netTeams.listDivisionOptions.all() as NetDivisionOptionRow[];
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
      seo:  { title: `Net Teams${titleSuffix}` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_teams',
        title:      `Net Teams${titleSuffix}`,
        intro:      'All doubles teams in footbag net history, sorted by competitive appearances. Filter by division or search by player name.',
      },
      content: {
        teams,
        totalShown:      teams.length,
        divisionOptions,
        activeDivision:  division ?? null,
        activeSearch:    search ?? null,
        disclaimer:      TEAM_DISCLAIMER,
      },
    };
  },

  getTeamDetailPage(teamId: string): PageViewModel<NetTeamDetailContent> {
    const teamRow = netTeams.getById.get(teamId) as NetTeamSummaryRow | undefined;
    if (!teamRow) throw new NotFoundError(`Team not found: ${teamId}`);

    const appearanceRows = netTeams.listAppearancesByTeamId.all(teamId) as NetTeamAppearanceRow[];
    const shaped = appearanceRows.map(shapeAppearance);

    // Timeline view: ascending by year, then placement
    const timeline = [...shaped].sort((a, b) => a.eventYear - b.eventYear || a.placement - b.placement);

    // By-year view: descending groups
    const byYear = groupAppearancesByYear(shaped);

    // Compute summary from appearances
    const winCount    = shaped.filter(a => a.placement === 1).length;
    const podiumCount = shaped.filter(a => a.placement <= 3).length;

    const title = teamName(teamRow.person_name_a, teamRow.person_name_b);

    return {
      seo:  { title: `${title} — Team` },
      page: {
        sectionKey: 'net',
        pageKey:    'net_team_detail',
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
        appearances: timeline,
        byYear,
        disclaimer:  TEAM_DISCLAIMER,
      },
    };
  },

  getEventsPage(): PageViewModel<NetEventsContent> {
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

};
