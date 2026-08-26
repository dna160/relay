/**
 * INV-11 — All access decisions come from `resolveAccess()`. Deny by default.
 * No route, component, or query compares an account id to a membership row.
 *
 * *Phase 9.* `CLAUDE.md` lists this among the four v1.1 invariants and marks
 * them not-yet-live; ADR-021 §6 defines the function and ADR-022 D3 defines
 * what it must resolve to.
 *
 * ## Why this invariant is two files, and which half is which
 *
 * The same split INV-3 got, for the same reason it got it.
 *
 * **This file is the structural half.** It reads the source tree, it is live
 * from today, and it is vacuous today by construction — `src/domain/access/`
 * does not exist yet and nothing outside `src/db/schema/access.ts` names a
 * membership table. A structural invariant that only starts existing after the
 * feature does is an invariant that never gets written, and the whole value of
 * this half is that it is already in place when the first route reaches for a
 * membership row. It cannot be fooled by the shadow harness either: the harness
 * changes what the system *answers*, and this half never asks.
 *
 * **The behavioural half is `…-is-one-function.db.spec.ts`**, it runs under
 * `npm run test:db`, and it is **skipped until Phase 9's EXIT is met.** The
 * reason it is skipped is specific rather than procedural: during Phase 9 every
 * permission check calls both the old inline logic and `resolveAccess()` and
 * **returns the old result**. A matrix asserted against that harness would be
 * asserting the answers of the system being replaced. It goes green when the
 * old path is deleted, which PHASE-9 EXIT puts after seven consecutive days at
 * zero disagreements.
 *
 * The reason the behavioural half is against a real database, rather than a
 * scan for the right-looking source, is INV-3's lesson exactly: *a permission
 * check asserted against source text is a check that cannot see its own
 * subject.* Reading `strongest(` out of a file proves the word is there.
 *
 * ## What "vacuous today" is worth, and how it is kept honest
 *
 * A scan that finds nothing and a scan that cannot find anything look
 * identical. So every pattern below is exported and planted against in
 * `tests/unit/invariant-scans-are-not-escapable.spec.ts`, written the way
 * someone would actually write the violation rather than the way the regex
 * would like it written. And the allowlists are asserted to name real
 * directories, because DEFECT-6 was an exclusion list and a payment list that
 * were the same array, so a rename made both vacuous at once.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { sourceFiles, statementsMatching } from './_source';
import { ORG_ROLES, PROJECT_ROLES } from '@/db/schema/enums';
import {
  ACCESS_EDGE_CASES,
  ACCESS_MATRIX,
  expectedCellCount,
  type MatrixCase,
} from '@tests/fixtures/access-matrix';

/** The one directory permitted to answer a permission question. ADR-021 §6. */
export const ACCESS_DOMAIN = 'src/domain/access/';

/** The drizzle symbols for the tables that grant access. */
export const MEMBERSHIP_SYMBOLS = ['orgMemberships', 'projectMemberships', 'teamMembers'] as const;

/** Their SQL names, for the raw-SQL half of the same scan. */
export const MEMBERSHIP_TABLES_SQL = [
  'org_memberships',
  'project_memberships',
  'team_members',
] as const;

/**
 * Any import of a membership table symbol, from any specifier.
 *
 * Import-shaped rather than call-shaped on purpose. A scan for `.from(
 * projectMemberships)` is a scan for one query-builder idiom, and drizzle has
 * several — `innerJoin`, a relational `with:`, a subquery bound to a local.
 * Nothing can read the table without naming the symbol, so the symbol is where
 * the guard belongs. `[^}]` rather than a lazy any-character group: a lazy
 * group starting at an earlier `import {` spans unrelated imports to reach this
 * one's brace, which is the bug `queriesImportedByClientRoutes` was fixed for.
 */
export const MEMBERSHIP_IMPORT = new RegExp(
  String.raw`import\s+(?:type\s+)?\{[^}]*\b(${MEMBERSHIP_SYMBOLS.join('|')})\b[^}]*\}\s+from`,
);

/** The same tables reached by raw SQL, which imports nothing at all. */
export const MEMBERSHIP_RAW_SQL = new RegExp(
  String.raw`\b(from|join|into|update)\s+"?(${MEMBERSHIP_TABLES_SQL.join('|')})"?\b`,
  'i',
);

/**
 * The permission graph reached through drizzle's **relational** API, which
 * needs no named import at all.
 *
 * `src/db/client.ts` passes the whole schema to `drizzle()` as
 * `import * as schema`, which is correct and is also a hole in the scan above:
 * `MEMBERSHIP_IMPORT` is import-shaped, and `db.query.projectMemberships
 * .findMany({ with: { account: true } })` imports nothing but `db`. It is not
 * an exotic shape — it is the *most natural* way to write "list everyone on
 * this project with their account", which is exactly the read that arrived this
 * round. Found by asking what the assignment read would look like if it were
 * written the other obvious way.
 */
export const MEMBERSHIP_RELATIONAL = new RegExp(
  String.raw`\.query\s*\.\s*(${MEMBERSHIP_SYMBOLS.join('|')})\b`,
);

/**
 * The same table reached through a namespace binding rather than a named import.
 *
 * Deliberately anchored to a drizzle *table position* — `.from(x.y)`,
 * `.innerJoin(x.y, …)`, `.insert(x.y)` — rather than to the bare symbol.
 * `counts.projectMemberships` and `graph.projectMemberships` are result-object
 * fields in `backfill-cli.ts` and `manifest.ts`, and a scan that flagged those
 * would be a scan that gets relaxed rather than obeyed.
 */
export const MEMBERSHIP_NAMESPACED = new RegExp(
  String.raw`\.(from|innerJoin|leftJoin|rightJoin|fullJoin|insert|update|delete)\s*\(\s*[A-Za-z0-9_$]+\s*\.\s*(${MEMBERSHIP_SYMBOLS.join('|')})\b`,
);

/**
 * An account id on either side of an equality test.
 *
 * This is "compares an account id to a membership row" written in TypeScript
 * instead of in SQL, and it is the form that does not need a table at all —
 * the row was already loaded for some other reason and the comparison is one
 * line in a component. Comparisons against `null` and `undefined` are excluded
 * because those are presence checks, not decisions.
 */
export const ACCOUNT_ID_COMPARISON = new RegExp(
  [
    // Two exclusions, and both were needed. `(?!=)` stops the engine settling
    // for `==` as a prefix of `===` — without it, `accountId === null` fails
    // the null lookahead on `===`, backtracks to `==`, finds the third `=` is
    // not the word `null`, and matches after all. And the null lookahead binds
    // to the operator rather than to whatever follows `\s*`, because a `\s*`
    // that can match zero width lets the lookahead inspect the space instead of
    // the word. Either mistake turns every presence check in the codebase into
    // a permission violation; both were caught by the planted cases in
    // `invariant-scans-are-not-escapable.spec.ts` rather than by review.
    String.raw`\.accountId\s*(?:===|!==|==|!=)(?!=)(?!\s*(?:null|undefined)\b)`,
    String.raw`(?:===|!==|==|!=)(?!=)\s*[A-Za-z0-9_$]*\.?accountId\b`,
  ].join('|'),
);

/**
 * A branch on an org or project role literal.
 *
 * The comparison is only half of how a permission decision gets made inline;
 * the other half is a set test, `['owner', 'admin'].includes(role)`, which
 * contains no equality operator at all. Both shapes are here. Both are bounded
 * patterns, so `statementsMatching` is safe for them.
 */
const ROLE_LITERALS = [...ORG_ROLES, ...PROJECT_ROLES].join('|');

export const ROLE_LITERAL_BRANCH = new RegExp(
  [
    String.raw`(?:===|!==|==|!=)\s*['"](?:${ROLE_LITERALS})['"]`,
    String.raw`['"](?:${ROLE_LITERALS})['"]\s*(?:===|!==|==|!=)`,
    String.raw`\[[^\]]*['"](?:${ROLE_LITERALS})['"][^\]]*\]\s*\.\s*includes\s*\(`,
  ].join('|'),
);

/**
 * A role reached for as a fallback. ADR-022, in the section headed *what must
 * not follow from this*: "Null on both roles still means **deny**, not a
 * default reviewer role. A fallback is the classic way a permission system
 * leaks, and this decision makes the org-derived branch more attractive to
 * reason loosely about, not less."
 *
 * Unlike every other scan here, this one applies **inside** the access domain
 * too. The resolver is exactly where the tempting `?? 'reviewer'` gets written.
 */
export const DEFAULT_ROLE_FALLBACK = new RegExp(
  String.raw`(?:\?\?|\|\|)\s*['"](?:${ROLE_LITERALS})['"]`,
);

/* -------------------------------------------------------------------------- */
/* The allowlists, and what each one is paying.                               */
/*                                                                            */
/* DEFECT-6: the exclusion list and the list that paid for it were the same    */
/* array, so a rename would have made both vacuous — the scan going on         */
/* excluding a path that no longer existed while the payment iterated an empty */
/* set and passed. These are separate, and the last test in this file asserts  */
/* the set of prefixes matching nothing is exactly the set declared below.     */
/* -------------------------------------------------------------------------- */

/** Prefixes permitted to name a membership table, and the reason each is. */
export const MEMBERSHIP_READERS: readonly { prefix: string; why: string }[] = [
  { prefix: 'src/db/schema/', why: 'defines the tables; never queries them' },
  { prefix: ACCESS_DOMAIN, why: 'ADR-021 §6 — the sole permission authority' },
  {
    prefix: 'src/db/backfill/',
    why: 'writes memberships from the v1 graph; a script, never reachable from a request path',
  },
];

/**
 * Prefixes permitted to *decide* from a role — to compare an account id, or to
 * branch on a role literal.
 *
 * Narrower than the readers above, and deliberately so. The backfill maps a v1
 * `AGENCY_ROLES` value onto an `ORG_ROLES` value, which reads exactly like a
 * permission decision and is not one: it is a one-time write that *grants*,
 * where INV-11 is about what happens when a request *asks*. What makes the
 * distinction safe rather than a matter of opinion is that the backfill is
 * unreachable from `src/app/`, which is asserted below and is the payment for
 * this entry. `src/db/schema/` is absent from this list on purpose — a schema
 * file has no business branching on a role at all.
 */
const DECISION_MAKERS: readonly string[] = [ACCESS_DOMAIN, 'src/db/backfill/'];

/**
 * Prefixes above that no file matches yet, exactly.
 *
 * Asserted as an equality rather than a subset. A prefix that starts matching
 * must be removed from this list, which is the moment its payment below starts
 * being collected; a prefix that *stops* matching is a stale exclusion and
 * fails here rather than silently widening the scan's blind spot. Empty today,
 * which is the state it should stay in: an allowlist entry for a directory that
 * does not exist is a hole reserved in advance.
 */
const NOT_YET_CREATED: readonly string[] = [];

function underAny(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path.startsWith(p));
}

const READER_PREFIXES = MEMBERSHIP_READERS.map((r) => r.prefix);

/* -------------------------------------------------------------------------- */

describe('INV-11 the permission graph is read in exactly one place', () => {
  const FILES = sourceFiles();

  it('has source to scan, so an empty sweep is not a pass', () => {
    // Every assertion below is a "must not contain". If `sourceFiles()` ever
    // returns nothing — a moved directory, a broken walk — every one of them
    // passes and the invariant is unguarded. This is the only case here that
    // fails when the scan stops working.
    expect(FILES.length).toBeGreaterThan(20);
    expect(
      FILES.some((f) => f.path === 'src/db/schema/access.ts'),
      'the permission graph schema is not where this invariant thinks it is',
    ).toBe(true);
  });

  it('nothing outside src/domain/access/ exports resolveAccess', () => {
    // Not "exactly one export" — that would fail today and teach nothing. The
    // claim that holds from the first commit is about *where*, and it starts
    // biting the instant the function lands anywhere else.
    const offenders = FILES.filter((f) => !f.path.startsWith(ACCESS_DOMAIN))
      .filter((f) => /export\s+(?:async\s+)?(?:function|const)\s+resolveAccess\b/.test(f.text))
      .map((f) => f.path);
    expect(
      offenders,
      'a second resolver. ADR-021 §6: nothing else computes permissions — not a ' +
        'route handler, not a React component, not a query file.',
    ).toEqual([]);
  });

  it('no file outside the access domain imports a membership table', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (underAny(file.path, READER_PREFIXES)) continue;
      for (const stmt of statementsMatching(file, MEMBERSHIP_IMPORT)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'a membership table was imported outside `src/domain/access/`. Take the ' +
        'resolved access as an argument instead — a file that can read the graph ' +
        'is a file that can disagree with the resolver.',
    ).toEqual([]);
  });

  it('no file outside the access domain reaches a membership table without importing it', () => {
    /**
     * The two shapes the import scan cannot see, closed together.
     *
     * `src/db/client.ts` hands the whole schema to drizzle, so every module
     * that imports `db` already has the permission graph in reach — through
     * `db.query.projectMemberships` and through any namespace binding. The
     * import scan is a scan for a *punctuation*, and neither of these uses it.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      if (underAny(file.path, READER_PREFIXES)) continue;
      for (const pattern of [MEMBERSHIP_RELATIONAL, MEMBERSHIP_NAMESPACED]) {
        for (const stmt of statementsMatching(file, pattern)) {
          offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
        }
      }
    }
    expect(
      offenders,
      'the permission graph was read through the relational API or a namespace ' +
        'binding. `db.query.projectMemberships.findMany({ with: { account: true } })` ' +
        'is the most natural way to write "everyone on this project" and it names no ' +
        'import at all — which is precisely why it belongs to `src/domain/access/` ' +
        'like every other way of asking.',
    ).toEqual([]);
  });

  it('no file outside the access domain reaches a membership table in raw SQL', () => {
    // Raw SQL imports nothing, so the scan above cannot see it. INV-9 already
    // forbids raw SQL in the app layer; this covers the rest of the tree.
    const offenders: string[] = [];
    for (const file of FILES) {
      if (underAny(file.path, READER_PREFIXES)) continue;
      for (const stmt of statementsMatching(file, MEMBERSHIP_RAW_SQL)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(offenders, 'the permission graph was queried in raw SQL').toEqual([]);
  });

  it('no file outside the access domain compares an account id', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (underAny(file.path, DECISION_MAKERS)) continue;
      for (const stmt of statementsMatching(file, ACCOUNT_ID_COMPARISON)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'an account id was compared outside the resolver. This is INV-11 in its ' +
        'literal words, and it is the form that needs no table — the row is ' +
        'already in hand and the decision is one line in a component.',
    ).toEqual([]);
  });

  it('no file outside the access domain branches on a role literal', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (underAny(file.path, DECISION_MAKERS)) continue;
      for (const stmt of statementsMatching(file, ROLE_LITERAL_BRANCH)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'a permission decision was made from a role literal outside the resolver. ' +
        'Ask `resolveAccess()` and branch on what it returns; a second place that ' +
        'knows `owner` outranks `member` is a second place that can be wrong ' +
        'about it, and the two will not fail together.',
    ).toEqual([]);
  });

  it('no file anywhere defaults a role when one is absent', () => {
    // The one scan that includes the access domain, because the resolver is
    // precisely where `?? 'reviewer'` gets written and it is the exact leak
    // ADR-022 spends a paragraph on.
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const stmt of statementsMatching(file, DEFAULT_ROLE_FALLBACK)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'a role was supplied as a fallback. ADR-022: null on both roles means ' +
        'deny, never a default reviewer role.',
    ).toEqual([]);
  });

  it('the resolver never reads team_members, because a team is not an authority', () => {
    // `src/db/schema/access.ts`: granting a team expands into individual
    // `project_memberships` rows carrying `granted_via_team_id`. Two authority
    // paths would be two ways to get revocation wrong, and revocation is the
    // operation that must never fail. So the resolver reads the expansion, not
    // the team. This is the structural half of the `team-membership-alone`
    // edge case in the matrix.
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!file.path.startsWith(ACCESS_DOMAIN)) continue;
      if (/\bteamMembers\b/.test(file.text) || /\bteam_members\b/.test(file.text)) {
        offenders.push(file.path);
      }
    }
    expect(
      offenders,
      'the resolver reached for a team. A team grants by expanding into ' +
        'project_memberships; resolving through it as well makes the same grant ' +
        'reachable two ways and revocable only one.',
    ).toEqual([]);
  });

  it('the app layer never names the shadow ledger directly', () => {
    // `src/db/schema/access.ts`: `access_shadow_disagreements` is "never read by
    // a request path — this table exists to be counted per endpoint per day",
    // and to hit zero for seven consecutive days before the old checks go.
    //
    // The harness does *write* to it from inside a request, which is the whole
    // point of it, so the rule enforced here is narrower than "never touched by
    // a request": the app layer may not name the table at all. It reaches the
    // ledger through `src/db/queries/access-shadow.ts` instead, which keeps the
    // instrument one module away from every handler that feeds it — and means
    // a route that starts *reading* disagreements to decide something has to
    // add an import that fails this case.
    const offenders = FILES.filter((f) => f.path.startsWith('src/app/'))
      .filter((f) => /\baccessShadowDisagreements\b|\baccess_shadow_disagreements\b/.test(f.text))
      .map((f) => f.path);
    expect(
      offenders,
      'the app layer named the shadow ledger. It is the migration\'s instrument, ' +
        'not a data source: a handler that reads it has made the measurement part ' +
        'of the system being measured.',
    ).toEqual([]);
  });

  /* ---------------------------------------------------- the allowlists pay */

  it('the schema layer defines the membership tables and never queries them', () => {
    // The payment for `src/db/schema/`. Without it the exclusion is a hole in
    // the exact shape of the thing being forbidden: anyone could put a
    // permission query in a schema file and the scan would step over it.
    const offenders: string[] = [];
    for (const file of sourceFiles('db/schema')) {
      for (const stmt of statementsMatching(
        file,
        /\b(db|tx|exec|executor)\s*\.\s*(select|insert|update|delete)\s*\(/,
      )) {
        offenders.push(`${file.path}: ${stmt.slice(0, 120)}`);
      }
    }
    expect(offenders, 'a schema file ran a query; its exclusion no longer holds').toEqual([]);
  });

  it('the backfill is unreachable from the app layer', () => {
    // The payment for `src/db/backfill/` appearing on both allowlists. It maps
    // v1 roles onto org roles and writes memberships wholesale, which is
    // correct for a migration script and catastrophic on a request. The
    // exemption is safe exactly while no request can reach it.
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!file.path.startsWith('src/app/')) continue;
      for (const stmt of statementsMatching(file, /from\s+['"][^'"]*db\/backfill[^'"]*['"]/)) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'a route imported the identity backfill. Its exemption from the role scans ' +
        'is paid for by being a script nothing serves.',
    ).toEqual([]);
  });

  it('role strength is defined once and compared nowhere else', () => {
    // `src/domain/access/roles.ts` states this rule in a comment — "Nothing
    // outside this file may compare two roles" — and a stated rule with no
    // enforcement is a procedure. The access domain is one directory, and a
    // second ordering *inside* it would be as wrong as one outside: the whole
    // hazard of `strongest()` is that two places can disagree about which of
    // two roles wins, and they will not fail together.
    const HOME = `${ACCESS_DOMAIN}roles.ts`;
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.path === HOME) continue;
      for (const stmt of statementsMatching(
        file,
        /ROLE_STRENGTH|\b(ORG|PROJECT)_ROLE_ORDER\s*\[|(?:indexOf|lastIndexOf)\s*\(\s*\w*[Rr]ole/,
      )) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'role strength was read or re-derived outside roles.ts. Call the comparison ' +
        'it exports; an ordering spelled twice is an ordering that can differ.',
    ).toEqual([]);
  });

  it('every allowlist prefix that matches nothing is declared, and only those', () => {
    // DEFECT-6's second lesson, mechanised. An exclusion for a directory that
    // has been renamed away goes on excluding forever and nothing says so.
    const unpopulated = READER_PREFIXES.filter(
      (prefix) => !FILES.some((f) => f.path.startsWith(prefix)),
    );
    expect(
      unpopulated.slice().sort(),
      'an allowlist prefix matches nothing and is not declared as not-yet-created ' +
        '(a stale exclusion), or a declared one has started matching (remove it, ' +
        'and its payment above begins to apply).',
    ).toEqual(NOT_YET_CREATED.slice().sort());
  });

  it('every allowlist entry says what it is buying', () => {
    for (const { prefix, why } of MEMBERSHIP_READERS) {
      expect(why.length, `${prefix} is excluded with no stated reason`).toBeGreaterThan(20);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The resolution table, checked for being a table.                           */
/*                                                                            */
/* The behavioural half is skipped until Phase 9's EXIT, which means for the   */
/* length of Phase 9 nobody executes the matrix. These cases keep the matrix   */
/* honest in the meantime, and they are portable: a matrix quietly becoming a  */
/* sample of the interesting cells is the failure mode of every permission     */
/* matrix ever written, and it is checkable without a database.               */
/* -------------------------------------------------------------------------- */

describe('INV-11 the resolution table is a table, not a selection', () => {
  const key = (c: MatrixCase): string =>
    `${String(c.orgRole)}|${String(c.projectRole)}|${c.orgIs}|${String(c.derives)}`;

  it('covers the full cross-product of org role, project role, org scoping and the switch', () => {
    expect(
      ACCESS_MATRIX.length,
      'the matrix is not the size of the cross-product it claims to be',
    ).toBe(expectedCellCount());

    const seen = new Set(ACCESS_MATRIX.map(key));
    expect(seen.size, 'the matrix names the same cell twice').toBe(ACCESS_MATRIX.length);

    for (const orgRole of [null, ...ORG_ROLES]) {
      for (const projectRole of [null, ...PROJECT_ROLES]) {
        for (const orgIs of ['same', 'other'] as const) {
          for (const derives of [true, false]) {
            expect(
              seen.has(`${String(orgRole)}|${String(projectRole)}|${orgIs}|${String(derives)}`),
              `no expectation for org=${String(orgRole)} project=${String(projectRole)} ` +
                `(${orgIs} org, derivation ${derives ? 'on' : 'off'})`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('says deny for both-null, in every scoping and switch state', () => {
    // ADR-022 names this cell specifically. It gets its own assertion so a
    // future edit cannot soften it as four rows among sixty-four.
    const denies = ACCESS_MATRIX.filter((c) => c.orgRole === null && c.projectRole === null);
    expect(denies).toHaveLength(4);
    for (const cell of denies) {
      expect(cell.expected, 'both-null must resolve to deny, never a default role').toEqual({
        role: null,
        via: null,
      });
    }
  });

  it('confines the whole effect of ADR-022 D3 to six of the sixty-four cells', () => {
    // The tightest statement of the decision's blast radius, and the one that
    // catches a derivation that has quietly grown.
    //
    // Six, not eight. Derivation *happens* in eight cells — owner and admin
    // across all four project roles, in their own org, with the switch on — but
    // in the two where the account is already a project `lead` the direct grant
    // ties and takes the `via` label. So the org path is the deciding authority
    // in exactly six, and every one of them must be: the project's own org,
    // derivation on, an org role of owner or admin, resolving to lead.
    const derivedAnswers = ACCESS_MATRIX.filter((c) => c.expected.via === 'org');
    expect(
      derivedAnswers.length,
      'the number of cells the org path decides has changed. Either a role started ' +
        'deriving that should not, or one stopped that should.',
    ).toBe(6);
    for (const cell of derivedAnswers) {
      expect(cell.orgIs, `${key(cell)} derives across organizations`).toBe('same');
      expect(cell.derives, `${key(cell)} derives with the switch off`).toBe(true);
      expect(
        cell.orgRole === 'owner' || cell.orgRole === 'admin',
        `${key(cell)}: an org role other than owner/admin derived project access`,
      ).toBe(true);
      expect(cell.expected.role, `${key(cell)} derived something other than lead`).toBe('lead');
    }
  });

  it('turns the org path off completely when the organization turns it off', () => {
    // The Studio-tier Chinese wall. `owner` included — a switch that leaves the
    // owner deriving is not a wall, and "the owner is different" is exactly the
    // exception someone adds without meaning to weaken anything.
    for (const cell of ACCESS_MATRIX.filter((c) => !c.derives)) {
      expect(cell.expected, `${key(cell)}: derivation is off and something still derived`).toEqual({
        role: cell.projectRole,
        via: cell.projectRole === null ? null : 'project',
      });
    }
  });

  it('never expects a role without saying where it came from', () => {
    for (const cell of ACCESS_MATRIX) {
      if (cell.expected.role === null) {
        expect(cell.expected.via, `${key(cell)}: a denial with a reason attached`).toBeNull();
      } else {
        expect(cell.expected.via, `${key(cell)}: a grant with no reason`).not.toBeNull();
      }
    }
  });

  it('derives nothing from an org role held in another organization', () => {
    // The scoping axis, asserted as a property rather than cell by cell: in the
    // `other` half the answer must depend on the project role alone. An
    // implementation whose join forgets `om.org_id = p.org_id` grants every
    // tenant's projects to every other tenant's owners, and it would pass all
    // sixteen same-org deriving cells on the way there.
    for (const cell of ACCESS_MATRIX.filter((c) => c.orgIs === 'other')) {
      expect(cell.expected, `${key(cell)}: an org role in another org derived access`).toEqual({
        role: cell.projectRole,
        via: cell.projectRole === null ? null : 'project',
      });
    }
  });

  it('never resolves weaker than the direct project membership', () => {
    // The half of `strongest()` that is not a matter of opinion. Whatever the
    // org path contributes, it may not take away a grant someone was explicitly
    // given — that direction would be a revocation nobody performed.
    const rank = (r: MatrixCase['expected']['role']): number =>
      r === null ? 0 : PROJECT_ROLES.length - PROJECT_ROLES.indexOf(r);
    for (const cell of ACCESS_MATRIX) {
      expect(
        rank(cell.expected.role),
        `${key(cell)}: resolved weaker than the direct grant`,
      ).toBeGreaterThanOrEqual(rank(cell.projectRole));
    }
  });

  it('attributes a tie to the project, never to the org', () => {
    // The second of the two values ADR-022 implies rather than states, pinned
    // on its own. `via` is what an audit row and a UI explanation are built
    // from: naming the org while a direct grant of equal strength exists would
    // read as though revoking the project membership changed nothing.
    const ties = ACCESS_MATRIX.filter(
      (c) => c.derives && c.orgIs === 'same' && c.projectRole === 'lead',
    );
    expect(ties.length, 'the tie cells went missing from the matrix').toBe(4);
    for (const cell of ties) {
      expect(cell.expected.via, `${key(cell)}: a tie was attributed to the org`).toBe('project');
    }
  });

  it('states a reason for every cell, and marks the ones that were derived', () => {
    for (const cell of ACCESS_MATRIX) {
      expect(cell.why.length, `${key(cell)}: no reason given`).toBeGreaterThan(20);
    }
    // The derived cells are the ones ADR-022 implies rather than states, and
    // they are where an independently-written back-end table was most likely to
    // disagree. Pinned so the count cannot drift without someone noticing.
    const derived = ACCESS_MATRIX.filter((c) => c.derived === true);
    expect(
      derived.length,
      'the set of cells read out of ADR-022 rather than stated by it has changed',
    ).toBe(8);
    for (const cell of derived) {
      expect(cell.orgRole === 'owner' || cell.orgRole === 'admin').toBe(true);
      expect(cell.orgIs).toBe('same');
      expect(cell.derives).toBe(true);
    }
  });

  it('keeps the edge cases the cross-product cannot reach', () => {
    // A role matrix only asks about accounts that have roles. Every way of
    // being handed something that looks like an account and is not one lives
    // outside it, including the two ids that are both uuids and both wrong.
    const ids = ACCESS_EDGE_CASES.map((c) => c.id);
    expect(new Set(ids).size, 'a duplicate edge case id').toBe(ids.length);
    for (const required of [
      'team-membership-alone',
      'reviewer-contact-id-passed-as-account-id',
      'project-id-that-exists-nowhere',
      'membership-row-in-another-projects-name',
    ]) {
      expect(ids, `${required} was removed from the edge cases`).toContain(required);
    }
    for (const edge of ACCESS_EDGE_CASES) {
      expect(edge.why.length, `${edge.id} states no reason`).toBeGreaterThan(20);
    }
  });
});
