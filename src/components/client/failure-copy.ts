/**
 * What each documented failure says to a client contact.
 *
 * Not the agency's words. A client is never told about plan limits, internal
 * review, or what the agency should do about it — 402 is the agency's problem
 * and saying so here would be both confusing and a small leak of how the
 * agency's account is configured.
 *
 * `NOT_VISIBLE` reads as a plain 404, which is the whole point of returning one
 * rather than a 403: a 403 would confirm that the thing exists (INV-1).
 */

import type { ApiFailure } from '@/lib/api-client.core';

export interface FailureCopy {
  title: string;
  body: string;
}

export function failureCopy(f: ApiFailure): FailureCopy {
  switch (f.code) {
    case 'INVALID_TRANSITION':
      return {
        title: 'This has already moved',
        body: 'Someone updated this deliverable while you were reading it. Reload to see where it is now.',
      };
    case 'ENGAGEMENT_ARCHIVED':
      return {
        title: 'This workspace is read-only',
        body: 'It has been quiet for a while. Everything is still here to read, and the export still works.',
      };
    case 'ENGAGEMENT_PURGED':
      return {
        title: 'This workspace was deleted',
        body: 'Its files were destroyed on the date shown in the notices you were sent, and a deletion certificate listing every file and hash went to you and to your agency.',
      };
    case 'NOT_VISIBLE':
      return { title: 'Not found', body: 'This page does not exist, or the link has expired.' };
    case 'UNAUTHENTICATED':
      return {
        title: 'Your link has expired',
        body: 'Enter your email again and we will send a fresh code.',
      };
    case 'VALIDATION_FAILED':
      return { title: 'That did not go through', body: f.message || 'Check the fields and try again.' };

    /**
     * 429, and on this surface it is almost always the sign-in code: six digits
     * in a fifteen-minute window is a guessable space, so `POST
     * /api/auth/client/verify` throttles. The old copy for this was "the
     * connection dropped … try again in a moment", which is both untrue and an
     * instruction to keep guessing.
     *
     * A client contact did not do anything wrong here — a mistyped code twice
     * over reaches this — so the words say what to do, not what went wrong.
     */
    case 'RATE_LIMITED':
      return {
        title: 'Too many tries',
        body: 'For safety this pauses after several attempts. Wait a few minutes, then ask for a fresh code — a new one will work.',
      };

    /**
     * The request never reached us. The only failure here that is actually
     * about the connection, and the only one where trying again is worth doing
     * straight away.
     */
    case 'NETWORK':
      return {
        title: 'Your connection dropped',
        body: 'The request did not reach us. Check your connection and try again — nothing has been lost.',
      };

    /**
     * Everything else got an answer, so it is ours to fix and not something a
     * client contact can retry their way out of. `PLAN_LIMIT_REACHED` stays
     * folded in here deliberately: 402 is the agency's billing problem and
     * naming it would leak how their account is configured (see the note at the
     * top of this file).
     */
    case 'PLAN_LIMIT_REACHED':
    case 'MALFORMED':
    default:
      return {
        title: 'Something went wrong at our end',
        body: 'Your connection is fine — this one is ours. Reload the page, and if it keeps happening, tell your agency contact so they can chase it. Nothing you have approved or sent has been affected.',
      };
  }
}
