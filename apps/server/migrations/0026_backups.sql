CREATE TABLE `backup_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`secret` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_error` text,
	`last_name` text,
	`last_size` integer,
	`updated_at` integer NOT NULL
);
