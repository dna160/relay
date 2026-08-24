/**
 * Which paths belong to which audience.
 *
 * Split out of `_helpers.ts` so it imports nothing: `tests/unit/routes.spec.ts`
 * checks this classifier under vitest, and a bug in it would make the Phase 4
 * exit test lie in whichever direction the bug ran. The client board is
 * `/e/[token]/board` and the agency board is `/w/[id]/board` — a classifier
 * that matched on `/board` would fail the exit test for the opposite of the
 * right reason, which is exactly the mistake this file was written with and
 * then caught.
 */

/**
 * Everything that belongs to the agency bundle.
 *
 * PHASE-4 EXIT: "a Playwright run completes invite -> verify -> approve without
 * ever touching an agency route". This list is what "an agency route" means,
 * and the assertion is made against observed requests, not against the outcome.
 */
export const AGENCY_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/portfolio\b/,
  /^\/templates\b/,
  // The agency workspace lives under /w/[id]. Note that the *client* board is
  // /e/[token]/board — same word, different prefix. Matching on `/board` alone
  // would flag the client's own board and fail the Phase 4 exit test for the
  // opposite of the right reason.
  /^\/w\/[^/]+(\/|$)/,
  /^\/api\/engagements\b/,
  /^\/api\/lanes\b/,
  /^\/api\/cards\b/,
  /^\/api\/templates\b/,
  /^\/api\/uploads\b/,
  /^\/api\/versions\b/,
  /^\/api\/approvals\b/,
  /^\/api\/reference-files\b/,
  /^\/api\/onboarding\b/,
  // The portfolio's attention list. Phase 5's endpoint, pulled forward.
  /^\/api\/attention\b/,
  /**
   * Amendment A1 split the event stream in two. `GET /api/events?engagementId=`
   * is the **agency** stream — it takes the engagement from a query parameter,
   * which is precisely what INV-6 forbids for a client session. The client's is
   * `GET /api/client/events`, which takes no parameter at all and is already
   * matched by `/^\/api\/client\//` below.
   *
   * This lived in CLIENT_ROUTE_PATTERNS until round 2, which meant a client
   * page fetching the agency stream would not have tripped the Phase 4 exit
   * assertion — the classifier would have called the leak legal. Reported by
   * the back-end.
   */
  /^\/api\/events\b/,
  // Auth, but not the client half of it.
  /^\/api\/auth\/(?!client\b)/,
];

/** Routes a client contact is permitted to reach. */
export const CLIENT_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/e\/[^/]+\/?$/,
  /^\/e\/[^/]+\/(verify|board|queue|export|c)\b/,
  // Covers `/api/client/events`, the client half of amendment A1's split.
  /^\/api\/client\//,
  /^\/api\/auth\/client\//,
];

export function isAgencyRoute(url: string, baseURL: string): boolean {
  if (!url.startsWith(baseURL)) return false; // object storage, fonts, analytics
  const path = new URL(url).pathname;
  return AGENCY_ROUTE_PATTERNS.some((re) => re.test(path));
}

