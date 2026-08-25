/**
 * Seeds the fixtures and mints an agency session, for the upload RSS budget.
 *
 * Exactly the arrangement `tests/fcp-session.ts` uses, and for exactly the same
 * reason. `.github/scripts/check-upload-rss.mjs` measures a **production
 * build**, and `/api/test/*` refuses to mount when `NODE_ENV === 'production'`
 * — correctly, and that gate is not something to weaken for a measurement.
 * DEFECT-5's fix was to gate those endpoints on `E2E_SEED_TOKEN` *and* on not
 * being production; a script that needed the second half relaxed would be a
 * script that had turned a safety property into a testing inconvenience.
 *
 * So the session is established out of band instead of over HTTP: this calls
 * the same `resetToFixtures()` the seed route calls and the same
 * `createTestSession()` the session route calls. Nothing here bypasses a check
 * in the product — it reaches the same two functions from the other side of
 * the process boundary, and `createTestSession()` still signs in an *existing*
 * user only, so this cannot provision an admin.
 *
 * What still goes over HTTP is the part being measured: the presign request,
 * against the real route on the real production server. The seeding is setup;
 * the presign is the subject.
 *
 * Prints one line of JSON: `{ engagementId, cardId, cookie }`.
 */

import { db } from '@/db/client';
import { createTestSession, resetToFixtures } from '@/db/test-support';

/**
 * Auth.js v5 looks for the `__Secure-` prefix over HTTPS and the plain name
 * otherwise. Both are emitted for the same reason `/api/test/session` emits
 * both: the measurement may be pointed at either scheme, and a session that
 * silently fails to attach would present as a 401 on the presign rather than
 * as a cookie-name problem.
 */
const SESSION_COOKIE = 'authjs.session-token';
const SECURE_SESSION_COOKIE = '__Secure-authjs.session-token';

const AGENCY_EMAIL = process.env.RSS_AGENCY_EMAIL ?? 'ada@kestrel.test';

async function main(): Promise<void> {
  const now = new Date();
  const seed = await resetToFixtures(db, now);
  const session = await createTestSession(db, AGENCY_EMAIL, now);
  const cookie = [
    `${SESSION_COOKIE}=${session.sessionToken}`,
    `${SECURE_SESSION_COOKIE}=${session.sessionToken}`,
  ].join('; ');

  process.stdout.write(
    `${JSON.stringify({
      engagementId: seed.engagementId,
      cardId: seed.cardId,
      cookie,
    })}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
