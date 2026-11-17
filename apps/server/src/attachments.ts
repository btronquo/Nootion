import type { FastifyReply } from "fastify";
import type { Db } from "./db/index.js";
import { attachments } from "./db/schema.js";
import { t } from "@nootion/shared";
import { fileStore, isFileBusy } from "./files.js";

export type AttachmentRow = typeof attachments.$inferSelect;

export { uploadsDir } from "./files.js";

// Types the browser may display inline. Anything else (HTML, SVG, scripts…) is always downloaded,
// so an uploaded file can never run code in the app's origin.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "text/plain",
]);

/**
 * Sends an attached file. A `range` header ("bytes=0-1023") gets that part only, so that videos can be played from
 * any point without being downloaded whole first. With a bucket that allows it (FILES_S3_REDIRECT), the browser is
 * sent to a link signed for a few minutes instead: access has been checked by then.
 */
export async function sendAttachment(reply: FastifyReply, dataDir: string, a: AttachmentRow, forceDownload = false, range?: string) {
  const store = fileStore(dataDir);
  const inline = !forceDownload && INLINE_TYPES.has(a.mimeType);
  const contentType = inline ? a.mimeType : "application/octet-stream";
  const signed = store.signedUrl(a.id, { filename: a.filename, contentType, inline });
  if (signed) return reply.header("cache-control", "private, no-store").redirect(signed, 302);
  let part: ReturnType<typeof byteRange> = null;
  let size: number | null = null;
  if (range) {
    size = await store.size(a.id);
    if (size === null) return notFoundFile(reply);
    part = byteRange(range, size);
    if (part === "unsatisfiable") return reply.status(416).header("content-range", `bytes */${size}`).send();
  }
  const opened = await store.open(a.id, part ?? undefined);
  if (!opened) return notFoundFile(reply);
  size = opened.size;
  if (part) reply.status(206).header("content-range", `bytes ${part.start}-${part.end}/${size}`);
  reply
    .header("content-type", contentType)
    .header("content-length", part ? part.end - part.start + 1 : size)
    .header("accept-ranges", "bytes")
    .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .header("cache-control", "private, max-age=3600");
  return reply.send(opened.stream);
}

const notFoundFile = (reply: FastifyReply) => reply.status(404).send({ error: "not_found", message: t("error.fileNotFound") });

/** A single range of bytes ("bytes=500-", "bytes=-500", "bytes=0-99"); null when the header isn't one we take. */
export function byteRange(header: string, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

let cleaning: Promise<number> | null = null;

/**
 * Removes files whose attachment row is gone (deleted pages or workspaces). Runs in the background: one pass at a time,
 * and a call during a pass waits for it. Files being written are left alone (`isFileBusy`): their row comes next.
 */
export function cleanOrphanFiles(db: Db, dataDir: string): Promise<number> {
  cleaning ??= (async () => {
    const store = fileStore(dataDir);
    const ids: string[] = [];
    for await (const f of store.list()) ids.push(f.id);
    if (!ids.length) return 0;
    // A file whose writing just ended gets its row in the same turn: let that turn finish, then read the rows.
    await new Promise((r) => setImmediate(r));
    const known = new Set(
      db
        .select({ id: attachments.id })
        .from(attachments)
        .all()
        .map((r) => r.id),
    );
    let removed = 0;
    for (const id of ids) {
      if (known.has(id) || isFileBusy(id)) continue;
      await store.remove(id);
      removed++;
    }
    return removed;
  })().finally(() => {
    cleaning = null;
  });
  return cleaning;
}
