CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`scim_external_id` text,
	`scim` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `page_group_permissions` (
	`page_id` text NOT NULL,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`page_id`, `group_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_group_permissions_group_idx` ON `page_group_permissions` (`group_id`);--> statement-breakpoint
CREATE TABLE `workspace_group_members` (
	`workspace_id` text NOT NULL,
	`group_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `group_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_group_members_group_idx` ON `workspace_group_members` (`group_id`);--> statement-breakpoint
DROP INDEX `page_mentions_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `page_mentions_unique` ON `page_mentions` (`page_id`,`mention_id`,`user_id`);--> statement-breakpoint
CREATE VIEW `effective_workspace_members` AS
  SELECT `workspace_id`, `user_id`, `role` FROM `workspace_members`
  UNION ALL
  SELECT wg.`workspace_id`, gm.`user_id`, wg.`role` FROM `workspace_group_members` wg JOIN `group_members` gm ON gm.`group_id` = wg.`group_id`;--> statement-breakpoint
CREATE VIEW `effective_page_permissions` AS
  SELECT `page_id`, `user_id`, `role` FROM `page_permissions`
  UNION ALL
  SELECT pg.`page_id`, gm.`user_id`, pg.`role` FROM `page_group_permissions` pg JOIN `group_members` gm ON gm.`group_id` = pg.`group_id`;
