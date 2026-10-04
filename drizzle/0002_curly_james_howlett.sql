CREATE TABLE `agent_analytics` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`window` text NOT NULL,
	`state` text NOT NULL,
	`as_of` integer NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`actual_json` text NOT NULL,
	`baseline_json` text,
	`verified_at` integer
);
--> statement-breakpoint
CREATE INDEX `analytics_agent_window_idx` ON `agent_analytics` (`agent_id`,`window`,`as_of`);