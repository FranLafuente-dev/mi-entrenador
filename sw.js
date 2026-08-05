/* ============================================================================
   MI ENTRENADOR — service worker
   Cachea la app entera (código, imágenes, íconos, campana y el SDK de
   Firebase del CDN) para que funcione sin conexión en el gimnasio.
   Al cambiar cualquier archivo de la app, subí VERSION para que los
   dispositivos se actualicen.
   ========================================================================== */

const VERSION = "v1";
const CACHE = `mi-entrenador-${VERSION}`;

const ARCHIVOS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "rutinas.js",
  "mensajes.js",
  "firebase-config.js",
  "manifest.json",
  "campana.mp3",
  "icons/icon-1024.png",
  "icons/icon-512.png",
  "icons/icon-192.png",
  "icons/icon-512-maskable.png",
  "icons/icon-192-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "img/ejercicios/calentamiento-abdominales.webp",
  "img/ejercicios/calentamiento-cinta.webp",
  "img/ejercicios/calentamiento-completo.webp",
  "img/ejercicios/calentamiento-rotaciones.webp",
  "img/ejercicios/curl-biceps-alternado.webp",
  "img/ejercicios/dorsalera.webp",
  "img/ejercicios/elevacion-gemelos.webp",
  "img/ejercicios/extension-cuadriceps.webp",
  "img/ejercicios/movilidad-circulos-hombros.webp",
  "img/ejercicios/movilidad-circulos-tobillo.webp",
  "img/ejercicios/movilidad-completa.webp",
  "img/ejercicios/movilidad-rodilla-pecho.webp",
  "img/ejercicios/movilidad-rotaciones-torso.webp",
  "img/ejercicios/movilidad-sentadilla-sin-peso.webp",
  "img/ejercicios/patada-triceps.webp",
  "img/ejercicios/prensa-posicion-1.webp",
  "img/ejercicios/prensa-posicion-2.webp",
  "img/ejercicios/press-pecho-maquina.webp",
  "img/ejercicios/remo-sentado.webp",
  "img/ejercicios/sentadilla-con-press.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // SDK de Firebase (CDN): primero caché, si no hay se baja y se guarda.
  // Sin esto la app no abre offline, porque app.js lo importa.
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return res;
      }))
    );
    return;
  }

  // Firestore, auth y demás dominios: la red se encarga (no interceptar).
  if (url.origin !== self.location.origin) return;

  // Archivos propios: caché primero (rápido y offline), y se actualiza
  // en segundo plano para la próxima apertura.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const red = fetch(req).then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
