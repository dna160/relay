CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"engagement_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" "card_state" DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"contracted_rounds" integer,
	"rounds_used" integer DEFAULT 0 NOT NULL,
	"internal_notes" text,
	"effort_estimate" integer,
	"visibility_override" text DEFAULT 'inherit' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lanes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"engagement_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"visibility" "lane_visibility" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"from_state" "card_state" NOT NULL,
	"to_state" "card_state" NOT NULL,
	"possession" "possession",
	"actor_user_id" uuid,
	"actor_contact_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_lane_id_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."lanes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lanes" ADD CONSTRAINT "lanes_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_actor_contact_id_client_contacts_id_fk" FOREIGN KEY ("actor_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_engagement_lane_position_idx" ON "cards" USING btree ("engagement_id","lane_id","position");--> statement-breakpoint
CREATE INDEX "cards_assignee_state_idx" ON "cards" USING btree ("assignee_id","state") WHERE state <> 'signed_off';--> statement-breakpoint
CREATE INDEX "lanes_engagement_position_idx" ON "lanes" USING btree ("engagement_id","position");--> statement-breakpoint
CREATE INDEX "state_transitions_card_occurred_idx" ON "state_transitions" USING btree ("card_id","occurred_at");