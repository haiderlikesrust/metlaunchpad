CREATE TABLE `fee_collection_state` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`last_checked_at` integer,
	`next_check_at` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`last_error` text
);
