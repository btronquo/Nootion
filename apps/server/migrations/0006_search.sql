-- Full-text search: page titles and content (accents and case ignored).
-- Kept up to date by triggers, whatever writes the pages.
CREATE VIRTUAL TABLE `pages_fts` USING fts5(page_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
--> statement-breakpoint
INSERT INTO `pages_fts` (page_id, title, body) SELECT id, title, coalesce(content_text, '') FROM `pages`;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_insert` AFTER INSERT ON `pages` BEGIN
  INSERT INTO `pages_fts` (page_id, title, body) VALUES (new.id, new.title, coalesce(new.content_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_update` AFTER UPDATE OF title, content_text ON `pages` BEGIN
  DELETE FROM `pages_fts` WHERE page_id = old.id;
  INSERT INTO `pages_fts` (page_id, title, body) VALUES (new.id, new.title, coalesce(new.content_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `pages_fts_delete` AFTER DELETE ON `pages` BEGIN
  DELETE FROM `pages_fts` WHERE page_id = old.id;
END;
