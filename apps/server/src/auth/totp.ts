import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Time-based one-time passwords (RFC 6238), as authenticator apps make them: SHA-1, 6 digits, 30 seconds. */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret for an authenticator app, in base32 (160 bits, as RFC 4226 recommends). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const n = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The step the code was made for, or null when it is wrong. A code from the step before or after also works
 * (a phone's clock a little off), but never one from a step already used: a code someone saw can't be replayed.
 */
export function checkTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(typed))) return s;
  }
  return null;
}

/** The link authenticator apps read from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export const RECOVERY_CODE_COUNT = 10;
// No 0/O or 1/I/L: codes get written down and typed back.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** One-time codes for when the phone is gone, shown as "XXXXX-XXXXX". */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let c = "";
    for (let i = 0; i < 10; i++) c += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

/** Typed with or without the dash, in any case. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}
