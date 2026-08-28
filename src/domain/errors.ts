/**
 * The error currency of the domain layer.
 *
 * Domain code throws; route handlers catch and serialise. The codes come from
 * `src/lib/types.ts` so that the front-end and the back-end cannot drift on
 * what a 402 means. Importing `@/lib/types` is permitted here — it is a
 * declarations file with no runtime dependency on Next, the database, or
 * anything else INV-9 keeps out of this directory.
 */

import { ERROR_CODES, type ErrorCode } from '@/lib/types';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

/**
 * 404, never 403 (API-CONTRACT). A 403 confirms that the thing exists, which is
 * exactly the fact INV-1 is protecting. Use this for anything a client contact
 * asked for and may not have — private lane, private card, another
 * engagement's card, an unpublished version.
 */
export function notVisible(what = 'Not found'): DomainError {
  return new DomainError('NOT_VISIBLE', what);
}

export function validationFailed(message: string, details?: unknown): DomainError {
  return new DomainError('VALIDATION_FAILED', message, details);
}

export function unauthenticated(message = 'Sign in required'): DomainError {
  return new DomainError('UNAUTHENTICATED', message);
}

export function planLimitReached(message: string, details?: unknown): DomainError {
  return new DomainError('PLAN_LIMIT_REACHED', message, details);
}

export function engagementArchived(message = 'This engagement is read-only'): DomainError {
  return new DomainError('ENGAGEMENT_ARCHIVED', message);
}

export function engagementPurged(message = 'This engagement has been purged'): DomainError {
  return new DomainError('ENGAGEMENT_PURGED', message);
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * Phase 10. The three refusals `POST /api/invites/:token/redeem` must be able
 * to tell apart, each with its own code.
 *
 * They were one `VALIDATION_FAILED` carrying `details: { reason }` for exactly
 * as long as `ERROR_CODES` lacked the entries. That worked and it left the
 * discriminator in two places — a `details` field and a status code — which is
 * two places to disagree. The code is now the discriminator; `details.reason`
 * is still sent, because it is the one thing that survives a proxy rewriting a
 * status and because a log line reading `reason: address_mismatch` is worth
 * more than one reading `409`.
 *
 * `INVITE_ADDRESS_MISMATCH` is the refusal a person is most likely to meet and
 * least able to diagnose: they clicked a real link, signed in as themselves,
 * and were refused. It does **not** consume the invitation.
 */
export function inviteAddressMismatch(message: string, details?: unknown): DomainError {
  return new DomainError('INVITE_ADDRESS_MISMATCH', message, details);
}

export function inviteExpired(message: string, details?: unknown): DomainError {
  return new DomainError('INVITE_EXPIRED', message, details);
}

/** Already redeemed, or withdrawn. Both mean "this one is spent". */
export function inviteConsumed(message: string, details?: unknown): DomainError {
  return new DomainError('INVITE_CONSUMED', message, details);
}
