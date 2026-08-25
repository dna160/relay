/**
 * The process INV-7 kills.
 *
 * Runs one real `purgeEngagement()` against the live database, with an
 * `ObjectStore` backed by real files on disk so that "the bytes are gone" is a
 * fact about a filesystem rather than about a mock's call log.
 *
 * `RELAY_PURGE_PARK` names a point at which the store drops a sentinel file and
 * then never resolves, so the parent can SIGKILL this process at a known
 * checkpoint instead of racing a timer. The parked promise is deliberately one
 * that can never settle: a `setTimeout` long enough to be safe would still
 * settle on the run where the kill is slow, and the test would pass having
 * proved something else.
 *
 * Nothing in here is importable by the application. It exists to be killed.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, pool } from '@/db/client';
import { purgeEngagement, type ObjectStore } from '@/workers/purge';

const engagementId = process.env.RELAY_PURGE_ENGAGEMENT ?? '';
const storeRoot = process.env.RELAY_PURGE_STORE_ROOT ?? '';
const park = process.env.RELAY_PURGE_PARK ?? 'none';
const resume = process.env.RELAY_PURGE_RESUME === '1';

if (engagementId === '' || storeRoot === '') {
  console.error('RELAY_PURGE_ENGAGEMENT and RELAY_PURGE_STORE_ROOT are required');
  process.exit(2);
}

function objectPath(key: string): string {
  return join(storeRoot, Buffer.from(key).toString('base64url'));
}

function keysInBucket(): string[] {
  if (!existsSync(storeRoot)) return [];
  return readdirSync(storeRoot)
    .filter((f: string) => !f.startsWith('.') && !f.endsWith('.sentinel'))
    .map((f: string) => Buffer.from(f, 'base64url').toString('utf8'));
}

function drop(sentinel: string): void {
  mkdirSync(storeRoot, { recursive: true });
  writeFileSync(join(storeRoot, `${sentinel}.sentinel`), String(process.pid));
}

/** A promise that never settles. The process is expected to die here. */
function forever(): Promise<never> {
  return new Promise<never>(() => {
    /* intentionally empty */
  });
}

const store: ObjectStore = {
  async list(id: string) {
    if (park === 'list') {
      drop('list');
      await forever();
    }
    const prefix = `engagements/${id}/`;
    return { keys: keysInBucket().filter((k) => k.startsWith(prefix)), listed: true };
  },

  async remove(keys: readonly string[]) {
    if (park === 'remove') {
      drop('remove');
      await forever();
    }
    let deleted = 0;
    const half = Math.ceil(keys.length / 2);
    for (const [i, key] of keys.entries()) {
      if (park === 'remove-half' && i === half) {
        drop('remove-half');
        await forever();
      }
      const path = objectPath(key);
      if (existsSync(path)) {
        rmSync(path, { force: true });
        deleted += 1;
      } else {
        // A key already gone counts as success — this step is rerun by design.
        deleted += 1;
      }
    }
    return deleted;
  },
};

async function main(): Promise<void> {
  const result = await purgeEngagement(
    { db, store, env: process.env },
    engagementId,
    new Date(),
    { resume },
  );
  console.log(`CHILD_OK ${result.outcome} ${result.certificate.id}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(`CHILD_FAIL ${error instanceof Error ? error.message : String(error)}`);
    try {
      await pool.end();
    } catch {
      /* the pool may already be gone */
    }
    process.exit(1);
  });
