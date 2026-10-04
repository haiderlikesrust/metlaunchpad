CREATE TABLE `fee_buybacks` (
	`claim_signature` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`usd_micros` integer NOT NULL,
	`target_mint` text,
	`status` text DEFAULT 'awaiting_configuration' NOT NULL,
	`swap_signature` text,
	`burn_signature` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`claim_signature`) REFERENCES `fee_receipts`(`signature`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fee_buybacks_agent_idx` ON `fee_buybacks` (`agent_id`);
--> statement-breakpoint
CREATE TRIGGER `reserve_thicc_buyback_after_claim`
AFTER INSERT ON `fee_receipts`
BEGIN
 INSERT INTO `fee_buybacks` (`claim_signature`,`agent_id`,`usd_micros`,`status`,`created_at`)
 SELECT NEW.signature, NEW.agent_id,
   CAST((SELECT SUM(usd_micros) FROM fee_receipts WHERE agent_id=NEW.agent_id) / 10 AS INTEGER)
   - CAST(((SELECT SUM(usd_micros) FROM fee_receipts WHERE agent_id=NEW.agent_id) - NEW.usd_micros) / 10 AS INTEGER),
   'awaiting_configuration', NEW.verified_at;
END;
