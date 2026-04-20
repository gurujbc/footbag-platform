/**
 * Staging AWS wiring readiness probe.
 *
 * Long-term, opt-in smoke suite. Exercises the full assumed-role chain
 * against real staging AWS: sts:GetCallerIdentity resolution,
 * kms:GetPublicKey, kms:Sign round-trip, ses:SendEmail to the mailbox
 * simulator. The contract asserted here is permanent: the host's runtime
 * identity reaches AWS, the JWT signing key is present and usable for
 * RS256, and transactional email sends succeed.
 *
 * Run with: npm run test:smoke  (sets RUN_STAGING_SMOKE=1)
 *
 * Failure modes (each has a distinct cause):
 *   - sts:GetCallerIdentity fails or returns the source IAM user instead of
 *     the assumed role: source-profile IAM user, trust policy, or
 *     /root/.aws config/credentials is misconfigured.
 *   - kms:GetPublicKey or kms:Sign returns AccessDenied: runtime role
 *     lacks kms:Sign / kms:GetPublicKey on the key ARN.
 *   - kms:GetPublicKey returns NotFoundException: JWT_KMS_KEY_ID points at a
 *     key in the wrong region, or the key was deleted/disabled.
 *   - ses:SendEmail fails: SES sender identity not verified, IAM lacks
 *     ses:SendEmail on the identity ARN, or sandbox suppression list
 *     blocklisted the recipient.
 *
 * Excluded from the default `npm test` suite via the test:smoke script's
 * --exclude pattern, so dev and CI never accidentally reach AWS.
 *
 * Required env (operator sources /srv/footbag/env or sets manually):
 *   AWS_PROFILE=footbag-staging-runtime
 *   AWS_REGION=us-east-1
 *   JWT_KMS_KEY_ID=arn:aws:kms:us-east-1:<ACCOUNT>:key/<KEY_ID>
 *   SES_FROM_IDENTITY=noreply@footbag.org
 *   RUN_STAGING_SMOKE=1
 */
import { describe, it, expect } from 'vitest';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { KMSClient, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { createKmsJwtAdapter } from '../../src/adapters/jwtSigningAdapter';
import { createLiveSesAdapter } from '../../src/adapters/sesAdapter';

const RUN = process.env.RUN_STAGING_SMOKE === '1';
const region = process.env.AWS_REGION ?? 'us-east-1';
const keyArn = process.env.JWT_KMS_KEY_ID;
const fromIdentity = process.env.SES_FROM_IDENTITY ?? 'noreply@footbag.org';
const simulatorRecipient = 'success@simulator.amazonses.com';

describe.skipIf(!RUN)(
  'staging AWS wiring: assumed-role chain + KMS signing + SES send',
  () => {
    it('sts:GetCallerIdentity resolves to the assumed runtime role', async () => {
      const client = new STSClient({ region });
      const res = await client.send(new GetCallerIdentityCommand({}));
      expect(res.Arn).toBeDefined();
      expect(res.Arn).toMatch(
        /^arn:aws:sts::\d+:assumed-role\/footbag-staging-app-runtime\//,
      );
    }, 15_000);

    it('kms:GetPublicKey returns an RSA-2048 SIGN_VERIFY key with RS256 support', async () => {
      expect(keyArn).toBeDefined();
      const client = new KMSClient({ region });
      const res = await client.send(new GetPublicKeyCommand({ KeyId: keyArn }));
      expect(res.PublicKey).toBeDefined();
      expect(res.KeySpec).toBe('RSA_2048');
      expect(res.KeyUsage).toBe('SIGN_VERIFY');
      expect(res.SigningAlgorithms).toContain('RSASSA_PKCS1_V1_5_SHA_256');
    }, 15_000);

    it('KmsJwtAdapter round-trips sign + verify against real KMS', async () => {
      expect(keyArn).toBeDefined();
      const adapter = createKmsJwtAdapter({ keyId: keyArn!, region });
      const token = await adapter.signJwt(
        { sub: 'staging-readiness-sub', passwordVersion: 0 },
        60,
      );
      const claims = await adapter.verifyJwt(token);
      expect(claims).not.toBeNull();
      expect(claims!.sub).toBe('staging-readiness-sub');
      const headerSeg = token.split('.')[0];
      const pad =
        headerSeg.length % 4 === 0
          ? ''
          : '='.repeat(4 - (headerSeg.length % 4));
      const header = JSON.parse(
        Buffer.from(
          headerSeg.replace(/-/g, '+').replace(/_/g, '/') + pad,
          'base64',
        ).toString('utf8'),
      );
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(keyArn);
    }, 20_000);

    it('ses:SendEmail succeeds to success@simulator.amazonses.com', async () => {
      const adapter = createLiveSesAdapter({ region, fromIdentity });
      const res = await adapter.sendEmail({
        to: simulatorRecipient,
        subject: 'Footbag staging AWS wiring readiness probe',
        bodyText:
          'Automated readiness probe addressed to the SES mailbox simulator. Safe to ignore.',
      });
      expect(res.messageId).toBeDefined();
      expect(res.messageId.length).toBeGreaterThan(0);
    }, 20_000);
  },
);
