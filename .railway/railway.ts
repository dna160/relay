/**
 * .railway/railway.ts — the whole topology, one file, one source of truth.
 *
 * Railway deprecated Config as Code. `railway.json` / `railway.toml` keep
 * working for services that already use them until **2026-12-01**, and new
 * services cannot opt into it at all — so a fresh Relay project cannot be stood
 * up from `railway.json`. This file is what stands one up. It supersedes
 * `railway.json` for every new service and must not drift from it while both
 * exist; `.github/scripts/check-env-registry.mjs` fails the build if it does.
 *
 * Lifted out of `docs/RUNBOOK.md` §1 by QA in round 2, with four corrections
 * that the runbook snippet did not carry:
 *
 *   1. `preDeploy: 'npm run db:migrate'` on **app only**. The runbook snippet
 *      omitted it entirely, so the first IaC deploy would have served traffic
 *      against an un-migrated database — the exact ordering `railway.json`
 *      exists to record. Two services racing the same migration is how you get
 *      a half-applied schema, so the worker deliberately has none.
 *   2. `PGPOOL_MAX` — read by `src/`, and the number has to be chosen against
 *      Postgres `max_connections`: app replicas x pool + worker must stay under
 *      it. Production runs two app replicas, so it is lower there, not higher.
 *   3. Staging and production never share an S3 bucket. A staging purge against
 *      the production bucket destroys real client deliverables, and purge is
 *      irreversible by design (INV-7).
 *   4. `E2E_SEED_TOKEN` appears nowhere in this file, in any environment. The
 *      seed and magic-link-capture endpoints are gated on it; its absence is
 *      the whole reason those endpoints are safe to ship. A test asserts it.
 *
 * NOT YET EXECUTED. Nothing here has been run against a real Railway project.
 * See `docs/RUNBOOK.md` §9 — deploy and rollback remain the largest open risk
 * in the build, and this file does not close that; it only unblocks it.
 */

import {
  defineRailway,
  github,
  group,
  postgres,
  preserve,
  project,
  service,
} from 'railway/iac';

/** The GitHub repository both services deploy from. */
const REPO = 'dna160/relay';

export default defineRailway((ctx) => {
  const prod = ctx.environment === 'production';
  const db = postgres('Postgres');

  /**
   * Everything both services need. `preserve()` means "this value is set on the
   * service and IaC must not overwrite it" — every secret is set with
   * `railway variables --set` and never typed into a committed file.
   */
  const shared = {
    DATABASE_URL: db.env.DATABASE_URL,

    // app replicas x pool + worker must stay under Postgres `max_connections`.
    // Production runs two app replicas, so its per-process pool is smaller.
    PGPOOL_MAX: prod ? '8' : '10',

    AUTH_SECRET: preserve(),
    CLIENT_LINK_SECRET: preserve(),
    CERTIFICATE_SIGNING_KEY: preserve(),

    S3_ENDPOINT: preserve(),
    S3_REGION: 'auto',
    // Never the same bucket in two environments. A staging purge would destroy
    // production objects, and a purge is irreversible (INV-7).
    S3_BUCKET: prod ? 'relay-prod' : 'relay-staging',
    S3_ACCESS_KEY_ID: preserve(),
    S3_SECRET_ACCESS_KEY: preserve(),
    S3_PUBLIC_BASE_URL: preserve(),

    RESEND_API_KEY: preserve(),
    EMAIL_FROM: prod
      ? 'Relay <no-reply@relay.app>'
      : 'Relay staging <no-reply@staging.relay.app>',

    // Overridable in dev only. Changing these in production changes when
    // customer data is destroyed.
    RETENTION_ARCHIVE_DAYS: '30',
    RETENTION_PURGE_DAYS: '60',
  };

  const origin = prod
    ? 'https://app.relay.example'
    : 'https://relay-web-staging.up.railway.app';

  const app = service('relay-web', {
    source: github(REPO, { branch: 'main' }),
    build: 'npm run build',
    // Runs to completion before the new version receives any traffic. The old
    // version is still serving while it runs, which is safe only because
    // migrations are forward-only and additive (CLAUDE.md).
    preDeploy: 'npm run db:migrate',
    start: 'npm run start',
    healthcheck: '/api/health',
    healthcheckTimeout: prod ? 90 : 60,
    replicas: prod ? 2 : 1,
    domains: prod ? ['app.relay.example'] : [],
    env: {
      ...shared,
      AUTH_URL: origin,
      NEXT_PUBLIC_APP_URL: origin,
    },
  });

  /**
   * Exactly one replica, always, in every environment. A second one doubles the
   * blast radius of a bug in a job whose whole purpose is deleting things.
   *
   * No `preDeploy`. Only `app` migrates.
   */
  const worker = service('relay-worker', {
    source: github(REPO, { branch: 'main' }),
    build: 'npm run build',
    start: 'npm run worker',
    replicas: 1,
    env: shared,
  });

  return project('relay', { resources: [group('relay', [db, app, worker])] });
});
