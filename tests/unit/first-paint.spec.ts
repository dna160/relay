/**
 * NOTHING ANIMATES BEFORE HYDRATION — as a check rather than as prose.
 *
 * ## The defect this would have caught on the day it shipped
 *
 * `docs/design/MOTION.md` §5 forbids animating "the initial board render", and
 * §8 Claim 1 rests the whole FCP argument on it. Both were sentences in a
 * document. `Chip` shipped `animate-chip-in` unconditionally on its current
 * label, so every state chip on a server-rendered board faded in at first
 * paint. The document said one thing, the primitive did another, and **nothing
 * could tell** — a rule only a human could check, checked by nobody.
 *
 * That is the same shape as every other hole closed this build. The fix is not
 * to write the rule down more firmly.
 *
 * ## Why the bytes, and not the components
 *
 * Every animation in this product is triggered by a change, and a change is by
 * definition something that happened after the document was sent. So the claim
 * is exactly:
 *
 *   **the server-rendered HTML contains no `animate-` utility.**
 *
 * One assertion, no browser, no clock, no hydration. `renderToStaticMarkup` is
 * the server renderer — the same one Next uses to produce the first bytes — so
 * what is asserted here is the thing that actually crosses the wire, not a
 * source pattern standing in for it.
 *
 * ## Why the fix was not a prop
 *
 * UI/UX repaired `Chip` **without adding an `animateOnMount` prop**, and the
 * reasoning is worth keeping next to the test: a prop is a call-site opt-in,
 * which is the identical failure shape as the `motion-reduce:` variant this
 * suite already forbids. Every future call site can forget it, and nothing
 * fails when one does. The animation is instead conditional on there being a
 * *previous* label to replace — a fact the server cannot have, because nothing
 * has changed yet. The property holds by construction rather than by
 * remembering, which is why this file can assert it over defaults and be sure.
 */

import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIRST_PAINT } from '@/styles/a11y-contract';
import { linesMatching, sourceFiles, statementsMatching } from '../invariants/_source';
import { Badge } from '@/components/primitives/Badge';
import { Barcode } from '@/components/primitives/Barcode';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { ColourBar } from '@/components/primitives/ColourBar';
import { Mono } from '@/components/primitives/Mono';
import { Plate } from '@/components/primitives/Plate';
import { RegistrationMark } from '@/components/primitives/RegistrationMark';
import { Rule } from '@/components/primitives/Rule';
import { Row, Stack } from '@/components/primitives/Stack';

const ANIMATED = new RegExp(FIRST_PAINT.utilityPattern);

/**
 * Every primitive that can appear in a route's first bytes, at the props a
 * server render gives it — no prior state, nothing having changed yet.
 *
 * `Dialog` is absent and that exclusion is paid for by the last test in this
 * file. It carries `animate-sheet-in` unconditionally, which is correct for it
 * and would be a false positive here: a dialog is not part of first paint, and
 * flagging it would push someone towards a call-site opt-in — the exact shape
 * the `Chip` fix was careful to avoid.
 */
const FIRST_PAINT_SURFACE: readonly { name: string; file: string; element: ReactElement }[] = [
  // The defect itself. A state chip is on every card of a server-rendered board.
  { name: 'Chip', file: 'Chip.tsx', element: createElement(Chip, { label: 'State', children: 'Awaiting client' }) },
  { name: 'Chip (agency tone)', file: 'Chip.tsx', element: createElement(Chip, { tone: 'agency', children: 'In progress' }) },
  { name: 'Badge', file: 'Badge.tsx', element: createElement(Badge, { label: 'Lane', children: 'Private' }) },
  { name: 'Button', file: 'Button.tsx', element: createElement(Button, { children: 'Publish to client' }) },
  { name: 'Mono', file: 'Mono.tsx', element: createElement(Mono, { children: '3a91f2c7' }) },
  { name: 'Rule', file: 'Rule.tsx', element: createElement(Rule, {}) },
  { name: 'Stack', file: 'Stack.tsx', element: createElement(Stack, { children: 'a record' }) },
  { name: 'Row', file: 'Stack.tsx', element: createElement(Row, { children: 'a record' }) },
  { name: 'RegistrationMark', file: 'RegistrationMark.tsx', element: createElement(RegistrationMark, {}) },
  { name: 'Barcode', file: 'Barcode.tsx', element: createElement(Barcode, { value: '3A91F2C7', label: 'Digest' }) },
  {
    name: 'Plate',
    file: 'Plate.tsx',
    element: createElement(Plate, {
      label: 'Record',
      rows: [{ term: 'Digest', value: '3a91f2c7' }],
    }),
  },
  { name: 'ColourBar', file: 'ColourBar.tsx', element: createElement(ColourBar, { fill: 'agency' }) },
];

describe('nothing animates in the first bytes', () => {
  it('has a surface to render, so an empty sweep is not a pass', () => {
    // Every assertion below is a "must not match". If this list is emptied by
    // an edit, all of them pass and the rule is unguarded again.
    expect(FIRST_PAINT_SURFACE.length).toBeGreaterThan(8);
  });

  for (const { name, element } of FIRST_PAINT_SURFACE) {
    it(`${name} server-renders with no animate- utility`, () => {
      const html = renderToStaticMarkup(element);
      expect(html.length, `${name} rendered nothing; this case proves nothing`).toBeGreaterThan(0);
      const match = ANIMATED.exec(html);
      expect(
        match?.[0] ?? null,
        `${name} carries an entrance animation on a document nobody has interacted ` +
          'with yet. MOTION.md §5 forbids animating the initial render, and §8 Claim 1 ' +
          'rests the FCP argument on it. A component that genuinely must animate an ' +
          'element the server rendered has misunderstood the system: make the element ' +
          'new when the event happens, and the animation runs from zero on an element ' +
          'that did not exist at first paint.',
      ).toBeNull();
    });
  }

  it('the pattern matches real markup, so a clean render means something', () => {
    // The negative control, and it is not decoration: `utilityPattern` is a
    // string in a contract module, lifted into a `RegExp` here. If it ever
    // stopped matching, every case above would pass against a board that fades
    // in on load and nothing would say so.
    const planted = renderToStaticMarkup(
      createElement('span', { className: 'inline-block animate-chip-in' }, 'Approved'),
    );
    expect(ANIMATED.test(planted), 'FIRST_PAINT.utilityPattern no longer matches').toBe(true);

    // And it is specific: the word "animate" in prose or in a data attribute is
    // not a utility class, and flagging one would get the gate relaxed.
    expect(
      ANIMATED.test(renderToStaticMarkup(createElement('span', {}, 'animate-chip-in'))),
      'the pattern matches text content, not just class attributes',
    ).toBe(false);
  });

  it('keeps the allowlist empty', () => {
    // An entry here is a component claiming an entrance on a document nobody
    // has interacted with yet. The contract says it should stay empty; this is
    // what makes that a check rather than a comment.
    expect(FIRST_PAINT.allowedInServerMarkup).toEqual([]);
  });
});

describe('the exclusion this file makes is paid for', () => {
  it('every primitive that can animate is either rendered above or excused', () => {
    // The payment for leaving `Dialog` out of the surface, and the assertion
    // that makes the hand-maintained list above safe to hand-maintain.
    //
    // The first attempt here tried to decide *from the source* whether an
    // `animate-` class was conditional. It cannot be done honestly at either
    // granularity: `statements()` collapses a whole JSX element, so a
    // `<dialog>` with an unconditional `animate-sheet-in` also contains a
    // `? :` twenty lines away and reads as conditional; and line-by-line it
    // flags `Chip`'s outgoing label, whose `animate-chip-out` sits on an
    // element that only exists *because* a label is being replaced — correct,
    // and invisible to any pattern.
    //
    // So it does not guess. Every primitive containing an `animate-` utility
    // must either be in `FIRST_PAINT_SURFACE`, where it is actually rendered
    // and proved clean, or be named below as not part of first paint. Nothing
    // gets to be in neither, which is the only property that matters — and it
    // holds however the class is written.
    const NOT_FIRST_PAINT: readonly string[] = [
      // A dialog animates because it was opened. It is never in a route's
      // first bytes, which the case below is what actually establishes.
      'src/components/primitives/Dialog.tsx',
    ];

    const rendered = new Set(
      FIRST_PAINT_SURFACE.map((s) => `src/components/primitives/${s.file}`),
    );
    const canAnimate = sourceFiles('components/primitives')
      .filter((f) => linesMatching(f, /animate-[a-z-]/).length > 0)
      .map((f) => f.path);

    expect(
      canAnimate.length,
      'no primitive contains an animate- utility at all, so this case is iterating ' +
        'an empty set and cannot fail',
    ).toBeGreaterThan(1);

    const unaccounted = canAnimate.filter(
      (path) => !rendered.has(path) && !NOT_FIRST_PAINT.includes(path),
    );
    expect(
      unaccounted,
      'a primitive can apply an animate- utility and is neither server-rendered by ' +
        'this file nor declared as not-first-paint. Add it to FIRST_PAINT_SURFACE — ' +
        'if it renders clean, that is the proof; if it does not, that is the Chip ' +
        'defect again, and the fix is to gate it on a change having happened rather ' +
        'than on a prop every call site can forget.',
    ).toEqual([]);

    // And the exclusion list may not name a primitive that has stopped
    // animating: a spent exemption is a standing permission for whatever lands
    // in that file next. Same rule as the a11y allowlist.
    const spent = NOT_FIRST_PAINT.filter((path) => !canAnimate.includes(path));
    expect(spent, 'an excused primitive no longer animates; remove it').toEqual([]);
  });

  it('a Dialog is never rendered unconditionally by a product component', () => {
    // The other half of the payment. `Dialog` is excused because it is not part
    // of first paint, and that is only true while every call site mounts it
    // behind a condition.
    const offenders: string[] = [];
    for (const file of [...sourceFiles('components'), ...sourceFiles('app')]) {
      if (file.path.startsWith('src/components/primitives/')) continue;
      for (const stmt of statementsMatching(file, /<Dialog\b/)) {
        if (/&&|\?|open=\{/.test(stmt)) continue;
        offenders.push(`${file.path}: ${stmt.slice(0, 120)}`);
      }
    }
    expect(
      offenders,
      'a Dialog is mounted unconditionally, so its entrance animation reaches the ' +
        'first bytes and its exclusion from the first-paint surface no longer holds.',
    ).toEqual([]);
  });
});
