import { PublicPlayerResultRow, FreestyleRecordRow, publicPlayers, freestyleRecords, account } from '../db/db';
import { NotFoundError } from './serviceErrors';
import { personHref } from './personLink';
import { runSqliteRead } from './sqliteRetry';
import { getPhotoStorage } from '../adapters/photoStorageInstance';
import { PageViewModel } from '../types/page';
import { groupPlayerResults } from './playerShaping';
import type { PlayerEventGroup, PlayerHeroData } from '../types/playerProfile';
import { FreestyleRecordViewModel, shapeFreestyleRecord } from './freestyleService';

interface HistoricalPlayer {
  personId: string;
  personName: string;
  country: string | null;
  eventCount: number;
  placementCount: number;
  bapMember: boolean;
  bapNickname: string | null;
  bapInductionYear: number | null;
  hofMember: boolean;
  hofInductionYear: number | null;
  eventGroups: PlayerEventGroup[];
}

export interface HistoryDetailContent {
  personId: string;
  displayName: string;
  hofMember: boolean;
  bapMember: boolean;
  avatarThumbUrl: string | null;
  heroData: PlayerHeroData;
  eventGroups: PlayerEventGroup[];
  freestyleRecords: FreestyleRecordViewModel[];
}

export type HistoryDetailResult =
  | { action: 'redirect'; href: string }
  | { action: 'requireAuth' }
  | { action: 'render'; vm: PageViewModel<HistoryDetailContent> };

export const historyService = {
  getHistoricalPlayerPage(personId: string, isAuthenticated: boolean): HistoryDetailResult {
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
      hofMember:        Boolean(p['hof_member']),
      hofInductionYear: (p['hof_induction_year'] as number | null) ?? null,
      eventGroups:        groupPlayerResults(resultRows, { selfPersonId: personId }),
    };

    const freestyleRows = runSqliteRead('listFreestyleRecordsByPersonId', () =>
      freestyleRecords.listByPersonId.all(personId),
    ) as FreestyleRecordRow[];

    // Look up linked member account (if any) for member profile link and avatar.
    const linkedRow = runSqliteRead('findLinkedMemberSlug', () =>
      publicPlayers.findLinkedMemberSlug.get(personId),
    ) as { slug: string } | undefined;

    const memberHref = personHref(linkedRow?.slug ?? null, null);

    // Linked member: redirect to their profile.
    if (memberHref) {
      return { action: 'redirect', href: memberHref };
    }

    // Non-public-honor person: require authentication.
    const isPublicHonor = player.hofMember || player.bapMember;
    if (!isPublicHonor && !isAuthenticated) {
      return { action: 'requireAuth' };
    }

    let avatarThumbUrl: string | null = null;

    if (linkedRow?.slug) {
      const memberRow = runSqliteRead('findMemberBySlugForAvatar', () =>
        account.findMemberBySlug.get(linkedRow.slug),
      ) as { avatar_thumb_key: string | null } | undefined;
      if (memberRow?.avatar_thumb_key) {
        avatarThumbUrl = getPhotoStorage().constructURL(memberRow.avatar_thumb_key);
      }
    }

    const heroData: PlayerHeroData = {
      displayName:       player.personName,
      honorificNickname: player.bapNickname ?? undefined,
      isHof:             player.hofMember,
      isBap:             player.bapMember,
      hofInductionYear:  player.hofInductionYear ?? undefined,
      bapInductionYear:  player.bapInductionYear ?? undefined,
      country:           player.country,
      isHistoricalOnly: true,
    };

    return {
      action: 'render',
      vm: {
        seo: { title: `Player ${player.personName}` },
        page: {
          sectionKey: 'history',
          pageKey:    'history_player_detail',
          title:      player.personName,
        },
        navigation: {
          contextLinks: [{ label: 'Members', href: '/members' }],
        },
        content: {
          personId:      player.personId,
          displayName:   player.personName,
          hofMember:     player.hofMember,
          bapMember:     player.bapMember,
          avatarThumbUrl,
          heroData,
          eventGroups:      player.eventGroups,
          freestyleRecords: freestyleRows.map(shapeFreestyleRecord),
        },
      },
    };
  },
};
