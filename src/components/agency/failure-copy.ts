/**
 * What each documented failure says to an agency user.
 *
 * One place decides the words so that a 402 reads the same on the portfolio as
 * it does in a form. The message the server sends is a developer's sentence;
 * these are the product's.
 *
 * ## The distinction this file exists to keep
 *
 * Production said **"Could not reach the workspace — the connection dropped or
 * the service is restarting. Try again in a moment."** when an upload failed.
 * The actual cause was that object storage was not configured on that
 * deployment: `presignUpload()` throws a plain `Error` when `S3_ENDPOINT` and
 * its keys are absent, `toErrorResponse()` turns anything unrecognised into a
 * 500 `INTERNAL`, and `INTERNAL` had no case here — so it fell to a `default`
 * whose words describe a network blip.
 *
 * Those two failures could not be less alike, and the copy inverted them. A
 * dropped connection is worth retrying immediately and costs nothing. A
 * deployment with no storage configured will answer identically forever, and
 * every retry is a person being told to keep pulling a lever that is not
 * connected to anything. `RATE_LIMITED` was in the same bucket and is worse
 * still: "try again in a moment" is a literal instruction to do the thing that
 * caused the limit.
 *
 * So the rule here is now: **the only failure whose copy says "try again" is a
 * failure where trying again is a different act.** `retryable` carries that
 * judgement to the callers, so a surface cannot print "this will not resolve on
 * its own" above a button labelled Try again.
 *
 * `status: 0` is the tell for the genuine connection case — `request()` in
 * `api-client.core.ts` sets it only when `fetch` itself rejected and no server
 * was ever reached. Everything else got an answer from Relay and is a fault in
 * Relay.
 */

import type { ApiFailure } from '@/lib/api-client.core';

export interface FailureCopy {
  title: string;
  body: string;
  /**
   * Whether pressing the same control again is a reasonable next act.
   *
   * False does not mean "nothing can be done" — it means *this* control will
   * produce this same answer, and the way forward is elsewhere. Surfaces that
   * offer a retry affordance read this rather than assuming.
   */
  retryable: boolean;
}

/**
 * The two storage failures, handled before the switch because they are not in
 * the union the switch is over.
 *
 * `STORAGE_NOT_CONFIGURED` and `STORAGE_UNREACHABLE` are 503s that
 * `POST /api/uploads/presign` raises through `apiErrorOutsideContract()` — real
 * codes the product has names for, which `ERROR_CODES` in `src/lib/types.ts`
 * does not carry yet. `ApiFailure.code` is therefore typed `ErrorCode |
 * TransportCode` while carrying, at runtime, a string neither names. Widening to
 * `string` here is the honest way to read it; a `case` for a literal the union
 * does not contain would not compile, and a cast asserting it does would be a
 * lie about the contract.
 *
 * **This block is temporary in the same way `apiErrorOutsideContract` is.** When
 * the two codes land in `ERROR_CODES` they become ordinary `case`s below and
 * this disappears. Until then, the front-end refusing to render them properly
 * would recreate exactly the bug they were introduced to fix.
 *
 * The split between them is the whole point, and it is the one the old copy
 * destroyed: **not configured** is permanent until a person changes the
 * deployment, so its copy must not offer a retry. **Unreachable** is a blip, so
 * its copy must.
 */
function storageFailureCopy(code: string): FailureCopy | null {
  if (code === 'STORAGE_NOT_CONFIGURED') {
    return {
      title: 'Uploads are switched off on this deployment',
      body: 'File storage has not been set up here, so Relay has nowhere to put a file. Nothing is wrong with your connection, your file, or this engagement, and trying again will fail in exactly the same way — this one needs whoever administers this deployment. Everything else in the workspace works normally.',
      retryable: false,
    };
  }
  if (code === 'STORAGE_UNREACHABLE') {
    return {
      title: 'File storage did not answer',
      body: 'Relay is up and reached storage, but storage did not respond in time. Nothing was uploaded and nothing was lost. This is usually brief — try again.',
      retryable: true,
    };
  }
  return null;
}

export function failureCopy(f: ApiFailure): FailureCopy {
  const storage = storageFailureCopy(f.code);
  if (storage) return storage;

  switch (f.code) {
    case 'PLAN_LIMIT_REACHED':
      return {
        title: 'Active engagement limit reached',
        body: 'This plan runs a fixed number of engagements at once. Wrap one that is finished, or move up a plan.',
        retryable: false,
      };
    case 'INVALID_TRANSITION':
      return {
        title: 'That move is not available',
        body: 'The card has changed since this page loaded. Reload to see where it is now.',
        retryable: false,
      };
    case 'ENGAGEMENT_ARCHIVED':
      return {
        title: 'This engagement is read-only',
        body: 'It was archived after 30 days without activity. Everything is still here to read and to export.',
        retryable: false,
      };
    case 'ENGAGEMENT_PURGED':
      return {
        title: 'This engagement was purged',
        body: 'Its files and content were destroyed on schedule. A deletion certificate listing the hashes and counts went to both parties.',
        retryable: false,
      };
    case 'NOT_VISIBLE':
      return {
        title: 'Not found',
        body: 'This page does not exist, or you no longer have access to it.',
        retryable: false,
      };
    case 'UNAUTHENTICATED':
      return {
        title: 'Sign in to continue',
        body: 'This session has expired. Sign in again to pick up where you left off.',
        retryable: false,
      };
    case 'VALIDATION_FAILED':
      return {
        title: 'That did not go through',
        body: f.message || 'Check the highlighted fields and try again.',
        retryable: false,
      };

    /**
     * Throttled. The one code whose old copy — "try again in a moment" — was an
     * instruction to repeat the offence.
     */
    case 'RATE_LIMITED':
      return {
        title: 'Too many attempts',
        body: 'This has been tried too many times in a short window, so Relay has paused it. Wait a few minutes before trying again; repeating it now extends the pause rather than shortening it.',
        retryable: false,
      };

    /**
     * The request never reached a server. This is the only failure in this file
     * that is genuinely about the connection, and the only one where trying
     * again is a materially different act.
     */
    case 'NETWORK':
      return {
        title: 'Your connection dropped',
        body: 'The request never reached Relay — this is your network or the link between you and it, not the workspace. Everything you have not sent is still here. Try again.',
        retryable: true,
      };

    /**
     * Relay answered and the answer was not readable. A server that returns an
     * unparseable body is a broken server, not a broken connection, and it will
     * return the same body next time.
     */
    case 'MALFORMED':
      return {
        title: 'Relay sent an answer this page could not read',
        body: 'The service responded, so your connection is fine — but the response was not in a shape this page understands. That is a fault on our side. Reload; if it persists, it needs reporting rather than retrying.',
        retryable: false,
      };

    /**
     * A fault inside Relay. This is the case the upload bug fell through: on a
     * deployment with no object storage configured, presigning throws, becomes a
     * 500, and lands here. It is emphatically not a connection problem, and it
     * will answer the same way every time until someone changes the deployment.
     *
     * `INTERNAL` is not in `ERROR_CODES` — `toErrorResponse()` writes it
     * directly for anything it does not recognise — so it arrives here as a
     * string the union does not name, which is why `default` has to hold it and
     * why `default` can no longer say "the connection dropped".
     */
    default:
      return {
        title: 'This did not work, and retrying will not fix it',
        body: 'Relay received the request and failed on its own side. Your connection is fine and nothing you did caused it. If this was an upload, the most common cause is a deployment whose file storage is not configured — no amount of retrying reaches storage that is not there. Report it with the code above.',
        retryable: false,
      };
  }
}
