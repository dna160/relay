/**
 * `npm run access:shadow` — the disagreement dashboard (DELIVERY-PLAN §V).
 *
 *   npm run access:shadow                      # streak + per-endpoint-per-day counts
 *   npm run access:shadow -- --days 30         # a longer window
 *   npm run access:shadow -- --endpoint 'POST /api/cards'   # the rows themselves
 *   npm run access:shadow -- --json            # for a check in CI
 *
 * ## What to do with the output
 *
 * The only acceptable number is zero. A disagreement is a spec bug, not a
 * tolerance: every row means the shipped system and the new graph gave
 * different answers about who may touch what, and one of the two is wrong.
 *
 * `old_allowed_new_denied` — somebody would lose access at step 4. Usually a
 * missing `project_memberships` row: check whether the account's org role
 * derives (only `owner` and `admin` do), and whether the project was created
 * after the backfill ran.
 *
 * `old_denied_new_allowed` — somebody would *gain* access. This is the
 * dangerous direction and there is no benign version of it. Read the row's
 * `input` and reproduce it before anything else.
 *
 * `account_not_backfilled` — a signed-in user with no `accounts` row. Rerun
 * `npm run backfill:identity`; it is idempotent.
 *
 * `project_unresolved` — the harness could not name the object. A locator gap,
 * not a permission finding, but it means that endpoint is not being compared.
 *
 * `visible_set_differs` — a list endpoint returned a different set of projects.
 * One row per differing project, so the count is decisions and not requests.
 *
 * Step 4 of ADR-021 — deleting the old checks — is unlocked by seven
 * consecutive clean days *and* by the harness having been live that long.
 * `isSafeToDeleteOldChecks` answers both halves; this prints both.
 */

import { db, pool } from '@/db/client';
import {
  cleanDayStreak,
  disagreementsByEndpointPerDay,
  recentDisagreements,
} from '@/db/queries/access-shadow';
import {
  CLEAN_DAYS_REQUIRED,
  harnessFirstObservation,
  isSafeToDeleteOldChecks,
} from '@/domain/access/shadow';
import { errorText, log } from './logger';

interface Args {
  days: number;
  endpoint: string | null;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { days: 14, endpoint: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--days') {
      args.days = Number(argv[i + 1] ?? 14);
      i += 1;
    } else if (arg?.startsWith('--days=')) args.days = Number(arg.slice('--days='.length));
    else if (arg === '--endpoint') {
      args.endpoint = argv[i + 1] ?? null;
      i += 1;
    } else if (arg?.startsWith('--endpoint=')) args.endpoint = arg.slice('--endpoint='.length);
  }
  return args;
}

const DAY_MS = 86_400_000;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.endpoint) {
    const rows = await recentDisagreements(db, args.endpoint);
    console.log(JSON.stringify(rows, null, 2));
    return rows.length === 0 ? 0 : 1;
  }

  const [byDay, streak, firstSeen] = await Promise.all([
    disagreementsByEndpointPerDay(db, args.days),
    cleanDayStreak(db),
    harnessFirstObservation(db),
  ]);

  /**
   * "Live for N days" is deliberately *not* inferred from the disagreement
   * table alone — an empty table means either a clean week or a harness that
   * was never wired up, and those must not look the same. Until there is a
   * heartbeat row, an empty table reports zero days live and therefore does not
   * unlock step 4. Erring towards "not yet" is the only safe direction here.
   */
  const daysLive =
    firstSeen === null ? 0 : Math.floor((Date.now() - firstSeen.getTime()) / DAY_MS);
  const safe = isSafeToDeleteOldChecks(streak, daysLive);

  if (args.json) {
    console.log(JSON.stringify({ streak, daysLive, safe, byDay }, null, 2));
    return byDay.length === 0 ? 0 : 1;
  }

  const total = byDay.reduce((sum, row) => sum + row.count, 0);
  console.log(`disagreements in the last ${String(args.days)} days: ${String(total)}`);
  console.log(`consecutive clean days ending yesterday: ${String(streak)} / ${String(CLEAN_DAYS_REQUIRED)}`);
  console.log(`harness observing since: ${firstSeen ? firstSeen.toISOString() : 'no rows yet'}`);
  console.log(
    safe
      ? 'SAFE: ADR-021 step 4 may proceed — delete the old checks, then unskip INV-11.'
      : 'NOT YET: keep both paths running. Do not delete the old checks.',
  );

  if (byDay.length > 0) {
    console.log('');
    console.log('day         count  reason                    endpoint');
    for (const row of byDay) {
      console.log(
        `${row.day}  ${String(row.count).padStart(5)}  ${row.reason.padEnd(24)}  ${row.endpoint}`,
      );
    }
    console.log('');
    console.log("Read one with: npm run access:shadow -- --endpoint '<endpoint>'");
  }

  return total === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.endsWith('access-shadow-cli.ts') === true;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await pool.end();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      log.error('access.shadow.dashboard_failed', { error: errorText(error) });
      await pool.end();
      process.exit(2);
    });
}
