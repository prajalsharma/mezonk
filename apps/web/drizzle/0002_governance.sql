CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"details" jsonb,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"author" text NOT NULL,
	"project_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb NOT NULL,
	"metadata_hash" text NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"launch_window" text DEFAULT '' NOT NULL,
	"resolver" text,
	"liquidity_plan" text DEFAULT '' NOT NULL,
	"conflicts" text DEFAULT '' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sponsored" boolean DEFAULT false NOT NULL,
	"assigned_curator" text,
	"approval" jsonb,
	"market_id" integer,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_representatives" (
	"project_id" text NOT NULL,
	"wallet" text NOT NULL,
	"role" text DEFAULT 'representative' NOT NULL,
	"proof_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_representatives_project_id_wallet_pk" PRIMARY KEY("project_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_version" integer NOT NULL,
	"reviewer" text NOT NULL,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"checklist" jsonb,
	"duplicate_of" text,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"wallet" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"notify_proposals" boolean DEFAULT true NOT NULL,
	"notify_resolution" boolean DEFAULT true NOT NULL,
	"notify_claims" boolean DEFAULT true NOT NULL,
	"number_format" text DEFAULT 'compact' NOT NULL,
	"hide_balances" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_proposals" ADD CONSTRAINT "market_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_representatives" ADD CONSTRAINT "project_representatives_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_proposal_id_market_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."market_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_actor" ON "audit_log" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "proposals_status" ON "market_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "proposals_author" ON "market_proposals" USING btree ("author");--> statement-breakpoint
CREATE INDEX "proposals_hash" ON "market_proposals" USING btree ("metadata_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_market" ON "market_proposals" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "project_reps_wallet" ON "project_representatives" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reviews_proposal" ON "proposal_reviews" USING btree ("proposal_id","created_at");