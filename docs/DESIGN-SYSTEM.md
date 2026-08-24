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
