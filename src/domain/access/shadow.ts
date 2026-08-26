/**
 * The shadow harness — Phase 9's core deliverable (DELIVERY-PLAN §V,
 * ADR-021 migration step 3).
 *
 * Every permission check in the product runs **both** the shipped inline logic
 * and `resolveAccess()`, returns the shipped answer, and records any
 * disagreement with the full input. Nothing about behaviour changes. The old
 * checks are deleted only after seven consecutive days at zero disagreements,
 * and INV-11 is unskipped only after that deletion.
 *
 * ## Why this exists at all
 *
 * `resolveAccess()` is probably right. "Probably right" and "agreed with
 * production for seven days" are different claims and only the second one is
 * checkable. ADR-021 says step 3 is the one people skip and that it is the only
 * step that tells you whether the new graph agrees with the system already
 * running. Agency usage is weekly-cyclical, which is why 48 hours was rejected
 * in favour of seven days: a Tuesday sample does not contain the Friday
 * approval rush, and that is where the permission edge cases live.
 *
 * ## Three rules this file obeys
 *
 * 1. **It returns the old answer.** `withShadow` hands back exactly what the
 *    wrapped call returned, or rethrows exactly what it threw. The new result
 *    reaches the caller through no path at all.
 * 2. **It cannot break a request.** Every failure inside the harness — a query
 *    error, an unmigrated account, a missing project — is swallowed and, where
 *    it is meaningful, recorded. A harness that can 500 a route is a harness
 *    that gets removed under pressure at the worst moment.
 * 3. **A disagreement is a finding, not a tolerance.** There is no threshold
 *    here and no severity. Old ≠ new is logged, full stop, and the phase's exit
 *    condition is that the count is zero.
 *
 * ## Reviewers are not in scope
 *
 * `resolveAccess()` answers for *accounts*. A reviewer (a `client_contacts`
 * row) has no account, holds a session scoped to exactly one engagement, and is
 * governed by INV-6, which ADR-021 narrows rather than retires. There is
 * nothing for the two paths to disagree about, so the client surface is not
 * shadowed — deliberately, and stated here so the gap is a decision rather than
 * an omission.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { accounts, accessShadowDisagreements } from '@/db/schema';
import type { Executor } from '@/db/types';
import { resolveAccess, resolveVisibleProjects } from './resolve-access';
import type { AccessResult } from './roles';

/**
 * Why the two paths differed. Every value is a bug somewhere until proven
 * otherwise — see the header.
 */
export type DisagreementReason =
  /** The shipped check allowed it; the graph denies. Someone loses access. */
  | 'old_allowed_new_denied'
  /** The graph allows it; the shipped check denies. Someone gains access. */
  | 'old_denied_new_allowed'
  /** No `accounts` row for this signed-in user. The backfill missed somebody. */
  | 'account_not_backfilled'
  /** The harness could not name the object's project, so it could not compare. */
  | 'project_unresolved'
  /** The set-valued form: the two paths returned different project sets. */
  | 'visible_set_differs'
  /**
   * The other set-valued form: the shipped assignee list and the graph's
   * disagree about who can be handed a card on one project. One row per person
   * on either side of the difference.
   */
  | 'assignable_set_differs';

/**
 * One permission decision, named well enough that a row in the log is
 * actionable without this conversation.
 */
export interface ShadowContext {
  /** The route, not the URL: `GET /api/engagements/[id]`. */
  readonly endpoint: string;
  /** Which check inside the endpoint, when an endpoint has more than one. */
  readonly decisionPoint: string;
  /** The v1 session's user id. Mapped to an account by the backfill. */
  readonly legacyUserId: string;
  /** The v1 session's org id — the whole of the shipped check's input. */
  readonly legacyOrgId: string;
  /**
   * The object being touched, as an engagement id. Null when the harness could
   * not resolve one, which is itself recorded rather than skipped.
   */
  readonly projectId: string | null;
  /** Anything else needed to reproduce the decision. Goes in the log verbatim. */
  readonly input?: Readonly<Record<string, unknown>>;
}

/** Injected so the recorder stays testable and the clock stays explicit. */
export interface ShadowClock {
  now(): Date;
}

const systemClock: ShadowClock = { now: () => new Date() };

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** `accounts.legacy_user_id` → `accounts.id`, or null if the backfill missed it. */
export async function accountForLegacyUser(
  exec: Executor,
  legacyUserId: string,
): Promise<string | null> {
  const rows = await exec
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.legacyUserId, legacyUserId), isNotNull(accounts.legacyUserId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function record(
  exec: Executor,
  ctx: ShadowContext,
  reason: DisagreementReason,
  oldAllowed: boolean,
  newResult: AccessResult | null,
  accountId: string | null,
  clock: ShadowClock,
): Promise<void> {
  const now = clock.now();
  await exec.insert(accessShadowDisagreements).values({
    observedAt: now,
    observedOn: isoDate(now),
    endpoint: ctx.endpoint,
    decisionPoint: ctx.decisionPoint,
    reason,
    legacyUserId: ctx.legacyUserId,
    accountId,
    legacyOrgId: ctx.legacyOrgId,
    projectId: ctx.projectId,
    oldAllowed,
    newAllowed: newResult?.role !== null && newResult !== null,
    newRole: newResult?.role ?? null,
    newVia: newResult?.via ?? null,
    input: {
      endpoint: ctx.endpoint,
      decisionPoint: ctx.decisionPoint,
      legacyUserId: ctx.legacyUserId,
      legacyOrgId: ctx.legacyOrgId,
      projectId: ctx.projectId,
      oldAllowed,
      new: newResult,
      ...ctx.input,
    },
  });
}

/**
 * Run the new resolution beside a decision the old logic has already made, and
 * record any difference.
 *
 * Never throws. The caller has already produced the answer it is going to
 * return; nothing here is allowed to change that, including by failing.
 */
export async function compareToShadow(
  exec: Executor,
  ctx: ShadowContext,
  oldAllowed: boolean,
  clock: ShadowClock = systemClock,
): Promise<void> {
  try {
    const accountId = await accountForLegacyUser(exec, ctx.legacyUserId);

    if (accountId === null) {
      // Only worth recording when the old path allowed something: a denial that
      // both paths reach for different reasons is still the right answer, and
      // logging every anonymous 404 would bury the rows that matter.
      if (oldAllowed) {
        await record(exec, ctx, 'account_not_backfilled', oldAllowed, null, null, clock);
      }
      return;
    }

    if (ctx.projectId === null) {
      if (oldAllowed) {
        await record(exec, ctx, 'project_unresolved', oldAllowed, null, accountId, clock);
      }
      return;
    }

    const resolved = await resolveAccess(exec, accountId, ctx.projectId);
    const newAllowed = resolved.role !== null;
    if (newAllowed === oldAllowed) return;

    await record(
      exec,
      ctx,
      oldAllowed ? 'old_allowed_new_denied' : 'old_denied_new_allowed',
      oldAllowed,
      resolved,
      accountId,
      clock,
    );
  } catch (error) {
    // Rule 2. A harness that can fail a request is a harness that gets ripped
    // out during an incident, which is precisely when it is most needed.
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'access.shadow.failed',
        endpoint: ctx.endpoint,
        decisionPoint: ctx.decisionPoint,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Wrap a call that performs the shipped permission check.
 *
 * `run()` is the old path, unchanged. It either returns (allowed) or throws
 * `NOT_VISIBLE` (denied). Both outcomes are handed straight back to the caller;
 * the shadow comparison happens in between and changes neither.
 *
 * `isDenial` decides which thrown errors count as a permission denial rather
 * than a genuine failure. Passed in rather than imported so that this file does
 * not have to know the error currency of the layer above it.
 */
export async function withShadow<T>(
  exec: Executor,
  ctx: ShadowContext | ((value: T | null) => ShadowContext),
  run: () => Promise<T>,
  isDenial: (error: unknown) => boolean,
  clock: ShadowClock = systemClock,
): Promise<T> {
  let value: T | null = null;
  let thrown: unknown = null;
  let allowed = false;

  try {
    value = await run();
    allowed = true;
  } catch (error) {
    if (!isDenial(error)) throw error; // Not a permission outcome. Not ours.
    thrown = error;
    allowed = false;
  }

  const resolvedCtx = typeof ctx === 'function' ? ctx(value) : ctx;
  await compareToShadow(exec, resolvedCtx, allowed, clock);

  if (!allowed) throw thrown;
  // `allowed` is only ever true after the assignment above, so this is the
  // value `run()` produced and not a widened null.
  return value as T;
}

/**
 * The set-valued form, for endpoints that return a portfolio rather than one
 * object.
 *
 * A list endpoint's shipped check is a `WHERE org_id = $session` inside the
 * query; the graph's equivalent is "every project `resolveAccess()` allows".
 * Comparing the two sets is where a role mapping that is wrong for one class of
 * user shows up first, because it shows up for every row at once.
 */
export async function compareVisibleProjects(
  exec: Executor,
  ctx: Omit<ShadowContext, 'projectId'>,
  oldVisibleIds: readonly string[],
  clock: ShadowClock = systemClock,
): Promise<void> {
  try {
    const accountId = await accountForLegacyUser(exec, ctx.legacyUserId);
    if (accountId === null) {
      if (oldVisibleIds.length > 0) {
        await record(
          exec,
          { ...ctx, projectId: null },
          'account_not_backfilled',
          true,
          null,
          null,
          clock,
        );
      }
      return;
    }

    const allowed = await resolveVisibleProjects(exec, accountId);
    const oldSet = new Set(oldVisibleIds);
    const onlyOld = [...oldSet].filter((id) => !allowed.has(id));
    const onlyNew = [...allowed.keys()].filter((id) => !oldSet.has(id));

    if (onlyOld.length === 0 && onlyNew.length === 0) return;

    // One row per differing project, so the per-endpoint-per-day count is a
    // count of decisions rather than a count of requests. A single portfolio
    // load that is wrong about eleven projects is eleven findings.
    for (const projectId of [...onlyOld, ...onlyNew]) {
      const oldAllowed = oldSet.has(projectId);
      await record(
        exec,
        { ...ctx, projectId },
        'visible_set_differs',
        oldAllowed,
        allowed.get(projectId) ?? { role: null, via: null },
        accountId,
        clock,
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'access.shadow.failed',
        endpoint: ctx.endpoint,
        decisionPoint: ctx.decisionPoint,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * The candidate-set form: who may be handed a card on one project.
 *
 * `GET /api/engagements/:id/members` returns the shipped answer — every `users`
 * row in the engagement's organization, which is exactly what the write path
 * accepts — and this compares it against `listAssignableAccounts()`, the graph's
 * answer, one row per person the two disagree about.
 *
 * The comparison is in **legacy user ids**, because that is the only identifier
 * the two sides share: the shipped list is `users` rows and the graph's is
 * `accounts` rows joined back through `legacy_user_id`. An account with no
 * legacy id cannot be assigned today and is therefore not a disagreement about
 * assignability — it is the backfill gap `account_not_backfilled` already
 * names, and it is counted there rather than twice.
 *
 * This is the endpoint where a role mapping that is wrong for one class of
 * person shows up as a *name a colleague can see*, which is why it is worth
 * instrumenting rather than assuming: an over-wide graph puts a stranger in a
 * dropdown, and an under-wide one loses half a studio.
 */
export async function compareAssignableMembers(
  exec: Executor,
  ctx: ShadowContext,
  shippedUserIds: readonly string[],
  graphUserIds: readonly string[],
  clock: ShadowClock = systemClock,
): Promise<void> {
  try {
    const accountId = await accountForLegacyUser(exec, ctx.legacyUserId);
    if (accountId === null) {
      if (shippedUserIds.length > 0) {
        await record(exec, ctx, 'account_not_backfilled', true, null, null, clock);
      }
      return;
    }

    const shipped = new Set(shippedUserIds);
    const graph = new Set(graphUserIds);
    const onlyShipped = [...shipped].filter((id) => !graph.has(id));
    const onlyGraph = [...graph].filter((id) => !shipped.has(id));
    if (onlyShipped.length === 0 && onlyGraph.length === 0) return;

    for (const candidateUserId of [...onlyShipped, ...onlyGraph]) {
      const inShipped = shipped.has(candidateUserId);
      await record(
        exec,
        {
          ...ctx,
          input: { ...ctx.input, candidateUserId, side: inShipped ? 'shipped' : 'graph' },
        },
        'assignable_set_differs',
        inShipped,
        null,
        accountId,
        clock,
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'access.shadow.failed',
        endpoint: ctx.endpoint,
        decisionPoint: ctx.decisionPoint,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * The gate on ADR-021's step 4.
 *
 * Seven consecutive days at zero. Counted in whole UTC days ending yesterday,
 * because today is still accumulating and a partial day at zero is not a day at
 * zero. `sinceFirstObservation` guards the other direction: seven silent days
 * because nothing was instrumented is not seven clean days either.
 */
export const CLEAN_DAYS_REQUIRED = 7;

export function isSafeToDeleteOldChecks(
  cleanDaysEndingYesterday: number,
  daysSinceHarnessLive: number,
): boolean {
  return (
    cleanDaysEndingYesterday >= CLEAN_DAYS_REQUIRED &&
    daysSinceHarnessLive >= CLEAN_DAYS_REQUIRED
  );
}

/** Exported for the dashboard's "harness has been live for N days" line. */
export async function harnessFirstObservation(exec: Executor): Promise<Date | null> {
  const rows = await exec
    .select({ first: sql<string | null>`min(${accessShadowDisagreements.observedAt})` })
    .from(accessShadowDisagreements);
  const value = rows[0]?.first;
  return value ? new Date(value) : null;
}
