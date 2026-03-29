import { PublicPlayerResultRow, publicPlayers, account } from '../db/db';
import { NotFoundError } from './serviceErrors';
import { personHref } from './personLink';
import { runSqliteRead } from './sqliteRetry';
import { getPhotoStorage } from '../adapters/photoStorageInstance';
import { PageViewModel } from '../types/page';

export interface HistoryResultEntry {
  disciplineName: string | null;
  disciplineCategory: string | null;
  teamType: string | null;
  placement: number;
  scoreText: string | null;
  teammates: { name: string; playerHref?: string }[];
}

export interface HistoryEventGroup {
  eventKey: string;
  eventHref: string;
  eventTitle: string;
  startDate: string;
  city: string;
  eventCountry: string;
  results: HistoryResultEntry[];
}

export interface HistoricalPlayer {
  personId: string;
  personName: string;
  country: string | null;
  eventCount: number;
  placementCount: number;
  bapMember: boolean;
  bapNickname: string | null;
  bapInductionYear: number | null;
  hofMember: boolean;
  fbhofInductionYear: number | null;
  eventGroups: HistoryEventGroup[];
}

export interface HistoricalPlayerListEntry {
  personId: string;
  personName: string;
  country: string | null;
  eventCount: number | null;
  placementCount: number | null;
  bapMember: boolean;
  hofMember: boolean;
}

export interface SummaryFact {
  label: string;
  value: string;
}

export interface HistoryLandingContent {
  playerCount: number;
  players: Array<HistoricalPlayerListEntry & { playerHref: string }>;
}

export interface HistoryDetailContent {
  personId: string;
  displayName: string;
  honorificNickname?: string;
  hofMember: boolean;
  bapMember: boolean;
  memberHref: string | null;
  avatarThumbUrl: string | null;
  summaryFacts: SummaryFact[];
  eventGroups: HistoryEventGroup[];
}

function buildSummaryFacts(player: HistoricalPlayer): SummaryFact[] {
  const facts: SummaryFact[] = [];
  if (player.eventCount > 0) facts.push({ label: 'Events', value: String(player.eventCount) });
  if (player.placementCount > 0) facts.push({ label: 'Placements', value: String(player.placementCount) });
  if (player.bapMember) facts.push({ label: 'BAP Member since', value: player.bapInductionYear ? String(player.bapInductionYear) : 'Yes' });
  if (player.hofMember) facts.push({ label: 'Footbag HOF', value: player.fbhofInductionYear ? String(player.fbhofInductionYear) : 'Yes' });
  return facts;
}

function groupResults(rows: PublicPlayerResultRow[], personId: string): HistoryEventGroup[] {
  const eventMap = new Map<string, HistoryEventGroup>();

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
        eventCountry: row.event_country,
        results:      [],
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
      };
      group.results.push(entry);
    }

    const isSelf = row.participant_person_id === personId;
    if (!isSelf && !entry.teammates.some(t => t.name === row.participant_display_name)) {
      entry.teammates.push({
        name:       row.participant_display_name,
        playerHref: personHref(row.participant_member_slug, row.participant_person_id) ?? undefined,
      });
    }
  }

  return Array.from(eventMap.values());
}

export const historyService = {
  getHistoryLandingPage(): PageViewModel<HistoryLandingContent> {
    const rows = runSqliteRead('listAllHistoricalPlayers', () =>
      publicPlayers.listAll.all(),
    ) as Array<{
      person_id: string;
      person_name: string;
      country: string | null;
      event_count: number | null;
      placement_count: number | null;
      bap_member: number;
      fbhof_member: number;
      linked_member_slug: string | null;
    }>;

    const players = rows.map(r => ({
      personId:       r.person_id,
      personName:     r.person_name,
      country:        r.country ?? null,
      eventCount:     r.event_count ?? null,
      placementCount: r.placement_count ?? null,
      bapMember:      Boolean(r.bap_member),
      hofMember:      Boolean(r.fbhof_member),
      playerHref:     personHref(r.linked_member_slug, r.person_id)!,
    }));

    return {
      seo: { title: 'Historical Players' },
      page: {
        sectionKey: 'history',
        pageKey:    'history_index',
        title:      'Historical Players',
        intro:      'Competitive footbag players from our legacy event results database.',
      },
      content: { playerCount: players.length, players },
    };
  },

  getHistoricalPlayerPage(personId: string): PageViewModel<HistoryDetailContent> {
    const row = runSqliteRead('getHistoricalPlayerById', () =>
      publicPlayers.getById.get(personId),
    );

    if (!row) {
      throw new NotFoundError(`Historical player not found: ${personId}`);
    }

    const p = row as ReturnType<typeof publicPlayers.getById.get> & Record<string, unknown>;

    const resultRows = runSqliteRead('listHistoricalPlayerResults', () =>
      publicPlayers.listResultsByPersonId.all(personId),
    ) as PublicPlayerResultRow[];

    const player: HistoricalPlayer = {
      personId:           String(p['person_id']),
      personName:         String(p['person_name']),
      country:            (p['country'] as string | null) ?? null,
      eventCount:         Number(p['event_count'] ?? 0),
      placementCount:     Number(p['placement_count'] ?? 0),
      bapMember:          Boolean(p['bap_member']),
      bapNickname:        (p['bap_nickname'] as string | null) ?? null,
      bapInductionYear:   (p['bap_induction_year'] as number | null) ?? null,
      hofMember:        Boolean(p['fbhof_member']),
      fbhofInductionYear: (p['fbhof_induction_year'] as number | null) ?? null,
      eventGroups:        groupResults(resultRows, personId),
    };

    // Look up linked member account (if any) for member profile link and avatar.
    const linkedRow = runSqliteRead('findLinkedMemberSlug', () =>
      publicPlayers.findLinkedMemberSlug.get(personId),
    ) as { slug: string } | undefined;

    let memberHref: string | null = personHref(linkedRow?.slug ?? null, null);
    let avatarThumbUrl: string | null = null;

    if (linkedRow?.slug) {
      // Look up the member's avatar via the account query.
      const memberRow = runSqliteRead('findMemberBySlugForAvatar', () =>
        account.findMemberBySlug.get(linkedRow.slug),
      ) as { avatar_thumb_key: string | null } | undefined;
      if (memberRow?.avatar_thumb_key) {
        avatarThumbUrl = getPhotoStorage().constructURL(memberRow.avatar_thumb_key);
      }
    }

    return {
      seo: { title: player.personName },
      page: {
        sectionKey: 'history',
        pageKey:    'history_player_detail',
        title:      player.personName,
        eyebrow:    (player.hofMember || player.bapMember) ? undefined : 'Historical player record',
      },
      navigation: {
        contextLinks: [{ label: 'Historical Players', href: '/history' }],
      },
      content: {
        personId:          player.personId,
        displayName:       player.personName,
        honorificNickname: player.bapNickname ?? undefined,
        hofMember:         player.hofMember,
        bapMember:         player.bapMember,
        memberHref,
        avatarThumbUrl,
        summaryFacts:      buildSummaryFacts(player),
        eventGroups:       player.eventGroups,
      },
    };
  },
};
