# ADR-022 — Org admin project access, and what the certificate may claim

**Status:** accepted by the product owner, 2026-08-25
**Resolves:** PRD Part D — D1, D2, D3. Unblocks Phase 9 and Phase 13.

## D3 — org admins get project access

`owner` and `admin` derive access to every project in their organization.
`resolveAccess()` is therefore:

```
effective = strongest(project_role, org_role → project)
```

**The cost this accepts.** An agency running competing clients inside one
organization has no Chinese wall. That is a real exposure and it is chosen, not
overlooked: the founder of a six-person studio expecting to see their own
company's work is the common case, and least privilege here buys a support
burden in week one against a risk that arrives at a size most tenants never
reach. The escape hatch is per-org configuration at Studio tier — the tier whose
customers actually have the problem.

**What must not follow from this.** Null on both roles still means **deny**, not
a default reviewer role. A fallback is the classic way a permission system
leaks, and this decision makes the org-derived branch more attractive to reason
loosely about, not less.

## D1 + D2 — the certificate states the backup window

The certificate reads: destroyed from live systems on the purge date, erased
from encrypted backups within 30 days. The 30-day tombstone stays, for incident
recovery only.

**This was already shipping wrong.** Both attestations in `purged-receipt.tsx`
read *"permanently destroyed"*. Managed Postgres backups retain purged content
for the retention window and the tombstone exists by design, so the sentence was
false at the moment the document was issued — on the one artifact written to be
handed to a client's legal team. Corrected the same day.

**Why the honest version is the stronger one.** The delivery plan's own warning
was that an inaccurate certificate is worse than no certificate. A document that
overclaims fails exactly when it is examined, which is the only time it is read.
A document that states a bounded, specific window survives that examination —
and "erased from backups within 30 days" is a stronger claim than most vendors
will put in writing at all.

The alternative — backups that exclude purged content — was rejected on two
grounds. It is expensive and difficult on managed Postgres, and it removes the
ability to recover from a bug in the purge worker, which is the single most
irreversible piece of code in the product.

## Consequences

- Phase 9 can define `resolveAccess()` and its invariant matrix.
- Phase 13 can write the retention runbook down one branch instead of two.
- The certificate's wording is now a **fact about the system**, so changing the
  backup retention window is a change to this document, not only to a config
  value. `RETENTION_BACKUP_DAYS` and this ADR must agree.
