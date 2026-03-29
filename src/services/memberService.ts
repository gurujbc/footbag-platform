import { account, slugRedirects, MemberProfileRow, MemberResultRow } from '../db/db';
import { generateUniqueSlug, slugify } from './identityAccessService';
import { NotFoundError, ValidationError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';
import { getPhotoStorage } from '../adapters/photoStorageInstance';
import { PageViewModel } from '../types/page';

const MAX_DISPLAY_NAME = 64;
const MAX_BIO = 1000;
const VALID_EMAIL_VISIBILITY = new Set(['private', 'members', 'public']);

export interface ProfileEventResult {
  disciplineName: string | null;
  placement: number;
  scoreText: string | null;
}

export interface ProfileEventGroup {
  eventHref: string;
  eventTitle: string;
  startDate: string;
  city: string;
  eventCountry: string;
  results: ProfileEventResult[];
}

export interface OwnProfileContent {
  displayName: string;
  bio: string;
  city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  emailVisibility: string;
  isAdmin: boolean;
  isHof: boolean;
  isBap: boolean;
  hasLegacyLink: boolean;
  historicalPersonName: string | null;
  profileBase?: string;
  avatarThumbUrl: string | null;
  eventGroups?: ProfileEventGroup[];
}

export interface ProfileEditContent extends OwnProfileContent {
  memberKey: string;
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
  historicalPersonName: string | null;
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
    isHof:           Boolean(row.is_hof),
    isBap:           Boolean(row.is_bap),
    hasLegacyLink:   row.legacy_member_id !== null,
    historicalPersonName: row.historical_person_name &&
      row.historical_person_name.toLowerCase() !== row.display_name.toLowerCase()
      ? row.historical_person_name
      : null,
    avatarThumbUrl:  row.avatar_thumb_key ? storage.constructURL(row.avatar_thumb_key) : null,
  };
}

function fetchEventGroups(row: MemberProfileRow): ProfileEventGroup[] {
  // Try direct member_id link first, then legacy_member_id chain.
  let resultRows = runSqliteRead('listResultsByMemberId', () =>
    account.listResultsByMemberId.all(row.id),
  ) as MemberResultRow[];

  if (resultRows.length === 0 && row.legacy_member_id) {
    resultRows = runSqliteRead('listResultsByLegacyMemberId', () =>
      account.listResultsByLegacyMemberId.all(row.legacy_member_id),
    ) as MemberResultRow[];
  }

  const eventMap = new Map<string, ProfileEventGroup>();
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
  return Array.from(eventMap.values());
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
      content: { ...rowToContent(row), profileBase: `/members/${slug}`, eventGroups: fetchEventGroups(row) },
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
        historicalPersonName: row.historical_person_name &&
          row.historical_person_name.toLowerCase() !== row.display_name.toLowerCase()
          ? row.historical_person_name
          : null,
        eventGroups:    fetchEventGroups(row),
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
      content: { ...rowToContent(row), memberKey: slug, error },
    };
  },

  updateOwnProfile(slug: string, input: ProfileEditInput): { newSlug: string } {
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

    // Regenerate slug if display name changed and would produce a different slug.
    let newSlug = slug;
    const candidateBase = slugify(displayName);
    const currentBase = row.slug ? slugify(row.display_name) : null;
    if (candidateBase && currentBase && candidateBase !== currentBase) {
      newSlug = generateUniqueSlug(displayName);
      // Delete any redirect that would collide with the new slug.
      slugRedirects.deleteBySlug.run(newSlug);
      // Store the old slug as a redirect.
      if (row.slug) {
        slugRedirects.insert.run(row.slug, row.id, now);
      }
      // Update the member's slug.
      account.updateMemberSlug.run(newSlug, now, row.id);
    }

    return { newSlug };
  },
};
