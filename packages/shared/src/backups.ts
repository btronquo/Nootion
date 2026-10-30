import { z } from "zod";

/** Where scheduled backups go: a folder of the server (a NAS share mounted in it), or a WebDAV folder (Nextcloud…). */
export const backupDestinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("folder"), path: z.string().trim().min(1).max(1000) }),
  z.object({
    type: z.literal("webdav"),
    url: z.string().trim().url().max(2000),
    username: z.string().trim().min(1).max(200),
    /** Left out to keep the one saved. */
    password: z.string().max(500).optional(),
  }),
]);
export type BackupDestination = z.infer<typeof backupDestinationSchema>;

/** The full backup (database and files), made every day or every week at a time of day, keeping the last copies. */
export const backupScheduleInput = z.object({
  enabled: z.boolean().default(true),
  frequency: z.enum(["daily", "weekly"]),
  /** weekly: 0 = Sunday … 6 = Saturday. */
  weekday: z.number().int().min(0).max(6).default(1),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("03:00"),
  timeZone: z.string().min(1).max(64),
  destination: backupDestinationSchema,
  /** How many copies are kept there; older ones are deleted. */
  keep: z.number().int().min(1).max(365).default(7),
});
export type BackupScheduleInput = z.infer<typeof backupScheduleInput>;

export interface BackupSchedule extends Omit<BackupScheduleInput, "destination"> {
  /** The WebDAV password is never sent back. */
  destination: Exclude<BackupDestination, { type: "webdav" }> | (Omit<Extract<BackupDestination, { type: "webdav" }>, "password"> & { hasPassword: boolean });
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** The name of the last copy made, and its size in bytes. */
  lastName: string | null;
  lastSize: number | null;
}
