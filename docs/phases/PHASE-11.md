# PHASE 11 — Multi-org navigation and teams

## ENTRY
Phases 9 and 10 complete. INV-11 and INV-12 live.

## SCOPE
The command switcher (⌘K) — a palette, not a dropdown: three characters, match across org, project and card, jump. Recent first, then fuzzy, with the org name as a secondary line so two clients with a "Website Refresh" are distinguishable. The cross-org portfolio: "everything awaiting me", grouped by actionability, with org as a **filter chip rather than a container** — a freelancer sees one flat list and never learns the word "organization". Teams and `team_members`, with a grant that **expands to individual `project_membership` rows**. Org tint as a 2px left edge in cross-org views only.

## OUT
Renaming `engagement` to `project`. This is the earliest phase in which that tidy is permitted at all, and only if it is genuinely free — a rename competing with a migration is how both go wrong.

## EXIT
A palette that works at forty organizations and is fully keyboard-driven with visible focus. Granting a team writes membership rows and revoking removes them — one authority table, verifiable by query. Inside a project the org tint is absent: you know where you are. Responsive to 360px.

## INVARIANTS
Holds INV-11. Teams must not become a second authority path — a query-time team grant is the thing ADR-021 rejected, because two authority paths means two ways to get revocation wrong.

## HANDOVER
Record how team expansion behaves when a member is added to a team that already holds grants, and whether revocation is exact. If you attempted the rename, say what it cost.
