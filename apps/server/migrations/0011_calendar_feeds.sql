CREATE TABLE `calendar_feeds` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`page_id` text NOT NULL,
	`block_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_block_unique` ON `calendar_feeds` (`user_id`,`page_id`,`block_id`);