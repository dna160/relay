/**
 * INV-6 — A client session is scoped to exactly one engagement. There is no
 * cross-engagement client identity.
 *
 * Client routes take the engagement from the session, never from the request.
 * A client route that accepts an engagementId parameter is a bug (API-CONTRACT).
 *
 * UNSKIP IN: Phase 1 — Tenancy, identity, engagement lifecycle.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';

describe.skip('INV-6 a client session sees exactly one engagement', () => {
  it('the client session type carries exactly one engagementId', () => {
    expect.fail('Phase 1: Session union in src/lib/types.ts');
  });

  it('no client route reads an engagement id from params, query, or body', () => {
    expect.fail('Phase 1: structural scan of src/app/api/client for engagementId intake');
  });

  it('a verified contact cannot widen its session to a second engagement', () => {
    expect.fail('Phase 1: verifying a second link issues a separate session, never a merged one');
  });

  it('the same email in two engagements produces two unrelated contacts', () => {
    expect.fail('Phase 1: UNIQUE (engagement_id, email), no global contact identity');
  });
});
