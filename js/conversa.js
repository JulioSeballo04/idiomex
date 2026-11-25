// ============================================================
// CONVERSA ENTRE PROFESSOR E ALUNO (chat)
// ============================================================
// Cada aluno tem a sua conversa com o professor em usuarios/{aluno}/conversa:
// {autorId, professorId, texto, criadoEm}. Os dois escrevem e leem; cada um guarda
// até quando já leu em usuarios/{si mesmo}/conversasLidas/{o outro} = {em}.
// O mesmo arquivo serve às duas telas: no painel do aluno, um botão abre a conversa
// com o professor; no do professor, o botão abre a lista de alunos e, dela, a
// conversa com cada um. O contador mostra as mensagens ainda não lidas.
// ============================================================

const LIMITE_MENSAGENS_CONVERSA = 300;
const conversas = {};          // {alunoId: [{id, autorId, professorId, texto, criadoEm}]}
const desligarConversas = {};  // {alunoId: função que para de escutar}
let lidasConversa = {};        // {idDoOutro: Date} — até quando EU já li
let conversaAberta = null;     // alunoId da conversa aberta (ou "" na lista do professor)
let escutandoLidas = null;

function souProfessorNaConversa() {
  return typeof professorIdAtual !== "undefined";
}

function meuIdNaConversa() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Na conversa de um aluno, o "outro" é o professor (para o aluno) ou o aluno (para o professor)
function outroDaConversa(alunoId) {
  return souProfessorNaConversa() ? alunoId : (typeof professorIdDoAluno !== "undefined" ? professorIdDoAluno : null);
}

function dataDaMensagem(m) {
  return m.criadoEm && m.criadoEm.toDate ? m.criadoEm.toDate() : new Date();
}

function naoLidasDaConversa(alunoId) {
  const eu = meuIdNaConversa();
  const lida = lidasConversa[outroDaConversa(alunoId)];
  return (conversas[alunoId] || []).filter((m) => m.autorId !== eu && (!lida || dataDaMensagem(m) > lida)).length;
}

// -------------------- ESCUTAR --------------------

function escutarConversa(alunoId, professorId) {
  if (desligarConversas[alunoId]) return;
  desligarConversas[alunoId] = db.collection("usuarios").doc(alunoId).collection("conversa")
    .orderBy("criadoEm", "desc").limit(LIMITE_MENSAGENS_CONVERSA)
    .onSnapshot((snap) => {
      conversas[alunoId] = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .filter((m) => m.professorId === professorId)
        .reverse();
      atualizarConversaNaTela(alunoId);
    }, (e) => console.warn("Não foi possível carregar a conversa:", e));
}

function pararDeEscutarConversa(alunoId) {
  if (desligarConversas[alunoId]) desligarConversas[alunoId]();
  delete desligarConversas[alunoId];
  delete conversas[alunoId];
}

function escutarLidasConversa() {
  const eu = meuIdNaConversa();
  if (!eu || escutandoLidas === eu) return;
  escutandoLidas = eu;
  db.collection("usuarios").doc(eu).collection("conversasLidas").onSnapshot((snap) => {
    lidasConversa = {};
    snap.docs.forEach((d) => { const em = d.data().em; if (em && em.toDate) lidasConversa[d.id] = em.toDate(); });
    atualizarConversaNaTela();
  }, (e) => console.warn("Não foi possível carregar as conversas lidas:", e));
}

// Chamado pelo painel quando a lista de alunos (professor) ou o professor (aluno) muda
function sincronizarConversas() {
  const eu = meuIdNaConversa();
  if (!eu) return;
  escutarLidasConversa();
  if (souProfessorNaConversa()) {
    const ids = new Set(alunosCache.map((a) => a.id));
    Object.keys(desligarConversas).forEach((id) => { if (!ids.has(id)) pararDeEscutarConversa(id); });
    ids.forEach((id) => escutarConversa(id, eu));
  } else {
    const professor = typeof professorIdDoAluno !== "undefined" ? professorIdDoAluno : null;
    Object.keys(desligarConversas).forEach((id) => { if (!professor) pararDeEscutarConversa(id); });
    if (professor) escutarConversa(eu, professor);
  }
  atualizarConversaNaTela();
}

// -------------------- TELA --------------------

function atualizarBotaoConversa() {
  const contador = document.getElementById("contador-conversa");
  if (!contador) return;
  const ids = souProfessorNaConversa() ? Object.keys(conversas) : [meuIdNaConversa()];
  const total = ids.reduce((soma, id) => soma + naoLidasDaConversa(id), 0);
  contador.hidden = !total;
  contador.textContent = total > 99 ? "99+" : String(total);
  const botao = document.getElementById("btn-conversa");
  if (botao) botao.hidden = !souProfessorNaConversa() && !(typeof professorIdDoAluno !== "undefined" && professorIdDoAluno);
}

function garantirModalConversa() {
  let modal = document.getElementById("modal-conversa");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "modal-conversa";
  modal.className = "modal-oculto";
  modal.innerHTML = `
    <div class="modal-conteudo modal-conversa" role="dialog" aria-labelledby="titulo-conversa">
      <div class="modal-cabecalho">
        <button type="button" class="btn-voltar-conversa" id="btn-voltar-conversa" hidden aria-label="Voltar para a lista" title="Voltar" onclick="abrirListaConversas()">${icone("arrow-left")}</button>
        <h3 id="titulo-conversa">Conversa</h3>
        <button type="button" class="btn-fechar-modal" title="Fechar" aria-label="Fechar" onclick="fecharConversa()">${icone("x")}</button>
      </div>
      <div id="corpo-conversa" class="corpo-conversa"></div>
      <form class="form-conversa" id="form-conversa" onsubmit="event.preventDefault(); enviarMensagemConversa();" hidden>
        <textarea id="input-conversa" rows="1" maxlength="2000" placeholder="Escreva uma mensagem..." onkeydown="teclaNaConversa(event)"></textarea>
        <button type="submit" class="btn btn-primario btn-enviar-conversa" id="btn-enviar-conversa" aria-label="Enviar" title="Enviar">${icone("send")}</button>
      </form>
    </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharConversa(); });
  document.body.appendChild(modal);
  return modal;
}

// Botão do topo: o aluno vai direto para a conversa; o professor vê a lista
function abrirConversas() {
  if (souProfessorNaConversa()) abrirListaConversas();
  else abrirConversa(meuIdNaConversa());
}

function abrirListaConversas() {
  garantirModalConversa().classList.remove("modal-oculto");
  conversaAberta = "";
  renderizarConversa();
}

function abrirConversa(alunoId) {
  garantirModalConversa().classList.remove("modal-oculto");
  conversaAberta = alunoId;
  renderizarConversa();
  const campo = document.getElementById("input-conversa");
  if (campo) campo.focus();
}

function fecharConversa() {
  const modal = document.getElementById("modal-conversa");
  if (modal) modal.classList.add("modal-oculto");
  conversaAberta = null;
}

function nomeDoAlunoNaConversa(alunoId) {
  return ((alunosCache || []).find((a) => a.id === alunoId) || {}).nome || "Aluno";
}

function horaDaMensagem(data) {
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return mesmoDia ? hora : `${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hora}`;
}

function renderizarConversa() {
  const corpo = document.getElementById("corpo-conversa");
  if (!corpo || conversaAberta === null) return;
  const form = document.getElementById("form-conversa");
  const voltar = document.getElementById("btn-voltar-conversa");
  const titulo = document.getElementById("titulo-conversa");

  // Lista de alunos (professor)
  if (conversaAberta === "") {
    form.hidden = true;
    voltar.hidden = true;
    titulo.textContent = "Conversas com os alunos";
    const alunos = [...alunosCache].sort((a, b) => {
      const ua = (conversas[a.id] || []).slice(-1)[0], ub = (conversas[b.id] || []).slice(-1)[0];
      return (ub ? dataDaMensagem(ub) : 0) - (ua ? dataDaMensagem(ua) : 0) || a.nome.localeCompare(b.nome, "pt-BR");
    });
    corpo.innerHTML = alunos.length ? `<div class="lista-conversas">${alunos.map((a) => {
      const ultima = (conversas[a.id] || []).slice(-1)[0];
      const novas = naoLidasDaConversa(a.id);
      return `
        <button type="button" class="item-conversa${novas ? " tem-novas" : ""}" data-aluno="${a.id}" onclick="abrirConversa('${a.id}')">
          <span class="nome-conversa">${escapeHtml(a.nome)}</span>
          <span class="previa-conversa">${ultima ? `${ultima.autorId === meuIdNaConversa() ? "Você: " : ""}${escapeHtml(ultima.texto.slice(0, 80))}` : "Nenhuma mensagem ainda"}</span>
          ${novas ? `<span class="contador-conversa-aluno">${novas}</span>` : ""}
        </button>`;
    }).join("")}</div>` : `<p class="vazio">Quando você tiver alunos vinculados, as conversas aparecem aqui.</p>`;
    return;
  }

  // Uma conversa
  form.hidden = false;
  voltar.hidden = !souProfessorNaConversa();
  titulo.textContent = souProfessorNaConversa() ? nomeDoAlunoNaConversa(conversaAberta) : "Conversa com o professor";
  const mensagens = conversas[conversaAberta] || [];
  const eu = meuIdNaConversa();
  const estavaNoFim = corpo.scrollHeight - corpo.scrollTop - corpo.clientHeight < 60;
  corpo.innerHTML = mensagens.length ? mensagens.map((m) => `
    <div class="bolha-conversa ${m.autorId === eu ? "minha" : "dele"}">
      <div class="texto-bolha">${escapeHtml(m.texto)}</div>
      <span class="hora-bolha">${escapeHtml(horaDaMensagem(dataDaMensagem(m)))}</span>
    </div>`).join("") : `<p class="vazio">${souProfessorNaConversa()
      ? "Nenhuma mensagem ainda. Escreva para o aluno: avisos, dúvidas, combinados..."
      : "Nenhuma mensagem ainda. Escreva para o seu professor: dúvidas, avisos, combinados..."}</p>`;
  if (estavaNoFim || corpo.dataset.aberta !== conversaAberta) corpo.scrollTop = corpo.scrollHeight;
  corpo.dataset.aberta = conversaAberta;
  marcarConversaComoLida(conversaAberta);
}

function atualizarConversaNaTela(alunoId) {
  atualizarBotaoConversa();
  if (conversaAberta === "" || (conversaAberta && (!alunoId || conversaAberta === alunoId))) renderizarConversa();
  if (typeof aoMudarConversas === "function") aoMudarConversas();
}

// Grava até quando li (só quando há mensagem nova do outro, para não gravar à toa)
function marcarConversaComoLida(alunoId) {
  const outro = outroDaConversa(alunoId);
  const eu = meuIdNaConversa();
  if (!outro || !eu || !naoLidasDaConversa(alunoId)) return;
  if (document.visibilityState === "hidden") return;
  lidasConversa[outro] = new Date(); // o contador some na hora
  atualizarBotaoConversa();
  db.collection("usuarios").doc(eu).collection("conversasLidas").doc(outro)
    .set({ em: firebase.firestore.FieldValue.serverTimestamp() })
    .catch((e) => console.warn("Não foi possível marcar a conversa como lida:", e));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && conversaAberta) marcarConversaComoLida(conversaAberta);
});

function teclaNaConversa(e) {
  // Enter envia; Shift+Enter quebra a linha (no celular, o botão de enviar)
  if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
    e.preventDefault();
    enviarMensagemConversa();
  }
}

async function enviarMensagemConversa() {
  const campo = document.getElementById("input-conversa");
  const texto = (campo.value || "").trim().slice(0, 2000);
  const alunoId = conversaAberta;
  const eu = meuIdNaConversa();
  if (!texto || !alunoId || !eu) return;
  const professorId = souProfessorNaConversa() ? eu : professorIdDoAluno;
  if (!professorId) return;
  campo.value = "";
  try {
    await db.collection("usuarios").doc(alunoId).collection("conversa").add({
      autorId: eu,
      professorId,
      texto,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    if (!campo.value) campo.value = texto;
    avisar("Não foi possível enviar a mensagem agora. Confira a internet e tente de novo.");
  }
}
