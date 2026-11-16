ALTER TABLE `database_views` ADD `owner_page_id` text REFERENCES pages(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `database_views` ADD `owner_block_id` text;--> statement-breakpoint
ALTER TABLE `database_views` ADD `orphaned_at` integer;--> statement-breakpoint
CREATE INDEX `database_views_owner_idx` ON `database_views` (`owner_page_id`,`owner_block_id`);--> statement-breakpoint
-- A linked view's block taken out of its page: its views are marked, and kept until purged, so that undo brings
-- them back. Whatever writes the content (editor, API, imports, sync, templates).
CREATE TRIGGER `database_views_orphaned` AFTER UPDATE OF content_json ON `pages` BEGIN
  UPDATE `database_views`
     SET orphaned_at = CASE WHEN instr(coalesce(new.content_json, ''), owner_block_id) > 0 THEN NULL
                            ELSE coalesce(orphaned_at, CAST(unixepoch('subsec') * 1000 AS INTEGER)) END
   WHERE owner_page_id = new.id;
END;
