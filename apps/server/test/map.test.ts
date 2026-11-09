import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client, inviteUser, makeApp, setupAdmin } from "./helpers.js";
// @ts-expect-error plain JavaScript plugin
import { detectColumns, parseCoords } from "../plugins/map/server.js";

let app: FastifyInstance;
let boris: Client;
let team: string;
let page: string;

beforeEach(async () => {
  app = await makeApp();
  boris = await setupAdmin(app);
  team = (await boris.post("/api/workspaces", { name: "Voyages" })).json().workspace.id;
  page = (await boris.post("/api/pages", { workspaceId: team, parentId: null, title: "Envies" })).json().page.id;
  expect((await boris.patch("/api/admin/plugins/map", { enabled: true })).statusCode).toBe(200);
});

afterEach(async () => {
  await app.close();
});

const M = "/api/plugins/map";

interface Place {
  id: string;
  title: string;
  lat: number;
  lng: number;
  address: string | null;
  country: string | null;
  status: string | null;
}

describe("map plugin", () => {
  it("reads coordinates however they are written", () => {
    expect(parseCoords("48.85837, 2.29448")).toEqual({ lat: 48.85837, lng: 2.29448 });
    expect(parseCoords("-33.8568 151.2153")).toEqual({ lat: -33.8568, lng: 151.2153 });
    expect(parseCoords("https://www.google.com/maps/place/Tour+Eiffel/@48.8583701,2.2944813,17z/data=!3m1")).toEqual({ lat: 48.8583701, lng: 2.2944813 });
    expect(parseCoords("https://www.openstreetmap.org/?mlat=45.764&mlon=4.8357#map=15/45.764/4.8357")).toEqual({ lat: 45.764, lng: 4.8357 });
    expect(parseCoords("Lyon")).toBeNull();
    expect(parseCoords("123.4, 2")).toBeNull();
    expect(parseCoords("")).toBeNull();
  });

  it("finds the columns of any database with coordinates", () => {
    const cols = detectColumns([
      { id: "t", name: "Nom", type: "title" },
      { id: "a", name: "Latitude", type: "number" },
      { id: "b", name: "Longitude", type: "number" },
      { id: "c", name: "Adresse", type: "text" },
      { id: "s", name: "État", type: "select", config: { options: [] } },
    ]);
    expect(cols).toMatchObject({ title: "t", place: null, lat: "a", lng: "b", address: "c", status: "s" });
    expect(detectColumns([{ id: "t", name: "Nom", type: "title" }])).toMatchObject({ place: null, lat: null, lng: null });
  });

  it("creates a database of places, adds and moves places, and lists them", async () => {
    const created = await boris.post(`${M}/databases`, { pageId: page });
    expect(created.statusCode).toBe(200);
    const db = created.json().databaseId as string;
    const tree = (await boris.get(`/api/databases/${db}`)).json().database;
    expect(tree.title).toBe("Lieux à visiter");
    expect((await boris.get(`/api/pages/${db}`)).json().page.parentId).toBe(page);
    expect(tree.properties.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(["Statut", "Lieu", "Adresse", "Pays"]));
    expect(tree.properties.find((p: { name: string }) => p.name === "Lieu").config.plugin).toEqual({ id: "map", type: "place" });

    const empty = (await boris.get(`${M}/places?db=${db}`)).json();
    expect(empty).toMatchObject({ places: [], unplaced: 0, database: { id: db, title: "Lieux à visiter", canEdit: true } });
    expect(empty.statuses.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
      ["todo", "À voir"],
      ["visited", "Vu"],
    ]);

    const add = await boris.post(`${M}/places`, { db, title: "Mont Saint-Michel", lat: 48.636063, lng: -1.511457, address: "Le Mont-Saint-Michel, Manche", country: "France", status: "todo" });
    expect(add.statusCode).toBe(200);
    const place = add.json().place as Place;
    expect(place).toMatchObject({ title: "Mont Saint-Michel", lat: 48.63606, lng: -1.51146, address: "Le Mont-Saint-Michel, Manche", country: "France", status: "todo" });

    // The cell keeps readable coordinates; a row without any isn't on the map.
    const row = (await boris.get(`/api/databases/${db}`)).json().database.rows[0];
    const lieu = tree.properties.find((p: { name: string }) => p.name === "Lieu").id;
    expect(row.values[lieu]).toBe("48.63606, -1.51146");
    await boris.post(`/api/databases/${db}/rows`, { title: "Quelque part au Japon", values: {}, templateId: null });
    await boris.post(`/api/databases/${db}/rows`, { title: "Kyoto", values: { Lieu: "https://www.google.com/maps/@35.0116,135.7681,12z" }, templateId: null });

    const list = (await boris.get(`${M}/places?db=${db}`)).json();
    expect(list.unplaced).toBe(1);
    expect(list.places.map((p: Place) => p.title).sort()).toEqual(["Kyoto", "Mont Saint-Michel"]);

    expect((await boris.patch(`${M}/places/${place.id}`, { db, lat: 48.6361, lng: -1.5115 })).json().place).toMatchObject({ lat: 48.6361, lng: -1.5115 });
    expect((await boris.post(`${M}/places`, { db, title: "Nulle part", lat: 95, lng: 0 })).statusCode).toBe(400);
  });

  it("shows a database with latitude and longitude columns", async () => {
    const db = (await boris.post("/api/databases", { workspaceId: team, parentId: page, title: "Phares" })).json().database.id;
    await boris.post(`/api/databases/${db}/properties`, { name: "Latitude", type: "number", config: {} });
    await boris.post(`/api/databases/${db}/properties`, { name: "Longitude", type: "number", config: {} });
    await boris.post(`/api/databases/${db}/rows`, { title: "Phare d'Eckmühl", values: { Latitude: 47.7954, Longitude: -4.3727 }, templateId: null });
    const list = (await boris.get(`${M}/places?db=${db}`)).json();
    expect(list.places).toMatchObject([{ title: "Phare d'Eckmühl", lat: 47.7954, lng: -4.3727 }]);
    const added = (await boris.post(`${M}/places`, { db, title: "Phare du Créac'h", lat: 48.4594, lng: -5.1272 })).json().place;
    expect(added).toMatchObject({ lat: 48.4594, lng: -5.1272 });

    // Without any coordinates column, nothing can be added.
    const plain = (await boris.post("/api/databases", { workspaceId: team, parentId: page, title: "Livres" })).json().database.id;
    expect((await boris.post(`${M}/places`, { db: plain, title: "?", lat: 1, lng: 1 })).statusCode).toBe(409);
  });

  it("only shows places to people who can open the database", async () => {
    const db = (await boris.post(`${M}/databases`, { pageId: page })).json().databaseId;
    const alice = await inviteUser(app, boris, { name: "Alice", email: "alice@example.com", password: "alice-password" });
    expect((await alice.get(`${M}/places?db=${db}`)).statusCode).toBe(404);
    expect((await alice.post(`${M}/places`, { db, title: "x", lat: 1, lng: 1 })).statusCode).toBe(404);
    expect((await alice.post(`${M}/databases`, { pageId: page })).statusCode).toBe(403);
    expect((await new Client(app).get(`${M}/places?db=${db}`)).statusCode).toBe(401);
    // The map's tiles are public (shared pages).
    expect((await new Client(app).get(`${M}/config`)).json().tileUrl).toContain("{z}");
  });

  it("serves Leaflet from the plugin's assets, only while it is on", async () => {
    const anon = new Client(app);
    const js = await anon.get(`${M}/assets/leaflet/leaflet.js`);
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect((await anon.get(`${M}/assets/leaflet/leaflet.css`)).headers["content-type"]).toContain("text/css");
    expect((await anon.get(`${M}/assets/../server.js`)).statusCode).toBe(404);
    expect((await anon.get(`${M}/assets/%2e%2e/server.js`)).statusCode).toBe(404);
    expect((await anon.get(`${M}/assets/leaflet/LICENSE.txt`)).statusCode).toBe(404);
    await boris.patch("/api/admin/plugins/map", { enabled: false });
    expect((await anon.get(`${M}/assets/leaflet/leaflet.js`)).statusCode).toBe(404);
  });

  it("looks up addresses with Nominatim, once a second at most, and remembers them", async () => {
    const seen: string[] = [];
    const fake = http.createServer((req, res) => {
      seen.push(req.url!);
      const url = new URL(req.url!, "http://x");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/search")
        return res.end(
          JSON.stringify([
            { name: "Tour Eiffel", display_name: "Tour Eiffel, 5, Avenue Anatole France, Paris, France", lat: "48.8582599", lon: "2.2945006", type: "attraction", address: { country: "France" } },
          ]),
        );
      res.end(JSON.stringify({ name: "", display_name: "12, Rue de la Paix, Paris, France", address: { road: "Rue de la Paix", country: "France" } }));
    });
    await new Promise<void>((ok) => fake.listen(0, "127.0.0.1", ok));
    try {
      await boris.patch("/api/admin/plugins/map", { values: { geocoderUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/`, contactEmail: "me@example.org" } });
      const res = await boris.get(`${M}/search?q=${encodeURIComponent("tour eiffel")}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toEqual([{ name: "Tour Eiffel", label: "Tour Eiffel, 5, Avenue Anatole France, Paris, France", lat: 48.8582599, lng: 2.2945006, country: "France", kind: "attraction" }]);
      expect(seen[0]).toContain("q=tour+eiffel");
      expect(seen[0]).toContain("email=me%40example.org");
      expect(seen[0]).toContain("accept-language=fr");

      const t0 = Date.now();
      const rev = (await boris.get(`${M}/reverse?lat=48.869&lng=2.331`)).json().result;
      expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
      expect(rev).toMatchObject({ name: "Rue de la Paix", label: "12, Rue de la Paix, Paris, France", lat: 48.869, lng: 2.331, country: "France" });

      await boris.get(`${M}/search?q=${encodeURIComponent("tour eiffel")}`);
      expect(seen).toHaveLength(2);
      // Coordinates are read as they are, without asking the server.
      expect((await boris.get(`${M}/search?q=${encodeURIComponent("45.764, 4.8357")}`)).json().results[0]).toMatchObject({ lat: 45.764, lng: 4.8357, kind: "coordinates" });
      expect(seen).toHaveLength(2);
      expect((await boris.get(`${M}/search?q=a`)).statusCode).toBe(400);
    } finally {
      fake.close();
    }
  });
});
