CREATE TABLE `token_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`mint` text NOT NULL,
	`at` integer NOT NULL,
	`slot` integer NOT NULL,
	`transaction_index` integer NOT NULL,
	`instruction_index` integer NOT NULL,
	`price_usd` real NOT NULL,
	`volume_usd` real NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `token_trades_mint_at_idx` ON `token_trades` (`mint`,`at`);