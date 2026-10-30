CREATE TABLE `page_visits` (
	`user_id` text NOT NULL,
	`page_id` text NOT NULL,
	`visited_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `page_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_visits_recent_idx` ON `page_visits` (`user_id`,`visited_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `home_page_id` text;