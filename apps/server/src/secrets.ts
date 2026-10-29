import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENC_PREFIX = "enc:v1:";

/** Key used to encrypt the secrets stored in the database, derived from APP_SECRET, one per purpose. */
export function secretKey(appSecret: string, purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}:${appSecret}`).digest();
}

export function encryptSecret(key: Buffer, value: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

/** The secret, or null when it can't be read (APP_SECRET changed: it has to be typed again). */
export function decryptSecret(key: Buffer, value: string): string | null {
  try {
    const raw = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const isEncrypted = (value: string) => value.startsWith(ENC_PREFIX);
