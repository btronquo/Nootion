CREATE TABLE `public_forms` (
	`token` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`block_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_forms_block_unique` ON `public_forms` (`page_id`,`block_id`);