/**
 * What `/api/health` claims when it prints `ok`, and what it deliberately does
 * not.
 *
 * ## Why this is a fixture and not a comment in the route
 *
 * The route can only say what it checks. This file says what it *does not*
 * check — and that is the half nobody writes down, which is how a health
 * endpoint ends up printing a four-letter word over a deployment where a core
 * feature is impossible.
 *
 * `tests/unit/health-claim.spec.ts` partitions the runbook's environment
 * registry against these two lists and fails on anything in neither. So the
 * next variable whose absence breaks something cannot quietly land outside the
 * claim: it lands in `HEALTH_PROBES` with a check behind it, or in
 * `HEALTH_BLIND_SPOTS` with a sentence saying what a user sees when it is
 * wrong — and that sentence is then required to appear in `docs/RUNBOOK.md`,
 * where the operator reading the green check will actually find it.
 *
 * Adding an entry here is not a way to make the build pass. It is a way to make
 * a gap **visible**, which is the only honest alternative to closing it.
 */

/** A subsystem `/api/health` really reaches out and touches. */
export interface HealthProbe {
  /** The field it reports under, e.g. `db`. Must exist in the response body. */
  id: string;
  /** The call the route makes. Asserted to appear in the route source. */
  call: string;
  /** The registry variables this probe makes a claim about. */
  covers: readonly string[];
  /** What a green answer here actually proves. */
  why: string;
}

export const HEALTH_PROBES: readonly HealthProbe[] = [
  {
    id: 'db',
    call: 'db.execute',
    covers: ['DATABASE_URL', 'PGPOOL_MAX'],
    why:
      'a round trip to Postgres completed. A Next process boots happily with a wrong ' +
      'DATABASE_URL and then 500s every request, so this is what turns a bad database ' +
      'URL into a failed deploy instead of an outage.',
  },
  {
    id: 'storage',
    call: 'checkStorage',
    covers: ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'],
    why:
      'a HeadBucket succeeded, which proves the credentials, the reachability and the ' +
      'existence of the bucket at once. Without all four variables presign cannot run ' +
      'at all, and INV-10 means there is no fallback path for the bytes.',
  },
];

/** A variable the word `ok` says nothing about, and the reason it does not. */
export interface HealthBlindSpot {
  name: string;
  /** Why probing it is wrong, impossible, or not worth what it costs. */
  why: string;
  /** What a user or an operator actually sees when this one is wrong. */
  symptom: string;
}

/**
 * The declared gaps. Each is a deliberate decision, and each is reproduced in
 * `docs/RUNBOOK.md` §3 so that the person reading a green `/api/health` reads
 * the same list.
 *
 * Two of these deserve to be read as open risks rather than as settled: the
 * email pair. `RESEND_API_KEY` absent means **every purge warning silently
 * fails**, and a purge that nobody was warned about manufactures a contract
 * breach for the agency with its own client — which is the failure the whole
 * retention subsystem exists to prevent. It is unprobed here because a health
 * endpoint must not send mail, not because the risk is small. The purge worker
 * refusing to proceed on an unsendable warning is the right place to catch it,
 * and RUNBOOK §5 is where that is tracked.
 */
export const HEALTH_BLIND_SPOTS: readonly HealthBlindSpot[] = [
  {
    name: 'AUTH_SECRET',
    why:
      'presence is checkable and correctness is not — a set-but-rotated secret looks ' +
      'identical to a correct one from inside the process, and the failure it causes ' +
      'is per-session rather than per-deployment.',
    symptom: 'every agency session is invalid; users are signed out and cannot sign back in.',
  },
  {
    name: 'AUTH_URL',
    why:
      'a wrong value is a value pointing at another valid host, which no in-process ' +
      'check can distinguish from the right one. Asserted against the origin in ' +
      '.railway/railway.ts instead, where the two are set together.',
    symptom: 'agency sign-in appears to work and the magic link 404s on the wrong host.',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    why:
      'inlined into the client bundle at build time, so by the time this route runs the ' +
      'value it would read is not the value the browser has. A build-time check is the ' +
      'only honest one.',
    symptom: 'client-side fetches resolve against the wrong origin.',
  },
  {
    name: 'CLIENT_LINK_SECRET',
    why: 'same shape as AUTH_SECRET — presence proves nothing and rotation is invisible.',
    symptom: 'every outstanding client magic link stops verifying.',
  },
  {
    name: 'S3_REGION',
    why:
      'defaults to `auto`, which is correct for R2 and for MinIO, so an unset region is ' +
      'a working deployment and does not belong in a list of reasons uploads are broken.',
    symptom: 'a 403 on a presigned URL, from the object store rather than from Relay.',
  },
  {
    name: 'S3_PUBLIC_BASE_URL',
    why:
      'nothing in src/ reads it. It is in the registry, .env.example and the Railway ' +
      'topology and it is referenced by no code, which makes it a documented variable ' +
      'with no behaviour — see the defect list. Probing a variable nothing reads would ' +
      'fail deployments over a setting that changes nothing.',
    symptom: 'nothing, today. That is the problem with it.',
  },
  {
    name: 'RESEND_API_KEY',
    why:
      'a health endpoint must not send mail. Probing it would mean either an API call ' +
      'per poll or a presence check that proves nothing, and this route is polled by ' +
      'Railway and scanned by everything else.',
    symptom:
      'no email at all: both sign-in flows, and — the one that matters — every purge ' +
      'warning fails silently. RUNBOOK §5.',
  },
  {
    name: 'EMAIL_FROM',
    why: 'same surface as RESEND_API_KEY, and unverifiable without a send.',
    symptom: 'Resend rejects every send; identical user-visible failure to a missing key.',
  },
  {
    name: 'CERTIFICATE_SIGNING_KEY',
    why:
      'the app never signs a certificate — the worker does — so this route would be ' +
      'reporting on a service it is not. The purge worker already refuses to run ' +
      'without it, which is a better place to catch it: it fails the destructive ' +
      'operation rather than the deployment.',
    symptom:
      'a purge refuses to start, loudly, rather than destroying content it cannot ' +
      'certify. The safe failure.',
  },
  {
    name: 'RETENTION_ARCHIVE_DAYS',
    why: 'defaults to 30 and only the worker reads it. An unset value is the intended value.',
    symptom: 'nothing on the app; the worker uses the default timeline.',
  },
  {
    name: 'RETENTION_PURGE_DAYS',
    why: 'defaults to 60 and only the worker reads it. An unset value is the intended value.',
    symptom: 'nothing on the app; the worker uses the default timeline.',
  },
  {
    name: 'E2E_SEED_TOKEN',
    why:
      'its **absence** is the correct production state — it gates the seed and ' +
      'magic-link-capture endpoints, and their being unmountable is what makes them ' +
      'safe to ship. A health check reporting on it would be reporting a problem where ' +
      'the desired configuration is "unset".',
    symptom: 'nothing in production. In CI, the seed endpoints 404 and the e2e run fails.',
  },
];
