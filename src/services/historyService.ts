import { PublicPlayerResultRow, FreestyleRecordRow, PlayerCareerStatRow, PlayerPartnerRow,
         publicPlayers, freestyleRecords, account, legacyClaim } from '../db/db';
import { NotFoundError } from './serviceErrors';
import { personHref } from './personLink';
import { runSqliteRead } from './sqliteRetry';
import { getPhotoStorageAdapter } from '../adapters/photoStorageAdapter';
import { PageViewModel } from '../types/page';
import { groupPlayerResults } from './playerShaping';
import type { PlayerEventGroup, PlayerHeroData } from '../types/playerProfile';
import { FreestyleRecordViewModel, shapeFreestyleRecord } from './freestyleRecordShaping';
import { surnameKey } from './identityAccessService';

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

interface CareerCategoryStat {
  category: string;
  label: string;
  appearances: number;
  wins: number;
  podiums: number;
}

interface PartnershipViewModel {
  partnerName: string;
  partnerHref: string | null;
  category: string;
  categoryLabel: string;
  appearances: number;
  wins: number;
  yearSpan: string | null;
}

export interface HistoryDetailContent {
  personId: string;
  displayName: string;
  hofMember: boolean;
  bapMember: boolean;
  bapNickname: string | null;
  avatarThumbUrl: string | null;
  heroData: PlayerHeroData;
  careerStats: CareerCategoryStat[];
  hasCareerStats: boolean;
  hasCompetitionResults: boolean;
  hasRecords: boolean;
  eventGroups: PlayerEventGroup[];
  freestyleRecords: FreestyleRecordViewModel[];
  partnerships: PartnershipViewModel[];
  hasPartnerships: boolean;
  canClaim: boolean;
  claimHref: string | null;
}

export type HistoryDetailResult =
  | { action: 'redirect'; href: string }
  | { action: 'requireAuth' }
  | { action: 'render'; vm: PageViewModel<HistoryDetailContent> };

export const historyService = {
  getHistoricalPlayerPage(
    personId: string,
    isAuthenticated: boolean,
    viewerMemberId?: string,
  ): HistoryDetailResult {
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
      ) as { avatar_thumb_key: string | null; avatar_media_id: string | null } | undefined;
      if (memberRow?.avatar_thumb_key) {
        const base = getPhotoStorageAdapter().constructURL(memberRow.avatar_thumb_key);
        avatarThumbUrl = memberRow.avatar_media_id
          ? `${base}?v=${encodeURIComponent(memberRow.avatar_media_id)}`
          : base;
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

    // Career stats by discipline category
    const CATEGORY_LABELS: Record<string, string> = {
      freestyle: 'Freestyle', net: 'Net', golf: 'Golf', sideline: 'Sideline',
    };
    const careerStatRows = runSqliteRead('listCareerStatsByCategory', () =>
      publicPlayers.listCareerStatsByCategory.all(personId),
    ) as PlayerCareerStatRow[];
    const careerStats: CareerCategoryStat[] = careerStatRows
      .filter(r => r.category && CATEGORY_LABELS[r.category])
      .map(r => ({
        category:    r.category,
        label:       CATEGORY_LABELS[r.category] ?? r.category,
        appearances: r.appearances,
        wins:        r.wins,
        podiums:     r.podiums,
      }));

    // Top partnerships
    const partnerRows = runSqliteRead('listTopPartnersByPersonId', () =>
      publicPlayers.listTopPartnersByPersonId.all(personId),
    ) as PlayerPartnerRow[];
    const partnerships: PartnershipViewModel[] = partnerRows.map(r => {
      const first = r.first_year;
      const last = r.last_year;
      let yearSpan: string | null = null;
      if (first !== null && last !== null) {
        yearSpan = first === last ? String(first) : `${first}–${last}`;
      }
      return {
        partnerName:   r.partner_name,
        partnerHref:   personHref(r.partner_member_slug, r.partner_person_id),
        category:      r.category,
        categoryLabel: CATEGORY_LABELS[r.category] ?? r.category,
        appearances:   r.appearances,
        wins:          r.wins,
        yearSpan,
      };
    });

    // Claim eligibility for the authenticated viewer (scenarios D and E).
    // Show the CTA when: viewer is signed in, viewer has no HP linked yet,
    // HP is unclaimed (the `linkedRow` above already redirected claimed HPs),
    // and the viewer's real_name surname matches the HP's person_name surname.
    let canClaim = false;
    let claimHref: string | null = null;
    if (viewerMemberId) {
      const viewerRow = runSqliteRead('findClaimingMemberForHpCta', () =>
        legacyClaim.findClaimingMember.get(viewerMemberId),
      ) as { id: string; real_name: string; historical_person_id: string | null } | undefined;
      if (viewerRow
        && !viewerRow.historical_person_id
        && surnameKey(viewerRow.real_name) === surnameKey(player.personName)
      ) {
        canClaim = true;
        claimHref = `/history/${encodeURIComponent(player.personId)}/claim`;
      }
    }

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
          bapNickname:   player.bapNickname,
          avatarThumbUrl,
          heroData,
          careerStats,
          hasCareerStats:        careerStats.length > 0,
          hasCompetitionResults: player.eventGroups.length > 0,
          hasRecords:            freestyleRows.length > 0,
          eventGroups:           player.eventGroups,
          freestyleRecords:      freestyleRows.map(shapeFreestyleRecord),
          partnerships,
          hasPartnerships:       partnerships.length > 0,
          canClaim,
          claimHref,
        },
      },
    };
  },
};
