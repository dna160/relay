ALTER TABLE "cards" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "lanes" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lanes" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_engagement_live_idx" ON "cards" USING btree ("engagement_id","lane_id","position") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "lanes_engagement_live_idx" ON "lanes" USING btree ("engagement_id","position") WHERE archived_at IS NULL;