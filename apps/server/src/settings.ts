import { eq } from "drizzle-orm";
import { DEFAULT_INSTANCE_SETTINGS, instanceSettingsInput, type InstanceSettings } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { instanceSettings } from "./db/schema.js";

const ROW = "default";

/** The server-wide choices of administrators; the defaults until they change one. */
export function getInstanceSettings(db: Db): InstanceSettings {
  const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, ROW)).get();
  const parsed = instanceSettingsInput.safeParse(row?.config ?? {});
  return parsed.success ? parsed.data : DEFAULT_INSTANCE_SETTINGS;
}

export function saveInstanceSettings(db: Db, input: InstanceSettings): InstanceSettings {
  db.insert(instanceSettings)
    .values({ id: ROW, config: input })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { config: input, updatedAt: new Date() } })
    .run();
  return getInstanceSettings(db);
}
