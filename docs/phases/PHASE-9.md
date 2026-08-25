# PHASE 9 — Identity and tenancy migration

## ENTRY
v1 shipped and verified. ADR-012 read in full. D3 answered — it decides whether org role derives project access.

## SCOPE
Add accounts, identities, organizations, org_memberships, teams, team_members, project_memberships. Backfill one account per existing user, one personal org per account, memberships from existing assignments. Leave client_contacts untouched — they remain the reviewer path. Build resolveAccess() in src/domain/access/. Build the shadow harness: every existing permission check calls both old logic and resolveAccess, returns the old result, logs disagreements with full inputs. Disagreement dashboard.

## OUT
Auth provider changes, invites, switcher UI, teams UI. No user-visible change ships in this phase.

## EXIT
Backfill is idempotent and reversible. Shadow harness live on every permission check. Seven consecutive days at zero disagreements before the old path is deleted. INV-11 unskipped only after deletion.

## INVARIANTS
INV-11; INV-6 narrowed to reviewer sessions

## HANDOVER
Report the disagreement count per endpoint and any case where old and new legitimately differ. A legitimate difference is a spec bug, not a tolerance.
