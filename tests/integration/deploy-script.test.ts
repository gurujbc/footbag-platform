/**
 * Integration tests for the workstation-side AWS deploy bash chain.
 *
 * Coverage:
 *   - deploy_to_aws.sh wrapper preflight: --help short-circuit, missing
 *     credential file, missing SSH alias.
 *   - scripts/reset-local-db.sh preflight: missing canonical_input CSVs.
 *   - legacy_data/run_pipeline.sh: identity-lock CSV missing path.
 *   - legacy_data/event_results/scripts/20_link_footbag_org_sources.py:
 *     graceful skip when scraped_footbag_moves.csv is absent.
 *
 * Strategy: spawn each script as a subprocess against a controlled env and
 * assert exit code + stderr/stdout content. No AWS contact; no host SSH.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string } = {},
) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
    encoding: 'utf-8',
  });
}

const HAS_DOCKER = spawnSync('command', ['-v', 'docker'], { shell: true }).status === 0;

// ── deploy_to_aws.sh wrapper ──────────────────────────────────────────────────

describe('deploy_to_aws.sh wrapper', () => {
  it('--help exits 0 without checking AWS credentials or tools', () => {
    const r = run('bash', ['deploy_to_aws.sh', '--help'], {
      env: { AWS_OPERATOR_FILE: '/nonexistent/never/exists' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/i);
  });

  it('-h exits 0 (short flag)', () => {
    const r = run('bash', ['deploy_to_aws.sh', '-h']);
    expect(r.status).toBe(0);
  });

  it.skipIf(!HAS_DOCKER)(
    '--code-only with missing AWS_OPERATOR_FILE exits 1 with generic Recommendation (no path leak)',
    () => {
      const r = run('bash', ['deploy_to_aws.sh', '--code-only'], {
        env: {
          AWS_OPERATOR_FILE: '/nonexistent/never/exists',
          DEPLOY_TARGET: 'footbag-staging',
        },
      });
      expect(r.status).toBe(1);
      // Either we hit the credential-file check or an earlier ssh-alias /
      // tool check — both produce a Recommendation: line. Path must not leak.
      const combined = (r.stderr ?? '') + (r.stdout ?? '');
      expect(combined).toMatch(/Recommendation:/);
      expect(combined).not.toMatch(/\/nonexistent\/never\/exists/);
    },
  );

  it.skipIf(!HAS_DOCKER)(
    '--code-only with bogus DEPLOY_TARGET exits 1 with SSH-alias Recommendation',
    () => {
      const tmpFile = path.join(os.tmpdir(), `op-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, 'fake-password\n', { mode: 0o600 });
      try {
        const r = run('bash', ['deploy_to_aws.sh', '--code-only'], {
          env: {
            AWS_OPERATOR_FILE: tmpFile,
            DEPLOY_TARGET: 'this-alias-definitely-does-not-exist-zzz',
          },
        });
        expect(r.status).toBe(1);
        const combined = (r.stderr ?? '') + (r.stdout ?? '');
        expect(combined).toMatch(/SSH alias/);
        expect(combined).toMatch(/Recommendation:/);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  );
});

// ── reset-local-db.sh preflight ───────────────────────────────────────────────

describe('scripts/reset-local-db.sh preflight', () => {
  it('exits 1 with "MISSING:" + "Recommendation:" when canonical_input is absent', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-local-db-'));
    try {
      // Minimal scaffold: copy only the script + schema; leave canonical_input empty.
      fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'database'), { recursive: true });
      fs.copyFileSync(
        path.join(REPO_ROOT, 'scripts/reset-local-db.sh'),
        path.join(tmpRoot, 'scripts/reset-local-db.sh'),
      );
      fs.writeFileSync(path.join(tmpRoot, 'database/schema.sql'), '-- empty\n');

      const r = run('bash', ['scripts/reset-local-db.sh'], { cwd: tmpRoot });
      expect(r.status).toBe(1);
      const combined = (r.stderr ?? '') + (r.stdout ?? '');
      expect(combined).toMatch(/MISSING:/);
      expect(combined).toMatch(/Recommendation:/);
      expect(combined).toMatch(/from-mirror|from-csv/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ── run_pipeline.sh identity-lock preflight ───────────────────────────────────

describe('legacy_data/run_pipeline.sh identity-lock preflight', () => {
  it('canonical_only mode exits 1 with identity-lock guidance when v53 CSV missing', () => {
    // Run from a tmpdir with a minimal venv stub so the pipeline aborts at the
    // identity-lock guard rather than at venv setup.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-pipeline-'));
    try {
      fs.mkdirSync(path.join(tmpRoot, '.venv', 'bin'), { recursive: true });
      // 'activate' is sourced; an empty file is enough.
      fs.writeFileSync(path.join(tmpRoot, '.venv', 'bin', 'activate'), '');
      fs.copyFileSync(
        path.join(REPO_ROOT, 'legacy_data/run_pipeline.sh'),
        path.join(tmpRoot, 'run_pipeline.sh'),
      );
      // Stub `python` so the alias-registry preflight (early in the script)
      // doesn't fail before we reach the identity-lock guard. We don't actually
      // get that far in canonical_only mode either, since canonical_only enters
      // run_v0_backbone immediately. Place a no-op script earlier in PATH.
      const stubBin = path.join(tmpRoot, 'stub-bin');
      fs.mkdirSync(stubBin, { recursive: true });
      const stubPy = path.join(stubBin, 'python');
      fs.writeFileSync(stubPy, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      const r = run('bash', ['run_pipeline.sh', 'canonical_only'], {
        cwd: tmpRoot,
        env: { PATH: `${stubBin}:${process.env.PATH ?? ''}` },
      });
      expect(r.status).toBe(1);
      const combined = (r.stderr ?? '') + (r.stdout ?? '');
      expect(combined).toMatch(/identity-lock|Persons_Truth_Final/i);
      expect(combined).toMatch(/Recommendation:/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ── script 20 graceful skip ───────────────────────────────────────────────────

describe('legacy_data script 20 graceful skip', () => {
  it('exits 0 with skip message when scraped CSV is absent', () => {
    const r = run('python3', [
      'legacy_data/event_results/scripts/20_link_footbag_org_sources.py',
      '--scraped-csv',
      '/tmp/definitely-does-not-exist-scraped.csv',
      '--db',
      '/tmp/never-touched.db',
    ]);
    expect(r.status).toBe(0);
    const combined = (r.stderr ?? '') + (r.stdout ?? '');
    expect(combined).toMatch(/skip:/);
    expect(combined).toMatch(/script 18/);
  });
});
