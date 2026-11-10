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
  /** Notion's API, for imports. Changed in tests only. */
  notionApiUrl: string;
  /** Pause between two requests to Notion (it allows about 3 per second). */
  notionRequestInterval: number;
  /** Gives each new user a demo page (on their first visit). Off with DEMO_PAGE=false. */
  demoPage?: boolean;
  /** Looks for new Nootion releases (on GitHub) to tell administrators. Off with UPDATE_CHECK=false. */
  updateCheck?: boolean;
  /** Where the latest release is read from. Changed in tests only. */
  updateCheckUrl?: string;
}

const EXAMPLE_SECRETS = new Set(["replace-me-with-a-long-random-string", "dev-secret-do-not-use-in-production", "remplacez-moi-par-une-longue-chaine-aleatoire", "collez-ici-une-longue-chaine-aleatoire"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProduction = env.NODE_ENV === "production";
  const appSecret = env.APP_SECRET ?? (isProduction ? "" : "dev-secret-do-not-use-in-production");
  if (appSecret.length < 16) {
    throw new Error("APP_SECRET must be set and be at least 16 characters long.");
  }
  // The values written in the examples are public: a server must never run with one.
  if (isProduction && EXAMPLE_SECRETS.has(appSecret)) {
    throw new Error("APP_SECRET still holds the example value. Replace it with a random string (openssl rand -hex 32).");
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
    notionRequestInterval: Number(env.NOTION_REQUEST_INTERVAL ?? 340),
    demoPage: env.DEMO_PAGE !== "false",
    updateCheck: env.UPDATE_CHECK !== "false",
    updateCheckUrl: env.UPDATE_CHECK_URL ?? "https://api.github.com/repos/btronquo/Nootion/releases/latest",
    notionApiUrl: (env.NOTION_API_URL ?? "https://api.notion.com").replace(/\/+$/, ""),
  };
}
