/**
 * The browser half of the accessibility floor.
 *
 * `tests/unit/a11y-contract.spec.ts` proves the palette is legible and that
 * `globals.css` declares it. It cannot prove the rendered page *resolves* to it:
 * `color-mix()` and the OKLCH white-label clamp are browser computations, and a
 * stylesheet that never loads passes every source scan ever written. Those two
 * halves are only worth something together.
 *
 * These assertions are shared by both Playwright projects. `playwright.config.ts`
 * splits by directory — `agency/**` at Desktop Chrome, `client/**` at Pixel 7 —
 * and the design layer's recommendation (A11Y-ASSERTIONS.md §"Playwright
 * projects") was to run a copy in each, because a phone and a desktop are
 * genuinely different grounds. That is what the two thin spec files do.
 *
 * THE PROBE ROUTE. Everything here runs against `/e/<token>/verify`, which is
 * the one route in the product that renders the full shell — root layout,
 * `globals.css`, `[data-relay-root]`, real `Field` and `Button` primitives —
 * while touching no database and needing no session. That matters: it means the
 * two Phase 8 EXIT conditions this file closes do **not** wait on the test-only
 * seed endpoints, and stay closed even while the rest of the e2e suite is red.
 * An agency-directory spec navigating to it is deliberate; the assertions are
 * about the shell, not about the audience, and no route-audience claim is made
 * here (that is `invite-verify-approve.spec.ts`'s job, with `RouteRecorder`).
 */

import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import {
  ALLOWED_ANIMATION_NAMES,
  BRAND_HOOK,
  BRAND_ROOT_SELECTOR,
  CONTRAST_PAIRS,
  FOCUSABLE_SELECTOR,
  FOCUS_RING,
  HOSTILE_BRAND_VALUES,
  LOCKED_TOKENS,
  MOTION,
  REFLOW,
  TARGETS,
  TOKENS,
  UNTENANTED_AGENCY,
  contrastRatio,
  parseColor,
  type Mode,
  type TokenName,
} from '@/styles/a11y-contract';

/**
 * A token, a shell, and no data behind it.
 *
 * The token has to carry a **real signature** now. `/e/[token]/layout.tsx`
 * calls `checkClientPathToken`, and a segment that does not parse is a 404 —
 * which is the product behaving correctly (`src/lib/auth.ts`: the landing page
 * is where a stranger arrives, and "this is not a link" is the true answer). So
 * the probe moved rather than the rule.
 *
 * The engagement id it names does not exist and does not need to. The verify
 * page renders a form and nothing else, and the layout's board read fails the
 * way it fails for every unverified reader — children rendered bare. This suite
 * therefore keeps the property it was built for: **it touches no database and
 * waits on no seed endpoint**, which is what lets the accessibility floor stay
 * checkable while the rest of the e2e suite is red.
 *
 * The HMAC is restated here rather than imported. `engagementToken()` lives in
 * `src/lib/auth.ts` next to `next-auth` and `next/headers`, neither of which
 * loads under Playwright's ESM loader. If the derivation in `auth.ts` ever
 * moves, this probe 404s and every assertion in both a11y suites fails at
 * `assertShellLoaded` — loudly, and naming the route.
 */
const PROBE_ENGAGEMENT = '00000000-0000-7000-8000-0000a11a11ce';

function probeToken(): string {
  const secret = process.env.CLIENT_LINK_SECRET;
  if (!secret) {
    throw new Error(
      'CLIENT_LINK_SECRET is not set; the a11y probe route needs it to mint a parseable ' +
        'client link token. See PROBE_ROUTE in tests/e2e/_a11y.ts.',
    );
  }
  const signature = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`engagement:${PROBE_ENGAGEMENT}`)
    .digest('base64url');
  return `${PROBE_ENGAGEMENT}.${signature}`;
}

export const PROBE_ROUTE = `/e/${probeToken()}/verify`;

/**
 * Chrome the dev server injects, which is not the product.
 *
 * `next dev` mounts a Dev Tools launcher into the page — a 32px button, below
 * every target floor this suite asserts. It cost a false "the client surface
 * misses its 44px floor" before it was noticed, which is the worse failure
 * mode: an accessibility suite that cries wolf gets its floor lowered rather
 * than its bug fixed.
 *
 * Excluded by ancestry rather than by size, so a genuinely undersized control
 * still fails. The whole sweep would be more faithful against `next build &&
 * next start`, where none of this exists — noted in `docs/state/VERIFICATION.md`.
 */
export const INJECTED_CHROME = 'nextjs-portal, [data-nextjs-dialog], [data-nextjs-toast], #__next-build-watcher';

/**
 * Custom properties resolve to their *declared text* in `getComputedStyle`, so
 * `--tint-agency` comes back as the `color-mix()` expression rather than a
 * colour. Painting the value onto a throwaway element and reading `color` back
 * forces the browser to resolve it. This is the only reliable way to read a
 * token, and it is why this half cannot be done in Node.
 */
export async function resolveToken(page: Page, token: string): Promise<string> {
  const value = await page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();

    /**
     * The computed value is the right colour in whatever space the engine chose
     * to print it in — and for anything the white-label clamp produced, that is
     * `oklch(0.388 0.053 180.6)`, which the contract's parser rejects. Neither
     * `color-mix(in srgb, …)` nor a canvas `fillStyle` round-trip fixes it:
     * both keep the wider space and serialise as `color(srgb …)`.
     *
     * So rasterise. Painting one pixel into an sRGB canvas and reading the byte
     * values back is the one conversion the browser cannot answer in another
     * colour space, and it is exactly the number a human eye would receive.
     */
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!ctx) return computed;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = computed;
    // fillStyle silently keeps its previous value on an unparseable input, so a
    // colour that really is black is indistinguishable from a rejected one.
    // Paint it and compare against the same probe painted on white instead.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, token);
  return value;
}

/**
 * `getPropertyValue` returns whatever the engine serialised the declaration to,
 * and Chromium prints `120ms` as `.12s`. Comparing the *duration* rather than
 * the string keeps the assertion about the motion budget instead of about CSS
 * serialisation. Reported to the design layer: `MOTION.normal` is documented as
 * a computed value and is not one.
 */
export function durationMs(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
  if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
  return Number.parseFloat(trimmed);
}

/**
 * The same probe, but hosted inside a named element.
 *
 * `resolveToken` reads at `<body>`, which is the right default — it is where
 * the tenant hook lives and where every component sits. This variant exists to
 * read the *same* token at `<html>` and compare, because the round-2 theme
 * defect was exactly a disagreement between those two elements: `data-theme`
 * lives on `<html>`, `data-relay-root` on `<body>`, and a rule that reads the
 * attribute off the wrong one decides the theme from the wrong element.
 */
export async function resolveTokenIn(
  page: Page,
  token: string,
  host: 'html' | 'body',
): Promise<string> {
  return page.evaluate(
    ([name, where]) => {
      const parent = where === 'html' ? document.documentElement : document.body;
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      probe.style.position = 'absolute';
      probe.style.opacity = '0';
      parent.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!ctx) return computed;
      ctx.fillStyle = '#000000';
      ctx.fillStyle = computed;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    },
    [token, host] as const,
  );
}

/** Sets, or clears, the explicit theme choice. It lives on `<html>`. */
export async function setTheme(page: Page, choice: Mode | null): Promise<void> {
  await page.evaluate((value) => {
    if (value === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
  }, choice);
}

/**
 * The untenanted `--agency` is the **published** colour, exactly.
 *
 * A ratio assertion cannot make this claim. When the clamp swallowed the
 * default, dark `--agency` painted rgb(0, 163, 144) against a published
 * #499D8F — 5.690:1 versus 5.571:1, both comfortably over 4.5, and every
 * contrast check in this suite passed against a colour the product did not
 * paint. Exact value or nothing.
 */
export async function assertUntenantedAgency(page: Page, mode: Mode): Promise<void> {
  await setTheme(page, mode);

  const hook = await page.evaluate(
    (selector) => {
      const root = document.querySelector(selector);
      return root instanceof HTMLElement
        ? getComputedStyle(root).getPropertyValue('--brand-agency').trim()
        : 'NO ROOT';
    },
    BRAND_ROOT_SELECTOR,
  );
  expect(
    hook,
    'a tenant hook is declared on the shipped stylesheet, so this is not the untenanted state ' +
      'and the assertion below would be measuring a tenanted colour',
  ).toBe('');

  const painted = await resolveToken(page, '--agency');
  expect(
    parseColor(painted),
    `the default --agency is computed rather than published. The contract records ` +
      `${UNTENANTED_AGENCY[mode]} for ${mode}; the browser paints ${painted}. Check that ` +
      '--brand-agency is still undeclared and that the clamp only reaches --agency-tenant.',
  ).toEqual(parseColor(UNTENANTED_AGENCY[mode]));
}

/**
 * The same trap one layer down: the tints are `color-mix()` of `--agency`, so a
 * drifted hue drifts them too and every recorded tint hex becomes fiction.
 */
export async function assertUntenantedTint(page: Page, mode: Mode): Promise<void> {
  await setTheme(page, mode);
  const painted = await resolveToken(page, '--tint-agency');
  expect(parseColor(painted), `--tint-agency in ${mode} is mixed from a computed --agency`).toEqual(
    parseColor(TOKENS[mode]['--tint-agency']),
  );
}

/**
 * An explicit choice beats the system preference — read at `<body>`.
 *
 * This is the round-2 defect stated as a test. A reader on a dark system who
 * chose light was still served dark, because the dark rule was satisfied by any
 * element without `data-theme` and `<body>` never has it. Both palettes were
 * internally valid, so no colour assertion could see it; only asking "which
 * palette did <body> actually get, given a choice that disagrees with the
 * system" can.
 */
export async function assertExplicitThemeWins(page: Page, choice: Mode): Promise<void> {
  await setTheme(page, choice);
  for (const token of ['--ink', '--paper', '--paper-2'] as const) {
    const painted = await resolveTokenIn(page, token, 'body');
    expect(
      parseColor(painted),
      `${token} at <body> with data-theme="${choice}" on <html>. The reader made a choice and ` +
        'the element their content is rendered in did not receive it.',
    ).toEqual(parseColor(TOKENS[choice][token]));
  }
}

/** `<html>` and `<body>` must resolve the same palette, whatever the theme. */
export async function assertRootAndBodyAgree(page: Page, choice: Mode | null): Promise<void> {
  await setTheme(page, choice);
  for (const token of ['--ink', '--paper', '--paper-2', '--agency'] as const) {
    const atRoot = await resolveTokenIn(page, token, 'html');
    const atBody = await resolveTokenIn(page, token, 'body');
    expect(
      parseColor(atBody),
      `${token} resolves differently at <html> and at <body> (data-theme=${choice ?? 'unset'}). ` +
        'One of the two theme selectors is reading the attribute off the wrong element.',
    ).toEqual(parseColor(atRoot));
  }
}

export async function assertShellLoaded(page: Page): Promise<void> {
  await expect(
    page.locator(BRAND_ROOT_SELECTOR),
    'the white-label lock anchors to [data-relay-root]; without it the lock is ' +
      'inert and an inline tenant style wins',
  ).toHaveCount(1);
  const ink = await resolveToken(page, '--ink');
  expect(
    () => parseColor(ink),
    'the token layer did not resolve — globals.css did not load, and every ' +
      'assertion below would have passed against a browser default',
  ).not.toThrow();
}

export async function assertTokensResolve(page: Page, mode: Mode): Promise<void> {
  for (const [token, expected] of Object.entries(TOKENS[mode])) {
    const actual = await resolveToken(page, token);
    expect(parseColor(actual), `${token} in ${mode}`).toEqual(parseColor(expected));
  }
}

export async function assertContrastOnLivePage(page: Page, mode: Mode): Promise<void> {
  for (const pair of CONTRAST_PAIRS.filter((p) => p.mode === mode && p.min > 0)) {
    const fg = await resolveToken(page, pair.fg);
    const bg = await resolveToken(page, pair.bg);
    expect(contrastRatio(fg, bg), pair.id).toBeGreaterThanOrEqual(pair.min);
  }
}

/** Sets the one tenant hook, the way a white-labelled deployment does. */
export async function setBrand(page: Page, value: string): Promise<void> {
  await page.evaluate(
    ([selector, hook, brand]) => {
      const root = document.querySelector(selector);
      if (!(root instanceof HTMLElement)) throw new Error(`no element matches ${selector}`);
      root.style.setProperty(hook, brand);
    },
    [BRAND_ROOT_SELECTOR, BRAND_HOOK, value] as const,
  );
}

export async function assertBrandCannotBreakContrast(page: Page, brand: string): Promise<void> {
  await setBrand(page, brand);
  const agency = await resolveToken(page, '--agency');
  for (const ground of ['--paper', '--paper-2'] as const) {
    const bg = await resolveToken(page, ground);
    expect(
      contrastRatio(agency, bg),
      `--agency on ${ground} with ${BRAND_HOOK}: ${brand}. The OKLCH clamp is what ` +
        'stops a tenant making possession illegible; if this fails the clamp is gone.',
    ).toBeGreaterThanOrEqual(4.5);
  }
}

export const HOSTILE_BRANDS = HOSTILE_BRAND_VALUES;

export async function assertLockedTokensAreLocked(page: Page): Promise<void> {
  const before: Partial<Record<TokenName, string>> = {};
  for (const token of LOCKED_TOKENS) before[token] = await resolveToken(page, token);

  await page.evaluate(
    ([selector, tokens]) => {
      const root = document.querySelector(selector);
      if (!(root instanceof HTMLElement)) throw new Error(`no element matches ${selector}`);
      for (const token of tokens) root.style.setProperty(token, '#00ff00');
    },
    [BRAND_ROOT_SELECTOR, [...LOCKED_TOKENS]] as const,
  );

  for (const token of LOCKED_TOKENS) {
    const after = await resolveToken(page, token);
    expect(
      parseColor(after),
      `${token} moved when a tenant set it inline. A tenant cannot be able to theme ` +
        'away a breach warning; the !important declarations on both :root and the ' +
        'hook element are what make that true.',
    ).toEqual(parseColor(before[token] ?? '#000000'));
  }
}

interface Ring {
  width: number;
  offset: number;
  style: string;
  color: string;
  ground: string;
  name: string;
}

async function ringOf(page: Page, index: number): Promise<Ring | null> {
  return page.evaluate(
    ([selector, i]) => {
      const all = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
        (candidate) =>
          !candidate.closest(
            'nextjs-portal, [data-nextjs-dialog], [data-nextjs-toast], #__next-build-watcher',
          ),
      );
      const el = all[i];
      if (!el) return null;
      el.focus();
      const s = getComputedStyle(el);
      let node: HTMLElement | null = el.parentElement;
      let ground = getComputedStyle(document.body).backgroundColor;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          ground = bg;
          break;
        }
        node = node.parentElement;
      }
      return {
        width: Number.parseFloat(s.outlineWidth),
        offset: Number.parseFloat(s.outlineOffset),
        style: s.outlineStyle,
        color: s.outlineColor,
        ground,
        name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
      };
    },
    [FOCUSABLE_SELECTOR, index] as const,
  );
}

export async function assertEveryControlShowsARing(page: Page): Promise<void> {
  // :focus-visible needs keyboard intent. One Tab establishes it for the page;
  // .focus() alone can leave the pseudo-class unmatched in Chromium.
  await page.keyboard.press('Tab');

  const count = await page
    .locator(FOCUSABLE_SELECTOR)
    .evaluateAll((els, chrome) => els.filter((el) => !el.closest(chrome)).length, INJECTED_CHROME);
  expect(
    count,
    'no interactive elements on the probe route — the page did not render, and a ' +
      'sweep over nothing is not a pass',
  ).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const ring = await ringOf(page, i);
    if (!ring) continue;
    expect(ring.style, `${ring.name}: outline-style`).toBe(FOCUS_RING.style);
    expect(ring.width, `${ring.name}: outline-width`).toBeGreaterThanOrEqual(FOCUS_RING.width);
    expect(
      ring.offset,
      `${ring.name}: outline-offset. The offset is what exposes the page ground on ` +
        'both sides of the ring; without it an ink ring on an --agency fill measures 1.92:1.',
    ).toBeGreaterThanOrEqual(FOCUS_RING.offset);
    expect(
      contrastRatio(parseColor(ring.color), parseColor(ring.ground)),
      `${ring.name}: the ring against the ground it sits on`,
    ).toBeGreaterThanOrEqual(FOCUS_RING.minContrast);
  }
}

export async function assertNoPositiveTabindex(page: Page): Promise<void> {
  const positive = await page
    .locator('[tabindex]')
    .evaluateAll(
      (els, chrome) =>
        els.filter((el) => !el.closest(chrome) && (el as HTMLElement).tabIndex > 0).length,
      INJECTED_CHROME,
    );
  expect(positive, 'ACCESSIBILITY.md §4: no tabindex above 0 exists in this codebase').toBe(0);
}

export async function assertFocusIsNeverObscured(page: Page, steps = 20): Promise<void> {
  await page.keyboard.press('Tab');
  for (let i = 0; i < steps; i += 1) {
    const covered = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = top === el || el.contains(top) || (top?.contains(el) ?? false);
      return ok ? null : `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    });
    expect(covered, 'WCAG 2.4.11 — a sticky surface is covering the focused control').toBeNull();
    await page.keyboard.press('Tab');
  }
}

export async function durationToken(page: Page): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    MOTION.durationToken,
  );
}

export async function assertNothingMoves(page: Page): Promise<void> {
  const moving = await page.evaluate((chrome) =>
    Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter((el) => !el.closest(chrome))
      .map((el) => {
        const s = getComputedStyle(el);
        const parse = (v: string) => v.split(',').map((x) => Number.parseFloat(x) || 0);
        const worst = Math.max(...parse(s.transitionDuration), ...parse(s.animationDuration));
        return worst > 0 ? `${el.tagName.toLowerCase()}.${el.className}` : null;
      })
      .filter((x): x is string => x !== null),
  INJECTED_CHROME);
  expect(moving, 'these still animate under prefers-reduced-motion').toEqual([]);
}

export async function assertNoInfiniteAnimation(page: Page): Promise<void> {
  const infinite = await page.evaluate(
    (chrome) =>
      Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
        (el) =>
          !el.closest(chrome) &&
          getComputedStyle(el).animationIterationCount.includes('infinite'),
      ).length,
    INJECTED_CHROME,
  );
  expect(infinite, 'spinners, shimmer and pulsing dots do not exist in this product').toBe(0);
}

export async function assertOnlySanctionedKeyframes(page: Page): Promise<void> {
  const names = await page.evaluate(
    (chrome) =>
      Array.from(
        new Set(
          Array.from(document.querySelectorAll<HTMLElement>('*'))
            .filter((el) => !el.closest(chrome))
            .flatMap((el) => getComputedStyle(el).animationName.split(',').map((n) => n.trim())),
        ),
      ),
    INJECTED_CHROME,
  );
  for (const name of names) {
    expect(ALLOWED_ANIMATION_NAMES, `unexpected animation: ${name}`).toContain(name);
  }
}

export async function assertTargetsMeetTheFloor(page: Page, floorPx: number): Promise<void> {
  const boxes = await page
    .locator('button, a[href], input:not([type="hidden"]), [role="radio"]')
    .evaluateAll(
      (els, chrome) =>
        els
          .filter((el) => !el.closest(chrome))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              w: r.width,
              h: r.height,
              name: (el.textContent || el.tagName).trim().slice(0, 40),
            };
          }),
      INJECTED_CHROME,
    );
  const visible = boxes.filter((b) => b.w > 0 && b.h > 0);
  expect(visible.length, 'no visible controls to measure').toBeGreaterThan(0);
  for (const box of visible) {
    expect(Math.min(box.w, box.h), `${box.name} is below the ${floorPx}px target floor`)
      .toBeGreaterThanOrEqual(floorPx);
  }
}

export async function assertInputsAreNotZoomBait(page: Page): Promise<void> {
  const sizes = await page
    .locator('input:not([type="hidden"]), textarea')
    .evaluateAll(
      (els, chrome) =>
        els
          .filter((el) => !el.closest(chrome))
          .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
      INJECTED_CHROME,
    );
  for (const size of sizes) {
    expect(
      size,
      `a text input below ${TARGETS.minInputFontPx}px — iOS Safari zooms the viewport ` +
        'on focus, which on the decision bar throws the note field out from under the keyboard',
    ).toBeGreaterThanOrEqual(TARGETS.minInputFontPx);
  }
}

export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, `WCAG 1.4.10 — the page scrolls horizontally at ${REFLOW.minWidthPx}px`).toBe(
    REFLOW.allowHorizontalPageScroll,
  );
}
