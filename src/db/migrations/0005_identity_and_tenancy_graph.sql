-- Phase 9, step 1 of ADR-021's migration order: add the permission graph.
-- Nothing is dropped, nothing is renamed, and no existing row changes meaning.
--
-- `organizations` already exists and already is the agency tenant, so it gains
-- `kind` (every pre-existing org is a `team`) rather than being replaced.
-- `client_contacts` is untouched: reviewers remain the zero-account path and
-- INV-6 still scopes them to exactly one engagement.
--
-- The data half of this step lives in `src/db/backfill/identity-graph.ts` and is
-- run separately, because a backfill that is idempotent and reversible cannot
-- also be a migration that is forward-only and applied exactly once.
--
-- Role columns are constrained `text`, matching `plan`/`status`/`role`
-- elsewhere in this schema (see `src/db/schema/enums.ts` for why). They are all
-- NOT NULL: the absence of a role is expressed by the absence of a row, never
-- by a null inside one, so there is no null for `resolveAccess()` to
-- accidentally read as a grant.

CREATE TABLE "access_shadow_disagreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_on" date NOT NULL,
	"endpoint" text NOT NULL,
	"decision_point" text NOT NULL,
	"reason" text NOT NULL,
	"legacy_user_id" uuid,
	"account_id" uuid,
	"legacy_org_id" uuid,
	"project_id" uuid,
	"old_allowed" boolean NOT NULL,
	"new_allowed" boolean NOT NULL,
	"new_role" text,
	"new_via" text,
	"input" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"primary_email" "citext" NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legacy_user_id" uuid,
	"personal_org_id" uuid,
	"backfilled_at" timestamp with time zone,
	CONSTRAINT "accounts_primary_email_unique" UNIQUE("primary_email"),
	CONSTRAINT "accounts_legacy_user_id_unique" UNIQUE("legacy_user_id"),
	CONSTRAINT "accounts_personal_org_id_unique" UNIQUE("personal_org_id")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"backfilled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"account_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"backfilled_at" timestamp with time zone,
	CONSTRAINT "org_memberships_account_id_org_id_pk" PRIMARY KEY("account_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_via_team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"backfilled_at" timestamp with time zone,
	CONSTRAINT "project_memberships_account_id_project_id_pk" PRIMARY KEY("account_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_account_id_pk" PRIMARY KEY("team_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kind" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "org_roles_derive_project_access" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_legacy_user_id_users_id_fk" FOREIGN KEY ("legacy_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_personal_org_id_organizations_id_fk" FOREIGN KEY ("personal_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_engagements_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_granted_via_team_id_teams_id_fk" FOREIGN KEY ("granted_via_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_shadow_day_endpoint_idx" ON "access_shadow_disagreements" USING btree ("observed_on","endpoint");--> statement-breakpoint
CREATE INDEX "access_shadow_project_idx" ON "access_shadow_disagreements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "accounts_legacy_user_idx" ON "accounts" USING btree ("legacy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_key" ON "identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "identities_account_idx" ON "identities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "org_memberships_account_idx" ON "org_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "org_memberships_org_idx" ON "org_memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "project_memberships_account_idx" ON "project_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "project_memberships_project_idx" ON "project_memberships" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_memberships_team_idx" ON "project_memberships" USING btree ("granted_via_team_id");--> statement-breakpoint
CREATE INDEX "team_members_account_idx" ON "team_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_name_key" ON "teams" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("org_id");