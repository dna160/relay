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

```css
:root {
  --ink:        #14171A;   /* text, rules at full weight */
  --paper:      #E8EAE5;   /* cool oat ground, not cream */
  --paper-2:    #F2F3F0;   /* raised surfaces, cards */
  --rule:       #C4C8C0;   /* hairlines, table borders */
  --agency:     #1F4E46;   /* deep pine — ball is with the agency */
  --client:     #4A4FA6;   /* indigo — ball is with the client */
  --breach:     #A8201A;   /* commitment missed. Nothing else. */
  --muted:      #6B7168;
}
```

Dark mode inverts ground and ink; possession hues lighten by 18% and keep their
relationship. White-label overrides `--agency` only — client indigo, breach red,
and the neutrals stay fixed so a tenant cannot theme away a warning.

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

## Copy rules

Name things by what people control. "Request changes," not "Reject." An action
keeps its name through the flow: the button that says **Publish to client**
produces **Published to client**. Empty states instruct rather than apologise: an
empty lane reads "Nothing here yet. Add the first deliverable." A purge warning
states the date, the count, and the one action that prevents it.

## Quality floor

Responsive to 360px. Visible keyboard focus on every interactive element.
`prefers-reduced-motion` respected — the only motion is a 120ms state-chip
crossfade on transition. Contrast: possession hues meet 4.5:1 on `--paper` in
both directions.

---

# Appendices

> Appended by the design layer during implementation. The body of this document
> above is the intent; these appendices are what shipped, including the two
> places where the intent had to move to survive a measurement.

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
| `--agency` | `#1F4E46` | 7.75 | unchanged; now computed through the brand clamp |
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

### Derived (all functions of the above)

`--on-hue` (text on a possession fill; equals `--paper` in both modes),
`--tint-agency` / `--tint-client` / `--tint-breach` (12% hue over `--paper-2`,
the quiet chip grounds), `--agency-hover` / `--client-hover` / `--paper-hover`
(mixed 88–94% toward `--ink`, which moves away from the ground in both modes),
`--field`, `--scrim`, `--focus` (= `--ink`), `--radius-1` 2px, `--radius-2` 3px,
`--bar-width` 3px, `--hairline` 1px, `--dur-chip` 120ms (0ms under
`prefers-reduced-motion`), `--ease-chip`.

## Appendix B — How the white-label lock works

A tenant sets exactly one property, `--brand-agency`, in exactly one place: a
`style` attribute on `[data-relay-root]`, written through
`element.style.setProperty` (React's style object does this). Three independent
mechanisms make "`--agency` only" a property of the cascade rather than a rule
someone has to remember in review.

**(a) Name.** `--agency` is not the hook — it is computed *from* the hook.
Setting `--agency` directly is inert, because the computed declaration is
`!important` and re-reads `--brand-agency` regardless of what `--agency` was set
to.

**(b) Cascade position.** Every protected token is declared `!important` on both
`:root` **and** `[data-relay-root]` — the element the hook lives on. An
`!important` author declaration beats a normal inline declaration on the same
element, so an injected `style="--breach:#0f0"` loses. Declaring on both elements
closes the "set it on the element that carries the hook" hole. Separately,
`@layer relay.tenant;` is declared once at the top of `globals.css` and nowhere
else, fixing it as the lowest-priority author layer; any tenant CSS injected as a
stylesheet must live inside it and loses to every unlayered declaration in the
token block.

**(c) Range.** Even the sanctioned hook is bounded. `--agency` is the brand hue
re-expressed in OKLCH with lightness clamped to `[0.20, 0.50]` in light and
`[0.64, 0.90]` in dark, and chroma clamped to `≤ 0.12`. Those bounds come from an
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
| `docs/design/COMPONENTS.md` | Anatomy, every state, tokens, spacing, 360px behaviour, and the accessible name and role for `PossessionBar`, `CardTile`, `LaneColumn`, `VersionStack`, `DecisionBar`, `WrapSlate`, `AttentionList`. |
| `docs/design/FLOWS.md` | The client's first five minutes, the agency's publish-to-client gate, and the purge warning for both sides. |
| `docs/design/ACCESSIBILITY.md` | Every contrast ratio, computed. Focus order. The required-note affordance. Reduced motion. The exhaustive list of one for `--breach`. |
| `src/components/primitives/` | `Button`, `Chip`, `Field`/`Textarea`, `Dialog`, `Badge`, `Mono`, `Rule`, `Stack`/`Row`, `cn`. |
