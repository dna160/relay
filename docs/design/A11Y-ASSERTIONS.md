# Accessibility assertions — executable

> **For QA (directive U5 → Q5).** `docs/design/ACCESSIBILITY.md` is the
> specification. It is prose, and prose cannot fail CI, which is why two Phase
> EXIT conditions — *visible keyboard focus on every interactive element* and
> *`prefers-reduced-motion` respected* — are currently **UNPROVEN**.
>
> This document is the same floor as code you can lift into `tests/`. The
> design layer owns the numbers and keeps them in `src/styles/a11y-contract.ts`;
> QA owns the tests and imports from there. Nobody retypes a hex value.
>
> **Nothing in this file is written to `tests/` by the design layer.** `tests/**`
> is QA's. Copy what you need; adapt the fixtures to your helpers.

---

## What each suite proves

| Suite | Runs | Needs a server | Closes |
|---|---|---|---|
| §1 `tests/unit/a11y-contract.spec.ts` | vitest | **no** | The contrast floor, including the white-label band. Green today. |
| §2 `tests/e2e/*/a11y-tokens.spec.ts` | playwright | yes | That the *rendered page* resolves to the tokens §1 asserts about — the two halves are useless apart. |
| §3 `tests/e2e/*/a11y-focus.spec.ts` | playwright | yes | Visible keyboard focus on every interactive element. |
| §4 `tests/e2e/*/a11y-motion.spec.ts` | playwright | yes | `prefers-reduced-motion`. |
| §5 `tests/unit/a11y-source.spec.ts` | vitest | **no** | That nobody reintroduced `outline: none`. Green today. |
| §6 | playwright | yes | Targets, input font size, 360px reflow. |

§1 and §5 need no application at all. If you want the two UNPROVEN EXIT
conditions moved before Phase 4 finishes settling, start there.

**Playwright projects.** `playwright.config.ts` matches on directory
(`agency/**` → Desktop Chrome, `client/**` → Pixel 7), so an accessibility spec
has to live in one of those two directories or the config needs a third
project. Recommendation: put a copy in each, since the client surface is a
phone and the agency surface is not, and the two grounds genuinely differ. That
is a QA call — the config is yours.

---

## 1. Contrast — vitest, no browser

Every pair, both grounds, both modes, recomputed from the shipped hexes. This
is the assertion that would have caught `--muted` at 4.139:1.

```ts
// tests/unit/a11y-contract.spec.ts
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  MEASURED_TOLERANCE,
  TOKENS,
  contrastRatio,
  measurePair,
  HOSTILE_BRAND_VALUES,
  WHITE_LABEL_FLOOR,
} from '@/styles/a11y-contract';

describe('contrast floor', () => {
  for (const pair of CONTRAST_PAIRS) {
    it(`${pair.id} meets ${pair.min}:1 — ${pair.why}`, () => {
      const actual = measurePair(pair);

      // (a) the palette still clears the WCAG threshold
      expect(actual, `${pair.fg} on ${pair.bg} (${pair.mode})`).toBeGreaterThanOrEqual(pair.min);

      // (b) and it is still the value the design layer measured. This second
      //     assertion is the one that catches a token being edited without the
      //     contract being updated — a "still passes, but nobody looked" change.
      expect(actual).toBeCloseTo(pair.measured, 2);
      expect(Math.abs(actual - pair.measured)).toBeLessThan(MEASURED_TOLERANCE);
    });
  }

  it('every text token passes on --paper-2, not only --paper', () => {
    // --paper-2 is the ground cards sit on. A token asserted only against
    // --paper is how the old --muted survived review.
    const textPairs = CONTRAST_PAIRS.filter((p) => p.kind === 'text');
    const onPaper2 = textPairs.filter((p) => p.bg === '--paper-2').map((p) => p.fg);
    const onPaper = textPairs.filter((p) => p.bg === '--paper').map((p) => p.fg);
    for (const token of new Set(onPaper)) {
      expect(onPaper2, `${token} is asserted on --paper but not on --paper-2`).toContain(token);
    }
  });

  it('--rule is never treated as a control boundary', () => {
    for (const pair of CONTRAST_PAIRS.filter((p) => p.fg === '--rule')) {
      expect(pair.kind).toBe('decorative');
      expect(measurePair(pair)).toBeLessThan(3); // it cannot be one, by measurement
    }
  });
});

describe('the dark lift is per token, not flat', () => {
  // The design system published "+18%" and it does not survive --paper-2.
  // These are the two values that failed; asserting them keeps the correction
  // from being quietly reverted to a tidier-looking flat number.
  it('the +18 agency and breach values would have failed on --paper-2', () => {
    const paper2 = TOKENS.dark['--paper-2'];
    expect(contrastRatio('#399081', paper2)).toBeLessThan(4.5); // agency at +18
    expect(contrastRatio('#E1443D', paper2)).toBeLessThan(4.5); // breach at +18
  });

  it('the shipped +20 and +23 values clear it', () => {
    const paper2 = TOKENS.dark['--paper-2'];
    expect(contrastRatio(TOKENS.dark['--agency'], paper2)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(TOKENS.dark['--breach'], paper2)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the parser refuses to guess', () => {
  // A silent fallback to black would make every assertion above pass against a
  // colour nobody chose.
  it('throws on an unresolved custom property', () => {
    expect(() => contrastRatio('var(--ink)', '#fff')).toThrow(/unsupported colour form/);
  });
  it('throws on an unresolved color-mix', () => {
    expect(() => contrastRatio('color-mix(in srgb, red 12%, white)', '#fff')).toThrow();
  });
});
```

`HOSTILE_BRAND_VALUES` and `WHITE_LABEL_FLOOR` are imported for §2 — the clamp
is a browser computation and cannot be proven in Node.

---

## 2. The rendered page resolves to those tokens

§1 proves the palette is legible. It does not prove the application uses it.
This does, and the two are only worth something together.

```ts
// tests/e2e/agency/a11y-tokens.spec.ts   (and a client/ twin)
import { expect, test } from '@playwright/test';
import {
  BRAND_HOOK,
  BRAND_ROOT_SELECTOR,
  CONTRAST_PAIRS,
  HOSTILE_BRAND_VALUES,
  LOCKED_TOKENS,
  TOKENS,
  WHITE_LABEL_FLOOR,
  contrastRatio,
  parseColor,
} from '@/styles/a11y-contract';

/**
 * Custom properties resolve to their *declared text* in getComputedStyle, so
 * `--tint-agency` comes back as the color-mix() expression, not a colour.
 * Painting the value onto a throwaway element and reading `color` back forces
 * the browser to resolve it. This is the only reliable way to read a token.
 */
async function resolveToken(page: import('@playwright/test').Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

for (const mode of ['light', 'dark'] as const) {
  test.describe(`tokens — ${mode}`, () => {
    test.use({ colorScheme: mode });

    test('every token resolves to its shipped value', async ({ page }) => {
      await page.goto('/');
      for (const [token, expected] of Object.entries(TOKENS[mode])) {
        const actual = await resolveToken(page, token);
        expect(parseColor(actual), `${token} in ${mode}`).toEqual(parseColor(expected));
      }
    });

    test('every contrast pair holds against the live page', async ({ page }) => {
      await page.goto('/');
      for (const pair of CONTRAST_PAIRS.filter((p) => p.mode === mode && p.min > 0)) {
        const fg = await resolveToken(page, pair.fg);
        const bg = await resolveToken(page, pair.bg);
        expect(contrastRatio(fg, bg), pair.id).toBeGreaterThanOrEqual(pair.min);
      }
    });
  });
}

test.describe('white-label cannot break contrast', () => {
  for (const brand of HOSTILE_BRAND_VALUES) {
    test(`--agency stays legible when a tenant sets ${brand}`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate(
        ([selector, hook, value]) => {
          const root = document.querySelector(selector) ?? document.documentElement;
          (root as HTMLElement).style.setProperty(hook, value);
        },
        [BRAND_ROOT_SELECTOR, BRAND_HOOK, brand] as const,
      );

      const agency = await resolveToken(page, '--agency');
      for (const ground of ['--paper', '--paper-2'] as const) {
        const bg = await resolveToken(page, ground);
        expect(
          contrastRatio(agency, bg),
          `--agency on ${ground} with --brand-agency: ${brand}`,
        ).toBeGreaterThanOrEqual(WHITE_LABEL_FLOOR);
      }
    });
  }

  test('a tenant cannot move a locked token', async ({ page }) => {
    await page.goto('/');
    const before: Record<string, string> = {};
    for (const token of LOCKED_TOKENS) before[token] = await resolveToken(page, token);

    await page.evaluate(
      ([selector, tokens]) => {
        const root = (document.querySelector(selector) ?? document.documentElement) as HTMLElement;
        for (const token of tokens) root.style.setProperty(token, '#00ff00');
      },
      [BRAND_ROOT_SELECTOR, LOCKED_TOKENS as unknown as string[]] as const,
    );

    for (const token of LOCKED_TOKENS) {
      const after = await resolveToken(page, token);
      expect(parseColor(after), `${token} was themeable — the lock is broken`).toEqual(
        parseColor(before[token] as string),
      );
    }
  });
});
```

> **Depends on F3.** The lock's second mechanism anchors to
> `<body data-relay-root>`. The `?? document.documentElement` fallback above
> keeps the test meaningful before F3 lands, but once it has landed, drop the
> fallback and assert the element exists — a missing `data-relay-root` should
> fail loudly, not degrade quietly.

---

## 3. Visible focus — closes EXIT condition one

The assertion is not "an outline property is set". It is: **focus the control,
read the computed outline, and check it is a solid 2px ring at 2px offset that
contrasts at 3:1 against what the offset exposes.**

```ts
// tests/e2e/agency/a11y-focus.spec.ts   (and a client/ twin)
import { expect, test, type Page } from '@playwright/test';
import { FOCUSABLE_SELECTOR, FOCUS_RING, contrastRatio, parseColor } from '@/styles/a11y-contract';

const ROUTES = ['/', '/w', '/onboarding']; // QA: substitute the real route list

async function ringOf(page: Page, index: number) {
  return page.evaluate(
    ([selector, i]) => {
      const el = document.querySelectorAll<HTMLElement>(selector)[i as number];
      if (!el) return null;
      el.focus();
      const s = getComputedStyle(el);
      return {
        width: parseFloat(s.outlineWidth),
        offset: parseFloat(s.outlineOffset),
        style: s.outlineStyle,
        color: s.outlineColor,
        // what the 2px offset exposes: the nearest painted ancestor ground
        ground: (() => {
          let node: HTMLElement | null = el.parentElement;
          while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            node = node.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        })(),
        name: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
      };
    },
    [FOCUSABLE_SELECTOR, index] as const,
  );
}

for (const route of ROUTES) {
  test(`every interactive element on ${route} shows a visible ring`, async ({ page }) => {
    await page.goto(route);

    // Focus-visible needs keyboard intent. One Tab establishes it for the page;
    // .focus() alone can leave :focus-visible unmatched in Chromium.
    await page.keyboard.press('Tab');

    const count = await page.locator(FOCUSABLE_SELECTOR).count();
    expect(count, 'no interactive elements found — check the route').toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const ring = await ringOf(page, i);
      if (!ring) continue;

      expect(ring.style, `${ring.name}: outline-style`).toBe(FOCUS_RING.style);
      expect(ring.width, `${ring.name}: outline-width`).toBeGreaterThanOrEqual(FOCUS_RING.width);
      expect(ring.offset, `${ring.name}: outline-offset — the offset is what exposes the ground`)
        .toBeGreaterThanOrEqual(FOCUS_RING.offset);
      expect(
        contrastRatio(parseColor(ring.color), parseColor(ring.ground)),
        `${ring.name}: ring against the ground it sits on`,
      ).toBeGreaterThanOrEqual(FOCUS_RING.minContrast);
    }
  });
}

test('tab order follows DOM order and contains no positive tabindex', async ({ page }) => {
  await page.goto('/');
  const positive = await page.locator('[tabindex]').evaluateAll((els) =>
    els.filter((el) => Number((el as HTMLElement).tabIndex) > 0).length,
  );
  expect(positive, 'a positive tabindex exists; ACCESSIBILITY.md §4 forbids it').toBe(0);
});

test('a focused control is never covered by a sticky surface', async ({ page }) => {
  // WCAG 2.4.11. WrapSlate (z-slate) and the mobile DecisionBar are the two
  // sticky surfaces in the product.
  await page.goto('/');
  await page.keyboard.press('Tab');
  for (let i = 0; i < 30; i++) {
    const covered = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(top === el || el.contains(top) || (top?.contains(el) ?? false));
    });
    expect(covered, 'the focused element is obscured by a sticky surface').toBe(false);
    await page.keyboard.press('Tab');
  }
});
```

**The client skip link** — the highest-value single affordance in the product,
and one line to prove:

```ts
test('the first tab stop on a client card is the skip link', async ({ page }) => {
  await page.goto(CLIENT_CARD_URL);
  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toHaveText(/skip to the decision/i);
  await expect(first).toBeVisible();     // visually hidden UNTIL focused
  await first.press('Enter');
  await expect(page.locator(':focus')).toHaveAttribute('id', /decision/);
});
```

---

## 4. Reduced motion — closes EXIT condition two

Reduced motion is honoured at the **token**, so one assertion covers every
animation that exists. That is the design decision and this is what makes it
checkable.

```ts
// tests/e2e/agency/a11y-motion.spec.ts   (and a client/ twin)
import { expect, test } from '@playwright/test';
import { ALLOWED_ANIMATION_NAMES, MOTION } from '@/styles/a11y-contract';

async function durationToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    MOTION.durationToken,
  );
}

test.describe('no preference', () => {
  test.use({ reducedMotion: 'no-preference' });
  test(`--dur-chip is ${MOTION.normal}`, async ({ page }) => {
    await page.goto('/');
    expect(await durationToken(page)).toBe(MOTION.normal);
  });
});

test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test(`--dur-chip collapses to ${MOTION.reduced}`, async ({ page }) => {
    await page.goto('/');
    expect(await durationToken(page)).toBe(MOTION.reduced);
  });

  test('nothing on the page animates or transitions', async ({ page }) => {
    await page.goto('/');
    const moving = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('*'))
        .map((el) => {
          const s = getComputedStyle(el);
          const dur = (v: string) => v.split(',').map((x) => parseFloat(x) || 0);
          const worst = Math.max(...dur(s.transitionDuration), ...dur(s.animationDuration));
          return worst > 0
            ? `${el.tagName.toLowerCase()}.${el.className}: ${s.transitionDuration} / ${s.animationDuration}`
            : null;
        })
        .filter(Boolean),
    );
    expect(moving, 'these still animate under prefers-reduced-motion').toEqual([]);
  });

  test('no element animates infinitely, in either preference', async ({ page }) => {
    await page.goto('/');
    const infinite = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) =>
        getComputedStyle(el).animationIterationCount.includes('infinite'),
      ).length,
    );
    // Spinners, shimmer and pulsing dots do not exist in this product.
    expect(infinite).toBe(0);
  });
});

test('only the two sanctioned keyframes are used', async ({ page }) => {
  await page.goto('/');
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
});
```

---

## 5. `outline: none` never comes back — vitest, no browser

The single most common way a codebase loses its focus ring is one component
author suppressing it. Grep is sufficient and costs nothing.

```ts
// tests/unit/a11y-source.spec.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FORBIDDEN_CSS_SOURCE_PATTERNS } from '@/styles/a11y-contract';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|css)$/.test(p) ? [p] : [];
  });
}

it('nothing in src/ suppresses the focus ring', () => {
  const offenders: string[] = [];
  for (const file of walk('src')) {
    const source = readFileSync(file, 'utf8');
    for (const { pattern, why } of FORBIDDEN_CSS_SOURCE_PATTERNS) {
      if (source.includes(pattern)) offenders.push(`${file}: "${pattern}" — ${why}`);
    }
  }
  expect(offenders).toEqual([]);
});
```

If a component ever genuinely needs `outline: none` with an equally visible
replacement, the right move is an allowlist entry with the replacement named —
not deleting this test.

---

## 6. Targets, input font size, reflow

```ts
import { REFLOW, TARGETS } from '@/styles/a11y-contract';

test('every interactive target meets 24px, and client-facing ones 44px', async ({ page }) => {
  await page.goto(CLIENT_CARD_URL);
  const boxes = await page.locator('button, a[href], input, [role="radio"]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, name: (el.textContent ?? el.tagName).trim().slice(0, 40) };
    }),
  );
  for (const b of boxes.filter((b) => b.w > 0)) {
    expect(Math.min(b.w, b.h), `${b.name} is below the client-facing target floor`)
      .toBeGreaterThanOrEqual(TARGETS.clientFacingPx);
  }
});

test('no text input is below 16px — iOS zooms the viewport under it', async ({ page }) => {
  await page.goto(CLIENT_CARD_URL);
  const sizes = await page.locator('input, textarea').evaluateAll((els) =>
    els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
  );
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(TARGETS.minInputFontPx);
});

test(`the page does not scroll horizontally at ${REFLOW.minWidthPx}px`, async ({ page }) => {
  await page.setViewportSize({ width: REFLOW.minWidthPx, height: 800 });
  await page.goto(CLIENT_CARD_URL);
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows, 'the page scrolls horizontally at 360px; WCAG 1.4.10').toBe(
    REFLOW.allowHorizontalPageScroll,
  );
});
```

The board is the one horizontally scrolling *region* above 768px; the assertion
is on the document, not on the board.

---

## 7. What these do not prove

Stated so it is not assumed done:

- **Colour is not the only channel.** Section 3 of `ACCESSIBILITY.md` is a
  human judgement — render the board in greyscale and check nothing becomes
  ambiguous. An automated proxy exists (every possession hue must be
  accompanied by its mono word in the same element's accessible name) and is
  worth writing, but a green test there is weaker evidence than a person
  looking.
- **Screen-reader output.** The accessible names in `COMPONENTS.md` are
  specified. Playwright asserts the computed accessibility tree, not what
  VoiceOver actually says, and the two differ often enough to matter.
- **`<html lang>` and per-route `<title>`.** These live in
  `src/app/layout.tsx`, which the design layer does not own. Worth one
  assertion each; flagged here because they are the one AA requirement this
  layer cannot satisfy on its own.
- **axe.** Running `@axe-core/playwright` would be genuinely valuable and it is
  a new dependency, which needs an ADR and the Architect's approval. Everything
  in this document is deliberately written without one.
