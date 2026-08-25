/**
 * The bundle-purity audit's detector, tested where it costs nothing to test.
 *
 * ## Why this file exists
 *
 * `.github/scripts/check-chunk-purity.mjs` needs three expensive things to say
 * anything at all: a production build, a database it may reseed, and a real
 * client session. So it runs in one CI job, once, and the only signal anyone
 * sees is pass or fail.
 *
 * That is the same position `check-fcp-budget.mjs` is in, and the same position
 * the audit was in for three rounds while it lived in a scratchpad — correct
 * every time it was run, and unfalsifiable in between. The part of it that can
 * be wrong without a browser is the *detector*: the vocabulary it looks for and
 * the matching it does. That part is pure, it is exported, and it is asserted
 * here inside `npm run verify`, where a broken matcher fails in two seconds
 * instead of after a six-minute build.
 *
 * What this does **not** cover, and what only the CI job can: that the audit
 * downloaded the right pages, that a session was established, and that the
 * bytes it read were a production bundle rather than a sign-in form. Those are
 * covered in the job by the positive probe, which makes an empty read an
 * inconclusive run rather than a pass.
 *
 * ## The shape being defended against
 *
 * A detector that cannot fail. Every other guard in this repository has been
 * bitten by it — a signature scan escaped by composition, a lowercase match
 * escaped by a capital, a line scan escaped by a newline, a schema assertion
 * against text that cannot change. An audit whose matcher silently stops
 * matching reports a clean bundle forever.
 */

import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../invariants/_source';
import {
  AGENCY_MARKERS,
  AGENCY_ROUTE_PATTERNS,
  POSITIVE_PROBE,
  detect,
} from '../../.github/scripts/check-chunk-purity.mjs';

const ALL = { markers: AGENCY_MARKERS, routes: AGENCY_ROUTE_PATTERNS };

/** A chunk body, shaped the way the audit hands them to the detector. */
function chunk(body: string, file = 'page-4f2a1c.js') {
  return [{ file, body }];
}

/**
 * A client chunk with nothing agency-side in it.
 *
 * Contains both positive probes, because that is what a real client bundle
 * looks like and a "clean" corpus with no content in it would prove nothing
 * about false positives.
 */
const CLEAN_CLIENT_CHUNK = [
  'var e=["Approve","Request changes"];',
  'const u="/api/client/board";const v="/api/client/decisions";',
  'const t="Awaiting your review";const w="With the agency";',
].join('');

describe('the bundle-purity detector finds what it claims to find', () => {
  it('has a vocabulary to look for, so an empty sweep is not a pass', () => {
    // The detector iterates two lists. Emptied by an edit, it returns no hits
    // for every input and the CI job goes green forever.
    expect(AGENCY_MARKERS.length, 'the agency marker list is empty').toBeGreaterThan(5);
    expect(AGENCY_ROUTE_PATTERNS.length, 'the agency route list is empty').toBeGreaterThan(5);
    expect(POSITIVE_PROBE.length, 'the positive probe is empty').toBeGreaterThan(0);
  });

  it('catches every agency marker on its own', () => {
    // One case per marker rather than one case for all of them: a single
    // assertion over the joined list passes while nine of the ten are broken.
    for (const marker of AGENCY_MARKERS) {
      const body = `var x=1;const s=${JSON.stringify(marker)};export{x};`;
      expect(detect(chunk(body), ALL), `the detector missed ${JSON.stringify(marker)}`).not.toEqual(
        [],
      );
    }
  });

  it('catches every agency route pattern on its own', () => {
    for (const re of AGENCY_ROUTE_PATTERNS) {
      // The sample is the pattern's own source with its escapes removed, which
      // is the literal a bundler emits — and it is spliced in **raw**. Passing
      // it through `JSON.stringify` re-escapes the quotes that two of these
      // patterns carry deliberately (`"/portfolio"` is quoted so it cannot
      // match a path segment), so the sample no longer contained the thing it
      // was built to contain and the case failed against a working detector.
      const literal = re.source.replace(/\\/g, '');
      expect(
        detect(chunk(`var x=1;fetch(${literal});`), ALL),
        `the detector missed ${re}`,
      ).not.toEqual([]);
    }
  });

  it('finds a marker inlined into a shared chunk with no import pointing at it', () => {
    // The reason the audit reads bytes rather than the import graph. A string
    // that reached a shared chunk through constant folding has no import to
    // find, and is on the wire regardless.
    const shared = `${CLEAN_CLIENT_CHUNK}const k="Send to internal review";`;
    const hits = detect(chunk(shared, 'shared-9911.js'), ALL);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('Send to internal review');
  });

  it('names the file and what was found, so a failure is actionable', () => {
    const hits = detect(chunk('const a="/api/lanes";', 'chunk-abc123.js'), ALL);
    expect(hits[0]).toContain('chunk-abc123.js');
    expect(hits[0]).toContain('/api/lanes');
  });

  it('reports every offending chunk, not only the first', () => {
    const hits = detect(
      [
        { file: 'one.js', body: 'const a="Publish lane";' },
        { file: 'two.js', body: 'const b="/api/versions";' },
      ],
      ALL,
    );
    expect(hits).toHaveLength(2);
    expect(hits.join(' ')).toContain('one.js');
    expect(hits.join(' ')).toContain('two.js');
  });
});

describe('the bundle-purity detector does not find what is not there', () => {
  it('passes a clean client chunk', () => {
    // The other half. A detector that flags everything is deleted within a
    // week, and then there is no audit at all.
    expect(detect(chunk(CLEAN_CLIENT_CHUNK), ALL)).toEqual([]);
  });

  it('does not mistake a client API route for an agency one', () => {
    // `/api/client/...` shares a prefix with nothing on the agency list, but
    // this is the assertion that would catch a future pattern loosened to
    // `/api/` and quietly failing every client build.
    for (const path of [
      '/api/client/board',
      '/api/client/decisions',
      '/api/client/versions',
      '/api/auth/client/verify',
    ]) {
      expect(
        detect(chunk(`fetch(${JSON.stringify(path)})`), ALL),
        `${path} was reported as an agency route`,
      ).toEqual([]);
    }
  });

  it('carries no pattern short enough to match half of everything', () => {
    // The `/w/` prefix from `tests/e2e/routes.ts` was dropped when these
    // patterns were re-anchored for a bundle: two characters of punctuation
    // match inside minified code constantly, and a false positive is how an
    // audit gets ignored rather than fixed.
    for (const re of AGENCY_ROUTE_PATTERNS) {
      expect(re.source.replace(/\\/g, '').length, `${re} is too short to be unambiguous`).toBeGreaterThan(5);
    }
    for (const marker of AGENCY_MARKERS) {
      expect(marker.length, `${JSON.stringify(marker)} is too short to be unambiguous`).toBeGreaterThan(8);
    }
  });

  it('does not flag the client bundle for containing the words it is built from', () => {
    // "Approve" and "Request changes" are the client decision bar. If either
    // ever ends up on the agency marker list the audit fails every green build,
    // which is the fastest way to have the gate removed.
    for (const probe of POSITIVE_PROBE) {
      expect(
        AGENCY_MARKERS,
        `${JSON.stringify(probe)} is both the positive probe and an agency marker`,
      ).not.toContain(probe);
      expect(detect(chunk(`const a=${JSON.stringify(probe)};`), ALL)).toEqual([]);
    }
  });
});

describe('the negative control the CI job runs on every push', () => {
  it('fails when the offender list is planted with strings that are present', () => {
    // This is exactly what `--negative-control` does in CI, run here against a
    // synthetic body: move the positive probes into the offender list and
    // require hits. A detector that stays silent here cannot detect a leak, so
    // its clean result on the real bundle is not evidence of anything.
    const planted = detect(chunk(CLEAN_CLIENT_CHUNK), { markers: POSITIVE_PROBE, routes: [] });
    expect(
      planted,
      'the detector found nothing in bytes known to contain the planted strings',
    ).not.toEqual([]);
    expect(planted.length).toBe(POSITIVE_PROBE.length);
  });

  it('an empty corpus produces no hits — which is why an empty read is inconclusive (see below)', () => {
    // Pinned deliberately. `detect([]) === []` is indistinguishable from a
    // clean bundle, and it is the whole reason the CI job refuses to report
    // success unless the positive probe also found something. This assertion is
    // the record that the ambiguity is known and handled elsewhere, rather than
    // unnoticed.
    expect(detect([], ALL)).toEqual([]);
    expect(detect([{ file: 'empty.js', body: '' }], ALL)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The agency source the audit's vocabulary is drawn from, comments already
 * stripped by `sourceFiles()`.
 *
 * Stripping is the right behaviour rather than an accident of reuse: a marker
 * that survives only inside a comment describing the string it used to be is
 * dead vocabulary. It cannot reach a bundle, so it cannot detect a leak.
 */
function agencySource(): string {
  const files = [
    ...sourceFiles('components/agency'),
    ...sourceFiles('app/(agency)'),
    ...sourceFiles('lib').filter((f) => f.path === 'src/lib/api-client.agency.ts'),
  ];
  expect(
    files.length,
    'no agency source found; the trees moved and this check went blind',
  ).toBeGreaterThan(10);
  return files.map((f) => f.text).join('\n');
}

describe('the vocabulary is still the vocabulary', () => {
  /**
   * The half `--negative-control` structurally cannot see.
   *
   * The control proves the detector catches planted strings — but a planted
   * *stale* marker is caught exactly as well as a live one, precisely because
   * it is planted. So the control stays green while the vocabulary rots
   * underneath it, and the day someone rewords a string the audit reports clean
   * forever on a bundle that is leaking.
   *
   * Same family as every other escape found in this build: **the guard reads
   * something narrower than the invariant claims.** Here the guard was testing
   * the detector and not the words it looks for.
   *
   * Both directions are needed, and both fired on the first run:
   *
   *   - `/api/approvals` was on the route list and **has never existed** in
   *     this codebase. Decisions are recorded at
   *     `/api/client/versions/[id]/decision`, which is a *client* route. A
   *     pattern that cannot match is a pattern that detects nothing, and it had
   *     been sitting in the list looking like coverage.
   *   - `/api/comments` is a live agency-only route and nothing looked for it.
   *     Liveness alone would never have found that; the coverage case did.
   */
  it('every agency marker still exists in the agency source', () => {
    const source = agencySource();
    const dead = AGENCY_MARKERS.filter((m) => !source.includes(m));
    expect(
      dead,
      'a marker no longer appears anywhere in the agency source. It can never ' +
        'appear in a bundle either, so it detects nothing — and a detector cannot ' +
        'tell a dead marker from a clean bundle. Reword it to match the source, or ' +
        'remove it and add the string that replaced it.',
    ).toEqual([]);
  });

  it('every agency route pattern still matches the agency source', () => {
    // Widened to `src/app/api` too, because a route pattern is about a path
    // that exists on the server, not only one the client happens to build today.
    const source = [agencySource(), ...sourceFiles('app/api').map((f) => f.text)].join('\n');
    const dead = AGENCY_ROUTE_PATTERNS.filter((re) => !re.test(source)).map(String);
    expect(
      dead,
      'a route pattern matches nothing in the agency source or the API tree. Either ' +
        'the route was renamed and the pattern must follow it, or the route never ' +
        'existed and the pattern has been detecting nothing since it was written.',
    ).toEqual([]);
  });

  it('every route the agency API client builds is covered by a pattern', () => {
    // The mirror of liveness. Liveness stops the vocabulary rotting behind the
    // product; this stops it lagging when a route is added. A new agency
    // endpoint that nothing looks for is a leak this audit would wave through.
    const client = sourceFiles('lib').find((f) => f.path === 'src/lib/api-client.agency.ts');
    expect(client, 'the agency API client moved; this check went blind').toBeDefined();

    const built = [...(client?.text ?? '').matchAll(/['"`](\/api\/[a-z0-9/-]+)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(
      new Set(built).size,
      'no route strings were extracted from the agency API client, so this assertion ' +
        'is iterating an empty set and cannot fail',
    ).toBeGreaterThan(5);

    const uncovered = [...new Set(built)].filter(
      (path) => !AGENCY_ROUTE_PATTERNS.some((re) => re.test(path)),
    );
    expect(
      uncovered,
      'the agency client builds a route the bundle audit does not look for. Add a ' +
        'pattern, or state why that route is not agency-only.',
    ).toEqual([]);
  });

  it('no agency pattern matches a client route', () => {
    // The false positive that would take the gate down. `/api/client/comments`
    // does not contain `/api/comments`, and that is load-bearing rather than
    // lucky — a pattern loosened to `/api/` would match every client fetch in
    // the bundle and fail every green build.
    expect(sourceFiles('app/api/client').length, 'no client API routes found').toBeGreaterThan(3);
    for (const path of ['/api/client/comments', '/api/client/versions', '/api/client/board']) {
      const matched = AGENCY_ROUTE_PATTERNS.filter((re) => re.test(path)).map(String);
      expect(matched, `${path} is matched by an agency route pattern`).toEqual([]);
    }
  });
});
