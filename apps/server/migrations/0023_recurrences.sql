CREATE TABLE `recurrences` (
	`template_id` text PRIMARY KEY NOT NULL,
	`rule` text NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_error` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
