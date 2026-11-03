// Nootion service worker: makes the app installable and usable offline.
// The app's code is cached as it loads. Answers of the API are always asked to the server first;
// the last one of each address is kept so the pages already seen still open without network.
// Live editing (/collab) always goes to the server: page contents are kept by the editor itself.

const CACHE = "nootion-shell-v1";
// Cleared by the app at sign-out and when another account signs in.
const API_CACHE = "nootion-api";
// Downloads, answers that depend on what is typed, and the live event stream are never kept.
const NOT_KEPT = /^\/api\/(health|events|search|auth\/(?!me$)|admin\/backup|import\/)|\/export(\/|$|\?)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("nootion-") && n !== CACHE && n !== API_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/collab")) return;

  if (url.pathname.startsWith("/api/")) {
    if (NOT_KEPT.test(url.pathname)) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy));
          } else if (res.status === 401 || res.status === 403 || res.status === 404) {
            // No longer visible to this user: don't show the old copy offline.
            caches.open(API_CACHE).then((c) => c.delete(req));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { cacheName: API_CACHE }).then((hit) => {
            if (!hit) return Response.error();
            // Tells the app this answer comes from the offline copy.
            const headers = new Headers(hit.headers);
            headers.set("x-nootion-offline", "1");
            return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
          }),
        ),
    );
    return;
  }

  // Pages of the app: the latest version from the server, or the saved one without network.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || Response.error())),
    );
    return;
  }

  // Built files have a hash in their name and never change: the cached copy is enough.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons and other static files: the server's version, the cached one when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});

// Reminders sent by the server (Web Push), shown even with the app closed.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not one of ours.
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Nootion", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

// Opens the page of the reminder, in the app's window if one is open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.focus().then(() => win.navigate(url).catch(() => self.clients.openWindow(url)));
      return self.clients.openWindow(url);
    }),
  );
});
