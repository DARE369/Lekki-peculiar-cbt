// Offline support for the exam terminal (/exam). Keeps the exam page and its scripts cached so
// a lab computer can reload the page mid-exam with no internet. Answers themselves live in
// IndexedDB (see src/components/exam/store.ts); API calls are never cached.
const CACHE = "cbt-exam-v1";
const SHELL = ["/exam"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // The exam page: network first (fresh deploys), cached copy when offline or slow.
  if (req.mode === "navigate" && url.pathname.startsWith("/exam")) {
    event.respondWith(
      Promise.race([fetch(req), timeout(5000)])
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/exam", copy));
          }
          return res;
        })
        .catch(() => caches.match("/exam").then((r) => r || new Response("Offline", { status: 503 }))),
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico") {
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
  }
});
