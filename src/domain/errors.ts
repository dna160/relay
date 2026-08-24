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
