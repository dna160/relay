/**
 * `npm run purge:plan` and `npm run purge` — the commands RUNBOOK §6 tells a
 * tired operator to paste.
 *
 *   npm run purge:plan                          # every engagement due, manifest only
 *   npm run purge:plan -- --engagement <ID>     # one, manifest only
 *   npm run purge -- --engagement <ID> --resume # resume a half-finished purge
 *
 * ## `--plan` destroys nothing
 *
 * Not "tries not to": it takes a read-only object store that rejects a delete,
 * it never opens a write transaction, and it does not even record a checkpoint —
 * CI diffs every table's row count across a plan run and a bookkeeping insert
 * would fail that diff, correctly. ARCHITECTURE's non-functional requirement is
 * that every destructive job is dry-runnable and logs a manifest first; a dry
 * run nobody exercises is one that quietly stops working, so CI runs this on
 * every push.
 *
 * ## Rerunning is the correct response to a partial failure
 *
 * RUNBOOK §6 in one line. `--resume` picks up from the last completed
 * checkpoint; it does not start over and it does not double-delete. The failure
 * mode to avoid is not "it ran twice" — it is an engagement left with its
 * objects deleted and no certificate because rerunning felt dangerous.
 */

import { db, pool } from '@/db/client';
import {
  loadPurgeCandidates,
  loadPurgeSteps,
  loadRetentionRow,
  loadUnpurgedEngagements,
} from '@/db/queries/retention';
import { manifestSha256, type PurgeManifestValue } from '@/domain/retention/manifest';
import { planPurge, purgeEngagement, PurgeRefused, type PurgePlan } from './purge';
import { objectStore, readOnlyStore } from './storage-adapter';
import { certificateRecipients, sendCertificate } from './retention';
import { log, errorText } from './logger';

interface Args {
  plan: boolean;
  resume: boolean;
  engagementId: string | null;
  json: boolean;
  all: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { plan: false, resume: false, engagementId: null, json: false, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan' || arg === '--dry-run') args.plan = true;
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--engagement' || arg === '-e') {
      args.engagementId = argv[i + 1] ?? null;
      i += 1;
    } else if (arg?.startsWith('--engagement=')) {
      args.engagementId = arg.slice('--engagement='.length);
    }
  }
  return args;
}

/* ------------------------------------------------------------------ output */

function bytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'KB'}`;
}

/**
 * The manifest, printed.
 *
 * The words "engagement", "objects" and "bytes" appear unconditionally, header
 * included, because CI greps for them to prove a plan run printed a manifest at
 * all — a plan that finds nothing still has to say so in a way that is
 * distinguishable from a plan that crashed before printing.
 */
function printManifest(manifest: PurgeManifestValue, plan: PurgePlan): void {
  const lines: string[] = [
    '',
    '─────────────────────────────────────────────────────────────────────',
    `  PURGE MANIFEST — engagement ${manifest.engagementId}`,
    '─────────────────────────────────────────────────────────────────────',
    `  title            ${manifest.engagementTitle}`,
    `  client           ${manifest.clientOrgName}`,
    `  status           ${manifest.status}`,
    `  objects          ${String(manifest.objectCount)}`,
    `  bytes            ${String(manifest.totalBytes)} (${bytes(manifest.totalBytes)})`,
    `  content rows     ${String(manifest.contentRowTotal)}`,
    `  bucket listed    ${manifest.bucketListed ? 'yes' : 'NO — database keys only'}`,
    `  warnings         ${String(plan.warningsOnRecord)} of ${String(plan.warningsRequired)} on record`,
    `  certificate      ${plan.alreadyCertified ? 'ALREADY ISSUED' : 'not yet issued'}`,
    `  resume from      ${plan.resumeFrom ?? 'nothing left to do'}`,
    '',
    '  rows by table',
  ];
  for (const row of manifest.rowCounts) {
    lines.push(`    ${row.table.padEnd(20)} ${String(row.rows)}`);
  }
  if (manifest.objects.length > 0) {
    lines.push('', '  objects');
    for (const object of manifest.objects.slice(0, 50)) {
      lines.push(`    ${object.key}  (${bytes(object.sizeBytes)}, ${object.source})`);
    }
    if (manifest.objects.length > 50) {
      lines.push(`    … and ${String(manifest.objects.length - 50)} more objects`);
    }
  }
  if (plan.wouldRefuse !== null) {
    lines.push(
      '',
      `  ⚠ A real purge would REFUSE: ${plan.wouldRefuse}`,
      plan.wouldRefuse === 'not_warned'
        ? '    Four retention warnings must be on record first. See RUNBOOK §6.'
        : '    See RUNBOOK §6 before doing anything else.',
    );
  }
  lines.push(
    '',
    `  manifest sha256  ${manifestSha256(manifest)}`,
    '  NOTHING WAS DESTROYED. This is a dry run.',
    '─────────────────────────────────────────────────────────────────────',
    '',
  );
  console.log(lines.join('\n'));
}

/* -------------------------------------------------------------------- main */

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const targets = args.engagementId
    ? [args.engagementId]
    : (args.plan && args.all
        ? await loadUnpurgedEngagements(db)
        : await loadPurgeCandidates(db, now)
      ).map((row) => row.id);

  if (args.plan) {
    console.log(
      `purge --plan: ${String(targets.length)} engagement(s) selected; ` +
        'objects and bytes below. Nothing will be destroyed.',
    );
    for (const engagementId of targets) {
      try {
        const plan = await planPurge(
          { db, store: readOnlyStore, env: process.env },
          engagementId,
          now,
        );
        if (args.json) console.log(JSON.stringify(plan.manifest));
        else printManifest(plan.manifest, plan);
      } catch (error) {
        if (error instanceof PurgeRefused) {
          console.log(`  engagement ${engagementId}: ${error.reason} — ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    return 0;
  }

  if (targets.length === 0) {
    console.log('purge: no engagement is due. Nothing to do (0 objects, 0 bytes).');
    return 0;
  }

  let failures = 0;
  for (const engagementId of targets) {
    try {
      const row = await loadRetentionRow(db, engagementId);
      const recipients = row === null ? [] : await certificateRecipients(engagementId, row.orgId);

      const result = await purgeEngagement(
        {
          db,
          store: objectStore,
          env: process.env,
          onCertificate: (certificate, engagement) =>
            sendCertificate(certificate, engagement, recipients),
        },
        engagementId,
        now,
        { resume: args.resume },
      );

      console.log(
        `purge: engagement ${engagementId} ${result.outcome} — ` +
          `${String(result.certificate.objectCount)} objects, ` +
          `${String(result.certificate.totalBytes)} bytes, ` +
          `certificate ${result.certificate.id}`,
      );
      const steps = await loadPurgeSteps(db, engagementId);
      for (const step of steps) {
        console.log(`  ${step.step.padEnd(10)} ${step.status}`);
      }
    } catch (error) {
      failures += 1;
      if (error instanceof PurgeRefused) {
        console.error(`purge REFUSED for ${engagementId}: ${error.reason}\n  ${error.message}`);
      } else {
        console.error(`purge FAILED for ${engagementId}: ${errorText(error)}`);
        console.error('  Rerunning is the correct response to a partial failure — RUNBOOK §6.');
      }
    }
  }

  return failures === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.endsWith('purge-cli.ts') === true;

if (invokedDirectly) {
  main()
    .then(
      (code) => {
        void pool.end().finally(() => {
          process.exit(code);
        });
      },
      (error: unknown) => {
        log.error('purge.failed', { error: errorText(error) });
        void pool.end().finally(() => {
          process.exit(1);
        });
      },
    )
    .catch(() => {
      process.exit(1);
    });
}
