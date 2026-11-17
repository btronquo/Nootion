/**
 * Moves the attached files between the data folder and an S3-compatible bucket:
 *
 *   node dist/files-move.js to-bucket [--remove-source]   # /data/uploads → the bucket of FILES_S3_*
 *   node dist/files-move.js to-folder [--remove-source]   # the bucket of FILES_S3_* → /data/uploads
 *
 * The FILES_S3_* settings must be set both ways (to know the bucket). Files already in the destination are skipped:
 * the command can be run again, for instance once more after the switch for the files added meanwhile.
 */
import path from "node:path";
import { loadConfig } from "./config.js";
import { FolderStore, S3Store, moveFiles, uploadsDir } from "./files.js";

const [direction, ...flags] = process.argv.slice(2);
const removeSource = flags.includes("--remove-source");
if ((direction !== "to-bucket" && direction !== "to-folder") || flags.some((f) => f !== "--remove-source")) {
  console.error("Usage: node dist/files-move.js to-bucket|to-folder [--remove-source]");
  process.exit(2);
}

const config = loadConfig();
if (!config.files) {
  console.error("FILES_S3_BUCKET isn't set: give the bucket's settings (FILES_S3_*) to move files to it or from it.");
  process.exit(2);
}
const folder = new FolderStore(uploadsDir(config.dataDir));
const bucket = new S3Store(config.files, path.join(uploadsDir(config.dataDir), ".incoming"));
try {
  await bucket.check();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const [from, to] = direction === "to-bucket" ? [folder, bucket] : [bucket, folder];
console.log(`Moving the attached files from ${from.describe()} to ${to.describe()}${removeSource ? ", removing each one from the source" : ""}…`);
let last = Date.now();
const report = await moveFiles(from, to, {
  removeSource,
  onProgress: (done) => {
    if (Date.now() - last > 2000) {
      last = Date.now();
      console.log(`  ${done} files…`);
    }
  },
});
console.log(`Done: ${report.copied} copied, ${report.skipped} already there${removeSource ? `, ${report.removed} removed from the source` : ""}.`);
for (const f of report.failed) console.error(`  ${f.id}: ${f.error}`);
if (report.failed.length) {
  console.error(`${report.failed.length} files couldn't be moved: run the command again once the cause is fixed.`);
  process.exit(1);
}
