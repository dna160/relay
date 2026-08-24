/**
 * The accessibility floor, scanned in source.
 *
 * §5 of `docs/design/A11Y-ASSERTIONS.md`, plus the checks that document lists
 * under "what these do not prove" and marks as belonging to a layer the design
 * agent does not own: `<html lang>`, the skip link, and the motion budget.
 *
 * None of this needs a browser, which is the point — the browser half of the
 * accessibility suite lives in `tests/e2e/` and is red until the test-only seed
 * endpoints exist. A floor that can only be checked when the whole application
 * is running is a floor that goes unchecked.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_CSS_SOURCE_PATTERNS, MOTION, TARGETS } from '@/styles/a11y-contract';
import { sourceFiles, stripComments } from '../invariants/_source';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Every `.ts`/`.tsx` file under `src/`, comments already removed. */
const FILES = sourceFiles();

/** The contract module names the patterns; scanning it for them would be circular. */
const SELF = 'src/styles/a11y-contract.ts';

function layout(): string {
  return readFileSync(`${ROOT}/src/app/layout.tsx`, 'utf8');
}

describe('nothing suppresses the focus ring', () => {
  it('has source to scan, so an empty sweep is not a pass', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('contains no form of outline:none anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.path === SELF) continue;
      for (const { pattern, why } of FORBIDDEN_CSS_SOURCE_PATTERNS) {
        if (file.text.includes(pattern)) offenders.push(`${file.path}: "${pattern}" — ${why}`);
      }
    }
    expect(
      offenders,
      'if a component genuinely needs outline:none with an equally visible ' +
        'replacement, the move is an allowlist entry naming the replacement — ' +
        'not deleting this test.',
    ).toEqual([]);
  });

  it('contains no positive tabindex, so focus order stays DOM order', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const match of file.text.matchAll(/tabIndex\s*=\s*\{?\s*(-?\d+)/g)) {
        const value = Number(match[1]);
        if (value > 0) offenders.push(`${file.path}: tabIndex={${value}}`);
      }
    }
    expect(offenders, 'ACCESSIBILITY.md §4: no tabindex above 0 exists in this codebase').toEqual(
      [],
    );
  });
});

describe('the app shell satisfies what the design layer cannot', () => {
  /**
   * ACCESSIBILITY.md §8 flags these as the AA requirements that live in
   * `src/app/layout.tsx`, which the design layer does not own — and therefore
   * as the ones nobody was checking.
   */
  it('declares a document language', () => {
    expect(layout(), '<html lang> is a WCAG 3.1.1 failure when absent').toMatch(
      /<html[^>]*\slang=["'][a-z]{2}/i,
    );
  });

  it('anchors the white-label lock to a real element', () => {
    expect(
      layout(),
      'the lock\'s second mechanism declares tokens on [data-relay-root]; without ' +
        'that attribute in the shell the mechanism is inert and an inline tenant ' +
        'style wins.',
    ).toContain('data-relay-root');
  });

  it('puts the tenant hook on the body, where an inline style can be beaten', () => {
    expect(layout()).toMatch(/<body[^>]*data-relay-root/);
  });
});

describe('the motion budget', () => {
  /**
   * ACCESSIBILITY.md §7: reduced motion is removed **at the token**, so a
   * single declaration silences everything and no component can forget to opt
   * in. A `motion-reduce:` variant at a call site is the shape of a component
   * that opted in by hand — which means the next one can forget.
   */
  const MOTION_CALL_SITE = /\bmotion-reduce:/;

  /**
   * DEFECT (round 2, front-end): `src/components/agency/card-tile.tsx` reveals
   * its row of actions with `transition-opacity` on hover and silences it with
   * `motion-reduce:transition-none`. Two spec deviations in one line — an
   * animation outside the one-crossfade budget, and a call-site opt-in instead
   * of the token. Not an accessibility failure (reduced motion *is* honoured,
   * and `focus-within:` keeps the controls reachable from the keyboard), so it
   * is recorded rather than suppressed.
   *
   * The assertion is a subset check on purpose: a new offender fails, and
   * fixing this one does not.
   */
  const KNOWN_CALL_SITE_OFFENDERS = ['src/components/agency/card-tile.tsx'];

  it('honours reduced motion at the token and not at call sites', () => {
    const offenders = FILES.filter((f) => MOTION_CALL_SITE.test(f.text)).map((f) => f.path);
    const unexpected = offenders.filter((path) => !KNOWN_CALL_SITE_OFFENDERS.includes(path));
    expect(
      unexpected,
      'a new component opted into reduced motion by hand. ACCESSIBILITY.md §7: ' +
        'add a duration token under the same media query instead — the next ' +
        'component will forget the variant, and nothing will catch it.',
    ).toEqual([]);
  });

  it('ships none of the motion the design system says does not exist', () => {
    const FORBIDDEN = [
      { pattern: /\banimate-spin\b/, why: 'a rotating spinner' },
      { pattern: /\banimate-pulse\b/, why: 'a pulsing skeleton' },
      { pattern: /\banimate-ping\b/, why: 'a pinging indicator' },
      { pattern: /\banimate-bounce\b/, why: 'a bouncing indicator' },
      { pattern: /hover:scale-/, why: 'a hover scale' },
      { pattern: /hover:-?translate-/, why: 'a hover lift' },
      { pattern: /animation-iteration-count:\s*infinite/, why: 'an infinite animation' },
    ];
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file.path === SELF) continue;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(file.text)) offenders.push(`${file.path}: ${why}`);
      }
    }
    expect(
      offenders,
      'ACCESSIBILITY.md §7 lists these as explicitly absent from the product',
    ).toEqual([]);
  });

  it('names the duration token the reduced-motion query silences', () => {
    // A component reading a duration the query does not cover would keep moving.
    const css = readFileSync(`${ROOT}/src/app/globals.css`, 'utf8');
    const durations = [...css.matchAll(/--dur-[a-z0-9-]+/g)].map((m) => m[0]);
    for (const token of new Set(durations)) {
      expect(
        token,
        `${token} exists and is not the token the reduced-motion query silences. ` +
          'Every duration token must be reset under that query.',
      ).toBe(MOTION.durationToken);
    }
  });
});

describe('the client text floor', () => {
  /**
   * Below 16px, iOS Safari zooms the viewport when a field takes focus — which
   * on the decision bar means the client's note field jumps out from under the
   * keyboard at the exact moment they are trying to type into it.
   */
  it('sets no sub-16px text class on an input or a textarea', () => {
    const SMALL = /\btext-(xs|sm)\b/;
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!/\.tsx$/.test(file.path)) continue;
      for (const match of file.text.matchAll(/<(input|textarea)\b([\s\S]{0,600}?)\/?>/g)) {
        const element = match[2] ?? '';
        if (SMALL.test(element)) offenders.push(`${file.path}: <${match[1]}> uses a sub-16px class`);
      }
    }
    expect(
      offenders,
      `inputs are ${TARGETS.minInputFontPx}px minimum; this is a hard floor, not a preference`,
    ).toEqual([]);
  });
});

describe('colour is never the only channel', () => {
  /**
   * The automated proxy ACCESSIBILITY.md §3 proposes: a possession hue must
   * never be the only thing distinguishing a state. Every primitive that paints
   * a possession fill also renders a text label, so the check is that the
   * primitives which take a possession also take a label.
   */
  it('gives every possession-coloured primitive a text label as well as a hue', () => {
    const primitives = FILES.filter((f) => f.path.startsWith('src/components/primitives/'));
    expect(primitives.length, 'no primitives found').toBeGreaterThan(3);
    // The hue reaches a primitive as a `tone`, whose union is the possession
    // vocabulary. Matching on the union rather than on the word "possession"
    // keeps the check working when the prose around it changes.
    const coloured = primitives.filter((f) =>
      /'agency'\s*\|\s*'client'/.test(f.text) || /\bbg-tint-agency\b|\bbg-agency\b/.test(f.text),
    );
    expect(
      coloured.length,
      'no primitive paints a possession hue — either the vocabulary moved or this ' +
        'check stopped seeing it, and both are worse than a failure',
    ).toBeGreaterThan(0);
    for (const file of coloured) {
      const text = stripComments(file.text);
      expect(
        /label|children|aria-label|sr-only/.test(text),
        `${file.path} paints a possession hue with no textual channel beside it`,
      ).toBe(true);
    }
  });
});
