-- Children of a page with their clocks: a database's version (databaseVersion) is read from the index alone.
DROP INDEX `pages_parent_idx`;--> statement-breakpoint
CREATE INDEX `pages_parent_clock_idx` ON `pages` (`parent_id`,`sync_clock`,`updated_at`);