CREATE TABLE "purge_certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"engagement_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"engagement_title" text NOT NULL,
	"client_org_name" text NOT NULL,
	"object_count" integer NOT NULL,
	"total_bytes" bigint NOT NULL,
	"manifest_sha256" char(64) NOT NULL,
	"statement" text NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"certificate_signature" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purge_manifest" (
	"id" uuid PRIMARY KEY NOT NULL,
	"engagement_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"manifest_sha256" char(64),
	"manifest" jsonb,
	"object_count" integer,
	"total_bytes" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "purge_certificates_engagement_key" ON "purge_certificates" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "purge_certificates_org_idx" ON "purge_certificates" USING btree ("org_id","purged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purge_manifest_engagement_step_key" ON "purge_manifest" USING btree ("engagement_id","step");--> statement-breakpoint
CREATE INDEX "purge_manifest_engagement_idx" ON "purge_manifest" USING btree ("engagement_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_retention_warning_key" ON "audit_log" USING btree ("engagement_id","subject_type") WHERE action = 'retention.warned';