/**
 * Seeds the fixtures and mints a verified client session, for the FCP gate.
 *
 * The gate measures a **production build**, and the `/api/test/*` endpoints are
 * unmounted when `NODE_ENV === 'production'` — correctly, they must not exist
 * on a real deployment. So the session is established out of band instead of
 * over HTTP: this seeds through the same `resetToFixtures()` the seed endpoint
 * calls, and signs a session with the same `signClientSession()` the verify
 * route calls. Nothing here weakens or bypasses a check in the product; it
 * reaches the same two functions from the other side of the process boundary.
 *
 * The one thing it cannot do over HTTP is read the magic-link code: that is
 * held in an in-memory capture inside the server process and only its hash
 * reaches the database. That is a good property and not one to work around.
 *
 * Prints one line of JSON on stdout: `{ engagementToken, cookieValue }`.
 */

import { db } from '@/db/client';
import { resetToFixtures } from '@/db/test-support';
import { engagementToken, signClientSession } from '@/lib/auth';
import { CONTACT } from '@tests/fixtures';

async function main(): Promise<void> {
  const now = new Date();
  const seed = await resetToFixtures(db, now);
  const session = signClientSession(CONTACT.active, seed.engagementId, now);
  process.stdout.write(
    `${JSON.stringify({
      engagementToken: engagementToken(seed.engagementId),
      cookieValue: session.value,
    })}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
