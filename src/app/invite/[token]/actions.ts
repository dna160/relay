'use server';

/**
 * The two things this screen does that are not a read.
 *
 * **This module exports async functions and nothing else.** A `'use server'`
 * file that exports a non-async value fails `next build` at page-data
 * collection while typecheck, lint and both unit suites stay green; that is a
 * recorded round-3 defect and the reason the old `signin/actions.ts` kept its
 * initial state in the component. There is nothing here to be tempted by, and
 * this paragraph is why it stays that way.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { inviteApi } from '@/lib/api-client.invite';
import type { ApiFailure } from '@/lib/api-client.core';
import { signOut } from '@/lib/auth';

/**
 * Redeeming, as a server action rather than a `fetch` from the browser — and
 * the reason is a bundle rather than a preference.
 *
 * A successful redemption ends in one place: the portfolio, because the person
 * is an agency member now and that is where a member lands. Written in the
 * client component that shape is `router.push('/portfolio')`, and
 * **`"/portfolio"` is on the bundle audit's agency route list.** The audit
 * found it there, in the chunk served to somebody holding an emailed link who
 * is in neither audience — which is precisely the leak shape Phase 4's exit
 * condition exists to catch, one surface further out than it was written for.
 *
 * The fix is not to argue that one destination is not a map. It is that the
 * destination was never the browser's to know: this action runs on the server,
 * `redirect()` runs on the server, and the browser follows a 303 to a URL it
 * was never told. Nothing about where an agency member belongs crosses the wire
 * to a person who has not yet become one.
 *
 * It is also the better shape on its own terms. Redemption is a mutation whose
 * entire success case is a navigation, and `useActionState` gives the pending
 * state and the failure slot that `useAction` was giving before.
 *
 * @returns the failure, for the panel to render. A success never returns —
 *   `redirect()` throws a control-flow signal that Next catches, which is why
 *   it is called outside the branch that inspects the result rather than inside
 *   a `try`.
 */
export async function redeemInviteAction(
  token: string,
  _previous: ApiFailure | null,
  _formData: FormData,
): Promise<ApiFailure | null> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  const result = await inviteApi.redeem(token, cookie ? { cookie } : {});
  if (!result.ok) return result;

  /*
   * Outside any `try`. `redirect()` signals by throwing, and a `catch` around
   * it turns a successful join into a caught error and a page that says
   * nothing happened.
   */
  redirect('/portfolio');
}

/**
 * Signing out, so the invited address can be used instead.
 *
 * The one remedy the mismatch screen offers that is an action rather than a
 * sentence: somebody with two addresses, already signed in with the wrong one,
 * whose way forward is to drop this session and open the same link again. It
 * exists here and nowhere else in the product, because this is the one screen
 * where being signed in as the wrong person is the obstacle.
 *
 * `redirectTo` is built from the token rather than taken from the request, so
 * there is no parameter to point somewhere else — the value is encoded into a
 * single path segment and the destination is always this product's own invite
 * route. An open redirect on a page reached by strangers holding emailed links
 * would be the worst possible place for one.
 *
 * The token is bound by the page (`signOutAndReturn.bind(null, token)`), which
 * is what lets the client component receive it as a plain `() => Promise<void>`
 * and know nothing about how the session is held.
 */
export async function signOutAndReturn(token: string): Promise<void> {
  await signOut({ redirectTo: `/invite/${encodeURIComponent(token)}` });
}
