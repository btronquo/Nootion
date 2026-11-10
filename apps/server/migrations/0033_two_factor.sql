CREATE TABLE `login_challenges` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_pending` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_step` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_codes` text DEFAULT '[]' NOT NULL;