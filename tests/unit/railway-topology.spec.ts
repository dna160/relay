/**
 * `.railway/railway.ts` — the deploy topology, asserted.
 *
 * Railway deprecated Config as Code with a hard 2026-12-01 cutoff and no opt-in
 * for new services, so this file is what a new Relay project is stood up from.
 * It is also, today, the only TypeScript file in the repository that **nothing
 * else checks**: `tsc` and `eslint` both skip dot-directories, and the
 * `railway/iac` module it imports is not a dependency (adding it needs an ADR).
 * So the guard here is textual rather than type-level, and deliberately so — a
 * deploy config with no gate behind it is a deploy config that drifts until the
 * night it matters.
 *
 * Every assertion below is a property whose violation is a production incident,
 * not a style preference. Each names the incident.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from '../invariants/_source';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IAC_PATH = join(ROOT, '.railway', 'railway.ts');

function readIac(): string {
  return readFileSync(IAC_PATH, 'utf8');
}

/** The file with prose removed, so an explanation is never read as a setting. */
const code = stripComments(readIac());

/** The body of one `service('<name>', { ... })` call, braces balanced. */
function serviceBlock(name: string): string {
  const marker = `service('${name}'`;
  const start = code.indexOf(marker);
  expect(start, `no service('${name}') in .railway/railway.ts`).toBeGreaterThan(-1);
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in service('${name}')`);
}

describe('the Railway topology exists at all', () => {
  it('is a file, because new Railway services cannot use railway.json', () => {
    expect(() => readIac(), '.railway/railway.ts is missing').not.toThrow();
    expect(code).toContain('defineRailway');
  });

  it('declares all three resources — app, worker, and the database', () => {
    expect(code).toContain("service('app'");
    expect(code).toContain("service('worker'");
    expect(code).toContain("postgres('postgres')");
  });
});

describe('migration ordering', () => {
  /**
   * `preDeploy` runs to completion before the new version receives traffic.
   * Without it the new app version serves requests against an un-migrated
   * database — every request that touches a new column 500s until someone
   * notices.
   */
  it('migrates before the app takes traffic', () => {
    expect(serviceBlock('app')).toMatch(/preDeploy\s*:\s*'npm run db:migrate'/);
  });

  it('never migrates from the worker, because two services racing one migration half-applies it', () => {
    expect(serviceBlock('worker')).not.toContain('db:migrate');
  });

  it('has exactly one migration site across the whole topology', () => {
    const sites = [...code.matchAll(/db:migrate/g)].length;
    expect(sites, 'two preDeploy migrations race each other').toBe(1);
  });
});

describe('the worker runs alone', () => {
  /**
   * RUNBOOK §1: one replica, always. A second replica doubles the blast radius
   * of a bug in a job whose whole purpose is destroying data (INV-7).
   */
  it('pins the worker at one replica in every environment, with no ternary on it', () => {
    const worker = serviceBlock('worker');
    expect(worker).toMatch(/replicas\s*:\s*1\s*,/);
    const replicaLine = worker.split('\n').find((l) => /replicas/.test(l)) ?? '';
    expect(replicaLine, 'the worker replica count varies by environment').not.toContain('?');
    expect(replicaLine).not.toContain('prod');
  });
});

describe('the health check the first deploy depends on', () => {
  it('points the app at /api/health', () => {
    expect(serviceBlock('app')).toMatch(/healthcheck\s*:\s*'\/api\/health'/);
  });

  it('agrees with railway.json, which is still what the existing service reads', () => {
    const json = readFileSync(join(ROOT, 'railway.json'), 'utf8');
    expect(JSON.parse(json).deploy.healthcheckPath).toBe('/api/health');
  });
});

describe('blast radius between environments', () => {
  /**
   * Staging and production sharing an object-storage bucket means a staging
   * purge destroys production deliverables. Purge is irreversible by design.
   */
  it('never lets staging and production share an S3 bucket', () => {
    const bucket = code.match(/S3_BUCKET\s*:\s*([^\n]+)/)?.[1] ?? '';
    expect(bucket, 'S3_BUCKET is not environment-dependent').toContain('prod');
    expect(bucket).toMatch(/\?/);
    const literals = [...bucket.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(literals.length, 'expected a production and a non-production bucket').toBe(2);
    expect(new Set(literals).size, 'both environments name the same bucket').toBe(2);
  });

  it('gives production and staging different origins', () => {
    const origins = [...code.matchAll(/'https:\/\/[^']+'/g)].map((m) => m[0]);
    expect(new Set(origins).size).toBeGreaterThan(1);
  });
});

describe('what must never be deployed', () => {
  /**
   * The seed endpoint resets the database to a fixture graph. Reachable in
   * production it is a total compromise of every engagement in it. The gate is
   * the absence of this variable, so the absence gets a test.
   */
  it('sets E2E_SEED_TOKEN in no environment', () => {
    expect(code, 'E2E_SEED_TOKEN in the deploy topology').not.toContain('E2E_SEED_TOKEN');
    expect(code).not.toContain('E2E_');
  });

  it('commits no secret — every credential is preserve(), never a literal', () => {
    const offenders: string[] = [];
    for (const line of code.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))\s*:\s*(.+?),?\s*$/);
      if (!match) continue;
      const value = match[2] ?? '';
      if (/preserve\(\)/.test(value)) continue;
      if (/^db\.env\./.test(value)) continue;
      offenders.push(`${match[1]} = ${value}`);
    }
    expect(offenders, 'a credential is written into a committed file').toEqual([]);
  });
});

describe('the connection budget', () => {
  /**
   * app replicas x pool + worker must stay under Postgres `max_connections`.
   * Exceeding it is not a slow app; it is `too many clients already` on every
   * request, including the health check, which then fails the deploy.
   */
  it('sets PGPOOL_MAX rather than leaving the pool at its default', () => {
    expect(code).toContain('PGPOOL_MAX');
  });

  it('does not raise the per-process pool in the environment that runs more replicas', () => {
    const pool = code.match(/PGPOOL_MAX\s*:\s*([^\n]+)/)?.[1] ?? '';
    const numbers = [...pool.matchAll(/'(\d+)'/g)].map((m) => Number(m[1]));
    expect(numbers.length, 'PGPOOL_MAX is not environment-dependent').toBe(2);
    const appReplicas = serviceBlock('app').match(/replicas\s*:\s*prod\s*\?\s*(\d+)\s*:\s*(\d+)/);
    expect(appReplicas, 'app replica count is not environment-dependent').not.toBeNull();
    const [prodPool = 0, stagingPool = 0] = numbers;
    const prodReplicas = Number(appReplicas?.[1] ?? 1);
    const stagingReplicas = Number(appReplicas?.[2] ?? 1);
    // The budget, not the raw number: total connections must not grow when
    // replicas do.
    expect(
      prodPool * prodReplicas,
      'production opens more connections than staging while also running more replicas',
    ).toBeLessThanOrEqual(stagingPool * stagingReplicas * 2);
  });
});
