/**
 * Deterministic fixtures shared by every suite.
 *
 * Import from `@tests/fixtures`, not from the individual files, so that a
 * fixture can be moved without touching the suites that use it.
 *
 * What lives here:
 *
 * | File | Holds |
 * |---|---|
 * | `clock.ts` | The frozen origin `T0` and duration helpers. Nothing calls `Date.now()`. |
 * | `ids.ts` | Stable uuid-v7-shaped ids and fake sha256s. |
 * | `orgs.ts` | One org per plan, plus `PLAN_LIMITS` from PRD §5.8. |
 * | `engagements.ts` | An engagement at every lifecycle stage, retention arithmetic, contacts. |
 * | `board.ts` | Lanes (one private), cards (one private-override), versions (3, two published), approvals. |
 * | `possession.json` | The transition sequences and hand-computed totals PHASE-5 asserts against. |
 * | `possession.ts` | Typed loader and load-time validation for the above. |
 * | `seed.ts` | The insertion graph and the transition scripts that reach each card state legally. |
 */

export * from './clock';
export * from './ids';
export * from './orgs';
export * from './engagements';
export * from './board';
export * from './possession';
export * from './seed';
