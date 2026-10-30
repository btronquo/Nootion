ALTER TABLE `attachments` ADD `text` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `text_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Full-text search in attached files: their name and the text read from them.
CREATE VIRTUAL TABLE `attachments_fts` USING fts5(attachment_id UNINDEXED, page_id UNINDEXED, filename, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
--> statement-breakpoint
INSERT INTO `attachments_fts` (attachment_id, page_id, filename, body) SELECT id, page_id, filename, coalesce(text, '') FROM `attachments`;
--> statement-breakpoint
CREATE TRIGGER `attachments_fts_insert` AFTER INSERT ON `attachments` BEGIN
  INSERT INTO `attachments_fts` (attachment_id, page_id, filename, body) VALUES (new.id, new.page_id, new.filename, coalesce(new.text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `attachments_fts_update` AFTER UPDATE OF filename, text, page_id ON `attachments` BEGIN
  DELETE FROM `attachments_fts` WHERE attachment_id = old.id;
  INSERT INTO `attachments_fts` (attachment_id, page_id, filename, body) VALUES (new.id, new.page_id, new.filename, coalesce(new.text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `attachments_fts_delete` AFTER DELETE ON `attachments` BEGIN
  DELETE FROM `attachments_fts` WHERE attachment_id = old.id;
END;
