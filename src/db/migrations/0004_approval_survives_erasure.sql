-- An approval must survive the erasure of the person who made it.
--
-- `approvals.decided_by_contact_id` and `decided_by_user_id` are both
-- ON DELETE SET NULL, and the old CHECK required num_nonnulls(...) = 1. The
-- pair is impossible: the moment a delete cascaded a decider to NULL, the
-- surviving row violated its own CHECK and the delete aborted. Deleting a
-- client contact, an agency user, an engagement or an organisation all failed
-- outright, which meant account deletion, GDPR erasure, and the ADR-007
-- tombstone reaper could not run at all.
--
-- Deleting the approval instead is not an option: it is a dispute record that
-- has to survive six months (ADR-004, INV-3). So the row is allowed to become
-- anonymous, and `decided_by_side` keeps the fact that anonymity would
-- otherwise destroy — whether the client approved it or the agency signed it
-- off.

ALTER TABLE "approvals" ADD COLUMN "decided_by_side" text;--> statement-breakpoint

-- Backfill from the columns that are still populated. Every existing row
-- satisfies the old `= 1` CHECK, so exactly one of these is non-null and no
-- row can fall through to NULL.
UPDATE "approvals"
   SET "decided_by_side" = CASE
         WHEN "decided_by_contact_id" IS NOT NULL THEN 'client'
         ELSE 'agency'
       END
 WHERE "decided_by_side" IS NULL;--> statement-breakpoint

ALTER TABLE "approvals" ALTER COLUMN "decided_by_side" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "approvals" DROP CONSTRAINT "approvals_one_decider";--> statement-breakpoint

-- The rule that stays true forever: at most one decider reference, and
-- whichever one the row carries must agree with the side. "Exactly one, at
-- write time" is still guaranteed, by recordDecision(), which builds all three
-- columns from one discriminated Actor. The database cannot enforce that half,
-- because after an erasure it cannot tell "never had a decider" from "had one,
-- and they were erased".
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_one_decider" CHECK (
  ("approvals"."decided_by_side" = 'client' AND "approvals"."decided_by_user_id" IS NULL)
  OR ("approvals"."decided_by_side" = 'agency' AND "approvals"."decided_by_contact_id" IS NULL)
);
