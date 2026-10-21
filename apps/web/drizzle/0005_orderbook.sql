CREATE TABLE "fills" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"order_ref" text NOT NULL,
	"resting" boolean NOT NULL,
	"maker" text NOT NULL,
	"taker" text NOT NULL,
	"maker_outcome" integer NOT NULL,
	"maker_side" integer NOT NULL,
	"maker_price" integer NOT NULL,
	"quantity" numeric(78, 0) NOT NULL,
	"complement" boolean NOT NULL,
	"taker_fee" numeric(78, 0) NOT NULL,
	"yes_price" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incentive_ledger" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"market_id" integer,
	"account" text,
	"counterparty" text,
	"amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_graduations" (
	"market_id" integer PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"best_bid" integer NOT NULL,
	"best_ask" integer NOT NULL,
	"bid_depth" numeric(78, 0) NOT NULL,
	"ask_depth" numeric(78, 0) NOT NULL,
	"seeders" integer NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"hash" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"exchange" text NOT NULL,
	"market_id" integer NOT NULL,
	"maker" text NOT NULL,
	"taker" text NOT NULL,
	"outcome" integer NOT NULL,
	"side" integer NOT NULL,
	"price" integer NOT NULL,
	"quantity" numeric(78, 0) NOT NULL,
	"filled" numeric(78, 0) DEFAULT '0' NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"salt" numeric(78, 0) NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"policy_id" integer PRIMARY KEY NOT NULL,
	"params" jsonb NOT NULL,
	"active" boolean NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resting_orders" (
	"order_id" integer PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"maker" text NOT NULL,
	"outcome" integer NOT NULL,
	"side" integer NOT NULL,
	"price" integer NOT NULL,
	"quantity" numeric(78, 0) NOT NULL,
	"remaining" numeric(78, 0) NOT NULL,
	"seed" boolean NOT NULL,
	"status" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"placed_tx" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_tx" text
);
--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "protocol_fee_share_bps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "initial_liquidity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "initial_yes_prob_bps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "pool_yes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "pool_no" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "price_yes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "pool_yes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "pool_no" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "policy_id" integer;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "seeding_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "graduated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "best_bid" integer;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "best_ask" integer;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "escrowed" numeric(78, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "seed_order_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "seeder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "role_operations" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incentive_ledger" ADD CONSTRAINT "incentive_ledger_event_id_chain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."chain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fills_market_time" ON "fills" USING btree ("market_id","block_time");--> statement-breakpoint
CREATE INDEX "fills_maker" ON "fills" USING btree ("maker");--> statement-breakpoint
CREATE INDEX "fills_taker" ON "fills" USING btree ("taker");--> statement-breakpoint
CREATE INDEX "incentive_account" ON "incentive_ledger" USING btree ("account","kind");--> statement-breakpoint
CREATE INDEX "incentive_market" ON "incentive_ledger" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "orders_book" ON "orders" USING btree ("market_id","status","outcome","side","price");--> statement-breakpoint
CREATE INDEX "orders_maker" ON "orders" USING btree ("maker","status");--> statement-breakpoint
CREATE INDEX "resting_market" ON "resting_orders" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "resting_maker" ON "resting_orders" USING btree ("maker");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_range" CHECK ("price" BETWEEN 1 AND 99);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outcome_side" CHECK ("outcome" IN (0, 1) AND "side" IN (0, 1));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_fill_bounds" CHECK ("quantity" > 0 AND "filled" >= 0 AND "filled" <= "quantity");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lot" CHECK (mod("quantity", 10000000000000000) = 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status" CHECK ("status" IN ('open', 'filled', 'cancelled', 'expired', 'stale', 'removed'));--> statement-breakpoint
ALTER TABLE "resting_orders" ADD CONSTRAINT "resting_bounds" CHECK ("price" BETWEEN 1 AND 99 AND "remaining" >= 0 AND "remaining" <= "quantity");
