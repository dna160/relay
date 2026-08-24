# PHASE 8 — Hardening & deploy

## ENTRY
- Phases 0-7 exit verified. `npm run verify` green. All ten invariants live.

## SCOPE
- Full e2e matrix: agency desktop and client mobile, both Playwright projects.
- Load test on the client board — it is the acquisition surface and the NFR is
  FCP under 1.5s on 4G.
- Railway deploy: app, worker, Postgres. Vercel is the documented fallback.
- Error tracking, structured logs with engagement id on every line, and a
  rollback runbook that has actually been executed once.
- Accessibility sweep against the DESIGN-SYSTEM quality floor: 360px, visible
  focus, `prefers-reduced-motion`, 4.5:1 on possession hues both directions.

## OUT
- New features. If it is not hardening, it belongs to a phase that is closed or
  a v2 that has not been written.

## EXIT
- Deploy and rollback both executed once against staging.
- All ten invariant suites unskipped and green in CI.
- Every destructive job is dry-runnable and logs its manifest before acting.

## INVARIANTS
Runs all ten in CI on every push. None may be skipped at this point.

## HANDOVER
Record: the staging and production URLs, the rollback command, the on-call
runbook location, and any invariant that required a documented exception.
