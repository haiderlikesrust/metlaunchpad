ALTER TABLE `launches` ADD `pool_kind` text DEFAULT 'dlmm' NOT NULL;--> statement-breakpoint
ALTER TABLE `launches` ADD `description` text;--> statement-breakpoint
ALTER TABLE `launches` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `launches` ADD `socials_json` text;--> statement-breakpoint
ALTER TABLE `launches` ADD `model` text;--> statement-breakpoint
ALTER TABLE `launches` ADD `quote_mint` text;