# Component specifications

> Implementation contract for the named components in `docs/DESIGN-SYSTEM.md`.
> Written so that two people implementing independently produce the same thing.
>
> Everything here composes `src/components/primitives/*`. No product component
> writes a raw colour, a raw font size, or a radius above 3px. If a token is
> missing, add it to `src/app/globals.css` and `tailwind.config.ts` — do not
> reach for an arbitrary value.

## Conventions used below

| Word | Means |
|---|---|
| **Anatomy** | The boxes, in DOM order. |
| **Tokens** | Exact class names from the Tailwind theme. |
| **Name / role** | The accessible name and the ARIA role, as a reader announces it. |
| **360** | Behaviour at the 360px floor. |

Shared rules, true of every component here and not repeated in each section:

- Focus is the global ring from `globals.css` §6: `2px solid var(--focus)` at
  `2px` offset. Nothing sets `outline: none`.
- Motion is the 120ms chip crossfade and nothing else. No hover transforms, no
  entrance animations, no skeleton shimmer.
- Loading states are **hairline placeholders**, not shimmer: the real layout
  with `bg-rule` blocks at the real dimensions, wrapped in
  `aria-busy="true"` with a visually hidden "Loading …".
- Every empty state instructs. None apologises. None uses an illustration.
- Dates render as `D MMM` in body face (`14 Mar`); durations, counts, versions,
  hashes and countdowns render in `Mono`.

---

## 1. `PossessionBar`

The signature element. A 3px bar on a card's leading edge, filled in the hue of
whoever holds the work, with a mono label giving elapsed time in that possession.

### Anatomy

```
<div role="img" aria-label="…">          leading edge, 3px, full height
  └─ (bar is the element's own background)
</div>
<Mono>agency · 6d</Mono>                 the label, sits in the card footer
```

The bar and the label are one component with two render slots (`<PossessionBar
edge>` and `<PossessionBar.Label>`) so a CardTile can paint the edge full-bleed
and place the text where the reading order wants it.

### Data

From `PossessionSplit` in `src/lib/types.ts`: `current` (`'agency' | 'client' |
null`) and `currentMs`. Nothing else. The bar never reads `dueAt`.

### Tokens

| Part | Class |
|---|---|
| Edge, agency | `bg-agency w-bar` |
| Edge, client | `bg-client w-bar` |
| Edge, signed off (`current === null`) | `bg-rule-strong w-bar` |
| Label | `<Mono size="12" tone="muted">` |
| Label, possession > 7 days | `<Mono size="12" tone="ink" className="font-semibold">` |

Pressure is **weight**, not hue. At 7 days the label goes from `--muted` to
`--ink` and from regular to semibold. It never goes red. `--breach` appears on a
card only through `CardTile`'s rounds counter.

### Label format

`{side} · {duration}`, where `side` is `agency` or `client` verbatim (lowercase,
the product's vocabulary) and duration is the largest single unit:

- `< 1h` → `{n}m`
- `< 48h` → `{n}h`
- otherwise → `{n}d`

Signed off: the label is `signed off` with no duration and the muted tone.

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover / focus | None. The bar is not interactive and takes no focus. |
| loading | `bg-rule` edge, label omitted. |
| empty | Impossible — a card always has a possession or is signed off. |
| error | If `possession` is absent (client projection, where it is structurally missing per INV-1) the component **is not rendered at all**. Do not render a neutral bar; a grey edge on a client board reads as "unknown", which is worse than absent. |

### Name / role

`role="img"`, `aria-label="With the agency for 6 days"` /
`"With you for 6 days"` on the client surface / `"Signed off"`. The visible mono
label is `aria-hidden` because the img label already carries it.

### 360

Unchanged. The edge is 3px at every width; the label truncates from the right
with no ellipsis (durations are at most 4 characters).

---

## 2. `CardTile`

A deliverable on the board.

### Anatomy

```
<li>
  <a|button class="card">                     the whole tile is one target
    ├─ PossessionBar edge                     3px, absolutely positioned, full height
    ├─ Row(justify=between, baseline)
    │   ├─ h3  card title                     16 / body / 2 lines max
    │   └─ Mono  v4                           version pip, right-aligned
    ├─ Row(gap=2, wrap)
    │   ├─ Chip  state                        quiet, tone = possession
    │   ├─ Mono  rounds  3/2                  breach tone when exceeded
    │   └─ span  due  14 Mar                  body face, muted
    └─ Row(justify=between)
        ├─ PossessionBar.Label  client · 6d
        └─ Badge  PRIVATE                     agency bundle only
  </a>
</li>
```

### Dimensions

| | Value |
|---|---|
| Width | fills the lane (`w-full`), lane is `w-lane` (304px) with `px-3` |
| Min height | 72px |
| Padding | `pt-2 pb-2 pr-2.5 pl-3` — left padding clears the 3px bar |
| Radius | `rounded-md` (3px) |
| Ground | `bg-paper-2` |
| Border | `border-hairline border-rule` on all sides |
| Gap between tiles | 8px (`gap-y-2` on the lane list) |

### Tokens by part

| Part | Class |
|---|---|
| Title | `font-sans text-16 text-ink leading-6 line-clamp-2` |
| Version pip | `<Mono label="Version">v4</Mono>`, `text-muted` |
| State chip | `<Chip variant="quiet" tone={possession} label="State">` |
| Rounds, within contract | `<Mono tone="muted" label="Revision rounds">3/2</Mono>` |
| Rounds, exceeded | `<Mono tone="breach" label="Revision rounds, over contract">4/2</Mono>` + `font-semibold` |
| Due date | `font-sans text-12 text-muted` |
| Due date, past | `font-sans text-12 text-ink font-semibold` — weight, not red |
| Private badge | `<Badge tone="neutral" label="Private. Not visible to the client.">PRIVATE</Badge>` |

`contractedRounds === null` → the rounds slot renders nothing. Do not render
`3/–`.

**The only `--breach` on a card is the rounds counter, and only when
`roundsUsed > contractedRounds`.** An overdue date does not turn red. A card
sitting with the client for three weeks does not turn red. This is the whole
discipline: red on this board means a contracted commitment was exceeded, and a
reader can trust that on a Wednesday afternoon.

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover | `bg-paper-hover`, `border-rule-strong`. No lift, no shadow, no scale. |
| focus-visible | Global ring on the tile's anchor. Ring wraps the whole tile including the possession bar. |
| pressed | `bg-paper` (one step down from hover). |
| awaiting the reader (client board, `awaitingYou === true`) | Chip switches to `variant="solid" tone="client"` and reads **Your move**. Border goes `border-client`. Nothing else changes. |
| disabled | Not a state. A card in an archived engagement is still readable; the *actions* inside it are disabled, the tile is not. |
| loading | 72px box, `bg-paper-2`, `border-rule`, with a 3px `bg-rule` edge, a 60%-width `h-4 bg-rule` title block and a 40%-width `h-3 bg-rule` meta block. `aria-busy="true"`. |
| empty | Not applicable. |
| error (card failed to load) | Tile renders with the title `Could not load this card` in `text-muted`, a `quiet` `Retry` Button at `size="sm"`, and no chip or bar. Never a red tile. |

### Name / role

The tile is one link (`<a>`) inside an `<li>`. Accessible name, composed in this
order and joined with commas so a reader gets the whole card in one utterance:

> "Hero film cutdown, awaiting client, version 4, 3 of 2 rounds used, over
> contract, due 14 March, with you for 6 days"

Implement by giving the `<a>` an `aria-labelledby` pointing at the title and the
meta row, not by duplicating the string.

### 360

- Lane becomes full width, tile fills it.
- The meta `Row` already wraps; at 360px chip + rounds sit on line one and due
  date drops to line two.
- Title stays 16px. It is the one thing a client reads on a phone; do not shrink
  it to fit more.
- Minimum tap target for the tile is its 72px height. Satisfied by default.

---

## 3. `LaneColumn`

A column on the board. A rendering of a group of cards, not a bucket you drop
state into.

### Anatomy

```
<section aria-labelledby={id}>
  ├─ header  (sticky, top-0)
  │   ├─ Row(justify=between, gap=2)
  │   │   ├─ h2 id={id}   ART DIRECTION        lane header treatment
  │   │   ├─ Mono         7                    card count
  │   │   └─ Badge        PRIVATE              agency bundle only
  │   └─ Rule weight="strong"
  ├─ ul  (the cards)
  └─ footer
      └─ Button ghost sm   + Add deliverable   agency only
</section>
```

### Dimensions

| | Value |
|---|---|
| Width | `w-lane` (304px), `shrink-0` |
| Padding | `px-3 pt-2 pb-3` |
| Ground | `bg-paper` — the lane is the ground; cards are the raised surface |
| Header | `sticky top-0 z-10 bg-paper pb-2` |
| Card list gap | `gap-y-2` |

### Tokens by part

| Part | Class |
|---|---|
| Lane name | `font-display text-lane uppercase text-ink` (14px, +0.08em, 600) |
| Count | `<Mono tone="muted" label="Cards">7</Mono>` |
| Private badge | `<Badge tone="neutral" label="Private lane. Not visible to the client.">PRIVATE</Badge>` |
| Header underline | `<Rule weight="strong" />` |
| Add button | `<Button tone="ghost" size="sm">` |

### The private badge is a rendering assertion, not a permission check

`visibility === 'private'` never reaches the client bundle — the client
serialiser cannot emit a private lane (INV-1, `src/domain/projection/
client-view.ts`). The badge therefore exists to tell the **agency** what the
client is not seeing. It must not be implemented as `{isAgency && badge}` over a
lane the client also receives; if a `LaneColumn` in the client bundle ever
receives `visibility`, that is a bug in the projection, not a UI condition.

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover | None on the lane itself. |
| focus | The header is not focusable. The `Add` button and the cards are. |
| drag-over (agency, reordering) | Lane ground goes `bg-paper-hover`; a 2px `bg-agency` insertion line appears between the two cards the drop would land between. **Dragging writes `position` only. It never changes state** (PRD §5.1). The state chip must not change during a drag. |
| disabled (archived engagement) | Add button hidden entirely, not disabled — there is no action to explain. Header gains `<Badge tone="neutral">READ ONLY</Badge>`. |
| loading | Header renders real (name and count are cheap); the list renders three `CardTile` loading tiles. |
| empty | Centred in the list area, `text-14 text-muted`, no border, no icon: agency — **"Nothing here yet. Add the first deliverable."** with the Add button below it; client — **"Nothing here yet."** and no button. |
| error | `text-14 text-ink`: "This lane could not be loaded." plus a `quiet` `Retry` Button. |

### Name / role

`<section aria-labelledby>` pointing at the `<h2>`. The card list is a `<ul>`;
each tile an `<li>`. Screen reader hears "Art direction, list, 7 items".

The count is part of the heading's accessible name via `aria-describedby`, not
concatenated into the `<h2>` text — the heading should read "Art direction" in a
heading list.

### 360

Below `md` (768px) the board stops being a horizontal scroller and becomes a
vertical stack of collapsible lanes:

- Lane width `w-full`, `shrink` allowed.
- The header becomes a `<button aria-expanded>` that toggles the card list. Lanes
  with at least one card `awaitingYou` are expanded on first render; all others
  are collapsed. On the client's phone this is the difference between "a wall of
  cards" and "three things to look at".
- The count stays visible when collapsed. It is the reason the collapse is safe.
- Sticky header is dropped (a sticky header per lane in a vertical stack fights
  the scroll).

---

## 4. `VersionStack`

Reverse-chronological list of the immutable versions on a card.

### Anatomy

```
<Stack gap={0} as="ol">
  <li>                                    one row per version
    <Row justify=between gap=2 baseline>
      ├─ Mono size="14"  v4               version number
      ├─ span  Hero_cutdown_v4.mp4        filename, body, truncates
      ├─ Mono  12.4 MB                    size
      └─ Mono  3a91f2…                    sha256 prefix, title = full hash
    </Row>
    <Row gap=2>
      ├─ Chip   approved | changes requested | awaiting
      └─ Mono   14 Mar 09:12              as <time dateTime>
    </Row>
    <Rule />
  </li>
</Stack>
```

### The row format is fixed

`v4 · 12.4 MB · 3a91f2…` — exactly as DESIGN-SYSTEM.md states. The separator is
a middle dot in `text-muted`, `aria-hidden`. Sizes use SI with one decimal
(`12.4 MB`, `940 kB`). The hash is the first six hex characters followed by U+2026;
the full 64 characters go in `title` and in a `<data value>` attribute so it can
be copied.

### Tokens by part

| Part | Class |
|---|---|
| Row | `py-2` , first row `pt-0` |
| Version number | `<Mono size="14" tone="ink" label="Version">` |
| Filename | `font-sans text-14 text-ink truncate` |
| Size, hash | `<Mono tone="muted">` |
| Timestamp | `<Mono as="time" tone="muted" label="Decided">` |
| Divider | `<Rule />` between rows, none after the last |
| Current version | Row gains `bg-paper-2 -mx-2 px-2 rounded-sm`. No badge, no bold — it is at the top, which is what "current" means in a reverse-chronological stack. |
| Superseded versions | `text-muted` on the filename too. Present, dimmer, never hidden. |

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover | Row ground `bg-paper-hover` when the row is a link (agency: opens the version's note thread). |
| focus | Global ring on the row's link. |
| disabled | Download disabled on an archived engagement: the download control is replaced by `text-12 text-muted` reading "Export before {date} to keep this." linking to the export flow. Never a dead button. |
| loading | Three rows of `h-4 bg-rule` blocks at 8 / 40 / 20% widths. |
| empty | `text-14 text-muted`: agency — **"No versions yet. Upload the first one."**; client — **"Nothing has been sent to you on this card yet."** |
| error | "Versions could not be loaded." + `quiet` `Retry`. |

### Name / role

`<ol>` with `aria-label="Versions, newest first"`. Each `<li>` announces:

> "Version 4, Hero_cutdown_v4.mp4, 12.4 megabytes, hash 3a91f2, approved,
> 14 March 09:12"

Read "MB" as "megabytes" via a visually hidden expansion; a screen reader saying
"em bee" for a file size is a small thing that reads as carelessness.

### 360

The four-part row wraps to two lines: line one `v4` + filename (filename
truncates), line two size + hash. The hash never truncates further — six
characters is already the minimum useful prefix.

---

## 5. `DecisionBar`

The client's surface, and the highest-stakes component in the product. It is
where a decision becomes a record bound to a hash (INV-3).

### Anatomy

```
<form>
  <Stack gap={3}>
    ├─ Row baseline gap=2                          what is being decided
    │   ├─ span  You are deciding on
    │   ├─ Mono size="14"  v4
    │   └─ Mono  3a91f2…
    ├─ Row gap=2 (radiogroup)                      the choice
    │   ├─ radio  Approve
    │   └─ radio  Request changes
    ├─ Textarea  (mounted only when "Request changes")
    └─ Row justify=end gap=2
        ├─ Button ghost   Cancel
        └─ Button client  Approve | Request changes
  </Stack>
</form>
```

### The required-note rule

`DecisionRequest.note` is required when `decision === 'changes_requested'`
(`src/lib/types.ts`, enforced in the domain and by a CHECK constraint). The UI
must make that legible **before** the user is blocked by it, not after.

1. The Textarea is **mounted as soon as "Request changes" is selected**, not on
   submit. Its label is `Whatâ€™s wrong, and what would fix it` and it is marked
   `required`, which renders the visible "(required)" in `--muted`.
2. The submit Button is `disabled` while the trimmed note is empty.
3. **A disabled button must say why.** Alongside it, in
   `text-12 text-muted` with `aria-live="polite"`, render
   **"Add a note to send this back."** The message is removed the moment the
   note has content. Never ship a disabled control with no explanation — a
   client on a phone who cannot see why the button is dead will email instead,
   and the record is lost.
4. `aria-describedby` on the submit Button points at that message, so a reader
   that lands on the disabled button hears the reason.
5. Minimum note length is 1 non-whitespace character. Do not invent a 20-character
   minimum; a client who writes "wrong logo" has said enough.

### Copy

The action keeps its name through the flow (DESIGN-SYSTEM.md copy rules):

| Control | Before | After |
|---|---|---|
| Approve | `Approve` | `Approved` |
| Request changes | `Request changes` | `Changes requested` |

Never "Reject". Never "Decline".

### Tokens by part

| Part | Class |
|---|---|
| Container | `bg-paper-2 border-hairline border-rule-strong rounded-md p-3` |
| Container, client surface, sticky on mobile | `sticky bottom-0 border-t-hairline` with `bg-paper-2` — see 360 |
| Version + hash | `<Mono size="14">` / `<Mono tone="muted">` |
| Radios | Native `<input type="radio">`, `accent-color: var(--client)` set via `accent-client` utility class; 20px hit box padded to 44px |
| Submit | `<Button tone="client" size="lg">` |
| Cancel | `<Button tone="ghost" size="lg">` |
| Reason message | `text-12 text-muted` |

The submit button is `client`-toned in both cases. Requesting changes is not a
failure and is not styled as one — it is the client using the process correctly.
`--breach` never appears in this component.

### States

| State | Rendering |
|---|---|
| default | Neither radio selected, Textarea unmounted, submit disabled with the message **"Choose Approve or Request changes."** |
| Approve selected | Textarea unmounted. Submit enabled, reads `Approve`. An optional note field is offered behind a ghost `Add a note` toggle. |
| Changes selected, note empty | Textarea mounted and focused. Submit disabled, message **"Add a note to send this back."** |
| Changes selected, note present | Submit enabled, reads `Request changes`. |
| hover / focus | Global ring. The container never changes on hover. |
| loading (submitting) | `<Button loading>`; both radios and the Textarea go `disabled`; the container is `aria-busy`. |
| success | The bar is replaced in place by a record line: `Approved · v4 · 3a91f2… · 14 Mar 09:12` in `Mono`, with `role="status"`. The card's Chip crossfades in the background. No toast, no confetti. |
| disabled (card not `awaiting_client`) | The component is not rendered. Render instead a muted line: "This is with the agency." Do not render a greyed-out decision bar — it invites a click that cannot land. |
| error | `text-14 text-ink font-semibold` above the buttons with the server message, `role="alert"`, preceded by a 3px `bg-ink` leading bar; controls re-enabled; the note text is preserved. **Not `--breach`.** A failed request is not a breached commitment — see ACCESSIBILITY.md §6 for the exhaustive list of one. |

### Name / role

- `<form aria-labelledby>` → an `<h2>` reading "Decision on version 4".
- Radios in a `<fieldset>` with a `<legend>` "Your decision". The legend may be
  visually hidden; it may not be absent.
- Submit's accessible name is its visible label. Do not append "(disabled)".

### 360

This is the component's primary environment. Assume a phone.

- The bar is `sticky bottom-0` on the client card view with
  `padding-bottom: env(safe-area-inset-bottom)`.
- Radios stack vertically, each a full-width 44px row with the label as the hit
  area.
- Buttons stack, submit **on top** (`flex-col-reverse`), both `w-full`, both 44px.
- The Textarea is `min-h-[88px]`, which is three lines — enough that a client
  does not feel they are writing into a slot.
- The version + hash line stays. It is the thing that makes the decision a
  record, and it is 12px of mono; it costs one line.

---

## 6. `WrapSlate`

A persistent mono strip in the workspace header. Ephemerality is stated, never
sprung.

### Anatomy

```
<aside role="region" aria-label="Engagement lifecycle">
  <Row justify=between gap=3>
    ├─ Row gap=2 (the records)
    │   ├─ Mono  WRAP +12d
    │   ├─ span  ·
    │   ├─ Mono  PURGE IN 48d
    │   └─ Badge RETAINED            (paid plan only, replaces the countdown)
    └─ Button quiet sm   Export
  </Row>
</aside>
```

### Rules

1. **Never dismissible.** No close control, no collapse, no "remind me later".
   It is also the conversion surface.
2. Rendered on **both** sides. The client sees the same countdown the agency
   sees (PRD §5.6). It is not an agency-internal warning.
3. `daysToPurge === null` (retaining plan) → the countdown is replaced by
   `<Badge tone="neutral">RETAINED</Badge>` and the strip stays. The strip's job
   is to say what happens to this workspace; "nothing" is an answer.
4. Full mono. This whole strip is a record.

### Tokens

| Part | Class |
|---|---|
| Strip | `w-full bg-paper border-b-hairline border-rule-strong px-3 h-9 sticky top-0 z-slate` |
| Records | `<Mono tone="ink" size="12">`, uppercase source strings |
| Separator | `text-muted` middle dot, `aria-hidden` |
| Export | `<Button tone="quiet" size="sm">Export</Button>` |

### Escalation — by weight, never by hue

| `daysToPurge` | Treatment |
|---|---|
| > 14 | `<Mono tone="muted">` |
| 8–14 | `<Mono tone="ink">` |
| 1–7 | `<Mono tone="ink" className="font-semibold">` and the strip border goes `border-rule-strong` → `border-ink` |
| 0 (purges today) | As above, plus a second line: `text-14 text-ink font-medium` — "Everything in this workspace is deleted today. Export now." |

The countdown never turns red. `--breach` is a breached commitment; a scheduled
deletion the user was warned about four times is not a breach, it is the
contract working. See `FLOWS.md` §3 for the full purge-warning experience.

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover / focus | Only on `Export`. |
| loading | The strip renders with `WRAP —` / `PURGE IN —` in `text-muted`. It never disappears while loading; a lifecycle strip that flickers out is worse than one that says "—". |
| empty | Not possible — an engagement always has a status. |
| disabled | Export disabled only while an export is already running; label becomes `Preparing…` with `<Button loading>`. |
| error | Export failed: the strip keeps its records and the button reverts, with `role="alert"` text below: "Export failed. Try again — nothing has been deleted." |

### Name / role

`role="region"`, `aria-label="Engagement lifecycle"`. Each `Mono` carries its own
`label`: "Days since wrap", "Days until purge". A reader hears
"Engagement lifecycle region: days since wrap 12, days until purge 48, Export
button".

### 360

- Height grows to `h-auto`, `py-1.5`, and the records wrap to two lines.
- `Export` stays on the first line, right-aligned, and shrinks to `size="sm"` —
  it is already the smallest size.
- The strip remains sticky. It costs 36–56px and it is the one piece of chrome
  that must never be scrolled away.

---

## 7. `AttentionList`

The agency's portfolio home. Grouped by actionability, not by deadline (PRD §5.5).

### Anatomy

```
<Stack gap={6}>
  <section aria-labelledby>                      one per bucket, fixed order
    ├─ Row justify=between baseline
    │   ├─ h2   BLOCKED ON YOU                   lane header treatment
    │   └─ Mono 4
    ├─ Rule weight="strong"
    └─ ul
        └─ li  → AttentionRow
  </section>
</Stack>
```

### Bucket order and copy — fixed

Rendered in this order always, whatever the counts:

| `AttentionBucket` | Heading | Empty-state line |
|---|---|---|
| `blocked_on_you` | `BLOCKED ON YOU` | "Nothing is waiting on you." |
| `blocked_on_your_team` | `BLOCKED ON YOUR TEAM` | "Nothing is waiting on your team." |
| `with_the_client` | `WITH THE CLIENT` | "Nothing is with a client." |
| `no_movement_7d` | `NO MOVEMENT IN 7 DAYS` | "Everything has moved this week." |

A bucket with zero items still renders its heading and its empty line. Hiding an
empty bucket makes the page reflow every morning and destroys the muscle memory
that makes this screen fast.

### `AttentionRow` anatomy

```
<a>
  ├─ PossessionBar edge                 3px
  ├─ Row justify=between gap=2 baseline
  │   ├─ Stack gap={0}
  │   │   ├─ span  Hero film cutdown      16, body, truncate
  │   │   └─ span  Northwind — Q1 launch  12, muted, engagement title
  │   └─ Row gap=2
  │       ├─ Mono   4/2                   breach tone when roundsBreached
  │       ├─ Mono   client · 9d
  │       └─ span   14 Mar                due date, body, muted
</a>
```

### Tokens

| Part | Class |
|---|---|
| Section heading | `font-display text-lane uppercase text-ink` |
| Count | `<Mono tone="muted">` |
| Row | `bg-paper-2 border-hairline border-rule rounded-md pl-3 pr-2.5 py-2` |
| Row hover | `bg-paper-hover border-rule-strong` |
| Row gap | `gap-y-1` — tighter than the board; this is a list, not a board |
| Card title | `font-sans text-16 text-ink truncate` |
| Engagement title | `font-sans text-12 text-muted truncate` |
| Rounds breached | `<Mono tone="breach" label="Rounds used, over contract">` |
| Possession | `<Mono tone="muted">`, `tone="ink" font-semibold` past 7 days |

`roundsBreached` from `AttentionItem` is the **only** `--breach` on this screen.
Not the overdue dates. Not the 7-day bucket.

### States

| State | Rendering |
|---|---|
| default | As above. |
| hover | Row ground and border step up. No movement. |
| focus-visible | Global ring on the row link. |
| disabled | Not applicable. |
| loading | All four headings render immediately (they are static), each with three loading rows. The page never renders as a blank column. |
| empty (a bucket) | The bucket's line from the table above, `text-14 text-muted`, `py-2`. |
| empty (all four) | The four empty lines, plus, once, below them: "Nothing needs you right now." in `text-16 text-ink`. Do not replace the buckets with a single empty state — a reader needs to see that the four questions were asked and answered. |
| error | Per-bucket: "This list could not be loaded." + `quiet` `Retry`. One bucket failing does not blank the page. |

### Name / role

Four `<section aria-labelledby>` each containing a `<ul>`. Row accessible name:

> "Hero film cutdown, Northwind — Q1 launch, 4 of 2 rounds used, over contract,
> with the client for 9 days, due 14 March"

The bucket is *not* repeated in each row's name — it is the section heading, and
a reader in list mode already has it.

### 360

- Rows go full width.
- The meta `Row` drops below the titles instead of sitting beside them; the row
  grows to two lines and about 68px.
- Due date is the first thing dropped if space runs out, because possession and
  rounds are the two facts this screen exists to deliver.

---

## Appendix — the loading placeholder

One implementation, used by every component above.

```tsx
<span aria-hidden="true" className="block bg-rule rounded-sm" style={{ height, width }} />
```

`bg-rule` at 1.40:1 on paper is deliberately a low-contrast block: a placeholder
that reads as strongly as content produces a page that appears to be full of
data that then changes. Wrap the region in `aria-busy="true"` with a single
visually hidden "Loading …" — not one per block.
