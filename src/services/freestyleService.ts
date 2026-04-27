import {
  FreestyleLeaderRow, FreestyleRecordRow, FreestyleTrickRow, FreestyleTrickModifierRow,
  FreestyleCompetitorRow, FreestyleEraRow, FreestyleRecentEventRow,
  FreestylePartnershipRow,
  freestyleRecords, freestyleTricks, freestyleTrickModifiers, freestyleCompetition,
  freestylePartnerships,
} from '../db/db';
import { runSqliteRead } from './sqliteRetry';
import { NotFoundError } from './serviceErrors';
import { PageViewModel } from '../types/page';
import { personHref } from './personLink';
import { shapePartnershipPair } from './playerShaping';
import {
  FreestyleRecordViewModel,
  shapeFreestyleRecord,
  trickNameToSlug,
} from './freestyleRecordShaping';
import {
  InsightsTrick,
  InsightsTransition,
  InsightsSequence,
  InsightsDiversePlayer,
  InsightsDifficultyEra,
  FreestyleHistoryPioneer,
  FreestyleHistoryEra,
  INSIGHTS_MOST_USED,
  INSIGHTS_CONNECTORS,
  INSIGHTS_TRANSITIONS,
  INSIGHTS_SEQUENCES,
  INSIGHTS_DIVERSE_PLAYERS,
  INSIGHTS_DIFFICULTY_ERAS,
  INSIGHTS_NARRATIVES,
  HISTORY_PIONEERS,
  HISTORY_ERAS,
  HISTORY_ADD_SYSTEM,
} from '../content/freestyleEditorial';

// ---------------------------------------------------------------------------
// Record type labels
// ---------------------------------------------------------------------------
const RECORD_TYPE_LABELS: Record<string, string> = {
  trick_consecutive:        'Consecutive Completions',
  trick_consecutive_dex:   'Consecutive Completions (Dex)',
  trick_consecutive_juggle: 'Consecutive Juggle',
};

function labelForType(recordType: string): string {
  return RECORD_TYPE_LABELS[recordType] ?? recordType;
}

// ---------------------------------------------------------------------------
// Shaped types for templates
// ---------------------------------------------------------------------------

export interface FreestyleRecordGroup {
  recordType: string;
  label: string;
  records: FreestyleRecordViewModel[];
}

export interface FreestyleRecordsContent {
  groups: FreestyleRecordGroup[];
  totalRecords: number;
  totalHolders: number;
}

export interface FreestyleLeaderViewModel {
  rank: number;
  holderName: string;
  holderHref: string | null;
  recordCount: number;
  topValue: number;
  topTrick: string | null;
}

export interface FreestyleLeadersContent {
  leaders: FreestyleLeaderViewModel[];
  totalHolders: number;
  totalRecords: number;
}

export interface FreestyleLandingExplainer {
  heading: string;
  paragraphs: string[];
}

export interface FreestyleGetStartedTile {
  label: string;
  href: string;
  comingSoon: boolean;
}

export interface FreestyleCompetitionFormat {
  slug: string;
  title: string;
  paragraph: string;
  videoEmbedUrl: string;
  videoTitle: string;
}

export interface FreestyleDemoVideo {
  webmUrl: string;
  mp4Url: string;
  posterUrl: string;
  caption: string;
}

export interface FreestyleLandingContent {
  mascotSrc: string;
  mascotAlt: string;
  intro: FreestyleLandingExplainer;
  demoVideo: FreestyleDemoVideo;
  getStartedTiles: FreestyleGetStartedTile[];
  competitionFormats: FreestyleCompetitionFormat[];
  totalRecords: number;
  recordTypes: number;
  topHolders: FreestyleLeaderViewModel[];
  recentRecords: FreestyleRecordViewModel[];
  totalTricks: number;    // count of tricks in dictionary
  totalEvents: number;    // count of freestyle events from canonical results
}

export interface FreestyleTrickContent {
  trickName: string;
  sortName: string | null;
  slug: string;
  records: FreestyleRecordViewModel[];      // current holders only (superseded_by IS NULL)
  recordCount: number;
  topValue: number;
  progression: FreestyleRecordViewModel[];  // all records including superseded, newest first
  hasProgression: boolean;                  // true when any records are superseded
  // Dictionary info, null when trick has no dictionary entry
  dictEntry: FreestyleTrickDictEntry | null;
  // Family members: siblings or derivatives, sorted by ADD value
  familyMembers: FreestyleFamilyMember[];   // empty when family has only one member
  hasFamilyMembers: boolean;
}

export interface FreestyleTrickDictEntry {
  canonicalName: string;
  adds: string | null;          // numeric string or 'modifier'
  addsNumeric: number | null;   // parsed integer or null
  category: string | null;
  description: string | null;
  aliases: string[];
  baseTrick: string | null;
  baseTrickSlug: string | null; // slug for linking to base trick page
  baseTrickAdds: string | null; // ADD value of the base trick, for composition display
  trickFamily: string | null;   // family grouping slug
  isBase: boolean;              // true when this trick IS the family base (trick_family == own slug)
  isModifier: boolean;
  isCompound: boolean;          // true for category=compound or category=dex with a different base
  // ADD composition: null for base tricks and modifiers
  addComposition: string | null;  // e.g. "whirl (3) + blurry (+2 on rotational) = 5"
  appliedModifiers: AppliedModifier[];
  // Family editorial note for major families
  familyNote: string | null;
}

export interface AppliedModifier {
  name: string;
  addBonus: number;
  addBonusRotational: number;
  isRotationalBase: boolean;
  effectiveBonus: number;       // the actual bonus applied given whether base is rotational
}

export interface FreestyleFamilyMember {
  slug: string;
  canonicalName: string;
  adds: string | null;
  isCurrentTrick: boolean;   // true for the trick being viewed
  detailHref: string;        // always /freestyle/tricks/:slug (dict entry exists)
  hasRecords: boolean;       // true when passback records exist for this trick
}

export interface FreestyleModifierEntry {
  slug: string;
  name: string;
  addBonus: number;
  addBonusRotational: number;
  modifierType: string;     // 'body' | 'set'
  notes: string | null;
}

export interface FreestyleTrickIndexRow {
  slug: string;
  canonicalName: string;
  adds: string | null;
  category: string | null;
  description: string | null;
  aliases: string[];
  detailHref: string;           // always /freestyle/tricks/:slug for all dict entries
  hasRecords: boolean;          // true when passback records exist (shows record indicator)
  recordHref: string | null;    // kept for backwards compatibility — same as detailHref when hasRecords
}

export interface FreestyleTrickGroup {
  category: string;
  label: string;
  tricks: FreestyleTrickIndexRow[];
}

export interface FreestyleTricksIndexContent {
  groups: FreestyleTrickGroup[];
  familyGroups: FreestyleFamilyGroup[];  // compound tricks grouped by family (for family-browsing section)
  modifiers: FreestyleModifierEntry[];   // body/set modifier reference table
  totalTricks: number;
}

export interface FreestyleFamilyGroup {
  familySlug: string;
  familyName: string;         // capitalized family name (e.g. "Whirl")
  members: FreestyleTrickIndexRow[];
}

// ---------------------------------------------------------------------------
// Freestyle Insights types (service-layer constants, not DB-backed)
// ---------------------------------------------------------------------------

export interface FreestyleInsightsContent {
  mostUsed: InsightsTrick[];
  connectors: InsightsTrick[];
  transitions: InsightsTransition[];
  hardestSequences: InsightsSequence[];
  diversePlayers: InsightsDiversePlayer[];
  difficultyEras: InsightsDifficultyEra[];
  narratives: string[];
}

// ---------------------------------------------------------------------------
// Competition content types (canonical-results-derived)
// ---------------------------------------------------------------------------

export interface FreestyleCompetitorViewModel {
  personId: string;
  name: string;
  country: string | null;
  golds: number;
  silvers: number;
  bronzes: number;
  totalPodiums: number;
  profileHref: string | null;    // /members/{slug} if claimed, else /history/:personId
}

export interface FreestyleEraViewModel {
  era: string;
  events: number;
}

export interface FreestyleRecentEventViewModel {
  eventId:    string;
  title:      string;
  startDate:  string;
  city:       string;
  country:    string;
  href:       string;       // /events/:tag_normalized (platform event link)
}

export interface FreestyleCompetitionContent {
  topCompetitors:  FreestyleCompetitorViewModel[];
  eventsByEra:     FreestyleEraViewModel[];
  recentEvents:    FreestyleRecentEventViewModel[];
  totalEvents:     number;
  dataNote:        string;
}

// ---------------------------------------------------------------------------
// Partnerships content types
// ---------------------------------------------------------------------------

export interface FreestylePartnershipViewModel {
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

export interface FreestylePartnershipBucket {
  title:        string;
  partnerships: FreestylePartnershipViewModel[];
}

export interface FreestylePartnershipsContent {
  buckets:      FreestylePartnershipBucket[];
  allRanked:    FreestylePartnershipViewModel[];
  totalShown:   number;
  dataNote:     string;
}

// ---------------------------------------------------------------------------
// History content types (editorial service-layer constants)
// ---------------------------------------------------------------------------

export interface FreestyleHistoryContent {
  eras: FreestyleHistoryEra[];
  pioneers: FreestyleHistoryPioneer[];
  addSystem: string[];
  regionalShift: string;
  modernEra: string;
}

// ---------------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------------

function groupByType(rows: FreestyleRecordRow[]): FreestyleRecordGroup[] {
  const groupMap = new Map<string, FreestyleRecordRow[]>();
  for (const row of rows) {
    const bucket = groupMap.get(row.record_type) ?? [];
    bucket.push(row);
    groupMap.set(row.record_type, bucket);
  }
  return Array.from(groupMap.entries()).map(([recordType, typeRows]) => ({
    recordType,
    label:   labelForType(recordType),
    records: typeRows.map(shapeFreestyleRecord),
  }));
}

function shapeLeaders(rows: FreestyleLeaderRow[]): FreestyleLeaderViewModel[] {
  return rows.map((row, i) => ({
    rank:        i + 1,
    holderName:  row.holder_name,
    holderHref:  personHref(row.holder_member_slug, row.person_id),
    recordCount: row.record_count,
    topValue:    row.top_value,
    topTrick:    row.top_trick,
  }));
}

// ---------------------------------------------------------------------------
// Trick dictionary helpers
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  dex:      'Dexterity',
  body:     'Body',
  set:      'Set',
  compound: 'Compound',
  modifier: 'Modifier',
};

// Editorial notes for major trick families.
// These are service-layer constants, not DB-backed, and describe structural
// significance at the family level rather than individual tricks.
const FAMILY_NOTES: Record<string, string> = {
  whirl:
    'The whirl is the central rotational base in advanced freestyle. More compound tricks ' +
    'are built on whirl than any other base. Its rotational character means modifiers like ' +
    'blurry and spinning each add +2 (rather than +1) — giving the family the steepest ' +
    'ADD gradient of any trick family. The blurry whirl (5 ADD) is the single most ' +
    'referenced high-difficulty trick in documented competition sequences.',
  butterfly:
    'The butterfly sits at the intersection of dexterity and compound technique. It underlies ' +
    'ripwalk (blurry butterfly) and dimwalk (pixie butterfly), two of the most commonly ' +
    'performed 4-ADD tricks. Its 3-ADD starting point and moderate complexity make it the ' +
    'most common entry point into the compound vocabulary.',
  osis:
    'The osis spawns two major sub-families via named modifiers: torque (miraging osis) and ' +
    'blender (whirling osis). These in turn have their own high-ADD compounds — paradox torque, ' +
    'blurry torque, food processor — making the osis one of the most generative bases in the ' +
    'advanced trick vocabulary.',
  mirage:
    'The mirage is one of the two foundational 2-ADD rotational bases alongside clipper. ' +
    'As a rotational base, modifiers apply the higher bonus — paradox mirage is a rare 3-ADD ' +
    'result of paradox on a rotational base. The family includes blur (blurry mirage) and ' +
    'atom smasher (atomic mirage), both at 4 ADD.',
  clipper:
    'The clipper is the foundational inside cross-body delay and one of the most universally ' +
    'performed tricks in freestyle. As a non-rotational base, its compounds are capped at ' +
    'lower ADD values — the highest canonical clipper compound is 3 ADD (ducking clipper, ' +
    'spinning clipper, drifter).',
  legover:
    'The legover base yields a compact family: eggbeater (illusioning legover) and flurry ' +
    '(barraging legover) are the primary 3-ADD entries. The family is notable for producing ' +
    'DLO-style combinations at 5 ADD (fog).',
  torque:
    'Torque (miraging osis) is the most important intermediate base in advanced freestyle. ' +
    'It sits at 4 ADD and supports a dense cluster of high-difficulty tricks: paradox torque ' +
    'and mobius at 5 ADD, blurry torque, atomic torque, and spinning torque at 6 ADD. ' +
    'More 6-ADD tricks are built on torque than any other base.',
  blender:
    'Blender (whirling osis) is the other major 4-ADD osis compound. Its primary derivative ' +
    'is food processor (blurry blender) at 6 ADD — one of the highest ADD values in the ' +
    'documented trick vocabulary.',
};

// Rotational base tricks, these receive the higher modifier bonus (add_bonus_rotational)
const ROTATIONAL_BASES = new Set(['whirl', 'mirage', 'torque', 'blender', 'swirl', 'drifter']);

/**
 * Extract modifier word(s) from a compound canonical name by removing base trick words.
 * Returns an array of modifier slugs (one per applied modifier word).
 *
 * Example: "blurry whirl", base="whirl" → ["blurry"]
 * Example: "paradox symposium whirl", base="whirl" → ["paradox", "symposium"]
 * Example: "atom smasher", base="mirage" → [] (name differs too much; use description fallback)
 */
function extractModifierSlugs(canonicalName: string, baseTrick: string): string[] {
  const nameTokens = canonicalName.toLowerCase().split(/\s+/);
  const baseTokens = baseTrick.toLowerCase().split(/\s+/);
  // Remove base tokens from name tokens (left-to-right, greedy)
  const remaining = [...nameTokens];
  for (const bt of baseTokens) {
    const idx = remaining.indexOf(bt);
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining; // these are the modifier words as slug-candidates
}

function shapeTrickIndexRow(row: FreestyleTrickRow, slugsWithRecords: Set<string>): FreestyleTrickIndexRow {
  let aliases: string[] = [];
  try {
    aliases = row.aliases_json ? (JSON.parse(row.aliases_json) as string[]) : [];
  } catch { /* ignore malformed JSON */ }
  const detailHref  = `/freestyle/tricks/${row.slug}`;
  const hasRecords  = slugsWithRecords.has(row.slug);
  return {
    slug:          row.slug,
    canonicalName: row.canonical_name,
    adds:          row.adds,
    category:      row.category,
    description:   row.description,
    aliases,
    detailHref,
    hasRecords,
    recordHref:    hasRecords ? detailHref : null,  // backwards compat
  };
}

function shapeDictEntry(
  row: FreestyleTrickRow,
  allTricks: FreestyleTrickRow[],
  allModifiers: FreestyleTrickModifierRow[],
): FreestyleTrickDictEntry {
  let aliases: string[] = [];
  try {
    aliases = row.aliases_json ? (JSON.parse(row.aliases_json) as string[]) : [];
  } catch { /* ignore malformed JSON */ }

  const isModifier = row.category === 'modifier';
  const hasBase    = !!(row.base_trick && row.base_trick !== row.canonical_name);
  const isBase     = !hasBase && !isModifier;
  const isCompound = !!(hasBase && (row.category === 'compound' || row.category === 'dex'));

  const baseTrick     = hasBase ? row.base_trick! : null;
  const baseTrickSlug = baseTrick ? trickNameToSlug(baseTrick) : null;

  // Look up base trick row for its ADD value
  const baseRow     = baseTrickSlug ? allTricks.find(t => t.slug === baseTrickSlug) : null;
  const baseTrickAdds = baseRow?.adds ?? null;
  const baseAddsNum   = baseRow?.adds ? parseInt(baseRow.adds, 10) : null;

  // Extract modifiers and build ADD composition
  const modifierMap = new Map(allModifiers.map(m => [m.slug, m]));
  let appliedModifiers: AppliedModifier[] = [];
  let addComposition: string | null = null;

  if (hasBase && baseTrick && !isModifier) {
    const modifierSlugs = extractModifierSlugs(row.canonical_name, baseTrick);
    const isRotational  = ROTATIONAL_BASES.has(baseTrickSlug ?? '');

    appliedModifiers = modifierSlugs
      .map(slug => {
        const mod = modifierMap.get(slug);
        if (!mod) return null;
        const effectiveBonus = isRotational ? mod.add_bonus_rotational : mod.add_bonus;
        return {
          name:                mod.modifier_name,
          addBonus:            mod.add_bonus,
          addBonusRotational:  mod.add_bonus_rotational,
          isRotationalBase:    isRotational,
          effectiveBonus,
        };
      })
      .filter((m): m is AppliedModifier => m !== null);

    if (appliedModifiers.length > 0 && baseAddsNum !== null) {
      const totalBonus = appliedModifiers.reduce((s, m) => s + m.effectiveBonus, 0);
      const tricksAdds = row.adds ? parseInt(row.adds, 10) : null;
      const partsStr   = appliedModifiers
        .map(m => `${m.name} (+${m.effectiveBonus}${m.isRotationalBase ? ' on rotational base' : ''})`)
        .join(' + ');
      addComposition = `${baseTrick} (${baseAddsNum}) + ${partsStr} = ${tricksAdds ?? baseAddsNum + totalBonus}`;
    }
  }

  const addsNumeric = row.adds ? parseInt(row.adds, 10) : null;

  return {
    canonicalName:    row.canonical_name,
    adds:             row.adds,
    addsNumeric:      isNaN(addsNumeric ?? NaN) ? null : addsNumeric,
    category:         row.category,
    description:      row.description,
    aliases,
    baseTrick,
    baseTrickSlug,
    baseTrickAdds,
    trickFamily:      row.trick_family ?? null,
    isBase,
    isModifier,
    isCompound,
    addComposition,
    appliedModifiers,
    familyNote:       (row.trick_family && FAMILY_NOTES[row.trick_family]) ? FAMILY_NOTES[row.trick_family] : null,
  };
}

function shapeModifierEntry(row: FreestyleTrickModifierRow): FreestyleModifierEntry {
  return {
    slug:                row.slug,
    name:                row.modifier_name,
    addBonus:            row.add_bonus,
    addBonusRotational:  row.add_bonus_rotational,
    modifierType:        row.modifier_type,
    notes:               row.notes,
  };
}

// Editorial content (INSIGHTS_* and HISTORY_*) moved to
// src/content/freestyleEditorial.ts; imported at the top of this file.

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const freestyleService = {
  getRecordsPage(): PageViewModel<FreestyleRecordsContent> {
    const rows = runSqliteRead('freestyleRecords.listPublic', () =>
      freestyleRecords.listPublic.all() as FreestyleRecordRow[],
    );

    const groups = groupByType(rows);
    const holderSet = new Set(rows.map(r => r.person_id ?? r.holder_name));

    return {
      seo: {
        title: 'Freestyle Records',
        description:
          'Per-trick consecutive records from the freestyle footbag passback community.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_records',
        title:      'Freestyle Records',
        intro:
          'Best known per-trick consecutive completions from the freestyle community. ' +
          'Records sourced from the passback video archive.',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Records' },
        ],
      },
      content: {
        groups,
        totalRecords: rows.length,
        totalHolders: holderSet.size,
      },
    };
  },

  getLeadersPage(): PageViewModel<FreestyleLeadersContent> {
    const rows = runSqliteRead('freestyleRecords.listLeaders', () =>
      freestyleRecords.listLeaders.all() as FreestyleLeaderRow[],
    );

    const leaders = shapeLeaders(rows);
    const totalRecords = rows.reduce((sum, r) => sum + r.record_count, 0);

    return {
      seo: {
        title: 'Freestyle Leaders',
        description: 'Rankings by number of per-trick consecutive records held.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_leaders',
        title:      'Freestyle Leaders',
        intro:      'Players ranked by number of current per-trick consecutive records held.',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Leaders' },
        ],
      },
      content: {
        leaders,
        totalHolders: leaders.length,
        totalRecords,
      },
    };
  },

  getTrickDetailPage(slug: string): PageViewModel<FreestyleTrickContent> {
    // Resolve slug → trick_name via public (non-superseded) records
    const publicRows = runSqliteRead('freestyleRecords.listPublic', () =>
      freestyleRecords.listPublic.all() as FreestyleRecordRow[],
    );

    // Also check dictionary for slug resolution (trick may have no records)
    const dictRow = runSqliteRead('freestyleTricks.getBySlug', () =>
      freestyleTricks.getBySlug.get(slug) as FreestyleTrickRow | undefined,
    );

    const trickName = publicRows.find(r => r.trick_name && trickNameToSlug(r.trick_name) === slug)?.trick_name
      ?? dictRow?.canonical_name
      ?? null;

    if (!trickName) {
      throw new NotFoundError(`No freestyle trick found for slug: ${slug}`);
    }

    // All records for this trick (current + superseded), ordered by value DESC
    const allTrickRows = runSqliteRead('freestyleRecords.listAllByTrickName', () =>
      freestyleRecords.listAllByTrickName.all(trickName) as FreestyleRecordRow[],
    );

    const currentRows = allTrickRows.filter(r => !r.superseded_by);
    const hasProgression = allTrickRows.some(r => r.superseded_by);

    const sortName = allTrickRows[0]?.sort_name ?? null;
    const topValue = currentRows[0]?.value_numeric ?? 0;

    // Load all tricks and all modifiers for composition computation in shapeDictEntry
    const allDictRows = runSqliteRead('freestyleTricks.listAll', () =>
      freestyleTricks.listAll.all() as FreestyleTrickRow[],
    );
    const allModifierRows = runSqliteRead('freestyleTrickModifiers.listAll', () =>
      freestyleTrickModifiers.listAll.all() as FreestyleTrickModifierRow[],
    );

    const dictEntry = dictRow ? shapeDictEntry(dictRow, allDictRows, allModifierRows) : null;

    // Build family members list for difficulty ladder
    let familyMembers: FreestyleFamilyMember[] = [];
    if (dictRow && dictRow.trick_family) {
      const familySlug = dictRow.trick_family;
      const familyRows = runSqliteRead('freestyleTricks.listByFamily', () =>
        freestyleTricks.listByFamily.all(familySlug) as FreestyleTrickRow[],
      );
      // Build set of slugs with records for linking
      const slugsWithRecords = new Set(
        publicRows.filter(r => r.trick_name).map(r => trickNameToSlug(r.trick_name!)),
      );
      familyMembers = familyRows.map(r => ({
        slug:           r.slug,
        canonicalName:  r.canonical_name,
        adds:           r.adds,
        isCurrentTrick: r.slug === dictRow.slug,
        detailHref:     `/freestyle/tricks/${r.slug}`,
        hasRecords:     slugsWithRecords.has(r.slug),
      }));
    }

    // SEO and page title: prefer "About" framing for dict-only tricks with no records
    const hasDictEntry     = dictEntry !== null;
    const hasRecords       = currentRows.length > 0;
    const seoTitle         = hasRecords ? `${trickName} — Passback Records` : `${trickName} — Trick Reference`;
    const seoDescription   = hasRecords
      ? `Freestyle footbag passback records for ${trickName}. Current record: ${topValue} kicks.`
      : `${trickName}: ${dictEntry?.description ?? 'Freestyle footbag trick reference.'}`;

    return {
      seo: {
        title:       seoTitle,
        description: seoDescription,
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_trick_detail',
        title:      trickName,
        eyebrow:    hasDictEntry ? (dictEntry!.isModifier ? 'Modifier' : `${dictEntry!.adds ?? '?'} ADD`) : 'Trick Record',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Trick Dictionary', href: '/freestyle/tricks' },
          { label: trickName },
        ],
      },
      content: {
        trickName,
        sortName,
        slug,
        records:          currentRows.map(shapeFreestyleRecord),
        recordCount:      currentRows.length,
        topValue,
        progression:      allTrickRows.map(shapeFreestyleRecord),
        hasProgression,
        dictEntry,
        familyMembers,
        hasFamilyMembers: familyMembers.length > 1,
      },
    };
  },

  getFreestyleCompetitionPage(): PageViewModel<FreestyleCompetitionContent> {
    const competitorRows = runSqliteRead('freestyleCompetition.listTopCompetitors', () =>
      freestyleCompetition.listTopCompetitors.all() as FreestyleCompetitorRow[],
    );
    const eraRows = runSqliteRead('freestyleCompetition.listEventsByEra', () =>
      freestyleCompetition.listEventsByEra.all() as FreestyleEraRow[],
    );
    const recentRows = runSqliteRead('freestyleCompetition.listRecentEvents', () =>
      freestyleCompetition.listRecentEvents.all() as FreestyleRecentEventRow[],
    );

    const totalEvents = eraRows.reduce((sum, r) => sum + r.events, 0);

    const topCompetitors: FreestyleCompetitorViewModel[] = competitorRows.map(r => ({
      personId:     r.person_id,
      name:         r.person_name,
      country:      r.country,
      golds:        r.golds,
      silvers:      r.silvers,
      bronzes:      r.bronzes,
      totalPodiums: r.total_podiums,
      profileHref:  personHref(r.member_slug, r.person_id),
    }));

    const eventsByEra: FreestyleEraViewModel[] = eraRows.map(r => ({
      era:    r.era,
      events: r.events,
    }));

    const recentEvents: FreestyleRecentEventViewModel[] = recentRows.map(r => ({
      eventId:   r.event_id,
      title:     r.event_title,
      startDate: r.start_date.substring(0, 10),
      city:      r.city,
      country:   r.country,
      href:      `/events/${r.tag_normalized}`,
    }));

    return {
      seo: {
        title: 'Freestyle Competition',
        description:
          `Freestyle footbag competition history — top competitors, podium counts, ` +
          `and event records from ${totalEvents} documented events (1980–present).`,
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_competition',
        title:      'Freestyle Competition',
        intro:
          `Competition history derived from ${totalEvents} documented freestyle events ` +
          `(1980–present). Podium counts reflect all freestyle singles formats.`,
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Competition' },
        ],
      },
      content: {
        topCompetitors,
        eventsByEra,
        recentEvents,
        totalEvents,
        dataNote: 'Freestyle singles only. Includes Open, Intermediate, and Women\'s divisions. ' +
                  'Data from canonical event results — all placements are sourced directly from documented competition records.',
      },
    };
  },

  getFreestylePartnershipsPage(): PageViewModel<FreestylePartnershipsContent> {
    const rows = runSqliteRead('freestylePartnerships.listTopPartnerships', () =>
      freestylePartnerships.listTopPartnerships.all() as FreestylePartnershipRow[],
    );

    function shapePartnership(r: FreestylePartnershipRow): FreestylePartnershipViewModel {
      const first = r.first_year;
      const last = r.last_year;
      let span: string | null = null;
      if (first !== null && last !== null) {
        span = first === last ? String(first) : `${first}–${last}`;
      }
      return {
        ...shapePartnershipPair(r),
        appearanceCount: r.appearance_count,
        winCount:        r.win_count,
        podiumCount:     r.podium_count,
        yearSpan:        span,
      };
    }

    const allRanked = rows.map(shapePartnership);

    // Build notable buckets (same pattern as net)
    const BUCKET_SIZE = 5;

    const byWins = [...rows].sort((a, b) =>
      b.win_count - a.win_count || b.podium_count - a.podium_count || b.appearance_count - a.appearance_count);
    const byPodiums = [...rows].sort((a, b) =>
      b.podium_count - a.podium_count || b.win_count - a.win_count || b.appearance_count - a.appearance_count);
    const bySpan = [...rows].sort((a, b) => {
      const sa = (a.last_year ?? 0) - (a.first_year ?? 0);
      const sb = (b.last_year ?? 0) - (b.first_year ?? 0);
      return sb - sa || b.appearance_count - a.appearance_count;
    });

    const buckets: FreestylePartnershipBucket[] = [];
    const wB = byWins.slice(0, BUCKET_SIZE).map(shapePartnership);
    if (wB.length) buckets.push({ title: 'Most Wins', partnerships: wB });
    const pB = byPodiums.slice(0, BUCKET_SIZE).map(shapePartnership);
    if (pB.length) buckets.push({ title: 'Most Podium Finishes', partnerships: pB });
    const sB = bySpan.slice(0, BUCKET_SIZE).map(shapePartnership);
    if (sB.length) buckets.push({ title: 'Longest Spans', partnerships: sB });

    return {
      seo: {
        title: 'Freestyle Partnerships',
        description: 'Top freestyle doubles partnerships in footbag history.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_partnerships',
        title:      'Freestyle Partnerships',
        intro:      'The most significant doubles partnerships in freestyle footbag, ranked by competitive appearances.',
      },
      content: {
        buckets,
        allRanked,
        totalShown: allRanked.length,
        dataNote: 'Freestyle doubles and team routines only. Trick contests, shred, and circle events are excluded.',
      },
    };
  },

  getFreestyleHistoryPage(): PageViewModel<FreestyleHistoryContent> {
    return {
      seo: {
        title: 'Freestyle History',
        description:
          'The evolution of competitive freestyle footbag — pioneers, eras, the ADD system, ' +
          'and the shift from North American origins to European dominance.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_history',
        title:      'Freestyle History',
        intro:
          'From the early clipper-based vocabulary of the 1980s to the technical plateau of the ' +
          '2000s and the modern European era. Based on analysis of 774 documented competitive events (1980–2026).',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'History' },
        ],
      },
      content: {
        eras:          HISTORY_ERAS,
        pioneers:      HISTORY_PIONEERS,
        addSystem:     HISTORY_ADD_SYSTEM,
        regionalShift:
          'While early freestyle innovation was driven largely by North American players, the post-2005 era ' +
          'is characterized by European dominance in both performance and participation density. Václav Klouda ' +
          '(Czech Republic) accumulated 109 podium finishes — more than any other player in the dataset. ' +
          'Damian Gielnicki, Mariusz Wilk, Stefan Siegert, Honza Weber, and Andreas Nawrath represent a ' +
          'European technical cluster that produced both the highest-ADD sequences and the most diverse trick vocabularies.',
        modernEra:
          'Freestyle has reached structural completeness. The core trick vocabulary established by 2007–2008 ' +
          'remains the competitive language today. Progress is defined not by new elements, but by the ' +
          'refinement and recombination of existing ones — execution quality, sequence architecture, and ' +
          'the depth of players capable of reaching the established difficulty frontier.',
      },
    };
  },

  getFreestyleTricksIndexPage(): PageViewModel<FreestyleTricksIndexContent> {
    const allRows = runSqliteRead('freestyleTricks.listAll', () =>
      freestyleTricks.listAll.all() as FreestyleTrickRow[],
    );

    // Build set of slugs that have passback records (for linking)
    const publicRows = runSqliteRead('freestyleRecords.listPublic', () =>
      freestyleRecords.listPublic.all() as FreestyleRecordRow[],
    );
    const slugsWithRecords = new Set(
      publicRows
        .filter(r => r.trick_name)
        .map(r => trickNameToSlug(r.trick_name!)),
    );

    // Group by category in display order
    const categoryOrder = ['dex', 'body', 'set', 'compound', 'modifier'];
    const grouped = new Map<string, FreestyleTrickRow[]>();
    for (const row of allRows) {
      const cat = row.category ?? 'other';
      const bucket = grouped.get(cat) ?? [];
      bucket.push(row);
      grouped.set(cat, bucket);
    }

    const groups: FreestyleTrickGroup[] = categoryOrder
      .filter(cat => grouped.has(cat))
      .map(cat => ({
        category: cat,
        label:    CATEGORY_LABELS[cat] ?? cat,
        tricks:   (grouped.get(cat) ?? []).map(r => shapeTrickIndexRow(r, slugsWithRecords)),
      }));

    // Include any categories not in the ordered list
    for (const [cat, rows] of grouped.entries()) {
      if (!categoryOrder.includes(cat)) {
        groups.push({
          category: cat,
          label:    CATEGORY_LABELS[cat] ?? cat,
          tricks:   rows.map(r => shapeTrickIndexRow(r, slugsWithRecords)),
        });
      }
    }

    // Build family-grouped compound section (only non-null families with >1 member)
    const familyMap = new Map<string, FreestyleTrickRow[]>();
    for (const row of allRows) {
      if (!row.trick_family || row.category === 'modifier') continue;
      const bucket = familyMap.get(row.trick_family) ?? [];
      bucket.push(row);
      familyMap.set(row.trick_family, bucket);
    }
    // Families sorted by size DESC, then by slug
    const FAMILY_ORDER = ['whirl', 'butterfly', 'osis', 'mirage', 'clipper', 'legover', 'torque', 'blender'];
    const familyGroups: FreestyleFamilyGroup[] = [];
    // Ordered families first
    for (const fslug of FAMILY_ORDER) {
      const members = familyMap.get(fslug);
      if (members && members.length > 1) {
        familyGroups.push({
          familySlug: fslug,
          familyName: fslug.charAt(0).toUpperCase() + fslug.slice(1),
          members:    members.map(r => shapeTrickIndexRow(r, slugsWithRecords)),
        });
      }
    }
    // Any remaining families not in the ordered list
    for (const [fslug, members] of familyMap.entries()) {
      if (!FAMILY_ORDER.includes(fslug) && members.length > 1) {
        familyGroups.push({
          familySlug: fslug,
          familyName: fslug.charAt(0).toUpperCase() + fslug.slice(1),
          members:    members.map(r => shapeTrickIndexRow(r, slugsWithRecords)),
        });
      }
    }

    // Load modifier reference table
    const modifierRows = runSqliteRead('freestyleTrickModifiers.listAll', () =>
      freestyleTrickModifiers.listAll.all() as FreestyleTrickModifierRow[],
    );
    const modifiers = modifierRows.map(shapeModifierEntry);

    return {
      seo: {
        title: 'Freestyle Trick Dictionary',
        description:
          'Reference guide to freestyle footbag tricks — ADD values, categories, ' +
          'descriptions, and aliases for 70+ documented tricks.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_tricks_index',
        title:      'Trick Dictionary',
        intro:
          'A reference guide to documented freestyle footbag tricks, organized by category. ' +
          'ADD values reflect the standard difficulty scoring system.',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Trick Dictionary' },
        ],
      },
      content: {
        groups,
        familyGroups,
        modifiers,
        totalTricks: allRows.length,
      },
    };
  },

  getFreestyleInsightsPage(): PageViewModel<FreestyleInsightsContent> {
    return {
      seo: {
        title: 'Freestyle Insights',
        description:
          'Data-driven insights into freestyle footbag: most-used tricks, difficulty trends, ' +
          'top transitions, and sequence analysis from 774 documented competitive events.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_insights',
        title:      'Freestyle Insights',
        intro:
          'Trick and sequence analysis derived from 774 documented competitive events (1980–2026) ' +
          'and 395 Sick3 format sequences spanning 22 years of ADD-scored competition.',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Insights' },
        ],
      },
      content: {
        mostUsed:         INSIGHTS_MOST_USED,
        connectors:       INSIGHTS_CONNECTORS,
        transitions:      INSIGHTS_TRANSITIONS,
        hardestSequences: INSIGHTS_SEQUENCES,
        diversePlayers:   INSIGHTS_DIVERSE_PLAYERS,
        difficultyEras:   INSIGHTS_DIFFICULTY_ERAS,
        narratives:       INSIGHTS_NARRATIVES,
      },
    };
  },

  getAboutPage(): PageViewModel<Record<string, never>> {
    return {
      seo: {
        title: 'About Freestyle',
        description:
          'About freestyle footbag — competition formats, judging, and community resources.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_about',
        title:      'About Freestyle Footbag',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'About' },
        ],
      },
      content: {},
    };
  },

  getMovesPage(): PageViewModel<Record<string, never>> {
    return {
      seo: {
        title: 'Freestyle Move Sets',
        description:
          'Reference guide to freestyle footbag move set notation: Pixie, Fairy, Nuclear, and more.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_moves',
        title:      'Freestyle Move Sets',
        intro:      'A reference guide to the set notation system used in new-school freestyle footbag.',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Move Sets' },
        ],
      },
      content: {},
    };
  },

  getLandingPage(): PageViewModel<FreestyleLandingContent> {
    const typeCounts = runSqliteRead('freestyleRecords.countPublicByType', () =>
      freestyleRecords.countPublicByType.all() as { record_type: string; n: number }[],
    );

    const leaderRows = runSqliteRead('freestyleRecords.listLeaders', () =>
      freestyleRecords.listLeaders.all() as FreestyleLeaderRow[],
    );

    const recentRows = runSqliteRead('freestyleRecords.listRecentPublic', () =>
      freestyleRecords.listRecentPublic.all() as FreestyleRecordRow[],
    );

    const trickRows = runSqliteRead('freestyleTricks.listAll', () =>
      freestyleTricks.listAll.all() as FreestyleTrickRow[],
    );

    const eraRows = runSqliteRead('freestyleCompetition.listEventsByEra', () =>
      freestyleCompetition.listEventsByEra.all() as FreestyleEraRow[],
    );

    const totalRecords = typeCounts.reduce((sum, r) => sum + r.n, 0);
    const totalEvents  = eraRows.reduce((sum, r) => sum + r.events, 0);

    return {
      seo: {
        title: 'Freestyle',
        description: 'Freestyle footbag — competition history, passback records, trick dictionary, and history.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_landing',
        title:      'Freestyle Footbag',
        intro: 'Tricks, combos, and choreographed routines set to music.',
      },
      content: {
        mascotSrc: '/img/freestyle-mascot.svg',
        mascotAlt: 'Freestyle footbag mascot icon',
        intro: {
          heading: 'What is Freestyle Footbag?',
          paragraphs: [
            'Freestyle footbag began with informal Hacky Sack kicking circles in the 1970s and 1980s, evolving from casual fun exercise into a technical sport. It is a discipline built on creativity, technical difficulty, and individual style. Freestyle footbag is a great way to exercise due to its versatility and fun, cooperative flow, plus it can be practiced anywhere and anytime.',
            'Players show off their skills by performing sequences of tricks, combining components such as spinning the body, ducking the bag with the head and neck, and dexterities (circling the bag with a leg).',
            'Tricks are linked naturally from one to the next to create flowing, free-form, and expressive strings and combos. The list of tricks is nearly endless and can be combined in any order, leading to a huge variety of combos and styles.',
            'The ADD (Additional Degree of Difficulty) system assigns a numerical value to each trick, enabling objective difficulty scoring alongside subjective execution judging. The core vocabulary was established by the early 1990s and it continues to evolve as players innovate.',
            'Practicing freestyle footbag is like having a gym in your pocket! When first learning the basics, all you need is casual clothes, shoes, and a footbag. Once you gain experience and begin to learn more difficult tricks, athletic clothes and a professional footbag with purpose-built shoes will help you play your best.',
          ],
        },
        demoVideo: {
          webmUrl: '/media/demo-freestyle.webm',
          mp4Url: '/media/demo-freestyle.mp4',
          posterUrl: '/media/demo-freestyle-poster.jpg',
          caption: 'Demonstration of freestyle footbag',
        },
        getStartedTiles: [
          { label: 'Where to buy footbags', href: '#', comingSoon: true },
          { label: 'Where to buy shoes',    href: '#', comingSoon: true },
          { label: 'Beginner tutorials',    href: '#', comingSoon: true },
        ],
        competitionFormats: [
          {
            slug: 'routine',
            title: 'Routine',
            paragraph: 'Routine is a timed event in which players choreograph a freestyle footbag performance to music. Competitors are judged on both their artistic and technical abilities.',
            videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/Z-KkyOpoBhM',
            videoTitle: 'Yoshihito Yamamoto — Worlds Online 2020 Qualification Routine',
          },
          {
            slug: 'circle',
            title: 'Circle',
            paragraph: 'Circle takes traditional freestyle footbag and puts a competitive spin on it. Players take turns with the bag to show off their technical skills.',
            videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/aMr5e5wlgeE',
            videoTitle: 'Worlds 2017 Open Circle Finals',
          },
          {
            slug: 'sick3',
            title: 'Sick 3',
            paragraph: "Sick 3 is freestyle footbag's version of a best-trick competition. Players combine their three best tricks and are judged on difficulty, variety, and execution.",
            videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/h6F0aPIpC1o',
            videoTitle: 'World Footbag Championships 2022 — Sick 3',
          },
          {
            slug: 'shred30',
            title: 'Shred 30',
            paragraph: "Shred 30 is a short, timed, scored event which tests competitors' abilities to quickly link together as many difficult tricks as they can before their time is up.",
            videoEmbedUrl: 'https://www.youtube-nocookie.com/embed/wb75xzvAs68',
            videoTitle: 'Taishi Ishida — World Footbag Championships 2020 Shred 30',
          },
        ],
        totalRecords,
        recordTypes:   typeCounts.length,
        topHolders:    shapeLeaders(leaderRows).slice(0, 5),
        recentRecords: recentRows.map(shapeFreestyleRecord),
        totalTricks:   trickRows.length,
        totalEvents,
      },
    };
  },
};
