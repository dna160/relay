/**
 * The accessibility floor, executed.
 *
 * `docs/design/ACCESSIBILITY.md` is the specification and it is prose; prose
 * cannot fail CI, which is why two Phase 8 EXIT conditions were UNPROVEN at the
 * end of round 1. The design layer answered directive U5 by expressing the
 * floor as data in `src/styles/a11y-contract.ts` and writing the assertions out
 * in `docs/design/A11Y-ASSERTIONS.md`. This is QA lifting §1 and §5 of that
 * document into `tests/`, plus a third check the document does not have.
 *
 * The three layers, and why all three are needed:
 *
 *   1. **The palette is legible.** Recomputed from the shipped hexes on every
 *      run. This is the assertion that would have caught `--muted` at 4.139:1.
 *   2. **The application ships that palette.** `globals.css` is diffed against
 *      the contract, so a token edited in one and not the other is a failing
 *      test rather than a design review someone skipped. QA's addition — the
 *      contract module is a *copy* of the CSS, and an uncrosschecked copy is a
 *      second source of truth wearing the clothes of a first one.
 *   3. **Nothing suppresses the ring.** A grep, and it costs nothing.
 *
 * What this cannot prove is that the rendered page resolves to these values —
 * `color-mix()` and the OKLCH white-label clamp are browser computations. That
 * half is the browser half of this suite (`a11y-tokens.spec.ts`), and neither half is worth much
 * alone.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTRAST_PAIRS,
  HOSTILE_BRAND_VALUES,
  LOCKED_TOKENS,
  MEASURED_TOLERANCE,
  TOKENS,
  contrastRatio,
  measurePair,
  parseColor,
  relativeLuminance,
  FOCUS_RING,
  MOTION,
  TARGETS,
  REFLOW,
  UNTENANTED_AGENCY,
} from '@/styles/a11y-contract';

/**
 * The stylesheet with its comments removed. `globals.css` explains the
 * white-label lock by quoting the attack it defeats — `style="--breach:#0f0"` —
 * and a scan that cannot tell a declaration from a description of one reports
 * the explanation as the violation.
 */
const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/* -------------------------------------------------------------- 1. palette */

describe('the contrast floor', () => {
  it('has pairs to measure, so an empty sweep is not a pass', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(20);
  });

  for (const pair of CONTRAST_PAIRS) {
    it(`${pair.id} meets ${pair.min}:1 — ${pair.why}`, () => {
      const actual = measurePair(pair);
      expect(actual, `${pair.fg} on ${pair.bg} (${pair.mode})`).toBeGreaterThanOrEqual(pair.min);
      // The second assertion is the one that catches a token edited without the
      // contract being updated — a "still passes, but nobody looked" change.
      expect(Math.abs(actual - pair.measured), `${pair.id} drifted from its recorded measurement`)
        .toBeLessThan(MEASURED_TOLERANCE);
    });
  }

  it('asserts every text token on --paper-2, not only on --paper', () => {
    const text = CONTRAST_PAIRS.filter((p) => p.kind === 'text');
    const onPaper2 = text.filter((p) => p.bg === '--paper-2').map((p) => p.fg);
    for (const token of new Set(text.filter((p) => p.bg === '--paper').map((p) => p.fg))) {
      expect(onPaper2, `${token} is asserted on --paper but not on --paper-2`).toContain(token);
    }
  });

  it('never treats --rule as a control boundary', () => {
    for (const pair of CONTRAST_PAIRS.filter((p) => p.fg === '--rule')) {
      expect(pair.kind).toBe('decorative');
      expect(measurePair(pair), 'a hairline cannot be a control boundary').toBeLessThan(3);
    }
  });

  it('covers both modes, so a dark-mode regression cannot hide behind a light-mode pass', () => {
    for (const mode of ['light', 'dark'] as const) {
      const inMode = CONTRAST_PAIRS.filter((p) => p.mode === mode && p.kind === 'text');
      expect(inMode.length, `${mode} has too few text pairs`).toBeGreaterThan(8);
    }
  });
});

describe('the dark lift is per token, not the flat +18 the design system published', () => {
  it('shows the +18 agency and breach values failing on --paper-2', () => {
    const paper2 = TOKENS.dark['--paper-2'];
    expect(contrastRatio('#399081', paper2), 'agency at +18').toBeLessThan(4.5);
    expect(contrastRatio('#E1443D', paper2), 'breach at +18').toBeLessThan(4.5);
  });

  it('shows the shipped +20 and +23 values clearing it', () => {
    const paper2 = TOKENS.dark['--paper-2'];
    expect(contrastRatio(TOKENS.dark['--agency'], paper2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.dark['--breach'], paper2)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the colour maths refuses to guess', () => {
  it('throws on an unresolved custom property rather than falling back to black', () => {
    expect(() => contrastRatio('var(--ink)', '#fff')).toThrow(/unsupported colour form/);
  });

  it('throws on an unresolved color-mix', () => {
    expect(() => contrastRatio('color-mix(in srgb, red 12%, white)', '#fff')).toThrow();
  });

  it('agrees with the WCAG reference points', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('is order-independent, so a pair cannot pass by being written backwards', () => {
    for (const pair of CONTRAST_PAIRS.slice(0, 8)) {
      const palette = TOKENS[pair.mode];
      expect(contrastRatio(palette[pair.fg], palette[pair.bg])).toBeCloseTo(
        contrastRatio(palette[pair.bg], palette[pair.fg]),
        10,
      );
    }
  });
});

/* ------------------------------------------- 2. the app ships that palette */

describe('globals.css and the contract are the same palette', () => {
  /**
   * `a11y-contract.ts` records the hexes so a Node test can compute without a
   * browser — which makes it a copy, and an uncrosschecked copy is a second
   * source of truth. Tokens declared as `var()` or `color-mix()` are excluded:
   * they have no literal in the stylesheet to compare against, and the browser
   * half of the suite is what covers them.
   */
  const LITERAL_TOKENS = [
    '--ink',
    '--paper',
    '--paper-2',
    '--rule',
    '--rule-strong',
    '--muted',
    '--agency',
    '--client',
    '--breach',
  ] as const;

  function hexesFor(token: string): Set<string> {
    const pattern = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'g');
    return new Set([...GLOBALS_CSS.matchAll(pattern)].map((m) => (m[1] ?? '').toLowerCase()));
  }

  for (const token of LITERAL_TOKENS) {
    it(`${token} is declared in globals.css with the light and dark values the contract records`, () => {
      const declared = hexesFor(token);
      expect(declared.size, `${token} is not declared with a literal in globals.css`).toBeGreaterThan(0);
      for (const mode of ['light', 'dark'] as const) {
        const expected = TOKENS[mode][token].toLowerCase();
        expect(
          [...declared],
          `${token} in ${mode} mode: a11y-contract.ts says ${expected}, globals.css does not declare it. ` +
            'One of the two was edited without the other; the contrast table is now fiction.',
        ).toContain(expected);
      }
    });
  }

  it('declares every locked token with !important on both the root and the tenant hook', () => {
    for (const token of LOCKED_TOKENS) {
      const declarations = [...GLOBALS_CSS.matchAll(new RegExp(`${token}\\s*:[^;]+;`, 'g'))].map(
        (m) => m[0] ?? '',
      );
      const relevant = declarations.filter((d) => !/print/.test(d));
      expect(relevant.length, `${token} is never declared`).toBeGreaterThan(0);
      for (const declaration of relevant) {
        expect(
          declaration,
          `${token} is declared without !important — an inline tenant style would win`,
        ).toContain('!important');
      }
    }
  });

  it('anchors the tenant hook to a selector the lock can reach', () => {
    expect(GLOBALS_CSS, 'the white-label lock has no [data-relay-root] anchor').toContain(
      '[data-relay-root]',
    );
  });

  it('never exposes an unclamped tenant colour — the brand hook is only ever read inside oklch()', () => {
    const reads = [...GLOBALS_CSS.matchAll(/var\(--brand-agency[^)]*\)/g)];
    expect(reads.length, 'the brand hook is never read').toBeGreaterThan(0);
    for (const read of reads) {
      const before = GLOBALS_CSS.slice(Math.max(0, read.index - 220), read.index);
      expect(
        before,
        'the tenant hook is read outside an oklch() clamp; an unclamped brand colour ' +
          'can reach the page and white-label becomes able to make possession illegible',
      ).toMatch(/oklch\(\s*from\s*$|oklch\(\s*from\s*[\s\S]*$/);
    }
  });

  it('keeps a hostile brand value out of the literal palette', () => {
    // Nothing a tenant could supply is hard-coded anywhere in the stylesheet.
    for (const brand of HOSTILE_BRAND_VALUES) {
      if (!brand.startsWith('#')) continue;
      const literals = [...GLOBALS_CSS.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) =>
        (m[0] ?? '').toLowerCase(),
      );
      const ground = ['#ffffff', '#000000'];
      if (ground.includes(brand.toLowerCase())) continue; // print styles use both
      expect(literals, `${brand} appears as a shipped token value`).not.toContain(
        brand.toLowerCase(),
      );
    }
  });
});

/* ------------------------------------------ 3. focus, motion and the floor */

describe('the focus ring is declared globally, not per component', () => {
  it('applies to every interactive element on :focus-visible', () => {
    expect(GLOBALS_CSS).toMatch(/:focus-visible/);
    const rule = /:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/.exec(GLOBALS_CSS);
    expect(rule, 'no global :focus-visible rule in globals.css').not.toBeNull();
    const selector = rule?.[1] ?? '';
    for (const element of ['a', 'button', 'input', 'textarea', 'select', 'summary', 'tabindex']) {
      expect(selector, `${element} is not covered by the global focus rule`).toContain(element);
    }
  });

  it('draws a solid ring at the width and offset the contract specifies', () => {
    const rule = /:where\([^)]*\):focus-visible\s*\{([^}]*)\}/.exec(GLOBALS_CSS)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*var\(--focus-width\)\s+solid\s+var\(--focus\)/);
    expect(rule).toMatch(/outline-offset:\s*var\(--focus-offset\)/);
    expect(GLOBALS_CSS).toMatch(new RegExp(`--focus-width:\\s*${FOCUS_RING.width}px`));
    expect(GLOBALS_CSS).toMatch(new RegExp(`--focus-offset:\\s*${FOCUS_RING.offset}px`));
  });

  it('keeps the ring neutral, so focus and possession never share a channel', () => {
    expect(GLOBALS_CSS).toMatch(/--focus:\s*var\(--ink\)/);
  });

  it('has a ring that clears 3:1 against both grounds in both modes, with the offset exposing them', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const ground of ['--paper', '--paper-2'] as const) {
        expect(
          contrastRatio(TOKENS[mode][FOCUS_RING.colorToken], TOKENS[mode][ground]),
          `the ring on ${ground} in ${mode}`,
        ).toBeGreaterThanOrEqual(FOCUS_RING.minContrast);
      }
    }
  });

  it('would fail without the offset, which is why the offset is not decoration', () => {
    // An ink ring drawn directly against an --agency fill. ACCESSIBILITY.md §4
    // measures this at 1.92:1; the 2px offset is what stops it happening.
    const ringOnFill = contrastRatio(TOKENS.light['--ink'], TOKENS.light['--agency']);
    expect(ringOnFill).toBeLessThan(FOCUS_RING.minContrast);
  });
});

describe('reduced motion is honoured at the token', () => {
  it('collapses the one duration token under prefers-reduced-motion: reduce', () => {
    const query = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(
      GLOBALS_CSS,
    )?.[1];
    expect(query, 'globals.css has no prefers-reduced-motion query').toBeTruthy();
    expect(query ?? '').toMatch(new RegExp(`${MOTION.durationToken}:\\s*${MOTION.reduced}`));
  });

  it('declares that duration once at its normal value, so there is one thing to silence', () => {
    expect(GLOBALS_CSS).toMatch(new RegExp(`${MOTION.durationToken}:\\s*${MOTION.normal}`));
  });

  it('applies the reduction to the tenant hook as well as the root', () => {
    const query = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(
      GLOBALS_CSS,
    )?.[1] ?? '';
    expect(query, 'a tenant-hooked page would keep animating').toContain('[data-relay-root]');
  });

  it('ships no infinite animation in the stylesheet', () => {
    expect(GLOBALS_CSS, 'spinners, shimmer and pulsing dots do not exist in this product')
      .not.toMatch(/animation[^;]*infinite/);
  });
});

describe('the floor the contract states is the floor the contract can state', () => {
  it('sets a client-facing target floor above the WCAG minimum, not equal to it', () => {
    expect(TARGETS.clientFacingPx).toBeGreaterThan(TARGETS.minPx);
    expect(TARGETS.minPx).toBeGreaterThanOrEqual(24); // WCAG 2.5.8
  });

  it('holds the 16px input floor that stops iOS zooming the decision bar away', () => {
    expect(TARGETS.minInputFontPx).toBeGreaterThanOrEqual(16);
  });

  it('reflows to 360px with no horizontal page scroll', () => {
    expect(REFLOW.minWidthPx).toBeLessThanOrEqual(360);
    expect(REFLOW.allowHorizontalPageScroll).toBe(false);
  });

  it('parses every colour the contract records, so none of the above passed on a default', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const [token, value] of Object.entries(TOKENS[mode])) {
        expect(() => parseColor(value), `${mode} ${token} = ${value}`).not.toThrow();
      }
    }
  });
});

/* ------------------------------ the untenanted default, and why ratios miss it */

describe('the untenanted default is the published colour, not a computed one', () => {
  /**
   * ROUND 2 DEFECT, and the sharpest thing this suite learned.
   *
   * `--agency` resolves down two paths: the published literal when there is no
   * tenant, the OKLCH clamp when there is one. The clamp used to swallow the
   * default too — `var(--brand-agency, #1f4e46)` routed the *default* through
   * the tenant branch, and in dark mode the chroma lift re-lifted a colour that
   * had already been lifted. The browser painted rgb(0, 163, 144) while every
   * document in the repository published #499D8F.
   *
   * **Every contrast assertion in this file passed the whole time.** The
   * painted-but-wrong colour measures 5.690:1; the published one measures
   * 5.571:1. Both clear 4.5 comfortably. A ratio assertion is structurally
   * incapable of catching a colour that is wrong but still legible — it is
   * right about the wrong thing. Only an exact-value assertion catches it, and
   * only against the *painted* value, which needs a browser.
   *
   * What runs here is the half that does not: the two records inside the
   * contract must agree, and the stylesheet must still read the hook in the one
   * shape that keeps the default out of the clamp. The painted half is
   * `a11y-shell.spec.ts`.
   */

  it('records the same untenanted --agency in both places it is written down', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(
        UNTENANTED_AGENCY[mode],
        `UNTENANTED_AGENCY and TOKENS disagree about ${mode} --agency. One of them is what ` +
          'the browser is asserted against and the other is what every ratio in ' +
          'ACCESSIBILITY.md was computed from; they cannot differ.',
      ).toBe(TOKENS[mode]['--agency']);
    }
  });

  it('demonstrates why a ratio assertion cannot catch this, so nobody replaces the exact one', () => {
    // The colour the browser actually painted while the defect was live.
    const drifted = 'rgb(0, 163, 144)';
    const published = TOKENS.dark['--agency'];
    const ground = TOKENS.dark['--paper-2'];

    expect(contrastRatio(drifted, ground), 'the wrong colour was illegible').toBeGreaterThan(4.5);
    expect(contrastRatio(published, ground)).toBeGreaterThan(4.5);
    expect(
      parseColor(drifted),
      'the drifted and published colours are the same; this case has stopped documenting anything',
    ).not.toEqual(parseColor(published));
  });

  it('never reads the tenant hook with a fallback, which is what routed the default through the clamp', () => {
    /**
     * The root cause in one line. `var(--brand-agency, #1f4e46)` makes the
     * clamp valid with no tenant, so the default goes through it. Undeclared,
     * `var(--brand-agency)` is guaranteed-invalid, `--agency-tenant` is invalid
     * at computed-value time, and `var(--agency-tenant, <literal>)` falls
     * through to the published colour untouched.
     */
    const reads = [...GLOBALS_CSS.matchAll(/var\(\s*--brand-agency\s*([^)]*)\)/g)];
    expect(reads.length, 'the tenant hook is never read').toBeGreaterThan(0);
    for (const read of reads) {
      expect(
        (read[1] ?? '').trim(),
        'the tenant hook is read with a fallback. That fallback makes the clamp valid when ' +
          'there is no tenant, and the published default is then a computed colour.',
      ).toBe('');
    }
  });

  it('leaves the tenant hook undeclared, so there is nothing for the clamp to consume', () => {
    expect(
      GLOBALS_CSS,
      '--brand-agency is declared in the stylesheet; the untenanted state is now a tenanted one',
    ).not.toMatch(/^\s*--brand-agency\s*:/m);
  });

  it('falls through to the published literal in each mode', () => {
    // `var(--agency-tenant, <literal>)` is the fall-through, and the literal in
    // it is the value this file records.
    const fallbacks = [...GLOBALS_CSS.matchAll(/var\(\s*--agency-tenant\s*,\s*(#[0-9a-fA-F]{6})/g)]
      .map((m) => (m[1] ?? '').toLowerCase());
    expect(fallbacks.length, 'the tenant value is never given a fall-through').toBeGreaterThan(1);
    for (const mode of ['light', 'dark'] as const) {
      expect(
        fallbacks,
        `no fall-through to the published ${mode} --agency; an untenanted install would compute one`,
      ).toContain(UNTENANTED_AGENCY[mode].toLowerCase());
    }
  });
});

describe('an explicit theme choice reaches the element the tokens are read from', () => {
  /**
   * THE SECOND ROUND 2 DEFECT, and one no colour assertion could have caught,
   * because both palettes were internally valid — the *selector* was wrong.
   *
   * `data-theme` lives on `<html>`; `data-relay-root` lives on `<body>`. The
   * dark rules were written `[data-relay-root]:not([data-theme='light'])`,
   * which is satisfied by any `<body>` — `<body>` never carries `data-theme`.
   * So a reader on a dark system who explicitly chose **light** still got dark,
   * and the self-qualified `[data-relay-root][data-theme='dark']` matched
   * nothing at all.
   *
   * Structural here; the painted proof is in `a11y-shell.spec.ts`.
   */

  /** Every selector in the stylesheet that mentions the tenant root. */
  const rootSelectors = [...GLOBALS_CSS.matchAll(/^[^{}]*\[data-relay-root\][^{}]*\{/gm)].map(
    (m) => (m[0] ?? '').replace(/\{$/, '').trim(),
  );

  it('finds the selectors to check, so an empty sweep is not a pass', () => {
    expect(rootSelectors.length).toBeGreaterThan(3);
  });

  it('never qualifies the tenant root with the theme attribute directly', () => {
    const offenders = rootSelectors.filter((selector) =>
      /\[data-relay-root\][^\s,>]*\[data-theme/.test(selector),
    );
    expect(
      offenders,
      'a selector reads data-theme off the same element as data-relay-root. The attribute is ' +
        'on <html> and the hook is on <body>: this matches nothing, or — with :not() — ' +
        'everything.',
    ).toEqual([]);
  });

  it('scopes every theme-conditional tenant-root rule under the document root', () => {
    const themed = rootSelectors.filter((selector) => selector.includes('data-theme'));
    expect(themed.length, 'no theme-conditional rule reaches the tenant root').toBeGreaterThan(0);
    for (const selector of themed) {
      for (const part of selector.split(',').map((s) => s.trim()).filter((s) => s.includes('data-relay-root'))) {
        expect(
          part,
          `${part} is not descendant-scoped to :root. The theme lives on <html>; a rule that ` +
            'does not look there is deciding the theme from the wrong element.',
        ).toMatch(/^:root[^\s]*\s+\[data-relay-root\]/);
      }
    }
  });

  it('gates the dark palette on the root, in both the media query and the explicit choice', () => {
    // Both halves must exist: the media query serves the system preference and
    // :not([data-theme='light']) is what lets an explicit light choice win it.
    expect(GLOBALS_CSS).toMatch(/:root:not\(\[data-theme='light'\]\)\s+\[data-relay-root\]/);
    expect(GLOBALS_CSS).toMatch(/:root\[data-theme='dark'\]\s+\[data-relay-root\]/);
  });
});
