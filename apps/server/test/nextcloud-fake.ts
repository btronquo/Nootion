import http from "node:http";
import type { AddressInfo } from "node:net";

/** A tiny stand-in for Nextcloud: Login Flow v2, the user API, WebDAV (PROPFIND, SEARCH, GET), previews. */
export interface FakeNextcloud {
  url: string;
  /** Requests received, as "METHOD path". */
  calls: string[];
  /** Makes the next login polls succeed (as if the user allowed access in Nextcloud). */
  allowLogin: () => void;
  /** App passwords that still work. */
  passwords: Set<string>;
  close: () => Promise<void>;
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

interface Item {
  path: string;
  folder?: boolean;
  type?: string;
  content?: Buffer;
  id: number;
}

const FILES: Item[] = [
  { path: "/", folder: true, id: 1 },
  { path: "/Photos", folder: true, id: 2 },
  { path: "/Photos/Chat gris.png", type: "image/png", content: PNG, id: 3 },
  { path: "/Factures", folder: true, id: 4 },
  { path: "/Factures/EDF & co.pdf", type: "application/pdf", content: Buffer.from("%PDF-1.4 facture"), id: 5 },
  { path: "/Notes.md", type: "text/markdown", content: Buffer.from("# Notes"), id: 6 },
];

export async function startFakeNextcloud(): Promise<FakeNextcloud> {
  const calls: string[] = [];
  const passwords = new Set<string>(["app-pw-manual"]);
  let allowed = false;
  let url = "";

  const authed = (req: http.IncomingMessage) => {
    const [login, password] = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64")
      .toString()
      .split(":");
    return login === "boris@example.com" && passwords.has(password ?? "");
  };

  const response = (f: Item) => {
    const href = `/remote.php/dav/files/boris${f.path.split("/").map(encodeURIComponent).join("/")}${f.folder && f.path !== "/" ? "/" : ""}`;
    const props = f.folder
      ? `<d:resourcetype><d:collection/></d:resourcetype><oc:size>${FILES.filter((x) => x.path.startsWith(f.path) && x.content).reduce((n, x) => n + x.content!.length, 0)}</oc:size>`
      : `<d:resourcetype/><d:getcontentlength>${f.content!.length}</d:getcontentlength><d:getcontenttype>${f.type}</d:getcontenttype><nc:has-preview>${f.type!.startsWith("image/")}</nc:has-preview>`;
    return `<d:response><d:href>${href.replace(/&/g, "&amp;")}</d:href><d:propstat><d:prop><d:getlastmodified>Mon, 02 Nov 2026 08:30:00 GMT</d:getlastmodified><oc:fileid>${f.id}</oc:fileid>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`;
  };
  const multistatus = (items: Item[]) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${items.map(response).join("")}</d:multistatus>`;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url!, url);
      calls.push(`${req.method} ${u.pathname}`);
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "POST" && u.pathname === "/index.php/login/v2") {
        return json(200, { poll: { token: "poll-token", endpoint: `${url}/index.php/login/v2/poll` }, login: `${url}/index.php/login/v2/flow/abc` });
      }
      if (req.method === "POST" && u.pathname === "/index.php/login/v2/poll") {
        if (!allowed || new URLSearchParams(body).get("token") !== "poll-token") return json(404, []);
        passwords.add("app-pw-flow");
        return json(200, { server: url, loginName: "boris@example.com", appPassword: "app-pw-flow" });
      }
      if (!authed(req)) return json(401, { message: "Unauthorized" });
      if (u.pathname === "/ocs/v1.php/cloud/user") return json(200, { ocs: { data: { id: "boris", "display-name": "Boris T." } } });
      if (req.method === "DELETE" && u.pathname === "/ocs/v2.php/core/apppassword") {
        passwords.delete(Buffer.from(req.headers.authorization!.slice(6), "base64").toString().split(":")[1]!);
        return json(200, {});
      }
      if (u.pathname === "/index.php/core/preview") {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG);
      }
      if (req.method === "SEARCH" && u.pathname === "/remote.php/dav/") {
        const like = body.match(/<d:literal>%(.*?)%<\/d:literal>/)?.[1]?.toLowerCase() ?? "";
        const found = FILES.filter((f) => f.path !== "/" && f.path.split("/").pop()!.toLowerCase().includes(like.replace(/&amp;/g, "&")));
        res.writeHead(207, { "content-type": "application/xml" });
        return res.end(multistatus(found));
      }
      const prefix = "/remote.php/dav/files/boris";
      if (u.pathname.startsWith(prefix)) {
        const path = decodeURIComponent(u.pathname.slice(prefix.length)).replace(/(.)\/$/, "$1") || "/";
        const item = FILES.find((f) => f.path === path);
        if (!item) return json(404, {});
        if (req.method === "PROPFIND") {
          const pre = path === "/" ? "/" : `${path}/`;
          const inside = item.folder ? FILES.filter((f) => f !== item && f.path.startsWith(pre) && !f.path.slice(pre.length).includes("/")) : [];
          res.writeHead(207, { "content-type": "application/xml" });
          return res.end(multistatus([item, ...inside]));
        }
        if (req.method === "GET" && !item.folder) {
          res.writeHead(200, { "content-type": item.type, "content-length": item.content!.length });
          return res.end(item.content);
        }
      }
      json(405, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    calls,
    passwords,
    allowLogin: () => {
      allowed = true;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
