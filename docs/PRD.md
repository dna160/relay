# RELAY — Product Requirements Document

**Name:** Relay (renamed 2026-08-24 from the working name "Handoff")
**Status:** v1 scope frozen for build
**Wedge:** Agencies and studios serving many clients

---

## 1. Problem

An agency signs a contract and the work immediately fragments. Assets go to
Drive, feedback arrives in email and Slack, approvals happen verbally, and the
project manager becomes a human message bus. Two costs follow:

1. **Delivery drag.** Nobody can answer "what is blocked, and on whom?" The
   agency absorbs blame for delays caused by client feedback latency, because
   there is no record of who held the work and for how long.
2. **Scope leak.** Revision rounds are contracted and then uncounted. Round four
   of a two-round agreement is invisible until margin is gone.

Existing tools fail at the boundary, not at the board. Asana and Monday charge
per seat and were built for one company's employees. Basecamp has a client view
but is permanent and message-centric. Frame.io nails versioned review for video
only. Drive holds files but knows nothing about what they mean.

## 2. Product thesis

**The engagement is the unit of everything.** One signed contract produces one
workspace, reachable by one link. That single object is simultaneously:

- the unit of **work** (board, cards, files)
- the unit of **access** (client identity is scoped to it)
- the unit of **billing** (plans meter active engagements)
- the unit of **deletion** (expiry purges it whole)

Four concerns, one lifecycle. This is the structural advantage: competitors
committed to permanent storage pay for files forever. Relay does not.

**Second thesis: the board is a rendering, not a record.** Cards move because a
file was submitted or a decision was made — never because someone dragged them.
A board people maintain by hand becomes a board that lies, and every downstream
metric built on it becomes fiction.

## 3. Users

| Role | Needs | Access |
|---|---|---|
| Agency admin | Portfolio across engagements, plan limits, branding | Org account |
| Agency member | Their assigned cards across all engagements | Org account |
| Client contact | The board, what awaits them, approve / request changes | Magic link, engagement-scoped, no account |

Client contacts are never billed and never create an account. This is
load-bearing: gating the client side kills the growth loop, in which a client
who liked the experience asks their *other* vendors to use Relay.

## 4. Core loop

```
Contract signed
  -> Agency stamps a workspace from a template
  -> Client opens one link, verifies email, sees the board
  -> Card assigned -> work -> internal review -> published to client
  -> Client approves a specific version, or requests changes with notes
  -> Sign-off recorded against the file hash
  -> Wrap -> retention countdown -> export -> purge (or retain on a paid plan)
```

## 5. Functional requirements

### 5.1 Board and lanes
- Lanes are **published by default**; a lane is private only when explicitly set.
- Private lanes and their cards are invisible to client contacts at the query
  layer. Not hidden in the UI — never serialised. (INV-1)
- Cards are deliverables. Card state is owned by a state machine (section 6).
- Drag reorders priority. Drag never changes state.

### 5.2 Stage and backstage
One card, two projections. There is no second board and no double entry.

| Client sees | Agency additionally sees |
|---|---|
| Title, description, state, due date | Assignee, internal subtasks |
| Versions published to them | Unpublished drafts, internal review notes |
| Their own revision notes | Possession split, effort, cost signals |
| Rounds used vs contracted | Rejected internal candidates |

An **internal review gate** sits before AWAITING_CLIENT. Nothing reaches the
client projection until an agency member promotes it.

### 5.3 Files
Two classes, deliberately not one filesystem.

- **Versions** live on cards. Immutable, numbered, hashed, each carrying its own
  note thread and approval state. Notes thread to the version they were written
  against and never float forward.
- **Reference shelf** — brand guidelines, raw footage, the contract. Flat, a
  handful of labelled groups, no versioning, no approval state, no tree.

### 5.4 Approvals and sign-off
- A decision binds to one immutable version and records: deciding identity
  (verified email), timestamp, IP, user agent, and the file sha256. (INV-3)
- Decisions are APPROVED or CHANGES_REQUESTED, the latter requiring a note.
- Sign-off is an engagement-level act closing a set of approved deliverables.

### 5.5 Time intelligence
- **Possession clock.** Every state carries an owning party. Elapsed time
  accrues to whoever holds the card, producing "9 of 14 days awaiting client."
- Possession data is **agency-internal by default**, shareable at the agency's
  discretion. Auto-surfacing latency to a paying client is a diplomatic
  incident, not a feature.
- **Revision rounds.** Each CHANGES_REQUESTED -> resubmit cycle increments a
  counter compared against the contracted number on the card.
- **Attention model.** Cards rank by *actionability*, not deadline proximity:
  blocked on me, blocked on my team, blocked on client, silently rotting.
  Proximity is one input. Colour never encodes urgency alone — when everything
  turns red on Wednesday, the signal is gone.

### 5.6 Ephemerality
- An engagement is **active** if status = ACTIVE and it has had activity in the
  last 30 days.
- Inactive -> ARCHIVED (read-only) -> warnings at archive, +14d, +23d, +29d ->
  hard purge at 60 days from last activity.
- **Both sides are warned.** Client contacts receive every notice the agency
  receives, plus a free one-click export of everything they can see. The
  agency's contract with its client almost certainly obliges it to retain
  deliverables; a silent purge manufactures a breach and destroys the account.
- Purge destroys object bytes and content rows, leaving one **deletion
  certificate** — a signed manifest of hashes, counts, and timestamp, emitted to
  both parties. Certified destruction of client IP after delivery is a
  compliance artifact agencies get asked for; the paywall's downside becomes
  something the agency forwards to their client's legal team.

### 5.7 Templates
Disposable workspaces only work if creating one is nearly free. Templates stamp
lanes, cards, approval gates, contracted round counts, and shelf structure in
one action. Without them, ephemerality becomes a tax and agencies will reuse a
single long-lived workspace — breaking billing, purge, and isolation at once.
Templates are v1, not v2.

### 5.8 Plans
One scaling unit: **concurrent active engagements**. The other levers are gates
and caps, not multipliers.

| | Free | Pro | Studio |
|---|---|---|---|
| Active engagements | 3 | 15 | Unlimited |
| Internal seats | Unlimited | Unlimited | Unlimited |
| Retention | Purge at 60d | Indefinite | Indefinite |
| White-label | — | Logo + colours | Custom domain, SSO, audit export |
| Storage | Fair-use cap | Higher cap | Negotiated |

Internal seats are never charged: agencies run on freelancers who cycle weekly,
and per-seat pricing produces shared logins and destroys usage data. It is also
a direct knife against the seat-based incumbents.

## 6. Card state machine

```
DRAFT -> ASSIGNED -> IN_PROGRESS -> INTERNAL_REVIEW -> AWAITING_CLIENT
                          ^                                  |
                          |                                  v
                          +------- CHANGES_REQUESTED <--------+
                                                             |
                                                             v
                                                    APPROVED -> SIGNED_OFF
```

| State | Possession | Client-visible |
|---|---|---|
| DRAFT | agency | no |
| ASSIGNED | agency | yes |
| IN_PROGRESS | agency | yes |
| INTERNAL_REVIEW | agency | shows as IN_PROGRESS |
| AWAITING_CLIENT | client | yes |
| CHANGES_REQUESTED | agency | yes |
| APPROVED | agency | yes |
| SIGNED_OFF | none | yes |

INTERNAL_REVIEW collapses to IN_PROGRESS in the client projection. The client
learns that work is underway, not that the art director rejected draft 2.

## 7. Out of scope for v1

Cut, with reasons, so they do not reappear in a planning meeting:

- **Chat rooms.** Per-lane chat ships forty empty rooms and loses to Slack,
  where the agency already lives, and email, where the client lives. Worse, it
  becomes the off-record surface where the "yeah just go ahead" that later gets
  disputed happens. Discussion attaches to cards and versions instead.
- **Live huddles.** Integrate: a meeting link on the card, notes dropped back
  onto it. Building it is two quarters; integrating is a week.
- **Procurement, invoicing, SOW management.** Different buyer, different sales
  cycle. The engagement object is shaped so this can layer on later.
- **Time tracking.** The possession clock answers the question that matters.
- **Calendar view.** The portfolio dashboard is the home screen. Revisit post-v1.

## 8. Success metrics

**North star:** weekly active engagements with at least one client-side action.
It is the only metric that fails if either side stops showing up.

| Metric | Target |
|---|---|
| Client time-to-first-action after invite | under 5 min |
| Approvals recorded in-product vs email | over 80% by week 4 |
| Median client possession time per cycle | trending down |
| Free -> Pro conversion at reactivation | primary conversion trigger |
| Cards edited with no file activity | under 10% |

The last one is the health check that matters most. If agencies start
maintaining the board by hand, the product has become a status page and every
other number is fiction.

## 9. Open product decisions

- **Tombstone vs certified destruction.** Engineering will want a 30-day
  soft-delete so support can undo the inevitable bug. That contradicts a
  marketing claim of certified destruction. Pick one before legal writes the
  terms, not after a customer asks you to prove it. Currently specified as
  two-phase with the tombstone not user-recoverable; certificate wording must
  match whichever way this lands.
- **Possession visibility default.** Internal-only in v1. Client-visible
  possession is a plausible Pro feature and a plausible relationship hazard.
- **Reactivation pricing.** Reactivating an archived engagement is the strongest
  conversion moment in the product. Whether it is a paywall or a free courtesy
  that seeds trust is untested.
