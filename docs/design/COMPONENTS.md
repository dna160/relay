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

> **Round 4 — the control changed, and the reason is worth more than the
> change.** A person who had used the deployed product asked: *"What's the
> export button for? Any reason why it should be on the front?"* The placement
> was right and the control was wrong, and the two are not in tension. Three
> things were true at once, and all three had to be fixed:
>
> 1. **The label was a bare verb.** `Export` with no object, standing alone on a
>    strip whose subject is deletion. A reader with no other information will
>    take the only control on a strip to be the answer to the strip, and
>    exporting is the one thing that does *not* stop a purge. The settings page
>    already knew this and says so in a sentence — "Exporting takes a copy; it
>    does not stop the destruction" — which is a sentence written because
>    somebody already made this mistake in prose. The strip made it in a button.
> 2. **The control was the other side's.** `FLOWS.md` §3 assigns the agency
>    **Keep this workspace** and the client **Export everything**, and states
>    that they are never swapped. The slate rendered the client's action on the
>    agency's header, which is precisely the swap that section forbids — and
>    then `DESIGN-SYSTEM.md` called the strip "the conversion surface", which on
>    the agency side it therefore was not. Neither document was wrong; the
>    component satisfied one sentence of one of them and inherited the other.
> 3. **There is no context beside the countdown for 46 of the 60 days.**
>    `FLOWS.md` §3 attaches explanatory prose only at ≤14 days. Before that the
>    strip is two numbers and an unexplained verb, which is exactly the state
>    the feedback was filed against.
>
> The diagnosis in the brief — *one control doing two unrelated jobs* — is
> nearly right and inverted. The control was doing one job. The **strip** was
> claiming two, and the control it had could only do the smaller one.

### Anatomy

```
<aside role="region" aria-label="Engagement lifecycle">
  <Row justify=between gap=3>
    ├─ Row gap=2 (the records)
    │   ├─ RegistrationMark
    │   ├─ Plate layout="strip"      WRAP +12d · PURGE IN 48d
    │   └─ Badge RETAINED            (retaining plan only, replaces the countdown)
    └─ ONE control — see the table below
  </Row>
</aside>
```

### The one control

| Surface | `daysToPurge` | Control | Tone / size |
|---|---|---|---|
| Agency | a number | **`Keep this workspace`** | `<Button tone="quiet" size="sm">` |
| Agency | `null` (`RETAINED`) | *none* | — |
| Client | a number | **`Export everything`** | `<a class={buttonClass('quiet','sm')}>` |
| Client | `null` (`RETAINED`) | **`Export everything`** | unchanged |

- **The agency's control links to the retention section of the engagement's
  settings page**, which already carries the correct sentence about what
  retaining is and what it is not. It is not a new destination and not a new
  paragraph; the anchor already exists for the ≤14-day board strip to point at.
- **The agency's export does not live here.** It lives on the settings page,
  beneath the sentence that distinguishes it from retaining, and on the ≤14-day
  board strip where §3 of `FLOWS.md` already places both actions together.
  Nobody exports a live workspace on day three, and putting the rescue where the
  conversion belongs cost the product both.
- **On `RETAINED` the agency strip carries no control.** There is nothing to
  keep. The badge is the whole answer and a button beside it would be a control
  with no job — the same defect one step quieter.
- **The client's control never changes with the plan**, in either direction. The
  client's export is never paywalled and never withdrawn: their right to take a
  copy is not a function of somebody else's billing (`FLOWS.md` §3).
- **`Export everything`, never `Export`.** Same label wherever it appears —
  slate, board strip, settings page, email — per `FLOWS.md` §3 and the
  verb-takes-an-object rule in `DESIGN-SYSTEM.md`.

### The client does not read the word "purge"

The plate's terms are `WRAP` and `PURGE`. Those are Relay's nouns, from the
vocabulary table, and they are correct on the agency's surface. On the client's
surface `PURGE` is an internal word printed at somebody who has never used
Relay — one line above a control they are then expected to infer the purpose of.
Every other piece of client copy in the product already says *deleted*.

**Client surface: the term is `DELETED`.** The value (`IN 48d`), the `<time>`,
the `title` and the escalation are untouched — this is one `<dt>` string, and it
is the difference between a record and a record in a language the reader speaks.

### Rules

1. **Never dismissible.** No close control, no collapse, no "remind me later".
2. Rendered on **both** sides. The client sees the same countdown the agency
   sees (PRD §5.6). It is not an agency-internal warning. *The countdown is what
   is shared; the control is not.*
3. `daysToPurge === null` (retaining plan) → the countdown is replaced by
   `<Badge tone="neutral">RETAINED</Badge>` and the strip stays. The strip's job
   is to say what happens to this workspace; "nothing" is an answer.
4. Full mono for the records. The control is not mono — a button label is never
   mono (`Mono`'s own contract).
5. **One control, at most.** Two controls on a 36px strip is unreadable at
   360px and it re-opens the question this section exists to close: which of
   these is the answer to the countdown?

### Tokens

| Part | Class |
|---|---|
| Strip | `w-full bg-paper border-b-hairline border-rule-strong px-3 h-9 sticky top-0 z-slate` |
| Records | `<Plate layout="strip">`, `<Mono tone="ink" size="12">`, uppercase terms |
| Separator | `text-muted` middle dot, `aria-hidden` |
| Control | `<Button tone="quiet" size="sm">` — never `agency`/`client` filled: it does not hand the ball over |

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
| disabled | Client: export disabled only while an export is already running; label becomes `Preparing…` with `<Button loading>`. Agency: `Keep this workspace` is a link and is never disabled — it goes to a page that explains itself. |
| error | Client, export failed: the strip keeps its records and the button reverts, with `role="alert"` text below: "Export failed. Try again — nothing has been deleted." |
| not wrapped yet (agency) | The `WRAP` control stays exactly where it is, at the head of the strip, before the records. It is the control that *starts* the countdown and it is not the one control this section is about — a strip with no countdown on it yet has nothing to convert against. Once `wrappedAt` is set it disappears and `Keep this workspace` is the only control. |

### Name / role

`role="region"`, `aria-label="Engagement lifecycle"`. Each `Mono` carries its own
`label`: "Days since wrap", "Days until purge" — on the client, "Days until this
workspace is deleted". A reader hears "Engagement lifecycle region: days since
wrap 12, days until purge 48, Keep this workspace link".

The control takes `aria-describedby` pointing at the countdown's `<dd>`, so a
reader who tabs straight to it hears *what it is the answer to* rather than an
orphaned verb. This is the accessible form of the same fix: the control and the
countdown are one statement, and only one of them said so.

### 360

- Height grows to `h-auto`, `py-1.5`, and the records wrap to two lines.
- The control stays on the first line, right-aligned, at `size="sm"` — it is
  already the smallest size. `Keep this workspace` is three words and wraps
  badly at 360px; it truncates from the right with no ellipsis and keeps its
  full accessible name. Do not shorten it to `Keep` — that is the bare verb
  again, one screen size down.
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

## 8. `UploadDock`

The agency's upload surface. Two mounts, one component:

| Mount | Presign body | Records with |
|---|---|---|
| Card detail → **Add a version** | `{ engagementId, cardId, … }` | `POST /api/versions` (carries `sha256`) |
| Reference shelf → **Add files** | `{ engagementId, … }`, no `cardId` | `POST /api/reference-files` (no `sha256` field) |

This is the flow most likely to be met at 3am on a delivery deadline, on hotel
wifi, with a 4 GB master. It is specified accordingly: **the file list is the
component**, the drop zone is a detail of it, and every terminal state names
which of the four steps failed and what the operator can do about it.

Sequence, failure matrix and copy are in `docs/design/FLOWS.md` §4. This section
is anatomy, state and accessibility.

### Anatomy

```
<section aria-labelledby="upload-h">
  ├─ Row justify=between baseline
  │   ├─ h2  ADD A VERSION                      lane header treatment
  │   └─ Mono  2 of 4 · 1.2 GB left             aggregate, only while active
  ├─ Rule weight="strong"
  ├─ div[data-dropzone]                          the target — see below
  │   ├─ p     Drop files here, or              16 body
  │   ├─ Button tone="quiet" size="md"  Choose files
  │   ├─ input[type=file] hidden                 the real control
  │   └─ p     Up to 5 GB each.                 12 muted
  └─ ul[aria-label="Uploads"]                    one li per file, insertion order
      └─ li → UploadRow
</section>
```

The drop zone is **not** the accessible control. `<input type="file">` is, kept
in the DOM, visually hidden but focusable, labelled by the same heading; the
`Choose files` Button forwards its click. Drag-and-drop is an accelerator laid
over a working file input, never the only way in — the same rule that governs
the board's drag ordering.

`data-dropzone` also listens on `window` for `dragover`/`drop` so a file dropped
anywhere on the card detail lands in the dock rather than being opened by the
browser as a navigation. `preventDefault` on both, always, including when the
dock is disabled — a dropped 4 GB master that navigates the tab away is how an
operator loses their board state.

### `UploadRow` anatomy

```
<li>
  ├─ div[edge]                                   3px, --rule-strong; --agency once done
  ├─ Row justify=between gap=2 items-start
  │   ├─ Stack gap={0} min-w-0
  │   │   ├─ span   Northwind_master_v4.mov      16, body, truncate, dir="ltr"
  │   │   ├─ Mono   1.4 GB · 62%                 12, muted — the record line
  │   │   └─ p      Sending · part 31 of 80      12; phase, or the failure reason
  │   └─ Row gap={1} shrink-0
  │       ├─ Button tone="ghost" size="sm"       Pause / Resume / Retry
  │       └─ Button tone="ghost" size="sm"       Cancel / Remove
  └─ div[role=progressbar]                       2px, full width, bottom edge
</li>
```

Row height 64px, growing to 80px when the third line carries a failure reason.
Nothing is ever removed from the list automatically — a completed row stays,
greyed to `--muted` with a `done` mark, until the page is left. An upload that
vanishes on success is an upload the operator cannot prove happened.

### The four steps, and why the row names them

An upload is four things that fail differently:

| # | Step | State | What a failure means |
|---|---|---|---|
| 1 | Read + hash the bytes | `hashing` | Local. The file moved, or the disk is unreadable. Nothing was sent. |
| 2 | `POST /api/uploads/presign` | `requesting` | Session, permission, archived engagement, or size ceiling. Nothing was sent. |
| 3 | PUT to storage (± complete) | `transferring` | Network, or an expired window. Bytes were sent and are not yet recorded. |
| 4 | `POST /api/versions` \| `/api/reference-files` | `recording` | **The bytes are in the bucket and the app does not know.** Retry is safe and is the only correct action. |

A single "Upload failed" across all four is unusable: step 2 needs a different
human action from step 4, and step 4 in particular must never be answered by
re-sending 4 GB. The row's third line always names the step.

### State machine

```
queued ──▶ hashing ──▶ requesting ──▶ transferring ──▶ recording ──▶ done
   │          │            │               │   ▲            │
   │          │            │               ▼   │            │
   │          │            │            paused ┘            │
   │          ▼            ▼               ▼                ▼
   └────────▶ failed ◀─────┴───────────────┴────────────────┘
                 │
                 └──▶ (Retry) re-enters at the step that failed, except
                      transferring-after-expiry, which re-enters at requesting
```

- `queued` — accepted, waiting for a transfer slot. **Two concurrent transfers
  maximum.** A third file uploading is a third file competing for the same
  uplink; serialising them makes each finish sooner and makes the progress
  numbers mean something.
- `hashing` — progress is bytes read, not a spinner. On a 4 GB file this is tens
  of seconds and an indeterminate indicator here reads as a hang.
- `transferring` — `single` mode reports bytes sent; `multipart` reports
  `part n of m`, because that is the unit that actually retries.
- `paused` — multipart only. Single-mode PUTs have no resumable unit, so their
  Pause control is not rendered rather than rendered disabled.
- `recording` — brief, but it gets its own state because its failure is the one
  with bytes at stake.

An implementation that folds hashing into the transfer read (one pass over the
file, hashing each 64 MiB chunk as it is sent) is permitted and preferred. If it
does, the row shows `Sending` from the start and **one** progress bar. Two
progress bars for one file is forbidden in either implementation.

### Tokens by part

| Part | Class |
|---|---|
| Section heading | `font-display text-lane uppercase text-ink` |
| Aggregate | `<Mono tone="muted">` |
| Drop zone, idle | `border-hairline border-dashed border-rule-strong rounded-md bg-paper-2 p-6 text-center` |
| Drop zone, drag-over | `bg-tint-agency border-agency` — the *only* hue change in the component, and it is agency possession, which is literally true: the file is with the agency |
| Drop zone, disabled | `opacity-45`, dashed border stays `--rule`, no drag response |
| Row | `bg-paper-2 border-hairline border-rule rounded-md pl-3 pr-2 py-2` |
| Row edge | `bg-rule-strong`; `bg-agency` at `done`; `bg-ink` at `failed` |
| Filename | `font-sans text-16 text-ink truncate` |
| Record line | `<Mono tone="muted">` — 12px is `Mono`'s default |
| Phase line | `font-sans text-12 text-muted` |
| Phase line, failed | `font-sans text-12 text-ink font-semibold` |
| Progress track | `bg-rule h-0.5` |
| Progress fill | `bg-agency h-0.5`, `transition-none` |
| Done mark | `<Mono tone="muted">done</Mono>` — a word, not a tick glyph |

**No `--breach` anywhere in this component.** A failed upload is not a breached
commitment; it is a failed upload. It is marked by weight, by an `--ink` row
edge, by `role="alert"` on the phase line and by the words in it. This follows
the same ruling as validation and server errors.

**The progress fill does not animate.** `transition-none` is deliberate: a
width transition on a bar that updates every 64 MiB makes the bar lag the
number beside it, and the number is the truth. This is also why the bar is
paired with a mono percentage and never appears alone.

### States

| State | Rendering |
|---|---|
| default (idle) | Drop zone, empty list. The list element is not rendered when empty; the drop zone's own copy is the empty state. |
| hover | Drop zone: `bg-paper-hover`. Rows: `bg-paper-hover`. No movement. |
| focus-visible | Global ring on the file input (rendered around the drop zone via `focus-within`), and on every row Button. |
| drag-over | As the token table. Announced: the phase line region gets "Release to add 3 files." |
| disabled | The engagement is archived or purged. Drop zone `opacity-45`, input `disabled`, copy replaces with "This engagement is archived. Files can be exported but not added." No drop handler side effects. |
| loading | Not applicable — the dock has nothing to fetch. It renders instantly on mount, which is the point of putting the presign call at step 2 rather than on open. |
| empty | See default. |
| error | Per row. The section never renders a section-level error: one file failing must not disturb the other three. |

### Name / role

- Section: `<section aria-labelledby="upload-h">`, heading "Add a version".
- File input: `<input type="file" multiple>` with `aria-describedby` on the
  "Up to 5 GB each." line. Accessible name "Add a version".
- List: `<ul aria-label="Uploads">`. Each row is an `<li>`.
- Progress: `role="progressbar"` with `aria-valuenow` / `aria-valuemin=0` /
  `aria-valuemax=100` and `aria-valuetext` set to the human string
  (`"62 percent, part 31 of 80"`), because a bare 62 does not say what of.
- **One live region for the whole dock**, `aria-live="polite"`, not one per row.
  Four rows each announcing every percentage tick is a screen reader rendered
  useless. It announces state *transitions* only, throttled to one message per
  file per state:

  > "Northwind_master_v4.mov, sending." → "Northwind_master_v4.mov, added as
  > version 4."

- A **failure** escalates to `role="alert"` on that row's phase line, so it
  interrupts. A failure is the one thing in this component that has earned an
  interruption.
- Row buttons carry the filename in their accessible name — "Retry
  Northwind_master_v4.mov", not "Retry" — because four identical "Retry"
  buttons in a list is four identical buttons.
- `aria-busy="true"` on the `<ul>` while any row is not terminal.

### 360

- Drop zone keeps its copy but loses the dashed frame's padding to `p-4`.
- `UploadRow` stacks: filename, then record line and phase line, then the two
  Buttons on their own row, right-aligned, at `size="sm"` but padded to a 44px
  target. Row grows to ~96px.
- The aggregate `2 of 4 · 1.2 GB left` moves under the heading rather than
  beside it.
- Drag-and-drop does not exist on touch. The `Choose files` Button is therefore
  full width below `xs`, and is the primary control, not a secondary one.

---

## 9. `StreamStatus`

The visual language for the live event stream, including when it has dropped.

SSE reconnect is real: `GET /api/events?engagementId=` (agency) and
`GET /api/client/events` (client). A stream that dies silently is worse than no
stream at all — the board keeps rendering, looking authoritative, while a
decision the client made ten minutes ago is not on it.

### The rule

**Staleness is stated, never sprung.** The same principle as the wrap slate.
The board is allowed to be out of date; it is not allowed to be out of date and
quiet about it.

### Anatomy

One inline element, mounted in the workspace header beside the `WrapSlate` on
the agency side and at the foot of the client board on the client side.

```
<div role="status" aria-live="polite" className="flex items-baseline gap-1.5">
  ├─ span[aria-hidden] dot            6px, --rule-strong / --muted / --ink
  ├─ Mono                             LIVE | LAST SYNCED 14:02 | OFFLINE
  └─ Button tone="ghost" size="sm"    Refresh          (degraded and offline only)
</div>
```

### The three states, and the fourth that is not a state

| State | Condition | Mono label | Dot | Behaviour |
|---|---|---|---|---|
| `live` | Stream open, last event or heartbeat < 45s | `LIVE` | `bg-rule-strong` | Nothing else. No animation, no pulse. |
| `connecting` | First connect, or reconnecting, < 10s in | `LIVE` (unchanged) | unchanged | **Renders as `live`.** A reconnect that succeeds in two seconds must not flash a warning across the header. |
| `degraded` | Reconnecting > 10s, or no heartbeat > 45s | `LAST SYNCED 14:02` | `bg-muted` | `Refresh` appears. Data on screen is untouched. |
| `offline` | Reconnect has failed past the backoff ceiling, or `navigator.onLine` is false | `OFFLINE · LAST SYNCED 14:02` | `bg-ink` | `Refresh` appears. A hairline `--ink` rule is drawn under the header. |

The dot is **decorative and `aria-hidden`** — the mono label already says it. A
pulsing dot is the exact motion this product does not have; the escalation from
live to offline is carried by the label changing from a word to a timestamp,
which is a stronger signal than a colour anyway, and by the dot going *darker*
rather than redder. `--breach` does not appear here: a dropped stream is not a
breached commitment.

`LAST SYNCED` is a mono time because it is a record — it is the exact fact the
operator needs to reason about what they might be missing.

### Escalation — by weight and surface, never by hue

| Elapsed since last event | Treatment |
|---|---|
| < 45s | `LIVE`, `text-muted` |
| 45s – 5m | `LAST SYNCED 14:02`, `text-muted` |
| 5m – 30m | Same, `text-ink` |
| > 30m, or offline | `text-ink font-semibold`, plus a full-width hairline `border-t border-ink` under the header, plus the banner below |

### The stale banner — over 30 minutes, or offline

Only past 30 minutes does the status grow a surface. Above the board, one line,
full width, `bg-paper-2 border-l-bar border-l-ink px-3 py-2`:

> **This board has not updated since 14:02.** Changes made since then are not
> shown. **Refresh**

Not dismissible while the condition holds — the same reasoning as the wrap
slate. Dismissible staleness is staleness you will forget about at the exact
moment it matters.

### What must never happen

- **The board must not blank, spinner, or reorder on reconnect.** The last known
  state stays on screen. A stream drop is a failure to *learn* about changes,
  not a loss of what is already known; clearing the board turns a minor
  degradation into a total one.
- **No toast.** A toast for a reconnect is motion the product does not have, and
  it disappears before the person who needed it looks up.
- **No automatic full-page reload.** `Refresh` refetches the REST projection and
  re-opens the stream in place. An operator mid-way through typing a revision
  note does not get their work discarded by the network.
- **Reconnect backoff must be capped and jittered** — 1s, 2s, 4s, 8s, 15s, 30s,
  then 30s with ±20% jitter forever. A tab left open overnight on a laptop lid
  must not reconnect-storm the server at 06:00 alongside every other tab.

### The client side is quieter

The client sees the same component with two changes: it renders at the **foot**
of the board rather than the header, and the `live` state renders **nothing at
all** — an empty element with no label. An uninvested client on a phone does not
need to be told the websocket is healthy; they need to be told, and only told,
when what they are looking at is old. Degraded and offline render identically
to the agency side, because at that point the information is the same
information.

### Name / role

`role="status"` with `aria-live="polite"` on the wrapper, so a state change is
announced without interrupting. The announced string is the full sentence, not
the abbreviation:

> "Live." → "Last synced at 14:02. Reconnecting." → "Offline. Last synced at
> 14:02."

The stale banner is **not** `role="alert"`. It is a persistent condition, not an
event; `role="alert"` would re-interrupt on every re-render. It is a
`role="region"` with `aria-label="Connection"` inside the same polite live
region.

### 360

- The status sits under the engagement title rather than beside it.
- `LAST SYNCED 14:02` truncates to `14:02` below `xs` — the dot and the darkened
  ink carry the rest, and the banner carries the full sentence when it matters.
- The banner is full-bleed and wraps to two lines. `Refresh` becomes a
  full-width `quiet` Button beneath the text, not an inline link.

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

---

# Round 3 — the label primitives and the motion hooks

Two new documents sit behind this section: `docs/design/LABEL-SYSTEM.md` (what
the spec-label vernacular is, what ships, and what was rejected) and
`docs/design/MOTION.md` (the motion system, the label-attach, the restraint
list). This section is the part the front-end implements against.

## 10. `Plate`

The batch/serial block off an industrial spec label: a dense mono `<dl>` on a
recessed ground, carrying values that are already records.

### Anatomy

```
┌──────────────────────────────┐   layout="stack"
│ CARD          01H8QK…        │   dt: text-eyebrow uppercase --muted
│ VERSION       v4             │   dd: Mono, --ink (or a tone)
│ SHA           3a91f2…        │
│ ROUNDS        3/2            │   tone="breach" only when over contract
└──────────────────────────────┘

┌─────────────────────────────────────────────┐   layout="strip"
│ WRAP +12d │ PURGE 2026-09-14 │ OBJECTS 148  │   hairline-divided, one line
└─────────────────────────────────────────────┘
```

### Props

`rows: readonly PlateRow[]` — `{ term, value, title?, tone? }`.
`layout: 'stack' | 'strip'` (default `stack`), `label`, `dieline`, `className`.

### Tokens

| Part | Token |
|---|---|
| ground | `--paper` (via `.plate`) — one step recessed on a `--paper-2` card, in both modes |
| border | `--rule`, hairline, `--radius-1` |
| term | `text-eyebrow` uppercase, `--muted` |
| value | `Mono`, `--ink` by default |
| strip dividers | `--rule` |

**No new contrast pair.** `--muted` and `--ink` on `--paper` are both already
in `CONTRAST_PAIRS`, in both modes. That was a constraint on the design, not a
happy result — a bespoke ground here would have been an unmeasured pair, which
is exactly how the old `--muted` shipped at 4.14:1.

### Rules

- `tone="breach"` on a row **only** for `roundsUsed > contractedRounds`. Never
  for "soon", never for a near purge date.
- `title` carries the unabbreviated value behind any truncation — the full
  hash, the full ISO timestamp. `Plate` passes it through to `Mono`.
- A plate is not a table of prose. Terms are one or two words.

### 360

`layout="stack"` is the fallback, and the primitive now does it rather than
leaving it to the call site: **a `strip` of more than three pairs renders as a
`stack` below `xs`.** Two or three pairs fit on one line at the 360px floor;
four do not, and a strip that wraps at the floor is a stack that has not
admitted it.

Above `xs` a strip can still wrap in a narrow container, so the divider also
changed: it is a **trailing** hairline on every pair but the last, not a leading
one on every pair but the first. `divide-x` put the rule at the head of each
item, which meant a wrapped line opened with a rule that divided nothing — the
first pair on line two separated from the edge of the plate. A trailing rule
ends line one *between* the pair it belongs to and the pair that follows it on
the next line, and line two starts flush.

Be honest about what the breakpoint can and cannot do. `xs` is a viewport
query, and whether a strip fits depends on the container and on how long the
values are — five pairs want roughly 660px, four want roughly 510px, and no
single breakpoint serves both. So **above `xs`, a long strip still wraps**; it
now wraps *well*, which is the difference between a component with a rough edge
and a component with a bug. A strip that wraps in practice is the call site
telling you it wanted `layout="stack"`.

## 11. `Barcode`

Code 39, encoding the value printed beneath it. **Not decoration** — the design
system's rule is that mono marks a record, and a barcode that encodes nothing
is decoration wearing a record's clothes. The argument, and the rejection of
QR, is `LABEL-SYSTEM.md` §3b.

### Where it may appear

The purge certificate, the export header, an expanded version-detail row.
**Never `CardTile`, never a version-stack row, never the board.** An
8-character prefix is ~50 subpaths; that is cheap once per document and
indefensible forty times on the surface with a 1.5s FCP budget.

### Props

`value` (normalised to `0-9 A-F -`; anything else is dropped), `label`,
`height` (28 on a certificate, 20 in a record row), `showValue` (default true),
`className`.

### Name / role

The `<svg>` is `aria-hidden` and `focusable="false"`. The accessible content is
the `Mono` line beneath it, named by `label`. A reader who heard both would
hear the same hash twice.

### Polarity — the one element in the product that does not follow the theme

The bars are `--barcode-bar` on a `--barcode-substrate` plate: **black on
white, in light, in dark and in print.** Not `currentColor`.

Round 3 shipped it in `currentColor`, which in dark mode is light bars on a
dark ground. The symbol still encoded correctly and could not be scanned — an
inverted Code 39 is, to most laser and CCD readers and to plenty of camera
decoders, not a symbol at all. On the purge certificate: the one document in
this product meant to be scanned, and the one that goes to a client's legal
team.

Bar/space polarity and the quiet zone are part of the **encoding**, not part of
the styling, so they are not the theme's to move. The plate covers the quiet
zone as well as the bars, plus four narrow modules above and below, because a
quiet zone painted in whatever ground the page happens to have is a quiet zone
that inverts. Both tokens are `!important` in `globals.css` §5, so a tenant
cannot invert a machine-readable mark either.

The right reading is not "an element that ignores dark mode". It is a printed
label stuck to the page, which is exactly what a barcode on a certificate is.
The human-readable line beneath the bars is **not** part of the plate: it is
text, it is `--ink` on the page ground, and it follows the theme like every
other record.

## 12. `RegistrationMark`

A printer's crosshair marking where a document was *issued*. One per document:
the head of the wrap slate, the head of a certificate, an export header.

`aria-hidden` unless given `label`, which it should not need. It is the only
circle in a product whose radius ceiling is 3px — a registration mark is a
circle by definition, and the exception is deliberate.

## 13. `Rule weight="hazard"`

A 6px band of achromatic `--ink` diagonals. **One referent: the purge
boundary.** The reference sheets draw hazard stripes in alert red; Relay cannot,
because `--breach` means one thing. `aria-hidden`, and never rendered without
text beside it saying what the boundary is.

## 14. Motion hooks, per component

Everything below is CSS. There is no JS timeline, no library, no
`requestAnimationFrame`, and no `motion-reduce:` variant anywhere. The
front-end's whole job is to make the right element *new* at the right moment.

| Component | Add | When |
|---|---|---|
| `CardTile` | `dieline` class on the card | always |
| `PossessionBar` | render the filled bar as the `ColourBar` primitive, passing the possession fill | always. The primitive carries `.colour-bar`, both ink layers, the memory of the outgoing hue, the remount and the first-mount suppression |
| `PossessionBar` | nothing further | **possession changes hands.** Do not hand-roll `animate-bar-draw origin-head` on a single re-keyed element: one element cannot be both the ink being laid down and the ink being covered, and doing it that way left the card with no bar for 120ms. `MOTION.md` §4b |
| `StateChip` → `Chip` | pass `attach` | **possession changes hands**, and only then. The primitive suppresses its own entrance on first mount, so nothing has to be passed to keep the server-rendered board still |
| `VersionStack` row | `animate-stamp` on the version pip | a version is published |
| `VersionStack` | `animate-seat stagger` + `style={{ '--stagger-index': i }}` on rows | the stack *gains* rows. Not on first render |
| `DecisionBar` | `animate-stamp` on the decision timestamp | a decision is recorded |
| `CardTile` rounds counter | `animate-stamp` | a round is consumed |
| `Dialog` | nothing — the primitive already carries `animate-sheet-in` and `backdrop:animate-scrim-in` | — |
| `Button` | nothing — the primitive already carries the one-beat press | — |
| Purge certificate | **nothing.** No motion, in either mode | — |
| Lane re-sort, board first paint, route change, hover | **nothing.** `MOTION.md` §5 | — |

Rule R1 from `MOTION.md` §3 governs all of it: **one event, one motion.** A
possession change animates the bar and the chip. It does not also animate the
card, the lane, the counter or the board. If a reader's eye has to choose where
to look, the motion has failed at the thing it was for.

### Things to delete while you are in there

- `src/components/agency/card-tile.tsx` passes `className="bg-paper"` to
  `StateChip` to give a neutral quiet chip a boundary on a card. **Delete it.**
  The chip's neutral ground is now `--tint-neutral` — the same 12% construction
  as the three possession tints, mixed from `--ink` — so it keeps a ground of
  its own on `--paper` and `--paper-2` alike and no call site has to know which
  one it is standing on. The override still wins while it is there, so the chip
  will look wrong (unrecessed) until it goes.
- `src/components/style-tokens.ts` and the same file's comments still refer to
  `--dur-chip`, which no longer exists. The Tailwind key `duration-chip` is
  unchanged and still correct — only the prose and the CSS variable name moved.

*(`src/components/agency/card-tile.tsx` no longer carries
`motion-reduce:transition-none`; that round-2 defect is closed. The allowlist
entry for it in `tests/unit/a11y-source.spec.ts` is now stale — QA's file, QA's
call, but an empty `KNOWN_CALL_SITE_OFFENDERS` asserts more than a subset check
with one dead name in it.)*

---

# Round 4 — the handoff, the picker, and the destructive-action pattern

> Added after the product owner used the deployed build. Two of the three items
> below were not visible from the code — they are only visible to somebody
> holding the interface and trying to get a job done with it.

## 15. `CopyField` (primitive)

A value the interface is **handing over**: one that has to leave the screen and
land somewhere else. Relay hands over three — the client link, a full sha256,
an export job id — and before round 4 every one of them was printed as raw text
with no affordance on it.

### The anatomy

```
<div>
  ├─ label            The client’s link                     14 / body / medium
  ├─ Row
  │   ├─ code         https://…/e/6b1f…                     mono, break-all, bg-field
  │   ├─ Button ghost Show                                  only when `secret`
  │   └─ Button quiet Copy link                              the primary act
  ├─ p                what the value is for                 12 / muted
  └─ p role=status    Copied to your clipboard.             12 / muted
</div>
```

### Rules

1. **The button carries the verb and the object.** `Copy link`, not `Copy`. A
   page with four copyable things and four buttons reading `Copy` has four
   controls a reader has to disambiguate by position.
2. **The result is shown where the action was taken** — a `role="status"` line
   under the control, the same shape `ExportControl` already uses. There are no
   toasts in this product. The button label does **not** mutate into `Copied`: a
   control that stops saying what it does has traded its label for a receipt.
3. **Nothing is on a timer.** No two-second revert, no fade. This product has
   one duration token and a dwell is not a duration; a state that vanishes on
   its own is also one a screen reader can miss. The status line stays until the
   value changes. A second press re-announces (the message is keyed by a press
   counter) rather than going silent because the string did not change.
4. **The value is a `<code>`, not an `<input readOnly>` and not an `<output>`.**
   A read-only input invites a click that does nothing. `<output>` is an
   implicit live region — revealing a masked value would read the whole token
   aloud to somebody who only wanted to look at it.
5. **The clipboard is allowed to refuse.** `navigator.clipboard` needs a secure
   context and a permission a browser may withhold. On refusal the component
   does not fail silently and does not claim success: it reveals the value,
   selects it, and says which keys to press. The point is that the person leaves
   with the value.
6. **`secret` masks by default and copy still works masked.** Revealing is for
   the person who wants to check the value, not a step on the path to taking it.

### When a value earns `secret`

Only when **all three** are true: it is a credential or credential-adjacent, it
is long enough that nobody would ever transcribe it by hand, and it has no
cheap per-item revocation. The client link is the only value in Relay that
qualifies today (see §17 below and `FLOWS.md` §6). A sha256 fails the first
test; an export job id fails all three.

### 360

The value and the buttons stack: `code` full width on line one, the buttons
right-aligned on line two. The buttons never shrink below `size="md"` (36px) —
this is the one control on the page whose job is to be pressed successfully on
the first attempt.

---

## 16. `Select` (primitive)

A native `<select>` in the `Field` shell.

Native for the same reason `Dialog` is built on `<dialog>` and the decision
bar's choice is two real radios: the platform ships the keyboard behaviour, the
typeahead, the mobile wheel and the screen-reader semantics, and a bespoke
listbox is a dependency's worth of code that gets one of those subtly wrong.

- Same control tokens as `Field`: 44px tall, 16px text, `bg-field`,
  `border-rule-strong`. Both numbers are floors, not preferences.
- `labelHidden` is available on `Field`, `Textarea` and `Select`. It hides the
  label visually and never removes it, and it exists for exactly two shapes: an
  inline box under a heading that already names it, and a control inside a `<dl>`
  whose `<dt>` is its name. It is the first of the two gaps `style-tokens.ts`
  names as blocking deletion of the legacy `input` string. The second — a mono
  control — is still open.
- **A select is for choosing among values that already exist. It is not for
  choosing among one.** See §17.

---

## 17. `AssigneePicker`

Who on the agency's side owns a card. Agency bundle only: `assignee` is an
internal field and the client projection cannot emit it (INV-1).

### Why this is not a detail-panel property

Two facts in the code make assignment structural rather than decorative, and
both were invisible from the design docs until round 4:

1. **`draft → assigned` is the only transition out of `draft`**
   (`domain/card/state-machine.ts`). The board's first move is literally named
   after this control. A product with no picker has a state machine whose first
   edge nobody can walk deliberately.
2. **`rankAttention()` buckets on `assigneeId`.** `blocked_on_you` requires
   `assigneeId === viewerUserId`; `assigneeId === null && stale` falls into
   `no_movement_7d`. So on a board where nothing is assigned, **`BLOCKED ON YOU`
   is permanently empty and `NO MOVEMENT IN 7 DAYS` silently fills up** — the
   agency's home screen degrades into a rot list, and it does so quietly, seven
   days after anyone would connect it to a missing picker.

That second one is the argument. The picker is not a convenience on a card; it
is the input to the screen the agency opens every morning.

### Two mounts, one component

| Mount | Shape | What it does |
|---|---|---|
| **Card detail, the assignee row** | `<Select labelHidden>` inside the existing `<dl>`; the `<dt>` "Assignee" is its label | a plain edit |
| **Card detail, while `state === 'draft'`** | the forward control reads **`Assign to…`** and *is* the picker | choosing a person is the transition |

In `draft`, assignment and the `draft → assigned` transition are **one act for
the person**. Whether that is one request or two is the back-end's call — INV-2
means only the state machine writes `cards.state`, so it may well be two — but
the interface must not ask somebody to pick a name and then separately press a
second button to tell the board about it. That is the shape that produces boards
full of unassigned cards.

**Not on `CardTile`.** The tile shows the result, never sets it: the tile is one
link and a control inside a link is a bad target, and there is no room at 304px.
This mirrors `FLOWS.md` §2 — the publish gate is not on a card tile either.

### The single-member case

An org with one member does not get a menu of one.

| Assignable members | Control |
|---|---|
| 1 | **`Assign to me`** — `<Button tone="agency">`. No `Select` is rendered at all. |
| 2+ | the `Select`, first option `Unassigned` |
| 0 | impossible — the viewer is one. If the endpoint returns zero that is a bug; render `Assign to me`, never an empty menu. |

Three reasons this is the right answer and not a special case:

- **Do not hide the control.** A solo agency still needs the card to leave
  `draft`, and there is no other edge out of it.
- **Do not auto-assign.** A card that assigns itself fills somebody's
  `BLOCKED ON YOU` with work they never accepted, and it is the same species of
  inference INV-14 forbids one step short of sending mail about it.
- **A menu of one is the interface making the user do its arithmetic.** One
  press, no list, no explanation — and when a second member appears the control
  becomes the picker with no migration and nothing to announce.

The count that decides this is **the members assignable on this engagement,
already resolved by `resolveAccess()`** (INV-11) — never a raw membership-row
comparison in the component, and never "every user in the org".

### `Unassigned` is a first-class option, not an ✕

`cards.assignee_id` is `ON DELETE SET NULL`, so the product already manufactures
unassigned cards without anybody choosing it — a person leaves, and their cards
become unassigned. A card that became unassigned that way must look identical to
one that was never assigned, because it *is* the same thing. So the null case is
the first option in the list, reading **`Unassigned`** — not "None", not "—".

### What an unassigned card looks like against an assigned one

| | Rendering on `CardTile` and `AttentionRow` |
|---|---|
| **Assigned** | the person's name, `font-sans text-12 text-muted truncate`, in the footer `Row` beside `PossessionBar.Label`. Not an avatar — this product has no images and no illustrations, and an avatar would be the first one. A name is prose, so it is not `Mono`. |
| **Unassigned** | `<Badge tone="neutral">UNASSIGNED</Badge>`, in the same slot |

The weighting is deliberately inverted from the usual. On a board whose home
screen buckets by *who is blocked*, the **missing** name is the more
consequential fact, so the absence gets the stamp and the presence stays quiet.
An assigned card is normal, and normal is not marked.

- **Never `--breach`, and no hue at all.** An unassigned card is not a breached
  commitment. `--breach` remains exhaustively `roundsUsed > contractedRounds`.
- **`PossessionBar` is untouched.** Possession is a *side*; assignment is a
  *person*. They are different axes and an assigned and an unassigned card in
  `in_progress` both carry the pine bar. Do not tint the bar by assignment.
- **In `AttentionList`**, an unassigned card in `no_movement_7d` renders the
  badge. That is the only place the rot bucket says *why* it is rotting, and it
  is what turns the bucket from a list of shame into a list of actions.

### Copy

The action keeps its name through the flow: the control says **`Assign to…`**,
the result says **`Assigned to Priya`**, the state chip already says
**`Assigned`**. One word, whole flow. Never "Owner", never "Responsible",
never "@".

### States

| State | Rendering |
|---|---|
| default | As above. |
| loading (members not yet read) | The row renders the current value as text with no control, `aria-busy`. Never an empty select. |
| saving | `<Select disabled>`; the chip crossfade on success is the feedback. |
| error | The previous value is restored and `role="alert"` reads "That didn't save. {server message}" in `text-ink font-semibold`. Not `--breach`. |
| archived engagement | The row renders the name as text and no control. There is no action to explain — same call `LaneColumn` makes about its Add button. |

### Motion

**None.** The chip crossfades `Draft → Assigned` through the existing
`chip-in`/`chip-out`, and that crossfade is the feedback — the same answer the
publish gate gives, where the chip change *is* the notification. `stamp` is not
extended to assignment: `stamp` means a record was made (a version published, a
decision recorded, a round consumed) and an assignment is an edit. Keeping the
trigger list short is what keeps `stamp` meaning anything.

### Name / role

`<select>` labelled by the `<dt>` via `labelHidden`. `aria-describedby` carries
"Only people on this engagement can be assigned." where the list is shorter than
the org. The single-member button's accessible name is its visible label.

### 360

Full width; in the `<dl>` the row goes to two lines with the control on the
second. 44px, 16px — the agency has phones too, and the token set is one.

---

## 18. The destructive-action pattern

> Applies to every control in the product that removes something. Today that is
> a card and a lane; the shape is written so the next one does not get invented
> from scratch.

### First, the fact that determines the whole pattern

**Relay destroys bytes in exactly one place, and it is not a button.**

`lanes → cards → asset_versions → approvals` are all `ON DELETE CASCADE`, so a
literal `DELETE FROM lanes` would destroy the approvals that ADR-004 says must
survive a dispute six months later, the versions INV-4 says are append-only, and
the possession ledger INV-5 says is the sole source of the clock. INV-7 gives
exactly one path that may destroy an engagement's content and it ends in a
`purge_certificate`.

So `removeCard()` / `removeLane()` (ADR-026) take the **least destructive
mechanism that satisfies the request** and report which one they used:

- **discard** — a real delete, permitted only when the cascade has nothing to
  cascade to: no versions, no transitions, no comments. That is a typo or a
  mis-drag.
- **archive** — everything else. It leaves both boards; every version, approval,
  transition and comment stays exactly where it was.

### The design obligation that creates

**The caller does not choose the mechanism. The interface must still say which
one is about to happen, before the press.**

"Nothing is destroyed" and "this row is deleted" are different promises and only
one of them can be made about any given card. A single confirmation that hedged
across both would be false half the time — and it would be false in the
direction that matters, because the half it comforts wrongly is the half
carrying approvals. `cardDependents()` is a read, the counts are knowable in
advance, and therefore the dialog is written from them.

### The three tiers, chosen by what survives — never by how frightening the word is

| Act | Surface | Confirmation |
|---|---|---|
| **Discard** a card carrying nothing | card | **No dialog.** A `ghost` control and a `role="status"` undo line. Nothing is being destroyed; a modal here trains people to click through modals. |
| **Archive** a card carrying versions, approvals or history | card | `Dialog dismissible` — the survivor plate, below |
| **Discard** an empty lane | lane | `Dialog dismissible`, one line: it holds nothing |
| **Archive** a lane holding cards | lane | `Dialog dismissible` — **and the card count is the headline**, because hiding twelve cards with one press is the largest blast radius available to a person in this product |
| **Wrap** | engagement | `Dialog dismissible` stating the purge date it creates |
| **Purge** | engagement | **not a control.** A deadline the interface has stated since screen one |

### The dialog

```
<Dialog title="Archive this deliverable?" dismissible>
  ├─ p   text-14 text-ink     what leaves
  ├─ Plate layout="stack"     WHAT IS KEPT — versions, approvals, comments, first/last dates
  ├─ p   text-14 text-muted   the guarantee, with the purge date in it
  └─ footer   [Cancel ghost]  [Archive it  quiet]
```

**Rules, and every one of them is a rejection of a habit:**

1. **Lead with what survives.** A normal delete confirmation leads with what is
   destroyed. In Relay the answer is usually "nothing", so leading with the
   destruction would be leading with a falsehood. Never ship the sentence
   "This cannot be undone" on an act that can be.
2. **The survivor list is a `Plate`, not prose.** Counts are records and this
   product sets records in mono (`LABEL-SYSTEM.md` §3a). It is also the object
   that makes the decision, so it should be the densest thing in the dialog.
3. **Say whether the client has seen it.** A card silently vanishing from a
   client's board is a worse outcome than the removal itself, and it is the one
   the agency cannot see. Zero transitions is a sound proof of never-seen
   (INV-2 + INV-5), so the dialog can say it truthfully:
   - seen: **"The client has seen this. It disappears from their board too."**
   - not: **"The client has never seen this."**
4. **No `--breach`, and no red button.** The `Button` primitive has no `breach`
   tone and must not grow one — a red Delete would spend the one colour that
   means a contracted round was exceeded. Destructive confirm is
   `tone="quiet"`; Cancel is `ghost`.
5. **No hazard rule.** `Rule weight="hazard"` has exactly one referent in this
   product — the purge boundary (`LABEL-SYSTEM.md` §3d) — and a removal dialog
   is not it. This is the entry that keeps that rejection real.
6. **`dismissible` is `true`.** A dialog you cannot escape is for an act that
   cannot be undone. Archiving can be undone; discarding an empty card destroys
   nothing anyone will miss.
7. **No typed confirmation.** Reserved for an act that destroys bytes, which is
   nothing a user can press today. Making somebody type `DELETE` to archive a
   card inflates the act and trains the reflex that will one day type through
   the one that matters.
8. **Nothing animates beyond the dialog's own `sheet-in` / `scrim-in`.** No
   shake, no flash, no red pulse.
9. **The undo is offered where the action happened.** A `role="status"` line at
   the head of the lane: *"Hero film cutdown archived. `[ Put it back ]`"*. Not
   a toast — there are none. Not on a timer — there are none. It persists until
   the page changes, which is longer than any toast and costs nothing.

### How it differs from wrap and from purge

A person should be able to read these three sentences off the interface without
a manual, and the axis they differ on is **when the bytes go** — which is not
the same axis as "how alarming is this button":

- **Archive** takes one deliverable, or one column, off the board. *Nothing is
  deleted.* Reversible.
- **Wrap** ends the engagement and starts the countdown. *Nothing is deleted
  yet* — it sets the date.
- **Purge** destroys the bytes on that date and leaves one certificate. It is
  not a control; it is the deadline the wrap slate, the sign-in footer and four
  emails have all been stating from the beginning.

Archiving a card is not a breach and never renders `--breach`. Archiving a card
whose `roundsUsed > contractedRounds` does not un-breach anything either — the
breach lives in the approval record, and the approval record survives. That is
the whole point of the pattern.
