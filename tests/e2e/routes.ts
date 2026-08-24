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
  // Auth, but not the client half of it.
  /^\/api\/auth\/(?!client\b)/,
];

/** Routes a client contact is permitted to reach. */
export const CLIENT_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/e\/[^/]+\/?$/,
  /^\/e\/[^/]+\/(verify|board|queue|export|c)\b/,
  /^\/api\/client\//,
  /^\/api\/auth\/client\//,
  /^\/api\/events\b/,
];

export function isAgencyRoute(url: string, baseURL: string): boolean {
  if (!url.startsWith(baseURL)) return false; // object storage, fonts, analytics
  const path = new URL(url).pathname;
  return AGENCY_ROUTE_PATTERNS.some((re) => re.test(path));
}

