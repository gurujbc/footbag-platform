import { FreestyleLeaderRow, FreestyleRecordRow, freestyleRecords } from '../db/db';
import { runSqliteRead } from './sqliteRetry';
import { NotFoundError } from './serviceErrors';
import { PageViewModel } from '../types/page';

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
// Slug helpers
// ---------------------------------------------------------------------------

export function trickNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Shaped types for templates
// ---------------------------------------------------------------------------

export interface FreestyleRecordViewModel {
  id: string;
  holderName: string;
  holderHref: string | null;   // /history/:personId when person_id resolved
  trickName: string | null;
  trickHref: string | null;    // /freestyle/tricks/:slug
  sortName: string | null;
  addsCount: number | null;
  valueNumeric: number;
  achievedDate: string | null;
  dateApproximate: boolean;
  confidence: string;
  isProbable: boolean;
  videoUrl: string | null;
  videoTimecode: string | null;
  notes: string | null;
}

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

export interface FreestyleLandingContent {
  totalRecords: number;
  recordTypes: number;
  topHolders: FreestyleLeaderViewModel[];
  recentRecords: FreestyleRecordViewModel[];
}

export interface FreestyleTrickContent {
  trickName: string;
  sortName: string | null;
  slug: string;
  records: FreestyleRecordViewModel[];
  recordCount: number;
  topValue: number;
}

// ---------------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------------

export function shapeFreestyleRecord(row: FreestyleRecordRow): FreestyleRecordViewModel {
  return {
    id:              row.id,
    holderName:      row.holder_name,
    holderHref:      row.person_id ? `/history/${row.person_id}` : null,
    trickName:       row.trick_name,
    trickHref:       row.trick_name ? `/freestyle/tricks/${trickNameToSlug(row.trick_name)}` : null,
    sortName:        row.sort_name,
    addsCount:       row.adds_count,
    valueNumeric:    row.value_numeric,
    achievedDate:    row.achieved_date,
    dateApproximate: row.date_precision !== 'day',
    confidence:      row.confidence,
    isProbable:      row.confidence === 'probable',
    videoUrl:        row.video_url,
    videoTimecode:   row.video_timecode,
    notes:           row.notes,
  };
}

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
    holderHref:  row.person_id ? `/history/${row.person_id}` : null,
    recordCount: row.record_count,
    topValue:    row.top_value,
    topTrick:    row.top_trick,
  }));
}

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
    // Resolve slug → trick_name by fetching all public records and matching
    const allRows = runSqliteRead('freestyleRecords.listPublic', () =>
      freestyleRecords.listPublic.all() as FreestyleRecordRow[],
    );

    const trickName = allRows.find(r => r.trick_name && trickNameToSlug(r.trick_name) === slug)?.trick_name;
    if (!trickName) {
      throw new NotFoundError(`No freestyle trick found for slug: ${slug}`);
    }

    // listByTrickName returns all rows for this trick, ordered by value DESC
    const rows = runSqliteRead('freestyleRecords.listByTrickName', () =>
      freestyleRecords.listByTrickName.all(trickName) as FreestyleRecordRow[],
    );

    const sortName = rows[0]?.sort_name ?? null;
    const topValue = rows[0]?.value_numeric ?? 0;

    return {
      seo: {
        title: `${trickName} Records`,
        description: `Freestyle footbag consecutive records for ${trickName}.`,
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_trick_detail',
        title:      trickName,
        eyebrow:    'Trick Record',
      },
      navigation: {
        breadcrumbs: [
          { label: 'Freestyle', href: '/freestyle' },
          { label: 'Records', href: '/freestyle/records' },
          { label: trickName },
        ],
      },
      content: {
        trickName,
        sortName,
        slug,
        records:     rows.map(shapeFreestyleRecord),
        recordCount: rows.length,
        topValue,
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

    const totalRecords = typeCounts.reduce((sum, r) => sum + r.n, 0);

    return {
      seo: {
        title: 'Freestyle',
        description: 'Freestyle footbag records, history, and community data.',
      },
      page: {
        sectionKey: 'freestyle',
        pageKey:    'freestyle_landing',
        title:      'Freestyle Footbag',
        intro:
          'Freestyle footbag is a discipline built on creativity, difficulty, and style. ' +
          'This section tracks records, trick history, and player data from the freestyle community.',
      },
      content: {
        totalRecords,
        recordTypes: typeCounts.length,
        topHolders:    shapeLeaders(leaderRows).slice(0, 5),
        recentRecords: recentRows.map(shapeFreestyleRecord),
      },
    };
  },
};
