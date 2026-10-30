CREATE TABLE `page_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`mention_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text,
	`excerpt` text DEFAULT '' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_mentions_user_idx` ON `page_mentions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_mentions_unique` ON `page_mentions` (`page_id`,`mention_id`);