#!/usr/bin/env node
/**
 * PHASE-4 EXIT: **the client bundle contains no agency route code.**
 *
 * ## Why this file exists at all
 *
 * The front-end has been running this audit from a scratchpad script for three
 * rounds, negative-controlled every time, and it has been correct every time.
 * That is exactly the problem: a check that lives in one agent's scratch
 * directory is not a check. Nothing fails when it stops being run, nobody
 * notices when it is not, and the first sign that the leak came back is a
 * client downloading the agency board's strings. So it moves to `.github/`,
 * where it fails a pull request.
 *
 * ## What it measures, and what it deliberately does not
 *
 * What the **browser actually downloaded**, on a **production build**, with a
 * **real client session**. Each of those three is a defect this audit already
 * survived:
 *
 *   - Not the import graph. An import that is tree-shaken away is not a leak,
 *     and a string inlined into a shared chunk *is* one even though no import
 *     points at it. Only the bytes on the wire answer this.
 *   - Not a dev server. `next dev` is unminified, unbundled and compiled on
 *     demand; its chunk boundaries are not the ones that ship.
 *   - Not the sign-in page. That was DEFECT-7 in its bundle form: an
 *     unauthenticated request to `/e/<token>/board` renders the sign-in form,
 *     which carries almost no JavaScript and therefore has almost no way to
 *     leak. The audit passed by measuring nothing.
 *
 * ## The negative control is not optional, and CI runs it
 *
 * A grep that finds nothing and a grep that *cannot* find anything look
 * identical from the outside, which is the failure mode every scan in this
 * repository has been bitten by. So the audit refuses to report success unless
 * a positive probe — a string that is unavoidably in the client bundle —
 * is also found. If the probe misses, the run is **inconclusive**, which exits
 * non-zero, because "I read nothing and found no leak" is not a pass.
 *
 * `--negative-control` goes further and proves the *matcher* works, not just
 * the plumbing: it re-runs the same detector over the same downloaded bytes
 * with the probe strings moved into the offender list, and requires it to fail.
 * A detector that cannot be made to fail on demand has not been shown to work.
 * CI runs both, so the control is executed on every push rather than recalled
 * from a previous round's transcript.
 *
 * Usage:
 *   node .github/scripts/check-chunk-purity.mjs                    # gate
 *   node .github/scripts/check-chunk-purity.mjs --report           # print, never fail
 *   node .github/scripts/check-chunk-purity.mjs --negative-control # prove it can fail
 *
 * Requires a running production server (`next build && next start`) and a
 * `DATABASE_URL` this process may reseed — the same two things the FCP budget
 * needs, which is why the two run in the same CI job.
 */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const negativeControl = args.includes('--negative-control');

/**
 * True only when this file is the process entry point.
 *
 * Everything below the patterns is behind this, so the detector and its
 * vocabulary can be imported and asserted against by
 * `tests/unit/chunk-purity-detector.spec.ts` without launching a browser,
 * seeding a database, or needing a server to exist. The audit's own correctness
 * then rides in `npm run verify` alongside everything else, rather than being
 * something an operator has to remember to check.
 */
const IS_ENTRY_POINT =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * `tests/e2e/routes.ts`'s patterns, re-anchored for a bundle.
 *
 * **This list is asserted live**, not merely maintained. A pattern that matches
 * nothing anywhere in the agency source detects nothing in a bundle either, and
 * a detector cannot tell that apart from a clean result — so
 * `tests/unit/chunk-purity-detector.spec.ts` requires every pattern here to
 * still match the agency source, and requires every route string the agency API
 * client actually builds to be matched by something here. Both directions were
 * needed on the first run: `/api/approvals` was on this list and **has never
 * existed** (decisions live at `/api/client/versions/[id]/decision`, a client
 * route), and `/api/comments` was a live agency-only route nothing looked for.
 * `/api/client/comments` does not contain the substring `/api/comments`, so the
 * pattern stays unambiguous.
 *
 * That file's regexes are anchored with `^` because they classify a *pathname*.
 * A pathname inside a minified chunk is a substring of a string literal, so the
 * anchor has to go — and the bare `/w/` prefix is dropped entirely, because two
 * characters of punctuation match half of everything and a false positive is
 * how an audit gets ignored rather than fixed. The route strings the agency
 * client actually builds are the `/api/...` prefixes, and those are unambiguous.
 */
export const AGENCY_ROUTE_PATTERNS = [
  /\/api\/engagements/,
  /\/api\/lanes/,
  /\/api\/cards/,
  /\/api\/templates/,
  /\/api\/uploads/,
  /\/api\/versions/,
  /\/api\/comments/,
  // Amendment A1's route. Round 2 found `/api/events` sitting in the *client*
  // half of `tests/e2e/routes.ts`'s classifier, so a client page fetching the
  // agency stream would have been classified as staying on its own side. The
  // classifier was fixed; the bundle audit was never told. `/api/client/events`
  // does not contain this substring, so the two stay distinguishable.
  /\/api\/events/,
  /\/api\/reference-files/,
  /\/api\/onboarding/,
  /\/api\/attention/,
  /"\/portfolio"/,
  /"\/templates"/,
];

/**
 * Strings that exist only in agency components, routes, or vocabulary.
 *
 * **Asserted live** for the same reason as the routes above: the day someone
 * rewords "Send to internal review", that marker matches nothing anywhere and
 * this audit reports clean forever. `--negative-control` cannot see that — a
 * planted *stale* marker is caught exactly as well as a live one, because the
 * control tests the detector and not the vocabulary. So the vocabulary gets its
 * own test.
 *
 * Deliberately drawn from the *backstage* half of the Stage/Backstage split.
 * A client contact who can read "Send to internal review" out of their own
 * bundle has been told how the agency talks about their work internally, which
 * is a confidentiality problem before it is a bundle-size one.
 */
export const AGENCY_MARKERS = [
  'Internal review',
  'Send to internal review',
  'Publish to client',
  'Blocked on you',
  'No movement in 7 days',
  'Make private',
  'Publish lane',
  'possession clock starts',
  'read-only · archived',
  'agencyEventStreamUrl',
];

/**
 * Present in the client bundle no matter what: the two decision-bar actions,
 * which are the entire point of the client surface. If neither is found, the
 * audit is not reading the client bundle and no conclusion may be drawn.
 */
export const POSITIVE_PROBE = ['Request changes', 'Approve'];

function fail(message) {
  console.error(`\n${message}`);
  if (!reportOnly) process.exit(1);
}

/** Seeds fixtures and mints a verified client session, out of band. */
function session() {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fcp-session.ts'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) throw new Error(`fcp-session failed: ${r.stderr.slice(-500)}`);
  const line = r.stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error('fcp-session printed nothing');
  return JSON.parse(line);
}

/** Runs the detector over already-downloaded bodies. Pure, so it is testable. */
export function detect(bodies, { markers, routes }) {
  const hits = [];
  for (const { file, body } of bodies) {
    for (const marker of markers) {
      if (body.includes(marker)) hits.push(`${file}: agency marker ${JSON.stringify(marker)}`);
    }
    for (const re of routes) {
      const m = body.match(new RegExp(re.source, 'g'));
      if (m) hits.push(`${file}: agency route ${JSON.stringify([...new Set(m)].slice(0, 3))}`);
    }
  }
  return hits;
}

if (IS_ENTRY_POINT) {
  const s = session();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addCookies([{ name: 'relay_client_session', value: s.cookieValue, url: BASE }]);
  const page = await context.newPage();

  const scripts = new Set();
  page.on('response', (r) => {
    const u = r.url();
    if (/\.js(\?|$)/.test(u)) scripts.add(u);
  });

  const routes = [`/e/${s.engagementToken}/board`, `/e/${s.engagementToken}/queue`];
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
  }
  // The card page too — it carries the most client JavaScript in the product.
  const cardHref = await page
    .locator('a[href*="/c/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (cardHref) await page.goto(BASE + cardHref, { waitUntil: 'networkidle' });

  const visited = routes.length + (cardHref ? 1 : 0);
  const urls = [...scripts];

  const bodies = [];
  let bytes = 0;
  for (const url of urls) {
    const body = await (await context.request.get(url)).text();
    bytes += body.length;
    bodies.push({ file: url.split('/').pop(), body });
  }
  await browser.close();

  console.log(`client bundle purity — PHASE-4 EXIT`);
  console.log(`  downloaded ${urls.length} scripts across ${visited} client routes`);
  console.log(`  read ${(bytes / 1024).toFixed(0)} kB of script`);

  /* ------------------------------------------------------- the positive probe */

  const probeHits = [];
  for (const { file, body } of bodies) {
    for (const probe of POSITIVE_PROBE) {
      if (body.includes(probe)) probeHits.push(`${file}: ${JSON.stringify(probe)}`);
    }
  }

  console.log(`\n  positive probe: ${probeHits.length} hit(s)`);
  for (const hit of probeHits.slice(0, 4)) console.log(`    ${hit}`);

  if (probeHits.length === 0) {
    fail(
      'INCONCLUSIVE — the positive probe found nothing, so the audit is not reading the\n' +
        'client bundle. A clean result here means "I read nothing", not "there is no leak".\n' +
        'Check that the session is valid and that the board rendered rather than the sign-in\n' +
        'form (that was DEFECT-7). Not reported as a pass.',
    );
  }

  /* ---------------------------------------------------------------- the audit */

  const hits = detect(bodies, { markers: AGENCY_MARKERS, routes: AGENCY_ROUTE_PATTERNS });

  console.log(`\n  agency hits: ${hits.length}`);
  for (const hit of hits) console.log(`    ${hit}`);

  /* ------------------------------------------------------ the negative control */

  if (negativeControl) {
    // Prove the detector can fail. The probe strings are known to be in these
    // exact bytes, so moving them into the offender list must produce hits — and
    // if it does not, the matcher is broken and the clean result above meant
    // nothing. This is the assertion that separates "found no leak" from
    // "incapable of finding a leak", and it runs over the same downloaded bodies
    // rather than a fixture, so it exercises the real path.
    const planted = detect(bodies, { markers: POSITIVE_PROBE, routes: [] });
    console.log(`\n  negative control: ${planted.length} planted hit(s)`);
    if (planted.length === 0) {
      fail(
        'NEGATIVE CONTROL FAILED — strings known to be in the downloaded bytes were not\n' +
          'found by the detector. The audit cannot detect a leak, so its clean result is\n' +
          'not evidence of anything.',
      );
    } else {
      console.log('  OK — the detector fails when there is something to find.');
    }
  }

  if (hits.length > 0) {
    fail(
      `AGENCY CODE IN THE CLIENT BUNDLE — ${hits.length} hit(s) above.\n` +
        'PHASE-4 EXIT: the client bundle contains no agency route code. A client contact\n' +
        'reading backstage vocabulary out of their own bundle is a confidentiality problem\n' +
        'before it is a bundle-size one.',
    );
  } else if (probeHits.length > 0) {
    console.log('\nOK — the client bundle carries no agency route code, and the audit was reading.');
  }
}
