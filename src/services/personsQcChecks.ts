/**
 * Pure-function QC checks for historical_persons names.
 * Mirrors the person-likeness gate in pipeline/platform/export_canonical_platform.py.
 * No DB access, no Express imports, easily testable.
 */

export interface PersonQcRow {
  person_id: string;
  person_name: string;
  aliases: string | null;
  source: string | null;
  source_scope: string | null;
  country: string | null;
  event_count: number;
  placement_count: number;
}

export type PersonQcCategory =
  | 'encoding_corruption'
  | 'multi_person'
  | 'junk_marker'
  | 'incomplete_name'
  | 'single_word'
  | 'abbreviated_name'
  | 'non_person';

export type PersonQcSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PersonQcIssue {
  person_id: string;
  person_name: string;
  source: string | null;
  source_scope: string | null;
  aliases: string | null;
  country: string | null;
  category: PersonQcCategory;
  severity: PersonQcSeverity;
  detail: string;
}

// ── Regexes, mirrors Python gate in export_canonical_platform.py ─────────────

// Encoding artifacts (Windows-1250 mojibake)
const RE_MOJIBAKE = /[¶¦±¼¿¸¹º³]/;

// Question mark embedded inside a word: "Ale? Pelko", "Vrane?ević"
const RE_EMBEDDED_QUESTION = /\w\?|\?\w/;

// Standalone question marks as word tokens
const RE_STANDALONE_QUESTION = /(?:^|\s)\?{1,5}(?:\s|$)/;

// Multi-person separator: "and", "&", "/", "+", "vs"
const RE_MULTI_PERSON = /\b(and|&|vs\.?)\b|[/+]/i;

// Bad characters that should not appear in canonical display names
const RE_BAD_CHARS = /[+=\\|/]/;

// Embedded rank: "2. Name" or "Name 3."
const RE_EMBED_RANK = /\b\d+\.\s/;

// Trailing junk: "Name*"
const RE_TRAILING_JUNK = /[*]+$/;

// Scoreboard codes: "IL 49", "IL 63"
const RE_SCOREBOARD = /^[A-Z]{2}\s+\d+$/;

// Embedded dollar amounts: "Name $25"
const RE_PRIZE = /\$\d+/;

// Match results: "Name 11-0 Over Name"
const RE_MATCH_RESULT = /\d+-\d+\s+over\b/i;

// 3+ digit number tokens
const RE_BIG_NUMBER = /\b\d{3,}\b/;

// Non-person keywords
const RE_NON_PERSON = /\b(Connection|Dimension|Footbag|Spikehammer|head-to-head|being determined|Freestyler|round robin|results)\b/i;

// All-caps junk: "CARLOS RAMIREZ- BERNARDO PALACIOS"
const RE_ALL_CAPS_JUNK = /^[A-Z]{2,}[\s-]+[A-Z]{2,}(?:[\s-]+[A-Z]{2,})*$/;

// Single-initial abbreviated: "J Smith", "A GRAVEL", "A. Dukes"
const RE_ABBREVIATED = /^[A-Z]\.?\s+\S/;

// Incomplete single-char last name: "Yassin B", "Alex G"
const RE_INCOMPLETE_LAST = /^\S+\s+[A-Z]$/;

// Pure initials: "F. D."
const RE_INITIALS_ONLY = /^[A-Z]\.\s+[A-Z]\.$/;

// Prize suffix: "Name-prizes"
const RE_PRIZE_SUFFIX = /-prizes\b/i;

// ── Sentinel names to skip ───────────────────────────────────────────────────

const SENTINEL_NAMES = new Set(['unknown', '[unknown partner]', '']);

function isSentinel(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return SENTINEL_NAMES.has(lower) || lower.startsWith('__') || lower.startsWith('[');
}

// ── Check runner ─────────────────────────────────────────────────────────────

export function runPersonsQcChecks(persons: PersonQcRow[]): PersonQcIssue[] {
  const issues: PersonQcIssue[] = [];

  for (const p of persons) {
    const name = (p.person_name ?? '').trim();
    if (!name || isSentinel(name)) continue;

    const base = {
      person_id: p.person_id,
      person_name: p.person_name,
      source: p.source,
      source_scope: p.source_scope,
      aliases: p.aliases,
      country: p.country,
    };

    // 1. Encoding corruption, mojibake characters
    if (RE_MOJIBAKE.test(name)) {
      issues.push({
        ...base,
        category: 'encoding_corruption',
        severity: 'HIGH',
        detail: 'Name contains mojibake/encoding artifact characters',
      });
    }

    // 2. Encoding corruption, question mark embedded in word
    if (RE_EMBEDDED_QUESTION.test(name)) {
      issues.push({
        ...base,
        category: 'encoding_corruption',
        severity: 'HIGH',
        detail: 'Question mark embedded in word (likely encoding corruption)',
      });
    }

    // 3. Multi-person entry
    if (RE_MULTI_PERSON.test(name) && name.split(/\s+/).length >= 2) {
      issues.push({
        ...base,
        category: 'multi_person',
        severity: 'MEDIUM',
        detail: 'Name appears to contain multiple people (and/&/+///vs)',
      });
    }

    // 4. Junk markers, trailing asterisk
    if (RE_TRAILING_JUNK.test(name) && name.split(/\s+/).length >= 2) {
      issues.push({
        ...base,
        category: 'junk_marker',
        severity: 'LOW',
        detail: 'Name ends with junk marker (*)',
      });
    }

    // 5. Junk markers, bad characters (+=\|)
    if (RE_BAD_CHARS.test(name)) {
      issues.push({
        ...base,
        category: 'junk_marker',
        severity: 'MEDIUM',
        detail: 'Name contains characters that should not appear in canonical names (+=\\|)',
      });
    }

    // 6. Junk markers, embedded rank prefix ("2. Name")
    if (RE_EMBED_RANK.test(name)) {
      issues.push({
        ...base,
        category: 'junk_marker',
        severity: 'MEDIUM',
        detail: 'Name contains embedded rank number (e.g. "2. Name")',
      });
    }

    // 7. Incomplete name, standalone question mark word
    if (RE_STANDALONE_QUESTION.test(name)) {
      issues.push({
        ...base,
        category: 'incomplete_name',
        severity: 'MEDIUM',
        detail: 'Name contains standalone "?" (incomplete/unresolved)',
      });
    }

    // 8. Single-word name (no space and no period)
    if (!name.includes(' ') && !name.includes('.')) {
      issues.push({
        ...base,
        category: 'single_word',
        severity: 'LOW',
        detail: 'Single-word name (not a canonical full name)',
      });
    }

    // 9. Non-person patterns
    if (RE_SCOREBOARD.test(name) || RE_PRIZE.test(name) || RE_MATCH_RESULT.test(name)
        || RE_BIG_NUMBER.test(name) || RE_NON_PERSON.test(name)
        || RE_ALL_CAPS_JUNK.test(name) || RE_PRIZE_SUFFIX.test(name)
        || name.includes(',') || name[0] === name[0].toLowerCase()) {
      issues.push({
        ...base,
        category: 'non_person',
        severity: 'MEDIUM',
        detail: 'Entry does not appear to be a person name (junk, location, narrative, etc.)',
      });
    }

    // 10. Abbreviated first name: "J Smith", "A GRAVEL"
    if (RE_ABBREVIATED.test(name)) {
      issues.push({
        ...base,
        category: 'abbreviated_name',
        severity: 'LOW',
        detail: 'Single-initial abbreviated first name',
      });
    }

    // 11. Incomplete last name: "Yassin B", "Alex G"
    if (RE_INCOMPLETE_LAST.test(name)) {
      issues.push({
        ...base,
        category: 'incomplete_name',
        severity: 'LOW',
        detail: 'Incomplete single-character last name',
      });
    }

    // 12. Pure initials only: "F. D."
    if (RE_INITIALS_ONLY.test(name)) {
      issues.push({
        ...base,
        category: 'incomplete_name',
        severity: 'MEDIUM',
        detail: 'Initials only — not a displayable name',
      });
    }
  }

  return issues;
}
