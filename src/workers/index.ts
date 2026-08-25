/**
 * The worker process. `npm run dev:worker`, and `npx tsx src/workers/index.ts`
 * in production (RUNBOOK §1).
 *
 * **Exactly one replica.** pg-boss gives per-job locking, but a second replica
 * doubles the blast radius of any bug in a job whose whole purpose is deleting
 * things. Scale the app, never the worker.
 *
 * Nothing here decides anything. The schedules say *when*, the jobs in
 * `retention.ts`, `purge.ts` and `export.ts` say *what*, and the purge guard
 * says *whether* — four warnings on record or it refuses, regardless of how the
 * job got queued.
 */

import { db } from '@/db/client';
import { certificateRecipients, runArchiveSweep, runPurgeSweep, runWarningSweep, sendCertificate } from './retention';
import { purgeEngagement, PurgeRefused } from './purge';
import { runExportJob, type ExportJobData } from './export';
import { objectStore } from './storage-adapter';
import { QUEUES, getBoss, stopBoss } from './queue';
import { log, errorText } from './logger';

/**
 * Hourly, not daily. A daily sweep means the four warnings land at whatever
 * time of day the worker happened to be deployed, and an engagement can sit a
 * full day past its purge date. Hourly costs one index scan.
 */
const HOURLY = '0 * * * *';

export async function startWorker(): Promise<void> {
  const boss = await getBoss();

  await boss.work(QUEUES.retentionArchive, async () => {
    const result = await runArchiveSweep();
    log.info('retention.archive_sweep', result);
    return result;
  });

  await boss.work(QUEUES.retentionWarn, async () => {
    const result = await runWarningSweep();
    log.info('retention.warn_sweep', result);
    return result;
  });

  await boss.work(QUEUES.retentionPurgeSweep, async () => {
    const result = await runPurgeSweep();
    log.info('retention.purge_sweep', result);
    return result;
  });

  await boss.work<{ engagementId: string }>(QUEUES.purgeEngagement, async (jobs) => {
    for (const job of jobs) {
      const { engagementId } = job.data;
      try {
        /**
         * The recipient list is captured **before** the purge, because the
         * client contacts are content and will not exist afterwards. Reading it
         * after would send the certificate to the agency only, which is the
         * asymmetry this whole subsystem exists to avoid.
         */
        const engagementRow = await loadOrgId(engagementId);
        const recipients =
          engagementRow === null ? [] : await certificateRecipients(engagementId, engagementRow);

        await purgeEngagement(
          { db, store: objectStore, env: process.env, onCertificate: (certificate, engagement) => sendCertificate(certificate, engagement, recipients) },
          engagementId,
          new Date(),
        );
      } catch (error) {
        if (error instanceof PurgeRefused) {
          // A refusal is the safe outcome. It is not retried, because retrying
          // will refuse identically until a person does something about it.
          log.warn('purge.refused', {
            engagementId,
            reason: error.reason,
            detail: error.message,
          });
          continue;
        }
        throw error;
      }
    }
  });

  await boss.work<ExportJobData>(QUEUES.exportBuild, async (jobs) => {
    const job = jobs[0];
    if (!job) return undefined;
    return runExportJob(job.data, job.id);
  });

  await boss.schedule(QUEUES.retentionArchive, HOURLY);
  await boss.schedule(QUEUES.retentionWarn, HOURLY);
  await boss.schedule(QUEUES.retentionPurgeSweep, HOURLY);

  log.info('worker.started', { queues: Object.values(QUEUES) });
}

async function loadOrgId(engagementId: string): Promise<string | null> {
  const { loadRetentionRow } = await import('@/db/queries/retention');
  const row = await loadRetentionRow(db, engagementId);
  return row?.orgId ?? null;
}

const invokedDirectly = process.argv[1]?.endsWith('workers/index.ts') === true;

if (invokedDirectly) {
  startWorker().catch((error: unknown) => {
    log.error('worker.start_failed', { error: errorText(error) });
    process.exit(1);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info('worker.stopping', { signal });
      stopBoss().then(
        () => {
          process.exit(0);
        },
        () => {
          process.exit(1);
        },
      );
    });
  }
}
