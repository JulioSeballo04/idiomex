// ============================================================
// SERVICE WORKER — deixa o Idiomex instalável e abrindo rápido
// ============================================================
// Guarda as telas, estilos, scripts e imagens do próprio site. Os dados (Firebase)
// e a IA (Vercel) ficam de fora: vêm de outros domínios e sempre vão pela rede.
//
// O site sempre vem da rede quando há internet, então não é preciso mexer em VERSAO
// a cada atualização — só se mudar a lista ARQUIVOS_BASE.
// ============================================================

const VERSAO = "idiomex-v1";

const ARQUIVOS_BASE = [
  "./",
  "index.html",
  "dicionario.html",
  "professor.html",
  "css/style.css",
  "css/novidades.css",
  "js/firebase-config.js",
  "js/util.js",
  "js/auth.js",
  "js/tema.js",
  "js/dicionario.js",
  "js/professor.js",
  "assets/logo.png",
  "assets/logo-noturno.png",
  "assets/icon-192.png",
  "assets/favicon-32.png",
  "manifest.webmanifest"
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS_BASE)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.method !== "GET" || url.origin !== self.location.origin) return;

  // Sempre tenta a rede primeiro, pra ninguém ficar com uma versão velha do site
  // depois de uma atualização. A cópia guardada só é usada quando está sem internet.
  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(pedido).then((guardada) =>
        guardada || (pedido.mode === "navigate" ? caches.match("index.html") : Response.error())
      ))
  );
});
