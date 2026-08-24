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
  contrastRatio,
  parseColor,
  type Mode,
  type TokenName,
} from '@/styles/a11y-contract';

/** A token, a shell, and no data behind it. */
export const PROBE_ROUTE = '/e/a11y-probe/verify';

/**
 * Custom properties resolve to their *declared text* in `getComputedStyle`, so
 * `--tint-agency` comes back as the `color-mix()` expression rather than a
 * colour. Painting the value onto a throwaway element and reading `color` back
 * forces the browser to resolve it. This is the only reliable way to read a
 * token, and it is why this half cannot be done in Node.
 */
export async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    // `color-mix(in srgb, ...)` forces the result into sRGB before it is
    // serialised. Without it, a token produced by the white-label clamp comes
    // back as `oklch(0.388 0.053 180.6)` — the right colour in a form the
    // contract's own parser rejects. Reported to the design layer; coercing
    // here keeps the assertion about the *colour* rather than about which
    // colour space Chromium chose to print it in.
    probe.style.color = `color-mix(in srgb, var(${name}) 100%, transparent)`;
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    document.body.appendChild(probe);
    let value = getComputedStyle(probe).color;
    if (!/^rgba?\(/.test(value)) {
      // Older engines may ignore the mix. Canvas normalises anything CSS can
      // parse into an sRGB literal, and is the last resort rather than the
      // first because it silently accepts garbage.
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        value = ctx.fillStyle;
      }
    }
    probe.remove();
    return value;
  }, token);
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
      const el = document.querySelectorAll<HTMLElement>(selector)[i];
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

  const count = await page.locator(FOCUSABLE_SELECTOR).count();
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
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).tabIndex > 0).length);
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
  const moving = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('*'))
      .map((el) => {
        const s = getComputedStyle(el);
        const parse = (v: string) => v.split(',').map((x) => Number.parseFloat(x) || 0);
        const worst = Math.max(...parse(s.transitionDuration), ...parse(s.animationDuration));
        return worst > 0 ? `${el.tagName.toLowerCase()}.${el.className}` : null;
      })
      .filter((x): x is string => x !== null),
  );
  expect(moving, 'these still animate under prefers-reduced-motion').toEqual([]);
}

export async function assertNoInfiniteAnimation(page: Page): Promise<void> {
  const infinite = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) =>
        getComputedStyle(el).animationIterationCount.includes('infinite'),
      ).length,
  );
  expect(infinite, 'spinners, shimmer and pulsing dots do not exist in this product').toBe(0);
}

export async function assertOnlySanctionedKeyframes(page: Page): Promise<void> {
  const names = await page.evaluate(() =>
    Array.from(
      new Set(
        Array.from(document.querySelectorAll<HTMLElement>('*')).flatMap((el) =>
          getComputedStyle(el).animationName.split(',').map((n) => n.trim()),
        ),
      ),
    ),
  );
  for (const name of names) {
    expect(ALLOWED_ANIMATION_NAMES, `unexpected animation: ${name}`).toContain(name);
  }
}

export async function assertTargetsMeetTheFloor(page: Page, floorPx: number): Promise<void> {
  const boxes = await page
    .locator('button, a[href], input:not([type="hidden"]), [role="radio"]')
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, name: (el.textContent || el.tagName).trim().slice(0, 40) };
      }),
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
    .evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).fontSize)));
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
