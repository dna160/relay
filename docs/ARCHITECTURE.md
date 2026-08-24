# Architecture & Decision Record

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 (App Router), TypeScript strict | One deployable; server components suit the read-heavy client board |
| DB | Postgres 16 + Drizzle ORM | Explicit SQL, cheap row-level filtering, migrations in-repo |
| Auth | Auth.js v5, email provider only | Magic links for both sides; no password surface to defend |
| Objects | S3-compatible (Cloudflare R2) | Zero egress fees — decisive for a file-heavy product |
| Jobs | pg-boss on the same Postgres | Purge, nudges, warnings. No extra infra for v1 |
| Realtime | SSE over Postgres LISTEN/NOTIFY | Board updates without a vendor dependency |
| Email | Resend | Magic links, nudges, purge warnings, certificates |
| UI | Tailwind + shadcn/ui, CSS-variable theming | White-label tier needs runtime theming |
| Tests | Vitest + Playwright | Unit, invariant, and e2e |
| Deploy | Railway (app + worker + Postgres) | Single-provider ops; Vercel is the fallback |

## Decision records

**ADR-001 — The engagement is the aggregate root.**
Everything hangs off one row. Access checks, billing counts, and the purge walk
start there. Alternative considered: project-under-client hierarchy. Rejected —
it makes "client" a durable entity, which reintroduces permanent storage and the
per-seat model we are trying to escape.

**ADR-002 — One card, two projections. No shadow board.**
The failure mode of every client portal is double entry: real work in Notion,
theatre in the portal. We serve a client projection and an agency projection of
the *same row*. Implemented in `domain/projection/`, enforced by INV-1.

**ADR-003 — Board state is derived from the state machine.**
`cards.state` is writable only through `domain/card/state-machine.ts`.
Transitions are triggered by domain events (version submitted, decision
recorded, gate promoted). Drag-and-drop writes `position`, never `state`.

**ADR-004 — Approvals bind to immutable versions, not cards.**
A decision stores the version id and its sha256 at decision time. "Approved"
must survive a dispute six months later; approving a mutable card cannot.

**ADR-005 — Client identity is magic-link, engagement-scoped.**
The client must feel like WeTransfer and still produce an audit trail. Email
verification gives attribution without a password, profile, or signup flow.
Sessions carry exactly one engagement id (INV-6). There is deliberately no
cross-engagement client account in v1 — that is the client-side product, and
building it now would double the tenancy surface.

**ADR-006 — Lane visibility defaults to published.**
Product decision. Private is explicit. The safety cost is real, so the guard is
mechanical rather than procedural: every client-reachable query goes through
`clientScope()`, and `tests/invariants/visibility.spec.ts` fails the build if a
new query bypasses it.

**ADR-007 — Hard purge, two-phase.**
Phase one destroys object bytes and content rows and writes the certificate.
Phase two (30d) removes the internal tombstone used for incident recovery. See
PRD section 9 — the certificate's legal wording depends on resolving this.

**ADR-008 — Active-engagement count is one function.**
`countActiveEngagements()` serves both the billing limit and the expiry
scheduler. Two implementations of "active" will drift, and the drift will bill
someone for a workspace it also deleted.

**ADR-009 — No file bytes through the app server.**
Presigned PUT for upload, presigned GET for download. The server records
metadata and hashes only. Keeps the app stateless and the bill predictable.

**ADR-010 — Possession is derived from `state_transitions`, never stored as a
running total.** Totals denormalise badly and cannot be recomputed after a bug.

**ADR-011 — No chat surface.** Discussion attaches to cards and versions. See
PRD section 7 for the reasoning. Recorded as an ADR because it will be
relitigated.

## System shape

```
                 ┌──────────────────────────────────┐
   agency  ───►  │  Next.js app                     │
   client  ───►  │  (agency routes / client routes) │
                 └───────┬──────────────┬───────────┘
                         │              │ presigned URLs
                  domain layer          ▼
                         │        ┌───────────┐
                         ▼        │  R2/S3    │
                   ┌──────────┐   └───────────┘
                   │ Postgres │◄──── pg-boss worker
                   └──────────┘      (purge, nudges, warnings)
```

## File tree

```
relay/
├── CLAUDE.md                     # session anchor — read first, every time
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA-MODEL.md
│   ├── API-CONTRACT.md
│   ├── DESIGN-SYSTEM.md
│   ├── BUILD-PHASES.md
│   ├── adr/                      # one file per decision once they multiply
│   ├── phases/PHASE-0..8.md      # the only doc a session reads beyond CLAUDE.md
│   └── state/
│       ├── PROGRESS.md           # updated every session
│       └── HANDOVER.md           # written for the next session
├── src/
│   ├── app/
│   │   ├── (agency)/
│   │   │   ├── portfolio/        # home screen: all engagements
│   │   │   ├── w/[id]/board/     # `w` not `e` — see API-CONTRACT amendment A4
│   │   │   ├── w/[id]/shelf/
│   │   │   ├── w/[id]/settings/
│   │   │   └── templates/
│   │   ├── (client)/
│   │   │   └── e/[token]/        # magic-link surface; board + decision queue
│   │   ├── api/
│   │   │   ├── engagements/
│   │   │   ├── cards/
│   │   │   ├── versions/
│   │   │   ├── approvals/
│   │   │   ├── uploads/          # presign
│   │   │   └── events/           # SSE
│   │   └── layout.tsx
│   ├── domain/                   # framework-free business logic
│   │   ├── engagement/           # lifecycle, activity, active-count
│   │   ├── card/
│   │   │   ├── state-machine.ts  # sole writer of cards.state
│   │   │   └── possession.ts
│   │   ├── approval/
│   │   ├── projection/
│   │   │   ├── client-view.ts    # the only serialiser clients ever hit
│   │   │   └── agency-view.ts
│   │   ├── retention/            # archive, warn, export, purge, certificate
│   │   └── plan/                 # limits, gates
│   ├── db/
│   │   ├── schema/               # drizzle tables
│   │   ├── migrations/           # forward-only, never edited
│   │   └── queries/              # all reads; client-reachable ones use clientScope()
│   ├── components/
│   ├── lib/                      # auth, storage, email, sse
│   └── workers/                  # pg-boss job handlers
└── tests/
    ├── invariants/               # INV-1..10. Never edited to make a build pass
    ├── unit/
    └── e2e/
```

## Non-functional requirements

- Client board first contentful paint under 1.5s on 4G — it is the acquisition
  surface and the client is not motivated.
- Presigned upload supports files to 5 GB via multipart.
- Purge job is idempotent and resumable; a partial purge must be safe to rerun.
- All destructive jobs are dry-runnable with `--plan` and log a manifest first.
- Every email that references an engagement includes the days-to-purge count.
