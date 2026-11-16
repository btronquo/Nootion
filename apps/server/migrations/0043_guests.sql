ALTER TABLE `invitations` ADD `page_id` text REFERENCES pages(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `invitations` ADD `page_role` text;