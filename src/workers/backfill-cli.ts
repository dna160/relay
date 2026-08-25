/**
 * `npm run backfill:identity` — ADR-021's step 2, run by hand as a pre-deploy
 * step and never on boot.
 *
 *   npm run backfill:identity -- --plan        # manifest only, writes nothing
 *   npm run backfill:identity                  # write the graph
 *   npm run backfill:identity -- --rollback    # take it back out again
 *   npm run backfill:identity -- --verify      # run twice + roll back, and prove it
 *
 * Everything runs inside one transaction. A backfill that fails halfway and
 * leaves a partial permission graph is worse than one that does not run.
 *
 * `--rollback` is the destructive direction, so it prints its manifest first
 * and refuses without `--yes` unless `--plan` was asked for.
 */

import { db, pool } from '@/db/client';
import {
  isEmpty,
  planBackfill,
  rollbackBackfill,
  runBackfill,
  type BackfillCounts,
} from '@/db/backfill/identity-graph';
import { log, errorText } from './logger';

interface Args {
  plan: boolean;
  rollback: boolean;
  verify: boolean;
  yes: boolean;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { plan: false, rollback: false, verify: false, yes: false, json: false };
  for (const arg of argv) {
    if (arg === '--plan' || arg === '--dry-run') args.plan = true;
    else if (arg === '--rollback') args.rollback = true;
    else if (arg === '--verify') args.verify = true;
    else if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--json') args.json = true;
  }
  return args;
}

function table(title: string, counts: BackfillCounts): string {
  return [
    title,
    `  accounts             ${String(counts.accounts)}`,
    `  identities           ${String(counts.identities)}`,
    `  personal orgs        ${String(counts.personalOrgs)}`,
    `  org memberships      ${String(counts.orgMemberships)}`,
    `  project memberships  ${String(counts.projectMemberships)}`,
  ].join('\n');
}

/**
 * The exit condition, executed rather than asserted in prose: run, run again,
 * and roll back. A second run must write nothing, and the rollback must remove
 * exactly what the first run wrote.
 */
async function verify(): Promise<boolean> {
  /**
   * Start from a clean graph, or the first run writes nothing and the rollback
   * removes rows it did not write — which reads as "not reversible" and is
   * really "you ran this against an already-backfilled database". The check has
   * to establish its own preconditions or it reports the wrong failure.
   */
  await db.transaction((tx) => rollbackBackfill(tx));

  const first = await db.transaction((tx) => runBackfill(tx));
  const second = await db.transaction((tx) => runBackfill(tx));
  const undone = await db.transaction((tx) => rollbackBackfill(tx));

  const idempotent = isEmpty(second);
  const reversible =
    undone.accounts === first.accounts &&
    undone.identities === first.identities &&
    undone.personalOrgs === first.personalOrgs &&
    undone.orgMemberships === first.orgMemberships &&
    undone.projectMemberships === first.projectMemberships;

  console.log(table('first run wrote', first));
  console.log(table('second run wrote (must be all zero)', second));
  console.log(table('rollback removed (must equal the first run)', undone));
  console.log(`idempotent: ${String(idempotent)}`);
  console.log(`reversible: ${String(reversible)}`);

  // Leave the database in the state the operator expected: backfilled.
  if (idempotent && reversible) await db.transaction((tx) => runBackfill(tx));
  return idempotent && reversible;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.verify) return (await verify()) ? 0 : 1;

  const plan = await planBackfill(db);
  console.log(table('already in the graph', plan.existing));
  console.log(`users without an account: ${String(plan.toWrite.accounts)}`);

  if (args.plan) {
    console.log('--plan: nothing written.');
    return 0;
  }

  if (args.rollback) {
    if (!args.yes) {
      console.error('--rollback removes every backfilled row. Re-run with --yes.');
      return 1;
    }
    const removed = await db.transaction((tx) => rollbackBackfill(tx));
    console.log(table('rolled back', removed));
    if (args.json) console.log(JSON.stringify(removed));
    return 0;
  }

  const written = await db.transaction((tx) => runBackfill(tx));
  console.log(table('written', written));
  if (args.json) console.log(JSON.stringify(written));
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith('backfill-cli.ts') === true;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await pool.end();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      log.error('backfill.failed', { error: errorText(error) });
      await pool.end();
      process.exit(1);
    });
}
