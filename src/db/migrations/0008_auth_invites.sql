CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"role" text NOT NULL,
	"invited_by_account_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_account_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signin_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" "citext" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_consumed_by_account_id_accounts_id_fk" FOREIGN KEY ("consumed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_org_email_idx" ON "invites" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "invites_target_idx" ON "invites" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signin_tokens_token_hash_key" ON "signin_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "signin_tokens_email_idx" ON "signin_tokens" USING btree ("email");--> statement-breakpoint
-- `target_kind` drives the branch in `redeemInvite()` that decides whether an
-- org membership or a project membership is written. A third value would take
-- neither branch and consume the invite anyway, so the database refuses it.
--
-- Deliberately the only CHECK added here. `consumed_at`/`consumed_by_account_id`
-- look like they want a num_nonnulls pair; migration 0004 is the record of what
-- that costs — a SET NULL on delete plus a CHECK over the same columns turned a
-- routine delete into an aborted transaction. A constraint that can fight a
-- cascade is not worth the invariant it states.
ALTER TABLE "invites" ADD CONSTRAINT "invites_target_kind" CHECK ("invites"."target_kind" IN ('org', 'project'));
