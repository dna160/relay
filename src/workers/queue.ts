/**
 * The job queue. pg-boss on the same Postgres as everything else — no extra
 * infrastructure for v1 (ARCHITECTURE).
 *
 * One instance per process, created lazily. The app sends jobs; the worker
 * sends and consumes them. Both call `getBoss()`, and neither opens a second
 * connection pool for the queue than it needs.
 *
 * **Exactly one worker replica runs these.** RUNBOOK §1 is explicit about why:
 * pg-boss gives per-job locking, but a second replica doubles the blast radius
 * of any bug in a job whose whole purpose is deleting things. Scale the app,
 * never the worker.
 */

import PgBoss from 'pg-boss';

export const QUEUES = {
  /** `last_activity_at + 30d` -> archived, and the first of the four warnings. */
  retentionArchive: 'retention.archive',
  /** The +14d, +23d and +29d notices, and any the worker owes from downtime. */
  retentionWarn: 'retention.warn',
  /** Enqueues one `purge.engagement` per engagement that is due. */
  retentionPurgeSweep: 'retention.purge-sweep',
  /** One engagement, four checkpointed steps. The destructive one. */
  purgeEngagement: 'purge.engagement',
  /** Builds an export bundle and puts it in object storage. */
  exportBuild: 'export.build',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/**
 * pg-boss v10 requires a queue to exist before anything is sent to it or worked
 * off it. Created on every start rather than in a migration: the queue tables
 * are pg-boss's own schema and drizzle does not own them.
 */
async function ensureQueues(instance: PgBoss): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    await instance.createQueue(name);
  }
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const instance = new PgBoss({
      connectionString: connectionString(),
      // The worker is one replica and the app sends far more than it consumes.
      max: Number(process.env.PGPOOL_MAX ?? 5),
    });
    instance.on('error', (error) => {
      console.error(
        JSON.stringify({ level: 'error', msg: 'queue.error', error: error.message, ts: new Date().toISOString() }),
      );
    });
    await instance.start();
    await ensureQueues(instance);
    boss = instance;
    return instance;
  })();
  return starting;
}

export async function stopBoss(): Promise<void> {
  if (!boss) return;
  const instance = boss;
  boss = undefined;
  starting = undefined;
  await instance.stop({ graceful: true });
}
