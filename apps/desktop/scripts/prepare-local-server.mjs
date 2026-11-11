// Prepares what the desktop app ships for its local mode ("On this computer"), before `tauri build` or `tauri dev`:
//   apps/desktop/local-server/        the server (built, with its production dependencies) and the web app
//   apps/desktop/src-tauri/binaries/  the Node binary that runs it, named for Tauri's externalBin (nootion-node-<target triple>)
// Native modules (SQLite, argon2) are installed for the system this runs on: build each platform on its own system.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "22.23.4";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "../..");
const out = path.join(desktop, "local-server");
const binaries = path.join(desktop, "src-tauri", "binaries");
const isWindows = process.platform === "win32";

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: isWindows });

// --- The server and the web app -----------------------------------------------------------------------------------
if (process.env.NOOTION_SKIP_SERVER_BUILD !== "1") {
  console.log("Building the web app and the server…");
  run("pnpm", ["--filter", "@nootion/web", "build"]);
  run("pnpm", ["--filter", "@nootion/server", "build"]);
}
fs.rmSync(out, { recursive: true, force: true });
console.log("Copying the server with its production dependencies…");
// Hoisted: a plain node_modules folder, without the links pnpm usually makes (installers copy files, not links).
run("pnpm", ["--filter", "@nootion/server", "--config.node-linker=hoisted", "deploy", "--prod", "--legacy", out]);
for (const extra of ["src", "test", "plugins/README.md", "build.mjs", "drizzle.config.ts", "tsconfig.json", "dist"]) {
  fs.rmSync(path.join(out, extra), { recursive: true, force: true });
}
pruneNodeModules(path.join(out, "node_modules"));
fs.cpSync(path.join(root, "apps/server/dist"), path.join(out, "dist"), { recursive: true });
fs.cpSync(path.join(root, "apps/server/migrations"), path.join(out, "migrations"), { recursive: true });
fs.cpSync(path.join(root, "apps/web/dist"), path.join(out, "web"), { recursive: true });
fs.copyFileSync(path.join(root, "CHANGELOG.md"), path.join(out, "CHANGELOG.md"));

// --- Node ----------------------------------------------------------------------------------------------------------
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const target = nodeTarget(triple);
const exe = path.join(binaries, `nootion-node-${triple}${triple.includes("windows") ? ".exe" : ""}`);
if (fs.existsSync(exe)) {
  console.log(`Node already there: ${path.relative(desktop, exe)}`);
} else {
  fs.mkdirSync(binaries, { recursive: true });
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const file = `node-v${NODE_VERSION}-${target.name}.${target.ext}`;
  console.log(`Downloading ${file}…`);
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums
    .split("\n")
    .find((l) => l.endsWith(`  ${file}`))
    ?.split(" ")[0];
  if (!expected) throw new Error(`${file} isn't listed in Node's checksums`);
  const archive = Buffer.from(await (await fetch(`${base}/${file}`)).arrayBuffer());
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${file}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nootion-node-"));
  fs.writeFileSync(path.join(tmp, file), archive);
  if (file.endsWith(".zip")) {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${file}' -DestinationPath .`], { cwd: tmp, stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xf", file], { cwd: tmp, stdio: "inherit" });
  }
  const dir = path.join(tmp, file.replace(/\.(zip|tar\.gz|tar\.xz)$/, ""));
  fs.copyFileSync(path.join(dir, target.bin), exe);
  fs.chmodSync(exe, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
}
checkFileNames(out);
console.log("Local server ready.");

/**
 * Leaves out what never runs: links to command-line tools, types, sources of native modules, tests, docs and source maps.
 * Tests also hold the odd file name the Windows installer (MSI) can't store, such as "snow ☃" in @fastify/send.
 */
function pruneNodeModules(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    // musl builds of native modules (Alpine Linux) are installed beside the glibc ones and would never load here.
    if (
      stat.isSymbolicLink() ||
      name === ".bin" ||
      name === "@types" ||
      (stat.isDirectory() && (name.endsWith("-musl") || (isPackage(dir) && /^(test|tests|__tests__)$/.test(name))))
    ) {
      fs.rmSync(full, { recursive: true, force: true });
    } else if (stat.isDirectory()) {
      if (path.basename(dir) === "better-sqlite3" && (name === "deps" || name === "src")) fs.rmSync(full, { recursive: true, force: true });
      else pruneNodeModules(full);
    } else if (/\.(d\.ts|d\.mts|d\.cts|map|md|markdown)$/i.test(name) && !/^license/i.test(name)) {
      fs.rmSync(full, { force: true });
    }
  }
}

/** A package's own folder, where its tests sit (node_modules/name or node_modules/@scope/name). */
function isPackage(dir) {
  return fs.existsSync(path.join(dir, "package.json")) && path.basename(path.dirname(dir)).match(/^(node_modules|@.+)$/) !== null;
}

/** File names the Windows installer can't store (it only knows the Western European characters): the build would fail at its very end. */
function checkFileNames(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (/[^\x20-\x7e\u00a0-\u00ff]/.test(name)) throw new Error(`The Windows installer can't hold this file name: ${path.join(dir, name)}`);
    if (fs.statSync(path.join(dir, name)).isDirectory()) checkFileNames(path.join(dir, name));
  }
}

function hostTriple() {
  const arch = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

function nodeTarget(triple) {
  const arch = triple.startsWith("aarch64") ? "arm64" : "x64";
  if (triple.includes("windows")) return { name: `win-${arch}`, ext: "zip", bin: "node.exe" };
  if (triple.includes("apple")) return { name: `darwin-${arch}`, ext: "tar.gz", bin: "bin/node" };
  return { name: `linux-${arch}`, ext: "tar.xz", bin: "bin/node" };
}
