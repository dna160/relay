# RUNBOOK

> The document you read at 3am. It assumes you are tired, that you did not write
> the code, and that something is already wrong.
>
> Everything in **§4 Rollback** and **§6 A purge that failed halfway** is written
> as a command sequence you can paste. Everything marked **NOT YET IMPLEMENTED**
> describes a contract the code must satisfy and does not satisfy today; the
> owning phase is named. Do not treat those sections as operational until the
> phase lands and this line is edited.

**Status:** Phases 1–3 landed. Phase 6 (purge, warnings, export) and Phase 8
(deploy) have not. Nothing in this file has been executed against a real Railway
project yet — PHASE-8 EXIT requires deploy and rollback each executed once
against staging, and that has not happened. See §9.

---

## 1. Deployment topology

Three services in one Railway project, per `docs/ARCHITECTURE.md`.

```
  ┌────────────────────────────────────────────┐
  │ Railway project: relay                     │
  │                                            │
  │  ┌────────────┐   ┌────────────┐           │
  │  │ app        │   │ worker     │           │
  │  │ next start │   │ pg-boss    │           │
  │  │ :3000      │   │ no port    │           │
  │  └─────┬──────┘   └─────┬──────┘           │
  │        │                │                  │
  │        └────────┬───────┘                  │
  │                 ▼                          │
  │          ┌────────────┐                    │
  │          │ postgres   │  pg-boss lives     │
  │          │ 16         │  here too          │
  │          └────────────┘                    │
  └────────────────────────────────────────────┘
                    │
                    ▼  presigned PUT / GET, never through app
             ┌──────────────┐
             │ Cloudflare R2│
             └──────────────┘
```

**app** — the Next.js server. Public. Health check on `/api/health`. Two
replicas in production, one in staging.

**worker** — `tsx src/workers/index.ts`. No public port, no health check
endpoint; liveness is "the process is up and pg-boss is polling". Exactly
**one** replica. The purge worker must not run twice concurrently: pg-boss
gives per-job locking, but a second replica doubles the blast radius of any
bug in a job that deletes things. Scale the app, never the worker.

**postgres** — Postgres 16, Railway managed. Also the pg-boss queue
(ADR: jobs on the same Postgres, no extra infra for v1).

**R2** is outside Railway. File bytes never traverse either service (INV-10).

### The configuration files

`railway.json` in the repo root configures the **app** service only — Railway's
Config as Code is per-service.

> **Railway deprecated Config as Code.** `railway.json` / `railway.toml`
> continue to work for services that already use them until **2026-12-01**, and
> **new services cannot opt into it at all**. A new Relay project therefore
> cannot be stood up from `railway.json`; it needs `.railway/railway.ts`.
>
> **That file now exists, at `.railway/railway.ts`.** QA owns `.railway/**` as
> of round 2 and lifted it out of this section, with four corrections the
> snippet below did not carry — `preDeploy: 'npm run db:migrate'` on the app
> service only (its absence would have meant the first IaC deploy served traffic
> against an un-migrated database), `PGPOOL_MAX`, an explicit staging/production
> bucket split, and a test asserting `E2E_SEED_TOKEN` is set in no environment.
>
> Two things are still open, and both need the Architect:
>
> - **`railway/iac` is not a dependency.** Railway resolves it at deploy time
>   from the `railway` package, which is not in `package.json`. Adding it needs
>   an ADR. Until then the file is correct and un-runnable.
> - **Nothing typechecks or lints it.** `tsc` and `eslint` both skip
>   dot-directories, so `.railway/**` is outside `npm run verify`'s reach.
>   `tests/unit/railway-topology.spec.ts` is the gate that stands in for that:
>   it asserts the migration ordering, the single worker replica, the health
>   check path, the bucket split, and the absence of any committed credential.
>   Adding `.railway` to `tsconfig.json`'s `include` would be better and is
>   blocked on the dependency above.
>
> The snippet below is kept as the annotated original. **The file is the source
> of truth; this is the commentary.** They are cross-checked: the topology spec
> reads `.railway/railway.ts`, never this section.

```ts
// .railway/railway.ts — the whole topology, one file, one source of truth.
import { defineRailway, github, group, postgres, preserve, project, service } from 'railway/iac';

export default defineRailway((ctx) => {
  const prod = ctx.environment === 'production';
  const db = postgres('postgres');

  const shared = {
    DATABASE_URL: db.env.DATABASE_URL,
    AUTH_SECRET: preserve(),
    CLIENT_LINK_SECRET: preserve(),
    CERTIFICATE_SIGNING_KEY: preserve(),
    S3_ENDPOINT: preserve(),
    S3_REGION: 'auto',
    S3_BUCKET: prod ? 'relay-prod' : 'relay-staging',
    S3_ACCESS_KEY_ID: preserve(),
    S3_SECRET_ACCESS_KEY: preserve(),
    S3_PUBLIC_BASE_URL: preserve(),
    RESEND_API_KEY: preserve(),
    EMAIL_FROM: prod ? 'Relay <no-reply@relay.app>' : 'Relay staging <no-reply@staging.relay.app>',
    RETENTION_ARCHIVE_DAYS: '30',
    RETENTION_PURGE_DAYS: '60',
  };

  const app = service('app', {
    source: github('OWNER/relay', { branch: prod ? 'main' : 'staging' }),
    build: 'npm run build',
    start: 'npm run start',
    healthcheck: '/api/health',
    healthcheckTimeout: prod ? 90 : 60,
    replicas: prod ? 2 : 1,
    domains: prod ? ['app.relay.example'] : [],
    env: {
      ...shared,
      AUTH_URL: prod ? 'https://app.relay.example' : 'https://staging.relay.example',
      NEXT_PUBLIC_APP_URL: prod ? 'https://app.relay.example' : 'https://staging.relay.example',
    },
  });

  // Exactly one replica, always. See §1 — a second one doubles the blast
  // radius of a bug in a job whose whole purpose is deleting things.
  const worker = service('worker', {
    source: github('OWNER/relay', { branch: prod ? 'main' : 'staging' }),
    build: 'npm run build',
    start: 'npx tsx src/workers/index.ts',
    replicas: 1,
    env: shared,
  });

  return project('relay', { resources: [group('relay', [db, app, worker])] });
});
```

### The object storage bucket

R2 sits outside Railway and outside every test in this repository, which makes
it the one piece of infrastructure whose misconfiguration is invisible until
production. Two settings are load-bearing.

**1. CORS must expose `ETag`.** The browser completes the multipart upload
itself (ADR-015, INV-10 — the app never sees a byte), which means the browser
has to read the `ETag` off each part's `PUT` response and send the list back to
`CompleteMultipartUpload`. A cross-origin response only exposes `ETag` to
JavaScript if the bucket says so.

```json
[
  {
    "AllowedOrigins": ["https://app.relay.example", "https://staging.relay.example"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Without `ExposeHeaders: ["ETag"]`, every upload above the multipart
threshold fails at complete** — and only there. Single-part uploads succeed,
so small files work and large ones do not; the local dev bucket and every
same-origin test pass, because the restriction is cross-origin only. The
symptom an agency reports is "the big file won't upload", at the deadline,
with a working small file as the counter-example. Found by the front-end while
building the upload flow (F6).

**2. Lifecycle must abort incomplete multipart uploads.** A browser that is
closed mid-upload leaves its parts behind. They are invisible in the bucket
listing and they are billed.

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

Seven days is longer than any legitimate upload and short enough that the
orphans do not accumulate. This rule also matters for INV-7: a purge deletes
the objects it can enumerate, and an abandoned multipart upload is not
enumerable — without this rule, parts of a purged engagement's file could
outlive its purge certificate.

**3. Staging and production never share a bucket.** `.railway/railway.ts` sets
`S3_BUCKET` per environment and `tests/unit/railway-topology.spec.ts` asserts
the two differ. A staging purge against the production bucket destroys real
client deliverables, and purge is irreversible by design.

**4. No public access.** Every read is a presigned GET and every write a
presigned PUT. A publicly listable bucket makes the client link redundant.

None of the four is checkable from this repository. They are the first things
to verify on a new environment and the first things to suspect when uploads
fail in one environment and not another.

---

### Migration ordering — the part that must not be got wrong

`railway.json` sets:

```json
"deploy": { "preDeployCommand": ["npm run db:migrate"] }
```

`preDeployCommand` runs to completion **before the new version receives any
traffic**. That is the ordering requirement: the new app version must never
serve a request against an un-migrated database.

The old version *is* still serving while the migration runs. That is safe only
because migrations are forward-only and additive (CLAUDE.md: "Migrations are
forward-only and never edited after commit"). Which means:

- **Adding** a column, table, index, or enum value: safe. Deploy normally.
- **Dropping or renaming** a column the running version still reads: **not
  safe**. Do it in two deploys — one that stops reading the column, then, after
  it is fully rolled out, one that drops it. A single deploy that renames a
  column takes production down for the length of the migration.
- A migration that takes minutes (a backfill, a non-concurrent index) blocks
  the deploy for that long and the health check may time out. Run those as a
  one-off job, not as `preDeployCommand`.

The worker service must **not** run migrations. Two services racing the same
migration is how you get a half-applied schema. Only `app` has
`preDeployCommand`.

CI asserts the weaker half of this — that `npm run db:migrate` is a no-op when
run twice (`.github/workflows/ci.yml`, job `e2e`, step "migrations are
idempotent"). PHASE-1 EXIT names the same condition.

---

## 2. Environment variable registry

Every variable, what it does, and — the column that matters at 3am — **what
breaks when it is wrong or absent**. Cross-checked against `.env.example` by
`.github/scripts/check-env-registry.mjs`, which runs in CI as the `env registry`
job.

| Variable | Service | Secret | Missing or wrong ⇒ |
|---|---|---|---|
| `DATABASE_URL` | app, worker | yes | Nothing starts. Set by Railway from the `postgres` service; never type it by hand. |
| `PGPOOL_MAX` | app, worker | no | Pool size falls back to its default. Raise it only with Postgres `max_connections` in mind — app replicas × pool + worker must stay under it. Set per environment in `.railway/railway.ts` — lower in production, which runs two app replicas. |
| `AUTH_SECRET` | app | yes | Every agency session is invalid. Rotating it signs everyone out. |
| `AUTH_URL` | app | no | Magic links point at the wrong host. Agency sign-in appears to work and the link 404s. |
| `NEXT_PUBLIC_APP_URL` | app | no | Client-side fetches resolve against the wrong origin. **Not yet in `.env.example`; see §9.** |
| `CLIENT_LINK_SECRET` | app | yes | Every outstanding client magic link stops verifying. Rotating it is the intended blast radius when a link leaks — it invalidates client links **only**, not agency sessions. |
| `S3_ENDPOINT` | app, worker | no | Presign fails; uploads and downloads both break. Bytes never flow through the app, so there is no fallback path (INV-10). |
| `S3_REGION` | app, worker | no | `auto` for R2. Signature mismatches on presigned URLs; symptom is a 403 from R2, not from Relay. |
| `S3_BUCKET` | app, worker | no | Uploads land in the wrong bucket, or nowhere. **Staging and production must never share a bucket** — a staging purge would delete production objects. |
| `S3_ACCESS_KEY_ID` | app, worker | yes | Presign fails. |
| `S3_SECRET_ACCESS_KEY` | app, worker | yes | Presign fails. |
| `S3_PUBLIC_BASE_URL` | app | no | Download redirects point nowhere. |
| `RESEND_API_KEY` | app, worker | yes | No email. Both sign-in flows and — worse — **every purge warning** silently fail. See §5. |
| `EMAIL_FROM` | app, worker | no | Resend rejects the send. Same failure surface as above. |
| `RETENTION_ARCHIVE_DAYS` | worker | no | Defaults to 30. Overridable **in dev only**, so the 60-day timeline can be exercised in a test run. Setting it in production changes when customer data is destroyed. |
| `RETENTION_PURGE_DAYS` | worker | no | Defaults to 60. Same warning, more so. |
| `CERTIFICATE_SIGNING_KEY` | worker | yes | Purge certificates cannot be signed or verified. **Must be stable across deploys** — rotating it makes every previously issued certificate unverifiable, and those certificates are the compliance artifact agencies forward to their client's legal team. Keep the old key for verification if you ever rotate. |
| `E2E_SEED_TOKEN` | CI only | yes | The e2e seed and magic-link-capture endpoints are gated on it. **It must be unset in production**, which is what makes those endpoints safe to ship. |

### Rotating a secret

```bash
railway variables --service app --set "CLIENT_LINK_SECRET=$(openssl rand -base64 32)"
railway redeploy --service app --yes
```

Rotation is a deploy. Do it deliberately and know the blast radius from the
table above — `CLIENT_LINK_SECRET` signs out every client, `AUTH_SECRET` signs
out every agency user, `CERTIFICATE_SIGNING_KEY` invalidates history.

---

## 3. Deploy

```bash
# 0. You are deploying what you think you are deploying.
git log --oneline -1
gh pr checks                     # verify, invariant contract, build, e2e all green

# 1. Staging first, always.
railway environment staging
railway up --service app --detach
railway up --service worker --detach

# 2. Watch the app come up. preDeployCommand (db:migrate) runs before traffic.
railway logs --service app | grep -E 'migrat|listening|error'

# 3. Health check, by hand, once.
curl -fsS https://staging.relay.example/api/health && echo OK

# 4. The smoke test that matters: the client surface, on a phone-sized viewport.
E2E_BASE_URL=https://staging.relay.example npx playwright test --project=client-mobile

# 5. Production.
railway environment production
railway up --service app --detach
railway up --service worker --detach
railway logs --service app --deployment | grep -E 'migrat|error'
curl -fsS https://app.relay.example/api/health && echo OK
```

**Deploy the worker after the app, not before.** The worker acts on rows the app
writes; a worker running new code against a schema the app has not yet started
using is the one ordering that has no upside.

**Do not deploy a purge-behaviour change and a schema change together.** Purge
walks the schema. Land the schema, verify it, then land the purge change.

---

## 4. Rollback

Railway rolls back a *deployment*, not a *migration*. Those are two different
recoveries and conflating them is how a bad hour becomes a bad week.

### 4a. The code is bad, the schema is fine — the common case

```bash
# 1. Find the last deployment that was good. The list is newest first.
railway status --service app
railway list --service app          # or: railway deployment list --service app

# 2. Roll back to it by id. This re-promotes the previous image; it does not
#    rebuild, so it is fast, and it does not touch the database.
railway redeploy --service app --deployment <PREVIOUS_DEPLOYMENT_ID> --yes

# 3. Same for the worker, if the bad deploy included it.
railway redeploy --service worker --deployment <PREVIOUS_DEPLOYMENT_ID> --yes

# 4. Confirm.
curl -fsS https://app.relay.example/api/health && echo OK
railway logs --service app | tail -50
```

This works because migrations are additive: the previous version's queries
still run against the newer schema. That is the whole reason the forward-only
rule exists.

### 4b. Stop the bleeding first, when the worker is doing damage

A bad deploy that only serves 500s is an outage. A bad deploy whose *worker* is
deleting things is worse, and it is the first thing to stop.

```bash
# Take the worker down before anything else. One replica, so this is total.
railway scale --service worker --replicas 0

# Then roll back the app at your own pace, per 4a.
# Bring the worker back only after you have read §6 and know what it did.
railway scale --service worker --replicas 1
```

### 4c. The migration itself is bad

There is no `db:rollback`, deliberately — a down-migration that has never been
run is a down-migration that does not work.

```
1. railway scale --service worker --replicas 0        # stop the jobs
2. Roll the app back (4a). Additive migrations are backward-compatible, so the
   old version will run correctly against the new schema. This is usually the
   whole fix.
3. If the migration is actively destructive — it dropped or rewrote data —
   restore from the Postgres backup instead:
      railway connect postgres          # confirm what is actually there first
   then restore the most recent snapshot from the Railway Postgres backups pane.
   A restore loses everything written since the snapshot. Announce it.
4. Write a *new* forward migration that corrects the bad one. Never edit the
   committed migration file (CLAUDE.md).
```

### Post-rollback, every time

- Say what happened in the incident channel, including whether any purge or
  warning job ran during the window.
- If a purge ran, go to §6 **before** doing anything else.
- Open a PR with the failing case added to `tests/` — the point of the invariant
  harness is that the same failure cannot ship twice.

---

## 5. Reading the logs

Every log line carries the engagement id when there is one (PHASE-8 SCOPE:
"structured logs with engagement id on every line"). Logs are JSON, one object
per line.

```jsonc
{
  "level": "info",
  "msg": "card.transitioned",
  "engagementId": "0193a5f0-c302-...",
  "cardId": "0193a5f0-f601-...",
  "from": "internal_review",
  "to": "awaiting_client",
  "actor": { "kind": "agency", "userId": "..." },
  "requestId": "...",
  "ts": "2026-08-24T22:41:07.113Z"
}
```

```bash
# Everything for one engagement, across both services. This is the first query
# in almost every investigation, because the engagement is the aggregate root.
railway logs --service app    | grep '"engagementId":"<ID>"'
railway logs --service worker | grep '"engagementId":"<ID>"'

# Errors only.
railway logs --service app | jq -c 'select(.level=="error")'

# One request end to end.
railway logs --service app | jq -c 'select(.requestId=="<REQUEST_ID>")'

# What the retention machinery has been doing.
railway logs --service worker | jq -c 'select(.msg|startswith("retention."))'
```

### Log lines worth recognising

| `msg` | Means | Do |
|---|---|---|
| `plan.limit_reached` | A 402. Someone hit their cap. | Nothing. This is the product working. |
| `transition.invalid` | A 409. | Nothing, unless the same card repeats — that is a UI offering an impossible move. |
| `retention.warned` | One of the four warnings went out. | Nothing. Confirm `daysToPurge` looks right. |
| `retention.warn_failed` | A warning did **not** send. | **Act.** Purge must not proceed without four warnings; see §6. Usually `RESEND_API_KEY`. |
| `purge.planned` | A dry run printed a manifest. | Nothing was destroyed. |
| `purge.started` / `purge.completed` | A real purge. | Confirm a certificate exists for that engagement. |
| `purge.failed` | A purge died partway. | **Go to §6.** |
| `storage.presign_failed` | R2 credentials or endpoint. | Check the four `S3_*` variables. Uploads are down. |

If a line has no `engagementId` and it is not a boot line, that is a bug worth
filing — it is the field the whole investigation hangs off.

---

## 6. A purge that failed halfway

> **NOT YET IMPLEMENTED — Phase 6.** The purge worker does not exist. This
> section is the contract it must satisfy, written now because the contract is
> what the code is built against, and because whoever is reading this at 3am
> after the first real failure will not want to derive it then.

### What has actually been executed, and what has not

Everything in this section below the line has been run against a live Postgres,
not reasoned about. `npm run test:db` kills a real purge process with `SIGKILL`
at five points — before the manifest, before the object delete, halfway through
it, **inside the transaction that deletes content**, and after the certificate
but before the tombstone — and reruns each one. Every rerun ends at exactly one
certificate. The `--plan` claim below is checked by diffing row counts around a
real run, not by reading the code.

Two things this exercise turned up that matter at 3am:

- **The last statement of a killed purge can still land after the kill.** A
  backend blocked on a lock has not yet noticed its client is gone; when the
  lock frees it runs the statement, commits, and only then finds nobody to
  answer. So an engagement can read `purged` from a run you are certain you
  killed. This is harmless — step 4 is idempotent — but do not treat a `purged`
  status as proof the run completed. **The certificate is the proof.**
- **A rerun can log `purge.completed` twice.** If the kill landed between the
  audit write and the final checkpoint, the rerun writes a second one. Two
  `purge.completed` rows for one engagement is a known defect, not evidence of
  two purges. There is still exactly one certificate, and the unique index
  guarantees that.

### The one thing to understand first

**Purge is idempotent and resumable. Rerunning it is the correct response to a
partial failure.** It is not a repair operation and it does not need to be done
by hand. The failure mode to avoid is not "it ran twice" — it is "someone
decided it was too dangerous to rerun, and left an engagement with its objects
deleted and no certificate".

Content gone with no certificate is the only unrecoverable outcome. Everything
else the rerun fixes.

### The steps, and what each leaves behind

Purge runs in four checkpointed steps. Each one is recorded before it acts, so a
rerun knows where it stopped.

| # | Step | Leaves behind | Safe to repeat? |
|---|---|---|---|
| 1 | Build the manifest — every object key and every content row, hashed | `purge_manifest` row, `manifest_sha256` | Yes. Rebuilding a manifest destroys nothing. |
| 2 | Delete object bytes from R2, keyed off the manifest | Per-key deletion marks | Yes. A key already gone is **success**, not an error. |
| 3 | Delete content rows and write the certificate — **one transaction** | `purge_certificate`, content gone | Yes. Either both happened or neither did. |
| 4 | Mark the engagement `purged` | `engagements.status = 'purged'` | Yes. |

Step 3 is a single transaction on purpose (INV-7). There is no window in which
the content is gone and the certificate is missing.

### Triage

```bash
# 1. What state is it actually in? Ask the data, not the logs.
railway connect postgres
```

```sql
-- Is there a certificate? If yes, the purge completed. Stop; there is nothing
-- to do. Certificates are unique per engagement.
SELECT id, object_count, total_bytes, purged_at
FROM purge_certificates WHERE engagement_id = '<ID>';

-- More than one certificate is an INV-7 violation. Do not delete either.
-- Capture both rows and escalate — the invariant suite must be extended before
-- anything else about this engagement is touched.
SELECT count(*) FROM purge_certificates WHERE engagement_id = '<ID>';

-- Where did it stop?
SELECT step, status, started_at, finished_at, error
FROM purge_manifest WHERE engagement_id = '<ID>' ORDER BY started_at;

-- Were the four warnings actually sent? Purge must refuse without them.
SELECT count(*) FROM audit_log
WHERE engagement_id = '<ID>' AND action = 'retention.warned';
```

### Then

```bash
# 2. Dry run first. Always. It prints the manifest and destroys nothing, and
#    CI asserts that claim on every push (job: purge --plan smoke test).
railway run --service worker -- npm run purge:plan -- --engagement <ID>

# 3. Read the manifest. Does the object count match what the certificate query
#    said, or what you expect for an engagement of this size? A manifest that
#    is suspiciously large is the signal to stop and get a second person.

# 4. Resume. Same command, no --plan. It picks up from the last completed
#    checkpoint; it does not start over, and it does not double-delete.
railway run --service worker -- npm run purge -- --engagement <ID> --resume

# 5. Verify.
```

```sql
SELECT count(*) FROM purge_certificates WHERE engagement_id = '<ID>';  -- exactly 1
SELECT status FROM engagements WHERE id = '<ID>';                       -- 'purged'
```

### When **not** to rerun

Rerun is the default. These three are the exceptions:

1. **Warnings were never sent** (`retention.warned` count < 4). Purge should
   have refused. If it did not, that is the bug — fix the guard before running
   anything else, and warn the customer now. A silent purge manufactures a
   contract breach for the agency with its own client. That is the failure this
   whole subsystem exists to prevent.
2. **Two certificates exist.** INV-7 is broken. Escalate; do not tidy up.
3. **The manifest names objects from another engagement's key prefix.** Stop
   immediately, scale the worker to zero, and escalate. Do not run `--resume`.

### Recovering an engagement that should not have been purged

Within the tombstone window (30 days, ADR-007), the internal tombstone still
holds the row data — but **the object bytes are gone from R2 and are not
recoverable**. Restore the rows if it helps the customer reconstruct what they
had, and be straight with them about the files. This is why the client-side
free export exists and why it is never paywalled: it is the copy that survives.

---

## 7. Health checks

| Check | Where | Good |
|---|---|---|
| App liveness | `GET /api/health` | 200, body `{"ok":true}` |
| Database | inside `/api/health` | `SELECT 1` under 100ms |
| Worker liveness | Railway process status | Running, one replica |
| Queue depth | `SELECT count(*) FROM pgboss.job WHERE state='created'` | Steady. A growing backlog means the worker is down or wedged. |
| Object storage | first presign of the day | 200 from R2 |

> **Shipped in round 2** (`src/app/api/health/route.ts`). It checks database
> connectivity, not just process liveness — a health check that only proves Node
> is running reports healthy through a total database outage. Both
> `railway.json` and `.railway/railway.ts` point at it, and
> `tests/unit/railway-topology.spec.ts` asserts that the two agree, because a
> health check path that drifts between the two config files fails the deploy
> that uses the stale one.

The health check must **not** touch R2 or Resend. A third-party blip must not
take the app out of rotation.

---

## 8. Incident quick reference

| Symptom | First thing to check |
|---|---|
| Everything 500s right after a deploy | Did `preDeployCommand` fail? `railway logs --service app \| grep migrat` |
| Uploads fail, everything else fine | The four `S3_*` variables. `storage.presign_failed` in the logs. |
| Clients cannot verify their link | `CLIENT_LINK_SECRET` changed, or `RESEND_API_KEY` is dead. |
| Agency cannot sign in, clients can | `AUTH_SECRET` or `AUTH_URL`. |
| No warnings going out | `RESEND_API_KEY`; then whether the worker is running at all. |
| Board loads slowly on mobile | Run `npx playwright test --project=client-mobile` against the environment. The FCP budget is 1.5s on 4G and it is a test, not a hope. |
| An engagement was purged early | §6, then the customer, in that order. |
| Two certificates for one engagement | INV-7. Escalate. Do not delete either row. |

---

## 9. Known gaps

Stated plainly, because a runbook that pretends to be complete is worse than one
that is honest about where it stops.

1. **Nothing here has been executed.** PHASE-8 EXIT requires deploy and rollback
   each performed once against staging. Until that has happened, treat every
   command in §3 and §4 as unverified.
2. **`.railway/railway.ts` exists but cannot run.** The topology is written and
   gated (`tests/unit/railway-topology.spec.ts`, 14 assertions), but the
   `railway/iac` module it imports comes from the `railway` package, which is
   not a dependency. Adding it needs an ADR. Consequence: the file is a correct
   description of the topology that no tool has ever executed — and the
   deprecation cutoff is **2026-12-01**.
3. **`.railway/**` is outside the toolchain.** `tsc` and `eslint` skip
   dot-directories, so a syntax error in the topology file would not fail
   `npm run verify`. The topology spec reads it as text and asserts the
   properties whose violation is an incident; that is a floor, not a substitute
   for a typechecker.
4. **`NEXT_PUBLIC_APP_URL` is read by `src/lib/api-client.core.ts` and is not in
   `.env.example`.** The `env registry` CI job fails on this one line.
   `PGPOOL_MAX` was the other half of this gap and was closed in round 2.
5. **The purge worker, the warning jobs, and `npm run purge:plan` do not exist**
   (Phase 6). §6 is a contract, not a procedure.
6. **No error tracking is wired up** (Phase 8 scope). Right now the only
   observability is `railway logs`.
7. **Backups are Railway's defaults.** Nobody has tested a restore. A backup
   nobody has restored from is a backup you are guessing about, and §4c depends
   on it.
