import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { auth, registration, legacyClaim, MemberAuthRow, LegacyPlaceholderRow, AlreadyClaimedRow, HistoricalPersonClaimRow } from '../db/db';
import { transaction } from '../db/db';
import { ValidationError } from './serviceErrors';

export interface ClaimLookupResult {
  source: 'historical_person' | 'imported_placeholder';
  id: string;
  displayName: string;
  legacyMemberId: string | null;
  country: string | null;
  isHof: boolean;
  isBap: boolean;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME = 64;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Generate a URL-safe slug from a display name.
 * Rules: lowercase, spaces become _, strip non-alphanumeric/underscore,
 * collapse consecutive underscores, trim leading/trailing underscores.
 */
export function slugify(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Generate a unique slug. Appends _2, _3, etc. on conflict.
 */
export function generateUniqueSlug(displayName: string): string {
  const base = slugify(displayName);
  if (!base) {
    // Fallback for names that produce empty slugs (e.g. all non-ASCII).
    const fallback = `member_${randomUUID().slice(0, 8)}`;
    return fallback;
  }

  const exists = (slug: string): boolean =>
    (registration.checkSlugExists.get(slug) as { exists_flag: number } | undefined) !== undefined;

  if (!exists(base)) return base;

  let suffix = 2;
  while (exists(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export interface RegisteredMember {
  id: string;
  slug: string;
  displayName: string;
  isAdmin: number;
}

/**
 * Verify member credentials against the database.
 *
 * Returns the member row on success, null on any failure (wrong password,
 * not found, unverified, deceased). Fall-through to the env-var stub is the
 * caller's responsibility and must only happen when this returns null AND the
 * email did not match any DB row.
 */
async function verifyMemberCredentials(
  email: string,
  password: string,
): Promise<MemberAuthRow | null> {
  const normalized = normalizeEmail(email);
  const member = auth.findMemberByEmail.get(normalized) as MemberAuthRow | undefined;

  if (!member) {
    return null;
  }

  const valid = await argon2.verify(member.password_hash, password);
  if (!valid) {
    return null;
  }

  const now = new Date().toISOString();
  auth.updateMemberLastLogin.run(now, now, member.id);

  return member;
}

/**
 * Register a new member account.
 *
 * Validates input, hashes password, generates a unique slug, and inserts the
 * member row. Email is auto-verified in the current dev phase (real email
 * verification is a later-phase item).
 */
/**
 * Extract the surname (last word) from a name after stripping common suffixes.
 */
function extractSurname(name: string): string {
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);
  const words = name.trim().split(/\s+/);
  // Strip trailing suffixes
  while (words.length > 1 && suffixes.has(words[words.length - 1].replace(/\.$/, '').toLowerCase())) {
    words.pop();
  }
  return words[words.length - 1] || '';
}

/**
 * Strip accents for comparison (Unicode NFD decomposition, remove combining marks).
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Validate a full legal name for registration.
 * Rules: required, 2-64 chars, at least two words, at least one word 2+ chars, no digits.
 */
function validateRealName(name: string): void {
  if (!name) {
    throw new ValidationError('Full legal name is required.');
  }
  if (name.length > MAX_DISPLAY_NAME) {
    throw new ValidationError(`Full legal name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  }
  if (/\d/.test(name)) {
    throw new ValidationError('Full legal name must not contain digits.');
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    throw new ValidationError('Full legal name must include at least a first name and last name.');
  }
  if (!words.some(w => w.length >= 2)) {
    throw new ValidationError('Full legal name must include at least one name that is two or more characters.');
  }
}

/**
 * Validate that a display name shares a surname with the real name.
 */
function validateDisplayNameSurname(displayName: string, realName: string): void {
  const displaySurname = stripAccents(extractSurname(displayName)).toLowerCase();
  const realSurname = stripAccents(extractSurname(realName)).toLowerCase();
  if (displaySurname !== realSurname) {
    throw new ValidationError('Display name must include your last name.');
  }
}

async function registerMember(
  email: string,
  password: string,
  confirmPassword: string,
  realName: string,
  displayName: string,
): Promise<RegisteredMember> {
  const trimmedRealName = realName.trim();
  const trimmedDisplayName = displayName.trim() || trimmedRealName;
  const trimmedEmail = email.trim();
  const normalizedEmail = normalizeEmail(trimmedEmail);

  validateRealName(trimmedRealName);

  if (trimmedDisplayName.length > MAX_DISPLAY_NAME) {
    throw new ValidationError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  }
  if (trimmedDisplayName !== trimmedRealName) {
    validateDisplayNameSurname(trimmedDisplayName, trimmedRealName);
  }

  if (!trimmedEmail) {
    throw new ValidationError('Email address is required.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }

  const emailExists = registration.checkEmailExists.get(normalizedEmail) as { exists_flag: number } | undefined;
  if (emailExists) {
    throw new ValidationError('An account with this email address already exists.');
  }

  const id = `member_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const slug = generateUniqueSlug(trimmedDisplayName);
  const hash = await argon2.hash(password);
  const now = new Date().toISOString();

  registration.insertMember.run(
    id,
    slug,
    trimmedEmail,
    normalizedEmail,
    now,   // email_verified_at (auto-verify in dev)
    hash,
    now,   // password_changed_at
    trimmedRealName,                    // real_name
    trimmedDisplayName,                 // display_name
    trimmedDisplayName.toLowerCase(),   // display_name_normalized
    now,   // created_at
    now,   // updated_at
  );

  return { id, slug, displayName: trimmedDisplayName, isAdmin: 0 };
}

/**
 * Look up a claimable legacy record by identifier.
 *
 * Searches historical_persons (by legacy_member_id) first, then imported
 * member placeholders (by legacy_member_id, legacy_user_id, or legacy_email).
 *
 * EARLY-TEST SHORTCUT: This version processes claims immediately without email
 * verification. The production version will require the member to prove control
 * of the placeholder's legacy_email before the merge executes.
 */
function lookupLegacyClaim(
  requestingMemberId: string,
  identifier: string,
): ClaimLookupResult | null {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new ValidationError('Please enter a legacy identifier.');
  }

  const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
  if (already) {
    throw new ValidationError('Your account is already linked to a legacy record.');
  }

  // Search historical_persons by legacy_member_id first.
  const hp = legacyClaim.findHistoricalPersonByLegacyId.get(trimmed) as HistoricalPersonClaimRow | undefined;
  if (hp) {
    // Check if another member already claimed this legacy_member_id.
    const claimedBy = legacyClaim.checkLegacyIdAlreadyClaimed.get(hp.legacy_member_id) as { id: string } | undefined;
    if (claimedBy) {
      return null; // Already claimed by someone; don't reveal who.
    }
    return {
      source: 'historical_person',
      id: hp.legacy_member_id,
      displayName: hp.person_name,
      legacyMemberId: hp.legacy_member_id,
      country: hp.country,
      isHof: Boolean(hp.fbhof_member),
      isBap: Boolean(hp.bap_member),
    };
  }

  // Fall back to imported member placeholders.
  const mp = legacyClaim.findPlaceholderByIdentifier.get(trimmed, trimmed, trimmed) as LegacyPlaceholderRow | undefined;
  if (mp) {
    return {
      source: 'imported_placeholder',
      id: mp.id,
      displayName: mp.display_name,
      legacyMemberId: mp.legacy_member_id,
      country: mp.country,
      isHof: Boolean(mp.is_hof),
      isBap: Boolean(mp.is_bap),
    };
  }

  return null;
}

/**
 * Execute the legacy account claim.
 *
 * For historical_person claims: sets legacy_member_id on the active member.
 * For imported_placeholder claims: soft-deletes the placeholder and transfers fields.
 */
function completeClaim(requestingMemberId: string, source: string, targetId: string): void {
  transaction(() => {
    const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
    if (already) {
      throw new ValidationError('Your account is already linked to a legacy record.');
    }

    const now = new Date().toISOString();

    if (source === 'historical_person') {
      // Historical person claim: just set legacy_member_id on the active member.
      const hp = legacyClaim.findHistoricalPersonByLegacyId.get(targetId) as HistoricalPersonClaimRow | undefined;
      if (!hp) {
        throw new ValidationError('The legacy record is no longer available for claim.');
      }
      const claimedBy = legacyClaim.checkLegacyIdAlreadyClaimed.get(hp.legacy_member_id) as { id: string } | undefined;
      if (claimedBy) {
        throw new ValidationError('This legacy record has already been claimed by another account.');
      }
      // Set legacy_member_id and OR-merge honor flags on the active member.
      legacyClaim.transferLegacyFields.run(
        hp.legacy_member_id,  // legacy_member_id
        null,                 // legacy_user_id (COALESCE — nothing to transfer)
        null,                 // legacy_email (COALESCE — nothing to transfer)
        '',                   // bio (empty — no fill)
        null,                 // birth_date
        null,                 // street_address
        null,                 // postal_code
        null,                 // city
        null,                 // region
        hp.country,           // country (fill if empty/null)
        null,                 // ifpa_join_date
        hp.fbhof_member,      // is_hof (MAX)
        hp.bap_member,        // is_bap (MAX)
        now,                  // updated_at
        requestingMemberId,   // WHERE id = ?
      );
    } else if (source === 'imported_placeholder') {
      const placeholder = legacyClaim.findPlaceholderById.get(targetId) as LegacyPlaceholderRow | undefined;
      if (!placeholder) {
        throw new ValidationError('The legacy record is no longer available for claim.');
      }
      // Soft-delete placeholder FIRST to free the legacy_member_id unique constraint.
      legacyClaim.softDeletePlaceholder.run(now, now, targetId);
      // Transfer legacy fields to the active member.
      legacyClaim.transferLegacyFields.run(
        placeholder.legacy_member_id,
        placeholder.legacy_user_id,
        placeholder.legacy_email,
        placeholder.bio,
        placeholder.birth_date,
        placeholder.street_address,
        placeholder.postal_code,
        placeholder.city,
        placeholder.region,
        placeholder.country,
        placeholder.ifpa_join_date,
        placeholder.is_hof,
        placeholder.is_bap,
        now,
        requestingMemberId,
      );
    } else {
      throw new ValidationError('Invalid claim source.');
    }
  });
}

export const identityAccessService = { verifyMemberCredentials, registerMember, lookupLegacyClaim, completeClaim };
