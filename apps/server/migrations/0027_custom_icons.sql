CREATE TABLE `custom_icons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
