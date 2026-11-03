CREATE TABLE `sso_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`secret` text,
	`scim_token_hash` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `sso_subject` text;--> statement-breakpoint
ALTER TABLE `users` ADD `scim_external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_sso_subject_unique` ON `users` (`sso_subject`);