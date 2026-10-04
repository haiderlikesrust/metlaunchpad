CREATE TABLE `agent_positions` (
	`address` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`pool` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`signature` text NOT NULL,
	`mint` text NOT NULL,
	`amount` text NOT NULL,
	`decimals` integer NOT NULL,
	`usd_micros` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_claims_signature_mint_unique` ON `asset_claims` (`signature`,`mint`);--> statement-breakpoint
CREATE TABLE `asset_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`mint` text NOT NULL,
	`bucket` text NOT NULL,
	`amount` text NOT NULL,
	`operation_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "asset_bucket_check" CHECK("asset_entries"."bucket" IN ('compound','compute','reserve','buyback','burn','recycle'))
);
--> statement-breakpoint
CREATE INDEX `asset_entries_agent_idx` ON `asset_entries` (`agent_id`,`mint`,`bucket`);--> statement-breakpoint
CREATE TABLE `chain_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`purpose` text NOT NULL,
	`status` text NOT NULL,
	`wire` text NOT NULL,
	`message_hash` text NOT NULL,
	`signature` text,
	`last_valid_height` integer NOT NULL,
	`context_json` text NOT NULL,
	`result_json` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `chain_operations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `execution_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`input_mint` text NOT NULL,
	`input_amount` text NOT NULL,
	`output_mint` text,
	`output_amount` text,
	`context_json` text DEFAULT '{}' NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launch_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`wallet` text NOT NULL,
	`input_json` text NOT NULL,
	`mint` text NOT NULL,
	`config_address` text NOT NULL,
	`pool_address` text NOT NULL,
	`agent_wallet` text NOT NULL,
	`encrypted_keys` text NOT NULL,
	`curve_json` text NOT NULL,
	`image_type` text NOT NULL,
	`image_base64` text NOT NULL,
	`metadata_json` text NOT NULL,
	`stage` text DEFAULT 'config' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `launch_drafts_owner_idx` ON `launch_drafts` (`owner`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `launch_drafts_agentWallet_unique` ON `launch_drafts` (`agent_wallet`);--> statement-breakpoint
CREATE UNIQUE INDEX `launch_drafts_poolAddress_unique` ON `launch_drafts` (`pool_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `launch_drafts_configAddress_unique` ON `launch_drafts` (`config_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `launch_drafts_mint_unique` ON `launch_drafts` (`mint`);--> statement-breakpoint
CREATE TABLE `model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`cost_usd` real,
	`reserved_usd` real NOT NULL,
	`generation_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pool_cursors` (
	`pool` text PRIMARY KEY NOT NULL,
	`newest_signature` text,
	`before_signature` text,
	`target_signature` text,
	`last_indexed_at` integer
);
--> statement-breakpoint
CREATE TABLE `pool_observations` (
	`pool` text NOT NULL,
	`observed_at` integer NOT NULL,
	`slot` integer NOT NULL,
	`price_quote` real NOT NULL,
	`price_usd` real NOT NULL,
	`liquidity_usd` real NOT NULL,
	`quote_reserve` text NOT NULL,
	`base_reserve` text NOT NULL,
	PRIMARY KEY(`pool`, `observed_at`)
);
--> statement-breakpoint
CREATE TABLE `price_observations` (
	`mint` text NOT NULL,
	`observed_at` integer NOT NULL,
	`usd_price` real NOT NULL,
	PRIMARY KEY(`mint`, `observed_at`)
);
--> statement-breakpoint
CREATE TABLE `raw_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`quote_mint` text NOT NULL,
	`quote_decimals` integer NOT NULL,
	`pool` text NOT NULL,
	`signature` text NOT NULL,
	`at` integer NOT NULL,
	`slot` integer NOT NULL,
	`transaction_index` integer NOT NULL,
	`instruction_index` integer NOT NULL,
	`side` text NOT NULL,
	`base_amount` text NOT NULL,
	`quote_amount` text NOT NULL,
	`fee_quote` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agent_custody` ADD `last_action_at` integer;--> statement-breakpoint
ALTER TABLE `agent_custody` ADD `dlmm_pool` text;--> statement-breakpoint
ALTER TABLE `agent_custody` ADD `graduated_pool` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `last_tick` integer;--> statement-breakpoint
ALTER TABLE `funding` ADD `reconciled_at` integer;--> statement-breakpoint
ALTER TABLE `funding` ADD `baseline_credits` real;--> statement-breakpoint
ALTER TABLE `launches` ADD `quote_decimals` integer;--> statement-breakpoint
ALTER TABLE `launches` ADD `graduation_quote` real;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `fee_usd` real;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `pool` text;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `signature` text;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `base_amount` text;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `quote_amount` text;--> statement-breakpoint
ALTER TABLE `token_trades` ADD `side` text;