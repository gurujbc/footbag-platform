import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { accountTokens, type AccountTokenRow } from '../db/db';

export type AccountTokenType =
  | 'email_verify'
  | 'password_reset'
  | 'data_export'
  | 'account_claim';

export interface IssuedToken {
  /** The raw URL-safe token handed to the caller. Never stored. */
  rawToken: string;
  /** The row ID of the persisted hash. */
  tokenRowId: string;
  expiresAt: string;
}

export interface ConsumedToken {
  memberId: string;
  tokenRowId: string;
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Issue a cryptographically random single-use token for a member.
 * Returns the raw token (to be delivered to the member via a side channel
 * such as email) and the row ID. Only the SHA-256 hash is persisted so a
 * database compromise cannot be replayed into account takeover.
 */
export function issueToken(opts: {
  memberId: string;
  tokenType: AccountTokenType;
  ttlHours: number;
  targetLegacyMemberId?: string;
}): IssuedToken {
  if (opts.ttlHours <= 0) {
    throw new Error('ttlHours must be > 0');
  }
  const raw = b64url(randomBytes(32));
  const tokenHash = hashToken(raw);
  const now = new Date();
  const expiresAtDate = new Date(now.getTime() + opts.ttlHours * 60 * 60 * 1000);
  const nowIso = now.toISOString();
  const expiresAt = expiresAtDate.toISOString();
  const id = `tok_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  accountTokens.insert.run(
    id,
    nowIso,
    nowIso,
    opts.memberId,
    opts.targetLegacyMemberId ?? null,
    opts.tokenType,
    tokenHash,
    nowIso,
    expiresAt,
  );

  return { rawToken: raw, tokenRowId: id, expiresAt };
}

/**
 * Consume a raw token. Returns the member binding on success; returns null
 * when the token is unknown, expired, or already used. Never throws;
 * callers render a generic error message to prevent enumeration of valid tokens.
 *
 * The consume step is atomic: SQL UPDATE WHERE used_at IS NULL with a
 * rowcount check ensures a concurrent consume attempt wins exactly once.
 */
export function consumeToken(
  rawToken: string,
  tokenType: AccountTokenType,
): ConsumedToken | null {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = accountTokens.findByHash.get(tokenHash, tokenType) as
    | AccountTokenRow
    | undefined;
  if (!row) return null;
  if (row.used_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const nowIso = new Date().toISOString();
  const result = accountTokens.consumeIfUnused.run(nowIso, nowIso, row.id);
  if (result.changes !== 1) return null;

  return { memberId: row.member_id, tokenRowId: row.id };
}

export const accountTokenService = { issueToken, consumeToken };
