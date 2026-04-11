import { FreestyleRecordRow, freestyleRecords } from '../db/db';
import { runSqliteRead } from './sqliteRetry';
import { PageViewModel } from '../types/page';

// ---------------------------------------------------------------------------
// Record type labels — human-readable display strings for each record_type
// value stored in the DB. Add entries here as new record types are loaded.
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

export interface FreestyleRecordViewModel {
  id: string;
  holderName: string;
  holderHref: string | null;   // /history/:personId when person_id resolved
  trickName: string | null;
  sortName: string | null;
  addsCount: number | null;
  valueNumeric: number;
  achievedDate: string | null;
  dateApproximate: boolean;
  confidence: string;
  isProbable: boolean;         // true when confidence === 'probable' — show disclaimer
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

export interface FreestyleLandingContent {
  totalRecords: number;
  recordTypes: number;
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

  getLandingPage(): PageViewModel<FreestyleLandingContent> {
    const typeCounts = runSqliteRead('freestyleRecords.countPublicByType', () =>
      freestyleRecords.countPublicByType.all() as { record_type: string; n: number }[],
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
      },
    };
  },
};
