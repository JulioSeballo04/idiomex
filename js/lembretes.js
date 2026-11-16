// ============================================================
// LEMBRETES ANTES DAS AULAS — painel do professor
// ============================================================
// O professor liga os lembretes neste aparelho: o app pede permissão de
// notificação, pega o endereço de notificação do aparelho (token do Firebase Cloud
// Messaging) e guarda em usuarios/{uid}/dispositivos. O servidor (api/lembretes.js),
// chamado a cada 5 minutos, manda o aviso 1 hora (ou o tempo escolhido) antes de
// cada aula marcada e de cada compromisso com horário — mesmo com o app fechado.
//
// Enquanto o painel está aberto, o próprio app também avisa (sem depender do
// servidor). Os dois usam a mesma "tag", então o celular não mostra o aviso duas vezes.
// ============================================================

const ENDPOINT_LEMBRETES = AI_ENDPOINT.replace("gerar-frase", "lembretes");
const CHAVE_APARELHO_LEMBRETES = "lembretesDesteAparelho"; // {id, token, antecedencia}
const OPCOES_ANTECEDENCIA = [[15, "15 minutos"], [30, "30 minutos"], [60, "1 hora"], [120, "2 horas"]];

function lembretesDesteAparelho() {
  try { return JSON.parse(localStorage.getItem(CHAVE_APARELHO_LEMBRETES) || "null"); } catch (e) { return null; }
}
function guardarLembretesDesteAparelho(dados) {
  try {
    if (dados) localStorage.setItem(CHAVE_APARELHO_LEMBRETES, JSON.stringify(dados));
    else localStorage.removeItem(CHAVE_APARELHO_LEMBRETES);
  } catch (e) {}
}

function suportaLembretes() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

// No iPhone, notificação só existe com o app instalado (aberto pela tela inicial)
function precisaInstalarParaLembretes() {
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const instalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return iphone && !instalado;
}

// Endereço de notificação deste aparelho (os testes automáticos trocam esta função)
async function obterTokenDeNotificacao() {
  if (window.__tokenNotificacaoTeste) return window.__tokenNotificacaoTeste();
  const registro = await navigator.serviceWorker.ready;
  return firebase.messaging().getToken({ serviceWorkerRegistration: registro });
}

async function idDoAparelho(token) {
  const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function colecaoDispositivos() {
  return db.collection("usuarios").doc((typeof professorIdAtual !== "undefined" && professorIdAtual) || auth.currentUser.uid).collection("dispositivos");
}

function nomeDoAparelho() {
  const ua = navigator.userAgent;
  const sistema = /android/i.test(ua) ? "Android" : /iphone|ipad|ipod/i.test(ua) ? "iPhone" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Aparelho";
  const navegador = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "navegador";
  return `${sistema} · ${navegador}`;
}

// -------------------- JANELA "LEMBRETES" --------------------

function garantirModalLembretes() {
  let modal = document.getElementById("modal-lembretes");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "modal-lembretes";
  modal.className = "modal-oculto";
  modal.innerHTML = `
    <div class="modal-conteudo modal-lembretes">
      <div class="modal-cabecalho">
        <h3>${icone("bell")} Lembretes antes das aulas</h3>
        <button type="button" class="btn-fechar-modal" title="Fechar" aria-label="Fechar" onclick="fecharLembretes()">${icone("x")}</button>
      </div>
      <div id="corpo-lembretes"></div>
    </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharLembretes(); });
  document.body.appendChild(modal);
  return modal;
}

function abrirLembretes() {
  garantirModalLembretes().classList.remove("modal-oculto");
  renderizarLembretes();
}

function fecharLembretes() {
  const modal = document.getElementById("modal-lembretes");
  if (modal) modal.classList.add("modal-oculto");
}

function renderizarLembretes(status) {
  const corpo = document.getElementById("corpo-lembretes");
  if (!corpo) return;
  const ligado = lembretesDesteAparelho();
  const instalar = typeof baixarApp === "function" && !(window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
  let conteudo;
  if (!suportaLembretes() || precisaInstalarParaLembretes()) {
    conteudo = `
      <p>Este navegador não recebe notificações.${precisaInstalarParaLembretes() ? " No iPhone, primeiro instale o Idiomex na tela inicial e abra por lá." : " Use o Chrome (no Android ou no computador)."}</p>
      ${instalar ? `<button type="button" class="btn btn-primario" onclick="baixarApp()">Baixar o app no celular</button>` : ""}`;
  } else if (ligado) {
    conteudo = `
      <p class="estado-lembretes ligado">${icone("circle-check")} Ligados neste aparelho</p>
      <label class="campo-antecedencia" for="select-antecedencia">Avisar
        <select id="select-antecedencia" onchange="mudarAntecedenciaLembretes(this.value)">
          ${OPCOES_ANTECEDENCIA.map(([v, r]) => `<option value="${v}"${v === ligado.antecedencia ? " selected" : ""}>${r}</option>`).join("")}
        </select>
        antes de cada aula e compromisso</label>
      <div class="acoes-lembretes">
        <button type="button" class="btn btn-primario" onclick="testarLembretes()">Mandar um teste</button>
        <button type="button" class="btn btn-secundario" onclick="desligarLembretes()">Desligar neste aparelho</button>
      </div>`;
  } else {
    conteudo = `
      <p>Receba uma notificação <strong>1 hora antes</strong> de cada aula marcada (com o nome do aluno) e de cada compromisso da agenda — mesmo com o app fechado.</p>
      <p class="dica-lembretes">Ligue em cada aparelho onde quer receber (ex: no celular). O navegador vai pedir permissão para mostrar notificações: toque em <strong>Permitir</strong>.</p>
      ${instalar ? `<p class="dica-lembretes">Dica: com o Idiomex instalado como app no celular, os avisos chegam com mais garantia.</p>` : ""}
      <div class="acoes-lembretes">
        <button type="button" class="btn btn-primario" id="btn-ligar-lembretes" onclick="ligarLembretes()">${icone("bell")} Ligar lembretes neste aparelho</button>
        ${instalar ? `<button type="button" class="btn btn-secundario" onclick="baixarApp()">Baixar o app no celular</button>` : ""}
      </div>`;
  }
  corpo.innerHTML = `${conteudo}<p class="status-msg" id="status-lembretes">${status ? escapeHtml(status) : ""}</p>`;
  atualizarBotaoLembretes();
}

function atualizarBotaoLembretes() {
  const botao = document.getElementById("btn-lembretes-aulas");
  if (!botao) return;
  const ligado = !!lembretesDesteAparelho();
  botao.classList.toggle("lembretes-ligados", ligado);
  botao.querySelector(".rotulo-lembretes").textContent = ligado ? "Lembretes ligados" : "Lembretes antes das aulas";
}

function mostrarStatusLembretes(texto) {
  const status = document.getElementById("status-lembretes");
  if (status) status.textContent = texto;
}

async function ligarLembretes() {
  const botao = document.getElementById("btn-ligar-lembretes");
  if (botao) botao.disabled = true;
  mostrarStatusLembretes("Ligando...");
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") {
      mostrarStatusLembretes("Sem permissão para notificações. Libere nas configurações do navegador (cadeado ao lado do endereço → Notificações → Permitir) e tente de novo.");
      return;
    }
    const token = await obterTokenDeNotificacao();
    if (!token) throw new Error("sem token");
    const id = await idDoAparelho(token);
    const antecedencia = 60;
    await colecaoDispositivos().doc(id).set({
      token,
      antecedencia,
      fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
      aparelho: nomeDoAparelho(),
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    guardarLembretesDesteAparelho({ id, token, antecedencia });
    renderizarLembretes('Pronto! Toque em "Mandar um teste" para ver como o aviso chega.');
    verificarLembretesLocais();
  } catch (e) {
    console.error(e);
    mostrarStatusLembretes("Não foi possível ligar os lembretes neste aparelho agora. Confira a internet e tente de novo.");
  } finally {
    if (botao) botao.disabled = false;
  }
}

async function desligarLembretes() {
  const ligado = lembretesDesteAparelho();
  if (!ligado) return renderizarLembretes();
  try {
    await colecaoDispositivos().doc(ligado.id).delete();
    if (!window.__tokenNotificacaoTeste && firebase.messaging) firebase.messaging().deleteToken().catch(() => {});
  } catch (e) {
    console.warn(e);
  }
  guardarLembretesDesteAparelho(null);
  renderizarLembretes("Lembretes desligados neste aparelho.");
}

async function mudarAntecedenciaLembretes(valor) {
  const ligado = lembretesDesteAparelho();
  if (!ligado) return;
  const antecedencia = Number(valor);
  try {
    await colecaoDispositivos().doc(ligado.id).update({ antecedencia, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    guardarLembretesDesteAparelho({ ...ligado, antecedencia });
    mostrarStatusLembretes("Salvo.");
  } catch (e) {
    console.error(e);
    mostrarStatusLembretes("Não foi possível salvar agora. Tente de novo.");
  }
}

// Pede ao servidor para mandar um aviso de teste para este aparelho
async function testarLembretes() {
  const ligado = lembretesDesteAparelho();
  if (!ligado) return;
  mostrarStatusLembretes("Mandando...");
  try {
    const resposta = await fetch(ENDPOINT_LEMBRETES, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
      body: JSON.stringify({ token: ligado.token })
    });
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 503) {
      mostrarStatusLembretes("O servidor ainda não está configurado para mandar os avisos com o app fechado (veja o README). Enquanto isso, o app avisa quando estiver aberto.");
      mostrarNotificacaoLocal({ titulo: "Lembretes do Idiomex ligados", corpo: "Assim chega o aviso antes de cada aula e compromisso da agenda.", tag: "lembrete-teste" });
      return;
    }
    if (!resposta.ok) throw new Error(dados.erro || resposta.status);
    if (!dados.enviados) {
      mostrarStatusLembretes("Este aparelho não está mais registrado. Desligue e ligue os lembretes de novo.");
      return;
    }
    mostrarStatusLembretes("Enviado! A notificação deve aparecer em instantes.");
  } catch (e) {
    console.error(e);
    mostrarStatusLembretes("Não foi possível mandar o teste agora. Confira a internet e tente de novo.");
  }
}

// -------------------- AVISO PELO PRÓPRIO APP (com o painel aberto) --------------------

async function mostrarNotificacaoLocal({ titulo, corpo, tag }) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opcoes = { body: corpo, tag, icon: "assets/icon-192.png", data: { url: "professor.html" } };
  try {
    const registro = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? await navigator.serviceWorker.getRegistration() : null;
    if (registro && registro.showNotification) return await registro.showNotification(titulo, opcoes);
  } catch (e) {}
  try { new Notification(titulo, opcoes); } catch (e) {}
}

const CHAVE_AVISOS_LOCAIS = "lembretesMostrados";

function minutosAteEvento(evento, agora) {
  const [h, m] = evento.horaInicio.split(":").map(Number);
  const [a, mes, d] = evento.data.split("-").map(Number);
  return Math.round((new Date(a, mes - 1, d, h, m) - agora) / 60000);
}

function eventosParaLembrar() {
  const aulas = (typeof aulasCache !== "undefined" ? aulasCache : [])
    .filter((a) => a.status === "agendada" && a.horaInicio)
    .map((a) => ({ tipo: "aula", ...a }));
  const compromissos = Object.entries(typeof anotacoesAgendaCache !== "undefined" ? anotacoesAgendaCache : {})
    .filter(([, n]) => n.tipo === "compromisso" && n.horaInicio)
    .map(([id, n]) => ({ tipo: "compromisso", id, ...n }));
  return [...aulas, ...compromissos];
}

function textoLembreteLocal(evento, minutos) {
  const faltam = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)}h${minutos % 60 ? String(minutos % 60).padStart(2, "0") : ""}`;
  if (evento.tipo === "aula") {
    return { titulo: `Aula às ${evento.horaInicio} com ${evento.alunoNome || "aluno"}`, corpo: `Começa em ${faltam}${evento.modalidade ? ` (${evento.modalidade}${evento.reposicao ? " · reposição" : ""})` : ""}.` };
  }
  return { titulo: `Compromisso às ${evento.horaInicio}`, corpo: `${evento.texto || "Compromisso"} · em ${faltam}.` };
}

function verificarLembretesLocais() {
  const ligado = lembretesDesteAparelho();
  if (!ligado || !("Notification" in window) || Notification.permission !== "granted") return;
  let mostrados = {};
  try { mostrados = JSON.parse(localStorage.getItem(CHAVE_AVISOS_LOCAIS) || "{}"); } catch (e) {}
  const agora = new Date();
  eventosParaLembrar().forEach((evento) => {
    const minutos = minutosAteEvento(evento, agora);
    if (minutos <= 0 || minutos > (ligado.antecedencia || 60)) return;
    const tag = `lembrete-${evento.tipo}-${evento.id}-${evento.data}-${evento.horaInicio}`;
    if (mostrados[tag]) return;
    mostrados[tag] = Date.now();
    mostrarNotificacaoLocal({ ...textoLembreteLocal(evento, minutos), tag });
  });
  // Esquece os avisos de mais de 2 dias
  Object.keys(mostrados).forEach((k) => { if (Date.now() - mostrados[k] > 2 * 86400000) delete mostrados[k]; });
  try { localStorage.setItem(CHAVE_AVISOS_LOCAIS, JSON.stringify(mostrados)); } catch (e) {}
}

// O endereço de notificação do aparelho pode mudar com o tempo: confere ao abrir
async function revalidarTokenLembretes() {
  const ligado = lembretesDesteAparelho();
  if (!ligado || !suportaLembretes() || Notification.permission !== "granted") return;
  try {
    const token = await obterTokenDeNotificacao();
    if (!token || token === ligado.token) return;
    const id = await idDoAparelho(token);
    await colecaoDispositivos().doc(id).set({
      token,
      antecedencia: ligado.antecedencia || 60,
      fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
      aparelho: nomeDoAparelho(),
      atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (id !== ligado.id) await colecaoDispositivos().doc(ligado.id).delete().catch(() => {});
    guardarLembretesDesteAparelho({ ...ligado, id, token });
  } catch (e) {
    console.warn("Não foi possível conferir o aparelho dos lembretes:", e);
  }
}

auth.onAuthStateChanged((user) => { if (user) setTimeout(revalidarTokenLembretes, 3000); });
setInterval(verificarLembretesLocais, 60000);
document.addEventListener("DOMContentLoaded", () => {
  atualizarBotaoLembretes();
  setTimeout(verificarLembretesLocais, 5000);
});
