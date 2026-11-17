import { describe, expect, it } from "vitest";
import { completion, localeLabel, matchLocale, tIn, type Catalogue, type Locale } from "@nootion/shared";
import { CATALOGUES } from "../../../packages/shared/src/i18n/index.js";
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
    // French is kept complete; the other languages may lack texts, but the ones they have keep English's placeholders.
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const [locale, catalogue] of Object.entries(CATALOGUES) as [Locale, Catalogue][]) {
      for (const key of Object.keys(catalogue) as (keyof typeof en)[]) {
        expect([locale, key, Object.hasOwn(en, key)]).toEqual([locale, key, true]);
        const message = catalogue[key]!;
        const other = typeof message === "string" ? message : message.other;
        const reference = en[key];
        expect([locale, key, placeholders(other)]).toEqual([locale, key, placeholders(typeof reference === "string" ? reference : reference.other)]);
      }
    }
  });

  it("speaks German, Spanish and Italian, with their plural forms and numbers", () => {
    expect(tIn("de", "error.fileTooLarge", { max: 25 })).toBe("Datei zu groß (max. 25 MB).");
    expect(tIn("es", "table.count", { count: 1 })).toBe("1 fila");
    expect(tIn("es", "table.count", { count: 1500 })).toBe("1500 filas");
    expect(tIn("de", "table.count", { count: 1500 })).toBe("1.500 Zeilen");
    expect(tIn("it", "table.count", { count: 2 })).toBe("2 righe");
    for (const locale of ["de", "es", "it"] as const) expect(completion(locale)).toBe(100);
    expect(localeLabel("de")).toBe("Deutsch");
  });

  it("shows English for a text a language doesn't have yet", () => {
    const catalogue = CATALOGUES.it as Record<string, unknown>;
    const saved = catalogue["table.count"];
    delete catalogue["table.count"];
    try {
      // English text and English plural rules, numbers in the reader's format.
      expect(tIn("it", "table.count", { count: 1 })).toBe("1 row");
      expect(tIn("it", "table.count", { count: 15000 })).toBe("15.000 rows");
    } finally {
      catalogue["table.count"] = saved;
    }
  });

  it("chooses the plural form each language needs, falling back to “other”", () => {
    const catalogue = CATALOGUES.de as Record<string, unknown>;
    const saved = catalogue["table.count"];
    // As a Polish or Russian catalogue would write it: Intl picks the form, "other" covers the rest.
    catalogue["table.count"] = { one: "eine {count}", other: "viele {count}" };
    try {
      expect(tIn("de", "table.count", { count: 1 })).toBe("eine 1");
      expect(tIn("de", "table.count", { count: 0 })).toBe("viele 0");
    } finally {
      catalogue["table.count"] = saved;
    }
  });

  it("matches the browser's language and fills placeholders", () => {
    expect(matchLocale("fr-CH,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(matchLocale(["de-DE", "en-GB"])).toBe("de");
    expect(matchLocale("es-MX,es;q=0.9")).toBe("es");
    expect(matchLocale(["pt-BR", "it-IT"])).toBe("it");
    expect(matchLocale("pt")).toBe("en");
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
    expect((await c.patch("/api/auth/me", { locale: "pt" })).statusCode).toBe(400);
    expect((await c.patch("/api/auth/me", { locale: "de" })).json().user.locale).toBe("de");
    expect((await c.patch("/api/auth/me", { email: "x@example.com" })).json().message).toBe("Aktuelles Passwort falsch.");
    await c.patch("/api/auth/me", { locale: "en" });

    // Visitors get the browser's language.
    const visitor = new Client(app);
    expect((await visitor.request("GET", "/api/auth/me", undefined, { "accept-language": "fr" })).json().message).toBe("Connexion requise.");
    expect((await visitor.request("GET", "/api/auth/me", undefined, { "accept-language": "pt" })).json().message).toBe("Please sign in.");
    expect((await visitor.request("GET", "/api/auth/me", undefined, { "accept-language": "es" })).json().message).toBe("Inicia sesión.");
  });
});
