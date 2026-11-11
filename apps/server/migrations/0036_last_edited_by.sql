-- Who changed a page last, for "Last edited by" columns.
ALTER TABLE `pages` ADD `updated_by` text REFERENCES users(id) ON DELETE set null;
