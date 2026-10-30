CREATE TABLE `agent_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent` text NOT NULL,
	`action` text NOT NULL,
	`page_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_activity_user_idx` ON `agent_activity` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`workspace_ids` text NOT NULL,
	`read_only` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `client_id` text REFERENCES oauth_clients(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `refresh_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_refresh_unique` ON `api_tokens` (`refresh_hash`);--> statement-breakpoint
ALTER TABLE `page_snapshots` ADD `agent` text;