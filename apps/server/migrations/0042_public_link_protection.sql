ALTER TABLE `public_forms` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `public_forms` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `public_links` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `public_links` ADD `expires_at` integer;