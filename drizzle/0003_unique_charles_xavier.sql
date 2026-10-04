CREATE TABLE `agent_custody` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`base_mint` text NOT NULL,
	`wallet` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`pool_kind` text NOT NULL,
	`config_address` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_custody_base_mint_unique` ON `agent_custody` (`base_mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_custody_wallet_unique` ON `agent_custody` (`wallet`);--> statement-breakpoint
CREATE TABLE `credit_snapshots` (
	`observed_at` integer PRIMARY KEY NOT NULL,
	`remaining_micros` text NOT NULL,
	`used_micros` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fee_receipts` (
	`signature` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`recipient` text NOT NULL,
	`usd_micros` integer NOT NULL,
	`compute_micros` integer NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fee_receipts_agent_idx` ON `fee_receipts` (`agent_id`);--> statement-breakpoint
CREATE TABLE `funding_monitor` (
	`id` text PRIMARY KEY NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_plan` text,
	`last_forecast_at` integer,
	`target_hours` integer DEFAULT 24 NOT NULL
);
