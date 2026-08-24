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

import type { ApiFailure } from '@/lib/api-client';

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
    case 'PLAN_LIMIT_REACHED':
    case 'NETWORK':
    case 'MALFORMED':
    default:
      return {
        title: 'Could not load this workspace',
        body: 'The connection dropped or the service is restarting. Try again in a moment.',
      };
  }
}
