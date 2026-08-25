/**
 * The negative tests for the structural invariants.
 *
 * Every guard in `tests/invariants/` that works by reading the source tree has
 * the same failure mode: it is green when the tree is clean *and* green when
 * the violation is written in a shape the regex does not happen to see. The
 * suite cannot tell those two apart, and neither can a reviewer. So each scan
 * gets a corpus of planted violations here — written the way someone would
 * actually write them, not the way the regex would like them written — and the
 * assertion is that the guard catches every one.
 *
 * These plants are strings, not files. Editing `src/` to prove a guard works
 * means a window in which the repository contains a real invariant violation,
 * and this build has three other agents in `src/` at once.
 *
 * ## What this file already caught
 *
 * Every scan in `tests/invariants/` was built on `linesMatching`, which reads
 * one physical line. The escape needs no cleverness at all — it is what a
 * formatter does to a long drizzle chain:
 *
 *     await db
 *       .insert(cards)
 *       .values({ ... });
 *
 * `db` and `.insert(` are never on one line together, so INV-9's route scan
 * could not see it. The same wrap hides `state:` inside a `.set({` from INV-2.
 * `statements()` closes that, and the `linesMatching` half of each case below
 * is kept deliberately, as the proof that the hole was real.
 */

import { describe, expect, it } from 'vitest';
import { linesMatching, statements, statementsMatching, stripComments } from '@tests/invariants/_source';
import type { SourceFile } from '@tests/invariants/_source';
import { STATE_WRITE } from '@tests/invariants/inv-02-state-machine-sole-writer.spec';
import {
  APP_LAYER_WRITE,
  SERVER_SURFACE_PATTERN,
} from '@tests/invariants/inv-09-domain-purity.spec';
import { BYTE_INTAKE, BYTE_EGRESS } from '@tests/invariants/inv-10-no-bytes-through-app.spec';

/** Builds the shape `sourceFiles()` hands a scan, comments already stripped. */
function planted(path: string, text: string): SourceFile {
  return { path, text: stripComments(text) };
}

function caughtBy(file: SourceFile, patterns: readonly RegExp[]): boolean {
  return patterns.some((re) => statementsMatching(file, re).length > 0);
}

/* -------------------------------------------------------------------------- */

describe('the statement splitter', () => {
  it('joins a wrapped fluent chain back into one statement', () => {
    const file = planted(
      'src/x.ts',
      ['await db', '  .update(cards)', '  .set({ state: 1 })', '  .where(eq(cards.id, id));'].join('\n'),
    );
    const found = statements(file).filter((s) => s.includes('.update(cards)'));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('db .update(cards) .set({ state: 1 })');
  });

  it('does not run two independent statements together', () => {
    const file = planted('src/x.ts', 'const a = one();\nconst b = two();\n');
    expect(statements(file)).toEqual(['const a = one();', 'const b = two();']);
  });

  it('keeps an object literal bounded, so [^}] patterns stay scoped', () => {
    // If the splitter flattened braces away, `.set({ title })` followed later
    // by an unrelated `state:` would look like a state write and fail the build
    // for the wrong reason. That false positive is as bad as the miss.
    const file = planted(
      'src/x.ts',
      ['await db.update(cards).set({ title });', 'const view = { state: card.state };'].join('\n'),
    );
    expect(statementsMatching(file, STATE_WRITE)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('INV-2 — a wrapped state write cannot hide from the scan', () => {
  const PLANTS: { why: string; code: string }[] = [
    {
      why: 'the house style, wrapped by the formatter',
      code: ['await tx', '  .update(cards)', '  .set({', "    state: 'approved',", '  })', '  .where(eq(cards.id, id));'].join('\n'),
    },
    {
      why: 'one line, the shape the original scan was written for',
      code: "await tx.update(cards).set({ state: 'approved' }).where(eq(cards.id, id));",
    },
    {
      why: 'extra keys before the state key',
      code: ['await tx', '  .update(cards)', '  .set({ updatedAt: now, state: next, roundsUsed: 3 });'].join('\n'),
    },
    {
      why: 'a different executor binding',
      code: ['await executor', '  .update(cards)', '  .set({', '    state: next,', '  });'].join('\n'),
    },
  ];

  for (const { why, code } of PLANTS) {
    it(`catches a state write: ${why}`, () => {
      expect(statementsMatching(planted('src/db/queries/bad.ts', code), STATE_WRITE)).not.toEqual([]);
    });
  }

  it('the line-based scan missed the wrapped form — this is the hole that was closed', () => {
    const wrapped = planted('src/db/queries/bad.ts', PLANTS[0]!.code);
    expect(
      linesMatching(wrapped, STATE_WRITE),
      'if this ever finds the violation, the line-based scan was adequate after all',
    ).toEqual([]);
    expect(statementsMatching(wrapped, STATE_WRITE)).not.toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('INV-9 — the app layer cannot write around the guard', () => {
  it('a server action that writes is on the scanned surface', () => {
    expect(SERVER_SURFACE_PATTERN.test('src/app/(agency)/signin/actions.ts')).toBe(true);
    expect(SERVER_SURFACE_PATTERN.test('src/app/(agency)/portfolio/page.tsx')).toBe(true);
    expect(SERVER_SURFACE_PATTERN.test('src/app/api/cards/[id]/route.ts')).toBe(true);
    // The old scan only looked at route files. That is the escape: move the
    // insert into the server action next door and nothing notices.
    expect(/\/route\.tsx?$/.test('src/app/(agency)/signin/actions.ts')).toBe(false);
  });

  const PLANTS: { why: string; code: string }[] = [
    { why: 'a wrapped insert', code: ['await db', '  .insert(cards)', '  .values(row);'].join('\n') },
    { why: 'a single-line insert', code: 'await db.insert(cards).values(row);' },
    { why: 'a wrapped update', code: ['await tx', '  .update(engagements)', '  .set({ status });'].join('\n') },
    { why: 'a wrapped delete', code: ['await exec', '  .delete(comments)', '  .where(eq(comments.id, id));'].join('\n') },
  ];

  for (const { why, code } of PLANTS) {
    it(`catches an app-layer write: ${why}`, () => {
      expect(statementsMatching(planted('src/app/x/actions.ts', code), APP_LAYER_WRITE)).not.toEqual([]);
    });
  }

  it('the line-based scan missed every wrapped write', () => {
    for (const { code } of PLANTS.filter((p) => p.code.includes('\n'))) {
      expect(linesMatching(planted('src/app/x/route.ts', code), APP_LAYER_WRITE)).toEqual([]);
    }
  });

  it('a read is not a write', () => {
    const read = planted('src/app/x/page.tsx', ['const rows = await db', '  .select()', '  .from(cards);'].join('\n'));
    expect(statementsMatching(read, APP_LAYER_WRITE)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('INV-10 — byte intake cannot hide behind a parameter name', () => {
  const PLANTS: { why: string; code: string }[] = [
    { why: 'the canonical shape', code: 'const form = await request.formData();' },
    { why: 'the short parameter name', code: 'const form = await req.formData();' },
    {
      why: 'a renamed handler parameter — the escape the old regex allowed',
      code: 'export async function POST(r: Request) { const form = await r.formData(); }',
    },
    { why: 'destructured onto a local', code: ['const input = request;', 'const bytes = await input.arrayBuffer();'].join('\n') },
    { why: 'wrapped across lines', code: ['const bytes = await request', '  .arrayBuffer();'].join('\n') },
    { why: 'a blob read', code: 'const b = await request.blob();' },
  ];

  for (const { why, code } of PLANTS) {
    it(`catches byte intake: ${why}`, () => {
      expect(caughtBy(planted('src/app/api/x/route.ts', code), BYTE_INTAKE)).toBe(true);
    });
  }

  it('the old receiver-pinned pattern let a renamed parameter through', () => {
    const OLD = /\breq(uest)?\s*\.\s*formData\s*\(/;
    const renamed = planted('src/app/api/x/route.ts', 'const form = await r.formData();');
    expect(statementsMatching(renamed, OLD), 'the old pattern would have caught this').toEqual([]);
    expect(caughtBy(renamed, BYTE_INTAKE)).toBe(true);
  });

  it('catches an object stream wherever on the server it is written', () => {
    const streamed = planted(
      'src/lib/storage.ts',
      ['const out = await s3.send(new GetObjectCommand({ Bucket, Key }));', 'return out.Body.transformToByteArray();'].join('\n'),
    );
    expect(BYTE_EGRESS.some((re) => re.test(streamed.text))).toBe(true);
  });

  it('a presigned GET is not an egress', () => {
    const presign = planted(
      'src/lib/storage.ts',
      'return getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 300 });',
    );
    expect(BYTE_EGRESS.some((re) => re.test(presign.text))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('comment stripping cannot be used to smuggle a violation past a scan', () => {
  it('a violation is still found when prose about it sits alongside', () => {
    const file = planted(
      'src/app/x/route.ts',
      [
        '/** This route must never call db.insert(cards) directly. */',
        'await db',
        '  .insert(cards)',
        '  .values(row);',
      ].join('\n'),
    );
    // The comment is gone, so exactly one hit — the real one, not two.
    expect(statementsMatching(file, APP_LAYER_WRITE)).toHaveLength(1);
  });

  it('prose alone is not an offender', () => {
    const file = planted('src/app/x/route.ts', '// never write await db.insert(cards) here\nconst x = 1;');
    expect(statementsMatching(file, APP_LAYER_WRITE)).toEqual([]);
  });
});
