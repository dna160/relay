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
  JS_ACTIVE_PREDICATE,
  SQL_ACTIVE_PREDICATE,
} from '@tests/invariants/inv-08-single-active-count.spec';
import {
  APP_LAYER_WRITE,
  SERVER_SURFACE_PATTERN,
} from '@tests/invariants/inv-09-domain-purity.spec';
import { BYTE_INTAKE, BYTE_EGRESS } from '@tests/invariants/inv-10-no-bytes-through-app.spec';
import {
  ACCOUNT_ID_COMPARISON,
  DEFAULT_ROLE_FALLBACK,
  MEMBERSHIP_IMPORT,
  MEMBERSHIP_NAMESPACED,
  MEMBERSHIP_RAW_SQL,
  MEMBERSHIP_RELATIONAL,
  ROLE_LITERAL_BRANCH,
} from '@tests/invariants/inv-11-access-resolution-is-one-function.spec';
import {
  ARCHIVED_PREDICATE,
  deletePattern,
  functionBody,
} from '@tests/invariants/removal-preserves-evidence.spec';
import { cascadeAncestorsOf } from '@tests/invariants/_sql';

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

  it('joins a line that ends dangling, not only one that starts like a continuation', () => {
    // Prettier breaks *after* an operator far more often than before one, which
    // leaves a first line ending in `=` and a second starting with an ordinary
    // identifier. Neither half looks like a continuation, so the splitter used
    // to produce three statements where the compiler sees one — and a bounded
    // pattern spanning the break saw neither half. INV-11's planted violations
    // found this; it is DEFECT-3's shape approached from the other side.
    const file = planted(
      'src/domain/access/resolve-access.ts',
      ['const effective =', '  strongest(projectRole, derived) ??', "  'reviewer';"].join('\n'),
    );
    expect(statements(file)).toEqual([
      "const effective = strongest(projectRole, derived) ?? 'reviewer';",
    ]);
  });

  it('does not join a JSX element to the one after it', () => {
    // The false positive the conservative pattern exists to avoid: a `.tsx`
    // line ending in `>` is a tag, and joining every element to the next would
    // merge a whole component into one statement. For a bounded "must not
    // contain" pattern that is a build failure for the wrong reason.
    const file = planted(
      'src/components/x.tsx',
      ['const a = <Row id={one} />;', 'const b = <Row id={two} />;'].join('\n'),
    );
    expect(statements(file)).toHaveLength(2);
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

describe('INV-8 — a second definition of active cannot hide in a query file', () => {
  /**
   * The reach, not the regex, was the hole here. Both INV-8 scans read
   * `sourceFiles('domain')` until Phase 7, so the invariant claimed one
   * definition of active *in this codebase* while reading one eighth of it —
   * and a definition that matters to billing is far likelier to be a `WHERE`
   * clause in `src/db/queries/` than a comparison in the domain. Widening it
   * found a real one, DEFECT-16.
   *
   * These plants are all in `src/db/queries/`, because that is where the scan
   * could not previously see.
   */
  const SQL_PLANTS: ReadonlyArray<{ what: string; text: string }> = [
    {
      what: 'a plain where clause',
      text: "const rows = await exec.select().from(engagements).where(eq(engagements.status, 'active'));",
    },
    {
      what: 'wrapped by the formatter across four lines',
      text: [
        'const rows = await exec',
        '  .select()',
        '  .from(engagements)',
        '  .where(',
        '    and(',
        '      eq(engagements.orgId, orgId),',
        "      eq(",
        '        engagements.status,',
        "        'active',",
        '      ),',
        '    ),',
        '  );',
      ].join('\n'),
    },
    {
      what: 'aliased, so the table name never appears',
      text: "const live = eq(e.status, 'active');",
    },
    {
      what: 'written as raw SQL rather than as a drizzle helper',
      text: "const rows = await exec.execute(sql`select count(*) from engagements where status = 'active'`);",
    },
    {
      what: 'spelled as an inArray over one value',
      text: "const rows = await exec.select().from(engagements).where(inArray(engagements.status, ['active']));",
    },
  ];

  for (const plant of SQL_PLANTS) {
    it(`catches ${plant.what}`, () => {
      expect(caughtBy(planted('src/db/queries/billing.ts', plant.text), SQL_ACTIVE_PREDICATE)).toBe(
        true,
      );
    });
  }

  it('does not fire on a query that asks the counter instead', () => {
    // `src/db/queries/retention.ts` is the worked example: load the rows,
    // unfiltered by status, and let `countActiveEngagements()` decide. A guard
    // that also flagged this would be teaching people to route around it.
    const clean = planted(
      'src/db/queries/billing.ts',
      [
        'const rows = await exec',
        '  .select({ status: engagements.status, lastActivityAt: engagements.lastActivityAt })',
        '  .from(engagements)',
        '  .where(eq(engagements.orgId, orgId));',
        'return countActiveEngagements(orgId, rows, now);',
      ].join('\n'),
    );
    expect(caughtBy(clean, SQL_ACTIVE_PREDICATE)).toBe(false);
  });

  it('does not fire on the read-only check a page makes on a loaded row', () => {
    // `engagement.status !== 'active'` in a page means "is this archived", which
    // is a different question from "does this count against the plan". The SQL
    // scan runs over the whole tree, so it must not treat the two as one — a
    // guard that cries wolf across nine UI files gets its reach narrowed again.
    const page = planted(
      'src/app/(agency)/w/[id]/board/page.tsx',
      "const archived = engagement.status !== 'active';",
    );
    expect(caughtBy(page, SQL_ACTIVE_PREDICATE)).toBe(false);
    // The domain-only scan is the one that owns that spelling, and it does see it.
    expect(caughtBy(page, [JS_ACTIVE_PREDICATE])).toBe(true);
  });

  it('catches the wrapped comparison the domain scan reads', () => {
    const wrapped = planted(
      'src/domain/plan/quota.ts',
      ['const live =', "  engagement.status ===", "  'active';"].join('\n'),
    );
    expect(caughtBy(wrapped, [JS_ACTIVE_PREDICATE])).toBe(true);
    // And the line-based reader this build retired could not: the comparison is
    // split across three physical lines and no one of them holds both halves.
    expect(linesMatching(wrapped, JS_ACTIVE_PREDICATE)).toEqual([]);
  });
});

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

describe('INV-11 — a permission decision cannot be made quietly outside the resolver', () => {
  /**
   * INV-11's structural half is **vacuously green today**: `resolveAccess()`
   * has just landed, nothing outside `src/domain/access/` names a membership
   * table, and every scan there is a "must not contain".
   *
   * That is the most dangerous state a guard can be in. A scan that finds
   * nothing and a scan that *cannot* find anything are indistinguishable from
   * the outside, and this one will spend the whole of Phase 9 looking green
   * while routes are rewritten around it. So the violations are planted here,
   * written the way the migration would actually write them.
   */

  it('catches a membership table imported into a route, however the import is punctuated', () => {
    const PLANTS = [
      "import { projectMemberships } from '@/db/schema';",
      "import { cards, projectMemberships, lanes } from '@/db/schema';",
      "import { orgMemberships } from '@/db/schema/access';",
      "import type { teamMembers } from '../../db/schema/access';",
      // The house style, wrapped by the formatter — the shape that escaped
      // every line-based scan in this directory before `statements()` existed.
      ['import {', '  engagements,', '  orgMemberships,', "} from '@/db/schema';"].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/app/api/projects/[id]/route.ts', code), MEMBERSHIP_IMPORT),
        `a membership import escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('does not mistake a neighbouring import for a membership import', () => {
    // The false positive that would matter: `[^}]` rather than a lazy
    // any-character group, so an earlier `import {` cannot span two unrelated
    // import statements to reach this one's closing brace.
    const file = planted(
      'src/app/api/x/route.ts',
      ["import { cards } from '@/db/schema';", "import { db } from '@/db/client';"].join('\n'),
    );
    expect(statementsMatching(file, MEMBERSHIP_IMPORT)).toEqual([]);
  });

  it('catches the permission graph reached in raw SQL, which imports nothing', () => {
    const PLANTS = [
      'const r = await db.execute(sql`SELECT role FROM project_memberships WHERE account_id = ${id}`);',
      'await pool.query(`SELECT 1 FROM org_memberships WHERE account_id = $1`, [id]);',
      'const q = sql`select * from engagements e join project_memberships pm on pm.project_id = e.id`;',
      // Upper case. A lowercase-only match was one of the four escapes found
      // in this build; it is not being reintroduced here.
      'await db.execute(sql`SELECT * FROM TEAM_MEMBERS`);',
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/db/queries/agency-board.ts', code), MEMBERSHIP_RAW_SQL),
        `raw SQL escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('catches an account id compared in a component, where no table is touched at all', () => {
    // The form INV-11 names in its own words, and the one that needs no query:
    // the row is already in hand and the decision is one line in some JSX.
    const PLANTS = [
      'if (membership.accountId === session.accountId) return true;',
      'if (session.accountId !== m.accountId) return notFound();',
      'const mine = rows.filter((r) => r.accountId === accountId);',
      ['const owns =', '  project.ownerAccountId ===', '  session.accountId;'].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/components/agency/members.tsx', code), ACCOUNT_ID_COMPARISON),
        `an inline account-id comparison escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('treats a presence check as a presence check', () => {
    // `accountId === null` is not a permission decision, and a guard that fails
    // the build for one gets relaxed rather than obeyed.
    for (const code of [
      'if (session.accountId === null) return signIn();',
      'if (session.accountId !== undefined) hydrate();',
    ]) {
      expect(
        statementsMatching(planted('src/app/(agency)/layout.tsx', code), ACCOUNT_ID_COMPARISON),
        `a null check was reported as a permission decision: ${JSON.stringify(code)}`,
      ).toEqual([]);
    }
  });

  it('catches a role branch, including the set form that contains no operator', () => {
    const PLANTS = [
      "if (membership.role === 'owner') return allow();",
      "if (role !== 'reviewer') { showEditor(); }",
      "const canEdit = ['owner', 'admin'].includes(membership.role);",
      // Wrapped, and with the literal on the left — both shapes a formatter
      // and a house style produce without anyone trying to hide anything.
      ['const isLead =', "  'lead' ===", '  membership.role;'].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/app/api/lanes/route.ts', code), ROLE_LITERAL_BRANCH),
        `a role branch escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('catches the default role ADR-022 spends a paragraph forbidding', () => {
    // "Null on both roles still means deny, not a default reviewer role. A
    // fallback is the classic way a permission system leaks." This is the one
    // scan that applies inside `src/domain/access/` too, because the resolver
    // is exactly where the tempting line gets written.
    const PLANTS = [
      "const role = projectRole ?? 'reviewer';",
      "return { role: derived || 'reviewer', via: 'org' };",
      ['const effective =', '  strongest(projectRole, derived) ??', "  'reviewer';"].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(
          planted('src/domain/access/resolve-access.ts', code),
          DEFAULT_ROLE_FALLBACK,
        ),
        `a default role escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('the line-based scan missed the wrapped forms — the hole is still real here', () => {
    // Kept for the same reason the INV-2 and INV-9 cases above keep theirs: as
    // the standing proof that `statements()` is load-bearing rather than tidy.
    const wrapped = planted(
      'src/app/api/projects/route.ts',
      ['import {', '  engagements,', '  orgMemberships,', "} from '@/db/schema';"].join('\n'),
    );
    expect(
      linesMatching(wrapped, MEMBERSHIP_IMPORT),
      'if this ever finds the violation, the line-based scan was adequate after all',
    ).toEqual([]);
    expect(statementsMatching(wrapped, MEMBERSHIP_IMPORT)).not.toEqual([]);
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

/* -------------------------------------------------------------------------- */

describe('INV-11 — the two shapes that need no import at all', () => {
  /**
   * `src/db/client.ts` hands the entire schema to drizzle as
   * `import * as schema`, so every module holding `db` already has the
   * permission graph within reach. `MEMBERSHIP_IMPORT` is a scan for a
   * punctuation — `import { … } from` — and neither shape below uses it.
   *
   * Found by asking what the assignment read that landed this round would look
   * like if it had been written the *other* obvious way. Both of these are
   * ordinary drizzle, not evasion.
   */

  it('catches the relational API, which names no table symbol', () => {
    const PLANTS = [
      'const rows = await db.query.projectMemberships.findMany({ where: eq(t.projectId, id) });',
      'const m = await db.query.orgMemberships.findFirst({ with: { account: true } });',
      // The shape a "who can be assigned" read is most likely to take.
      [
        'const members = await db.query',
        '  .projectMemberships',
        '  .findMany({ where: eq(projectMemberships.projectId, projectId) });',
      ].join('\n'),
      'const t = await tx.query.teamMembers.findMany();',
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(
          planted('src/db/queries/assignable.ts', code),
          MEMBERSHIP_RELATIONAL,
        ),
        `a relational read of the permission graph escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('catches a membership table reached through a namespace binding', () => {
    const PLANTS = [
      "import * as schema from '@/db/schema';\nconst r = await db.select().from(schema.projectMemberships);",
      'const r = await db.select().from(accounts).innerJoin(s.orgMemberships, on);',
      'await db.insert(schema.projectMemberships).values(row);',
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/app/api/engagements/[id]/members/route.ts', code), MEMBERSHIP_NAMESPACED),
        `a namespaced membership read escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('does not mistake a result field for a table read', () => {
    /**
     * The false positive that would have made this scan unusable, and it is
     * live in the tree today: `backfill-cli.ts` prints
     * `counts.projectMemberships` and `manifest.ts` reads
     * `graph.projectMemberships`. Both are numbers on a result object. A guard
     * that flagged them would be a guard someone relaxes.
     */
    for (const code of [
      'console.log(`project memberships ${String(counts.projectMemberships)}`);',
      "{ table: 'project_memberships', rows: graph.projectMemberships },",
      'const same = undone.orgMemberships === first.orgMemberships;',
    ]) {
      const file = planted('src/workers/backfill-cli.ts', code);
      expect(
        statementsMatching(file, MEMBERSHIP_RELATIONAL),
        `a result field was reported as a relational read: ${JSON.stringify(code)}`,
      ).toEqual([]);
      expect(
        statementsMatching(file, MEMBERSHIP_NAMESPACED),
        `a result field was reported as a namespaced read: ${JSON.stringify(code)}`,
      ).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('removal — the evidence scans catch what a delete button would write', () => {
  /**
   * `removal-preserves-evidence.spec.ts` is green over the tree as shipped, and
   * a scan that is green because the tree is clean is indistinguishable from a
   * scan that is green because it cannot see. These are the violations ADR-026
   * chose *not* to write, written out.
   *
   * The one that matters most is the third: **none of them mention an
   * approval.** That is the whole point of deriving the forbidden set from the
   * cascade graph rather than listing tables by hand.
   */

  it('catches an approval deleted in either dialect, however the chain wraps', () => {
    const PLANTS = [
      'await db.delete(approvals).where(eq(approvals.assetVersionId, id));',
      'await db.execute(sql`DELETE FROM approvals WHERE asset_version_id = ${id}`);',
      'await pool.query(`delete from "approvals" where id = $1`, [id]);',
      // The house style, wrapped by the formatter.
      ['await tx', '  .delete(approvals)', '  .where(inArray(approvals.id, ids));'].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/domain/board/removal.ts', code), deletePattern('approvals')),
        `an approval delete escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('does not mistake a Map or a Set delete for a database delete', () => {
    // `src/lib/sse.ts` and `src/app/api/_stream.ts` both do this. A guard that
    // fired on them would be a guard that gets an exclusion, and the exclusion
    // would be a hole in the shape of the thing being forbidden.
    for (const code of [
      'cleanupBySignal.delete(request.signal);',
      'current.listeners.delete(listener);',
      'seen.delete(approvalsById);',
    ]) {
      expect(
        statementsMatching(planted('src/lib/sse.ts', code), deletePattern('approvals')),
        `an in-memory delete was reported as a database delete: ${JSON.stringify(code)}`,
      ).toEqual([]);
    }
  });

  it('catches the lane and card deletes that destroy approvals without naming one', () => {
    /**
     * The case the whole file exists for. Every plant here is a statement a
     * reasonable removal feature writes, none of them contains the word
     * `approvals`, and every one of them destroys approvals through
     * `cards.lane_id` -> `asset_versions.card_id` -> `approvals.asset_version_id`.
     */
    const forbidden = cascadeAncestorsOf(['approvals', 'asset_versions']);
    expect(forbidden, 'the cascade derivation stopped reaching lanes').toContain('lanes');
    expect(forbidden, 'the cascade derivation stopped reaching cards').toContain('cards');

    const PLANTS: { code: string; table: string }[] = [
      { code: 'await db.delete(lanes).where(eq(lanes.id, laneId));', table: 'lanes' },
      { code: 'await db.delete(cards).where(eq(cards.id, cardId));', table: 'cards' },
      {
        code: 'await db.execute(sql`DELETE FROM lanes WHERE engagement_id = ${id}`);',
        table: 'lanes',
      },
      {
        code: ['await tx', '  .delete(cards)', '  .where(inArray(cards.id, ids));'].join('\n'),
        table: 'cards',
      },
      {
        code: 'await db.delete(engagements).where(eq(engagements.id, id));',
        table: 'engagements',
      },
    ];

    for (const { code, table } of PLANTS) {
      expect(code, 'the plant names an approval, which defeats its own purpose').not.toContain(
        'approval',
      );
      expect(
        statementsMatching(planted('src/app/api/lanes/[id]/route.ts', code), deletePattern(table)),
        `a cascade-ancestor delete escaped the scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('catches a removal predicate on the path to a purge manifest, in either dialect', () => {
    const PLANTS = [
      'const rows = await exec.select().from(cards).where(and(eq(cards.engagementId, id), isNull(cards.archivedAt)));',
      'await exec.execute(sql`select id from cards where engagement_id = ${id} and archived_at IS NULL`);',
      'const live = rows.filter((r) => r.archivedAt == null);',
      'if (card.archivedAt !== null) continue;',
      ['const visible = rows.filter(', '  (r) => r.archivedAt === null,', ');'].join('\n'),
    ];
    for (const code of PLANTS) {
      expect(
        statementsMatching(planted('src/domain/retention/manifest.ts', code), ARCHIVED_PREDICATE),
        `a removal predicate escaped the purge-path scan: ${JSON.stringify(code)}`,
      ).not.toEqual([]);
    }
  });

  it('does not report the schema column definition as a filter', () => {
    // `src/db/schema/board.ts` has to name `archived_at` — it defines it. The
    // purge scan skips the schema directory, and the pattern itself must not
    // fire on a definition either, or the exclusion is doing load-bearing work
    // it was not meant to do.
    for (const code of [
      "archivedAt: tstz('archived_at'),",
      "archivedByUserId: uuid('archived_by_user_id').references(() => users.id),",
      'readonly archivedAt: Date | null;',
    ]) {
      expect(
        statementsMatching(planted('src/db/schema/board.ts', code), ARCHIVED_PREDICATE),
        `a column definition was reported as a filter: ${JSON.stringify(code)}`,
      ).toEqual([]);
    }
  });

  it('reads the right function body when two neighbours have opposite obligations', () => {
    /**
     * `removeLane` must **not** filter its occupancy count on `archived_at`;
     * `restoreLane`, forty lines below it, **must**. A file-wide scan cannot
     * tell them apart, and getting it wrong in either direction is a build
     * failure for the wrong reason.
     */
    const text = [
      'export async function removeLane(db, id) {',
      '  const total = await tx.select({ n: count() }).from(cards).where(eq(cards.laneId, id));',
      '  return total;',
      '}',
      '',
      'export async function restoreLane(db, id) {',
      '  const live = await tx.select({ n: count() }).from(cards)',
      '    .where(and(eq(cards.laneId, id), isNull(cards.archivedAt)));',
      '  return live;',
      '}',
    ].join('\n');

    const remove = functionBody(text, 'removeLane');
    const restore = functionBody(text, 'restoreLane');
    expect(remove, 'removeLane was not found').not.toBeNull();
    expect(restore, 'restoreLane was not found').not.toBeNull();
    expect(
      ARCHIVED_PREDICATE.test(remove ?? ''),
      'the body reader leaked restoreLane into removeLane',
    ).toBe(false);
    expect(
      ARCHIVED_PREDICATE.test(restore ?? ''),
      'the body reader cannot see a predicate that is there',
    ).toBe(true);
  });
});
