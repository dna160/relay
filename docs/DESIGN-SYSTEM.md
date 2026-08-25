# Design System

## Direction

The subject is production paperwork: call sheets, dockets, delivery notes. A
Relay workspace is a temporary, dated, high-information document that two
parties read together and then throw away. The interface should feel like
well-set production stationery — dense, legible, unfussy — not like a SaaS
dashboard with a hero gradient.

The one risk taken: **colour encodes possession, not urgency.** Hue tells you
whose move it is. Deadline pressure is expressed through weight and a countdown
in monospace, never by turning things red. Red is reserved for one thing only —
a breached commitment — so it still means something on a Wednesday afternoon.

## Tokens

Every value below is followed by its measured contrast on `--paper` — computed
with the WCAG 2.x relative-luminance formula against the exact hex, never
asserted. The working is in `docs/design/ACCESSIBILITY.md` §1; if you change a
token, recompute that file.

```css
:root {
  --ink:         #14171A;  /* 14.85  text, rules at full weight */
  --paper:       #E8EAE5;  /*    —   cool oat ground, not cream */
  --paper-2:     #F2F3F0;  /*    —   raised surfaces, cards */
  --rule:        #C4C8C0;  /*  1.40  decorative hairline ONLY — never a control's sole boundary */
  --rule-strong: #808978;  /*  3.01  boundary of any control. WCAG 1.4.11 */
  --agency:      #1F4E46;  /*  7.75  deep pine — ball is with the agency */
  --client:      #4A4FA6;  /*  5.85  indigo — ball is with the client */
  --breach:      #A8201A;  /*  6.00  commitment missed. Nothing else. */
  --muted:       #60665D;  /*  4.87  secondary text */
}
```

Two of these are corrections to the values this document originally carried, and
they are stated here rather than buried in an appendix, because the original
values were published and someone will otherwise re-derive the failure:

- **`--muted` was `#6B7168`. It measured 4.139:1 and failed AA.** `--muted` sets
  real text — due dates, engagement subtitles, hints, the size and hash columns
  of a version stack — so the large-text and non-text exemptions do not apply.
  `#60665D` holds the same hue (hsl 100°, 4% saturation) about 11% darker and
  measures **4.874:1**. Do not restore the old value.
- **`--rule-strong` is new.** `--rule` at 1.40:1 cannot be the only boundary of
  an input or a button under WCAG 1.4.11, which wants 3:1. Darkening `--rule`
  would coarsen every hairline in a product built out of hairlines, so the token
  was split instead: `--rule` stays decorative (table rules, version-row
  dividers, the edge of a card that already has a `--paper-2` ground doing the
  separating), and `--rule-strong` at **3.005:1** draws anything a user can
  operate.

### Dark mode

Ground and ink swap. The possession hues lift; hue and saturation are untouched,
so pine stays the cooler green, indigo the warmer blue, and both stay clear of
the red.

**The lift is not a flat +18%.** That figure was in this document and it does
not survive measurement against `--paper-2`, which is the ground cards actually
sit on and therefore the ground that governs. Applied as +18 HSL lightness
points:

| Token | +18 | vs dark `--paper` | vs dark `--paper-2` | Verdict |
|---|---|---|---|---|
| `--agency` | `#399081` | 4.70 | **4.23** | fails on cards |
| `--client` | `#8487C8` | 5.38 | 4.84 | passes |
| `--breach` | `#E1443D` | **4.37** | **3.93** | fails on both |
| `--muted` | `#999F96` | 6.64 | 5.98 | passes |

So the shipped deltas are **per token, not global**:

| Token | Lift | Value | vs `--paper` | vs `--paper-2` |
|---|---|---|---|---|
| `--ink` | — | `#E8EAE5` | 14.85 | 13.37 |
| `--paper` | — | `#14171A` | — | — |
| `--paper-2` | — | `#1D2125` | — | — |
| `--rule` | — | `#363D43` | 1.63 | 1.47 |
| `--rule-strong` | — | `#616D77` | 3.39 | 3.06 |
| `--agency` | **+20** | `#499D8F` | 5.57 | **5.02** |
| `--client` | +18 | `#8487C8` | 5.38 | **4.84** |
| `--breach` | **+23** | `#E45953` | 5.01 | **4.51** |
| `--muted` | +18 | `#999F96` | 6.64 | 5.98 |

+20 and +23 are the *smallest* lifts that clear 4.5:1 on `--paper-2`; they are
minima, not taste. `--client` and `--muted` genuinely ship at +18, which is why
the original figure looked right — it was right for half the palette.

White-label overrides `--agency` only — client indigo, breach red, and the
neutrals stay fixed so a tenant cannot theme away a warning. The hook is
`--brand-agency` and it is clamped in OKLCH; the mechanism and its proof are in
Appendix B.

## Type

| Role | Face | Use |
|---|---|---|
| Display | Archivo (Expanded, 600) | Engagement titles, lane headers, section eyebrows |
| Body | Public Sans | Descriptions, notes, comments |
| Utility | Martian Mono | Version numbers, hashes, timestamps, countdowns, card ids |

Monospace is not decoration here — it marks everything that is a *record*: v4,
the sha256 prefix, `14d to purge`, the decision timestamp. If a value would be
cited in a dispute, it is set in mono. That rule alone gives the interface its
character.

Scale: 12 / 14 / 16 / 20 / 28 / 40. Lane headers 14 uppercase, tracking +0.08em.

## Signature element

**The possession bar.** Every card carries a 3px bar along its leading edge,
filled in `--agency` or `--client`, with a mono label giving elapsed time in that
possession (`client · 6d`). At the board level the bars form a visible column of
who is holding the work. It makes the product's core insight legible in a glance
and it is the thing a screenshot will be recognised by.

**The label-attach.** The signature *moment*, added in round 3 and the answer
to "make it feel alive": when possession changes hands, the state plate is
struck and seated onto the card and the possession bar is printed down over the
old one, top to bottom, in the new hue. Five beats, 300ms, compositor-only, no
JavaScript. It is the product's central event and it is the only thing in the
interface that gets that weight. `docs/design/MOTION.md` §4.

**The wrap slate.** A persistent mono strip in the workspace header:
`WRAP +12d · PURGE IN 48d · EXPORT`. Ephemerality is stated, never sprung. It is
also the conversion surface, and it must never be dismissible.

## Components

- `PossessionBar` — leading edge, hue + mono duration
- `CardTile` — title, state chip, version pip (`v4`), rounds `3/2` turning
  `--breach` when exceeded, due date
- `LaneColumn` — header carries a private badge when `visibility = private`;
  the badge is agency-only and never rendered in the client bundle
- `VersionStack` — reverse-chronological, each row `v4 · 12.4 MB · 3a91f2…`
- `DecisionBar` — client surface: Approve / Request changes, note required on
  the second, disabled until the note has content
- `WrapSlate` — countdown + export
- `AttentionList` — portfolio home, grouped by actionability: *blocked on you*,
  *blocked on your team*, *with the client*, *no movement in 7 days*
- `UploadDock` — drop zone plus per-file queue: hashing, transfer, multipart
  resume, and a failure that says which of the four steps failed
- `StreamStatus` — the live/stale/offline state of the event stream, in the one
  place a person is already looking

Round 3 adds four primitives that carry the spec-label vernacular. They are
primitives rather than components because none of them knows what an engagement
is — see `docs/design/LABEL-SYSTEM.md`:

- `Plate` — the batch/serial block: a dense mono `<dl>` on a recessed ground,
  `stack` or `strip`. A layout for facts the product already publishes
- `Barcode` — Code 39, encoding the value printed beneath it. Certificate,
  export header and version detail only; never the board
- `RegistrationMark` — a printer's crosshair marking where a document was
  issued
- `Rule weight="hazard"` — achromatic diagonals. One referent: the purge
  boundary

## Copy rules

Name things by what people control. "Request changes," not "Reject." An action
keeps its name through the flow: the button that says **Publish to client**
produces **Published to client**. Empty states instruct rather than apologise: an
empty lane reads "Nothing here yet. Add the first deliverable." A purge warning
states the date, the count, and the one action that prevents it.

## Quality floor

Responsive to 360px. Visible keyboard focus on every interactive element.
`prefers-reduced-motion` respected — honoured **at the token**, never at a call
site. Round 3 replaced the one-crossfade budget with a motion *system* without
weakening that: every duration in the product is an integer number of beats
written as a `calc()` over the single `--dur-beat` token, so one declaration in
one media query still silences everything. `docs/design/MOTION.md` is the
specification; the 120ms state-chip crossfade survives inside it, unchanged, as
two beats. Contrast: possession hues meet 4.5:1 on **both**
`--paper` and `--paper-2`, in both modes. `--paper-2` is the binding ground —
cards sit on it — and a token that passes only on `--paper` has not passed.

These are not prose commitments. They are executable: `src/styles/a11y-contract.ts`
exports the pairs, the ratio function, the focus-ring expectations and the
motion contract as data, and `docs/design/A11Y-ASSERTIONS.md` is the Playwright
suite that consumes it.

---

# Appendices

> Appended by the design layer during implementation. The body of this document
> above is the intent; these appendices are what shipped.
>
> **Round 2:** the two measurement corrections — `--muted` and the dark-mode
> lift — have been folded back into the body itself, so the body and these
> appendices no longer disagree. Appendix A is now a restatement, kept because
> it is the one table that puts both modes side by side.

## Appendix A — Tokens as implemented

Implemented in `src/app/globals.css`. Every ratio below is computed, not
asserted; the working is in `docs/design/ACCESSIBILITY.md`.

### Light

| Token | Value | vs `--paper` | Note |
|---|---|---|---|
| `--ink` | `#14171A` | 14.85 | unchanged |
| `--paper` | `#E8EAE5` | — | unchanged |
| `--paper-2` | `#F2F3F0` | — | unchanged |
| `--rule` | `#C4C8C0` | 1.40 | unchanged; decorative hairline only |
| `--rule-strong` | `#808978` | 3.01 | **added** — control boundaries (WCAG 1.4.11) |
| `--agency` | `#1F4E46` | 7.75 | unchanged; the literal is what an untenanted install paints |
| `--client` | `#4A4FA6` | 5.85 | unchanged |
| `--breach` | `#A8201A` | 6.00 | unchanged |
| `--muted` | `#60665D` | 4.87 | **changed** from `#6B7168`, which measured 4.14 and failed AA |

### Dark

| Token | Value | vs `--paper` | vs `--paper-2` |
|---|---|---|---|
| `--ink` | `#E8EAE5` | 14.85 | 13.37 |
| `--paper` | `#14171A` | — | — |
| `--paper-2` | `#1D2125` | — | — |
| `--rule` | `#363D43` | 1.63 | 1.47 |
| `--rule-strong` | `#616D77` | 3.39 | 3.06 |
| `--agency` | `#499D8F` | 5.57 | 5.02 |

| `--client` | `#8487C8` | 5.38 | 4.84 |
| `--breach` | `#E45953` | 5.01 | 4.51 |
| `--muted` | `#999F96` | 6.64 | 5.98 |

The "+18%" lift holds for `--client` and `--muted`. `--agency` needed +20 and
`--breach` +23 to clear 4.5:1 on `--paper-2`, which is the ground cards sit on.
Hue and saturation are untouched, so the relationship between the hues survives.

Every value in both tables is verified in-browser as the colour actually
painted, not only as the colour declared — see ACCESSIBILITY.md §2.

### Derived (all functions of the above)

`--on-hue` (text on a possession fill; equals `--paper` in both modes),
`--tint-agency` / `--tint-client` / `--tint-breach` (12% hue over `--paper-2`,
the quiet chip grounds), `--agency-hover` / `--client-hover` / `--paper-hover`
(mixed 88–94% toward `--ink`, which moves away from the ground in both modes),
`--field`, `--scrim`, `--focus` (= `--ink`), `--radius-1` 2px, `--radius-2` 3px,
`--bar-width` 3px, `--hairline` 1px.

Motion (round 3, full specification in `docs/design/MOTION.md`): one duration
token `--dur-beat` 60ms — 0ms under `prefers-reduced-motion` — and a ladder of
`calc()` multiples of it (`--time-tick` 1, `--time-chip` 2, `--time-strike` 2,
`--time-stamp` 2, `--time-seat` 3, `--time-sheet` 3, `--time-step` 0.5,
`--time-attach` 5). Four easings named for what the motion does (`--ease-chip`,
`--ease-strike`, `--ease-seat`, `--ease-stamp`) and five amplitudes that are
also zeroed under reduce (`--dist-strike`, `--dist-seat`, `--dist-nudge`,
`--scale-stamp`, `--tilt-strike`), plus `--stagger-index` / `--stagger-cap`.

`--dur-chip` no longer exists as a token; `--time-chip` is the same 120ms
expressed as two beats, and the Tailwind key `duration-chip` is unchanged, so
nothing that already wrote it had to move.

## Appendix B — How the white-label lock works

A tenant sets exactly one property, `--brand-agency`, in exactly one place: a
`style` attribute on `[data-relay-root]`, written through
`element.style.setProperty` (React's style object does this). Three independent
mechanisms make "`--agency` only" a property of the cascade rather than a rule
someone has to remember in review.

**(a) Name.** `--agency` is not the hook — it *selects between* the published
default and a clamped tenant colour. The hook is read in exactly one place, the
`--agency-tenant` declaration inside the `@supports` block. Setting `--agency`
or `--agency-tenant` inline is inert; both are `!important`.

**(b) Cascade position.** Every protected token is declared `!important` on both
`:root` **and** `[data-relay-root]` — the element the hook lives on. An
`!important` author declaration beats a normal inline declaration on the same
element, so an injected `style="--breach:#0f0"` loses. Declaring on both elements
closes the "set it on the element that carries the hook" hole. Separately,
`@layer relay.tenant;` is declared once at the top of `globals.css` and nowhere
else, fixing it as the lowest-priority author layer; any tenant CSS injected as a
stylesheet must live inside it and loses to every unlayered declaration in the
token block.

**(c) Range.** Even the sanctioned hook is bounded. A *tenant's* `--agency` is
the brand hue re-expressed in OKLCH with lightness clamped to `[0.20, 0.50]` in
light and `[0.64, 0.90]` in dark, and chroma clamped to `≤ 0.12`. The **default**
does not go through the clamp at all: `--brand-agency` is left undeclared, which
makes `--agency-tenant` invalid at computed-value time, which makes
`var(--agency-tenant, #499D8F)` fall through to the published literal. Round 2
shipped the clamp over the default as well, and in dark mode its `c * 1.6`
chroma lift re-lifted an already-lifted colour: the browser painted
rgb(0, 163, 144) where this table published #499D8F. Still legible, so no
contrast assertion caught it — which is why the browser suite now asserts the
untenanted value exactly, not just its ratio. Those bounds come from an
exhaustive sweep of the sRGB gamut: at OKLCH L = 0.50 the brightest possible hue
still reaches 4.67:1 on `--paper`; at L = 0.64 the darkest possible hue still
reaches 4.50:1 on dark `--paper-2`. No tenant value produces an illegible
possession colour. Browsers without relative colour syntax get the Relay default
and no white-label at all — there is no code path in which an unclamped tenant
colour reaches the page.

`--client`, `--breach` and every neutral are literals under (b). A tenant can
change the hue of "the ball is with us". They cannot theme away a warning.

## Appendix C — Type as implemented

Scale `12 / 14 / 16 / 20 / 28 / 40` maps to `text-12 … text-40`, plus two role
sizes: `text-lane` (14px, uppercase, +0.08em, 600 — lane headers) and
`text-eyebrow` (12px, same treatment — badges and section eyebrows).

| Role | Utility | Axis settings |
|---|---|---|
| Display | `font-display` | Archivo at `wdth 125, wght 600` |
| Body | `font-sans` | Public Sans |
| Utility | `font-mono` | Martian Mono at `wdth 87.5`, `tracking-mono` (−0.02em), tabular figures |

Martian Mono is very wide at its default width. Narrowing it to 87.5 and pulling
the tracking in is what lets `v4 · 12.4 MB · 3a91f2…` fit inside a 280px card.

The `Mono` primitive (`src/components/primitives/Mono.tsx`) is how the "if it
could be cited in a dispute, it is set in mono" rule is enforced in code rather
than remembered.

## Appendix D — Vendoring the faces

The three variable faces are declared with `@font-face` directly in
`globals.css`, so they cost no extra request and no render-blocking stylesheet,
and every declaration carries `font-display: swap` — first paint is never gated
on a font.

Each `src` lists a same-origin file first and the Google CDN second. To move to
self-hosting, drop these six files into `public/fonts/` under exactly these
names; nothing in the code changes.

| File | Source |
|---|---|
| `archivo-latin.woff2` | `fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2` |
| `archivo-latin-ext.woff2` | `…/k3kQo8UDI-1M0wlSfdfoLmvDIaK18A.woff2` |
| `public-sans-latin.woff2` | `fonts.gstatic.com/s/publicsans/v21/ijwRs572Xtc6ZYQws9YVwnNGfJ7QwOk1.woff2` |
| `public-sans-latin-ext.woff2` | `…/ijwRs572Xtc6ZYQws9YVwnNIfJ7QwOk1Fig.woff2` |
| `martian-mono-latin.woff2` | `fonts.gstatic.com/s/martianmono/v6/2V0aKIcADoYhV6w87xrTKjsSBanIRWbh8g.woff2` |
| `martian-mono-latin-ext.woff2` | `…/2V0aKIcADoYhV6w87xrTKjsSC6nIRWbh8q05.woff2` |

Until then, the owner of `src/app/layout.tsx` should add two preconnects so the
CDN handshake overlaps the HTML parse rather than following it:

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
```

Self-hosting is the better end state: it removes a third-party origin from the
client board's critical path, which matters against a 1.5s FCP budget on 4G.

## Appendix E — Where the specs live

| Document | Contains |
|---|---|
| `docs/design/COMPONENTS.md` | Anatomy, every state, tokens, spacing, 360px behaviour, and the accessible name and role for `PossessionBar`, `CardTile`, `LaneColumn`, `VersionStack`, `DecisionBar`, `WrapSlate`, `AttentionList`, `UploadDock`, `StreamStatus`. |
| `docs/design/FLOWS.md` | The client's first five minutes, the agency's publish-to-client gate, the purge warning for both sides, the upload end to end with its failure matrix, and first-run onboarding. |
| `docs/design/ACCESSIBILITY.md` | Every contrast ratio, computed. Focus order. The required-note affordance. Reduced motion. The exhaustive list of one for `--breach`. |
| `docs/design/A11Y-ASSERTIONS.md` | The accessibility floor as executable Playwright specs, for QA to lift into `tests/`. |
| `src/styles/a11y-contract.ts` | The same floor as importable data: contrast pairs, `contrastRatio()`, focus-ring expectations, the motion contract, the forbidden-pattern list. |
| `docs/design/MOTION.md` | The motion system: the beat and the duration ladder, the easings and amplitudes, the label-attach specified stop by stop, the named inventory, the restraint list with a reason per entry, orchestration and staggering, the reduced-motion equivalent of every entry, and the measured cost against the FCP budget. |
| `docs/design/LABEL-SYSTEM.md` | The spec-label vernacular: what ships, where each piece goes, and — the more useful half — what was rejected and why. |
| `src/components/primitives/` | `Button`, `Chip`, `Field`/`Textarea`, `Dialog`, `Badge`, `Mono`, `Rule`, `Stack`/`Row`, `Plate`, `Barcode`, `RegistrationMark`, `cn`. |
