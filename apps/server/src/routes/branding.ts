import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { LOGO_MAX_BYTES, t } from "@nootion/shared";
import { HttpError, notFound, requireAdmin } from "../http.js";
import { getInstanceSettings, saveInstanceSettings } from "../settings.js";
import { brandingDir, getBranding, LOGO_MIME, logoExtension, removeOldLogos } from "../branding.js";
import { audit, settingsTarget } from "../audit.js";

/** The instance's name and logo: read by every page (signed in or not), changed by administrators. */
export const brandingRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  const dataDir = app.config.dataDir;

  app.get("/branding", async () => ({ branding: getBranding(db) }));

  // Public, like the page that shows it: the sign-in page has the logo too.
  app.get("/branding/logo", async (req, reply) => {
    const { logo } = getInstanceSettings(db);
    if (!logo) throw notFound();
    const file = path.join(brandingDir(dataDir), logo);
    if (!fs.existsSync(file)) throw notFound();
    const versioned = typeof (req.query as Record<string, unknown>)?.v === "string";
    return (
      reply
        .header("Content-Type", LOGO_MIME[path.extname(logo)] ?? "application/octet-stream")
        .header("X-Content-Type-Options", "nosniff")
        // An SVG opened on its own runs nothing: no scripts, no outside requests.
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
        // Its address changes with each new logo.
        .header("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "no-cache")
        .send(fs.createReadStream(file))
    );
  });

  app.post("/admin/branding/logo", async (req) => {
    requireAdmin(req);
    const file = await req.file();
    if (!file) throw new HttpError(400, "no_file", t("error.noFile"));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of file.file) {
      size += chunk.length;
      if (size > LOGO_MAX_BYTES) throw new HttpError(413, "too_large", t("error.logoTooLarge"));
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    // The type comes from the file content, not from what the browser claims.
    const ext = logoExtension(data);
    if (!ext) throw new HttpError(400, "bad_image", t("error.logoFormat"));
    const dir = brandingDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    const name = `logo-${randomBytes(8).toString("hex")}${ext}`;
    fs.writeFileSync(path.join(dir, name), data);
    saveInstanceSettings(db, { ...getInstanceSettings(db), logo: name });
    removeOldLogos(dataDir, name);
    audit(db, req, { action: "settings.changed", target: settingsTarget("server"), details: { keys: ["logo"] } });
    return { branding: getBranding(db) };
  });

  app.delete("/admin/branding/logo", async (req) => {
    requireAdmin(req);
    if (getInstanceSettings(db).logo) {
      saveInstanceSettings(db, { ...getInstanceSettings(db), logo: null });
      removeOldLogos(dataDir, null);
      audit(db, req, { action: "settings.changed", target: settingsTarget("server"), details: { keys: ["logo"] } });
    }
    return { branding: getBranding(db) };
  });
};
