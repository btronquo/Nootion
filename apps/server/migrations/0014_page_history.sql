CREATE TABLE `page_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`restored_from` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_snapshots_page_idx` ON `page_snapshots` (`page_id`,`created_at`);