# PHASE 13 — Deployment and retention hardening

## ENTRY
Phases 9–12 complete. **D1 and D2 are resolved** (ADR-022, 2026-08-25): the certificate states destruction from live systems on the purge date and erasure from encrypted backups within 30 days; the 30-day tombstone stays, for incident recovery only. The certificate copy was corrected the same day.

## SCOPE
Railway: `web`, `worker`, managed `postgres` on private networking, region **Singapore (`asia-southeast1`)** — roughly 200ms per interaction for the initial user base, and the US default is not neutral. Migrations as a **pre-deploy command, never on boot**: two instances racing one migration is the classic first outage. Schedules via **pg-boss cron inside the worker**, not Railway cron — purge and warning jobs must be idempotent, dry-runnable, and auditable in the same database that records what they did. `production` and `staging` environments, PR environments with a seeded ephemeral database. Structured logs carrying `account_id`, `org_id`, `project_id` on every line. Three alerts that page: purge job failure, `resolveAccess` p99 above 20ms, and any invariant test failing on `main`. Backup retention configured to match what the certificate claims.

## OUT
Any Railway-proprietary feature beyond the deploy layer. Everything is Docker plus Postgres plus S3-compatible storage, so the exit stays a weekend.

## EXIT
**Deploy and rollback each executed once against staging** — the one exit condition in this build that no test can cover, and the largest open risk carried since Phase 8. `RETENTION_BACKUP_DAYS` and ADR-022 agree, asserted. The runbook's purge-resume procedure walked by someone who did not write it.

## INVARIANTS
Runs all fourteen in CI on every push. None may be skipped at this point.

## HANDOVER
Record the staging and production URLs, the rollback command sequence as actually executed, and the measured `resolveAccess` p99 in the deployed region rather than locally.
