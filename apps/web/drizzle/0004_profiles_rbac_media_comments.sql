CREATE TABLE "accounts" (
	"wallet" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"status_by" text,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"comment_id" integer NOT NULL,
	"reporter" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"moderated_by" text,
	"moderation_reason" text
);
--> statement-breakpoint
CREATE TABLE "market_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"username_normalized" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"avatar_media_id" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_media" (
	"proposal_id" text NOT NULL,
	"media_id" text NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "proposal_media_proposal_id_media_id_pk" PRIMARY KEY("proposal_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "role_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"fn" text NOT NULL,
	"target" text NOT NULL,
	"grant" boolean NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'awaiting_signature' NOT NULL,
	"tx_hash" text,
	"error" text,
	"confirmed_block" bigint,
	"incident_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "wallet_replacements" (
	"id" text PRIMARY KEY NOT NULL,
	"old_wallet" text NOT NULL,
	"new_wallet" text NOT NULL,
	"performed_by" text NOT NULL,
	"reason" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_proposals" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_slugs" ADD CONSTRAINT "market_slugs_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_media" ADD CONSTRAINT "proposal_media_proposal_id_market_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."market_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_media" ADD CONSTRAINT "proposal_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reports_once" ON "comment_reports" USING btree ("comment_id","reporter");--> statement-breakpoint
CREATE INDEX "comments_market" ON "comments" USING btree ("market_id","id");--> statement-breakpoint
CREATE INDEX "comments_author" ON "comments" USING btree ("author");--> statement-breakpoint
CREATE UNIQUE INDEX "market_slugs_current" ON "market_slugs" USING btree ("market_id") WHERE "market_slugs"."is_current";--> statement-breakpoint
CREATE INDEX "media_owner" ON "media" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "media_status" ON "media" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username" ON "profiles" USING btree ("username_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_active" ON "role_assignments" USING btree ("wallet","role") WHERE "role_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "role_assignments_wallet" ON "role_assignments" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "role_operations_tx" ON "role_operations" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "role_operations_target" ON "role_operations" USING btree ("target");--> statement-breakpoint
CREATE INDEX "sessions_wallet" ON "sessions" USING btree ("wallet");--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
