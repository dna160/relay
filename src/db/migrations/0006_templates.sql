-- Phase 7 — templates.
--
-- `templates` itself was created by 0000; the table is older than the code that
-- fills it, and its columns are unchanged. This adds two things:
--
--   * `templates_org_created_idx` — every read of this table is one org's rows,
--     newest first. Another org's template is a 404, never a 403, and the
--     cheapest way to keep that true is for the index to be org-first.
--   * `engagements.shelf_group_labels` — a shelf group is a label on a file
--     (DATA-MODEL: no versioning, no approval, no tree), so a stamped group
--     with no files under it has nowhere else to live, and an empty labelled
--     group is the entire point of stamping one. `loadShelf()` seeds the
--     grouping from this before it groups the files. Defaulted to the empty
--     array rather than nullable: "no groups" and "not stamped" are the same
--     fact, and a null would invite a third meaning. See ADR-024 Decision 5.
--
-- Forward-only and additive. Nothing is dropped, renamed, or backfilled; every
-- pre-existing engagement gets `'{}'`.

ALTER TABLE "engagements" ADD COLUMN "shelf_group_labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "templates_org_created_idx" ON "templates" USING btree ("org_id","created_at");