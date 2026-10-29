ALTER TABLE `users` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
-- Accounts created before languages existed were made with the French interface.
UPDATE `users` SET `locale` = 'fr';
