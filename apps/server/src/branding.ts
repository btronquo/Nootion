import fs from "node:fs";
import path from "node:path";
import { DEFAULT_APP_NAME, type Branding } from "@nootion/shared";
import type { Db } from "./db/index.js";
import { imageExtension } from "./images.js";
import { getInstanceSettings } from "./settings.js";

// The instance's own name and logo ("Administration › Branding"). The name lives in the instance settings and is
// handed to t() (setAppName), so that every text saying "Nootion" says it instead; the logo is a file of the data folder.

export const brandingDir = (dataDir: string) => path.join(dataDir, "branding");

export const LOGO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** The extension of a logo, from its content: the raster formats of profile pictures, and SVG. */
export function logoExtension(data: Buffer): string | null {
  const raster = imageExtension(data);
  if (raster) return raster;
  // SVG is text: an <svg> root, maybe after a BOM, an XML declaration, comments or a doctype.
  const head = data.subarray(0, 4096).toString("utf8").replace(/^﻿/, "");
  const start = head.replace(/^(\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, "");
  return /^<svg[\s>]/i.test(start) ? ".svg" : null;
}

export const logoUrl = (logo: string | null) => (logo ? `/api/branding/logo?v=${logo.replace(/^logo-|\.\w+$/g, "")}` : null);

export function getBranding(db: Db): Branding {
  const s = getInstanceSettings(db);
  return { name: s.appName || DEFAULT_APP_NAME, customName: !!s.appName, logoUrl: logoUrl(s.logo) };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The web app's page with the instance's name and logo already in it: the browser tab, the home screen's name and
 * the favicon are right before any script runs. The branding also travels in a meta tag, read by the app at start.
 */
export function brandIndexHtml(html: string, branding: Branding, logoType: string | null): string {
  const name = escapeHtml(branding.name);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${name}$2`);
  if (branding.logoUrl) {
    const url = escapeHtml(branding.logoUrl);
    out = out.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="${logoType}" href="${url}" />`);
    out = out.replace(/(<link rel="apple-touch-icon" href=")[^"]*(")/, `$1${url}$2`);
  }
  const meta = `<meta name="nootion-branding" content="${escapeHtml(JSON.stringify(branding))}" />`;
  return out.replace("</head>", `  ${meta}\n  </head>`);
}

/** The installable app's manifest with the instance's name and logo. */
export function brandManifest(manifest: Record<string, unknown>, branding: Branding, logoType: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...manifest };
  if (branding.customName) {
    out.name = branding.name;
    out.short_name = branding.name;
  }
  if (branding.logoUrl) {
    const icon = { src: branding.logoUrl, sizes: "any", type: logoType };
    out.icons = [icon];
    if (Array.isArray(out.shortcuts)) out.shortcuts = out.shortcuts.map((s: Record<string, unknown>) => ({ ...s, icons: [icon] }));
  }
  return out;
}

/** The type of the custom logo, for the page's favicon link and the manifest; null without one. */
export const logoType = (logo: string | null) => (logo ? (LOGO_MIME[path.extname(logo)] ?? null) : null);

/** Removes logos that are no longer the current one. */
export function removeOldLogos(dataDir: string, keep: string | null) {
  const dir = brandingDir(dataDir);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) if (name.startsWith("logo-") && name !== keep) fs.rmSync(path.join(dir, name), { force: true });
}
