import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  appUrl: string;
  appSecret: string;
  /** Directory holding the built web app, served as static files. Optional in dev. */
  webDir: string | null;
  isProduction: boolean;
  maxUploadMb: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === "production";
  const appSecret = env.APP_SECRET ?? (isProduction ? "" : "dev-secret-do-not-use-in-production");
  if (appSecret.length < 16) {
    throw new Error("APP_SECRET doit être défini et faire au moins 16 caractères.");
  }
  const port = Number(env.PORT ?? 3000);
  return {
    port,
    host: env.HOST ?? "0.0.0.0",
    dataDir: path.resolve(env.DATA_DIR ?? "./data"),
    appUrl: (env.APP_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    appSecret,
    webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : null,
    isProduction,
    maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 50),
  };
}
