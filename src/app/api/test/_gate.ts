/**
 * The gate on every route under `src/app/api/test/`.
 *
 * A seed endpoint reachable in production is a total compromise of every
 * engagement in the database — it truncates the tables and hands back a session
 * for an account it just created. So the gate is **two independent conditions**
 * and not one:
 *
 *   1. `NODE_ENV !== 'production'`, and
 *   2. `E2E_SEED_TOKEN` is set **and** matches the `x-e2e-seed-token` header.
 *
 * Either alone is one mistake away from catastrophe. A token-only gate is
 * defeated by the token leaking, or by someone setting it in a production
 * environment to debug a failing deploy. A `NODE_ENV`-only gate is defeated by
 * a preview deployment that forgets to set it, and `NODE_ENV` is the single
 * most commonly mis-set variable in Node. Requiring both means an attacker
 * needs a secret *and* a misconfigured runtime, and a careless operator needs
 * to make two mistakes rather than one.
 *
 * The failure is a 404, not a 403. A 403 tells a scanner that `/api/test/seed`
 * exists and that it is looking for a header — which is the first half of the
 * attack. As far as production is concerned these routes do not exist, and
 * `notVisible()` is the same helper the rest of the codebase uses to say so.
 *
 * `E2E_SEED_TOKEN` is exempt from the env registry gate by the `^E2E_` rule in
 * `.github/scripts/check-env-registry.mjs`: it is set by CI and by the e2e job,
 * and documenting it in `.env.example` would imply an operator should set it on
 * a real environment. They should not.
 */

import { timingSafeEqual } from 'node:crypto';
import { notVisible } from '@/domain/errors';

export const SEED_TOKEN_HEADER = 'x-e2e-seed-token';

/** Both conditions, evaluated fresh on every request. Never memoised. */
export function testEndpointsMounted(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const token = process.env.E2E_SEED_TOKEN;
  return typeof token === 'string' && token.length > 0;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @throws `NOT_VISIBLE` (404) unless both gate conditions hold and the request
 * presents the matching token. Every handler under `api/test/` calls this as
 * its first statement.
 */
export function requireTestGate(request: Request): void {
  if (!testEndpointsMounted()) throw notVisible('Not found');
  const presented = request.headers.get(SEED_TOKEN_HEADER);
  const expected = process.env.E2E_SEED_TOKEN;
  if (!presented || !expected || !constantTimeEquals(presented, expected)) {
    throw notVisible('Not found');
  }
}
