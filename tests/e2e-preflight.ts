/**
 * Refuses to run the e2e suite against a server that is not actually working.
 *
 * `reuseExistingServer` adopts whatever is already listening on the port.
 * Playwright's readiness check is "the URL answered", and a dev server left
 * over from an earlier session answering `500` to every request answers just
 * fine by that standard. A whole run was lost to exactly that, and it did not
 * look like a broken server — it looked like forty broken tests.
 *
 * So the adoption is gated on the health endpoint, which checks the database
 * rather than just process liveness. This runs after Playwright has started or
 * adopted the server and before the first test, and it fails with the one
 * instruction that fixes it.
 */

import type { FullConfig } from '@playwright/test';

const HEALTH_PATH = '/api/health';
const ATTEMPTS = 10;
const GAP_MS = 500;

interface HealthBody {
  status?: string;
  db?: string;
}

export default async function preflight(config: FullConfig): Promise<void> {
  const base =
    process.env.E2E_BASE_URL ??
    config.projects[0]?.use.baseURL ??
    'http://localhost:3000';
  const url = new URL(HEALTH_PATH, base).toString();

  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const text = await response.text();
      if (response.ok) {
        let body: HealthBody = {};
        try {
          body = JSON.parse(text) as HealthBody;
        } catch {
          last = `${HEALTH_PATH} returned ${String(response.status)} but not JSON: ${text.slice(0, 200)}`;
          break;
        }
        if (body.status === 'ok' && body.db === 'ok') return;
        last = `${HEALTH_PATH} reports status=${String(body.status)} db=${String(body.db)}`;
        break;
      }
      last = `${HEALTH_PATH} returned HTTP ${String(response.status)}: ${text.slice(0, 200)}`;
      // A 5xx from a stale server will not improve by waiting. A 502/503 from
      // one that is still booting will, so give those the retries.
      if (response.status !== 502 && response.status !== 503) break;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  throw new Error(
    `e2e preflight failed against ${base}\n\n  ${last}\n\n` +
      'Playwright adopts whatever is already listening on the port, and a dev server\n' +
      'left over from an earlier session will happily answer 500 to everything. The\n' +
      'fix is to stop it and let this run start its own:\n\n' +
      '    lsof -ti tcp:3000 | xargs kill\n\n' +
      'If the server is meant to be reused, check that DATABASE_URL is set for it and\n' +
      'that migrations have been applied (npm run db:migrate).',
  );
}
