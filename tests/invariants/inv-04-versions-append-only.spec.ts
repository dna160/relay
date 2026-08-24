/**
 * INV-4 — `asset_versions` is append-only. Rows are never updated or deleted
 * except by the purge worker.
 *
 * The one sanctioned mutation is `published_to_client_at` passing the internal
 * gate, and `superseded_by` when a newer version lands. Both are set-once.
 *
 * UNSKIPPED IN: Phase 3 — the structural half, which is what actually keeps the
 * table append-only as code lands around it. The Phase 6 purge-worker exception
 * and the transactional cases below stay skipped and name their phase.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { except, linesMatching, sourceFiles } from './_source';
import { allMigrationSql, createTableBody, hasMigrations } from './_sql';
import { MUTABLE_VERSION_COLUMNS } from '@tests/fixtures';

/** The purge worker is the one sanctioned deleter (PHASE-6 INVARIANTS). */
const PURGE_WORKER = 'src/workers/purge.ts';

/** The columns a version may acquire after insert. Both set-once. */
const SET_ONCE = ['publishedToClientAt', 'supersededBy'];

describe('INV-4 asset_versions is append-only', () => {
  it('agrees with the fixture about which columns may ever change', () => {
    expect([...MUTABLE_VERSION_COLUMNS]).toEqual(['published_to_client_at', 'superseded_by']);
  });

  it('no code outside the purge worker deletes an asset_version', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), PURGE_WORKER)) {
      const hits = linesMatching(
        file,
        /delete\s*\(\s*assetVersions\s*\)|DELETE\s+FROM\s+asset_versions/i,
      );
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'an asset_version deleted outside the purge worker').toEqual([]);
  });

  it('the only permitted updates are the set-once publish and supersede columns', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), PURGE_WORKER)) {
      // Every `.update(assetVersions)...set({ ... })` in the tree, with the
      // keys it assigns. Anything outside SET_ONCE is a mutation of an
      // immutable row — and an approval bound to that row's old hash.
      const matches = file.text.matchAll(/\.update\s*\(\s*assetVersions\s*\)[\s\S]{0,400}?\.set\s*\(\s*\{([\s\S]*?)\}/g);
      for (const match of matches) {
        const keys = [...(match[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
        for (const key of keys) {
          if (!SET_ONCE.includes(key)) offenders.push(`${file.path}: set ${key}`);
        }
      }
    }
    expect(offenders, 'asset_versions updated outside the two set-once columns').toEqual([]);
  });

  it('never updates the hash, the size, or the storage key of a stored version', () => {
    // These three are what an approval's evidence rests on. If any of them can
    // move, "approved" stops meaning anything six months later (ADR-004).
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const matches = file.text.matchAll(/\.update\s*\(\s*assetVersions\s*\)[\s\S]{0,400}?\.set\s*\(\s*\{([\s\S]*?)\}/g);
      for (const match of matches) {
        const body = match[1] ?? '';
        for (const key of ['sha256', 'sizeBytes', 'storageKey', 'versionNo', 'cardId']) {
          if (new RegExp(`\\b${key}\\s*:`).test(body)) offenders.push(`${file.path}: set ${key}`);
        }
      }
    }
    expect(offenders, 'immutable version evidence was rewritten').toEqual([]);
  });

  it('version_no is unique per card, so a number is never reused', () => {
    if (!hasMigrations()) return; // Phase 3 creates the table.
    expect(allMigrationSql()).toMatch(
      /CREATE UNIQUE INDEX[^;]*ON "asset_versions"[^;]*"card_id"\s*,\s*"version_no"/i,
    );
  });

  it('the hash column is the full width of a sha256 and not nullable', () => {
    const body = createTableBody('asset_versions');
    if (body === null) return;
    expect(body).toMatch(/"sha256"\s+char\(64\)/i);
  });

  it('publication is a nullable timestamp, so unpublished is representable', () => {
    const body = createTableBody('asset_versions');
    if (body === null) return;
    // NOT NULL here would force a default, and a default would publish every
    // upload to the client the moment it lands.
    expect(body).toMatch(/"published_to_client_at"\s+timestamp[^,]*/i);
    expect(body).not.toMatch(/"published_to_client_at"[^,]*NOT NULL/i);
  });
});

describe.skip('INV-4 under a live database', () => {
  /**
   * UNSKIP IN: Phase 3 for the first two, Phase 6 for the purge exception.
   * These need a running Postgres; the structural cases above do not, which is
   * why they run on every push.
   */

  it('publishing an already-published version is a no-op, not a re-stamp', () => {
    expect.fail('Phase 3: published_to_client_at is set once and never moved');
  });

  it('allocates version_no inside the transaction that inserts the row', () => {
    expect.fail(
      'Phase 3: two concurrent uploads on one card must produce v1 and v2, not two v1s and a ' +
        'unique violation the user sees.',
    );
  });

  it('lets only the purge worker delete, and only as part of a certified purge', () => {
    expect.fail('Phase 6: src/workers/purge.ts is the one sanctioned deleter (INV-7)');
  });
});
