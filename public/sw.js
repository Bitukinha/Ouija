// Service worker mínimo: só cuida do "app shell" (documento HTML + assets
// estáticos) pra permitir instalação como PWA em qualquer tela. Nunca
// intercepta POST nem nada fora dos tipos de arquivo estáticos abaixo —
// as chamadas ao servidor (server functions, estado da sala) sempre vão
// direto pra rede, sem cache, pra não servir estado de jogo desatualizado.
const SHELL_CACHE = "ouija-shell-v1";
const STATIC_EXT = /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?|webmanifest)$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }

  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((res) => {
              cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached ?? network;
        }),
      ),
    );
  }
});
