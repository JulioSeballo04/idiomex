// Registra o service worker (sw.js), que deixa o Idiomex instalável como app
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker não registrado:", e));
  });
}

// -------------------- BAIXAR O APP NO CELULAR --------------------
// No celular, um botão "Baixar o app" instala o Idiomex na tela inicial (abre como
// app, sem a barra do navegador). No Android/Chrome o próprio navegador instala; no
// iPhone não existe esse atalho, então o botão explica o caminho (Compartilhar →
// Adicionar à Tela de Início). Some quando o app já está instalado e no computador.

let pedidoDeInstalacao = null; // o "instalar" do navegador (Android/Chrome)

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // o app mostra o próprio botão, na hora certa
  pedidoDeInstalacao = e;
});
window.addEventListener("appinstalled", () => {
  pedidoDeInstalacao = null;
  document.querySelectorAll(".baixar-app").forEach((el) => el.remove());
});

function appJaInstalado() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function ehCelular() {
  const toque = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
  return toque && Math.min(screen.width, screen.height) < 900;
}

function ehIphone() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad novo se diz "Mac"
}

const ICONE_BAIXAR = `<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

async function baixarApp() {
  const mostrar = (texto) => (typeof avisar === "function" ? avisar(texto) : window.alert(texto));
  if (pedidoDeInstalacao) {
    pedidoDeInstalacao.prompt();
    const escolha = await pedidoDeInstalacao.userChoice.catch(() => null);
    pedidoDeInstalacao = null;
    if (escolha && escolha.outcome === "accepted") document.querySelectorAll(".baixar-app").forEach((el) => el.remove());
    return;
  }
  if (ehIphone()) {
    mostrar("Para baixar o Idiomex no iPhone:\n\n1. Abra este site no Safari.\n2. Toque no botão Compartilhar (o quadrado com uma seta para cima, embaixo da tela).\n3. Role e toque em \"Adicionar à Tela de Início\".\n4. Toque em \"Adicionar\".\n\nPronto: o Idiomex aparece na sua tela inicial, como um app.");
  } else {
    mostrar("Para baixar o Idiomex no celular:\n\n1. Toque no menu do navegador (os três pontinhos ⋮, no canto de cima).\n2. Toque em \"Instalar app\" ou \"Adicionar à tela inicial\".\n3. Confirme.\n\nPronto: o Idiomex aparece na sua tela inicial, como um app.");
  }
}

function botaoBaixarApp(classeExtra) {
  return `<button type="button" class="btn btn-baixar-app ${classeExtra || ""}" id="btn-baixar-app" onclick="baixarApp()">${ICONE_BAIXAR}<span>Baixar o app no celular</span></button>`;
}

const CHAVE_FAIXA_APP = "faixaBaixarAppFechadaEm";

function fecharFaixaBaixarApp() {
  try { localStorage.setItem(CHAVE_FAIXA_APP, String(Date.now())); } catch (e) {}
  document.querySelectorAll(".faixa-baixar-app").forEach((el) => el.remove());
}

function faixaFechadaHaPouco() {
  try {
    const quando = Number(localStorage.getItem(CHAVE_FAIXA_APP) || 0);
    return Date.now() - quando < 30 * 24 * 60 * 60 * 1000; // volta depois de 30 dias
  } catch (e) { return false; }
}

function mostrarBotaoBaixarApp() {
  if (appJaInstalado() || !ehCelular() || document.querySelector(".baixar-app")) return;
  // Tela de entrar: botão dentro do cartão, acima do texto do rodapé
  const cartao = document.querySelector(".cartao-auth");
  if (cartao) {
    const area = document.createElement("div");
    area.className = "baixar-app area-baixar-app";
    area.innerHTML = botaoBaixarApp();
    const rodape = cartao.querySelector(".rodape-auth");
    cartao.insertBefore(area, rodape || null);
    return;
  }
  // Painéis do aluno e do professor: faixa logo abaixo do topo (dá para fechar)
  const topo = document.querySelector("header.cabecalho-app");
  if (!topo || faixaFechadaHaPouco()) return;
  const faixa = document.createElement("div");
  faixa.className = "baixar-app faixa-baixar-app";
  faixa.innerHTML = `<span class="texto-faixa-app">Use o Idiomex como app no seu celular</span>
    ${botaoBaixarApp("btn-mini")}
    <button type="button" class="btn-fechar-faixa-app" title="Fechar" aria-label="Fechar" onclick="fecharFaixaBaixarApp()">×</button>`;
  topo.insertAdjacentElement("afterend", faixa);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mostrarBotaoBaixarApp);
else mostrarBotaoBaixarApp();
