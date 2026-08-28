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
  /**
   * Phase 10's team surface. `/team` reads the organisation's roster and sends
   * teammate invites, and both are agency-only in the strongest sense — the
   * roster is a list of the agency's own people and the invite grants access to
   * every workspace the organisation owns. A client contact finding either
   * string in their bundle has been handed the map to a surface that exists to
   * decide who may read their private lanes.
   *
   * `/api/invites/:token` is deliberately **not** on this list and must not be
   * added. It is the one route in the product reachable by somebody in neither
   * audience — a person holding an emailed link, who is not an agency member
   * and not a reviewer — so it is not agency-only, and a pattern claiming it
   * was would make this audit fail on a bundle that is behaving correctly.
   * `src/lib/api-client.invite.ts` is a third leaf for the same reason.
   */
  /\/api\/orgs/,
  /**
   * The account identity routes. `/api/auth/client/request` and
   * `/api/auth/client/verify` are the *reviewer's* way in and are deliberately
   * not matched by this: `/api/auth/signin` is not a substring of either, which
   * is what keeps the two distinguishable. Same discipline as `/api/comments`
   * against `/api/client/comments`.
   */
  /\/api\/auth\/signin/,
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

/**
 * The same idea for the *invitation* surface, which is swept separately below.
 *
 * `/invite/[token]` is downloaded by somebody in **neither** audience — not an
 * agency member (that is what the invitation would make them) and not a
 * reviewer on anything. It is therefore a third bundle, and the argument that
 * makes the client sweep worth running applies to it word for word: a stranger
 * holding an emailed link should not be able to read the agency's route map or
 * its backstage vocabulary out of their own JavaScript.
 *
 * This is not hypothetical. The first run of the invite sweep found
 * `"/portfolio"` in that chunk — `router.push('/portfolio')` after a successful
 * redemption, which is the correct destination and was the wrong place to say
 * it. Redemption became a server action and the string left the bundle.
 *
 * The two strings below are the anonymous call to action and the mismatch
 * remedy. Both are in that chunk whatever happens to the copy around them, and
 * if neither is found the sweep is not reading the invitation bundle and no
 * conclusion may be drawn.
 */
export const INVITE_PROBE = ['Confirm my email', 'Sign out and use the invited address'];

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

  /* ------------------------------------------------- the invitation surface */

  /**
   * A third sweep, in a context with **no cookies at all**.
   *
   * The invitation page is the one surface outside both trees, and it is opened
   * by a person who has proved nothing. Reusing the client's context would put
   * a reviewer session on it and measure a page nobody will ever see in that
   * state; a fresh context is the stranger, which is the whole audience.
   *
   * A failure here is reported through the same `fail()` as everything else, so
   * the job's exit code covers all three claims rather than the first two.
   */
  const inviteHits = await sweepInvite();

  if (hits.length > 0) {
    fail(
      `AGENCY CODE IN THE CLIENT BUNDLE — ${hits.length} hit(s) above.\n` +
        'PHASE-4 EXIT: the client bundle contains no agency route code. A client contact\n' +
        'reading backstage vocabulary out of their own bundle is a confidentiality problem\n' +
        'before it is a bundle-size one.',
    );
  } else if (probeHits.length > 0 && inviteHits === 0) {
    console.log(
      '\nOK — neither the client bundle nor the invitation bundle carries agency route code,\n' +
        'and the audit was reading both.',
    );
  }
}

/**
 * Opens `/invite/<token>` with no session and asks the same questions of what
 * came down the wire. Returns the number of agency hits.
 *
 * The token is minted out of band by `tests/invite-session.ts`, the way the
 * client session is: `/api/test/*` does not mount in production, and that gate
 * is not something to weaken for a measurement.
 *
 * A second route is visited with a deliberately invalid token, because the two
 * render different components — the preview and the ask on one, the dead-link
 * notice on the other — and a sweep that saw only one of them would be reading
 * half the surface.
 */
async function sweepInvite() {
  const minted = spawnSync(process.execPath, ['--import', 'tsx', 'tests/invite-session.ts'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (minted.status !== 0) {
    throw new Error(`invite-session failed: ${minted.stderr.slice(-500)}`);
  }
  const line = minted.stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error('invite-session printed nothing');
  const { token } = JSON.parse(line);

  const browser = await chromium.launch();
  // No cookies, no storage. This is the person holding the emailed link.
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();

  const scripts = new Set();
  page.on('response', (r) => {
    const u = r.url();
    if (/\.js(\?|$)/.test(u)) scripts.add(u);
  });

  for (const route of [`/invite/${token}`, '/invite/not-a-real-token']) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
  }

  const bodies = [];
  let bytes = 0;
  for (const url of scripts) {
    const body = await (await context.request.get(url)).text();
    bytes += body.length;
    bodies.push({ file: url.split('/').pop(), body });
  }
  await browser.close();

  console.log('\ninvitation bundle purity — the surface outside the workspace');
  console.log(`  downloaded ${bodies.length} scripts, ${(bytes / 1024).toFixed(0)} kB, no cookies`);

  const probe = bodies.flatMap(({ file, body }) =>
    INVITE_PROBE.filter((p) => body.includes(p)).map((p) => `${file}: ${JSON.stringify(p)}`),
  );
  console.log(`  positive probe: ${probe.length} hit(s)`);
  for (const hit of probe.slice(0, 4)) console.log(`    ${hit}`);
  if (probe.length === 0) {
    fail(
      'INCONCLUSIVE — the invitation probe found nothing, so the sweep is not reading that\n' +
        'bundle. A clean result here means "I read nothing", not "there is no leak".',
    );
    return 0;
  }

  const found = detect(bodies, { markers: AGENCY_MARKERS, routes: AGENCY_ROUTE_PATTERNS });
  console.log(`  agency hits: ${found.length}`);
  for (const hit of found) console.log(`    ${hit}`);

  if (negativeControl) {
    const planted = detect(bodies, { markers: INVITE_PROBE, routes: [] });
    console.log(`  negative control: ${planted.length} planted hit(s)`);
    if (planted.length === 0) {
      fail(
        'NEGATIVE CONTROL FAILED on the invitation bundle — strings known to be in the\n' +
          'downloaded bytes were not found. Its clean result is not evidence of anything.',
      );
    }
  }

  if (found.length > 0) {
    fail(
      `AGENCY CODE IN THE INVITATION BUNDLE — ${found.length} hit(s) above.\n` +
        'This page is served to somebody in neither audience: not an agency member, and not a\n' +
        'reviewer on anything. Handing them the agency route map is the same confidentiality\n' +
        'problem PHASE-4 EXIT names, one surface further out. The destination after a\n' +
        'redemption belongs in a server action, not in a chunk the browser downloads.',
    );
  }

  return found.length;
}
