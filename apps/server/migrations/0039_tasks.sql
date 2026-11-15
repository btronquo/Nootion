CREATE TABLE `page_tasks` (
	`page_id` text NOT NULL,
	`position` integer NOT NULL,
	`block_id` text,
	`text` text DEFAULT '' NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`date` text,
	`mentions` text DEFAULT '[]' NOT NULL,
	`repeat` text,
	`checked_at` integer,
	PRIMARY KEY(`page_id`, `position`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_tasks_checked_idx` ON `page_tasks` (`checked`,`checked_at`);--> statement-breakpoint
CREATE TABLE `page_tasks_stale` (
	`page_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
-- Pages whose to-dos to read again, whatever wrote their content (editor, API, imports, sync, templates).
CREATE TRIGGER `page_tasks_stale_insert` AFTER INSERT ON `pages` WHEN new.content_json IS NOT NULL BEGIN
  INSERT OR IGNORE INTO `page_tasks_stale` (page_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `page_tasks_stale_update` AFTER UPDATE OF content_json, template ON `pages` BEGIN
  INSERT OR IGNORE INTO `page_tasks_stale` (page_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `page_tasks_stale_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM `page_tasks_stale` WHERE page_id = old.id;
END;
--> statement-breakpoint
-- The to-dos of existing pages are read once, on the first start.
INSERT INTO `page_tasks_stale` (page_id) SELECT id FROM `pages` WHERE content_json IS NOT NULL AND instr(content_json, '"taskItem"') > 0;
