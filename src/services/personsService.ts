import { personsQc, PersonsQcRow } from '../db/db';
import { runPersonsQcChecks, PersonQcIssue, PersonQcCategory, PersonQcSeverity } from './personsQcChecks';

interface PersonsQcFilters {
  category?: string;
  source?: string;
}

interface CategoryCount {
  category: string;
  label: string;
  count: number;
}

interface SeverityCount {
  severity: string;
  count: number;
}

interface FilterOption {
  value: string;
  label: string;
}

interface PersonsQcPageItem {
  person_id: string;
  person_name: string;
  source: string;
  source_scope: string;
  aliases: string;
  country: string;
  category: PersonQcCategory;
  categoryLabel: string;
  severity: PersonQcSeverity;
  severityClass: string;
  detail: string;
}

const CATEGORY_LABELS: Record<PersonQcCategory, string> = {
  encoding_corruption: 'Encoding Corruption',
  multi_person: 'Multi-Person Entry',
  junk_marker: 'Junk Marker',
  incomplete_name: 'Incomplete Name',
  single_word: 'Single Word',
  abbreviated_name: 'Abbreviated Name',
  non_person: 'Non-Person Entry',
};

interface PersonsBrowseFilters {
  search?: string;
  source?: string;
  page?: number;
}

const BROWSE_PAGE_SIZE = 200;

export const personsService = {
  getPersonsBrowsePage(filters: PersonsBrowseFilters) {
    const rows = personsQc.listAll.all() as PersonsQcRow[];
    const allIssues = runPersonsQcChecks(rows);
    const flaggedIds = new Set(allIssues.map(i => i.person_id));

    // Apply filters
    let filtered = rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(r => r.person_name.toLowerCase().includes(q));
    }
    if (filters.source) {
      const srcFilter = filters.source === '(none)' ? null : filters.source;
      filtered = filtered.filter(r => r.source === srcFilter);
    }

    // Pagination
    const page = Math.max(1, filters.page ?? 1);
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / BROWSE_PAGE_SIZE);
    const offset = (page - 1) * BROWSE_PAGE_SIZE;
    const pageItems = filtered.slice(offset, offset + BROWSE_PAGE_SIZE);

    // Source options
    const srcCounts = new Map<string, number>();
    for (const r of rows) {
      const key = r.source ?? '(none)';
      srcCounts.set(key, (srcCounts.get(key) ?? 0) + 1);
    }
    const sourceOptions: FilterOption[] = [
      { value: '', label: `All (${rows.length})` },
      ...[...srcCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([src, cnt]) => ({ value: src, label: `${src} (${cnt})` })),
    ];

    const items = pageItems.map(r => ({
      person_id: r.person_id,
      person_name: r.person_name,
      source: r.source ?? '(none)',
      country: r.country ?? '',
      event_count: r.event_count,
      placement_count: r.placement_count,
      flagged: flaggedIds.has(r.person_id),
    }));

    return {
      seo: { title: 'Persons Browse' },
      page: { sectionKey: 'internal', pageKey: 'persons_browse', title: 'Persons Browse' },
      content: {
        totalPersons: rows.length,
        totalFiltered: totalItems,
        totalFlagged: flaggedIds.size,
        activeFilters: {
          search: filters.search ?? '',
          source: filters.source ?? '',
        },
        filterOptions: { sources: sourceOptions },
        items,
        itemCount: pageItems.length,
        currentPage: page,
        totalPages,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
      },
    };
  },

  getPersonsQcPage(filters: PersonsQcFilters) {
    const rows = personsQc.listAll.all() as PersonsQcRow[];
    const allIssues = runPersonsQcChecks(rows);

    // Compute unfiltered summary stats
    const countsByCategory = computeCategoryCounts(allIssues);
    const countsBySeverity = computeSeverityCounts(allIssues);

    // Deduplicate: count unique person_ids with issues
    const flaggedPersonIds = new Set(allIssues.map(i => i.person_id));

    // Apply filters
    let filtered = allIssues;
    if (filters.category) {
      filtered = filtered.filter(i => i.category === filters.category);
    }
    if (filters.source) {
      const srcFilter = filters.source === '(none)' ? null : filters.source;
      filtered = filtered.filter(i => i.source === srcFilter);
    }

    // Build filter options from all issues (not filtered)
    const categoryOptions: FilterOption[] = [
      { value: '', label: `All (${allIssues.length})` },
      ...countsByCategory.map(c => ({ value: c.category, label: `${c.label} (${c.count})` })),
    ];

    const sourceCounts = new Map<string, number>();
    for (const issue of allIssues) {
      const key = issue.source ?? '(none)';
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
    const sourceOptions: FilterOption[] = [
      { value: '', label: `All (${allIssues.length})` },
      ...[...sourceCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([src, cnt]) => ({ value: src, label: `${src} (${cnt})` })),
    ];

    // Shape items for template
    const items: PersonsQcPageItem[] = filtered.map(i => ({
      person_id: i.person_id,
      person_name: i.person_name,
      source: i.source ?? '(none)',
      source_scope: i.source_scope ?? '',
      aliases: i.aliases ?? '',
      country: i.country ?? '',
      category: i.category,
      categoryLabel: CATEGORY_LABELS[i.category] ?? i.category,
      severity: i.severity,
      severityClass: i.severity.toLowerCase(),
      detail: i.detail,
    }));

    return {
      seo: { title: 'Persons QC' },
      page: { sectionKey: 'internal', pageKey: 'persons_qc', title: 'Persons QC' },
      content: {
        totalPersons: rows.length,
        totalFlagged: flaggedPersonIds.size,
        totalIssues: allIssues.length,
        totalHigh: countsBySeverity.find(s => s.severity === 'HIGH')?.count ?? 0,
        totalMedium: countsBySeverity.find(s => s.severity === 'MEDIUM')?.count ?? 0,
        totalLow: countsBySeverity.find(s => s.severity === 'LOW')?.count ?? 0,
        countsByCategory,
        countsBySeverity,
        activeFilters: {
          category: filters.category ?? '',
          source: filters.source ?? '',
        },
        filterOptions: {
          categories: categoryOptions,
          sources: sourceOptions,
        },
        items,
        itemCount: filtered.length,
      },
    };
  },
};

function computeCategoryCounts(issues: PersonQcIssue[]): CategoryCount[] {
  const counts = new Map<PersonQcCategory, number>();
  for (const i of issues) {
    counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([cat, count]) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      count,
    }));
}

function computeSeverityCounts(issues: PersonQcIssue[]): SeverityCount[] {
  const counts = new Map<string, number>();
  for (const i of issues) {
    counts.set(i.severity, (counts.get(i.severity) ?? 0) + 1);
  }
  const order = ['HIGH', 'MEDIUM', 'LOW'];
  return order
    .filter(s => counts.has(s))
    .map(s => ({ severity: s, count: counts.get(s)! }));
}
