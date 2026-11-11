CREATE TABLE `sync_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text,
	`deleted` integer DEFAULT false NOT NULL,
	`origin` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_changes_ws_idx` ON `sync_changes` (`workspace_id`,`seq`);--> statement-breakpoint
CREATE INDEX `sync_changes_entity_idx` ON `sync_changes` (`entity_id`);--> statement-breakpoint
CREATE TABLE `sync_links` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`server_url` text NOT NULL,
	`client_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`peer_id` text NOT NULL,
	`pulled_seq` integer DEFAULT 0 NOT NULL,
	`pushed_seq` integer DEFAULT 0 NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
ALTER TABLE `database_properties` ADD `sync_clock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `database_views` ADD `sync_clock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `sync_clock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `field_clock` text;--> statement-breakpoint
-- Sync with the desktop app (sync.ts): every change of a page, a database column or a view is recorded in
-- sync_changes and stamped with when it happened (sync_clock; field_clock for each field and cell of a page). While a
-- peer's changes are applied (sync_state 'applying'), their own clocks are kept and the change is recorded as theirs.
CREATE TRIGGER sync_pages_insert AFTER INSERT ON pages BEGIN
  UPDATE pages SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER), field_clock = json_patch(json_object('parentId', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'kind', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'title', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'icon', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'fullWidth', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'cover', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'coverPosition', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'position', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'deletedAt', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'deletedBy', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'template', CAST(unixepoch('subsec') * 1000 AS INTEGER), 'defaultTemplateId', CAST(unixepoch('subsec') * 1000 AS INTEGER)), (SELECT json_group_object('p:' || key, CAST(unixepoch('subsec') * 1000 AS INTEGER)) FROM json_each(coalesce(NEW.props, '{}')))) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at) VALUES ('page', NEW.id, NEW.workspace_id, 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_pages_update AFTER UPDATE OF parent_id, kind, title, icon, full_width, cover, cover_position, position, deleted_at, deleted_by, template, default_template_id, content_state, props ON pages BEGIN
  UPDATE pages SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER), field_clock = json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(json_patch(coalesce(OLD.field_clock, '{}'), CASE WHEN OLD.parent_id IS NEW.parent_id THEN '{}' ELSE json_object('parentId', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.kind IS NEW.kind THEN '{}' ELSE json_object('kind', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.title IS NEW.title THEN '{}' ELSE json_object('title', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.icon IS NEW.icon THEN '{}' ELSE json_object('icon', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.full_width IS NEW.full_width THEN '{}' ELSE json_object('fullWidth', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.cover IS NEW.cover THEN '{}' ELSE json_object('cover', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.cover_position IS NEW.cover_position THEN '{}' ELSE json_object('coverPosition', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.position IS NEW.position THEN '{}' ELSE json_object('position', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.deleted_at IS NEW.deleted_at THEN '{}' ELSE json_object('deletedAt', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.deleted_by IS NEW.deleted_by THEN '{}' ELSE json_object('deletedBy', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.template IS NEW.template THEN '{}' ELSE json_object('template', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.default_template_id IS NEW.default_template_id THEN '{}' ELSE json_object('defaultTemplateId', CAST(unixepoch('subsec') * 1000 AS INTEGER)) END), CASE WHEN OLD.props IS NEW.props THEN '{}' ELSE (SELECT json_group_object('p:' || k, CAST(unixepoch('subsec') * 1000 AS INTEGER)) FROM (
      SELECT n.key AS k FROM json_each(coalesce(NEW.props, '{}')) n
      WHERE NOT EXISTS (SELECT 1 FROM json_each(coalesce(OLD.props, '{}')) o WHERE o.key = n.key AND o.type = n.type AND o.value IS n.value)
      UNION
      SELECT o.key FROM json_each(coalesce(OLD.props, '{}')) o
      WHERE NOT EXISTS (SELECT 1 FROM json_each(coalesce(NEW.props, '{}')) n WHERE n.key = o.key))) END) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at) VALUES ('page', NEW.id, NEW.workspace_id, 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_pages_delete AFTER DELETE ON pages BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at) VALUES ('page', OLD.id, OLD.workspace_id, 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_property_insert AFTER INSERT ON database_properties BEGIN
  UPDATE database_properties SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('property', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.database_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_property_update AFTER UPDATE OF database_id, name, type, config, position ON database_properties BEGIN
  UPDATE database_properties SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('property', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.database_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_property_delete AFTER DELETE ON database_properties BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('property', OLD.id, (SELECT workspace_id FROM pages WHERE id = OLD.database_id), 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_view_insert AFTER INSERT ON database_views BEGIN
  UPDATE database_views SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('view', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.database_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_view_update AFTER UPDATE OF database_id, name, type, config, position ON database_views BEGIN
  UPDATE database_views SET sync_clock = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = NEW.id AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'applying' AND value IS NOT NULL);
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('view', NEW.id, (SELECT workspace_id FROM pages WHERE id = NEW.database_id), 0, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER sync_view_delete AFTER DELETE ON database_views BEGIN
  INSERT INTO sync_changes (entity, entity_id, workspace_id, deleted, origin, at)
    VALUES ('view', OLD.id, (SELECT workspace_id FROM pages WHERE id = OLD.database_id), 1, (SELECT value FROM sync_state WHERE key = 'applying'), CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
