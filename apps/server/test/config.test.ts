import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("needs a secret of its own in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow("APP_SECRET must be set");
    expect(() => loadConfig({ NODE_ENV: "production", APP_SECRET: "short" })).toThrow("at least 16");
    // The value of docker-compose.yml, left as it is.
    expect(() => loadConfig({ NODE_ENV: "production", APP_SECRET: "replace-me-with-a-long-random-string" })).toThrow("example value");
    expect(loadConfig({ NODE_ENV: "production", APP_SECRET: "0123456789abcdef0123456789abcdef" }).isProduction).toBe(true);
    // Development works without one.
    expect(loadConfig({}).appSecret).toBe("dev-secret-do-not-use-in-production");
  });
});
