import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { auth, registration, MemberAuthRow } from '../db/db';
import { ValidationError } from './serviceErrors';

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
function slugify(displayName: string): string {
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
async function registerMember(
  email: string,
  password: string,
  confirmPassword: string,
  displayName: string,
): Promise<RegisteredMember> {
  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim();
  const normalizedEmail = normalizeEmail(trimmedEmail);

  if (!trimmedName) {
    throw new ValidationError('Display name is required.');
  }
  if (trimmedName.length > MAX_DISPLAY_NAME) {
    throw new ValidationError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
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
  const slug = generateUniqueSlug(trimmedName);
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
    trimmedName,     // real_name
    trimmedName,     // display_name
    trimmedName.toLowerCase(), // display_name_normalized
    now,   // created_at
    now,   // updated_at
  );

  return { id, slug, displayName: trimmedName, isAdmin: 0 };
}

export const identityAccessService = { verifyMemberCredentials, registerMember };
