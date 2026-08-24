# Flows

> Three flows are specified here because three flows decide whether Relay works:
> the client's first five minutes, the agency's publish gate, and the purge
> warning. Everything else in the product is a variation on a board and a form.

---

## 1. The client's first five minutes

### Who this is for

A marketing manager at the client. They did not choose Relay. They have no
account and will never have one. They received a link in an email from their
agency, opened it on a phone between two meetings, and their intent is "deal with
this in under a minute". They are not hostile — they are **uninvested**, which is
worse, because uninvested users do not push through friction, they close the tab
and reply to the email instead. Every reply-to-the-email is a lost record.

### The target

**First meaningful action — an approval or a change request — inside five
minutes of the first tap, on a phone, on 4G.** Not first paint. Not first
session. The decision.

### The five screens

```
  email link
     │
  ①  VERIFY          one field, one button          ~40s
     │
  ②  BOARD           what this is, what awaits you   ~30s
     │
  ③  QUEUE           the things with them             ~20s
     │
  ④  CARD            the version and the decision     ~90s
     │
  ⑤  RECORD          it happened, and it is written   ~10s
```

Budget: 190s of user time, leaving ~110s of slack for reading and hesitation
inside a 5-minute target.

---

### ① Verify — one field, one button

The magic link lands here. This screen exists because a decision must bind to a
verified identity (PRD §5.4), and for no other reason. It must not feel like a
signup.

**Layout, phone-first, single column, `max-w-prose`, `px-4 pt-6`:**

| Element | Spec |
|---|---|
| Agency name | `font-display text-20 text-ink`. The tenant's name, and the tenant's `--agency` hue as a 3px rule beneath it. This is the only branding on the screen and it is the reason the user trusts the page. |
| Heading | `font-display text-28` — **"Northwind — Q1 launch"**. The engagement title. The user recognises their own project before they recognise Relay. |
| Line | `text-16 text-muted` — "Confirm your email to open the workspace. No account, no password." |
| Field | `<Field label="Your email" type="email" inputMode="email" autoComplete="email" autoFocus>`. 44px tall, 16px text (never smaller — 16px is what stops iOS zooming the viewport on focus). |
| Button | `<Button tone="client" size="lg" block>Open the workspace</Button>` |
| Footer | `text-12 text-muted` — "Relay · this workspace is deleted on 12 May." Ephemerality is stated here, on screen one, before it can be a surprise. |

**Copy that is not used:** "Sign in". "Create your account". "Get started".
"Welcome!". The user is not starting anything; they are opening a document.

**States**

- Submitting → `<Button loading loadingLabel="Opening">`.
- Wrong email → `text-14 text-ink font-semibold role="alert"` under the field:
  **"That email isn't on this engagement. Ask {agency name} to add you, or use
  the address the invitation was sent to."** It names the fix. It does not say
  "invalid".
- Link expired → the whole screen is replaced by: "This link has expired." plus
  `<Button tone="client" size="lg" block>Send me a new one</Button>`. One tap.
  Never make an uninvested user go and find the original email.
- Engagement purged (410) → "This workspace was deleted on 12 May. Your agency
  has the deletion certificate." No retry control — there is nothing to retry.

**Performance.** This page is the FCP budget's owner: 1.5s on 4G. It ships one
CSS file, no images, no client-side data fetching above the fold, and the three
`@font-face` rules with `font-display: swap` so the heading paints in the
fallback face immediately. Nothing on this screen waits on a font.

---

### ② Board — orientation in one glance

The user lands on the board, not on a dashboard, not on a tour.

**Above the fold on a 360×640 viewport, in this order:**

1. `WrapSlate` — 36px. `WRAP +0d · PURGE IN 60d · EXPORT`.
2. Engagement title, `font-display text-20`, 26px line.
3. **The one sentence that orients them**, `text-16 text-ink`, 24px:
   **"3 things are waiting on you."** — with the number in `Mono`. If zero:
   "Nothing is waiting on you right now."
4. `<Button tone="client" size="lg" block>Review what's waiting</Button>` — the
   jump to ③.
5. Below it, the collapsed lanes (see `COMPONENTS.md` §3 → 360): lanes with
   `awaitingYou` cards expanded, the rest collapsed with their counts visible.

That button is the whole design of this screen. An uninvested user should not
have to understand a kanban board to do the one thing they came to do. The board
is *there* — they can scroll, expand lanes, and read everything — but the
default path is a single tap.

**What is deliberately absent:** onboarding modal, product tour, tooltip
sequence, "invite your team", cookie banner (there are no non-essential cookies
to consent to — a client session cookie is strictly necessary), notification
permission prompt.

---

### ③ Queue — the things with them

Reachable from the button in ② and from a persistent count in the header.

A single `<ol>` of the cards where `awaitingYou === true`, ordered by `dueAt`
ascending with nulls last. Each entry is a `CardTile` (`COMPONENTS.md` §2) with
its chip in `variant="solid" tone="client"` reading **Your move**.

- Heading: `font-display text-lane uppercase` — `WAITING ON YOU` with a `Mono` count.
- Below the list, `text-14 text-muted`: "Everything else is with {agency name}."
  This is the sentence that stops the client feeling they are being handed the
  whole project.
- Empty: **"Nothing is waiting on you. {agency name} has the ball."**

Tapping an entry goes to ④. No intermediate.

---

### ④ Card — the version and the decision

The single most important screen in the product on the client side.

**Order on a phone, top to bottom:**

| Order | Element | Why here |
|---|---|---|
| 1 | Card title, `font-display text-20` | What this is |
| 2 | `Chip` solid client — **Your move** | Why they are here |
| 3 | The version preview / download row | The thing itself |
| 4 | `VersionStack`, current version expanded, older rows collapsed behind a ghost `Show 3 earlier versions` | The record |
| 5 | The description and any prior notes | Context |
| 6 | `DecisionBar`, `sticky bottom-0` | The action |

The `DecisionBar` is sticky from the moment the screen mounts. It is visible
before the user has scrolled, so the shape of the task ("there are two buttons at
the bottom and I will end up pressing one") is known within a second of arriving.

**Rounds are stated before the decision, not after.** If
`contractedRounds !== null`, a line sits directly above the DecisionBar in
`text-12 text-muted`: "This is revision round 2 of 2." When
`roundsUsed >= contractedRounds`, it becomes
`text-12 text-ink font-semibold`: "You have used both contracted revision
rounds. Further changes may be chargeable — {agency name} will confirm." This is
the single most valuable sentence in the product for the agency's margin, and it
has to be visible **before** the client requests changes, not in an invoice six
weeks later. It is not red. It is not a warning banner. It is a fact, stated in
the place where the decision is made.

**The decision itself** follows `COMPONENTS.md` §5 exactly. The one thing to
re-state: the submit button is disabled until the note has content when
"Request changes" is chosen, and the reason is always on screen next to it.

---

### ⑤ Record — it happened, and it is written

No toast. No redirect. The `DecisionBar` is replaced in place by a mono record
line with `role="status"`:

```
APPROVED · v4 · 3a91f2… · 14 Mar 09:12 · you
```

Below it, `text-14 text-ink`: **"{agency name} has been notified."** And a single
ghost button: `Back to what's waiting` — which, if the queue is now empty, lands
on ③'s empty state: "Nothing is waiting on you. {agency name} has the ball."

That last screen is the growth loop. A client who arrives uninvested and leaves
having done a whole thing in ninety seconds is a client who asks their other
vendors what that was.

### Measuring it

The five-minute target is testable, and should be, in `tests/e2e`: a Playwright
run from magic-link URL to `decision.recorded`, on a throttled 4G profile at
375×667, asserting wall-clock under 300s with human-plausible think time. That
test belongs to the QA agent; this document is what it asserts against.

---

## 2. The agency's publish-to-client gate

An internal review gate sits before `AWAITING_CLIENT` (PRD §5.2). Nothing reaches
the client projection until an agency member promotes it. This is the moment the
agency's private work becomes the client's record, and it is irreversible in the
sense that matters: the client saw it.

### Where it lives

On the agency's card view, in the `internal_review` state. Not on the board — a
promotion this consequential does not happen from a card tile.

### The gate

```
<Dialog title="Publish to client" dismissible>
  ├─ Row baseline: "You are publishing"  <Mono size=14>v4</Mono>  <Mono>3a91f2…</Mono>
  ├─ Stack: the checklist (see below)
  ├─ Field: "Note to the client" (optional)
  └─ footer:  [Cancel]  [Publish to client]
</Dialog>
```

**The checklist** — three read-only assertions, each with a `Mono` value, so the
person publishing sees what the client will see:

| Assertion | Rendering when clean | Rendering when not |
|---|---|---|
| Which version | `v4 · Hero_cutdown_v4.mp4 · 12.4 MB` | — |
| What the client can see on this card | `2 versions visible` | If the card is in a private lane: `<Badge tone="neutral" className="text-ink font-semibold">PRIVATE LANE</Badge>` and the publish button is **disabled** with the message "This card is in a private lane. The client cannot see it. Move it to a published lane first." |
| Rounds | `Round 2 of 2` | If `roundsUsed >= contractedRounds`: `text-ink font-semibold` — "This uses the last contracted round." |

The private-lane check is a UI courtesy over a structural guarantee: the client
serialiser cannot emit a private card regardless (INV-1). The dialog exists so
the agency does not publish into a void and then wonder why the client never
replied.

### Copy discipline

The button says **Publish to client**. After it succeeds, every subsequent
rendering of that fact says **Published to client** — the version stack row, the
activity line, the email subject. One name, whole flow. Not "Sent", not "Shared",
not "Released".

### States

| State | Rendering |
|---|---|
| default | Publish enabled. |
| private lane | Publish disabled, reason on screen, `Move to a published lane` ghost button beside it. |
| submitting | `<Button loading loadingLabel="Publishing">`; Cancel disabled. |
| success | Dialog closes. The card's `Chip` crossfades `In progress → Awaiting client` (120ms) and the `PossessionBar` edge crossfades `--agency → --client`. That colour change **is** the notification; there is no toast. |
| conflict (409, someone else moved it) | Dialog stays open, `role="alert"` in `text-ink font-semibold`: "This card has moved since you opened this. Reload to see where it is." with a `Reload` button. Nothing is submitted twice. |
| error | Same shape, server message, controls re-enabled. |

### The possession handover is the feedback

When the bar flips from pine to indigo across the board, the agency member sees
their column of work hand over. That is the product's core insight rendered as
the confirmation of an action, which is worth more than any success toast.

---

## 3. The purge warning — both sides

### The principle

Both sides are warned, on the same schedule, with the same facts (PRD §5.6). The
agency's contract with its client almost certainly obliges it to retain
deliverables; a silent purge manufactures a breach. So the client receives every
notice the agency receives, plus a one-click export of everything they can see.

### The three facts, always together

Every purge warning — in-app, email, and the `WrapSlate` — states exactly three
things, and a warning missing any of them is a bug:

1. **The date.** `12 May 2026`, absolute, never "in 14 days" alone. A relative
   countdown alone is unactionable in a calendar.
2. **The count.** `41 files · 12 cards · 3 approvals`. Volume is what converts
   an abstract deletion into a felt one.
3. **The one action that prevents it.** Exactly one, named, and different per
   side. Not a menu of options.

### The schedule and the one action

| Trigger | Agency's one action | Client's one action |
|---|---|---|
| At archive (day 30) | **Keep this workspace** → plan upgrade | **Export everything** |
| +14d (day 44) | Keep this workspace | Export everything |
| +23d (day 53) | Keep this workspace | Export everything |
| +29d (day 59) | Keep this workspace | Export everything |
| Purge (day 60) | — certificate delivered — | — certificate delivered — |

The agency's action is a conversion. The client's action is a rescue. They are
never swapped: never show a client an upgrade prompt for someone else's plan, and
never let the agency believe exporting is the same as retaining.

### In-app rendering — the escalation

Escalation is by **weight and surface area**, never by hue. `--breach` never
appears in a purge warning: nothing has been breached. The countdown works
exactly as it says it will.

| Days left | `WrapSlate` | Additional surface |
|---|---|---|
| 30–15 | `<Mono tone="muted">PURGE IN 30d</Mono>` | none |
| 14–8 | `<Mono tone="ink">` | On the board, above the lanes: a one-line `bg-paper-2 border-hairline border-rule-strong rounded-md p-3` strip with the three facts and the one button. |
| 7–1 | `<Mono tone="ink" className="font-semibold">`, strip border `border-ink` | The same strip, `border-ink`, and the count broken out onto its own line in `Mono`. |
| 0 | Second line in the slate: "Everything in this workspace is deleted today." | A `Dialog` on first load of the day, `dismissible` — it may be closed, but the slate and the strip remain. |

The day-0 dialog is the only interruption in the entire product, it appears once
per user per engagement, and closing it costs nothing because every fact it
contained is still on the page behind it.

### Exact copy

**Agency, in-app strip (day 44):**

> **This workspace is deleted on 12 May 2026.**
> 41 files, 12 cards and 3 approvals go with it. Northwind — Q1 launch has had
> no activity for 44 days.
> `[ Keep this workspace ]`  ·  Export everything

**Client, in-app strip (day 44):**

> **This workspace is deleted on 12 May 2026.**
> 41 files, 12 cards and 3 approvals go with it, including everything you
> approved.
> `[ Export everything ]`  ·  What happens to my files?

**Client, day 0:**

> **Everything here is deleted today, 12 May 2026.**
> 41 files, 12 cards and 3 approvals. Exporting takes one tap and gives you a
> zip of every file and decision you can see.
> `[ Export everything ]`

Not used, on either side: "Action required". "Don't lose your data!". "Final
warning". An exclamation mark. A countdown timer that ticks in seconds. The
product is calm about this because the product told the truth about it from
screen one.

### The export

- One `<Button tone="client" size="lg">Export everything</Button>` on the client
  side, `tone="quiet"` in the `WrapSlate`, same label in both places.
- Producing the archive is async: the button goes `loading` with
  `loadingLabel="Preparing your export"`, and a `role="status"` line reads
  "We'll email you a link when it's ready — usually under a minute."
- The client's export contains exactly what the client projection can see
  (INV-1). It is generated from the same serialiser, not from a second query
  written for export.
- Bytes never traverse the app server (INV-10): the export link is presigned.

### After the purge

Both sides receive the deletion certificate: a signed manifest of hashes, counts
and timestamp. In-app, the engagement's page is replaced by a single mono block —
the whole page, `max-w-prose`, centred:

```
PURGED · 12 May 2026 14:02 UTC
41 files · 12 cards · 3 approvals
CERTIFICATE 9f2c11…
[ Download certificate ]
```

Set entirely in `Mono` at `text-14`, on `bg-paper`, with `--rule-strong`
hairlines above and below. It is a receipt, and it should look like one. This is
the artifact an agency forwards to their client's legal team, which is how the
paywall's downside becomes a compliance feature.
