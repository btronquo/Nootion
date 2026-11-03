import { describe, expect, it } from "vitest";
import { makeApp, setupAdmin } from "./helpers.js";

describe("demo page", () => {
  it("is given on a user's first visit only, with a database, a subpage and images", async () => {
    const app = await makeApp(undefined, { DEMO_PAGE: "true" });
    const boris = await setupAdmin(app);
    await boris.get("/api/home");
    await boris.get("/api/home");
    const ws = await boris.personalWorkspace();
    const tree = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages as { id: string; title: string; parentId: string | null; kind: string }[];
    const roots = tree.filter((p) => !p.parentId);
    expect(roots.map((p) => p.title)).toEqual(["Découvrir Nootion"]);
    const demo = roots[0]!.id;

    const content = (await boris.get(`/api/pages/${demo}/content`)).json().content as { content: { type: string; attrs?: Record<string, unknown> }[] };
    const types = JSON.stringify(content);
    for (const type of [
      "callout",
      "tableOfContents",
      "details",
      "table",
      "codeBlock",
      "columns",
      "buttonBlock",
      "databaseBlock",
      "calendarBlock",
      "chart",
      "progressBar",
      "countdown",
      "pomodoro",
      "habitTracker",
      "clock",
      "weather",
      "quoteOfDay",
      "imageCarousel",
    ])
      expect(types).toContain(`"type":"${type}"`);

    const dbBlock = content.content.find((n) => n.type === "databaseBlock")!;
    const database = (await boris.get(`/api/databases/${dbBlock.attrs!.pageId}`)).json().database;
    expect(database.rows).toHaveLength(8);
    expect(database.views.map((v: { type: string }) => v.type)).toEqual(["table", "board", "calendar", "timeline", "gallery", "list"]);

    const carousel = content.content.find((n) => n.type === "imageCarousel")!;
    const images = carousel.attrs!.images as string[];
    expect(images).toHaveLength(3);
    const img = await boris.get(images[0]!);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    // Asked again: a second copy.
    expect((await boris.post("/api/demo", {})).statusCode).toBe(200);
    const again = (await boris.get(`/api/workspaces/${ws}/pages`)).json().pages.filter((p: { parentId: string | null }) => !p.parentId);
    expect(again).toHaveLength(2);
  });
});
