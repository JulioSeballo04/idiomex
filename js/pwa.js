// Registra o service worker (sw.js), que deixa o Idiomex instalável como app
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker não registrado:", e));
  });
}
