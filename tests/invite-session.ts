/**
 * Mints one real organization invitation, out of band, for the bundle audit.
 *
 * Exactly the arrangement `tests/fcp-session.ts` uses, and for exactly the same
 * reason. `.github/scripts/check-chunk-purity.mjs` measures a **production
 * build**, and `/api/test/*` refuses to mount when `NODE_ENV === 'production'`
 * — correctly, and that gate is not something to weaken for a measurement. So
 * the invitation is created by calling the same domain functions the route
 * calls, from the other side of the process boundary.
 *
 * Nothing here bypasses a check in the product: `issueInvite()` is what
 * `POST /api/orgs/:id/invites` calls, and the token it returns grants nothing
 * on its own (INV-12). The audit only ever *reads* the page it opens.
 *
 * Prints one line of JSON: `{ token }`.
 */

import { db } from '@/db/client';
import { resetToFixtures } from '@/db/test-support';
import { ensureAccountForVerifiedEmail } from '@/domain/access/provision-account';
import { issueInvite } from '@/domain/auth/invite';
import { ORG } from './fixtures/ids';

/** The fixture org's admin, who is the inviter on every other surface too. */
const INVITER = 'ada@kestrel.test';

/**
 * Never a real address, and never one that could receive anything. The audit
 * only renders the preview; nothing is sent, and a token minted here is
 * discarded when the next run reseeds.
 */
const INVITEE = 'bundle-probe@kestrel.test';

async function main(): Promise<void> {
  const now = new Date();
  await resetToFixtures(db, now);

  const account = await ensureAccountForVerifiedEmail(
    db,
    { email: INVITER, verifiedAt: now },
    'Ada Okonjo',
    now,
  );

  const { token } = await issueInvite(
    db,
    {
      targetKind: 'org',
      targetId: ORG.free,
      orgId: ORG.free,
      email: INVITEE,
      role: 'member',
      invitedByAccountId: account.accountId,
    },
    now,
  );

  process.stdout.write(`${JSON.stringify({ token })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
