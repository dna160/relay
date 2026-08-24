/**
 * What each documented failure says to an agency user.
 *
 * One place decides the words so that a 402 reads the same on the portfolio as
 * it does in a form. The message the server sends is a developer's sentence;
 * these are the product's.
 */

import type { ApiFailure } from '@/lib/api-client';

export interface FailureCopy {
  title: string;
  body: string;
}

export function failureCopy(f: ApiFailure): FailureCopy {
  switch (f.code) {
    case 'PLAN_LIMIT_REACHED':
      return {
        title: 'Active engagement limit reached',
        body: 'This plan runs a fixed number of engagements at once. Wrap one that is finished, or move up a plan.',
      };
    case 'INVALID_TRANSITION':
      return {
        title: 'That move is not available',
        body: 'The card has changed since this page loaded. Reload to see where it is now.',
      };
    case 'ENGAGEMENT_ARCHIVED':
      return {
        title: 'This engagement is read-only',
        body: 'It was archived after 30 days without activity. Everything is still here to read and to export.',
      };
    case 'ENGAGEMENT_PURGED':
      return {
        title: 'This engagement was purged',
        body: 'Its files and content were destroyed on schedule. A deletion certificate listing the hashes and counts went to both parties.',
      };
    case 'NOT_VISIBLE':
      return { title: 'Not found', body: 'This page does not exist, or you no longer have access to it.' };
    case 'UNAUTHENTICATED':
      return { title: 'Sign in to continue', body: 'This session has expired. Sign in again to pick up where you left off.' };
    case 'VALIDATION_FAILED':
      return { title: 'That did not go through', body: f.message || 'Check the highlighted fields and try again.' };
    case 'NETWORK':
    case 'MALFORMED':
    default:
      return {
        title: 'Could not reach the workspace',
        body: 'The connection dropped or the service is restarting. Try again in a moment.',
      };
  }
}
