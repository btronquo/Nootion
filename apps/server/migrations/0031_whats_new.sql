ALTER TABLE `users` ADD `seen_version` text DEFAULT '';--> statement-breakpoint
-- Accounts from before this version see the notes of the version they are updated to, once.
UPDATE `users` SET `seen_version` = NULL;