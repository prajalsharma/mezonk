CREATE TABLE "evidence_documents" (
	"hash" text PRIMARY KEY NOT NULL,
	"raw" text NOT NULL,
	"kind" text NOT NULL,
	"market_id" integer NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "ruling_rationale_hash" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "ruling_rationale_uri" text;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "ruling_tx_hash" text;--> statement-breakpoint
CREATE INDEX "evidence_documents_market" ON "evidence_documents" USING btree ("market_id");