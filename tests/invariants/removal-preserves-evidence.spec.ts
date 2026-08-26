/**
 * REMOVAL — taking a card or a lane off the board without destroying the
 * evidence the product exists to preserve. ADR-026, `src/domain/board/removal.ts`.
 *
 * This is not a new invariant. It is INV-2, INV-3, INV-4 and INV-7 asked the
 * one question a delete button asks all four of them at once, and it lives in
 * its own file because the answer is a *conjunction* — each of the four holds
 * on its own today, and removal is the operation that can break them together.
 *
 * ## The hole every existing scan had, and why this file exists
 *
 * INV-4's scan is `delete(assetVersions)`. INV-7's is the disposition table.
 * Both are scans for a *spelling*, and the spelling is not how a removal
 * destroys an approval. From the committed migrations:
 *
 *     approvals.asset_version_id  ON DELETE cascade
 *     asset_versions.card_id      ON DELETE cascade
 *     cards.lane_id               ON DELETE cascade
 *     cards.engagement_id         ON DELETE cascade
 *     lanes.engagement_id         ON DELETE cascade
 *     engagements.org_id          ON DELETE cascade
 *
 * So `DELETE FROM lanes` destroys every approval standing in that column, and
 * the word `approvals` never appears in the statement that did it. Every
 * structural guard in this directory was blind to that until this file, and a
 * removal feature is exactly the code that writes such a statement.
 *
 * The set of tables a deletion may not touch is therefore **derived from the
 * migrations** (`cascadeAncestorsOf`) rather than written down. A later phase
 * that adds a table with a cascade widens the set on its own, which is the only
 * way a list like this survives a phase boundary.
 *
 * ## Archive is the stronger claim, so it is asserted as the stronger claim
 *
 * ADR-026 landed archive-rather-than-delete: `cards.archived_at` and
 * `lanes.archived_at`, both nullable timestamps, with a narrow `discard` path
 * that deletes only when the cascade has nothing to cascade to. That makes the
 * row *survive*, and a surviving row that the UI cannot see is worse than
 * either a leak or a deletion **if the purge walk cannot see it either** —
 * because then the certificate INV-7 leaves behind says the engagement was
 * destroyed while a row and its object are still there. So the archive is
 * asserted from both ends: invisible to a client (INV-1), visible to the purge
 * (INV-7).
 *
 * ## Vacuity, and how it is kept honest
 *
 * Every scan here is a "must not contain". A scan that finds nothing and a scan
 * that *cannot* find anything look identical, so the patterns are exported and
 * planted against in `tests/unit/invariant-scans-are-not-escapable.spec.ts`,
 * written the way a removal feature would actually write the violation.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { except, modulesReachableFrom, sourceFiles, statementsMatching } from './_source';
import {
  allMigrationSql,
  cascadeAncestorsOf,
  cascadeEdges,
  createTableBody,
  hasMigrations,
} from './_sql';
import { TABLE_DISPOSITION } from '@/domain/retention/manifest';
import { cardStateEnum } from '@/db/schema/enums';

/* -------------------------------------------------------------------------- */
/* The vocabulary of the scans.                                               */
/* -------------------------------------------------------------------------- */

/** The one file permitted to destroy an engagement's content (INV-7). */
const PURGE_WORKER = 'src/workers/purge.ts';

/** Where removal lives. ADR-026 puts the whole of it in one file on purpose. */
const REMOVAL_DOMAIN = 'src/domain/board/';

/**
 * The rows an approval's evidence is made of. INV-3: an approval binds one
 * immutable version and stores that version's sha256 at decision time, so that
 * "approved" survives a dispute six months later. Destroying either half
 * destroys the claim.
 */
export const EVIDENCE_TABLES = ['approvals', 'asset_versions'] as const;

/**
 * Tables nothing may ever delete from — not even the purge worker, which is the
 * thing they are the record of. INV-7: purge leaves *exactly one* certificate.
 */
export const INDESTRUCTIBLE_TABLES = ['purge_certificates', 'purge_manifest'] as const;

/** `asset_versions` -> `assetVersions`. drizzle's naming, mechanically. */
function symbolFor(table: string): string {
  return table.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * One function's body, brace-counted from its declaration.
 *
 * A file-wide scan cannot distinguish `removeLane`'s occupancy count — which
 * must *not* filter on the archive — from `restoreLane`'s live count, which
 * must. Two functions, opposite obligations, forty lines apart. Anything
 * coarser than a body is a guard that has to be relaxed the first time it is
 * right for the wrong reason.
 */
export function functionBody(text: string, name: string): string | null {
  const decl = text.search(
    new RegExp(String.raw`(?:export\s+)?(?:async\s+)?function\s+${name}\s*[(<]`),
  );
  if (decl === -1) return null;
  const open = text.indexOf('{', text.indexOf(')', decl));
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * A delete against one table, in either dialect.
 *
 * Both halves are needed and neither subsumes the other: drizzle's builder
 * names a symbol and never the table, raw SQL names the table and imports no
 * symbol. `\.delete\s*\(` rather than a bare `delete` so that
 * `map.delete(key)` — which this tree does use — is not a database write.
 */
export function deletePattern(table: string): RegExp {
  return new RegExp(
    String.raw`\.delete\s*\(\s*${symbolFor(table)}\s*\)|DELETE\s+FROM\s+"?${table}"?\b`,
    'i',
  );
}

/** A predicate on the removal column, in either dialect. */
export const ARCHIVED_PREDICATE = new RegExp(
  [
    // `isNull(cards.archivedAt)`, `isNotNull(lanes.archivedAt)`.
    String.raw`\b(isNull|isNotNull)\s*\(\s*[A-Za-z0-9_$]+\s*\.\s*archivedAt\s*\)`,
    // `archived_at IS NULL`, `archived_at IS NOT NULL`.
    String.raw`archived_at\s+IS\s+(?:NOT\s+)?NULL`,
    // `.archivedAt === null`, `!= null`, and the `== null` shorthand.
    String.raw`\.archivedAt\s*(?:===|!==|==|!=)(?!=)\s*(?:null|undefined)`,
  ].join('|'),
  'i',
);

/* -------------------------------------------------------------------------- */
/* The allowlists, and what each one is buying.                               */
/*                                                                            */
/* DEFECT-6's lesson: an exclusion list and the list that pays for it must not */
/* be the same array, or a rename makes both vacuous at once. Each entry below */
/* is paid for by a test further down that names the path independently.      */
/* -------------------------------------------------------------------------- */

export const CASCADE_DELETERS: readonly { path: string; why: string }[] = [
  {
    path: PURGE_WORKER,
    why: 'INV-7 — the one sanctioned destroyer, and it ends in a certificate',
  },
  {
    path: 'src/domain/board/removal.ts',
    why:
      'ADR-026 discard: deletes only a row whose cascade has nothing to cascade to, ' +
      'proved by counting every table with a foreign key to it first',
  },
  {
    path: 'src/db/backfill/identity-graph.ts',
    why:
      'the Phase 9 reversal deletes the personal organizations it created; an org ' +
      'cascades to engagements, so the delete is scoped to rows the backfill wrote',
  },
];

const CASCADE_DELETER_PATHS = CASCADE_DELETERS.map((e) => e.path);

/* ========================================================================== */

describe('removal cannot destroy the evidence, whatever it is spelled', () => {
  const FILES = sourceFiles();

  it('has source and migrations to scan, so an empty sweep is not a pass', () => {
    // Every case below is a "must not contain". If the walk breaks, they all
    // pass and nothing is guarded. This is the one case that fails instead.
    expect(FILES.length).toBeGreaterThan(20);
    expect(hasMigrations(), 'no migrations to derive the cascade graph from').toBe(true);
    expect(
      cascadeEdges().length,
      'no ON DELETE cascade found in the migrations. Either the parser stopped ' +
        'working or the schema changed shape; either way the derived set below is empty ' +
        'and every scan built on it is vacuous.',
    ).toBeGreaterThan(10);
  });

  it('derives the forbidden set from the migrations, and it contains the board', () => {
    const forbidden = cascadeAncestorsOf(EVIDENCE_TABLES);
    // Pinned, so that a migration which *removes* a cascade — quietly narrowing
    // what this file guards — fails here rather than silently.
    for (const table of ['approvals', 'asset_versions', 'cards', 'lanes', 'engagements']) {
      expect(
        forbidden,
        `${table} no longer reaches the evidence by cascade. If a foreign key was ` +
          'changed, say so here; if it was not, the derivation is broken and every ' +
          'scan below just got narrower without anyone deciding that.',
      ).toContain(table);
    }
  });

  it('no code outside the purge worker deletes an approval', () => {
    // INV-4 has this case for `asset_versions` and nothing had it for
    // `approvals`, which is the other half of what INV-3 binds together.
    const offenders: string[] = [];
    for (const file of except(FILES, PURGE_WORKER)) {
      for (const stmt of statementsMatching(file, deletePattern('approvals'))) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'an approval was deleted outside the purge worker. An approval is the ' +
        'evidence a client said yes to a specific set of bytes (INV-3); the only ' +
        'sanctioned way for it to stop existing is a certified purge (INV-7).',
    ).toEqual([]);
  });

  it('nothing anywhere deletes a purge certificate or a manifest row', () => {
    // Not even the purge worker. These are the record that the destruction
    // happened, and RUNBOOK §6 triages against them afterwards.
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const table of INDESTRUCTIBLE_TABLES) {
        for (const stmt of statementsMatching(file, deletePattern(table))) {
          offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
        }
      }
    }
    expect(
      offenders,
      'the evidence that a purge happened was deleted. Content gone with no ' +
        'certificate is the one unrecoverable outcome in this product.',
    ).toEqual([]);
  });

  it('no unlisted file deletes a row that cascades into the evidence', () => {
    /**
     * The case that would have caught a lane delete.
     *
     * The forbidden set is derived, so it already covers a table a later phase
     * adds with a cascade of its own — which is the whole point, because the
     * next removal feature will not be a lane.
     */
    const forbidden = cascadeAncestorsOf(EVIDENCE_TABLES);
    const offenders: string[] = [];
    for (const file of FILES) {
      if (CASCADE_DELETER_PATHS.includes(file.path)) continue;
      for (const table of forbidden) {
        for (const stmt of statementsMatching(file, deletePattern(table))) {
          offenders.push(`${file.path}: deletes ${table} — ${stmt.slice(0, 120)}`);
        }
      }
    }
    expect(
      offenders,
      'a row was deleted whose cascade reaches an approval or an immutable ' +
        'version. The word "approvals" does not have to appear for the approvals to ' +
        'go: ON DELETE cascade does it silently, outside the purge worker and with no ' +
        'certificate. Archive it instead, or add a paid-for entry to CASCADE_DELETERS.',
    ).toEqual([]);
  });

  it('every allowlist entry says what it is buying', () => {
    for (const { path, why } of CASCADE_DELETERS) {
      expect(why.length, `${path} is excluded with no stated reason`).toBeGreaterThan(20);
    }
  });

  it('every allowlisted path exists, so no exclusion is running unbacked', () => {
    // DEFECT-6, mechanised. A path that has been renamed away goes on excluding
    // forever and nothing says so.
    const missing = CASCADE_DELETER_PATHS.filter((p) => !FILES.some((f) => f.path === p));
    expect(
      missing,
      'an allowlisted deleter does not exist. Either it moved — in which case the ' +
        'exclusion is now a hole in the exact shape of the thing being forbidden — or ' +
        'it is gone and the entry should be too.',
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* The payments.                                                              */
/* ========================================================================== */

describe('the discard path is allowed to delete only because it proves it destroys nothing', () => {
  const REMOVAL = 'src/domain/board/removal.ts';

  /**
   * Every table with a foreign key to `table`, from the migrations.
   *
   * `removal.ts` states its one maintenance obligation in prose — "if a fourth
   * table ever references `cards`, it belongs here" — and a stated obligation
   * with no enforcement is a procedure. This derives the list the obligation is
   * about, so the fourth table fails the build on the day it lands rather than
   * on the day a cascade fires in production.
   */
  function referrersTo(table: string): string[] {
    const sql = allMigrationSql();
    const found = new Set<string>();
    for (const m of sql.matchAll(
      /ALTER TABLE\s+"([a-z_]+)"\s+ADD CONSTRAINT[^;]*?REFERENCES\s+(?:"public"\.)?"([a-z_]+)"/gi,
    )) {
      if ((m[2] ?? '') === table && (m[1] ?? '') !== table) found.add(m[1] ?? '');
    }
    return [...found].sort();
  }

  it('counts a dependent for every table that references cards', () => {
    const file = sourceFiles().find((f) => f.path === REMOVAL);
    expect(file, `${REMOVAL} is missing`).toBeDefined();
    if (!file) return;

    const referrers = referrersTo('cards');
    expect(referrers.length, 'nothing references cards; the derivation is broken').toBeGreaterThan(2);

    /**
     * `approvals` and `revision_notes` hang off `asset_versions`, not off
     * `cards`, so they are covered transitively: a card with no versions has
     * neither, and a card with versions is archived rather than deleted. That
     * is `removal.ts`'s own argument and it is sound — it is recorded here so
     * that the exemption is a decision rather than an omission.
     */
    const missing = referrers.filter((t) => !new RegExp(`\\b${symbolFor(t)}\\b`).test(file.text));
    expect(
      missing,
      'a table has a foreign key to `cards` and the discard path does not count it. ' +
        'The delete would cascade through it. `cardDependents()` is the list; this is ' +
        'the check that the list is the whole list.',
    ).toEqual([]);
  });

  it('counts every card in a lane before discarding it, archived ones included', () => {
    const file = sourceFiles().find((f) => f.path === REMOVAL);
    if (!file) return;

    /**
     * The one place the archive could open a hole, and it is the sharpest edge
     * in this whole feature: a lane holding only archived cards **looks empty
     * on the board** and is not empty in the database. A discard that reused
     * the board's own "live cards" predicate to decide emptiness would delete
     * the lane, cascade through those cards, and take every version and
     * approval under them — while the author read a query that was correct
     * everywhere else in the file.
     *
     * So the assertion is scoped to `removeLane`'s own body. `restoreLane`
     * *does* filter on `archived_at`, correctly and for the opposite reason —
     * it reports how many cards came back — and a file-wide scan cannot tell
     * the two apart.
     */
    const body = functionBody(file.text, 'removeLane');
    expect(body, 'removeLane is gone; drop this case with it').not.toBeNull();
    if (body === null) return;

    expect(body, 'removeLane no longer deletes anything').toMatch(deletePattern('lanes'));

    /**
     * The occupancy query itself, not the whole body. `removeLane` also reads
     * `lane.archivedAt` for its idempotency branch — the second click of a
     * double-click is not a different intention — and that is a read of the
     * lane's own column, not a filter on the cards it is counting.
     */
    const occupancy = body.match(/\.from\s*\(\s*cards\s*\)([\s\S]*?);/);
    expect(
      occupancy,
      'removeLane no longer reads the cards table before deciding. It has to: the ' +
        'whole permission to delete rests on the lane holding none.',
    ).not.toBeNull();
    expect(body, 'removeLane no longer counts what it reads').toMatch(/count\s*\(\s*\)/);
    expect(
      ARCHIVED_PREDICATE.test(occupancy?.[1] ?? ''),
      'the lane occupancy count filters on archived_at. A lane is only ever safe to ' +
        'delete when it holds no cards *at all* — an archived card is still a card, and ' +
        'still the parent of every version and approval under it.',
    ).toBe(false);
  });

  it('deletes only inside a transaction that locked the row first', () => {
    const file = sourceFiles().find((f) => f.path === REMOVAL);
    if (!file) return;
    // A dependent count and a delete in two snapshots is a delete authorised
    // against a card that did not have the version yet. `FOR UPDATE` on the
    // parent conflicts with the `FOR KEY SHARE` Postgres takes for a child
    // insert's foreign key, which is what actually makes the count hold.
    expect(file.text, 'the removal path no longer locks the row it counts').toMatch(
      /\.for\s*\(\s*['"]update['"]\s*\)/,
    );
    for (const stmt of statementsMatching(file, /\.delete\s*\(/)) {
      expect(stmt, `a delete outside a transaction: ${stmt.slice(0, 120)}`).toMatch(/tx\s*$|^\s*await\s+tx|tx\s*\n?\s*\./);
    }
  });

  it('the backfill reversal deletes only rows the backfill itself wrote', () => {
    // The payment for `src/db/backfill/identity-graph.ts`. `organizations`
    // cascades to `engagements`, which cascades to `cards`, which cascades to
    // the versions and the approvals — five hops from a reversal to the
    // evidence, with no certificate anywhere on the path.
    const file = sourceFiles().find((f) => f.path === 'src/db/backfill/identity-graph.ts');
    expect(file, 'the backfill is allowlisted and does not exist').toBeDefined();
    if (!file) return;

    const forbidden = cascadeAncestorsOf(EVIDENCE_TABLES);
    for (const table of forbidden) {
      for (const stmt of statementsMatching(file, deletePattern(table))) {
        expect(
          /backfilledAt|backfilled_at/.test(stmt),
          `the reversal deletes ${table} without restricting itself to rows it wrote: ` +
            stmt.slice(0, 160),
        ).toBe(true);
      }
    }
  });

  it('the backfill is unreachable from anything a request can call', () => {
    // The second, independent payment. The reversal is safe exactly while no
    // route can reach it — and this does not iterate the same array the
    // exclusion does, which is DEFECT-6's lesson.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.path.startsWith('src/app/')) continue;
      for (const stmt of statementsMatching(file, /from\s+['"][^'"]*db\/backfill[^'"]*['"]/)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(offenders, 'a route imported the identity backfill').toEqual([]);
  });
});

/* ========================================================================== */
/* INV-2 — removal is not a second writer of cards.state.                     */
/* ========================================================================== */

describe('removal is not a second writer of cards.state', () => {
  it('did not add itself to the card state enum', () => {
    // The tempting shape: `state = 'archived'`. It would make removal a
    // transition, and then every guard on the state machine becomes a guard on
    // removal too — including the ones that say a card cannot leave
    // `signed_off`. ADR-026 chose a nullable timestamp precisely so that
    // `cards.state` is untouched and INV-2 has nothing to say about removal.
    const declared = cardStateEnum.enumValues;
    for (const word of ['archived', 'removed', 'deleted', 'discarded', 'hidden']) {
      expect(
        declared,
        `'${word}' became a card state. Removal is orthogonal to the approval ` +
          'machine: an archived card that was awaiting_client is still awaiting the ' +
          'client if it comes back, and a machine with a trapdoor from every state to ' +
          'one state and back is not a machine.',
      ).not.toContain(word);
    }

    const body = createTableBody('card_state') ?? allMigrationSql();
    for (const word of ['archived', 'removed', 'discarded']) {
      expect(
        new RegExp(String.raw`ALTER TYPE\s+"?(?:public\.)?card_state"?[^;]*${word}`, 'i').test(body),
        `a migration added '${word}' to the card_state type`,
      ).toBe(false);
    }
  });

  it('the removal domain never writes a state column', () => {
    // INV-2's own scan already covers the whole tree. This states the claim
    // where the removal code is read, so that the argument in `removal.ts`'s
    // header — "the word `state` does not appear in a write position anywhere
    // below" — is checked rather than believed.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.path.startsWith(REMOVAL_DOMAIN)) continue;
      for (const stmt of statementsMatching(file, /\.set\s*\(\s*\{[^}]*\bstate\s*:/)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
      for (const stmt of statementsMatching(file, /\bfromState\s*:|\btoState\s*:/)) {
        offenders.push(`${file.path}: writes a transition — ${stmt.slice(0, 120)}`);
      }
    }
    expect(
      offenders,
      'removal wrote a card state or a transition row. INV-2: `cards.state` changes ' +
        'only via `domain/card/state-machine.ts`, and INV-5 derives the possession clock ' +
        'from `state_transitions` alone — a removal that appends to it moves the clock ' +
        'for a card nobody is waiting on.',
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* INV-7 — a removed row is still reachable by the purge walk.                */
/* ========================================================================== */

describe('the purge walk still sees a removed row', () => {
  /**
   * The purge worker and the manifest builder, plus everything they import.
   *
   * The predicate that would hide an archived card from the purge does not have
   * to be written in `purge.ts`. It only has to be somewhere `purge.ts` reads —
   * a shared "load the live board" helper is the obvious way it happens, and it
   * would be a reasonable-looking change in a query file nobody associates with
   * retention.
   */
  const PURGE_REACH = modulesReachableFrom([
    PURGE_WORKER,
    'src/domain/retention/manifest.ts',
    'src/workers/purge-cli.ts',
  ]);

  it('reaches the manifest builder and the queries under it, so the sweep is not empty', () => {
    expect(PURGE_REACH.has(PURGE_WORKER), 'the purge worker moved').toBe(true);
    expect(
      PURGE_REACH.has('src/domain/retention/manifest.ts'),
      'the walk does not reach the manifest builder',
    ).toBe(true);
    expect(PURGE_REACH.size, 'the import walk collapsed to its entry points').toBeGreaterThan(5);
  });

  it('applies no removal predicate anywhere on the path to a manifest', () => {
    const offenders: string[] = [];
    for (const path of PURGE_REACH.keys()) {
      // The schema *defines* `archivedAt`; defining a column is not filtering
      // on one, and the definition is unavoidably on this path.
      if (path.startsWith('src/db/schema/')) continue;
      const file = sourceFiles().find((f) => f.path === path);
      if (!file) continue;
      for (const stmt of statementsMatching(file, ARCHIVED_PREDICATE)) {
        offenders.push(`${path}: ${stmt.slice(0, 160)} (via ${(PURGE_REACH.get(path) ?? []).join(' -> ')})`);
      }
    }
    expect(
      offenders,
      'the purge walk filters on the removal column. An archived card excluded from ' +
        'the manifest keeps its row and its object bytes through a purge that certifies ' +
        'they were destroyed — which makes the certificate false, and the certificate is ' +
        'the compliance artifact the agency forwards to its client\'s legal team. ' +
        'A row invisible to the UI that survives a purge is worse than either outcome alone.',
    ).toEqual([]);
  });

  it('enumerates cards and lanes by engagement alone, with no second predicate', () => {
    const worker = sourceFiles().find((f) => f.path === PURGE_WORKER);
    expect(worker, 'the purge worker is missing').toBeDefined();
    if (!worker) return;
    // `destroyContent` selects the card ids it is about to delete. Anything
    // narrower than "every card in this engagement" leaves rows behind.
    expect(worker.text, 'the purge no longer selects cards by engagement').toMatch(
      /from\s*\(\s*cards\s*\)[\s\S]{0,120}?eq\s*\(\s*cards\.engagementId/,
    );
    expect(worker.text, 'the purge no longer deletes lanes by engagement').toMatch(
      /delete\s*\(\s*lanes\s*\)[\s\S]{0,120}?eq\s*\(\s*lanes\.engagementId/,
    );
  });

  it('counts every table it classifies as content, so a removal table cannot escape', () => {
    /**
     * INV-7 already asserts that every table in the schema has a disposition.
     * The half nobody had is the other direction: a table classified `content`
     * that the *manifest* never counts is a table the certificate is silent
     * about. If removal ever grows a table of its own — a tombstone, an undo
     * ledger — it lands in `TABLE_DISPOSITION` and this is what notices the
     * manifest does not count it.
     */
    const manifest = sourceFiles().find((f) => f.path === 'src/domain/retention/manifest.ts');
    expect(manifest, 'the manifest builder is missing').toBeDefined();
    if (!manifest) return;

    const content = Object.entries(TABLE_DISPOSITION)
      .filter(([, disposition]) => disposition === 'content')
      .map(([table]) => table);
    expect(content.length, 'nothing is classified as content').toBeGreaterThan(5);

    const uncounted = content.filter(
      (table) => !new RegExp(String.raw`table:\s*['"]${table}['"]`).test(manifest.text),
    );
    expect(
      uncounted,
      'a table is destroyed by the purge and absent from the manifest it certifies. ' +
        'The certificate carries a row count per table and a sha256 over exactly that ' +
        'list, so a destroyed table missing from it is a certificate that understates ' +
        'what was taken.',
    ).toEqual([]);
  });
});

/* ========================================================================== */
/* INV-1 — a client sees no removed card, and infers none.                    */
/* ========================================================================== */

describe('a removed card is invisible to a client at both layers', () => {
  it('the client scope filters archived cards and archived lanes in SQL', () => {
    const scope = sourceFiles().find((f) => f.path === 'src/db/queries/client-scope.ts');
    expect(scope, 'the client scope is missing').toBeDefined();
    if (!scope) return;

    expect(
      statementsMatching(scope, /isNull\s*\(\s*cards\.archivedAt\s*\)/).length,
      'the client scope does not exclude archived cards. INV-1 is enforced at the ' +
        'query layer, never in the UI.',
    ).toBeGreaterThan(0);
    expect(
      statementsMatching(scope, /isNull\s*\(\s*lanes\.archivedAt\s*\)/).length,
      'the client scope does not exclude archived lanes. An archived lane hides its ' +
        'cards without touching a card row, so the card predicate alone does not cover it.',
    ).toBeGreaterThan(0);
  });

  it('the composed board predicate carries both, so a caller cannot get one without the other', () => {
    const scope = sourceFiles().find((f) => f.path === 'src/db/queries/client-scope.ts');
    if (!scope) return;
    // `visibleBoard` is what every client read composes. If the lane half lives
    // only in a separately-named predicate, every existing call site has to be
    // edited by hand — and the one that is not edited is the leak.
    const composed = scope.text.match(/visibleBoard\s*:\s*and\s*\(([\s\S]*?)\)\s*as\s+SQL/);
    expect(composed, 'visibleBoard is no longer a composed `and(...)`').not.toBeNull();
    const body = composed?.[1] ?? '';
    expect(body, 'visibleBoard does not carry the live-lane predicate').toMatch(/liveLanes/);
    expect(body, 'visibleBoard does not carry the visible-card predicate').toMatch(/visibleCards/);
  });

  it('the projection rejects an archived card and an archived lane in code as well', () => {
    // The second net. ADR-006's split: the query layer is the enforcing half,
    // and the serialiser refuses rather than trusting it — which is what caught
    // the round-1 defect where `toClientCard` had no check of its own.
    const view = sourceFiles().find((f) => f.path === 'src/domain/projection/client-view.ts');
    expect(view, 'the client projection is missing').toBeDefined();
    if (!view) return;
    expect(
      view.text,
      'isLaneVisibleToClient does not consider the archive',
    ).toMatch(/isLaneVisibleToClient[\s\S]{0,200}?archivedAt/);
    expect(
      view.text,
      'isCardVisibleToClient does not consider the archive',
    ).toMatch(/isCardVisibleToClient[\s\S]{0,300}?archivedAt/);
  });

  it('never tells a client why a card is missing', () => {
    // The inference channel that is not the ordering: an error body naming the
    // reason. `ClientVisibilityError` is deliberately an internal crash — INV-1
    // says a client must not be able to infer that a removed card existed, and
    // "this card is archived" is that inference, handed over.
    const offenders: string[] = [];
    for (const file of sourceFiles('app/api/client')) {
      for (const stmt of statementsMatching(file, /ClientVisibilityError|CLIENT_VISIBILITY_VIOLATION/)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'a client route names the visibility error. Its message says which of ' +
        'archived / private / draft applied, which is exactly the fact INV-1 says a ' +
        'client must not be able to infer.',
    ).toEqual([]);
  });
});
