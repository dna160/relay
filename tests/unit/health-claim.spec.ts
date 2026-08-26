/**
 * `GET /api/health` — what the word `ok` claims, and whether the check earns it.
 *
 * ## The shape this file exists to close
 *
 * Health reported `ok` on a deployment with no `S3_*` variables set. Presign was
 * structurally impossible, the deploy gate went green, Railway shifted traffic,
 * and the first person to find out was a user being told the workspace could not
 * be reached. The check was `select 1`; the word on the tin was `ok`.
 *
 * That is the **sixth** instance of one shape in this build — INV-10's intake
 * scan pinned to a parameter name, INV-9's write scan reading only `route.ts`,
 * INV-8's predicate scan reading one eighth of the tree, INV-6's exclusion
 * running unbacked, the byte-path e2e asserting "no PUT reached the app" over a
 * run containing no PUT — and every one of them is the same sentence: **the
 * check reads something narrower than the word it prints.**
 *
 * A test that asserts "health now also checks storage" would close this
 * instance and none of the next ones. So the claim is made *exhaustive* against
 * the environment registry instead: every variable `docs/RUNBOOK.md` says
 * breaks something when it is absent is either **probed** by this route or a
 * **declared blind spot** with a written reason. A variable that is neither
 * fails this file. That is what makes the claim and the check agree — not
 * because someone remembered storage, but because there is nowhere for the next
 * one to hide.
 *
 * ## Two halves
 *
 * 1. **The matrix** — the shipped handler, run against a fake database and a
 *    stubbed storage probe, over every combination of the two subsystems'
 *    states. This is where "`ok` means both" stops being a comment.
 * 2. **The registry** — parsed out of the runbook, partitioned, and asserted to
 *    have no unclassified rows in it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HEALTH_BLIND_SPOTS,
  HEALTH_PROBES,
  type HealthProbe,
} from '@tests/fixtures/health-claim';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/* ========================================================================== */
/* 1. The matrix — the shipped handler, both subsystems, every combination.   */
/* ========================================================================== */

/**
 * `@/db/client` and `@/lib/storage` are replaced; everything between them is
 * the route as shipped, taking its real branches in its real order. The same
 * approach `comment-writer.spec.ts` uses, and for the same reason: a route
 * handler imports its dependencies at module scope, so that is the only seam.
 */
const dbExecute = vi.fn();
const storageProbe = vi.fn();

vi.mock('@/db/client', () => ({
  db: {
    execute: (...args: unknown[]) => dbExecute(...args) as unknown,
  },
}));

vi.mock('@/lib/storage', () => ({
  checkStorage: (...args: unknown[]) => storageProbe(...args) as unknown,
  REQUIRED_STORAGE_ENV: ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'],
}));

interface Answered {
  http: number;
  body: {
    status?: string;
    db?: string;
    storage?: string;
    release?: string;
    checkedAt?: string;
    dbLatencyMs?: number;
  };
  cacheControl: string | null;
}

async function ask(situation: {
  database: 'up' | 'down';
  storage: 'ok' | 'unconfigured' | 'unreachable';
}): Promise<Answered> {
  dbExecute.mockImplementation(() =>
    situation.database === 'up'
      ? Promise.resolve([{ '?column?': 1 }])
      : Promise.reject(new Error('ECONNREFUSED 10.0.0.1:5432 password=hunter2')),
  );
  storageProbe.mockResolvedValue(situation.storage);

  const { GET } = await import('@/app/api/health/route');
  const response = await GET();
  return {
    http: response.status,
    body: (await response.json()) as Answered['body'],
    cacheControl: response.headers.get('cache-control'),
  };
}

describe('what `ok` claims', () => {
  beforeEach(() => {
    vi.resetModules();
    dbExecute.mockReset();
    storageProbe.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says ok only when every subsystem it probes is ok', async () => {
    const answered = await ask({ database: 'up', storage: 'ok' });
    expect(answered.body.status).toBe('ok');
    expect(answered.http).toBe(200);
    expect(answered.body.db).toBe('ok');
    expect(answered.body.storage).toBe('ok');
  });

  /**
   * The exact production situation, as a test. `select 1` succeeds, the process
   * is healthy, and uploads cannot work — which is what `ok` used to be printed
   * over.
   */
  it('does not say ok on a deployment where uploads are structurally impossible', async () => {
    const answered = await ask({ database: 'up', storage: 'unconfigured' });
    expect(
      answered.body.status,
      'health said ok on a deployment with no object-store configuration. This is ' +
        'the deployment a user uploaded a file to and was told the workspace could ' +
        'not be reached.',
    ).not.toBe('ok');
    expect(
      answered.http,
      'an unconfigured deployment passed its own health check. `healthcheckPath` ' +
        'points here, so a 200 is Railway being told to shift traffic onto it.',
    ).toBe(503);
  });

  /**
   * The other half of the distinction, and the reason `storage` has three
   * values rather than two. A bucket that is briefly quiet must not roll the
   * whole deployment back — boards, comments, transitions and approvals all
   * still work.
   */
  it('stays up, and stops saying ok, when the bucket is merely unreachable', async () => {
    const answered = await ask({ database: 'up', storage: 'unreachable' });
    expect(answered.body.status).toBe('degraded');
    expect(
      answered.http,
      'a momentarily unreachable bucket failed the health check. That is a rollback ' +
        'of a working deployment over somebody else\'s outage.',
    ).toBe(200);
  });

  it('reports both reasons at once when both are broken', async () => {
    // An operator who fixes the database and rediscovers the bucket on the next
    // push has been made to deploy twice by the health check's own ordering.
    const answered = await ask({ database: 'down', storage: 'unconfigured' });
    expect(answered.body.db).toBe('unreachable');
    expect(answered.body.storage).toBe('unconfigured');
    expect(answered.body.status).toBe('degraded');
    expect(answered.http).toBe(503);
  });

  it('asks the storage probe even when the database answer is already fatal', async () => {
    await ask({ database: 'down', storage: 'ok' });
    expect(
      storageProbe,
      'the storage probe was skipped once the database failed, so the response ' +
        'cannot report both reasons and the operator finds the second one on the ' +
        'next deploy.',
    ).toHaveBeenCalled();
  });

  it('never answers ok while any probed subsystem is not ok, in any combination', async () => {
    for (const database of ['up', 'down'] as const) {
      for (const storage of ['ok', 'unconfigured', 'unreachable'] as const) {
        const answered = await ask({ database, storage });
        const everythingOk = database === 'up' && storage === 'ok';
        expect(
          answered.body.status === 'ok',
          `db=${database} storage=${storage} answered ${String(answered.body.status)}`,
        ).toBe(everythingOk);
        expect(answered.body.status, 'a third status word appeared').toMatch(/^(ok|degraded)$/);
      }
    }
  });

  it('discloses no host, credential, bucket or driver text, on any path', async () => {
    // A health endpoint is the most-scanned route on any deployment. The
    // rejection above carries a host, a port and a password on purpose.
    for (const database of ['up', 'down'] as const) {
      for (const storage of ['ok', 'unconfigured', 'unreachable'] as const) {
        const answered = await ask({ database, storage });
        const text = JSON.stringify(answered.body);
        for (const secret of ['hunter2', 'ECONNREFUSED', '10.0.0.1', '5432', 'password']) {
          expect(text, `${secret} reached the health body (db=${database})`).not.toContain(secret);
        }
        expect(
          text,
          'the body names a storage variable. Reporting *that* uploads do not work ' +
            'is a fact any user discovers by trying one; reporting *which* setting is ' +
            'missing is reconnaissance.',
        ).not.toMatch(/S3_[A-Z_]+/);
        expect(answered.cacheControl, 'a cached health check is a lie').toBe('no-store');
      }
    }
  });

  it('answers a release on every path, because a rollback is confirmed against it', async () => {
    for (const database of ['up', 'down'] as const) {
      const answered = await ask({ database, storage: 'ok' });
      expect(answered.body.release, `no release on the ${database} path`).toBeTruthy();
      expect(answered.body.checkedAt).toBeTruthy();
    }
  });
});

/* ========================================================================== */
/* 2. The registry — the claim, made exhaustive.                              */
/* ========================================================================== */

interface RegistryRow {
  name: string;
  services: string;
  consequence: string;
}

/**
 * `docs/RUNBOOK.md` §2 — "Every variable, what it does, and, the column that
 * matters at 3am, what breaks when it is wrong or absent."
 *
 * Parsed rather than restated. A copy of this list in a test is a list that
 * drifts, and the drift is invisible in exactly the direction that matters: a
 * variable added to the runbook and not to the copy.
 */
function registry(): RegistryRow[] {
  const text = readFileSync(`${ROOT}/docs/RUNBOOK.md`, 'utf8');
  const rows: RegistryRow[] = [];
  for (const match of text.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|([^|]*)\|[^|]*\|([^|]*)\|/gm)) {
    rows.push({
      name: match[1] ?? '',
      services: (match[2] ?? '').trim(),
      consequence: (match[3] ?? '').trim(),
    });
  }
  return rows;
}

describe('the health claim is exhaustive against the environment registry', () => {
  const REGISTRY = registry();
  const NAMES = REGISTRY.map((r) => r.name);

  it('parsed a registry, so an empty partition is not a pass', () => {
    // Every case below partitions this list. If the parse breaks, they all pass
    // over nothing. This is the case that fails instead.
    expect(
      REGISTRY.length,
      'no environment registry parsed out of docs/RUNBOOK.md §2. Either the table ' +
        'moved or its shape changed; either way every claim below is now vacuous.',
    ).toBeGreaterThan(12);
    expect(NAMES).toContain('DATABASE_URL');
    expect(NAMES).toContain('S3_ENDPOINT');
  });

  it('classifies every registry row as probed or as a declared blind spot', () => {
    /**
     * The case that makes this the last instance of the shape *for health*.
     *
     * A variable whose absence breaks something, that health does not probe and
     * nobody has written down as unprobed, is exactly the `S3_ENDPOINT`
     * situation with a different name on it. There is no third option here on
     * purpose: probe it, or say in writing that you did not.
     */
    const probed = new Set(HEALTH_PROBES.flatMap((p) => p.covers));
    const declared = new Set(HEALTH_BLIND_SPOTS.map((b) => b.name));

    const unclassified = NAMES.filter((n) => !probed.has(n) && !declared.has(n));
    expect(
      unclassified,
      'a variable in the runbook registry is neither probed by /api/health nor ' +
        'declared as a blind spot. `ok` is a word about this deployment, and every ' +
        'name on this list is a way for it to be false. Add a probe, or add an entry ' +
        'to HEALTH_BLIND_SPOTS saying why not — and then say it in RUNBOOK §3 too, ' +
        'because the operator reading a green health check is the person the word ' +
        'is being said to.',
    ).toEqual([]);
  });

  it('names nothing that the registry does not, so no classification is stale', () => {
    // DEFECT-6's lesson. A blind spot declared for a variable that no longer
    // exists goes on excusing forever and nothing says so; a probe claiming to
    // cover a renamed variable covers nothing.
    const known = new Set(NAMES);
    const phantomProbes = HEALTH_PROBES.flatMap((p) => p.covers).filter((n) => !known.has(n));
    const phantomBlind = HEALTH_BLIND_SPOTS.map((b) => b.name).filter((n) => !known.has(n));
    expect(phantomProbes, 'a probe claims to cover a variable the registry does not list').toEqual([]);
    expect(phantomBlind, 'a blind spot is declared for a variable that no longer exists').toEqual([]);
  });

  it('states a reason for every blind spot, and what a user would see', () => {
    for (const spot of HEALTH_BLIND_SPOTS) {
      expect(spot.why.length, `${spot.name} is unprobed with no stated reason`).toBeGreaterThan(30);
      expect(
        spot.symptom.length,
        `${spot.name} does not say what a user sees when it is wrong. That sentence is ` +
          'the whole value of the declaration — it is what the next incident is triaged against.',
      ).toBeGreaterThan(10);
    }
  });

  it('every blind spot is written where an operator reads it, not only where QA does', () => {
    /**
     * The claim has two audiences and only one of them runs `vitest`. A blind
     * spot that exists solely in a fixture narrows the word for the test suite
     * and leaves it as wide as ever for the person at 3am reading a green
     * `/api/health` and concluding the deployment is fine.
     */
    const runbook = readFileSync(`${ROOT}/docs/RUNBOOK.md`, 'utf8');
    const start = runbook.indexOf('## 7. Health checks');
    const end = runbook.indexOf('## 8.', start);
    const section = start === -1 ? '' : runbook.slice(start, end === -1 ? undefined : end);
    expect(
      section.length,
      'RUNBOOK §7 Health checks is gone or renamed, so the blind spots have nowhere ' +
        'an operator reads them.',
    ).toBeGreaterThan(400);
    const missing = HEALTH_BLIND_SPOTS.filter((s) => !section.includes(s.name)).map((s) => s.name);
    expect(
      missing,
      'a health blind spot is declared in the fixture and absent from the runbook. ' +
        'The operator is the one being told `ok`.',
    ).toEqual([]);
  });

  it('the storage probe covers every variable without which presign cannot run', () => {
    /**
     * The narrowness check, applied to the probe itself rather than to the
     * word. `REQUIRED_STORAGE_ENV` is what `storageClient()` refuses without,
     * and `checkStorage()` returns `unconfigured` from exactly that list — so
     * a fifth variable added to the client and not to the list would make the
     * probe green on a deployment that still cannot presign.
     */
    const storage = readFileSync(`${ROOT}/src/lib/storage.ts`, 'utf8');
    const declared = HEALTH_PROBES.find((p) => p.id === 'storage');
    expect(declared, 'the storage probe is no longer declared').toBeDefined();
    if (!declared) return;

    const read = new Set(
      [...storage.matchAll(/process\.env\.(S3_[A-Z_]+)/g)].map((m) => m[1] ?? ''),
    );
    // `S3_REGION` defaults to `auto`, which is correct for R2 and for MinIO, so
    // an unset region is a working deployment rather than a broken one.
    read.delete('S3_REGION');

    const unprobed = [...read].filter((name) => !declared.covers.includes(name));
    expect(
      unprobed,
      'presign reads a variable the storage probe does not require. `checkStorage()` ' +
        'would answer `ok` on a deployment where an upload still cannot be signed — ' +
        'which is the original defect, one variable to the left.',
    ).toEqual([]);
  });

  it('the route probes exactly the subsystems it declares, and no others', () => {
    // The body's fields are the claim as the caller reads it. A field that is
    // never computed is a claim nobody checks; a probe with no field is a check
    // nobody can see.
    const route = readFileSync(`${ROOT}/src/app/api/health/route.ts`, 'utf8');
    for (const probe of HEALTH_PROBES) {
      expect(
        route,
        `/api/health declares no '${probe.id}' field, but ${probe.id} is listed as probed`,
      ).toMatch(new RegExp(String.raw`\b${probe.id}\s*:`));
      expect(
        route,
        `/api/health names '${probe.id}' but never calls ${probe.call}`,
      ).toContain(probe.call);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('the fixture describes the probes it claims to describe', () => {
  it('gives every probe a call site and at least one variable', () => {
    for (const probe of HEALTH_PROBES as readonly HealthProbe[]) {
      expect(probe.covers.length, `${probe.id} covers nothing`).toBeGreaterThan(0);
      expect(probe.call.length, `${probe.id} names no call`).toBeGreaterThan(2);
      expect(probe.why.length, `${probe.id} states no claim`).toBeGreaterThan(20);
    }
  });

  it('does not classify one variable twice', () => {
    const probed = HEALTH_PROBES.flatMap((p) => p.covers);
    const declared = HEALTH_BLIND_SPOTS.map((b) => b.name);
    const both = probed.filter((n) => declared.includes(n));
    expect(
      both,
      'a variable is both probed and declared unprobed. One of the two is wrong, ' +
        'and the partition is what makes the exhaustiveness check mean anything.',
    ).toEqual([]);
    expect(new Set(probed).size, 'a variable is probed twice').toBe(probed.length);
  });
});
