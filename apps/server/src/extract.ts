import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { attachments } from "./db/schema.js";
import { attachmentPath } from "./attachments.js";

const run = promisify(execFile);

/** Text kept per file, enough for search. */
const MAX_TEXT = 200_000;
/** Pages of a scanned PDF that go through OCR. */
const MAX_OCR_PAGES = 20;
const STEP_TIMEOUT = 120_000;

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv))/;
const TEXT_NAMES = /\.(txt|md|markdown|csv|tsv|json|xml|html?|log)$/i;
const IMAGE_TYPES = /^image\/(png|jpe?g|tiff|bmp|gif|webp)$/;

export interface ExtractTools {
  pdftotext: boolean;
  pdftoppm: boolean;
  /** OCR languages available, as tesseract takes them ("fra+eng"), or null without tesseract. */
  ocr: string | null;
}

async function has(cmd: string, args: string[]) {
  try {
    return (await run(cmd, args, { timeout: 10_000 })).stdout + "";
  } catch {
    return null;
  }
}

/** Which tools this server has. Without them, files keep waiting and are read once the tools are installed. */
export async function detectTools(wanted = process.env.OCR_LANGS ?? "fra+eng"): Promise<ExtractTools> {
  const [pdftotext, pdftoppm, langs] = await Promise.all([has("pdftotext", ["-v"]), has("pdftoppm", ["-v"]), has("tesseract", ["--list-langs"])]);
  const installed = new Set((langs ?? "").split(/\s+/));
  const usable = wanted.split("+").filter((l) => installed.has(l));
  return { pdftotext: pdftotext !== null, pdftoppm: pdftoppm !== null, ocr: langs === null ? null : usable.join("+") || "eng" };
}

const clean = (text: string) =>
  text
    .replace(/\f/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

async function ocr(file: string, langs: string) {
  const { stdout } = await run("tesseract", [file, "-", "-l", langs], { timeout: STEP_TIMEOUT, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/**
 * Text of a file: read as is for text files, from the PDF's text layer (or by OCR for scans), by OCR for images.
 * Null when the type isn't supported, or the tools it needs are missing (`missing` is then set).
 */
export async function extractText(file: string, mimeType: string, filename: string, tools: ExtractTools): Promise<{ text: string | null; missing?: boolean }> {
  if (TEXT_TYPES.test(mimeType) || TEXT_NAMES.test(filename)) {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_TEXT * 2));
      fs.readSync(fd, buf, 0, buf.length, 0);
      const text = buf.toString("utf8");
      // A text name on a binary file: not text after all.
      return { text: text.includes("\u0000") ? null : clean(text) };
    } finally {
      fs.closeSync(fd);
    }
  }
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) {
    if (!tools.pdftotext) return { text: null, missing: true };
    const { stdout } = await run("pdftotext", ["-enc", "UTF-8", "-l", "500", file, "-"], { timeout: STEP_TIMEOUT, maxBuffer: 50 * 1024 * 1024 });
    const text = clean(stdout);
    // Little text for its pages: a scan. Its first pages go through OCR.
    if (text.length >= 40 || !tools.ocr || !tools.pdftoppm) return { text };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-ocr-"));
    try {
      await run("pdftoppm", ["-r", "200", "-gray", "-png", "-l", String(MAX_OCR_PAGES), file, path.join(dir, "p")], { timeout: STEP_TIMEOUT * 2 });
      const parts: string[] = [];
      for (const img of fs.readdirSync(dir).sort()) parts.push(await ocr(path.join(dir, img), tools.ocr));
      return { text: clean(`${text}\n${parts.join("\n")}`) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (IMAGE_TYPES.test(mimeType)) {
    if (!tools.ocr) return { text: null, missing: true };
    return { text: clean(await ocr(file, tools.ocr)) };
  }
  return { text: null };
}

/**
 * Background job that reads the text of attached files, one at a time, oldest first: new uploads, files brought by
 * imports and copies, and files that were waiting for tools to be installed.
 */
export function createExtractor(db: Db, dataDir: string, log: { warn: (o: unknown, msg: string) => void }) {
  let tools: Promise<ExtractTools> | null = null;
  let running = false;
  let again = false;
  let stopped = false;
  // Waiting for a missing tool: skipped until the next start of the server.
  const skipped = new Set<string>();

  async function work() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      tools ??= detectTools();
      const available = await tools;
      for (;;) {
        if (stopped) return;
        const next = db
          .select()
          .from(attachments)
          .where(eq(attachments.textStatus, "pending"))
          .orderBy(asc(attachments.createdAt))
          .all()
          .find((a) => !skipped.has(a.id));
        if (!next) break;
        const file = attachmentPath(dataDir, next.id);
        let status: "done" | "unsupported" | "failed" = "failed";
        let text: string | null = null;
        try {
          if (fs.existsSync(file)) {
            const result = await extractText(file, next.mimeType, next.filename, available);
            if (result.missing) {
              skipped.add(next.id);
              continue;
            }
            text = result.text;
            status = text === null ? "unsupported" : "done";
          }
        } catch (err) {
          log.warn({ err, attachment: next.id }, "Couldn't read the text of a file");
        }
        if (stopped) return;
        db.update(attachments).set({ text, textStatus: status }).where(eq(attachments.id, next.id)).run();
      }
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        void work();
      }
    }
  }

  const timer = setInterval(() => void work(), 60_000);
  timer.unref();
  return {
    /** Looks for files to read now (after an upload). */
    wake: () => void work(),
    /** Resolves once every waiting file has been read (tests). */
    async drain() {
      do {
        await work();
        await new Promise((r) => setTimeout(r, 10));
      } while (running);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export type Extractor = ReturnType<typeof createExtractor>;
