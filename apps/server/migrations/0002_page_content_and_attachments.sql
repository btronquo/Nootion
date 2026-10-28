CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_page_idx` ON `attachments` (`page_id`);--> statement-breakpoint
ALTER TABLE `pages` ADD `content_state` blob;--> statement-breakpoint
ALTER TABLE `pages` ADD `content_json` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `content_text` text;