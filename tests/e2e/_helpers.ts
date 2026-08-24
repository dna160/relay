/**
 * Shared e2e helpers.
 *
 * These describe a contract the application does not yet satisfy. Every helper
 * that needs an endpoint which has not been built throws a message naming the
 * phase that builds it, so a red e2e run reads as "Phase 4 has not landed"
 * rather than as an unexplained timeout.
 *
 * Nothing here reads the clock, generates an id, or picks a random email. The
 * e2e suite shares `tests/fixtures` with the unit suites so that a failure can
 * be reproduced by name.
 */

import { expect, type APIRequestContext, type Page, type Request } from '@playwright/test';

/* --------------------------------------------------------------- routing */

export { AGENCY_ROUTE_PATTERNS, CLIENT_ROUTE_PATTERNS, isAgencyRoute } from './routes';
import { AGENCY_ROUTE_PATTERNS } from './routes';

/**
 * Records every same-origin request a page makes and lets a test assert on the
 * whole set afterwards. A flow that "worked" while quietly loading an agency
 * chunk has not satisfied the exit condition.
 */
export class RouteRecorder {
  readonly paths: string[] = [];
  private readonly baseURL: string;

  constructor(page: Page, baseURL: string) {
    this.baseURL = baseURL;
    page.on('request', (request: Request) => {
      const url = request.url();
      if (url.startsWith(baseURL)) this.paths.push(new URL(url).pathname);
    });
  }

  agencyPaths(): string[] {
    return this.paths.filter((p) => AGENCY_ROUTE_PATTERNS.some((re) => re.test(p)));
  }

  assertNoAgencyRoute(): void {
    expect(
      this.agencyPaths(),
      'the client flow reached an agency route; PHASE-4 EXIT forbids it',
    ).toEqual([]);
  }

  /** Every same-origin path the flow touched, deduplicated, for a failure message. */
  unique(): string[] {
    return [...new Set(this.paths)].sort();
  }
}

/* ------------------------------------------------------------------ seeds */

/**
 * The seed endpoint the e2e suite needs.
 *
 * It must exist only when `E2E_SEED_TOKEN` is set, and it must reset to the
 * fixture graph in `tests/fixtures` — the same orgs, engagements, lanes, cards
 * and versions the unit suites assert against. Cards are seeded in `draft` and
 * driven to their fixture state by replaying `transitionScripts`, because
 * nothing outside the state machine may write `cards.state` (INV-2) and a seed
 * script is not an exception.
 *
 * OWNER: whoever lands Phase 1's routes. Until it exists, every e2e test that
 * needs data fails here with this message rather than somewhere confusing.
 */
export interface SeedResult {
  /** The client link token for `ENGAGEMENT.active` — the board the e2e flow uses. */
  engagementToken: string;
  /** A second engagement, same contact email, for the INV-6 widening test. */
  otherEngagementToken: string;
  engagementId: string;
  archivedEngagementId: string;
  purgedEngagementId: string;
  /** A card on the active engagement, in `awaiting_client`. */
  cardId: string;
  /** A card on the archived engagement, for the 423 case. */
  archivedCardId: string;
  /** A version published to the client, for the download redirect case. */
  versionId: string;
}

export async function seedFixtures(request: APIRequestContext): Promise<SeedResult> {
  const token = process.env.E2E_SEED_TOKEN;
  if (!token) {
    throw new Error(
      'E2E_SEED_TOKEN is not set. The e2e suite needs a seed endpoint that resets the database ' +
        'to tests/fixtures. See tests/e2e/_helpers.ts — owner: Phase 1.',
    );
  }
  const response = await request.post('/api/test/seed', {
    headers: { 'x-e2e-seed-token': token },
  });
  if (!response.ok()) {
    throw new Error(
      `POST /api/test/seed returned ${response.status()}. This endpoint must exist behind ` +
        'E2E_SEED_TOKEN and must never be reachable in production.',
    );
  }

  // The seed returns the handful of ids and tokens the suite needs. Passing
  // them back beats threading six environment variables through CI, and it
  // means a test names a fixture rather than a literal uuid.
  const body: unknown = await response.json();
  const result = body as Partial<SeedResult>;
  for (const key of [
    'engagementToken',
    'otherEngagementToken',
    'engagementId',
    'archivedEngagementId',
    'purgedEngagementId',
    'cardId',
    'archivedCardId',
    'versionId',
  ] as const) {
    if (typeof result[key] !== 'string' || result[key] === '') {
      throw new Error(
        `POST /api/test/seed returned no \`${key}\`. See SeedResult in tests/e2e/_helpers.ts ` +
          'for the full shape the endpoint must return.',
      );
    }
  }
  return result as SeedResult;
}

/**
 * The magic-link code for a contact, read out of band.
 *
 * In CI the mail transport is a capture, not Resend. The endpoint returns the
 * most recent code issued for an email on an engagement. It must be gated on
 * the same token as the seed endpoint.
 *
 * OWNER: Phase 1 (the verify flow), Phase 4 (the client surface that uses it).
 */
export async function latestClientCode(
  request: APIRequestContext,
  engagementToken: string,
  email: string,
): Promise<string> {
  const token = process.env.E2E_SEED_TOKEN;
  if (!token) throw new Error('E2E_SEED_TOKEN is not set; see tests/e2e/_helpers.ts');
  const response = await request.get('/api/test/last-code', {
    headers: { 'x-e2e-seed-token': token },
    params: { engagementToken, email },
  });
  if (!response.ok()) {
    throw new Error(
      `GET /api/test/last-code returned ${response.status()}. The e2e suite cannot read a magic ` +
        'link out of a real inbox; CI needs a capture transport. Owner: Phase 1.',
    );
  }
  const body: unknown = await response.json();
  const code = (body as { code?: unknown }).code;
  if (typeof code !== 'string') throw new Error('last-code returned no code');
  return code;
}

/**
 * Signs in an agency user without driving the email flow.
 *
 * OWNER: Phase 1. Same token gate; must 404 when the token is unset.
 */
export async function signInAsAgency(request: APIRequestContext, email: string): Promise<void> {
  const token = process.env.E2E_SEED_TOKEN;
  if (!token) throw new Error('E2E_SEED_TOKEN is not set; see tests/e2e/_helpers.ts');
  const response = await request.post('/api/test/session', {
    headers: { 'x-e2e-seed-token': token },
    data: { email },
  });
  if (!response.ok()) {
    throw new Error(
      `POST /api/test/session returned ${response.status()}. Owner: Phase 1 — an e2e sign-in ` +
        'shortcut gated on E2E_SEED_TOKEN, absent in production.',
    );
  }
}

/* ------------------------------------------------------------- assertions */

/** The API contract's error envelope. Every failure response must match it. */
export function expectApiError(body: unknown, code: string): void {
  expect(body, 'errors are { error: { code, message } } (API-CONTRACT)').toMatchObject({
    error: { code },
  });
}
