/**
 * Shared shaping helpers for player profile views.
 * Used by both historyService and memberService to produce consistent
 * PlayerEventGroup[] data.
 */

import { personHref } from './personLink';
import type { PlayerEventGroup } from '../types/playerProfile';

/** Row shape that both history and member result queries must satisfy. */
export interface PlayerResultRow {
  event_id: string;
  event_title: string;
  start_date: string;
  city: string;
  event_region: string | null;
  event_country: string;
  event_tag_normalized: string;
  discipline_name: string | null;
  discipline_category: string | null;
  team_type: string | null;
  placement: number;
  score_text: string | null;
  participant_display_name: string;
  participant_person_id: string | null;
  participant_member_slug: string | null;
  participant_member_id?: string | null;
}

export interface GroupResultsOpts {
  selfPersonId?: string | null;
  selfMemberId?: string | null;
}

/**
 * Group flat result rows into PlayerEventGroup[].
 * Identifies "self" rows by matching selfPersonId or selfMemberId
 * to exclude the player from their own teammates list.
 */
export function groupPlayerResults(rows: PlayerResultRow[], opts: GroupResultsOpts): PlayerEventGroup[] {
  const eventMap = new Map<string, PlayerEventGroup>();

  for (const row of rows) {
    const eventKey = row.event_tag_normalized.startsWith('#')
      ? row.event_tag_normalized.slice(1)
      : row.event_tag_normalized;

    if (!eventMap.has(eventKey)) {
      eventMap.set(eventKey, {
        eventKey,
        eventHref:    `/events/${eventKey}`,
        eventTitle:   row.event_title,
        startDate:    row.start_date,
        city:         row.city,
        eventRegion:  row.event_region,
        eventCountry: row.event_country,
        results:      [],
        hasDetailColumn: false,
      });
    }

    const group = eventMap.get(eventKey)!;

    const key = `${row.discipline_name ?? ''}__${row.placement}`;
    let entry = group.results.find(
      r => `${r.disciplineName ?? ''}__${r.placement}` === key,
    );

    if (!entry) {
      entry = {
        disciplineName:     row.discipline_name,
        disciplineCategory: row.discipline_category,
        teamType:           row.team_type,
        placement:          row.placement,
        scoreText:          row.score_text,
        teammates:          [],
        isTie:              row.team_type === 'singles',
        detailPrefix:       '',
      };
      group.results.push(entry);
    }

    const isSelf =
      (opts.selfPersonId && row.participant_person_id === opts.selfPersonId) ||
      (opts.selfMemberId && row.participant_member_id === opts.selfMemberId);

    if (!isSelf && !entry.teammates.some(t => t.name === row.participant_display_name)) {
      entry.teammates.push({
        name:       row.participant_display_name,
        playerHref: personHref(row.participant_member_slug, row.participant_person_id) ?? undefined,
      });
    }
  }

  const groups = Array.from(eventMap.values());
  for (const g of groups) {
    let hasDetail = false;
    for (const r of g.results) {
      const hasTeammates = r.teammates.length > 0;
      if (hasTeammates || r.scoreText) hasDetail = true;
      if (!hasTeammates) continue;
      if (r.isTie) {
        r.detailPrefix = 'Tied with: ';
      } else if (r.teammates.length > 1) {
        r.detailPrefix = 'With partners: ';
      } else {
        r.detailPrefix = 'With partner: ';
      }
    }
    g.hasDetailColumn = hasDetail;
  }
  return groups;
}

