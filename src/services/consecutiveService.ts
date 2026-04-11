import { consecutiveKicksRecords, ConsecutiveKicksRow } from '../db/db';

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export interface ConsecutiveRecordViewModel {
  division:   string;
  player_1:   string | null;
  player_2:   string | null;
  score:      number | null;
  scoreFormatted: string;
  note:       string | null;
  isWorldRecord: boolean;
  eventDate:  string | null;
  eventName:  string | null;
  location:   string | null;
  year:       string | null;
}

export interface ConsecutiveGroup {
  subsection: string;
  rows:       ConsecutiveRecordViewModel[];
}

export interface ConsecutiveRecordsContent {
  worldRecords:  ConsecutiveRecordViewModel[];
  highestScores: ConsecutiveGroup[];
  progression:   ConsecutiveGroup[];
  milestones:    ConsecutiveGroup[];
}

interface ConsecutiveRecordsViewModel {
  seo:     { title: string };
  page:    { sectionKey: string; pageKey: string; title: string; intro: string };
  content: ConsecutiveRecordsContent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScore(score: number | null): string {
  if (score === null) return '—';
  return score.toLocaleString('en-US');
}

function shapeRow(r: ConsecutiveKicksRow): ConsecutiveRecordViewModel {
  const noteText = r.note ?? '';
  const isWorldRecord = noteText.includes('World Record') && !noteText.includes('Former');
  return {
    division:       r.division,
    player_1:       r.player_1,
    player_2:       r.player_2,
    score:          r.score,
    scoreFormatted: formatScore(r.score),
    note:           r.note,
    isWorldRecord,
    eventDate:      r.event_date,
    eventName:      r.event_name,
    location:       r.location,
    year:           r.year,
  };
}

function groupBySubsection(rows: ConsecutiveKicksRow[]): ConsecutiveGroup[] {
  const groups: ConsecutiveGroup[] = [];
  let current: ConsecutiveGroup | null = null;
  for (const r of rows) {
    if (!current || current.subsection !== r.subsection) {
      current = { subsection: r.subsection, rows: [] };
      groups.push(current);
    }
    current.rows.push(shapeRow(r));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const consecutiveService = {
  getRecordsPage(): ConsecutiveRecordsViewModel {
    const worldRows       = consecutiveKicksRecords.listWorldRecords.all()   as ConsecutiveKicksRow[];
    const highScoreRows   = consecutiveKicksRecords.listHighestScores.all()  as ConsecutiveKicksRow[];
    const progressionRows = consecutiveKicksRecords.listProgression.all()    as ConsecutiveKicksRow[];
    const milestoneRows   = consecutiveKicksRecords.listMilestones.all()     as ConsecutiveKicksRow[];

    return {
      seo:  { title: 'Consecutive Kicks Records' },
      page: {
        sectionKey: 'consecutive',
        pageKey:    'consecutive_records',
        title:      'Consecutive Kicks Records',
        intro:      'Official WFA-sanctioned consecutive kicks world records and historical elite scores.',
      },
      content: {
        worldRecords:  worldRows.map(shapeRow),
        highestScores: groupBySubsection(highScoreRows),
        progression:   groupBySubsection(progressionRows),
        milestones:    groupBySubsection(milestoneRows),
      },
    };
  },
};
