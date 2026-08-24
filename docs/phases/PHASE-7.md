# PHASE 7 — Templates, white-label, plan gates

## ENTRY
- Phases 1 and 3 exit verified. Independent of Phase 6 — the one safe parallel
  seam in the plan.

## SCOPE
- Schema + migration: `templates`.
- `applyTemplate(def) -> engagement graph` as a **pure** function. Stamping
  lanes with their visibility, cards, contracted round counts, and shelf groups.
- `GET/POST /api/templates`, plus stamping on engagement create.
- Runtime theming from org brand tokens via CSS variables. White-label
  overrides `--agency` only.
- Plan gates on active count (INV-8's counter, not a second one), retention,
  and branding.

## OUT
- Custom domains and SSO. Studio-tier infrastructure, not v1 application code.
- A template marketplace. Not in scope, not in v2 either without a PRD change.

## EXIT
- Stamping a template twice produces structurally identical graphs.
- Theming cannot override `--client` or `--breach`. A test asserts it: a tenant
  must not be able to theme away a warning.
- Plan gates read from one limits table and one active counter.

## INVARIANTS
Holds **INV-8** — the gate calls the counter and does not define active itself.

## HANDOVER
Record: the template definition JSON shape, the themeable token allowlist, and
the plan limits table.
