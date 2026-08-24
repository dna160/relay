/**
 * THE ACCESSIBILITY FLOOR, AS DATA.
 *
 * `docs/design/ACCESSIBILITY.md` is prose. Prose cannot fail CI, which is why
 * two Phase EXIT conditions — visible focus and `prefers-reduced-motion` — were
 * UNPROVEN at the end of round 1. This module is the same floor expressed as
 * values and pure functions so a Playwright spec can execute it against a real
 * rendered page.
 *
 * Owned by the design layer (`src/styles/**`). QA owns `tests/**` and imports
 * from here; the assertions themselves are written out, ready to lift, in
 * `docs/design/A11Y-ASSERTIONS.md`.
 *
 * The point of the split: the numbers live beside the tokens they describe, so
 * changing `--muted` in `globals.css` without changing this file turns a
 * contrast regression into a red test rather than a design review someone
 * skipped. Do not "fix" a failing assertion by editing the expectation.
 *
 * No imports. No dependencies. Runs in a browser, in Node, and inside
 * `page.evaluate`.
 */

/* ==========================================================================
   1. COLOUR MATHS — WCAG 2.x, computed rather than asserted
   ========================================================================== */

/** sRGB channels, 0–255. */
export type Rgb = readonly [number, number, number];

/**
 * Parses the forms a test will actually meet: a hex literal out of this file,
 * and `rgb()` / `rgba()` out of `getComputedStyle`. Throws rather than
 * returning black on an unrecognised value — a silent fallback here would make
 * every contrast assertion pass against a colour nobody chose.
 */
export function parseColor(input: string): Rgb {
  const value = input.trim().toLowerCase();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand =
      hex.length === 3 || hex.length === 4
        ? hex
            .slice(0, 3)
            .split('')
            .map((c) => c + c)
            .join('')
        : hex.slice(0, 6);
    if (expand.length !== 6 || !/^[0-9a-f]{6}$/.test(expand)) {
      throw new Error(`a11y-contract: not a hex colour: ${input}`);
    }
    const r = Number.parseInt(expand.slice(0, 2), 16);
    const g = Number.parseInt(expand.slice(2, 4), 16);
    const b = Number.parseInt(expand.slice(4, 6), 16);
    return [r, g, b];
  }

  const fn = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(value);
  if (fn) {
    const r = Number(fn[1]);
    const g = Number(fn[2]);
    const b = Number(fn[3]);
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      throw new Error(`a11y-contract: unparseable rgb colour: ${input}`);
    }
    return [r, g, b];
  }

  throw new Error(
    `a11y-contract: unsupported colour form: ${input}. ` +
      'Resolve custom properties and color-mix() in the browser first — ' +
      'read the computed colour off an element, not the variable declaration.',
  );
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: string | Rgb): number {
  const [r, g, b] = typeof color === 'string' ? parseColor(color) : color;
  const lin = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** `(L1 + 0.05) / (L2 + 0.05)`, lighter over darker. Order-independent. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ==========================================================================
   2. THE TOKENS, PER MODE
   ========================================================================== */

export type Mode = 'light' | 'dark';

export type TokenName =
  | '--ink'
  | '--paper'
  | '--paper-2'
  | '--rule'
  | '--rule-strong'
  | '--muted'
  | '--agency'
  | '--client'
  | '--breach'
  | '--on-hue'
  | '--tint-agency'
  | '--tint-client'
  | '--tint-breach';

/**
 * The shipped values. `--on-hue` is `var(--paper)` and the three tints are
 * `color-mix()` results; their resolved hexes are recorded here so a Node-side
 * test can compute without a browser. A browser-side test should prefer the
 * live computed value — see `A11Y-ASSERTIONS.md` §2 — which is what catches a
 * token edit this file was not updated for.
 */
export const TOKENS: Readonly<Record<Mode, Readonly<Record<TokenName, string>>>> = {
  light: {
    '--ink': '#14171A',
    '--paper': '#E8EAE5',
    '--paper-2': '#F2F3F0',
    '--rule': '#C4C8C0',
    '--rule-strong': '#808978',
    '--muted': '#60665D',
    '--agency': '#1F4E46',
    '--client': '#4A4FA6',
    '--breach': '#A8201A',
    '--on-hue': '#E8EAE5',
    '--tint-agency': '#D9DFDC',
    '--tint-client': '#DEDFE7',
    '--tint-breach': '#E9DAD6',
  },
  dark: {
    '--ink': '#E8EAE5',
    '--paper': '#14171A',
    '--paper-2': '#1D2125',
    '--rule': '#363D43',
    '--rule-strong': '#616D77',
    '--muted': '#999F96',
    '--agency': '#499D8F',
    '--client': '#8487C8',
    '--breach': '#E45953',
    '--on-hue': '#14171A',
    '--tint-agency': '#223032',
    '--tint-client': '#292D39',
    '--tint-breach': '#35282B',
  },
} as const;

/* ==========================================================================
   3. THE CONTRAST PAIRS
   ========================================================================== */

export type ContrastKind = 'text' | 'non-text' | 'decorative';

export interface ContrastPair {
  /** Stable id — use it as the Playwright test title so a failure names itself. */
  readonly id: string;
  readonly mode: Mode;
  readonly fg: TokenName;
  readonly bg: TokenName;
  /** WCAG threshold: 4.5 for text, 3 for a control boundary, 0 for decoration. */
  readonly min: number;
  /** Measured on the values in `TOKENS`, to 3dp. A regression shows as a drop. */
  readonly measured: number;
  readonly kind: ContrastKind;
  readonly why: string;
}

/**
 * Both grounds are asserted for every text token. `--paper-2` is the harder
 * ground and it is the one cards sit on, so a token that passes only on
 * `--paper` has not passed. This is exactly how the old `--muted` survived
 * review at 4.14:1.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // ---- light, text on both grounds
  { id: 'light/ink-on-paper', mode: 'light', fg: '--ink', bg: '--paper', min: 4.5, measured: 14.849, kind: 'text', why: 'body text' },
  { id: 'light/ink-on-paper-2', mode: 'light', fg: '--ink', bg: '--paper-2', min: 4.5, measured: 16.153, kind: 'text', why: 'body text on a card' },
  { id: 'light/muted-on-paper', mode: 'light', fg: '--muted', bg: '--paper', min: 4.5, measured: 4.874, kind: 'text', why: 'hints, due dates, sizes. The value this replaced measured 4.139 and failed.' },
  { id: 'light/muted-on-paper-2', mode: 'light', fg: '--muted', bg: '--paper-2', min: 4.5, measured: 5.302, kind: 'text', why: 'the same text on a card' },
  { id: 'light/agency-on-paper', mode: 'light', fg: '--agency', bg: '--paper', min: 4.5, measured: 7.750, kind: 'text', why: 'possession label' },
  { id: 'light/agency-on-paper-2', mode: 'light', fg: '--agency', bg: '--paper-2', min: 4.5, measured: 8.430, kind: 'text', why: 'possession label on a card' },
  { id: 'light/client-on-paper', mode: 'light', fg: '--client', bg: '--paper', min: 4.5, measured: 5.855, kind: 'text', why: 'possession label' },
  { id: 'light/client-on-paper-2', mode: 'light', fg: '--client', bg: '--paper-2', min: 4.5, measured: 6.369, kind: 'text', why: 'possession label on a card' },
  { id: 'light/breach-on-paper', mode: 'light', fg: '--breach', bg: '--paper', min: 4.5, measured: 6.004, kind: 'text', why: 'the rounds counter, over contract' },
  { id: 'light/breach-on-paper-2', mode: 'light', fg: '--breach', bg: '--paper-2', min: 4.5, measured: 6.532, kind: 'text', why: 'the rounds counter on a card' },
  // ---- light, text on a filled possession surface
  { id: 'light/on-hue-on-agency', mode: 'light', fg: '--on-hue', bg: '--agency', min: 4.5, measured: 7.750, kind: 'text', why: 'label on an agency-filled button or chip' },
  { id: 'light/on-hue-on-client', mode: 'light', fg: '--on-hue', bg: '--client', min: 4.5, measured: 5.855, kind: 'text', why: 'label on a client-filled button or chip' },
  { id: 'light/on-hue-on-breach', mode: 'light', fg: '--on-hue', bg: '--breach', min: 4.5, measured: 6.004, kind: 'text', why: 'label on a breach-filled chip' },
  // ---- light, quiet chip grounds
  { id: 'light/ink-on-tint-agency', mode: 'light', fg: '--ink', bg: '--tint-agency', min: 4.5, measured: 13.313, kind: 'text', why: 'quiet chip label — the hue is in the tint, never in the label' },
  { id: 'light/ink-on-tint-client', mode: 'light', fg: '--ink', bg: '--tint-client', min: 4.5, measured: 13.549, kind: 'text', why: 'quiet chip label' },
  { id: 'light/ink-on-tint-breach', mode: 'light', fg: '--ink', bg: '--tint-breach', min: 4.5, measured: 13.249, kind: 'text', why: 'quiet chip label' },
  // ---- light, non-text
  { id: 'light/rule-strong-on-paper', mode: 'light', fg: '--rule-strong', bg: '--paper', min: 3, measured: 3.005, kind: 'non-text', why: 'WCAG 1.4.11 — the boundary of any control' },
  { id: 'light/rule-strong-on-paper-2', mode: 'light', fg: '--rule-strong', bg: '--paper-2', min: 3, measured: 3.269, kind: 'non-text', why: 'control boundary on a card' },
  { id: 'light/focus-ring-on-paper', mode: 'light', fg: '--ink', bg: '--paper', min: 3, measured: 14.849, kind: 'non-text', why: 'WCAG 2.4.13 — the ring against what the 2px offset exposes' },
  { id: 'light/focus-ring-on-paper-2', mode: 'light', fg: '--ink', bg: '--paper-2', min: 3, measured: 16.153, kind: 'non-text', why: 'the ring on a card' },
  // ---- light, decorative (asserted so nobody promotes it to a boundary)
  { id: 'light/rule-on-paper', mode: 'light', fg: '--rule', bg: '--paper', min: 0, measured: 1.401, kind: 'decorative', why: 'hairline only. If a control uses this as its sole boundary, that control is broken.' },

  // ---- dark, text on both grounds
  { id: 'dark/ink-on-paper', mode: 'dark', fg: '--ink', bg: '--paper', min: 4.5, measured: 14.849, kind: 'text', why: 'body text' },
  { id: 'dark/ink-on-paper-2', mode: 'dark', fg: '--ink', bg: '--paper-2', min: 4.5, measured: 13.368, kind: 'text', why: 'body text on a card' },
  { id: 'dark/muted-on-paper', mode: 'dark', fg: '--muted', bg: '--paper', min: 4.5, measured: 6.643, kind: 'text', why: 'hints, due dates, sizes' },
  { id: 'dark/muted-on-paper-2', mode: 'dark', fg: '--muted', bg: '--paper-2', min: 4.5, measured: 5.981, kind: 'text', why: 'the same text on a card' },
  { id: 'dark/agency-on-paper', mode: 'dark', fg: '--agency', bg: '--paper', min: 4.5, measured: 5.571, kind: 'text', why: 'possession label; +20 lift, not +18' },
  { id: 'dark/agency-on-paper-2', mode: 'dark', fg: '--agency', bg: '--paper-2', min: 4.5, measured: 5.016, kind: 'text', why: 'the binding case. At +18 this measured 4.227 and failed.' },
  { id: 'dark/client-on-paper', mode: 'dark', fg: '--client', bg: '--paper', min: 4.5, measured: 5.381, kind: 'text', why: 'possession label; +18 lift' },
  { id: 'dark/client-on-paper-2', mode: 'dark', fg: '--client', bg: '--paper-2', min: 4.5, measured: 4.844, kind: 'text', why: 'possession label on a card' },
  { id: 'dark/breach-on-paper', mode: 'dark', fg: '--breach', bg: '--paper', min: 4.5, measured: 5.014, kind: 'text', why: 'rounds counter; +23 lift, not +18' },
  { id: 'dark/breach-on-paper-2', mode: 'dark', fg: '--breach', bg: '--paper-2', min: 4.5, measured: 4.514, kind: 'text', why: 'the tightest margin in the palette. At +18 this measured 3.930.' },
  // ---- dark, text on a filled possession surface
  { id: 'dark/on-hue-on-agency', mode: 'dark', fg: '--on-hue', bg: '--agency', min: 4.5, measured: 5.571, kind: 'text', why: 'label on an agency-filled button or chip' },
  { id: 'dark/on-hue-on-client', mode: 'dark', fg: '--on-hue', bg: '--client', min: 4.5, measured: 5.381, kind: 'text', why: 'label on a client-filled button or chip' },
  { id: 'dark/on-hue-on-breach', mode: 'dark', fg: '--on-hue', bg: '--breach', min: 4.5, measured: 5.014, kind: 'text', why: 'label on a breach-filled chip' },
  // ---- dark, quiet chip grounds
  { id: 'dark/ink-on-tint-agency', mode: 'dark', fg: '--ink', bg: '--tint-agency', min: 4.5, measured: 11.277, kind: 'text', why: 'quiet chip label' },
  { id: 'dark/ink-on-tint-client', mode: 'dark', fg: '--ink', bg: '--tint-client', min: 4.5, measured: 11.337, kind: 'text', why: 'quiet chip label' },
  { id: 'dark/ink-on-tint-breach', mode: 'dark', fg: '--ink', bg: '--tint-breach', min: 4.5, measured: 11.634, kind: 'text', why: 'quiet chip label' },
  // ---- dark, non-text
  { id: 'dark/rule-strong-on-paper', mode: 'dark', fg: '--rule-strong', bg: '--paper', min: 3, measured: 3.394, kind: 'non-text', why: 'WCAG 1.4.11 — the boundary of any control' },
  { id: 'dark/rule-strong-on-paper-2', mode: 'dark', fg: '--rule-strong', bg: '--paper-2', min: 3, measured: 3.056, kind: 'non-text', why: 'control boundary on a card' },
  { id: 'dark/focus-ring-on-paper', mode: 'dark', fg: '--ink', bg: '--paper', min: 3, measured: 14.849, kind: 'non-text', why: 'WCAG 2.4.13' },
  { id: 'dark/focus-ring-on-paper-2', mode: 'dark', fg: '--ink', bg: '--paper-2', min: 3, measured: 13.368, kind: 'non-text', why: 'the ring on a card' },
  { id: 'dark/rule-on-paper', mode: 'dark', fg: '--rule', bg: '--paper', min: 0, measured: 1.632, kind: 'decorative', why: 'hairline only' },
] as const;

/**
 * Tolerance for `measured` when recomputing from `TOKENS`. Tight on purpose:
 * this catches a token edit, not floating-point noise.
 */
export const MEASURED_TOLERANCE = 0.01;

/** Recomputes a pair from `TOKENS`. Pure; safe in Node. */
export function measurePair(pair: ContrastPair): number {
  const palette = TOKENS[pair.mode];
  return contrastRatio(palette[pair.fg], palette[pair.bg]);
}

/* ==========================================================================
   4. THE WHITE-LABEL FLOOR
   ========================================================================== */

/**
 * `--agency` is computed from `--brand-agency` through an OKLCH clamp, so a
 * tenant can change the hue and not the legibility. These are the worst cases
 * at the edges of the clamp band, from the sweep in ACCESSIBILITY.md §2.
 *
 * A Playwright test sets `--brand-agency` on `[data-relay-root]` to each of
 * `HOSTILE_BRAND_VALUES` and asserts the resolved `--agency` still clears
 * `WHITE_LABEL_FLOOR` on both grounds.
 */
export const WHITE_LABEL_FLOOR = 4.5;

export const BRAND_HOOK = '--brand-agency';
export const BRAND_ROOT_SELECTOR = '[data-relay-root]';

/**
 * `--agency` has TWO resolution paths and only one of them is clamped:
 *
 *   - no tenant  -> the published literal in `TOKENS[mode]['--agency']`,
 *                   untouched. `--brand-agency` is left undeclared, so
 *                   `--agency-tenant` is invalid at computed-value time and
 *                   `var(--agency-tenant, <literal>)` falls through.
 *   - tenant set -> the brand hue re-expressed through the OKLCH clamp.
 *
 * ROUND 2 DEFECT, and the reason this constant exists: the clamp used to be
 * applied to the default as well, via `var(--brand-agency, #1f4e46)`. In dark
 * mode its `c * 1.6` chroma lift re-lifted a colour that was already lifted, so
 * the browser painted rgb(0, 163, 144) while every document — this file
 * included — published #499D8F. Contrast still passed (5.690 vs the recorded
 * 5.571), which is exactly why nothing caught it: the ratio assertions were
 * right about the wrong colour.
 *
 * A ratio-only assertion cannot catch that class of drift. The browser half of
 * the suite must assert the untenanted `--agency` resolves to this EXACT value,
 * per mode — see `A11Y-ASSERTIONS.md` §4.
 */
export const UNTENANTED_AGENCY: Readonly<Record<Mode, string>> = {
  light: '#1F4E46',
  dark: '#499D8F',
} as const;

/** Deliberately awful. Each one is a plausible mistake or a deliberate attack. */
export const HOSTILE_BRAND_VALUES: readonly string[] = [
  '#FFFF00', // maximum luminance
  '#FFFFFF', // the ground itself
  '#000000', // minimum luminance
  '#00FF00', // brightest in-gamut hue
  '#FF00FF', // darkest in-gamut hue at the dark floor
  'oklch(0.99 0.4 120)', // out of band on every channel
  'rgb(232, 234, 229)', // exactly --paper, i.e. invisible if unclamped
];

/**
 * Tokens a tenant must not be able to move at all. The test writes each one
 * into the inline style of `[data-relay-root]` and asserts the computed value
 * is unchanged — the `!important` declarations on both `:root` and the hook's
 * own element are what make that true.
 */
export const LOCKED_TOKENS: readonly TokenName[] = [
  '--ink',
  '--paper',
  '--paper-2',
  '--rule',
  '--rule-strong',
  '--muted',
  '--client',
  '--breach',
] as const;

/* ==========================================================================
   5. FOCUS
   ========================================================================== */

/**
 * Everything that must show the ring. Matches the `:where(...)` list in
 * `globals.css` §6. A Playwright test walks every match on a page, focuses it,
 * and asserts the computed outline.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export const FOCUS_RING = {
  /** Computed `outline-width`, in px. WCAG 2.4.13 wants a 2px perimeter. */
  width: 2,
  /** Computed `outline-offset`, in px. Load-bearing: it exposes the ground. */
  offset: 2,
  /** `outline-style`. `none` and `auto` both fail. */
  style: 'solid',
  /** The ring colour resolves to `--ink` in both modes. */
  colorToken: '--ink' as TokenName,
  /** Minimum contrast of the ring against whatever the offset exposes. */
  minContrast: 3,
} as const;

/**
 * `outline: none` with no equally visible replacement is the single most common
 * way a codebase loses its focus ring. A source-scan test greps for these.
 */
export const FORBIDDEN_CSS_SOURCE_PATTERNS: readonly { pattern: string; why: string }[] = [
  { pattern: 'outline:none', why: 'kills the focus ring' },
  { pattern: 'outline: none', why: 'kills the focus ring' },
  { pattern: 'outline-none', why: 'Tailwind form of the same' },
  { pattern: 'focus:outline-none', why: 'the same, deferred to focus' },
] as const;

/* ==========================================================================
   6. MOTION
   ========================================================================== */

/**
 * The whole motion budget of the product. Reduced motion is honoured at the
 * token, not per component, so one assertion covers every animation that
 * exists — and any animation added later that does not read `--dur-chip` is a
 * spec violation, which is what `ALLOWED_ANIMATION_NAMES` is for.
 */
export const MOTION = {
  durationToken: '--dur-chip',
  /** Computed value with no reduced-motion preference. */
  normal: '120ms',
  /** Computed value under `prefers-reduced-motion: reduce`. */
  reduced: '0ms',
  easingToken: '--ease-chip',
} as const;

/** The only two `@keyframes` in the product. Anything else is a regression. */
export const ALLOWED_ANIMATION_NAMES: readonly string[] = ['chip-in', 'chip-out', 'none'] as const;

/**
 * Explicitly absent from the product. A test that finds a computed
 * `transform` change on hover, or an `animation-iteration-count: infinite`,
 * has found one of these.
 */
export const FORBIDDEN_MOTION: readonly string[] = [
  'infinite animation (spinners, shimmer, pulsing dots)',
  'hover transform (lift, scale, translate)',
  'entrance animation on scroll',
  'skeleton shimmer',
  'toast slide-in',
  'page transition',
] as const;

/* ==========================================================================
   7. TARGETS AND TEXT
   ========================================================================== */

export const TARGETS = {
  /** WCAG 2.5.8 minimum, everywhere. */
  minPx: 24,
  /** The stronger floor, required on every client-facing control. */
  clientFacingPx: 44,
  /**
   * Below 16px, iOS Safari zooms the viewport on focus, which on the decision
   * bar means the note field jumps out from under the keyboard. Hard floor.
   */
  minInputFontPx: 16,
} as const;

/** The floor the whole product reflows to, with no horizontal page scroll. */
export const REFLOW = { minWidthPx: 360, allowHorizontalPageScroll: false } as const;
