// Serves site/dist at http://localhost:4173/Nootion/, the same address layout as GitHub Pages.
// Usage: npm run dev (builds, then serves). PORT changes the port.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const BASE = "/Nootion/";
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (url === "/") {
      res.writeHead(302, { Location: BASE }).end();
      return;
    }
    let file = path.join(DIST, url.startsWith(BASE) ? url.slice(BASE.length) : url);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    const found = fs.existsSync(file);
    if (!found) file = path.join(DIST, "404.html");
    res.writeHead(found ? 200 : 404, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Nootion's site: http://localhost:${PORT}${BASE}`));
