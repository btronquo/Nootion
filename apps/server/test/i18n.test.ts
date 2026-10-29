import { describe, expect, it } from "vitest";
import { matchLocale, tIn } from "@nootion/shared";
import { en } from "../../../packages/shared/src/i18n/en.js";
import { fr } from "../../../packages/shared/src/i18n/fr.js";
import { Client, makeApp } from "./helpers.js";

const ACCOUNT = { name: "Ada", email: "ada@example.com", password: "a-long-password" };

describe("languages", () => {
  it("every message exists in every language, with the same placeholders", () => {
    const placeholders = (m: unknown) =>
      JSON.stringify(m)
        .match(/\{\w+\}/g)
        ?.sort() ?? [];
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect([key, placeholders(fr[key])]).toEqual([key, placeholders(en[key])]);
  });

  it("matches the browser's language and fills placeholders", () => {
    expect(matchLocale("fr-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(matchLocale(["de-DE", "en-GB"])).toBe("en");
    expect(matchLocale("de")).toBe("en");
    expect(tIn("en", "error.fileTooLarge", { max: 25 })).toBe("File too large (max 25 MB).");
    expect(tIn("fr", "error.fileTooLarge", { max: 25 })).toBe("Fichier trop volumineux (max 25 Mo).");
  });

  it("an account takes the browser's language unless one is chosen, and can change it", async () => {
    const app = await makeApp();
    const c = new Client(app);
    const setup = await c.post("/api/setup", ACCOUNT, { "accept-language": "fr-FR,fr;q=0.9" });
    expect(setup.json().user.locale).toBe("fr");

    // Messages and default names follow the user's language, whatever the browser says.
    const ws = await c.personalWorkspace();
    const db = await c.request("POST", "/api/databases", { workspaceId: ws, parentId: null, title: "T" }, { "accept-language": "en" });
    expect(db.json().database.properties.map((p: { name: string }) => p.name)).toEqual(["Nom", "Étiquettes"]);
    expect((await c.patch("/api/auth/me", { email: "x@example.com" })).json().message).toBe("Mot de passe actuel incorrect.");

    expect((await c.patch("/api/auth/me", { locale: "en" })).json().user.locale).toBe("en");
    expect((await c.patch("/api/auth/me", { email: "x@example.com" })).json().message).toBe("Wrong current password.");
    expect((await c.patch("/api/auth/me", { locale: "de" })).statusCode).toBe(400);

    // Visitors get the browser's language.
    const visitor = new Client(app);
    expect((await visitor.request("GET", "/api/auth/me", undefined, { "accept-language": "fr" })).json().message).toBe("Connexion requise.");
    expect((await visitor.request("GET", "/api/auth/me", undefined, { "accept-language": "es" })).json().message).toBe("Please sign in.");
  });
});
