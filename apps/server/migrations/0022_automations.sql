CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`row_id` text,
	`key` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_runs_idx` ON `automation_runs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_key_unique` ON `automation_runs` (`automation_id`,`key`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`steps` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_database_idx` ON `automations` (`database_id`);