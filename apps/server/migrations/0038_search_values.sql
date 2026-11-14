CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query` text DEFAULT '' NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_searches_user_idx` ON `saved_searches` (`user_id`);--> statement-breakpoint
CREATE TABLE `search_stale` (
	`page_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `cells_text` text;--> statement-breakpoint
-- Search in database values: pages_fts gets a third text, the row's cells as plain text (cells_text, written by search-index.ts).
DROP TRIGGER `pages_fts_insert`;--> statement-breakpoint
DROP TRIGGER `pages_fts_update`;--> statement-breakpoint
DROP TRIGGER `pages_fts_delete`;--> statement-breakpoint
DROP TABLE `pages_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `pages_fts` USING fts5(page_id UNINDEXED, title, body, cells, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
--> statement-breakpoint
INSERT INTO `pages_fts` (page_id, title, body, cells) SELECT id, title, coalesce(content_text, ''), coalesce(cells_text, '') FROM `pages`;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert` AFTER INSERT ON `pages` BEGIN
  INSERT INTO `pages_fts` (page_id, title, body, cells) VALUES (new.id, new.title, coalesce(new.content_text, ''), coalesce(new.cells_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update` AFTER UPDATE OF title, content_text, cells_text ON `pages` BEGIN
  DELETE FROM `pages_fts` WHERE page_id = old.id;
  INSERT INTO `pages_fts` (page_id, title, body, cells) VALUES (new.id, new.title, coalesce(new.content_text, ''), coalesce(new.cells_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM `pages_fts` WHERE page_id = old.id;
  DELETE FROM `search_stale` WHERE page_id = old.id;
END;
--> statement-breakpoint
-- Rows to index again, whatever wrote them (API, imports, sync, automations): their cells, or their database's columns
-- (an option renamed), or the name of a person they mention changed.
CREATE TRIGGER `search_stale_row_insert` AFTER INSERT ON `pages` WHEN new.kind = 'row' BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_stale_row_update` AFTER UPDATE OF props, kind, parent_id ON `pages` WHEN new.kind = 'row' BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_stale_property_insert` AFTER INSERT ON `database_properties` BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) SELECT id FROM `pages` WHERE parent_id = new.database_id AND kind = 'row';
END;
--> statement-breakpoint
CREATE TRIGGER `search_stale_property_update` AFTER UPDATE OF name, type, config ON `database_properties` BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) SELECT id FROM `pages` WHERE parent_id = new.database_id AND kind = 'row';
END;
--> statement-breakpoint
CREATE TRIGGER `search_stale_property_delete` AFTER DELETE ON `database_properties` BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) SELECT id FROM `pages` WHERE parent_id = old.database_id AND kind = 'row';
END;
--> statement-breakpoint
CREATE TRIGGER `search_stale_user_name` AFTER UPDATE OF name ON `users` BEGIN
  INSERT OR IGNORE INTO `search_stale` (page_id) SELECT id FROM `pages` WHERE kind = 'row' AND instr(props, new.id) > 0;
END;
--> statement-breakpoint
-- Existing rows are indexed once, on the first start.
INSERT INTO `search_stale` (page_id) SELECT id FROM `pages` WHERE kind = 'row';
