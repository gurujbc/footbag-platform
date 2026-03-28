import { PublicPlayerResultRow, publicPlayers } from '../db/db';
import { NotFoundError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';
import { PageViewModel } from '../types/page';

export interface MemberResultEntry {
  disciplineName: string | null;
  disciplineCategory: string | null;
  teamType: string | null;
  placement: number;
  scoreText: string | null;
  teammates: { name: string; memberHref?: string }[];
}

export interface MemberEventGroup {
  eventKey: string;
  eventHref: string;
  eventTitle: string;
  startDate: string;
  city: string;
  eventCountry: string;
  results: MemberResultEntry[];
}

export interface MemberDetail {
  personId: string;
  personName: string;
  country: string | null;
  eventCount: number;
  placementCount: number;
  bapMember: boolean;
  bapNickname: string | null;
  bapInductionYear: number | null;
  fbhofMember: boolean;
  fbhofInductionYear: number | null;
  eventGroups: MemberEventGroup[];
}

export interface MemberListEntry {
  personId: string;
  personName: string;
  country: string | null;
  eventCount: number | null;
  placementCount: number | null;
  bapMember: boolean;
  fbhofMember: boolean;
}

export interface SummaryFact {
  label: string;
  value: string;
}

export interface MembersLandingContent {
  memberCount: number;
  countryCount: number;
  members: Array<MemberListEntry & { memberHref: string }>;
}

export interface MemberDetailContent {
  personId: string;
  displayName: string;
  honorificNickname?: string;
  country: string | null;
  summaryFacts: SummaryFact[];
  eventGroups: MemberEventGroup[];
}

function buildSummaryFacts(member: MemberDetail): SummaryFact[] {
  const facts: SummaryFact[] = [];
  if (member.country) facts.push({ label: 'Country', value: member.country });
  if (member.eventCount > 0) facts.push({ label: 'Events', value: String(member.eventCount) });
  if (member.placementCount > 0) facts.push({ label: 'Placements', value: String(member.placementCount) });
  if (member.bapMember) facts.push({ label: 'BAP Member since', value: member.bapInductionYear ? String(member.bapInductionYear) : 'Yes' });
  if (member.fbhofMember) facts.push({ label: 'Footbag HOF', value: member.fbhofInductionYear ? String(member.fbhofInductionYear) : 'Yes' });
  return facts;
}

function groupResults(rows: PublicPlayerResultRow[], personId: string): MemberEventGroup[] {
  const eventMap = new Map<string, MemberEventGroup>();

  for (const row of rows) {
    const eventKey = row.event_tag_normalized.startsWith('#')
      ? row.event_tag_normalized.slice(1)
      : row.event_tag_normalized;

    if (!eventMap.has(eventKey)) {
      eventMap.set(eventKey, {
        eventKey,
        eventHref: `/events/${eventKey}`,
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
      const pid = row.participant_person_id ?? null;
      entry.teammates.push({
        name: row.participant_display_name,
        memberHref: pid ? `/members/${pid}` : undefined,
      });
    }
  }

  return Array.from(eventMap.values());
}

export const memberService = {
  getPublicMembersLandingPage(): PageViewModel<MembersLandingContent> {
    const rows = runSqliteRead('listAllMembers', () =>
      publicPlayers.listAll.all(),
    ) as Array<{
      person_id: string;
      person_name: string;
      country: string | null;
      event_count: number | null;
      placement_count: number | null;
      bap_member: number;
      fbhof_member: number;
    }>;

    const members = rows.map(r => ({
      personId:       r.person_id,
      personName:     r.person_name,
      country:        r.country ?? null,
      eventCount:     r.event_count ?? null,
      placementCount: r.placement_count ?? null,
      bapMember:      Boolean(r.bap_member),
      fbhofMember:    Boolean(r.fbhof_member),
      memberHref:     `/members/${r.person_id}`,
    }));

    const countryCount = new Set(
      members.map(m => m.country).filter(c => c && c !== 'Global'),
    ).size;

    return {
      seo: { title: 'Members' },
      page: {
        sectionKey: 'members',
        pageKey: 'members_index',
        title: 'Members',
        intro: 'IFPA Members Area (a work in progress)',
      },
      content: { memberCount: members.length, countryCount, members },
    };
  },

  getHistoricalMemberPage(personId: string): PageViewModel<MemberDetailContent> {
    const row = runSqliteRead('getMemberById', () =>
      publicPlayers.getById.get(personId),
    );

    if (!row) {
      throw new NotFoundError(`Member not found: ${personId}`);
    }

    const p = row as ReturnType<typeof publicPlayers.getById.get> & Record<string, unknown>;

    const resultRows = runSqliteRead('listMemberResults', () =>
      publicPlayers.listResultsByPersonId.all(personId),
    ) as PublicPlayerResultRow[];

    const member: MemberDetail = {
      personId:           String(p['person_id']),
      personName:         String(p['person_name']),
      country:            (p['country'] as string | null) ?? null,
      eventCount:         Number(p['event_count'] ?? 0),
      placementCount:     Number(p['placement_count'] ?? 0),
      bapMember:          Boolean(p['bap_member']),
      bapNickname:        (p['bap_nickname'] as string | null) ?? null,
      bapInductionYear:   (p['bap_induction_year'] as number | null) ?? null,
      fbhofMember:        Boolean(p['fbhof_member']),
      fbhofInductionYear: (p['fbhof_induction_year'] as number | null) ?? null,
      eventGroups:        groupResults(resultRows, personId),
    };

    return {
      seo: { title: member.personName },
      page: {
        sectionKey: 'members',
        pageKey: 'member_history_detail',
        title: member.personName,
        eyebrow: 'Historical member record',
      },
      navigation: {
        contextLinks: [{ label: 'All Members', href: '/members' }],
      },
      content: {
        personId: member.personId,
        displayName: member.personName,
        honorificNickname: member.bapNickname ?? undefined,
        country: member.country,
        summaryFacts: buildSummaryFacts(member),
        eventGroups: member.eventGroups,
      },
    };
  },
};
