CREATE TABLE "chain_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"event_name" text NOT NULL,
	"market_id" integer,
	"actor" text,
	"args" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"disputer" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"evidence_uri" text NOT NULL,
	"arbitration_deadline" timestamp with time zone NOT NULL,
	"ruling" integer,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"author" text NOT NULL,
	"url" text NOT NULL,
	"note" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"last_block_hash" text,
	"head_block" bigint,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"reorgs_handled" integer DEFAULT 0 NOT NULL,
	"last_reconcile_at" timestamp with time zone,
	"reconcile_mismatches" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"market_id" integer PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"creator" text NOT NULL,
	"resolver" text NOT NULL,
	"arbitrator" text NOT NULL,
	"metadata_raw" text NOT NULL,
	"metadata_hash" text NOT NULL,
	"structured" boolean NOT NULL,
	"question" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"rules" jsonb,
	"source_name" text,
	"source_url" text,
	"resolves_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx" text NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"fee_bps" integer NOT NULL,
	"protocol_fee_share_bps" integer NOT NULL,
	"proposal_window" integer NOT NULL,
	"challenge_window" integer NOT NULL,
	"arbitration_window" integer NOT NULL,
	"proposer_bond" numeric(78, 0) NOT NULL,
	"dispute_bond" numeric(78, 0) NOT NULL,
	"initial_liquidity" numeric(78, 0) NOT NULL,
	"initial_yes_prob_bps" integer NOT NULL,
	"pool_yes" numeric(78, 0) NOT NULL,
	"pool_no" numeric(78, 0) NOT NULL,
	"collateral" numeric(78, 0) NOT NULL,
	"price_yes" double precision NOT NULL,
	"volume" numeric(78, 0) NOT NULL,
	"trade_count" integer NOT NULL,
	"trader_count" integer NOT NULL,
	"last_trade_at" timestamp with time zone,
	"proposed_outcome" integer,
	"proposed_at" timestamp with time zone,
	"challenge_deadline" timestamp with time zone,
	"disputer" text,
	"disputed_at" timestamp with time zone,
	"arbitration_deadline" timestamp with time zone,
	"final_outcome" integer,
	"finalized_at" timestamp with time zone,
	"finalize_reason" integer,
	"last_event_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"market_id" integer NOT NULL,
	"account" text NOT NULL,
	"yes_shares" numeric(78, 0) NOT NULL,
	"no_shares" numeric(78, 0) NOT NULL,
	"yes_cost" numeric(78, 0) NOT NULL,
	"no_cost" numeric(78, 0) NOT NULL,
	"realized_pnl" numeric(78, 0) NOT NULL,
	"fees_paid" numeric(78, 0) NOT NULL,
	"redeemed" boolean NOT NULL,
	"redeemed_payout" numeric(78, 0) NOT NULL,
	"is_creator" boolean NOT NULL,
	"updated_block" bigint NOT NULL,
	CONSTRAINT "positions_market_id_account_pk" PRIMARY KEY("market_id","account")
);
--> statement-breakpoint
CREATE TABLE "resolution_proposals" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"proposer" text NOT NULL,
	"outcome" integer NOT NULL,
	"evidence_hash" text NOT NULL,
	"evidence_uri" text NOT NULL,
	"challenge_deadline" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"trader" text NOT NULL,
	"side" text NOT NULL,
	"is_buy" boolean NOT NULL,
	"collateral" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"shares" numeric(78, 0) NOT NULL,
	"pool_yes" numeric(78, 0) NOT NULL,
	"pool_no" numeric(78, 0) NOT NULL,
	"price_yes_after" double precision NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_proposals" ADD CONSTRAINT "resolution_proposals_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_events_uniq" ON "chain_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_events_market" ON "chain_events" USING btree ("market_id","block_number");--> statement-breakpoint
CREATE INDEX "chain_events_actor" ON "chain_events" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "chain_events_block" ON "chain_events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "evidence_market" ON "evidence" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "markets_close" ON "markets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "markets_category" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "markets_creator" ON "markets" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "positions_account" ON "positions" USING btree ("account");--> statement-breakpoint
CREATE INDEX "trades_market_time" ON "trades" USING btree ("market_id","block_time");--> statement-breakpoint
CREATE INDEX "trades_trader" ON "trades" USING btree ("trader");