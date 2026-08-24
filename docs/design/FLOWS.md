# Flows

> Five flows are specified here because five flows decide whether Relay works:
> the client's first five minutes, the agency's publish gate, the purge warning,
> the upload, and first run. Everything else in the product is a variation on a
> board and a form.
>
> The upload and first run were added in Round 2. They are the two flows that
> were being built with no specification at all — one of them is the only way a
> file ever enters the product, and the other is the only door into the agency
> side of it.

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

---

## 4. The upload, end to end

### Who this is for

An editor at 02:40 with a 4.1 GB ProRes master, a client review at 09:00, and
hotel wifi. They are not going to read anything. They will look at one number
and decide whether to go to bed. **That number must be trustworthy and the
failure text must tell them what to do without a support ticket.**

The component anatomy is `docs/design/COMPONENTS.md` §8. This section is the
sequence, the resume rules, and the exhaustive failure matrix.

### The sequence

```
  ① select / drop            local              nothing sent
  ② hash                     local, streamed    nothing sent
  ③ POST /api/uploads/presign                   ~200 bytes
  ④ PUT direct to storage    single, or N parts + complete
  ⑤ POST /api/versions | /api/reference-files   ~400 bytes
```

Steps ③ and ⑤ are the only two that touch the app server, and neither carries a
byte of the file (INV-10, ADR-009). Step ④ is the browser talking to storage
directly, which is why the front-end — not the back-end — owns retry, part
ordering, and abort (ADR-015).

**Presign is requested at step ③, not on mount.** The URLs live one hour and the
clock starts when they are signed; signing them when the dock opens spends the
window on a person deciding which file to pick.

### The size boundary

| Size | Mode | Parts | Resume unit |
|---|---|---|---|
| ≤ 100 MB | `single` | — | none — retry is a restart |
| > 100 MB | `multipart` | `max(64 MiB, ceil(size / 1000))`, so ≤ 1000 parts | one part |
| > 5 GB | rejected client-side, before ③ | — | — |

At the 5 GB ceiling this is 80 parts of 64 MiB. The part is the retry unit and
the progress unit, which is why the row reports `part 31 of 80` rather than a
byte count during multipart transfer: a part that fails re-sends 64 MiB, not
4 GB, and the operator should be able to see that.

### Resume, precisely

Three different things get called "resume" and they are not the same:

1. **Pause / Resume inside the hour.** Multipart only. Part URLs are valid for
   an hour from signing; a paused upload resumes by PUTting only the parts not
   yet acknowledged. Free, and the common case.
2. **Reload inside the hour.** The queue item's manifest — key, `uploadId`,
   part URLs, part size, completed part numbers and ETags — is written to
   `sessionStorage` after every acknowledged part. On mount the dock offers
   "Resume Northwind_master_v4.mov — 62% already sent." The file handle is
   **not** recoverable, so resuming requires the operator to re-select the same
   file; the dock verifies size and name before continuing and refuses on a
   mismatch. State this in the copy: "Choose the same file to continue."
3. **After the hour.** The window has closed. A re-presign creates a **new**
   `uploadId` and a new key — `versionKey()` mints a fresh uuidv7 per call — so
   the bytes already sent cannot be reused. This is a restart and must be
   labelled one:

   > **This upload's window closed after an hour.** 2.6 GB was already sent and
   > cannot be reused. Restarting sends the whole 4.1 GB again. **Restart**

   Do not silently restart. An operator on a metered connection at 03:00 has a
   right to decide.

   *Back-end note:* the orphaned multipart upload is reclaimed by the bucket's
   `AbortIncompleteMultipartUpload` lifecycle rule (7 days, per ADR-015). If the
   abort URL is still valid the dock fires it on restart as a courtesy, and
   ignores the result — an abort that fails is not an error the operator caused.

### The failure matrix

Every row of this table is a distinct message. "Upload failed" is not an
acceptable rendering of any of them.

| Step | Condition | Copy on the phase line | Controls |
|---|---|---|---|
| ① | File > 5 GB | "That file is 6.2 GB. The limit is 5 GB." | Remove |
| ① | 0 bytes | "That file is empty." | Remove |
| ② | Read error / file moved | "That file could not be read. It may have been moved or renamed." | Retry, Remove |
| ③ | 401 | "Your session expired. Sign in again — nothing was sent." | Sign in, Remove |
| ③ | 423 `ENGAGEMENT_ARCHIVED` | "This engagement is archived. Files can be exported but not added." | Remove. Whole dock goes to `disabled`. |
| ③ | 410 `ENGAGEMENT_PURGED` | "This engagement has been purged." | Link to the certificate. Dock unmounts. |
| ③ | 404 `NOT_VISIBLE` | "That card is no longer here." | Remove |
| ③ | 402 / 500 / offline | "The upload could not be started. Nothing was sent." | Retry, Remove |
| ④ | Network drop, part | *silent* for the first three attempts — 1s, 4s, 10s, jittered. The row stays `transferring` and the phase line reads "Sending · part 31 of 80 · retrying". | Pause, Cancel |
| ④ | Network drop, part, past 3 attempts | "Part 31 of 80 keeps failing. Your connection may have dropped." | Retry, Pause, Cancel |
| ④ | 403 from storage (URL expired) | The hour-expiry copy above. | Restart, Remove |
| ④ | `navigator.onLine` false | "You are offline. This will continue when you reconnect." Auto-resumes on `online`; does **not** count against the retry budget. | Pause, Cancel |
| ④ | Complete call fails | "The upload finished but could not be assembled. Retrying is safe." | Retry (re-issues complete with the same ETag list), Cancel |
| ⑤ | Any failure | "**The file uploaded but was not recorded.** Retrying is safe and will not re-send it." | Retry, Remove |
| ⑤ | 409 / duplicate | "That version is already recorded as v4." Row goes to `done`. | Remove |

Step ⑤ is bolded in its own copy because it is the one failure where the naïve
reaction — cancel and start again — is exactly wrong. The bytes are in the
bucket. Retry is a 400-byte POST.

**Cancel** on a multipart upload fires the presigned abort URL, then removes the
row. Cancel on a single PUT aborts the fetch and removes the row; the partial
object, if any, is overwritten or lifecycle-collected — nothing in the app ever
learns about it, which is the trade ADR-015 accepted.

### What success looks like

The row goes `done`: edge turns `--agency`, the record line becomes the
permanent record —

```
v4 · 1.4 GB · 3a91f2…
```

— and the phase line becomes "Added as version 4. Not visible to the client
yet." with an inline `Publish to client` link to the gate in §2.

That last sentence is load-bearing. The single most likely misunderstanding in
this product is an agency believing an upload published something. It did not.
`POST /api/versions` records; `POST /api/cards/:id/publish` publishes. The
upload's success state says so, in the same words the gate uses.

### Measuring it

- Time from drop to first progress under 2s on a 4 GB file. If hashing blocks
  that, hashing is in the wrong place.
- A failed part never costs more than one part of re-transfer.
- Zero uploads that reach storage and are not recorded, per week, that a retry
  could not fix.

### One open constraint, stated

`crypto.subtle.digest` takes a single buffer and has no streaming form, so
hashing a 4 GB file by that route means 4 GB resident in the tab. The dock's
specification assumes an **incremental** sha256 over the same chunks the
transfer already reads — which, with no new dependency permitted, means a
hand-written digest in a Worker. That is an engineering decision for the
front-end and the Architect, not a design one, but the UI cannot be built
honestly without it being made: if hashing is one-shot, the `hashing` state is a
memory cliff rather than a progress bar, and the 5 GB ceiling is fiction.

---

## 5. First run — a user with no organisation

### Who this is for

Someone who just clicked a magic link in their email for the first time. They
have a session and no org. Every agency route 401s until `POST
/api/onboarding/org` runs. This is the entire door to the product's agency side
and it is one screen.

### The shape

One screen, `max-w-dialog` centred, on `bg-paper`. Not a wizard, not a
multi-step, not a progress indicator across the top. Two fields.

```
<main>
  ├─ span   RELAY                        eyebrow, muted
  ├─ h1     Name your studio             28 display
  ├─ p      This is what your clients see at the top of every workspace.
  │                                      16, muted, max-w-prose
  ├─ Field  Studio name        (required)
  │         hint: "Northwind Pictures"
  ├─ Field  Workspace address  (required)   font-mono
  │         hint: "Lowercase letters, numbers and hyphens. You cannot change this later."
  ├─ Mono   relay.app/northwind             live preview, 14, muted
  ├─ Button tone="agency" size="lg"      Create studio
  └─ p      Signed in as jo@northwind.tv · Sign out
                                         12, muted
</main>
```

`tone="agency"` on the button is not decoration. This is the moment the person
becomes the agency; the possession hue is the correct one and it is the first
time they see it.

### The two fields, and the rules that go with them

**Studio name** — `z.string().min(1).max(200)`. Free text. Counter at 200 via
the `Field` primitive's `counter` prop, shown only past 160.

**Workspace address** — `z.string().min(2).max(60)`. This is a slug, it is
permanent, and the screen must say so *before* it is submitted, not after.

- The input itself is `font-mono` — it is a record, and it follows the same rule
  as every other record in this product.
- **The full address is shown as a live preview beneath the field**, not as a
  prefix inside it: `<Mono size="14" tone="muted">relay.app/northwind</Mono>`,
  updating as the slug is typed, with an `aria-live="polite"` on it so a
  screen-reader user hears the derived slug they did not type.

  An inline `relay.app/` prefix inside the control's frame was the obvious
  design and it was rejected: the only ways to draw it require either
  suppressing the input's own focus ring or drawing a second one on a wrapper,
  and `outline: none` without an equally visible replacement is forbidden in
  this codebase — there is a source-scan test for it. A preview line is also
  better at 360px, where a prefix eats a third of the field, and better copy:
  it shows the *whole* address rather than half of it.
- Derived from the studio name as it is typed, **until the person edits the slug
  themselves**, after which it stops following. Silently re-deriving over
  someone's deliberate edit is the single most irritating bug in this class of
  form.
- Derivation: lowercase, spaces and `_` to `-`, strip anything not
  `[a-z0-9-]`, collapse runs of `-`, trim leading and trailing `-`, cut to 60.
- Validated on blur, not on keystroke. "That address is taken." replaces the
  hint in the same slot, `text-ink font-semibold`, `role="alert"` — no red, per
  the `--breach` reservation.

### Copy rules applied

Name things by what people control. It is a **studio**, not an "organisation" or
a "tenant" or a "workspace group" — the person filling this in runs a production
company. The API calls it an org; the human never has to.

The heading is an instruction ("Name your studio"), not a greeting ("Welcome to
Relay!"). Relay's empty states instruct; so does its first screen.

### States

| State | Rendering |
|---|---|
| default | As above. Focus lands on Studio name on mount — the one place in the product where an autofocus is right, because the screen has exactly one purpose and one entry point. |
| submitting | Button `loading` with `loadingLabel="Creating your studio"`. Both fields `disabled`. The three static mono dots, no spinner. |
| error, slug taken | Per above, on the slug field. Button re-enables. |
| error, 500 | A `role="alert"` line above the button: "Your studio could not be created. Nothing was saved — try again." Fields keep their values. Never clear a form on a server error. |
| success | Redirect to `/w/<id>` — the new workspace, empty, showing the portfolio's empty state. The onboarding screen is never reachable again for that user. |
| already onboarded | This route must not render at all. A user with an org who reaches it is redirected to `/w`. A person seeing "Name your studio" for a studio they already named will assume they are in the wrong account. |

### What is deliberately not here

- **No plan or billing step.** The plan limit bites at engagement creation
  (402 `PLAN_LIMIT_REACHED`), which is where the person has context for the
  decision. Asking for a card before they have seen a board is how a trial dies.
- **No team invitations.** There is nothing to invite anyone to yet. It belongs
  on the empty portfolio, next to the thing it is about.
- **No logo or brand colour.** The white-label hook exists and it is a settings
  concern. A brand-colour picker on the first screen is a five-minute detour
  before the person has seen the product the colour applies to.
- **No skip link on this screen and no navigation chrome.** There is exactly one
  thing to do. Adding a way around it produces a session that can reach nothing.

### 360

- `max-w-dialog` becomes full width at `px-4`.
- The preview line truncates from the left (`direction: rtl` on a `dir="ltr"`
  span) so the end of the slug — the part being typed — stays visible.
- The Button is full width at `size="lg"` (44px).
- "Signed in as …" wraps to two lines with `Sign out` on the second.
