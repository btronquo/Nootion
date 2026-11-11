ALTER TABLE `comment_threads` ADD `sync_clock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `sync_clock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_links` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `sync_links` ADD `remote_user_id` text;--> statement-breakpoint
-- Sync, continued (sync.ts): attached files (added or deleted, never changed), comment threads and comments.
CREATE TRIGGER sync_attachment_insert AFTER INSERT ON attachments BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('attachment', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.page_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_attachment_delete AFTER DELETE ON attachments BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('attachment', OLD.id, (SELECT workspace_id FROM pages WHERE id = OLD.page_id), 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_thread_insert AFTER INSERT ON comment_threads BEGIN
  UPDATE comment_threads SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('thread', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.page_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_thread_update AFTER UPDATE OF anchor_start, anchor_end, quote, resolved_at, resolved_by ON comment_threads BEGIN
  UPDATE comment_threads SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('thread', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.page_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_thread_delete AFTER DELETE ON comment_threads BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('thread', OLD.id, (SELECT workspace_id FROM pages WHERE id = OLD.page_id), 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_comment_insert AFTER INSERT ON comments BEGIN
  UPDATE comments SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('comment', NEW.id, (SELECT p.workspace_id FROM comment_threads t JOIN pages p ON p.id = t.page_id WHERE t.id = NEW.thread_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_comment_update AFTER UPDATE OF body, edited_at ON comments BEGIN
  UPDATE comments SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('comment', NEW.id, (SELECT p.workspace_id FROM comment_threads t JOIN pages p ON p.id = t.page_id WHERE t.id = NEW.thread_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_comment_delete AFTER DELETE ON comments BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('comment', OLD.id, (SELECT p.workspace_id FROM comment_threads t JOIN pages p ON p.id = t.page_id WHERE t.id = OLD.thread_id), 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
-- What existed before the sync is recorded once, so that linking a space brings all of it.
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'page', id, workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM pages ORDER BY created_at;
--> statement-breakpoint
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'property', c.id, p.workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM database_properties c JOIN pages p ON p.id = c.database_id;
--> statement-breakpoint
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'view', c.id, p.workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM database_views c JOIN pages p ON p.id = c.database_id;
--> statement-breakpoint
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'attachment', a.id, p.workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM attachments a JOIN pages p ON p.id = a.page_id;
--> statement-breakpoint
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'thread', t.id, p.workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER) FROM comment_threads t JOIN pages p ON p.id = t.page_id;
--> statement-breakpoint
INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
  SELECT 'comment', c.id, p.workspace_id, 0, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER)
  FROM comments c JOIN comment_threads t ON t.id = c.thread_id JOIN pages p ON p.id = t.page_id ORDER BY c.created_at;
