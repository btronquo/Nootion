ALTER TABLE `users` ADD `tour_pending` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Accounts from before this version already know Nootion: only new accounts get the guided tour.
UPDATE `users` SET `tour_pending` = false;
