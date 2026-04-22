import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { auth, registration, legacyClaim, legacyMembers, MemberAuthRow, LegacyMemberRow, AlreadyClaimedRow, HistoricalPersonClaimRow } from '../db/db';
import { transaction } from '../db/db';
import { accountTokenService } from './accountTokenService';
import { getCommunicationService } from './communicationService';
import { hit as rateLimitHit } from './rateLimitService';
import { readIntConfig } from './configReader';
import { config } from '../config/env';
import { RateLimitedError, ValidationError } from './serviceErrors';

const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME = 64;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

import { slugify } from './slugify';

/**
 * Generate a unique slug. Appends _2, _3, etc. on conflict.
 */
function generateUniqueSlug(displayName: string): string {
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
  passwordVersion: number;
}

export interface RegisterResult {
  /**
   * Always redirect to /register/check-email regardless of which branch ran.
   * Duplicate-email registrations silently take the 'silent_duplicate' branch
   * to prevent account enumeration.
   */
  status: 'registered' | 'silent_duplicate';
}

/**
 * Verify member credentials against the database.
 *
 * Returns the member row on success, null on any failure (wrong password,
 * not found, unverified, deceased).
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
 * Attempt a login: rate-limit by normalized email + client IP, then delegate
 * to credential verification. Throws RateLimitedError when the bucket is
 * exceeded; returns null on invalid credentials.
 */
async function attemptLogin(
  email: string,
  password: string,
  ip: string,
): Promise<MemberAuthRow | null> {
  const normalized = normalizeEmail(email);
  const maxAttempts = readIntConfig('login_rate_limit_max_attempts', 10);
  const windowMinutes = readIntConfig('login_rate_limit_window_minutes', 15);
  const rl = rateLimitHit(`login:${normalized}:${ip}`, maxAttempts, windowMinutes);
  if (!rl.allowed) {
    throw new RateLimitedError(
      'Too many failed login attempts. Please try again later.',
      rl.retryAfterSeconds,
    );
  }
  return verifyMemberCredentials(email, password);
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
 * Exported so other services (e.g., historyService) can reuse the same rule.
 */
export function extractSurname(name: string): string {
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
export function stripAccents(s: string): string {
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
): Promise<RegisterResult> {
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
    // Anti-enumeration: render the same check-email page for an
    // already-registered address. We do not re-issue a token here;
    // the existing verified account is unaffected.
    return { status: 'silent_duplicate' };
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
    null,  // email_verified_at — NULL until verify link consumed
    hash,
    now,   // password_changed_at
    trimmedRealName,                    // real_name
    trimmedDisplayName,                 // display_name
    trimmedDisplayName.toLowerCase(),   // display_name_normalized
    now,   // created_at
    now,   // updated_at
  );

  await issueAndEnqueueVerifyEmail(id, trimmedEmail);
  return { status: 'registered' };
}

export interface VerifyEmailResult {
  memberId: string;
  slug: string;
  passwordVersion: number;
  isAdmin: number;
  legacyMatch: LegacyAccountLookupResult | null;
}

async function issueAndEnqueueVerifyEmail(memberId: string, recipientEmail: string): Promise<void> {
  const { rawToken } = accountTokenService.issueToken({
    memberId,
    tokenType: 'email_verify',
    ttlHours: 24,
  });
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, '');
  const verifyUrl = `${baseUrl}/verify/${rawToken}`;
  getCommunicationService().enqueueEmail({
    recipientEmail,
    recipientMemberId: memberId,
    subject: 'Verify your IFPA Footbag account',
    bodyText:
      'Welcome to IFPA Footbag.\n\n' +
      'Please confirm your email address by opening the link below. The link expires in 24 hours.\n\n' +
      `${verifyUrl}\n\n` +
      'If you did not request this account, you can ignore this message.',
  });
}

/**
 * Consume an email_verify token, mark the member verified, run the legacy-link
 * check, and return the session inputs the controller needs to issue a JWT.
 * Returns null if the token is invalid, expired, or already used.
 */
async function verifyEmailByToken(rawToken: string): Promise<VerifyEmailResult | null> {
  const consumed = accountTokenService.consumeToken(rawToken, 'email_verify');
  if (!consumed) return null;

  const now = new Date().toISOString();
  const update = auth.markEmailVerified.run(now, now, consumed.memberId);
  // update.changes may be 0 if the member was already verified; that's fine
  // since the token itself is single-use, we proceed with login in any case.

  const row = auth.findMemberForSessionAfterVerify.get(consumed.memberId) as
    | { id: string; slug: string | null; login_email: string | null; password_version: number; is_admin: number }
    | undefined;
  if (!row) return null;

  // Legacy-link check: see whether this member's email matches an
  // imported legacy row so the post-verify
  // landing can offer the claim flow. lookupLegacyAccount throws on already-
  // claimed; at verify time the member has never claimed, so errors here
  // are swallowed, they don't belong on the verify path.
  let legacyMatch: LegacyAccountLookupResult | null = null;
  if (row.login_email) {
    try {
      legacyMatch = lookupLegacyAccount(row.id, row.login_email);
    } catch {
      legacyMatch = null;
    }
  }

  return {
    memberId: row.id,
    slug: row.slug ?? row.id,
    passwordVersion: row.password_version,
    isAdmin: row.is_admin,
    legacyMatch,
  };
}

/**
 * Re-send an email_verify token to an unverified member. Rate-limited per
 * normalized email; silently no-ops when the bucket is exceeded or no
 * unverified member matches (identical response for anti-enumeration).
 */
async function resendVerifyEmail(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const maxAttempts = readIntConfig('verify_resend_rate_limit_max_attempts', 3);
  const windowMinutes = readIntConfig('verify_resend_rate_limit_window_minutes', 60);
  const rl = rateLimitHit(`verify-resend:${normalized}`, maxAttempts, windowMinutes);
  if (!rl.allowed) return;
  const row = auth.findUnverifiedMemberByEmail.get(normalized) as
    | { id: string }
    | undefined;
  if (!row) return;
  await issueAndEnqueueVerifyEmail(row.id, email.trim());
}

// ── Legacy account claim flow (three-table design) ──────────────────────────
//
// Operates against the legacy_members table. Claim marks the row (sets
// claimed_by_member_id + claimed_at); the row is never deleted. If the claimed
// legacy account has a matching historical_persons.legacy_member_id,
// members.historical_person_id is also set in the same transaction.

export interface LegacyAccountLookupResult {
  legacyMemberId: string;
  displayName: string | null;
  country: string | null;
  isHof: boolean;
  isBap: boolean;
}

function lookupLegacyAccount(
  requestingMemberId: string,
  identifier: string,
): LegacyAccountLookupResult | null {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new ValidationError('Please enter a legacy identifier.');
  }

  const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
  if (already) {
    throw new ValidationError('Your account is already linked to a legacy record.');
  }

  const row = legacyMembers.findByIdentifier.get(trimmed, trimmed, trimmed) as LegacyMemberRow | undefined;
  if (!row) return null;

  return {
    legacyMemberId: row.legacy_member_id,
    displayName: row.display_name ?? row.real_name ?? null,
    country: row.country,
    isHof: Boolean(row.is_hof),
    isBap: Boolean(row.is_bap),
  };
}

/**
 * Execute the three-table claim transaction.
 *
 * Marks the legacy_members row claimed (atomic via WHERE claimed_by_member_id IS NULL),
 * copies merge-eligible fields to the claiming members row, and if the legacy account
 * has a matching historical_persons row (shared legacy_member_id), also sets
 * members.historical_person_id so the member↔HP FK link is established.
 */
function claimLegacyAccount(requestingMemberId: string, targetLegacyMemberId: string): void {
  transaction(() => {
    const already = legacyClaim.checkAlreadyClaimed.get(requestingMemberId) as AlreadyClaimedRow | undefined;
    if (already) {
      throw new ValidationError('Your account is already linked to a legacy record.');
    }

    const row = legacyMembers.findByLegacyMemberId.get(targetLegacyMemberId) as LegacyMemberRow | undefined;
    if (!row) {
      throw new ValidationError('The legacy record is no longer available for claim.');
    }
    if (row.claimed_by_member_id) {
      throw new ValidationError('This legacy record has already been claimed by another account.');
    }

    const now = new Date().toISOString();

    const marked = legacyMembers.markClaimed.run(requestingMemberId, now, targetLegacyMemberId);
    if (marked.changes === 0) {
      throw new ValidationError('This legacy record has already been claimed by another account.');
    }

    legacyClaim.transferLegacyFields.run(
      row.legacy_member_id,
      row.legacy_user_id,
      row.legacy_email,
      row.bio ?? '',
      row.birth_date,
      row.street_address,
      row.postal_code,
      row.city,
      row.region,
      row.country,
      row.ifpa_join_date,
      row.is_hof,
      row.is_bap,
      row.first_competition_year,
      now,
      requestingMemberId,
    );

    const hp = legacyClaim.findHistoricalPersonByLegacyId.get(row.legacy_member_id) as HistoricalPersonClaimRow | undefined;
    if (hp) {
      legacyMembers.setMemberHistoricalPersonId.run(hp.person_id, now, requestingMemberId);
      legacyClaim.mergeHistoricalPersonFields.run(
        hp.country,
        hp.hof_member,
        hp.bap_member,
        hp.hof_induction_year,
        hp.first_year,
        now,
        requestingMemberId,
      );
    }
  });
}

// ── Historical-person direct claim (scenarios D and E) ──────────────────────
//
// For registrants who were competitors but never had an old-site user account
// (scenario D), or whose legacy_members row and historical_persons row were
// not pipeline-linked (scenario E). Email cannot be the anchor because
// historical_persons carries no email, so the identity anchor is surname
// reconciliation against the member's real_name. Flow:
//   1. Member views /history/:personId (the HP detail page).
//   2. If eligible, member clicks "Claim this identity".
//   3. Confirm page shows HP name + the first-name mismatch warning if any.
//      Surname mismatch blocks the claim outright.
//   4. On confirm, members.historical_person_id is set, HP fields are merged
//      in, and if the HP has a legacy_member_id back-link, the legacy_members
//      row is transitively claimed in the same transaction.

export interface HistoricalPersonClaimLookup {
  personId: string;
  personName: string;
  country: string | null;
  isHof: boolean;
  isBap: boolean;
  firstNameWarning: boolean;
}

export function surnameKey(name: string | null | undefined): string {
  if (!name) return '';
  return stripAccents(extractSurname(name)).toLowerCase();
}

function normalizedSurnamesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return surnameKey(a) === surnameKey(b);
}

function extractFirstName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words[0] ?? '';
}

function firstNamesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return stripAccents(extractFirstName(a)).toLowerCase() ===
         stripAccents(extractFirstName(b)).toLowerCase();
}

interface ClaimingMemberRow {
  id: string;
  slug: string;
  real_name: string;
  legacy_member_id: string | null;
  historical_person_id: string | null;
}

function lookupHistoricalPersonForClaim(
  requestingMemberId: string,
  personId: string,
): HistoricalPersonClaimLookup | null {
  const member = legacyClaim.findClaimingMember.get(requestingMemberId) as ClaimingMemberRow | undefined;
  if (!member) return null;
  if (member.historical_person_id) {
    throw new ValidationError('Your account is already linked to a historical player record.');
  }

  const hp = legacyClaim.findHistoricalPersonById.get(personId) as HistoricalPersonClaimRow | undefined;
  if (!hp) return null;

  // Not already claimed by another member.
  const existing = legacyClaim.findMemberClaimingHp.get(personId) as { id: string; slug: string } | undefined;
  if (existing) {
    throw new ValidationError('This historical record has already been claimed by another member.');
  }

  // Surname reconciliation is required to proceed. Mismatch blocks the claim
  // entirely; callers should not render the confirm page.
  if (!normalizedSurnamesMatch(member.real_name, hp.person_name)) {
    throw new ValidationError(
      'Your name does not match this historical record. If you believe this is your identity, contact an administrator.',
    );
  }

  // If the HP has a legacy_member_id back-link, the claim will transitively
  // act on legacy_members. Reject if the member already holds a different
  // legacy linkage, so we never leave two incompatible legacy ids on one
  // account.
  if (hp.legacy_member_id) {
    if (member.legacy_member_id && member.legacy_member_id !== hp.legacy_member_id) {
      throw new ValidationError(
        'This historical record is tied to a different legacy account than the one already linked to your profile.',
      );
    }
    const lm = legacyMembers.findByLegacyMemberId.get(hp.legacy_member_id) as LegacyMemberRow | undefined;
    if (lm && lm.claimed_by_member_id && lm.claimed_by_member_id !== requestingMemberId) {
      throw new ValidationError(
        'The legacy account tied to this historical record has already been claimed by another member.',
      );
    }
  }

  return {
    personId: hp.person_id,
    personName: hp.person_name,
    country: hp.country,
    isHof: Boolean(hp.hof_member),
    isBap: Boolean(hp.bap_member),
    firstNameWarning: !firstNamesMatch(member.real_name, hp.person_name),
  };
}

function claimHistoricalPerson(
  requestingMemberId: string,
  personId: string,
): void {
  transaction(() => {
    const member = legacyClaim.findClaimingMember.get(requestingMemberId) as ClaimingMemberRow | undefined;
    if (!member) {
      throw new ValidationError('Your account cannot be found.');
    }
    if (member.historical_person_id) {
      throw new ValidationError('Your account is already linked to a historical player record.');
    }

    const hp = legacyClaim.findHistoricalPersonById.get(personId) as HistoricalPersonClaimRow | undefined;
    if (!hp) {
      throw new ValidationError('The historical record is no longer available for claim.');
    }

    const existing = legacyClaim.findMemberClaimingHp.get(personId) as { id: string; slug: string } | undefined;
    if (existing) {
      throw new ValidationError('This historical record has already been claimed by another member.');
    }

    if (!normalizedSurnamesMatch(member.real_name, hp.person_name)) {
      throw new ValidationError(
        'Your name does not match this historical record. If you believe this is your identity, contact an administrator.',
      );
    }

    const now = new Date().toISOString();

    // Transitive legacy claim when the HP is back-linked to a legacy account.
    if (hp.legacy_member_id) {
      if (member.legacy_member_id && member.legacy_member_id !== hp.legacy_member_id) {
        throw new ValidationError(
          'This historical record is tied to a different legacy account than the one already linked to your profile.',
        );
      }
      const lm = legacyMembers.findByLegacyMemberId.get(hp.legacy_member_id) as LegacyMemberRow | undefined;
      if (lm && !lm.claimed_by_member_id) {
        const marked = legacyMembers.markClaimed.run(requestingMemberId, now, hp.legacy_member_id);
        if (marked.changes === 0) {
          throw new ValidationError(
            'The legacy account tied to this historical record has already been claimed by another member.',
          );
        }
        if (!member.legacy_member_id) {
          legacyClaim.transferLegacyFields.run(
            lm.legacy_member_id,
            lm.legacy_user_id,
            lm.legacy_email,
            lm.bio ?? '',
            lm.birth_date,
            lm.street_address,
            lm.postal_code,
            lm.city,
            lm.region,
            lm.country,
            lm.ifpa_join_date,
            lm.is_hof,
            lm.is_bap,
            lm.first_competition_year,
            now,
            requestingMemberId,
          );
        }
      } else if (lm && lm.claimed_by_member_id && lm.claimed_by_member_id !== requestingMemberId) {
        throw new ValidationError(
          'The legacy account tied to this historical record has already been claimed by another member.',
        );
      }
    }

    // Set the member↔HP link. Partial UNIQUE index enforces one live member per HP.
    legacyMembers.setMemberHistoricalPersonId.run(hp.person_id, now, requestingMemberId);

    // Carry country / HoF / BAP / hof_inducted_year / first_competition_year from HP.
    legacyClaim.mergeHistoricalPersonFields.run(
      hp.country,
      hp.hof_member,
      hp.bap_member,
      hp.hof_induction_year,
      hp.first_year,
      now,
      requestingMemberId,
    );
  });
}

export interface PasswordChangeResult {
  memberId: string;
  newPasswordVersion: number;
}

async function changePassword(
  memberId: string,
  oldPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<PasswordChangeResult> {
  const maxAttempts = readIntConfig('password_change_rate_limit_max_attempts', 10);
  const windowMinutes = readIntConfig('password_change_rate_limit_window_minutes', 15);
  const rl = rateLimitHit(`pwchange:${memberId}`, maxAttempts, windowMinutes);
  if (!rl.allowed) {
    throw new RateLimitedError(
      'Too many password-change attempts. Please try again later.',
      rl.retryAfterSeconds,
    );
  }

  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }
  if (oldPassword === newPassword) {
    throw new ValidationError('New password must be different from your current password.');
  }

  const row = auth.findMemberForPasswordChange.get(memberId) as
    | { id: string; password_hash: string; password_version: number }
    | undefined;
  if (!row || !row.password_hash) {
    throw new ValidationError('Current password is incorrect.');
  }

  const ok = await argon2.verify(row.password_hash, oldPassword);
  if (!ok) {
    throw new ValidationError('Current password is incorrect.');
  }

  const newHash = await argon2.hash(newPassword);
  const now = new Date().toISOString();
  auth.updateMemberPassword.run(newHash, now, now, memberId);

  // Confirmation email. Best-effort: enqueue failures must not unwind
  // the password change.
  try {
    const member = auth.findMemberForSessionAfterVerify.get(memberId) as
      | { login_email: string | null }
      | undefined;
    if (member?.login_email) {
      getCommunicationService().enqueueEmail({
        recipientEmail: member.login_email,
        recipientMemberId: memberId,
        subject: 'Your IFPA Footbag password was changed',
        bodyText:
          'This is a confirmation that the password for your IFPA Footbag account was just changed.\n\n' +
          'If this was not you, please reset your password immediately and contact admin@footbag.org.',
      });
    }
  } catch {
    // Swallow: the password change itself already committed.
  }

  return { memberId, newPasswordVersion: row.password_version + 1 };
}

// ── Password reset ───────────────────────────────────────────────────────────

export interface PasswordResetRequestResult {
  /** Always true; caller renders the same page either way (anti-enumeration). */
  responseSent: true;
}

async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const normalized = normalizeEmail(email);
  const maxAttempts = readIntConfig('password_reset_rate_limit_max_attempts', 5);
  const windowMinutes = readIntConfig('password_reset_rate_limit_window_minutes', 60);
  const rl = rateLimitHit(`pwreset:${normalized}`, maxAttempts, windowMinutes);
  if (!rl.allowed) {
    return { responseSent: true };
  }
  const row = auth.findMemberByEmail.get(normalized) as MemberAuthRow | undefined;
  if (!row) {
    return { responseSent: true };
  }
  const ttlHours = readIntConfig('password_reset_expiry_hours', 1);
  const { rawToken } = accountTokenService.issueToken({
    memberId: row.id,
    tokenType: 'password_reset',
    ttlHours,
  });
  const baseUrl = config.publicBaseUrl.replace(/\/+$/, '');
  const resetUrl = `${baseUrl}/password/reset/${rawToken}`;
  getCommunicationService().enqueueEmail({
    recipientEmail: email.trim(),
    recipientMemberId: row.id,
    subject: 'Reset your IFPA Footbag password',
    bodyText:
      'A password reset was requested for your IFPA Footbag account.\n\n' +
      `Open the link below within ${ttlHours} hour${ttlHours === 1 ? '' : 's'} to set a new password:\n\n` +
      `${resetUrl}\n\n` +
      'If you did not request this, you can ignore this message. Your current password remains in effect.',
  });
  return { responseSent: true };
}

export interface PasswordResetCompletionResult {
  memberId: string;
  newPasswordVersion: number;
  role: 'admin' | 'member';
}

async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  confirmPassword: string,
): Promise<PasswordResetCompletionResult> {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match.');
  }

  const consumed = accountTokenService.consumeToken(rawToken, 'password_reset');
  if (!consumed) {
    throw new ValidationError('This reset link is invalid, expired, or already used.');
  }

  const member = auth.findMemberForSessionAfterVerify.get(consumed.memberId) as
    | { id: string; slug: string | null; login_email: string | null; password_version: number; is_admin: number }
    | undefined;
  if (!member) {
    throw new ValidationError('This reset link is invalid, expired, or already used.');
  }

  const newHash = await argon2.hash(newPassword);
  const now = new Date().toISOString();
  auth.updateMemberPassword.run(newHash, now, now, consumed.memberId);

  // Confirmation email, best-effort.
  try {
    if (member.login_email) {
      getCommunicationService().enqueueEmail({
        recipientEmail: member.login_email,
        recipientMemberId: consumed.memberId,
        subject: 'Your IFPA Footbag password was changed',
        bodyText:
          'Your IFPA Footbag password was reset via the password-reset link.\n\n' +
          'If this was not you, contact admin@footbag.org immediately.',
      });
    }
  } catch {
    // Swallow, the reset itself committed.
  }

  return {
    memberId: consumed.memberId,
    newPasswordVersion: member.password_version + 1,
    role: member.is_admin ? 'admin' : 'member',
  };
}

export const identityAccessService = { verifyMemberCredentials, attemptLogin, registerMember, lookupLegacyAccount, claimLegacyAccount, lookupHistoricalPersonForClaim, claimHistoricalPerson, changePassword, verifyEmailByToken, resendVerifyEmail, requestPasswordReset, completePasswordReset };
