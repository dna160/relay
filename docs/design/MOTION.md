# Motion

> Owned by the design layer. The token layer is `src/app/globals.css` §5 and
> `tailwind.config.ts`; the machine-readable half is §6 of
> `src/styles/a11y-contract.ts`. Component-level choreography is implemented by
> the front-end against this document.

## 1. The argument

Round 1 permitted exactly one animation: a 120ms state-chip crossfade. That was
a defensible position for a product whose subject is production paperwork, and
it is no longer the position. The direction is a spec-label world with the
liveliness of a game interface — *"a level of animation fidelity like attaching
labels"*.

Persona's interface feels alive because its motion is **diegetic**: it is the
game expressing its own confidence and rhythm, not a layer of polish applied on
top. Copying its exuberance would give Relay a busy interface. Copying its
*method* gives Relay a motion system, and the method is: motion expresses the
thing the product is about.

Relay is about **possession**. A card moving from the agency to the client is
the central event of the product; everything else on the board is bookkeeping
around it. So:

> **Motion in Relay is the application of a mark.** Something is struck, seated
> and stamped onto the document, and afterwards the mark is part of the
> document. Nothing drifts, nothing floats, nothing loops.

Three consequences follow, and they are the whole system:

1. **If it is not an event, it does not move.** A lane re-sorting is not an
   event. A hover is not an event. A countdown ticking is not an event. §5.
2. **Every animation ends at the resting state.** The motion reveals a mark; it
   does not create one. This is what makes reduced motion honest rather than
   broken — see §7.
3. **Weight is proportional to consequence.** Possession changing hands gets
   five beats. A dialog gets three. A button under a finger gets one. Nothing
   in this product deserves more than five.

## 2. The tokens

### The beat, and why there is exactly one duration token

```css
--dur-beat: 60ms;
```

Every duration in Relay is an integer number of beats, written as a `calc()`
over that token and never as a literal. `--time-chip` is not `120ms`; it is
`calc(var(--dur-beat) * 2)`.

This is not tidiness. It is the mechanism that keeps the round-1 accessibility
guarantee intact while the amount of motion grows by a factor of eight:
**reduced motion is honoured at the token, so one declaration silences the
entire system**, arithmetically, and no component can forget to opt in. It is
also why `tests/unit/a11y-source.spec.ts` may keep asserting that exactly one
`--dur-*` token exists in `globals.css`. That assertion was read in round 1 as
a budget on how much motion there is. It is not — it is a proof that there is
one switch. It survives round 3 unchanged and unrelaxed.

60ms was chosen so that the published 120ms crossfade survives exactly as two
beats — the animation that shipped is byte-for-byte the animation that ships —
and so that the shortest useful interval, a stagger step, is half a beat rather
than an unreadable fraction.

### The ladder

| Token | Beats | Normal | Governs |
|---|---|---|---|
| `--time-tick` | 1 | 60ms | a control under the finger; a colour step |
| `--time-chip` | 2 | 120ms | the state-chip crossfade |
| `--time-strike` | 2 | 120ms | phase 1 of the label-attach |
| `--time-stamp` | 2 | 120ms | a mark being applied |
| `--time-seat` | 3 | 180ms | phase 2 of the label-attach; a record seating |
| `--time-sheet` | 3 | 180ms | a dialog laid on the desk |
| `--time-step` | 0.5 | 30ms | the stagger interval |
| `--time-attach` | 5 | 300ms | `--time-strike + --time-seat`, the signature |

Mirrored as `BEATS` in `a11y-contract.ts`, so QA can assert every one of them
resolves to `beats × 60ms` normally and to `0ms` under reduce, and that the
stylesheet declares each as a `calc()` over `MOTION.durationToken`.

### The easings

Named for what the motion is doing, never for a curve family.

| Token | Curve | Reads as |
|---|---|---|
| `--ease-chip` | `cubic-bezier(0.2, 0, 0, 1)` | a value replacing a value. Unchanged from round 1. |
| `--ease-strike` | `cubic-bezier(0.7, 0, 0.84, 0)` | **accelerating.** A label is thrown at the surface; it does not drift in. |
| `--ease-seat` | `cubic-bezier(0.16, 1, 0.3, 1)` | **hard decelerate.** Arrival against a physical stop. No bounce. |
| `--ease-stamp` | `cubic-bezier(0.34, 1.28, 0.64, 1)` | one overshoot and out. The impact of a stamp, not a spring. |

`--ease-strike` is the unusual one and it is the reason the attach feels
applied rather than animated. Almost every interface easing decelerates,
because almost every interface motion is a thing arriving politely. A label
being struck onto a docket does the opposite: it is slow for a moment and then
it is *there*. Reversing the curve is most of the effect.

### The amplitudes

| Token | Normal | Under reduce | Is |
|---|---|---|---|
| `--dist-strike` | `10px` | `0px` | how far off its seat a label starts |
| `--dist-seat` | `2px` | `0px` | the overshoot it settles back through |
| `--dist-nudge` | `1px` | `0px` | a control under the finger |
| `--scale-stamp` | `1.06` | `1` | a mark's impact scale |
| `--tilt-strike` | `-0.6deg` | `0deg` | a label is never applied perfectly square |

The tilt is small on purpose. It is the difference between a label placed by a
machine and a label placed by a person, and at 0.6° a reader will not name it
but will feel the interface is not a spreadsheet. It resolves to exactly 0° at
100% of every keyframe, so nothing ever comes to rest off-square and no text is
left rendering on a rotated layer.

The amplitudes are tokens for the same reason the durations are: the
reduced-motion query zeroes them too, so a transition that somehow fires with a
literal duration still has nowhere to travel.

## 3. Orchestration and rhythm

Persona's liveliness is largely rhythm, and rhythm is what separates an alive
interface from a busy one. Relay's rhythm has three rules.

**R1 — One event, one motion.** An event animates in exactly one place: the
place where the fact changed. A possession change animates the possession bar
and the state chip; it does not animate the card, the lane, the counter, the
board. If a reader's eye has to choose where to look, the motion has failed at
the thing it was for.

**R2 — Stagger is for lists, not for events.** A single event never staggers.
A *list* that gains items at once — a version stack after an upload, an
attention list on first render after hydration — staggers by half a beat per
item, capped:

```css
animation-delay: calc(min(var(--stagger-index), var(--stagger-cap)) * var(--time-step));
```

Exposed as the `.stagger` class. The call site sets `--stagger-index` and
nothing else:

```tsx
<li className="animate-seat stagger" style={{ '--stagger-index': i }}>
```

`--stagger-cap` is **6**. Beyond the sixth item no further delay accrues, so a
lane of forty cards finishes in 180ms of stagger rather than 1.2 seconds of
wave. An uncapped stagger is the single most common way a tasteful entrance
becomes a loading screen.

**R3 — Phases inside one event are sequenced, not simultaneous.** The
label-attach is strike → seat, and the bar-draw starts on the beat the strike
lands (`animation-delay: var(--time-strike)`). The impact happens *inside* the
settle. That overlap is what makes it read as one physical action rather than
two animations that happened to fire together.

## 4. The signature moment — the label-attach

**When it plays.** Exactly one trigger: **possession changes hands.** A card
that was the agency's becomes the client's, or the reverse. Not a state change
within a possession. Not a version publish. Not a card being created. If
`possession` is the same before and after, this animation does not run.

**What plays.** Two elements, one gesture, 300ms end to end.

```
t=0ms      t=120ms                t=300ms
|--STRIKE--|--------SEAT----------|      the state chip / possession plate
           |---BAR-DRAW-----------|      the possession bar
```

### 4a. The plate — `animate-label-attach`

One CSS animation, `label-attach`, `--time-attach` (5 beats / 300ms), `both`
fill, two phases with per-keyframe easing:

| Stop | opacity | transform | timing function for the segment that starts here |
|---|---|---|---|
| `0%` | `0` | `translate3d(0, calc(var(--dist-strike) * -1), 0) rotate(var(--tilt-strike)) scale(var(--scale-stamp))` | `--ease-strike` |
| `40%` | `1` | `translate3d(0, var(--dist-seat), 0) rotate(calc(var(--tilt-strike) * 0.25)) scale(1)` | `--ease-seat` |
| `100%` | `1` | `translate3d(0, 0, 0) rotate(0deg) scale(1)` | — |

Read in words: the plate comes down from 10px above its seat, 6% over-scale and
0.6° off-square, invisible. It accelerates the whole way — it is thrown, not
eased. At 120ms it is at full opacity, at true scale, 2px *past* its resting
position and a quarter of the way back to square: this is the moment of
contact. Over the next 180ms it settles back up through those 2px onto the stop
and squares off, decelerating hard.

**The 40% is load-bearing.** It is `--time-strike : --time-seat` = 2:3 and it
is locked to `--time-attach`. If a future round changes either beat count, the
percentage changes with it or the phases silently desynchronise from their
easings. That pair — *the stop percentage and the beat ratio* — is the one
thing in this spec that two implementers could get wrong independently, which
is why it is stated three times: here, in the `tailwind.config.ts` keyframes
comment, and in `globals.css` §5 beside `--time-attach`.

**Direction is fixed.** Down the cross axis, from the head of the card. Not
from the leading edge, not from the direction of the lane the card is moving
to. A label is applied perpendicular to the surface; it does not slide in from
where it came from. Making the direction encode the destination would be a
second information channel competing with hue, which already encodes exactly
that.

### 4b. The possession bar — `animate-bar-draw`

`scale3d(1, 0, 1)` → `scale3d(1, 1, 1)`, `transform-origin: top center` (the
`origin-head` utility), `--time-seat` (3 beats), `--ease-seat`, delayed by
`--time-strike` so it begins on the beat the strike lands.

**The colour is already the new one when this runs.** The bar is not
crossfading from pine to indigo; the new bar is being *printed down over* the
old one, top to bottom, like a second pass of ink. That is the whole reason
this is a `scaleY` and not an `opacity`: a fade says "this value was replaced",
a wipe says "this mark was applied". The product's central event deserves the
second reading.

### 4c. What the front-end has to do

The animation is entirely CSS; there is no JS timeline, no library, and no
`requestAnimationFrame`. The front-end's job is to make the element *new* at
the moment possession changes so the animation runs:

1. On the state chip, pass `attach` to the `Chip` primitive when the transition
   being rendered is a possession change. The primitive keys the incoming label
   and swaps `animate-chip-in` for `animate-label-attach`. That is one prop.
2. On `PossessionBar`, add `animate-bar-draw origin-head` to the filled bar and
   change its `key` when possession changes, so React remounts it and the
   animation runs from 0. Paint the *new* hue immediately; do not transition
   the colour.
3. Do not animate the card, the lane, the counter, or anything else in the same
   frame (rule R1).

## 5. The restraint list

The half of the system that stops it becoming confetti. Mirrored as
`FORBIDDEN_MOTION` in `a11y-contract.ts` so a reviewer can cite an entry, and
so the source scan can keep failing on the Tailwind spellings.

| Does not animate | Why not |
|---|---|
| **Spinners, shimmer, pulsing dots** — anything infinite | Motion here means a change occurred. A loop means nothing has, forever. An infinite animation also pins a compositor layer for the life of the page. |
| **Skeleton shimmer** | It animates the absence of data. Relay's empty states instruct instead — "Nothing here yet. Add the first deliverable." A shimmer is a promise the network may not keep. |
| **Hover lift, hover scale, hover translate** | Paper does not float, and a hover is not an event. The card already reveals its controls on `focus-within` and hover; that reveal is a display change, not a motion. |
| **The initial board render** | The client board has a 1.5s FCP budget on 4G and is the acquisition surface. Nothing animates before hydration. See §8. |
| **Scroll-triggered entrances** | Scrolling is not an event. A board is a document, not a narrative. |
| **Lane re-sort, card reflow, drag settle** | Position within a lane is not information in this product, so a change of position is not an event that deserves weight. Animating it would also be the one thing here that cannot be done on the compositor — it is a layout change by definition. |
| **Route transitions** | They cost the FCP budget on the one surface that has one and buy nothing. Relay's routes are documents; opening a document does not need a page turn. |
| **Toast slide-in** | There are no toasts. A result is shown where the action was taken. |
| **The purge countdown / possession duration ticking** | The wrap slate states a date. A number that animates reads as urgency, and urgency is not a channel this palette has — that is the same reservation that keeps `--breach` meaning one thing. |
| **The possession bar while the ball is held** | Possession is a state, not an event. The bar animates once, when it changes, and is then still. A bar that pulsed while the client held a card would be a deadline nag wearing a possession colour. |
| **The purge certificate — anything on it** | It is a record of destruction forwarded to a client's legal team. A record does not perform. The certificate renders complete and still, in both motion modes. |
| **`--breach` appearing** | The rounds counter crossing contract is the most consequential state in the product and it gets *no* extra motion, only the colour and the number. Animating it would make a breach feel like an alarm rather than a fact, and the palette's whole discipline is that consequence is stated, not dramatised. |

The last two are the entries that prove the list is real. Both are the most
tempting things on the board to animate.

## 6. The inventory — what does animate

Eight keyframes. A ninth name appearing on a rendered page is a spec violation;
`ALLOWED_ANIMATION_NAMES` in `a11y-contract.ts` is the list and
`assertOnlySanctionedKeyframes` in the e2e suite is the check.

| Name | Utility | Duration | Trigger | Element |
|---|---|---|---|---|
| `chip-in` / `chip-out` | `animate-chip-in` / `-out` | 2 beats | a state chip's label changes | `Chip` (primitive) |
| `label-attach` | `animate-label-attach` | 5 beats | **possession changes hands** | `Chip attach` / possession plate |
| `bar-draw` | `animate-bar-draw origin-head` | 3 beats, delayed 2 | **possession changes hands** | `PossessionBar` fill |
| `stamp` | `animate-stamp` | 2 beats | a version is published; a decision is recorded; a round is consumed | the version pip, the decision timestamp, the rounds counter |
| `seat` | `animate-seat` | 3 beats | a record is appended to a list | a `VersionStack` row, a new comment |
| `sheet-in` | `animate-sheet-in` | 3 beats | a dialog opens | `Dialog` (primitive) |
| `scrim-in` | `backdrop:animate-scrim-in` | 1 beat | a dialog opens | the `::backdrop` |

Plus one transition, not a keyframe: `Button` runs
`transition-[background-color,border-color,color,transform]` at
`--time-tick` and takes `translate-y-nudge` on `active:`. **`active:`, not
`hover:`** — the press is the only thing in the product that moves under a
pointer, because a press is an event and a hover is not.

`stamp` is the weight class below the attach and it is where most of the
system's life actually comes from, because publishing a version and recording a
decision are far more frequent than possession changing hands. Two beats,
scale 1.06 → 1, opacity 0 → 1: the mark lands. It is deliberately *not* the
attach — reserving the five-beat gesture for one event is what keeps that event
legible as the biggest thing that happens.

## 7. Reduced motion

One media query, one selector pair, five declarations, and the whole system
stops:

```css
@media (prefers-reduced-motion: reduce) {
  :root,
  [data-relay-root] {
    --dur-beat: 0ms;
    --dist-strike: 0px;
    --dist-seat: 0px;
    --dist-nudge: 0px;
    --scale-stamp: 1;
    --tilt-strike: 0deg;
  }
}
```

**The reduced-motion equivalent of every entry in §6 is: the mark is already
applied.** That is the whole answer, and it is worth being precise about why it
is an answer rather than a shrug.

Every keyframe in this system resolves to the element's resting state at 100%,
and every one runs with `animation-fill-mode: both`. At a 0ms duration the
element therefore lands on exactly the pixel, opacity, scale and angle it
occupies when nothing is happening — instantly, and correctly. Nothing is left
mid-flight, nothing is left invisible, nothing is left rotated.

| Entry | Under reduce |
|---|---|
| `label-attach` | the plate is in place, square, at scale, opaque |
| `bar-draw` | the bar is drawn full height in the new hue |
| `stamp` | the mark is there |
| `seat` | the row is in the list |
| `sheet-in` / `scrim-in` | the dialog is open on its scrim |
| `chip-in` / `chip-out` | the new label has replaced the old one |
| button press | the colour step still happens; it just happens in 0ms, and nothing translates |

The brief's requirement was that under reduce the interface still feel
*deliberate*, not merely frozen. It does, and the reason is structural rather
than a second set of animations: **no motion in Relay carries information that
the static frame does not also carry.** Possession is a hue and a mono label
before it is a gesture; a published version is a row and a pip; a breach is a
colour and a number. The motion dramatises facts that are legible without it.
Take the motion away and you have a well-set document, which is what this
product was always trying to be — that is the definition of deliberate, and it
is why this system could afford to grow without acquiring a reduced-motion
fallback layer that would need its own testing.

There is no `motion-reduce:` variant anywhere in this codebase and there must
never be one. That pattern was removed once already; it is a component opting
in by hand, which means the next component can forget, and nothing catches it.

*(One known exception is on record and is not mine to fix:
`src/components/agency/card-tile.tsx` carries `motion-reduce:transition-none`.
It is allowlisted in `tests/unit/a11y-source.spec.ts` as a round-2 defect. With
this system in place the fix is a one-liner — delete the variant and let the
token do it — and it belongs to the front-end.)*

## 8. Cost, and how the 1.5s FCP budget survives

The budget: **first contentful paint under 1.5s on 4G, on the client board.**
It is the acquisition surface and the reader is unmotivated. Three claims, each
falsifiable.

**Claim 1 — nothing in this system executes before or during first paint.**

Every animation in §6 is triggered by a *change*: a possession transition, a
publish, a decision, a dialog opening, a press. All of them are post-hydration
events. There is no entrance animation on the initial board render — that is a
line item in the restraint list precisely because it is the one thing that
would spend the budget. The staggered `seat` on a list applies to a list that
*gains* items, not to the server-rendered first paint. So the runtime cost of
this system at FCP is zero, not small.

**Claim 2 — the marginal bytes are the only real cost, and they are 686 bytes
gzipped, measured (§9).**

`globals.css` is a render-blocking stylesheet, so bytes added to it are the one
way a motion system can genuinely hurt FCP. The measured deltas are recorded in
§9 below. The mitigations:

- **The keyframes live in `tailwind.config.ts`, not in `globals.css`.** Tailwind
  emits a `@keyframes` block only when its `animate-*` utility appears in
  scanned source, so the product pays per animation actually used and an
  unused one costs nothing.
- **The token layer is declarations, not rules** — nineteen custom properties
  in a block that already exists, which gzip extremely well against the
  surrounding text.
- **No new dependency.** Zero JS was added. An animation library would have
  been 15–40KB of parser-blocking script on the surface with the budget, to do
  what per-keyframe `animation-timing-function` does for free.

**Claim 3 — nothing here can thrash layout or drop a frame.**

`ANIMATABLE_PROPERTIES` in `a11y-contract.ts` is the closed list: `transform`,
`opacity`, and the three colour properties. Every keyframe in §6 touches only
`transform` and `opacity`, which are composited — they never enter layout or
paint, so a card animating cannot invalidate the board. The colour properties
are the sanctioned exception: they do not composite, but they animate a
button's fill over one beat, after hydration, and repaint a box a few hundred
pixels square.

Three specific things were done for frame cost rather than for taste:

- `translate3d()` and `scale3d()` rather than `translate()`/`scale()`, so the
  element is promoted before the animation starts rather than at its first
  frame.
- **No `will-change` anywhere.** A blanket `will-change: transform` on cards
  would create a compositor layer per card for the life of the page and cost
  more memory than the animation costs time. The browser promotes on animation
  start, which is the right moment.
- **The stagger cap.** Six items, not forty, which also bounds the number of
  simultaneously promoted layers.

**Claim 4 — the label system's cost is paint, not layout, and the expensive
piece is off the board.** The five label-chrome classes in `globals.css` §7 are
gradients and one pseudo-element each; none reads a layout property. The one
genuinely heavy artifact, the `Barcode`, is one `<path>` (≈50 subpaths for an
8-character prefix) and is allowed only on surfaces that carry exactly one and
are not the board — the purge certificate, the export header, a version detail.
`CardTile` gets a `Plate`, which is text.

## 9. Measured

Measured on the **built, minified** stylesheet, which is what crosses the link
— not on the source, which is mostly comments. Reproduce with:

```
git show HEAD:src/app/globals.css   > /tmp/old.css
git show HEAD:tailwind.config.ts    > /tmp/old.config.ts
npx tailwindcss -c /tmp/old.config.ts -i /tmp/old.css -o /tmp/old-built.css --minify
npx tailwindcss -c tailwind.config.ts -i src/app/globals.css -o /tmp/new-built.css --minify
gzip -c /tmp/old-built.css | wc -c ; gzip -c /tmp/new-built.css | wc -c
```

| Stylesheet | Raw | Gzipped | Δ gzipped |
|---|---|---|---|
| round 2 (one crossfade) | 23,294 B | **5,807 B** | — |
| round 3, motion system only | 25,205 B | **6,331 B** | **+524 B** |
| round 3, motion + label chrome | 25,938 B | **6,493 B** | **+686 B** |

**+686 bytes gzipped, for the entire round.** 524 of those are the motion
system — nineteen custom properties, five `@keyframes` blocks and their
utilities — and 162 are the five label-chrome classes.

Against a 1.5s FCP budget on 4G: 686 bytes is roughly **4ms** of transfer at a
1.6 Mbps effective throughput, inside a single TCP segment, on a stylesheet
that was already being fetched. It does not move the budget, and it is the
*only* way this system touches FCP at all, because per Claim 1 nothing in it
executes before hydration.

For scale, the alternative that was rejected: the smallest credible animation
library is 15–40 KB of parser-blocking JavaScript — twenty to sixty times this
system's total cost, on the one surface in the product that has a budget, to
buy sequencing that per-keyframe `animation-timing-function` provides for
nothing. That is the whole argument against the dependency, and it is why no
ADR was raised.

The `next build` figure for the same change, end to end: the emitted stylesheet
is 25,986 B raw / **6,510 B gzipped**, and the shared first-load JS is
unchanged at 103 kB — zero JS was added.

## 10. For QA

Everything in this document that can be asserted is data in
`src/styles/a11y-contract.ts` §6:

- `MOTION` — the one duration token, its normal and reduced values, the easing
  token. The existing assertions (`--dur-*` appears once; the reduce query
  collapses it; it is declared at its normal value; the query reaches
  `[data-relay-root]`) all still apply and all still pass.
- `BEATS` — every duration and its beat count. Assert each resolves to
  `beats × BEAT_MS` normally and `0ms` under reduce.
- `EASINGS`, `AMPLITUDES` — the curves and the distances, with their reduced
  values.
- `STAGGER` — the index token, the cap, the class name.
- `ALLOWED_ANIMATION_NAMES` — eight plus `none`.
- `ANIMATABLE_PROPERTIES` — the closed list; a computed `transition-property`
  outside it is a regression.
- `FORBIDDEN_MOTION` — the restraint list, now `{ what, why }` pairs rather
  than strings. **This is a shape change**: any consumer that treated it as
  `string[]` needs updating. Nothing in `tests/` referenced it at the time of
  writing.

Two assertions worth adding that do not exist yet:

1. **Every keyframe's 100% is the resting state.** Read the `100%` stop of each
   sanctioned animation and assert `transform` resolves to the identity and
   `opacity` to `1`. This is the property the entire reduced-motion story rests
   on, and it is currently guaranteed by review alone.
2. **No literal duration in `globals.css`.** Grep for `\d+ms` outside the
   `--dur-beat` declaration. A literal is how the single-switch guarantee dies.
