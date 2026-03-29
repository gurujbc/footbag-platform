import { account, MemberProfileRow, MemberResultRow } from '../db/db';
import { NotFoundError, ValidationError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';
import { getPhotoStorage } from '../adapters/photoStorageInstance';
import { PageViewModel } from '../types/page';

const MAX_DISPLAY_NAME = 64;
const MAX_BIO = 1000;
const VALID_EMAIL_VISIBILITY = new Set(['private', 'members', 'public']);

export interface OwnProfileContent {
  displayName: string;
  bio: string;
  city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  emailVisibility: string;
  isAdmin: boolean;
  profileBase?: string;
  avatarThumbUrl: string | null;
}

export interface ProfileEditContent extends OwnProfileContent {
  memberId: string;
  error?: string;
}

export interface PublicProfileEventResult {
  disciplineName: string | null;
  placement: number;
  scoreText: string | null;
}

export interface PublicProfileEventGroup {
  eventHref: string;
  eventTitle: string;
  startDate: string;
  city: string;
  eventCountry: string;
  results: PublicProfileEventResult[];
}

export interface PublicProfileContent {
  displayName: string;
  city: string | null;
  country: string | null;
  bio: string;
  avatarThumbUrl: string | null;
  hofMember: boolean;
  bapMember: boolean;
  eventGroups: PublicProfileEventGroup[];
}

export interface ProfileEditInput {
  displayName: string;
  bio: string;
  city: string;
  region: string;
  country: string;
  phone: string;
  emailVisibility: string;
}

function normalizeText(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function rowToContent(row: MemberProfileRow): OwnProfileContent {
  const storage = getPhotoStorage();
  return {
    displayName:     row.display_name,
    bio:             row.bio,
    city:            row.city,
    region:          row.region,
    country:         row.country,
    phone:           row.phone,
    emailVisibility: row.email_visibility,
    isAdmin:         Boolean(row.is_admin),
    avatarThumbUrl:  row.avatar_thumb_key ? storage.constructURL(row.avatar_thumb_key) : null,
  };
}

function fetchMemberBySlug(slug: string): MemberProfileRow {
  const row = runSqliteRead('getOwnProfile', () =>
    account.findMemberBySlug.get(slug),
  ) as MemberProfileRow | undefined;
  if (!row) throw new NotFoundError(`Member not found: ${slug}`);
  return row;
}

export const memberService = {
  getOwnProfile(slug: string): PageViewModel<OwnProfileContent> {
    const row = fetchMemberBySlug(slug);
    return {
      seo:  { title: 'My Profile' },
      page: { sectionKey: 'members', pageKey: 'member_profile', title: 'My Profile' },
      navigation: {
        contextLinks: [{ label: 'Edit Profile', href: `/members/${slug}/edit`, variant: 'outline' }],
      },
      content: { ...rowToContent(row), profileBase: `/members/${slug}` },
    };
  },

  /**
   * Public read-only profile for HoF/BAP members. No PII, no edit links.
   * Returns null if the member is not HoF/BAP (caller should 404 or require auth).
   */
  getPublicProfile(slug: string): PageViewModel<PublicProfileContent> | null {
    const row = fetchMemberBySlug(slug);
    const isHof = Boolean(row.is_hof);
    const isBap = Boolean(row.is_bap);
    if (!isHof && !isBap) return null;

    const storage = getPhotoStorage();

    // Fetch competitive results linked to this member.
    const resultRows = runSqliteRead('listResultsByMemberId', () =>
      account.listResultsByMemberId.all(row.id),
    ) as MemberResultRow[];

    const eventMap = new Map<string, PublicProfileEventGroup>();
    for (const r of resultRows) {
      let group = eventMap.get(r.event_id);
      if (!group) {
        const tagNorm = r.event_tag_normalized;
        group = {
          eventHref:    `/events/${tagNorm.replace(/^#/, '')}`,
          eventTitle:   r.event_title,
          startDate:    r.start_date,
          city:         r.city,
          eventCountry: r.event_country,
          results:      [],
        };
        eventMap.set(r.event_id, group);
      }
      group.results.push({
        disciplineName: r.discipline_name,
        placement:      r.placement,
        scoreText:      r.score_text,
      });
    }

    return {
      seo:  { title: row.display_name },
      page: { sectionKey: 'members', pageKey: 'member_public_profile', title: row.display_name },
      navigation: { contextLinks: [] },
      content: {
        displayName:    row.display_name,
        city:           row.city,
        country:        row.country,
        bio:            row.bio,
        avatarThumbUrl: row.avatar_thumb_key ? storage.constructURL(row.avatar_thumb_key) : null,
        hofMember:      isHof,
        bapMember:      isBap,
        eventGroups:    Array.from(eventMap.values()),
      },
    };
  },

  getProfileEditPage(slug: string, error?: string): PageViewModel<ProfileEditContent> {
    const row = fetchMemberBySlug(slug);
    return {
      seo:  { title: 'Edit Profile' },
      page: { sectionKey: 'members', pageKey: 'member_profile_edit', title: 'Edit Profile' },
      navigation: {
        contextLinks: [{ label: 'Back to Profile', href: `/members/${slug}` }],
      },
      content: { ...rowToContent(row), memberId: slug, error },
    };
  },

  updateOwnProfile(slug: string, input: ProfileEditInput): void {
    const row = fetchMemberBySlug(slug);
    const displayName = normalizeText(input.displayName);
    const bio         = normalizeText(input.bio);
    const city        = normalizeText(input.city) || null;
    const region      = normalizeText(input.region) || null;
    const country     = normalizeText(input.country) || null;
    const phone       = normalizeText(input.phone) || null;
    const emailVis    = VALID_EMAIL_VISIBILITY.has(input.emailVisibility)
      ? input.emailVisibility
      : 'private';

    if (!displayName) {
      throw new ValidationError('Display name is required.');
    }
    if (displayName.length > MAX_DISPLAY_NAME) {
      throw new ValidationError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
    }
    if (bio.length > MAX_BIO) {
      throw new ValidationError(`Bio must be ${MAX_BIO} characters or fewer.`);
    }

    const now = new Date().toISOString();
    account.updateMemberProfile.run(
      displayName,
      displayName.toLowerCase(),
      bio,
      city,
      region,
      country,
      phone,
      emailVis,
      now,
      row.id,
    );
  },
};
