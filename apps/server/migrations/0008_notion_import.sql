CREATE TABLE `notion_connections` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_by` text,
	`last_import_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `notion_links` (
	`workspace_id` text NOT NULL,
	`notion_id` text NOT NULL,
	`page_id` text NOT NULL,
	`notion_edited_at` text,
	PRIMARY KEY(`workspace_id`, `notion_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notion_links_page_idx` ON `notion_links` (`page_id`);--> statement-breakpoint
CREATE TABLE `notion_property_links` (
	`property_id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`notion_property_id` text NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `database_properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`database_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notion_property_links_unique` ON `notion_property_links` (`database_id`,`notion_property_id`);