/**
 * The audience classifier the Phase 4 exit test depends on.
 *
 * PHASE-4 EXIT is "invite -> verify -> approve without ever touching an agency
 * route", and the e2e test asserts that at the request level using
 * `AGENCY_ROUTE_PATTERNS`. A bug in those patterns makes the exit test lie in
 * one direction or the other: too broad and it fails a correct client flow, too
 * narrow and it passes a flow that loaded the agency bundle.
 *
 * The trap is real and this suite exists because it was walked into: the client
 * board is `/e/[token]/board` and the agency board is `/w/[id]/board`. A
 * classifier keyed on `/board` flags both.
 *
 * Lives in `tests/unit` rather than `tests/e2e` so it runs in `npm run verify`,
 * where it is cheap, rather than only in the job that needs a database.
 */

import { describe, expect, it } from 'vitest';
import { CLIENT_ROUTE_PATTERNS, isAgencyRoute } from '@tests/e2e/routes';

const BASE = 'http://localhost:3000';

const classify = (path: string): boolean => isAgencyRoute(`${BASE}${path}`, BASE);
const matchesClient = (path: string): boolean => CLIENT_ROUTE_PATTERNS.some((re) => re.test(path));

/** Real paths, taken from `src/app/`. Update this list when routes move. */
const AGENCY_PATHS = [
  '/portfolio',
  '/templates',
  '/w/0193a5f0-c302-7000-8000-c3c3c3c30202/board',
  '/w/0193a5f0-c302-7000-8000-c3c3c3c30202/shelf',
  '/w/0193a5f0-c302-7000-8000-c3c3c3c30202/settings',
  '/w/0193a5f0-c302-7000-8000-c3c3c3c30202/c/0193a5f0-f601-7000-8000-f6f6f6f60101',
  '/api/engagements',
  '/api/engagements/0193a5f0-c302-7000-8000-c3c3c3c30202/board',
  '/api/cards',
  '/api/cards/0193a5f0-f601-7000-8000-f6f6f6f60101/transition',
  '/api/cards/reorder',
  '/api/lanes',
  '/api/uploads/presign',
  '/api/versions',
  '/api/reference-files',
  '/api/onboarding/org',
  '/api/auth/session',
  '/api/attention',
  // Amendment A1: this is the *agency* stream. See the A1 suite below.
  '/api/events',
  '/api/events?engagementId=0193a5f0-c302-7000-8000-c3c3c3c30202',
];

const CLIENT_PATHS = [
  '/e/tok_abc123',
  '/e/tok_abc123/verify',
  '/e/tok_abc123/board',
  '/e/tok_abc123/queue',
  '/e/tok_abc123/c/0193a5f0-f601-7000-8000-f6f6f6f60101',
  '/api/client/board',
  '/api/client/queue',
  '/api/client/comments',
  '/api/client/versions/0193a5f0-a701-7000-8000-a7a7a7a70101/decision',
  '/api/client/download/0193a5f0-a701-7000-8000-a7a7a7a70101',
  '/api/client/export',
  '/api/auth/client/request',
  '/api/auth/client/verify',
];

describe('agency routes', () => {
  it.each(AGENCY_PATHS)('classifies %s as agency', (path) => {
    expect(classify(path)).toBe(true);
  });

  it('covers every agency API namespace the contract names', () => {
    for (const ns of ['engagements', 'lanes', 'cards', 'templates', 'uploads', 'versions', 'approvals']) {
      expect(classify(`/api/${ns}`), ns).toBe(true);
    }
  });
});

describe('client routes', () => {
  it.each(CLIENT_PATHS)('does not classify %s as agency', (path) => {
    expect(classify(path)).toBe(false);
  });

  it.each(CLIENT_PATHS)('recognises %s as a client route', (path) => {
    expect(matchesClient(path)).toBe(true);
  });

  it('keeps the two boards apart', () => {
    // The whole reason this file exists.
    expect(classify('/e/tok_abc123/board')).toBe(false);
    expect(classify('/w/eng-id/board')).toBe(true);
  });

  it('keeps the client half of auth out of the agency set', () => {
    expect(classify('/api/auth/client/verify')).toBe(false);
    expect(classify('/api/auth/callback/resend')).toBe(true);
  });
});

describe('the two sets do not overlap', () => {
  it('no path is both an agency route and a client route', () => {
    const overlap = [...AGENCY_PATHS, ...CLIENT_PATHS].filter(
      (p) => classify(p) && matchesClient(p),
    );
    expect(overlap).toEqual([]);
  });
});

describe('off-origin traffic', () => {
  it('ignores requests to object storage and to third parties', () => {
    // R2 presigned PUTs and font CDNs are not agency routes, and a client flow
    // that hits them has not violated anything.
    expect(isAgencyRoute('https://account.r2.cloudflarestorage.com/relay/key', BASE)).toBe(false);
    expect(isAgencyRoute('https://fonts.gstatic.com/s/inter.woff2', BASE)).toBe(false);
  });

  it('classifies a same-origin absolute URL the same as its path', () => {
    expect(isAgencyRoute(`${BASE}/portfolio`, BASE)).toBe(true);
    expect(isAgencyRoute(`${BASE}/e/tok/board`, BASE)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */

describe('amendment A1 — the event stream is two streams', () => {
  /**
   * The frozen contract had one SSE endpoint taking its engagement from a query
   * parameter. For a client session that is exactly what INV-6 forbids, so A1
   * split it: the agency keeps `GET /api/events?engagementId=`, and the client
   * gets `GET /api/client/events`, which takes no parameter at all.
   *
   * The classifier did not follow the amendment. `/api/events` sat in
   * `CLIENT_ROUTE_PATTERNS` until round 2, which means a client page fetching
   * the agency stream would have been classified as staying on its own side —
   * the Phase 4 exit test would have passed through the one leak the amendment
   * was written to prevent. Reported by the back-end; these are the cases that
   * stop it coming back.
   */

  it('classifies the parameterised stream as agency', () => {
    expect(classify('/api/events')).toBe(true);
    expect(classify('/api/events?engagementId=abc')).toBe(true);
  });

  it('does not offer the parameterised stream to a client', () => {
    expect(
      matchesClient('/api/events'),
      'a client permitted to reach /api/events can name someone else’s engagement',
    ).toBe(false);
  });

  it('classifies the client stream as client, and it carries no engagement id', () => {
    expect(matchesClient('/api/client/events')).toBe(true);
    expect(classify('/api/client/events')).toBe(false);
  });

  it('keeps the two apart on prefix alone, so neither can be reached by the other name', () => {
    expect(classify('/api/client/events')).toBe(false);
    expect(matchesClient('/api/events')).toBe(false);
  });

  it('classifies the attention endpoint as agency — it is the portfolio, and a client has no portfolio', () => {
    expect(classify('/api/attention')).toBe(true);
    expect(matchesClient('/api/attention')).toBe(false);
  });
});
