CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_email` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`details` text,
	`ip` text,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_idx` ON `audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`,`created_at`);