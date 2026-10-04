CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`nonce` text,
	`nonce_expires` integer
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`pool_address` text NOT NULL,
	`pool_name` text NOT NULL,
	`wallet` text NOT NULL,
	`position_address` text NOT NULL,
	`model` text NOT NULL,
	`policy` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_run` integer,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`owner`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`agent_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_owner_idx` ON `events` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `funding` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`address` text NOT NULL,
	`amount_usd` real NOT NULL,
	`status` text NOT NULL,
	`signature` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`mint` text NOT NULL,
	`signature` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`price` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_agent_idx` ON `snapshots` (`agent_id`,`created_at`);