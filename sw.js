// Étagère : fonctionne hors ligne une fois ouvert une première fois.
const VERSION = "6a7e288f4c";
const COQUILLE = ["./", "index.html", "config.js", "manifest.webmanifest", "app.css", "app.js", "lecteur.js", "logo.js", "icone-192.png", "icone-512.png", "apple-touch-icon.png", "favicon-32.png", "icone.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open("etagere-" + VERSION).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("etagere-") && k !== "etagere-" + VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname === "api.github.com") return;
  // bibliothèques et polices : du cache d'abord
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(u.hostname)) {
    e.respondWith(caches.open("etagere-libs").then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (u.origin !== location.origin || /tom-\d\.txt$/.test(u.pathname) || /\/fiches\//.test(u.pathname)) return;
  // l'appli : le réseau d'abord (mises à jour), le cache hors ligne
  e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open("etagere-" + VERSION).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
