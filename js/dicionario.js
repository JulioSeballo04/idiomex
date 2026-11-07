// ============================================================
// DICIONÁRIO DO ALUNO
// ============================================================

let letraSelecionada = "INICIO";
let cacheDePalavras = [];
let cacheDeAnotacoes = [];
let nomeDoAlunoAtual = "";
let professorIdDoAluno = null;
let anotacaoEmEdicaoId = null;
let notaPalavraEmEdicaoId = null;
let traducoesReveladas = new Set();
let perfilAlunoAtual = {}; // dados do próprio documento usuarios/{uid}
let whatsappDoProfessor = ""; // número que o professor cadastrou na agenda (pra avisos de cancelamento)
let mensagensDoProfessor = null; // {mensagensWhatsapp} — os textos que o professor configurou
let idiomaDoAluno = IDIOMA_PADRAO; // idioma que o aluno está estudando agora (en, es, it, fr, ja, zh)
let idiomasDoProfessorDoAluno = []; // idiomas que o professor vinculado ensina
let idiomasDisponiveis = [IDIOMA_PADRAO]; // idiomas entre os quais o aluno pode alternar
let idiomaJaDefinido = false; // false até o primeiro cálculo (escolhe o último idioma usado)

exigirLogin("aluno");

auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  const perfil = await db.collection("usuarios").doc(user.uid).get();
  perfilAlunoAtual = perfil.data();
  nomeDoAlunoAtual = perfilAlunoAtual.nome;
  professorIdDoAluno = perfilAlunoAtual.professorId;
  await carregarIdiomaDoProfessor();
  carregarWhatsappDoProfessor();
  carregarMensagensDoProfessor(user.uid);
  escutarAnotacoes(user.uid);
  escutarPalavras(user.uid);
  escutarMinhasAulas(user.uid);
  escutarNotificacoes(user.uid);
  escutarSalaDeAula(user.uid);
});

// -------------------- NOTIFICAÇÕES --------------------
// Criadas pelo professor: crédito de reposição recebido, pedido de reposição
// aprovado ou recusado. O sino mostra quantas ainda não foram lidas.

let notificacoesCache = [];

function escutarNotificacoes(uid) {
  db.collection("usuarios").doc(uid).collection("notificacoes")
    .orderBy("criadoEm", "desc").limit(30)
    .onSnapshot((snap) => {
      notificacoesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarNotificacoes();
    }, (e) => console.warn("Não foi possível carregar as notificações:", e));
}

const ICONES_NOTIFICACAO = { "credito-reposicao": "🎟️", "reposicao-aprovada": "✅", "reposicao-recusada": "❌",
  "aula-nao-realizada": "🎟️", "aula-marcada": "📅", "palavra-adicionada": "📖", "documento-aula": "📚" };

// Cada notificação é de um idioma: o sino mostra só as do idioma que o aluno está
// estudando agora. As antigas, de antes de existir o campo, contam como do primeiro
// idioma do professor — a mesma regra do plano antigo (antes ficavam em todos os
// idiomas, e um crédito de inglês aparecia também no espanhol).
function idiomaDaNotificacao(n) {
  return n.idioma ? idiomaValido(n.idioma) : idiomasParaAula()[0];
}

function notificacoesDoIdioma(idioma) {
  return notificacoesCache.filter((n) => idiomaDaNotificacao(n) === idioma);
}

function renderizarNotificacoes() {
  const doIdioma = notificacoesDoIdioma(idiomaDoAluno);
  const naoLidas = doIdioma.filter((n) => !n.lida).length;
  const contador = document.getElementById("contador-notificacoes");
  if (contador) {
    contador.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
    contador.hidden = naoLidas === 0;
  }
  const botao = document.getElementById("btn-notificacoes");
  if (botao) botao.setAttribute("aria-label", naoLidas ? `Notificações (${naoLidas} não lidas)` : "Notificações");
  atualizarSeletorIdioma(); // avisos não lidos dos outros idiomas aparecem no seletor
  const titulo = document.getElementById("titulo-notificacoes");
  if (titulo) titulo.textContent = idiomasDisponiveis.length > 1 ? `Notificações — ${IDIOMAS[idiomaDoAluno].nome}` : "Notificações";
  const lista = document.getElementById("lista-notificacoes");
  if (!lista) return;
  lista.innerHTML = doIdioma.length ? doIdioma.map((n) => `
    <div class="item-notificacao${n.lida ? "" : " nao-lida"}">
      <span class="icone-notificacao">${ICONES_NOTIFICACAO[n.tipo] || "🔔"}</span>
      <div>
        <div>${escapeHtml(n.texto)}</div>
        <span class="data-msg">${n.criadoEm ? escapeHtml(n.criadoEm.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })) : ""}</span>
      </div>
      <button type="button" class="btn-visto" title="Visto — tirar da lista" aria-label="Visto: tirar a notificação da lista" onclick="dispensarNotificacao('${n.id}')">✓</button>
    </div>`).join("") : `<p class="vazio">Nenhuma notificação por enquanto.</p>`;
}

// Abre a lista e marca as não lidas como lidas
async function abrirNotificacoes() {
  renderizarNotificacoes();
  document.getElementById("modal-notificacoes").classList.remove("modal-oculto");
  const user = auth.currentUser;
  const naoLidas = notificacoesDoIdioma(idiomaDoAluno).filter((n) => !n.lida);
  if (!user || !naoLidas.length) return;
  const lote = db.batch();
  naoLidas.forEach((n) => lote.update(db.collection("usuarios").doc(user.uid).collection("notificacoes").doc(n.id), { lida: true }));
  try { await lote.commit(); } catch (e) { console.warn("Não foi possível marcar as notificações como lidas:", e); }
}

// ✓ (visto): a notificação sai da lista
async function dispensarNotificacao(id) {
  const user = auth.currentUser;
  if (!user) return;
  notificacoesCache = notificacoesCache.filter((n) => n.id !== id); // some na hora
  renderizarNotificacoes();
  try {
    await db.collection("usuarios").doc(user.uid).collection("notificacoes").doc(id).delete();
  } catch (e) {
    console.warn("Não foi possível tirar a notificação:", e);
  }
}

function fecharNotificacoes() {
  document.getElementById("modal-notificacoes").classList.add("modal-oculto");
}

// Os idiomas que o aluno pode estudar são os que o professor vinculado ensina (mais
// qualquer idioma em que ele já tenha palavras, pra nada sumir). Se der erro ou o
// professor ainda não escolheu, segue com inglês (o comportamento de sempre).
async function carregarIdiomaDoProfessor() {
  if (professorIdDoAluno) {
    try {
      const snap = await db.collection("usuarios").doc(professorIdDoAluno).get();
      if (snap.exists) idiomasDoProfessorDoAluno = idiomasDoPerfil(snap.data());
    } catch (e) {
      console.warn("Não foi possível carregar os idiomas do professor:", e);
    }
  }
  recalcularIdiomasDisponiveis();
}

// Junta os idiomas do professor com os das palavras que o aluno já tem, e garante que
// o idioma ativo continue valendo (o último escolhido, se ainda existir, senão o primeiro)
function recalcularIdiomasDisponiveis(palavrasCarregadas) {
  const base = idiomasDoProfessorDoAluno.length ? idiomasDoProfessorDoAluno : [IDIOMA_PADRAO];
  const dasPalavras = cacheDePalavras.map(idiomaDaPalavra);
  idiomasDisponiveis = [...new Set([...base, ...dasPalavras])];

  if (!idiomaJaDefinido) {
    // Primeira vez nesta sessão: volta pro último idioma usado, se ele ainda estiver na lista.
    // Só "fecha" essa escolha depois que as palavras chegaram, pra um idioma que só existe
    // nas palavras antigas também poder ser o último usado.
    const preferido = perfilAlunoAtual.idiomaAtivo;
    if (idiomasDisponiveis.includes(preferido)) idiomaDoAluno = preferido;
    else if (!idiomasDisponiveis.includes(idiomaDoAluno)) idiomaDoAluno = idiomasDisponiveis[0];
    if (palavrasCarregadas) idiomaJaDefinido = true;
  } else if (!idiomasDisponiveis.includes(idiomaDoAluno)) {
    idiomaDoAluno = idiomasDisponiveis[0];
  }
  aplicarIdiomaNaTela();
}

function aplicarIdiomaNaTela() {
  const idioma = IDIOMAS[idiomaDoAluno];
  const exemplo = idioma.exemplo.split(" / ")[0];
  document.getElementById("input-palavra-en").placeholder = `Palavra em ${idioma.nome.toLowerCase()} (ex: ${exemplo})`;

  document.getElementById("bandeira-idioma").innerHTML = bandeiraSvg(idiomaDoAluno, 30);
  // Cada idioma tem a própria aparência (padrão: cores da bandeira; o aluno pode personalizar).
  // Só refaz quando o idioma muda, pra não fechar o menu de cores no meio de uma escolha.
  if (idiomaDoTema !== idiomaDoAluno) definirIdiomaDoTema(idiomaDoAluno);

  atualizarSeletorIdioma();
}

// Seletor de idioma; um idioma que não é o atual mostra quantos avisos não lidos tem
function atualizarSeletorIdioma() {
  const seletor = document.getElementById("seletor-idioma");
  if (!seletor) return;
  seletor.innerHTML = idiomasDisponiveis.map((id) => {
    const avisos = id === idiomaDoAluno ? 0 : notificacoesCache.filter((n) => idiomaDaNotificacao(n) === id && !n.lida).length;
    return `<option value="${id}" ${id === idiomaDoAluno ? "selected" : ""}>${IDIOMAS[id].nome}${avisos ? ` (${avisos} aviso${avisos > 1 ? "s" : ""})` : ""}</option>`;
  }).join("");
  seletor.hidden = idiomasDisponiveis.length < 2; // só aparece quando existe mais de um idioma
}

// O aluno troca de idioma: cada idioma tem o próprio vocabulário, índice e quiz
async function trocarIdiomaAtivo(novo) {
  idiomaDoAluno = idiomaValido(novo);
  letraSelecionada = "INICIO";
  aplicarIdiomaNaTela();
  montarIndiceLetras();
  renderizarTela();
  renderizarNotificacoes();
  renderizarMinhasAulas();
  const user = auth.currentUser;
  if (user) {
    try { await db.collection("usuarios").doc(user.uid).update({ idiomaAtivo: idiomaDoAluno }); }
    catch (e) { console.warn("Não foi possível lembrar o idioma escolhido:", e); }
  }
}

// Só as palavras do idioma que o aluno está estudando agora
function palavrasDoIdiomaAtual() {
  return cacheDePalavras.filter((p) => idiomaDaPalavra(p) === idiomaDoAluno);
}

// Escuta em tempo real as anotações pessoais do aluno (um único listener; re-renderiza ao editar)
function escutarAnotacoes(uid) {
  db.collection("usuarios").doc(uid).collection("anotacoes")
    .orderBy("criadoEm", "desc")
    .onSnapshot((snapshot) => {
      cacheDeAnotacoes = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarAnotacoes();
    });
}

function renderizarAnotacoes() {
  const container = document.getElementById("lista-anotacoes");
  redesenharPreservandoCampos(container, () => desenharAnotacoes(container));
}

function desenharAnotacoes(container) {
  container.innerHTML = "";
  cacheDeAnotacoes.forEach((a) => {
    const cartao = document.createElement("div");
    cartao.className = "cartao-anotacao";

    if (anotacaoEmEdicaoId === a.id) {
      cartao.innerHTML = `
        <div class="edicao-anotacao">
          <textarea id="edicao-texto-${a.id}">${escapeHtml(a.texto)}</textarea>
          <button class="btn btn-primario" style="padding:0.4em 1em; font-size:0.85rem;" onclick="salvarEdicaoAnotacao('${a.id}')">Salvar</button>
          <button class="btn btn-secundario" style="padding:0.4em 1em; font-size:0.85rem;" onclick="cancelarEdicaoAnotacao()">Cancelar</button>
        </div>
      `;
    } else {
      cartao.innerHTML = `
        <div class="acoes-anotacao">
          <button onclick="editarAnotacao('${a.id}')">Editar</button>
          <button class="excluir" onclick="excluirAnotacao('${a.id}')">Excluir</button>
        </div>
        ${escapeHtml(a.texto)}
      `;
    }
    container.appendChild(cartao);
  });
}

// Adiciona uma nova anotação
async function adicionarAnotacao(texto) {
  const user = auth.currentUser;
  if (!user || !texto.trim()) return;
  const statusEl = document.getElementById("status-anotacao");
  try {
    await db.collection("usuarios").doc(user.uid).collection("anotacoes").add({
      texto: texto.trim(),
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("input-anotacoes").value = "";
    statusEl.textContent = "";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Não foi possível salvar a anotação. Tente novamente.";
  }
}

function editarAnotacao(id) {
  anotacaoEmEdicaoId = id;
  renderizarAnotacoes();
}

function cancelarEdicaoAnotacao() {
  anotacaoEmEdicaoId = null;
  renderizarAnotacoes();
}

async function salvarEdicaoAnotacao(id) {
  const user = auth.currentUser;
  if (!user) return;
  const novoTexto = document.getElementById(`edicao-texto-${id}`).value.trim();
  if (!novoTexto) return;
  try {
    await db.collection("usuarios").doc(user.uid).collection("anotacoes").doc(id)
      .update({ texto: novoTexto });
    anotacaoEmEdicaoId = null;
    renderizarAnotacoes(); // fecha o editor (a atualização em tempo real chega antes de zerar o id)
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar a anotação. Tente novamente.");
  }
}

async function excluirAnotacao(id) {
  const user = auth.currentUser;
  if (!user) return;
  if (!(await confirmar("Excluir essa anotação?", { botao: "Excluir", perigo: true }))) return;
  try {
    await db.collection("usuarios").doc(user.uid).collection("anotacoes").doc(id).delete();
  } catch (e) {
    console.error(e);
    alert("Não foi possível excluir a anotação. Tente novamente.");
  }
}

// Escuta em tempo real a coleção de palavras do aluno logado
function escutarPalavras(uid) {
  db.collection("usuarios").doc(uid).collection("palavras")
    .orderBy("palavraEn")
    .onSnapshot((snapshot) => {
      cacheDePalavras = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      recalcularIdiomasDisponiveis(true); // palavras de um idioma novo também entram na lista
      montarIndiceLetras();
      renderizarTela();
    });
}

// Monta as abas do menu lateral: "Início" + A-Z, marcando quantas palavras tem cada letra
function montarIndiceLetras() {
  const contagemPorLetra = {};
  palavrasDoIdiomaAtual().forEach((p) => {
    const letra = letraInicial(p.palavraEn);
    contagemPorLetra[letra] = (contagemPorLetra[letra] || 0) + 1;
  });

  const container = document.getElementById("indice-letras-lista");
  container.innerHTML = "";

  const inicio = document.createElement("button");
  inicio.className = "letra-tab" + (letraSelecionada === "INICIO" ? " ativa" : "");
  inicio.textContent = "🏠";
  inicio.title = "Início";
  inicio.onclick = () => { fecharSalaDeAula(); letraSelecionada = "INICIO"; montarIndiceLetras(); renderizarTela(); };
  container.appendChild(inicio);

  // "#" só aparece quando existe palavra que não começa com letra A–Z (ex: japonês, mandarim)
  const letrasDoIndice = contagemPorLetra["#"] ? [...LETRAS_A_Z, "#"] : LETRAS_A_Z;
  letrasDoIndice.forEach((letra) => {
    const qtd = contagemPorLetra[letra] || 0;
    const btn = document.createElement("button");
    let classe = "letra-tab";
    if (letra === letraSelecionada) classe += " ativa";
    if (qtd > 0) classe += " tem-palavras";
    btn.className = classe;
    btn.title = qtd > 0 ? `${qtd} palavra(s)` : "Nenhuma palavra ainda";
    btn.innerHTML = qtd > 0
      ? `${letra}<span class="contagem-letra">${qtd}</span>`
      : letra;
    btn.onclick = () => { fecharSalaDeAula(); letraSelecionada = letra; montarIndiceLetras(); renderizarTela(); };
    container.appendChild(btn);
  });
}

// Decide o que mostrar no topo e no corpo da página, dependendo da tela ativa.
// Na tela Início aparece o painel (próxima aula, progresso, recados, anotações);
// nas telas de cada letra, só o formulário e as fichas daquela letra.
function renderizarTela() {
  const tituloTopo = document.getElementById("titulo-topo");
  const eyebrowTopo = document.getElementById("eyebrow-topo");
  const noInicio = letraSelecionada === "INICIO";
  document.body.classList.toggle("tela-letra", !noInicio);

  if (noInicio) {
    eyebrowTopo.textContent = `${saudacaoDoPeriodo()} · ${IDIOMAS[idiomaDoAluno].nome}`;
    tituloTopo.textContent = nomeDoAlunoAtual || "Olá!";
    renderizarProgresso();
    renderizarPalavrasRecentes();
  } else {
    eyebrowTopo.textContent = `VOCABULÁRIO DE ${IDIOMAS[idiomaDoAluno].nome.toUpperCase()}`;
    tituloTopo.textContent = `Palavras aprendidas com a inicial "${letraSelecionada}"`;
  }
  renderizarPalavras();
}

function saudacaoDoPeriodo() {
  const hora = new Date().getHours();
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function irParaLetra(letra) {
  fecharSalaDeAula();
  letraSelecionada = letra;
  montarIndiceLetras();
  renderizarTela();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Números do cartão "Seu progresso": total de palavras, novas na semana e aulas feitas no mês
function renderizarProgresso() {
  const container = document.getElementById("numeros-progresso");
  if (!container) return;
  const palavras = palavrasDoIdiomaAtual();
  const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const novasNaSemana = palavras.filter((p) => p.criadoEm && p.criadoEm.toMillis() >= seteDiasAtras).length;
  const mesAtual = dataDeHojeISO().slice(0, 7);
  const aulasNoMes = minhasAulasCache.filter((a) => a.status === "concluida" && (a.data || "").startsWith(mesAtual) &&
    (idiomasDisponiveis.length < 2 || aulaDoIdioma(a, idiomaDoAluno))).length;
  const numero = (valor, rotulo, icone) => `
    <div class="numero-progresso">
      <span class="icone-numero" aria-hidden="true">${icone}</span>
      <strong>${valor}</strong>
      <span>${rotulo}</span>
    </div>`;
  container.innerHTML =
    numero(palavras.length, palavras.length === 1 ? "palavra aprendida" : "palavras aprendidas", "📚") +
    numero(novasNaSemana, novasNaSemana === 1 ? "nova nesta semana" : "novas nesta semana", "✨") +
    numero(aulasNoMes, aulasNoMes === 1 ? "aula feita no mês" : "aulas feitas no mês", "🎓");
}

// As últimas palavras adicionadas, como fichinhas: um toque leva pra letra dela
const QTD_PALAVRAS_RECENTES = 8;
function renderizarPalavrasRecentes() {
  const container = document.getElementById("lista-palavras-recentes");
  if (!container) return;
  const recentes = palavrasDoIdiomaAtual()
    .filter((p) => p.criadoEm)
    .sort((a, b) => b.criadoEm.toMillis() - a.criadoEm.toMillis())
    .slice(0, QTD_PALAVRAS_RECENTES);
  if (recentes.length === 0) {
    container.innerHTML = `<p class="vazio-inline">Suas palavras novas aparecem aqui. Que tal adicionar a primeira?</p>`;
    return;
  }
  container.innerHTML = `<div class="chips-palavras">${recentes.map((p) => `
    <button class="chip-palavra" type="button" title="Ver na letra ${escapeHtml(letraInicial(p.palavraEn))}" onclick="irParaLetra('${escapeHtml(letraInicial(p.palavraEn))}')">
      <strong>${escapeHtml(p.palavraEn)}</strong><span>${escapeHtml(p.traducaoPt || "")}</span>
    </button>`).join("")}</div>`;
}

// Ícone de olho do botão "Ver tradução / Ocultar tradução". É sempre o mesmo olho:
// com a tradução à mostra, um risco é desenhado por cima dele (olho riscado = ocultar).
const ICONE_OLHO = `<svg class="icone-olho" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <g class="olho"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g>
  <line class="risco" x1="4" y1="4" x2="20" y2="20" pathLength="1"/>
</svg>`;

function botaoVerTraducao(id, revelada) {
  return `<button class="btn-ver-traducao btn-olho${revelada ? " revelada" : ""}" type="button" aria-pressed="${revelada}" onclick="alternarTraducao('${id}', this)">
    ${ICONE_OLHO}<span class="rotulo-olho">${revelada ? "Ocultar tradução" : "Ver tradução"}</span></button>`;
}

// Mostra/oculta as traduções das frases de uma palavra. Muda só as classes do cartão
// (sem redesenhar a lista), pra a transição do desfoque e do olho acontecer.
function alternarTraducao(id, botao) {
  const revelada = !traducoesReveladas.has(id);
  if (revelada) traducoesReveladas.add(id); else traducoesReveladas.delete(id);

  const cartao = botao && botao.closest(".cartao-palavra");
  if (!cartao) { renderizarPalavras(); return; }
  cartao.classList.toggle("traducoes-ocultas", !revelada);
  cartao.querySelectorAll(".frase-traducao").forEach((t) => t.setAttribute("aria-hidden", String(!revelada)));
  botao.classList.toggle("revelada", revelada);
  botao.setAttribute("aria-pressed", String(revelada));
  botao.querySelector(".rotulo-olho").textContent = revelada ? "Ocultar tradução" : "Ver tradução";
  // reinicia a "piscada" do olho a cada clique
  botao.classList.remove("piscando");
  void botao.offsetWidth;
  botao.classList.add("piscando");
}

// Fala a palavra (no idioma que o aluno estuda) de um cartão específico
function falarPalavra(id) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (p) falar(p.palavraEn, idiomaDaPalavra(p));
}

// Fala uma frase de exemplo específica de uma palavra
function falarFrase(id, indice) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!p || !p.frasesExemplo || !p.frasesExemplo[indice]) return;
  const f = p.frasesExemplo[indice];
  falar(typeof f === "string" ? f : f.en, idiomaDaPalavra(p));
}

function renderizarPalavras() {
  const grade = document.getElementById("grade-cartoes");
  redesenharPreservandoCampos(grade, () => desenharPalavras(grade));
}

// Uma palavra sem frases há mais de 1 minuto ficou sem resposta da IA (ex: a aba
// foi fechada no meio do pedido) — trata igual a uma falha, com opção de tentar de novo
const ESPERA_MAXIMA_FRASES_MS = 60 * 1000;
const frasesSendoGeradas = new Set(); // ids das palavras com pedido em andamento nesta aba

function frasesTravadas(p) {
  if (frasesSendoGeradas.has(p.id)) return false;
  if (p.falhaAoGerarFrases) return true;
  return !!(p.criadoEm && Date.now() - p.criadoEm.toMillis() > ESPERA_MAXIMA_FRASES_MS);
}

function desenharPalavras(grade) {
  grade.innerHTML = "";

  // Na tela Início não mostramos a lista de palavras — só nas telas de cada letra
  if (letraSelecionada === "INICIO") return;

  const lista = palavrasDoIdiomaAtual().filter((p) => letraInicial(p.palavraEn) === letraSelecionada);

  if (lista.length === 0) {
    grade.innerHTML = `<p class="vazio">Nenhuma palavra aqui ainda. Adicione uma acima!</p>`;
    return;
  }

  lista.forEach((p) => {
    const cartao = document.createElement("div");
    const revelada = traducoesReveladas.has(p.id);
    cartao.className = "cartao-palavra" + (revelada ? "" : " traducoes-ocultas");
    let frases;
    if (p.frasesExemplo && p.frasesExemplo.length > 0) {
      const linhas = p.frasesExemplo.map((f, indice) => {
        // Compatibilidade: frases antigas eram só texto (string); as novas são {en, pt}
        const en = typeof f === "string" ? f : f.en;
        const pt = typeof f === "string" ? "" : f.pt;
        // A tradução fica sempre no cartão, desfocada enquanto estiver oculta
        const traducao = pt ? `<br><span class="frase-traducao" aria-hidden="${!revelada}">${escapeHtml(pt)}</span>` : "";
        return `<div class="frase-exemplo">"${escapeHtml(en)}" <button class="btn-falar-frase" type="button" title="Ouvir frase" onclick="falarFrase('${p.id}', ${indice})">🔊</button>${traducao}</div>`;
      }).join("");
      const temTraducao = p.frasesExemplo.some((f) => typeof f !== "string" && f.pt);
      // Palavras antigas guardavam as frases sem tradução: dá pra gerar de novo, já traduzidas
      const botaoRevelar = temTraducao
        ? botaoVerTraducao(p.id, revelada)
        : frasesSendoGeradas.has(p.id)
          ? `<span class="btn-ver-traducao">Gerando frases com tradução...</span>`
          : `<button class="btn-ver-traducao" onclick="tentarGerarFrasesDeNovo('${p.id}')">↻ Gerar frases com tradução</button>`;
      frases = linhas + botaoRevelar;
    } else if (frasesTravadas(p)) {
      frases = `<div class="frase-exemplo">Não foi possível gerar frases de exemplo agora.
        <button class="btn-tentar-frases" type="button" onclick="tentarGerarFrasesDeNovo('${p.id}')">↻ Tentar de novo</button>
        ${p.motivoFalhaFrases ? `<span class="motivo-falha-frases">Detalhe: ${escapeHtml(p.motivoFalhaFrases)}</span>` : ""}</div>`;
    } else {
      frases = `<div class="frase-exemplo">Gerando frases de exemplo...</div>`;
    }

    // Anotação pessoal da palavra: mostra/edita/adiciona (sempre opcional)
    let blocoNota;
    if (notaPalavraEmEdicaoId === p.id) {
      blocoNota = `
        <div class="edicao-nota-palavra">
          <textarea id="edicao-nota-${p.id}" placeholder="Explicação, dica de uso, diferença de outra palavra...">${escapeHtml(p.notaPessoal || "")}</textarea>
          <div class="acoes-edicao-nota">
            <button class="btn btn-primario" onclick="salvarNotaPalavra('${p.id}')">Salvar</button>
            <button class="btn btn-secundario" onclick="cancelarEdicaoNotaPalavra()">Cancelar</button>
          </div>
        </div>
      `;
    } else if (p.notaPessoal) {
      blocoNota = `
        <div class="nota-palavra">
          ${escapeHtml(p.notaPessoal)}
          <div class="acoes-nota-palavra">
            <button onclick="editarNotaPalavra('${p.id}')">Editar</button>
            <button class="excluir" onclick="removerNotaPalavra('${p.id}')">Excluir</button>
          </div>
        </div>
      `;
    } else {
      blocoNota = `<button class="btn-add-nota-palavra" onclick="editarNotaPalavra('${p.id}')">+ Adicionar anotação</button>`;
    }

    cartao.innerHTML = `
      <button class="remover" title="Remover" onclick="removerPalavra('${p.id}')">✕</button>
      <div class="palavra-en">${escapeHtml(p.palavraEn)} <button class="btn-falar" type="button" title="Ouvir pronúncia" onclick="falarPalavra('${p.id}')">🔊</button>
        <button class="btn-editar-palavra" type="button" title="Corrigir a palavra" aria-label="Corrigir a palavra" onclick="editarPalavra('${p.id}')">✎</button></div>
      <div class="palavra-pt">${escapeHtml(p.traducaoPt)} <button class="btn-editar-traducao" type="button" title="Corrigir tradução" aria-label="Corrigir tradução" onclick="editarTraducao('${p.id}')">✎</button></div>
      ${p.adicionadaPor ? `<span class="selo-palavra-professor">Adicionada pelo professor</span>` : ""}
      ${montarAvisoTraducao(p)}
      ${frases}
      ${blocoNota}
    `;
    grade.appendChild(cartao);
  });
}

function editarNotaPalavra(id) {
  notaPalavraEmEdicaoId = id;
  renderizarPalavras();
}

function cancelarEdicaoNotaPalavra() {
  notaPalavraEmEdicaoId = null;
  renderizarPalavras();
}

async function salvarNotaPalavra(id) {
  const user = auth.currentUser;
  if (!user) return;
  const texto = document.getElementById(`edicao-nota-${id}`).value.trim();
  try {
    await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id)
      .update({ notaPessoal: texto ? texto : firebase.firestore.FieldValue.delete() });
    notaPalavraEmEdicaoId = null;
    renderizarPalavras(); // fecha o editor (a atualização em tempo real chega antes de zerar o id)
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar a anotação. Tente novamente.");
  }
}

async function removerNotaPalavra(id) {
  const user = auth.currentUser;
  if (!user) return;
  if (!(await confirmar("Excluir a anotação dessa palavra?", { botao: "Excluir", perigo: true }))) return;
  try {
    await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id)
      .update({ notaPessoal: firebase.firestore.FieldValue.delete() });
  } catch (e) {
    console.error(e);
    alert("Não foi possível excluir a anotação. Tente novamente.");
  }
}

// Adiciona uma nova palavra: salva no Firestore e pede a frase de exemplo à IA
let salvandoPalavra = false; // evita gravar a mesma palavra duas vezes num clique duplo

async function adicionarPalavra(palavraEn, traducaoPt, notaPessoal) {
  const user = auth.currentUser;
  if (!user || !palavraEn.trim() || !traducaoPt.trim() || salvandoPalavra) return;

  const statusEl = document.getElementById("status-palavra");

  // Verifica se essa palavra já foi adicionada antes (ignorando maiúsculas/minúsculas e espaços)
  // (só compara dentro do idioma atual: a mesma grafia pode existir em dois idiomas)
  const jaExiste = palavrasDoIdiomaAtual().some(
    (p) => p.palavraEn.trim().toLowerCase() === palavraEn.trim().toLowerCase()
  );
  if (jaExiste) {
    statusEl.textContent = `"${palavraEn.trim()}" já está no seu vocabulário.`;
    setTimeout(() => (statusEl.textContent = ""), 2500);
    return;
  }

  statusEl.textContent = "Salvando...";
  salvandoPalavra = true;
  const botao = document.getElementById("btn-adicionar-palavra");
  if (botao) botao.disabled = true;

  const dadosPalavra = {
    palavraEn: palavraEn.trim(),
    traducaoPt: traducaoPt.trim(),
    idioma: idiomaDoAluno, // idioma em que a palavra foi cadastrada
    frasesExemplo: [],
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  };
  // Anotação é opcional — só grava o campo se o usuário escreveu algo
  if (notaPessoal && notaPessoal.trim()) {
    dadosPalavra.notaPessoal = notaPessoal.trim();
  }

  let ref;
  try {
    ref = db.collection("usuarios").doc(user.uid).collection("palavras").doc();
    frasesSendoGeradas.add(ref.id);
    await ref.set(dadosPalavra);
  } catch (e) {
    console.error(e);
    frasesSendoGeradas.delete(ref && ref.id);
    statusEl.textContent = "Não foi possível salvar a palavra. Confira sua internet e tente de novo.";
    return;
  } finally {
    salvandoPalavra = false;
    if (botao) botao.disabled = false;
  }

  // Só limpa o formulário depois de salvar — se der erro, o que foi digitado continua lá
  document.getElementById("input-palavra-en").value = "";
  document.getElementById("input-palavra-pt").value = "";
  document.getElementById("input-palavra-nota").value = "";
  statusEl.textContent = "";

  await gerarFrasesDaPalavra(ref.id, dadosPalavra.palavraEn, dadosPalavra.traducaoPt, dadosPalavra.idioma);
}

// Pede as 5 frases de exemplo à function do Vercel e grava na palavra
async function gerarFrasesDaPalavra(id, palavra, traducao, idioma) {
  const user = auth.currentUser;
  if (!user) return;
  const ref = db.collection("usuarios").doc(user.uid).collection("palavras").doc(id);
  frasesSendoGeradas.add(id);
  try {
    const resultado = await pedirFrasesDaIA(palavra, traducao, idioma);
    await ref.update(resultado.falhaAoGerarFrases ? resultado : {
      frasesExemplo: resultado.frasesExemplo,
      traducoesSugeridas: resultado.traducoesSugeridas.length ? resultado.traducoesSugeridas : firebase.firestore.FieldValue.delete(),
      falhaAoGerarFrases: firebase.firestore.FieldValue.delete(),
      motivoFalhaFrases: firebase.firestore.FieldValue.delete()
    });
  } catch (e) {
    console.warn("Não foi possível gravar as frases de exemplo:", e);
  } finally {
    frasesSendoGeradas.delete(id);
    renderizarPalavras();
  }
}

// -------------------- TRADUÇÃO DA PALAVRA --------------------

// Compara traduções sem ligar pra maiúsculas, acentos, artigos e espaços
function normalizarTraducao(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\b(o|a|os|as|um|uma|uns|umas|de|do|da)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

// A tradução do aluno "bate" se for igual a uma das sugeridas pela IA, ou uma contiver a
// outra (ex: "taxa" e "taxas", "maçã" e "a maçã"); sem sugestões, não há o que comparar
function traducaoConfere(p) {
  const sugeridas = (p.traducoesSugeridas || []).map(normalizarTraducao).filter(Boolean);
  if (!sugeridas.length) return true;
  const partesDoAluno = String(p.traducaoPt || "").split(/[,;/]/).map(normalizarTraducao).filter(Boolean);
  return partesDoAluno.some((t) => sugeridas.some((s) => s === t || s.includes(t) || t.includes(s)));
}

function montarAvisoTraducao(p) {
  if (traducaoConfere(p)) return "";
  const sugeridas = p.traducoesSugeridas.slice(0, 3);
  const botoes = sugeridas.map((t, i) =>
    `<button type="button" class="btn-usar-traducao" onclick="usarTraducaoSugerida('${p.id}', ${i})">Usar "${escapeHtml(t)}"</button>`
  ).join("");
  return `<div class="aviso-traducao">💡 Confira a tradução: a IA entende "${escapeHtml(p.palavraEn)}" como
    <strong>${sugeridas.map(escapeHtml).join(", ")}</strong>.<div class="acoes-aviso-traducao">${botoes}</div></div>`;
}

async function salvarTraducao(id, novaTraducao) {
  const user = auth.currentUser;
  const texto = String(novaTraducao || "").trim();
  if (!user || !texto) return;
  try {
    await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id).update({ traducaoPt: texto });
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar a tradução. Tente novamente.");
  }
}

async function editarTraducao(id) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!p) return;
  const nova = await perguntar(`Tradução de "${p.palavraEn}":`, p.traducaoPt || "");
  if (nova !== null && nova.trim() && nova.trim() !== p.traducaoPt) salvarTraducao(id, nova);
}

// Corrige a própria palavra (erro de digitação, maiúscula/minúscula...). Se a palavra
// mudou de verdade (não só maiúsculas), as frases de exemplo são geradas de novo,
// porque as antigas usavam a palavra errada.
async function editarPalavra(id) {
  const user = auth.currentUser;
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!user || !p) return;
  const digitada = await perguntar("Corrigir a palavra:", p.palavraEn);
  const nova = (digitada || "").trim();
  if (!nova || nova === p.palavraEn) return;
  const repetida = palavrasDoIdiomaAtual().some((x) => x.id !== id && x.palavraEn.trim().toLowerCase() === nova.toLowerCase());
  if (repetida) {
    avisar(`"${nova}" já está no seu vocabulário.`);
    return;
  }
  const mudouAPalavra = nova.toLowerCase() !== p.palavraEn.trim().toLowerCase();
  const ref = db.collection("usuarios").doc(user.uid).collection("palavras").doc(id);
  try {
    await ref.update(mudouAPalavra
      ? { palavraEn: nova, frasesExemplo: [], traducoesSugeridas: firebase.firestore.FieldValue.delete(),
          falhaAoGerarFrases: firebase.firestore.FieldValue.delete(), motivoFalhaFrases: firebase.firestore.FieldValue.delete() }
      : { palavraEn: nova });
  } catch (e) {
    console.error(e);
    avisar("Não foi possível corrigir a palavra. Tente novamente.");
    return;
  }
  // A palavra pode ter mudado de letra: vai junto para a letra nova
  const letra = letraInicial(nova);
  if (letraSelecionada !== "INICIO" && letraSelecionada !== letra) {
    letraSelecionada = letra;
    montarIndiceLetras();
    renderizarTela();
  }
  if (mudouAPalavra) {
    frasesSendoGeradas.add(id);
    renderizarPalavras();
    gerarFrasesDaPalavra(id, nova, p.traducaoPt, idiomaDaPalavra(p));
  }
}

function usarTraducaoSugerida(id, indice) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (p && p.traducoesSugeridas && p.traducoesSugeridas[indice]) salvarTraducao(id, p.traducoesSugeridas[indice]);
}

function tentarGerarFrasesDeNovo(id) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!p || frasesSendoGeradas.has(id)) return;
  frasesSendoGeradas.add(id);
  renderizarPalavras(); // mostra "Gerando frases de exemplo..." na hora
  gerarFrasesDaPalavra(id, p.palavraEn, p.traducaoPt, idiomaDaPalavra(p));
}

async function removerPalavra(id) {
  const user = auth.currentUser;
  if (!user) return;
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!(await confirmar(`Remover "${p ? p.palavraEn : "essa palavra"}" do seu vocabulário?`, { botao: "Remover", perigo: true }))) return;
  try {
    await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id).delete();
  } catch (e) {
    console.error(e);
    alert("Não foi possível remover a palavra. Tente novamente.");
  }
}

// -------------------- QUIZ RÁPIDO --------------------
// Reaproveita as frases de exemplo já geradas pela IA (sem custo extra):
// mostra a frase com a palavra escondida e pede pra escolher a certa.

let quizAtual = null;

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function palavrasElegiveisParaQuiz() {
  return palavrasDoIdiomaAtual().filter((p) => p.frasesExemplo && p.frasesExemplo.length > 0);
}

function iniciarQuiz() {
  const elegiveis = palavrasElegiveisParaQuiz();
  if (elegiveis.length < 2) {
    alert("Adicione pelo menos 2 palavras com frases de exemplo geradas para jogar o quiz.");
    return;
  }
  document.getElementById("modal-quiz").classList.remove("modal-oculto");
  gerarPerguntaQuiz(elegiveis);
}

function gerarPerguntaQuiz(elegiveis) {
  const alvo = elegiveis[Math.floor(Math.random() * elegiveis.length)];
  // Só frases em que a palavra inteira aparece (senão a "lacuna" não esconderia nada
  // e a resposta ficaria à mostra na própria frase)
  const regex = regexDaPalavra(alvo.palavraEn);
  const frasesValidas = alvo.frasesExemplo
    .map((f) => (typeof f === "string" ? f : f.en))
    .filter((texto) => texto && regex.test(texto));

  if (frasesValidas.length === 0) {
    // Essa palavra não tem frase utilizável (raro) — tenta outra
    const restantes = elegiveis.filter((p) => p.id !== alvo.id);
    if (restantes.length < 2) { fecharQuiz(); return; }
    gerarPerguntaQuiz(restantes);
    return;
  }

  const fraseTexto = frasesValidas[Math.floor(Math.random() * frasesValidas.length)];
  const fraseComLacuna = fraseTexto.replace(regex, "_____");

  const outrasPalavras = elegiveis.filter((p) => p.id !== alvo.id).map((p) => p.palavraEn);
  const distratores = embaralhar(outrasPalavras).slice(0, Math.min(3, outrasPalavras.length));
  const opcoes = embaralhar([alvo.palavraEn, ...distratores]);

  quizAtual = { respostaCerta: alvo.palavraEn, fraseComLacuna, opcoes };
  renderizarQuiz();
}

// Regex que acha a palavra inteira na frase. Usa fronteira de "letra Unicode" (o \b
// do JS só entende A–Z e quebraria com "café", "où", "niño"); japonês e mandarim
// não separam palavras com espaço, então lá vale qualquer ocorrência.
function regexDaPalavra(palavra) {
  const escapada = palavra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!IDIOMAS[idiomaDoAluno].usaEspacos) return new RegExp(escapada, "i");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapada}(?![\\p{L}\\p{N}])`, "iu");
}

function renderizarQuiz() {
  if (!quizAtual) return;
  const corpo = document.getElementById("corpo-quiz");
  corpo.innerHTML = `
    <p class="quiz-frase">${escapeHtml(quizAtual.fraseComLacuna)}</p>
    <div class="quiz-opcoes" id="quiz-opcoes"></div>
    <p class="quiz-feedback" id="quiz-feedback"></p>
    <button type="button" class="btn btn-secundario" id="btn-proxima-quiz" style="margin-top:0.8rem; display:none;" onclick="proximaPerguntaQuiz()">Próxima pergunta →</button>
  `;
  const container = document.getElementById("quiz-opcoes");
  quizAtual.opcoes.forEach((opcao) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn-opcao-quiz";
    botao.textContent = opcao; // textContent: seguro, sem risco de injeção mesmo com apóstrofos etc.
    botao.onclick = () => responderQuiz(botao, opcao);
    container.appendChild(botao);
  });
}

function responderQuiz(botaoClicado, escolha) {
  const acertou = escolha === quizAtual.respostaCerta;
  document.querySelectorAll(".btn-opcao-quiz").forEach((b) => {
    b.disabled = true;
    if (b.textContent === quizAtual.respostaCerta) b.classList.add("opcao-certa");
  });
  if (!acertou) botaoClicado.classList.add("opcao-errada");

  document.getElementById("quiz-feedback").textContent = acertou
    ? "Boa! Resposta certa. 🎉"
    : `Quase! A resposta certa era "${quizAtual.respostaCerta}".`;
  document.getElementById("btn-proxima-quiz").style.display = "inline-block";
}

function proximaPerguntaQuiz() {
  const elegiveis = palavrasElegiveisParaQuiz();
  if (elegiveis.length < 2) { fecharQuiz(); return; }
  gerarPerguntaQuiz(elegiveis);
}

function fecharQuiz() {
  document.getElementById("modal-quiz").classList.add("modal-oculto");
  quizAtual = null;
}

// Carrega as mensagens/dicas que o professor deixou para este aluno
function carregarMensagensDoProfessor(uid) {
  db.collection("usuarios").doc(uid).collection("mensagens")
    .orderBy("criadoEm", "desc")
    .onSnapshot((snapshot) => {
      const container = document.getElementById("lista-mensagens");
      const painel = document.getElementById("painel-mensagens");
      if (snapshot.empty) {
        painel.classList.add("oculto");
        return;
      }
      painel.classList.remove("oculto");
      container.innerHTML = "";
      snapshot.docs.forEach((doc) => {
        const m = doc.data();
        const data = m.criadoEm ? m.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
        const div = document.createElement("div");
        div.className = "mensagem-item";
        div.innerHTML = `${escapeHtml(m.texto)}<br><span class="data-msg">${escapeHtml(data)}</span>`;
        container.appendChild(div);
      });
    });
}

// -------------------- SALA DE AULA --------------------
// O professor deixa o link da aula online e os documentos usados em aula. Cada
// documento tem um bloco de anotações do aluno, que o professor também vê.

let linkAulaCache = null; // {url, professorId} ou null
let documentosAulaCache = [];
let notasDocumentoAbertas = new Set(); // ids dos documentos com o bloco de anotações aberto
const statusNotasDocumento = {}; // {id: "Anotações salvas."} — sobrevive aos re-renders em tempo real
let buscaDocumentos = "";
let paginaDocumentos = 1;
let filtroTipoDocumentos = "";
// Documentos de aula do professor que este aluno pode ver (para todos ou para ele)
const bibliotecaPorConsulta = { todos: [], meus: [] };

function escutarSalaDeAula(uid) {
  const ref = db.collection("usuarios").doc(uid);
  ref.collection("salaDeAula").doc("link").onSnapshot((snap) => {
    linkAulaCache = snap.exists ? snap.data() : null;
    renderizarSalaDeAula();
    renderizarMinhasAulas(); // o botão "Entrar na aula" da próxima aula usa esse link
  });
  ref.collection("documentosAula").orderBy("criadoEm", "desc").onSnapshot((snap) => {
    documentosAulaCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarSalaDeAula();
  });
  if (!professorIdDoAluno) return;
  // Duas consultas (o Firestore não junta "para todos" OU "para mim" numa só)
  const biblioteca = db.collection("usuarios").doc(professorIdDoAluno).collection("biblioteca");
  const escutar = (chave, consulta) => consulta.onSnapshot((snap) => {
    bibliotecaPorConsulta[chave] = snap.docs.map((d) => ({ id: d.id, ...d.data(), origem: "biblioteca" }));
    renderizarSalaDeAula();
  }, (e) => console.warn("Não foi possível carregar os Documentos de aula:", e));
  escutar("todos", biblioteca.where("paraTodos", "==", true));
  escutar("meus", biblioteca.where("alunos", "array-contains", uid));
}

function documentosDaBiblioteca() {
  const porId = new Map();
  [...bibliotecaPorConsulta.todos, ...bibliotecaPorConsulta.meus].forEach((d) => porId.set(d.id, d));
  return [...porId.values()];
}

// Só o que foi deixado pelo professor atual (o aluno pode ter trocado de professor),
// junto com os Documentos de aula que ele compartilhou, do mais novo para o mais antigo
function documentosDaSala() {
  const momento = (d) => (d.criadoEm ? d.criadoEm.toMillis() : Date.now());
  return documentosAulaCache.filter((d) => d.professorId === professorIdDoAluno)
    .concat(documentosDaBiblioteca())
    .sort((a, b) => momento(b) - momento(a));
}

function filtrarDocumentosPorTipo(tipo) {
  filtroTipoDocumentos = tipo;
  paginaDocumentos = 1;
  renderizarSalaDeAula();
}

// A Sala de aula é uma tela própria (não uma janela por cima): esconde o painel do
// Início e mostra o link da aula e os documentos. O "voltar" do celular/navegador
// também fecha a tela, porque ela entra no histórico.
function salaDeAulaAberta() {
  return document.body.classList.contains("tela-sala");
}

function abrirSalaDeAula() {
  document.getElementById("eyebrow-sala").textContent = `Sua sala · ${IDIOMAS[idiomaDoAluno].nome}`;
  if (!salaDeAulaAberta() && !(history.state && history.state.tela === "sala")) {
    try { history.pushState({ tela: "sala" }, "", "#sala-de-aula"); } catch (e) {}
  }
  document.body.classList.add("tela-sala");
  document.getElementById("tela-sala-aula").hidden = false;
  renderizarSalaDeAula();
  window.scrollTo(0, 0);
}

function esconderSalaDeAula() {
  document.body.classList.remove("tela-sala");
  document.getElementById("tela-sala-aula").hidden = true;
}

function fecharSalaDeAula() {
  if (!salaDeAulaAberta()) return;
  esconderSalaDeAula();
  if (history.state && history.state.tela === "sala") history.back();
  else if (location.hash === "#sala-de-aula") history.replaceState(null, "", location.pathname + location.search);
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", () => {
  if (history.state && history.state.tela === "sala") abrirSalaDeAula(); // "avançar" do navegador
  else if (salaDeAulaAberta()) esconderSalaDeAula();
});
// Recarregou a página com a sala aberta: continua nela
if (location.hash === "#sala-de-aula") document.addEventListener("DOMContentLoaded", abrirSalaDeAula);

function renderizarSalaDeAula() {
  const corpo = document.getElementById("corpo-sala-aula");
  if (!corpo) return;
  redesenharPreservandoCampos(corpo, () => desenharSalaDeAula(corpo));
}

function desenharSalaDeAula(corpo) {
  const link = linkAulaCache && linkAulaCache.professorId === professorIdDoAluno ? linkAulaCache.url : "";
  const blocoLink = link
    ? `<a class="btn btn-primario btn-entrar-aula" href="${escapeHtml(link)}" target="_blank" rel="noopener">Entrar na aula</a>`
    : `<p class="vazio">Seu professor ainda não deixou o link da aula.</p>`;
  const proxima = aulasFuturasDoAluno()[0];
  const linhaProxima = proxima
    ? `<p class="proxima-na-sala"><span>Próxima aula</span><strong>${escapeHtml(rotuloDiaDaAula(proxima.data))} · ${escapeHtml(faixaHorario(proxima.horaInicio, proxima.horaFim))}</strong><em>${escapeHtml(contagemParaAula(proxima))}</em></p>`
    : `<p class="proxima-na-sala"><span>Próxima aula</span><strong>Nenhuma aula marcada</strong><button type="button" class="link-trocar" onclick="abrirAgendamento()">Marcar uma aula</button></p>`;

  const todos = documentosDaSala();
  const doTipo = filtroTipoDocumentos ? todos.filter((d) => categoriaDoDocumento(d) === filtroTipoDocumentos) : todos;
  const filtroTipos = todos.length > 1 ? montarFiltroDeTipos(todos, filtroTipoDocumentos, "filtrarDocumentosPorTipo('%s')") : "";
  const lista = filtroTipos + montarListaDocumentosAula(doTipo, {
    busca: buscaDocumentos, pagina: paginaDocumentos, idBusca: "busca-documentos-aluno",
    aoBuscar: "buscarDocumentos(this.value)", aoMudarPagina: "irParaPaginaDocumentos(%n)",
    vazio: "Nenhum documento ainda. Os materiais que o professor usar em aula aparecem aqui.",
    item: (d) => {
        const icone = CATEGORIAS_ARQUIVO[categoriaDoDocumento(d)].icone;
        if (d.origem === "biblioteca") return `
          <div class="documento-aula">
            <button class="titulo-documento link-arquivo" onclick="abrirDocumentoDaBiblioteca('${d.id}')">${icone} ${escapeHtml(d.titulo)}</button>
            <span class="data-msg">${CATEGORIAS_ARQUIVO[categoriaDoDocumento(d)].nome} · ${formatarTamanhoArquivo(d.tamanho)}</span>
          </div>`;
        const aberto = notasDocumentoAbertas.has(d.id);
        const nota = aberto ? `
          <div class="bloco-notas-documento">
            <textarea id="nota-documento-${d.id}" placeholder="Suas anotações sobre este documento — o professor também vê.">${escapeHtml(d.anotacao || "")}</textarea>
            <div class="acoes-edicao-nota">
              <button class="btn btn-primario" onclick="salvarNotaDocumento('${d.id}')">Salvar anotações</button>
            </div>
            <p class="status-msg" id="status-nota-documento-${d.id}">${escapeHtml(statusNotasDocumento[d.id] || "")}</p>
          </div>` : "";
        return `
          <div class="documento-aula">
            ${d.url
              ? `<a class="titulo-documento" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${icone} ${escapeHtml(d.titulo)}</a>`
              : `<button class="titulo-documento link-arquivo" onclick="abrirArquivoDocumento('${d.id}')">${icone} ${escapeHtml(d.titulo)}</button>
                 <span class="data-msg">${escapeHtml(d.nomeArquivo)} · ${formatarTamanhoArquivo(d.tamanho)}</span>`}
            <button class="btn-notas-documento ${d.anotacao ? "tem-nota" : ""}" onclick="alternarNotasDocumento('${d.id}')">
              ${aberto ? "Fechar anotações" : d.anotacao ? "Ver anotações" : "Fazer anotações"}
            </button>
            ${nota}
          </div>`;
      }
  });

  corpo.innerHTML = `
    <div class="grade-sala">
      <section class="sala-secao cartao-secao secao-aula-online">
        <h2 class="titulo-secao">Aula online</h2>
        ${linhaProxima}
        ${blocoLink}
      </section>
      <section class="sala-secao cartao-secao secao-documentos-sala">
        <h2 class="titulo-secao">Documentos de aula</h2>
        ${lista}
      </section>
    </div>`;
}

function buscarDocumentos(texto) {
  buscaDocumentos = texto;
  paginaDocumentos = 1;
  renderizarSalaDeAula();
}

function irParaPaginaDocumentos(n) {
  paginaDocumentos = n;
  renderizarSalaDeAula();
}

// Arquivos que abrem dentro do app vão para o visualizador (sem botão de baixar);
// os outros (ex: Word, enviados antes) continuam abrindo como antes
function abrirArquivoDocumento(id) {
  const documento = documentosAulaCache.find((d) => d.id === id);
  const user = auth.currentUser;
  if (!documento || !user) return;
  if (arquivoVisualizavel(documento.tipoArquivo, documento.nomeArquivo)) {
    abrirVisualizador(db.collection("usuarios").doc(user.uid).collection("documentosAula").doc(id), documento, false);
  } else {
    abrirArquivoDaAula(user.uid, documento);
  }
}

function abrirDocumentoDaBiblioteca(id) {
  const documento = documentosDaBiblioteca().find((d) => d.id === id);
  if (documento) abrirVisualizador(db.collection("usuarios").doc(professorIdDoAluno).collection("biblioteca").doc(id), documento, false);
}

function alternarNotasDocumento(id) {
  if (notasDocumentoAbertas.has(id)) notasDocumentoAbertas.delete(id); else notasDocumentoAbertas.add(id);
  delete statusNotasDocumento[id];
  renderizarSalaDeAula();
}

async function salvarNotaDocumento(id) {
  const user = auth.currentUser;
  const campo = document.getElementById(`nota-documento-${id}`);
  if (!user || !campo) return;
  const texto = campo.value.trim().slice(0, 5000);
  const avisar = (msg) => { statusNotasDocumento[id] = msg; renderizarSalaDeAula(); };
  try {
    await db.collection("usuarios").doc(user.uid).collection("documentosAula").doc(id).update(texto
      ? { anotacao: texto, anotacaoEm: firebase.firestore.FieldValue.serverTimestamp() }
      : { anotacao: firebase.firestore.FieldValue.delete(), anotacaoEm: firebase.firestore.FieldValue.delete() });
    avisar("Anotações salvas.");
  } catch (e) {
    console.error(e);
    avisar("Não foi possível salvar. Tente novamente — o texto continua no campo.");
  }
}

// -------------------- AGENDAMENTO DE AULAS --------------------

let configAgendaProfessor = null;
let minhasAulasCache = [];
let mesCalendarioAgendamento = null; // Date do 1º dia do mês exibido no calendário
let overridesAgendaProfessor = {}; // {"AAAA-MM-DD": {fechado, blocos}} — exceções pontuais do professor

function escutarMinhasAulas(uid) {
  db.collection("aulas").where("alunoId", "==", uid)
    .onSnapshot((snap) => {
      minhasAulasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarMinhasAulas();
    });
}

// "Hoje", "Amanhã" ou "Sáb, 08/11"
function rotuloDiaDaAula(dataIso) {
  const hoje = dataDeHojeISO();
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const amanhaIso = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, "0")}-${String(amanha.getDate()).padStart(2, "0")}`;
  if (dataIso === hoje) return "Hoje";
  if (dataIso === amanhaIso) return "Amanhã";
  return `${NOMES_DIAS_CURTOS[new Date(`${dataIso}T12:00:00`).getDay()]}, ${formatarDataBR(dataIso).slice(0, 5)}`;
}

// Quanto falta pra aula: "acontecendo agora", "começa em 25 min", "em 3 dias"...
function contagemParaAula(a) {
  const inicio = new Date(`${a.data}T${a.horaInicio}:00`).getTime();
  const minutos = Math.round((inicio - Date.now()) / 60000);
  if (minutos <= 0) return "Acontecendo agora";
  if (minutos < 60) return `Começa em ${minutos} min`;
  if (minutos < 24 * 60) {
    const h = Math.floor(minutos / 60), m = minutos % 60;
    return `Começa em ${h}h${m ? ` ${m}min` : ""}`;
  }
  const dias = Math.round((new Date(`${a.data}T12:00:00`) - new Date(`${dataDeHojeISO()}T12:00:00`)) / 86400000);
  return dias === 1 ? "Amanhã" : `Em ${dias} dias`;
}

function badgesDaAula(a) {
  return `
    <span class="badge-modalidade badge-${a.modalidade}">${a.modalidade === "online" ? "Online" : "Presencial"}</span>
    ${a.reposicao ? '<span class="badge-status badge-reposicao">Reposição</span>' : ""}
    ${a.status === "pendente" ? '<span class="badge-status badge-status-pendente">Aguardando aprovação</span>' : ""}
    ${aulaDoAlunoEmAndamento(a) ? '<span class="badge-status badge-status-em-andamento">Em andamento</span>' : ""}
    ${idiomasParaAula().length > 1 ? `<span class="badge-idioma" style="background:${IDIOMAS[idiomaValido(a.idioma)].cor}">${IDIOMAS[idiomaValido(a.idioma)].nome}</span>` : ""}`;
}

// Aula agendada de hoje que já começou (e ainda não terminou: as que terminaram saem da lista)
function aulaDoAlunoEmAndamento(a) {
  const agora = new Date();
  return a.status === "agendada" && a.data === dataDeHojeISO() &&
    minutosDoHorario(a.horaInicio) <= agora.getHours() * 60 + agora.getMinutes();
}

function rotuloCancelarAula(a) {
  return a.status === "pendente" ? "Cancelar pedido" : "Cancelar";
}

// Aulas que ainda vão acontecer (agendadas ou pedidos), da mais próxima para a mais distante.
// Aula de hoje que já terminou não entra; com mais de um idioma, só as do idioma atual.
function aulasFuturasDoAluno() {
  const hojeIso = dataDeHojeISO();
  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const aindaVai = (a) => a.data > hojeIso ||
    (a.data === hojeIso && minutosDoHorario(a.horaFim || a.horaInicio) > minutosAgora);
  const doIdioma = (a) => idiomasDisponiveis.length < 2 || aulaDoIdioma(a, idiomaDoAluno);
  return minhasAulasCache
    .filter((a) => (a.status === "agendada" || a.status === "pendente") && aindaVai(a) && doIdioma(a))
    .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));
}

// Próxima aula em destaque (como nos apps de aula particular), com o link pra entrar
// quando é online, e as seguintes numa lista menor logo abaixo
function renderizarMinhasAulas() {
  const painel = document.getElementById("painel-minhas-aulas");
  const lista = document.getElementById("lista-minhas-aulas");
  if (!painel || !lista) return;

  const futuras = aulasFuturasDoAluno();
  if (salaDeAulaAberta()) renderizarSalaDeAula(); // a sala mostra quando é a próxima aula

  painel.classList.remove("oculto");
  const deQualIdioma = idiomasDisponiveis.length > 1 ? ` de ${IDIOMAS[idiomaDoAluno].nome}` : "";

  if (futuras.length === 0) {
    lista.innerHTML = `
      <div class="destaque-aula destaque-vazio">
        <div class="rotulo-destaque">Próxima aula${deQualIdioma}</div>
        <p class="titulo-destaque">Nenhuma aula marcada</p>
        <p class="texto-destaque">Escolha um dia e um horário livre na agenda do seu professor.</p>
        <button class="btn btn-destaque" onclick="abrirAgendamento()">Marcar uma aula</button>
      </div>`;
    renderizarProgresso();
    return;
  }

  const [proxima, ...seguintes] = futuras;
  const link = linkAulaCache && linkAulaCache.professorId === professorIdDoAluno ? linkAulaCache.url : "";
  const podeEntrar = link && proxima.modalidade === "online" && proxima.status === "agendada";
  lista.innerHTML = `
    <div class="cartao-aula destaque-aula">
      <div class="topo-destaque">
        <span class="rotulo-destaque">Próxima aula${deQualIdioma}</span>
        <span class="contagem-aula">${contagemParaAula(proxima)}</span>
      </div>
      <div class="quando-destaque">
        <span class="dia-destaque">${escapeHtml(rotuloDiaDaAula(proxima.data))}</span>
        <span class="hora-destaque">${escapeHtml(faixaHorario(proxima.horaInicio, proxima.horaFim))}</span>
      </div>
      <div class="aula-info">${badgesDaAula(proxima)}</div>
      <div class="acoes-destaque">
        ${podeEntrar ? `<a class="btn btn-destaque" href="${escapeHtml(link)}" target="_blank" rel="noopener">Entrar na aula</a>` : ""}
        <button class="btn-cancelar-destaque" onclick="cancelarMinhaAula('${proxima.id}')">${rotuloCancelarAula(proxima)}</button>
      </div>
    </div>
    ${seguintes.length ? `
      <div class="seguintes-aulas">
        <h3>Depois</h3>
        ${seguintes.map((a) => `
          <div class="cartao-aula">
            <div class="aula-info">
              <span>${escapeHtml(rotuloDiaDaAula(a.data))} · ${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
              ${badgesDaAula(a)}
            </div>
            <button class="excluir" onclick="cancelarMinhaAula('${a.id}')">${rotuloCancelarAula(a)}</button>
          </div>`).join("")}
      </div>` : ""}`;
  renderizarProgresso();
}

// A contagem ("começa em 25 min") e a aula que já terminou saem sozinhas, sem recarregar
setInterval(() => { if (minhasAulasCache.length) renderizarMinhasAulas(); }, 60 * 1000);

// Acompanha em tempo real o WhatsApp do professor e as mensagens que ele
// configurou, pra o cancelamento já ter o link na hora do clique. Antes era lido
// uma vez só, ao entrar: um número cadastrado depois só valia recarregando a página.
function carregarWhatsappDoProfessor() {
  if (!professorIdDoAluno) return;
  db.collection("usuarios").doc(professorIdDoAluno).collection("configuracaoAgenda").doc("dados")
    .onSnapshot((snap) => {
      const dados = snap.exists ? snap.data() : {};
      whatsappDoProfessor = dados.whatsapp || "";
      mensagensDoProfessor = { mensagensWhatsapp: dados.mensagensWhatsapp || null };
    }, (e) => console.warn("Não foi possível carregar o WhatsApp do professor:", e));
}

// Avisa o professor no sino do painel dele (aula marcada, pedido de reposição,
// cancelamento). Um aviso que falhar não atrapalha o que o aluno acabou de fazer.
function avisarProfessor(tipo, texto, idioma) {
  const user = auth.currentUser;
  if (!user || !professorIdDoAluno) return;
  db.collection("usuarios").doc(professorIdDoAluno).collection("notificacoes").add({
    tipo, texto: texto.slice(0, 300), idioma: idiomaValido(idioma), alunoId: user.uid, lida: false,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((e) => console.warn("Não foi possível avisar o professor:", e));
}

function descricaoAulaParaProfessor(dataIso, hora, idioma) {
  return `${formatarDataBR(dataIso)} às ${hora}${idiomasParaAula().length > 1 ? ` (${IDIOMAS[idiomaValido(idioma)].nome})` : ""}`;
}

function mensagemCancelamentoPeloAluno(aula) {
  return preencherMensagemWhatsapp(modeloMensagemWhatsapp(mensagensDoProfessor, "cancelamento"), dadosDaMensagemWhatsapp({
    aluno: nomeDoAlunoAtual, data: aula.data, hora: aula.horaInicio, modalidade: aula.modalidade,
    idioma: aula.idioma, mostrarIdioma: idiomasParaAula().length > 1, reposicao: aula.reposicao
  }));
}

// Confirma na janela do app (o clique em "Cancelar aula" já abre o WhatsApp com o
// aviso para o professor) e avisa o professor no sino dele
function cancelarMinhaAula(aulaId) {
  const aula = minhasAulasCache.find((a) => a.id === aulaId);
  if (!aula) return;
  const oQue = aula.status === "pendente" ? "o pedido de reposição" : aula.reposicao ? "a reposição" : "a aula";
  confirmarComWhatsapp({
    titulo: aula.status === "pendente" ? "Cancelar pedido" : "Cancelar aula",
    texto: `Cancelar ${oQue} de ${descricaoAulaParaProfessor(aula.data, aula.horaInicio, aula.idioma)}?`,
    botao: aula.status === "pendente" ? "Cancelar pedido" : "Cancelar aula",
    link: whatsappDoProfessor ? linkWhatsapp(whatsappDoProfessor, mensagemCancelamentoPeloAluno(aula)) : null,
    feito: "Cancelado. Mande a mensagem no WhatsApp para o professor saber.",
    semLink: "Seu professor foi avisado no app (ele ainda não cadastrou um WhatsApp).",
    acao: async () => {
      await db.collection("aulas").doc(aulaId).update({ status: "cancelada", canceladoPor: "aluno" });
      avisarProfessor("aluno-cancelou-aula",
        `${nomeDoAlunoAtual} cancelou ${oQue} de ${descricaoAulaParaProfessor(aula.data, aula.horaInicio, aula.idioma)}.`, aula.idioma);
    }
  });
}

// -------------------- PERFIL DO ALUNO --------------------

function abrirPerfil() {
  document.getElementById("perfil-nome").value = perfilAlunoAtual.nome || "";
  document.getElementById("perfil-email").value = perfilAlunoAtual.emailContato || perfilAlunoAtual.email || "";
  document.getElementById("perfil-telefone").value = perfilAlunoAtual.telefone || "";
  document.getElementById("status-perfil").textContent = "";
  document.getElementById("dica-vinculo").textContent = professorIdDoAluno
    ? "Mudou de professor? Digite o código dele para vincular sua conta. Seu vocabulário continua com você."
    : "Sua conta não está vinculada a nenhum professor. Digite o código do seu professor para se vincular.";
  document.getElementById("perfil-codigo").value = "";
  document.getElementById("status-vinculo").textContent = "";
  document.getElementById("modal-perfil").classList.remove("modal-oculto");
}

function fecharPerfil() {
  document.getElementById("modal-perfil").classList.add("modal-oculto");
}

async function salvarPerfil() {
  const user = auth.currentUser;
  if (!user) return;
  const statusEl = document.getElementById("status-perfil");
  const nome = document.getElementById("perfil-nome").value.trim().replace(/\s+/g, " ");
  const emailContato = document.getElementById("perfil-email").value.trim();
  const telefone = document.getElementById("perfil-telefone").value.trim();

  if (!nome) {
    statusEl.textContent = "Digite seu nome.";
    return;
  }
  if (nome.length > 100) {
    statusEl.textContent = "Nome muito longo (máximo de 100 caracteres).";
    return;
  }

  const digitos = apenasDigitos(telefone);
  if (telefone && (digitos.length < 10 || digitos.length > 13)) {
    statusEl.textContent = "Telefone inválido — use DDD + número (ex: 11 91234-5678).";
    return;
  }

  statusEl.textContent = "Salvando...";
  try {
    await db.collection("usuarios").doc(user.uid).update({ nome, emailContato, telefone });
    perfilAlunoAtual = { ...perfilAlunoAtual, nome, emailContato, telefone };
    nomeDoAlunoAtual = nome;
    if (letraSelecionada === "INICIO") document.getElementById("titulo-topo").textContent = nome;
    statusEl.textContent = "Perfil salvo!";
    setTimeout(fecharPerfil, 700);
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
}

// Vincula o aluno a outro professor (ou de novo, depois de ter sido removido da turma)
async function trocarDeProfessor() {
  const user = auth.currentUser;
  if (!user) return;
  const statusEl = document.getElementById("status-vinculo");
  const codigo = normalizarCodigo(document.getElementById("perfil-codigo").value);
  if (!codigo) {
    statusEl.textContent = "Digite o código do professor.";
    return;
  }

  statusEl.textContent = "Verificando código...";
  try {
    const professorId = await professorDoCodigo(codigo);
    if (!professorId) {
      statusEl.textContent = "Código de professor inválido. Confira com seu professor.";
      return;
    }
    if (professorId === professorIdDoAluno) {
      statusEl.textContent = "Você já está vinculado a esse professor.";
      return;
    }
    await db.collection("usuarios").doc(user.uid).update({ professorId, codigoVinculo: codigo });
    statusEl.textContent = "Pronto! Carregando seu novo professor...";
    setTimeout(() => window.location.reload(), 800);
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Não foi possível vincular agora. Tente novamente.";
  }
}

// -------------------- AGENDAR AULA (passo a passo) --------------------
// Igual ao agendamento da barbearia: 1) dia, 2) horário, 3) detalhes e confirmar.
// Escolher o horário só seleciona; a aula só é marcada no "Confirmar agendamento".
// Cada passo já escolhido recolhe pra uma linha de resumo com "trocar".

// Trava de UX contra um aluno lotar a agenda sozinho (clique repetido, bug...)
const MAX_AULAS_FUTURAS_POR_ALUNO = 3;

const NOMES_DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Estado do agendamento em andamento (zerado a cada abertura do modal)
let agendamento = null;

function novoAgendamento() {
  const idiomas = idiomasParaAula();
  return {
    // Com um idioma só, já vem escolhido; com mais de um, o aluno escolhe no passo 1
    idioma: idiomas.length === 1 ? idiomas[0] : null,
    data: null,            // "AAAA-MM-DD"
    hora: null,            // "HH:MM"
    horarios: null,        // horários livres da data escolhida (null = carregando)
    erroHorarios: false,
    modalidade: null,
    reposicao: false,
    confirmada: null,      // dados da aula depois de confirmada (tela de sucesso)
    salvando: false,
    erro: ""
  };
}

// "2026-10-23" -> "Qui, 23/10"
function rotuloDiaCurto(dataIso) {
  return `${NOMES_DIAS_CURTOS[new Date(`${dataIso}T12:00:00`).getDay()]}, ${formatarDataBR(dataIso).slice(0, 5)}`;
}

function chaveMes(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

// O mês atual está sempre liberado; os seguintes, só quando o professor libera
function mesLiberado(data) {
  const mes = chaveMes(data);
  return mes === chaveMes(new Date()) || (configAgendaProfessor.mesesLiberados || []).includes(mes);
}

// Próximas aulas do aluno (num idioma, se informado — o limite de aulas marcadas vale por idioma)
function aulasFuturasDoAluno(idioma) {
  const hojeIso = dataDeHojeISO();
  return minhasAulasCache.filter((a) => (a.status === "agendada" || a.status === "pendente") && a.data >= hojeIso &&
    (!idioma || aulaDoIdioma(a, idioma)));
}

// Abre o modal de agendamento, carregando a configuração de agenda do professor vinculado
async function abrirAgendamento() {
  // Clicou antes de o app terminar de carregar o perfil: não é "sem professor"
  if (!perfilAlunoAtual || !perfilAlunoAtual.tipo) {
    alert("Carregando seus dados... tente de novo em instantes.");
    return;
  }
  if (!professorIdDoAluno) {
    alert("Sua conta não está vinculada a um professor. Vincule-se em \"Meu perfil\" para agendar aulas.");
    return;
  }

  let snap;
  try {
    snap = await db.collection("usuarios").doc(professorIdDoAluno)
      .collection("configuracaoAgenda").doc("dados").get();
  } catch (e) {
    console.error(e);
    alert("Não foi possível carregar a agenda do professor. Confira sua internet e tente de novo.");
    return;
  }

  if (!snap.exists) {
    alert("Seu professor ainda não configurou horários disponíveis para agendamento.");
    return;
  }

  configAgendaProfessor = snap.data();

  // Plano (aulas por semana e reposições) sempre fresco: o professor pode ter
  // mudado com a página aberta
  try {
    const meuPerfil = await db.collection("usuarios").doc(auth.currentUser.uid).get();
    if (meuPerfil.exists) perfilAlunoAtual = meuPerfil.data();
  } catch (e) {
    console.warn("Não foi possível atualizar o plano de aulas:", e);
  }

  // Não deixa a falta de permissão nessa coleção (ex: regras do Firestore
  // ainda não republicadas) travar o agendamento inteiro — nesse caso só
  // segue sem exceções pontuais, valendo a grade semanal recorrente.
  overridesAgendaProfessor = {};
  try {
    const overridesSnap = await db.collection("usuarios").doc(professorIdDoAluno)
      .collection("agendaOverrides").get();
    overridesSnap.docs.forEach((d) => { overridesAgendaProfessor[d.id] = d.data(); });
  } catch (e) {
    console.warn("Não foi possível carregar exceções de disponibilidade:", e);
  }

  const hoje = new Date();
  mesCalendarioAgendamento = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  agendamento = novoAgendamento();
  renderizarAgendamento();
  document.getElementById("modal-agendamento").classList.remove("modal-oculto");
}

function fecharAgendamento() {
  document.getElementById("modal-agendamento").classList.add("modal-oculto");
}

// Blocos de horário efetivos de um dia: a exceção pontual do professor pra
// aquele dia, se houver, senão a grade semanal recorrente do dia da semana.
// Configuração das aulas do idioma escolhido no agendamento (cada idioma pode ter a
// própria duração, dias e horários; sem isso, vale a configuração padrão do professor)
function configDoAgendamento() {
  return configDoIdioma(configAgendaProfessor, idiomaDoAgendamento());
}

function blocosDoDia(dataIso) {
  const override = overridesAgendaProfessor[dataIso];
  if (override) return override.fechado ? [] : (override.blocos || []);
  return (configDoAgendamento().disponibilidade || {})[chaveDiaSemana(dataIso)] || [];
}

// Modalidades oferecidas num dia: a exceção pontual do professor (se ele
// especificou online/presencial só pra esse dia), senão a configuração geral.
function modalidadesDoDia(dataIso) {
  return modalidadesDaData(configDoAgendamento(), overridesAgendaProfessor, dataIso);
}

// Um dia tem disponibilidade se sobrar algum bloco de horário depois de
// aplicar a exceção pontual (se houver) sobre a grade semanal
function diaTemDisponibilidade(dataIso) {
  return blocosDoDia(dataIso).length > 0;
}

// Idiomas em que o professor dá aula. A aula é de UM deles; com mais de um, o aluno escolhe.
function idiomasParaAula() {
  return idiomasDoProfessorDoAluno.length ? idiomasDoProfessorDoAluno : [IDIOMA_PADRAO];
}

// Plano do aluno com o professor atual e o que ele permite na semana da data escolhida
// Plano e créditos são por idioma: os do idioma da aula que está sendo marcada
function idiomaDoAgendamento() {
  return idiomaValido((agendamento && agendamento.idioma) || idiomasParaAula()[0]);
}

// Duração (minutos) das aulas no idioma do agendamento
function duracaoDoAgendamento() {
  return (configAgendaProfessor && configDoAgendamento().duracaoAulaMinutos) || 50;
}

// A reposição fica confirmada sozinha com pelo menos 1 crédito (60 min) e com
// minutos para cobrir a aula inteira; senão, vira pedido para o professor
function reposicaoCabeNoSaldo(plano) {
  return creditosDeReposicao(plano.saldo) >= 1 && plano.saldo >= plano.duracao;
}

function situacaoDoPlano(dataIso) {
  const idioma = idiomaDoAgendamento();
  const plano = planoDoAluno(perfilAlunoAtual, professorIdDoAluno, idioma, idiomasParaAula()[0]);
  const saldo = saldoReposicoes(plano, minhasAulasCache, professorIdDoAluno, idioma);
  const limite = plano.aulasPorSemana;
  const naSemana = dataIso ? aulasNaSemana(minhasAulasCache, professorIdDoAluno, dataIso, idioma) : 0;
  // saldo: minutos de reposição; a aula de reposição precisa caber nele
  return { limite, naSemana, semanaCheia: limite > 0 && naSemana >= limite, saldo, duracao: duracaoDoAgendamento() };
}

function mensagemConfirmacaoAula(dataIso, horaInicio, modalidade, reposicao, idiomaAula, pedido) {
  return preencherMensagemWhatsapp(modeloMensagemWhatsapp(configAgendaProfessor, "confirmacao"), dadosDaMensagemWhatsapp({
    aluno: nomeDoAlunoAtual, data: dataIso, hora: horaInicio, modalidade,
    idioma: idiomaAula, mostrarIdioma: idiomasParaAula().length > 1, reposicao, pedido
  }));
}

// Indicador de progresso 1 → 2 → 3, pra deixar claro em que ponto o aluno está
function escolheIdiomaNoAgendamento() {
  return idiomasParaAula().length > 1;
}

function montarPassosAgendamento() {
  const passos = [
    ...(escolheIdiomaNoAgendamento() ? [{ rotulo: "Idioma", feito: !!agendamento.idioma }] : []),
    { rotulo: "Dia", feito: !!agendamento.data },
    { rotulo: "Horário", feito: !!agendamento.hora },
    { rotulo: "Confirmar", feito: false }
  ].map((p, i) => ({ ...p, n: i + 1 }));
  const atual = (passos.find((p) => !p.feito) || passos[passos.length - 1]).n;
  return `<div class="passos-agendamento">${passos.map((p) => `
    <div class="passo ${p.feito ? "feito" : (p.n === atual ? "atual" : "")}">
      <span class="passo-circulo">${p.feito ? "✓" : p.n}</span><span class="passo-rotulo">${p.rotulo}</span>
    </div>`).join('<div class="passo-linha"></div>')}</div>`;
}

function renderizarAgendamento() {
  const corpo = document.getElementById("corpo-agendamento");
  if (!corpo || !agendamento) return;

  if (agendamento.confirmada) {
    const c = agendamento.confirmada;
    corpo.innerHTML = `
      <div class="agendamento-sucesso">
        <div class="selo-sucesso${c.pedido ? " selo-pedido" : ""}">${c.pedido ? "⏳" : "✓"}</div>
        <h3>${c.pedido ? "Pedido de reposição enviado" : "Aula confirmada"}</h3>
        ${c.pedido ? `<p class="dica-pedido-enviado">O horário está reservado. Você recebe uma notificação quando o professor aprovar ou recusar.</p>` : ""}
        <p>${escapeHtml(rotuloDiaCurto(c.data))} às ${escapeHtml(c.hora)} · ${escolheIdiomaNoAgendamento() ? `${IDIOMAS[c.idioma].nome} · ` : ""}${c.modalidade === "online" ? "Online" : "Presencial"}${c.reposicao ? " · Reposição" : ""}</p>
        ${c.linkWhatsapp ? `<a class="btn btn-secundario" href="${c.linkWhatsapp}" target="_blank" rel="noopener">Não abriu? ${c.pedido ? "Avisar" : "Confirmar"} pelo WhatsApp</a>` : ""}
        <div class="acoes-sucesso">
          <button type="button" class="btn btn-primario" onclick="marcarOutraAula()">Marcar outra aula</button>
          <button type="button" class="btn btn-secundario" onclick="fecharAgendamento()">Fechar</button>
        </div>
      </div>`;
    return;
  }

  const dataHoraEscolhidas = agendamento.data && agendamento.hora;
  const comIdioma = escolheIdiomaNoAgendamento();
  const n = (passo) => (comIdioma ? passo + 1 : passo); // numeração dos passos

  // Passo do idioma (só quando o professor ensina mais de um): bandeiras pra escolher
  const cartaoIdioma = !comIdioma ? "" : agendamento.idioma ? `
    <div class="cartao-passo resumo-passo">
      <div><strong>Idioma da aula</strong><span class="idioma-escolhido">${bandeiraSvg(agendamento.idioma, 22)} ${IDIOMAS[agendamento.idioma].nome}</span></div>
      <button type="button" class="link-trocar" onclick="trocarIdiomaDaAula()">trocar</button>
    </div>` : `
    <div class="cartao-passo">
      <h4>1. Qual idioma você vai fazer nessa aula?</h4>
      <div class="opcoes-idioma-aula">
        ${idiomasParaAula().map((id) => `
          <button type="button" class="opcao-idioma-aula${id === idiomaDoAluno ? " sugerido" : ""}" onclick="escolherIdiomaDaAula('${id}')">
            ${bandeiraSvg(id, 28)}<span>${IDIOMAS[id].nome}</span>
          </button>`).join("")}
      </div>
    </div>`;

  // Dia e horário (recolhem num resumo depois de escolhidos)
  const cartaoDiaHorario = comIdioma && !agendamento.idioma ? `
    <div class="cartao-passo passo-bloqueado"><h4>Dia e horário</h4><p class="vazio">Escolha o idioma primeiro.</p></div>` : dataHoraEscolhidas ? `
    <div class="cartao-passo resumo-passo">
      <div><strong>Dia e horário</strong><span>${escapeHtml(rotuloDiaCurto(agendamento.data))} às ${escapeHtml(agendamento.hora)}</span></div>
      <button type="button" class="link-trocar" onclick="trocarDiaHorario()">trocar</button>
    </div>` : `
    <div class="cartao-passo">
      <h4>${n(1)}. Escolha o dia</h4>
      <div id="calendario-agendamento"></div>
      <h4>${n(2)}. Escolha o horário</h4>
      <div id="slots-agendamento"></div>
    </div>`;

  // Passo 3: detalhes da aula e confirmar
  const modalidades = modalidadesDoDia(agendamento.data);
  if (!modalidades.includes(agendamento.modalidade)) agendamento.modalidade = modalidades[0] || null;
  const plano = situacaoDoPlano(agendamento.data);
  // Com a semana cheia, a aula só pode ser reposição: com crédito, usa o crédito;
  // sem crédito, vira um pedido para o professor aprovar
  if (plano.semanaCheia) agendamento.reposicao = true;
  const pedido = agendamento.reposicao && !reposicaoCabeNoSaldo(plano);
  const linhasPlano = [];
  if (plano.limite > 0) {
    linhasPlano.push(agendamento.data
      ? `Semana de ${escapeHtml(formatarDataBR(inicioDaSemanaISO(agendamento.data)).slice(0, 5))}: <strong>${plano.naSemana} de ${plano.limite}</strong> aula${plano.limite > 1 ? "s" : ""} do seu plano`
      : `Seu plano: <strong>${plano.limite}</strong> aula${plano.limite > 1 ? "s" : ""} por semana`);
  }
  linhasPlano.push(`Reposição${escolheIdiomaNoAgendamento() ? ` de ${IDIOMAS[idiomaDoAgendamento()].nome}` : ""}: <strong>${formatarCreditos(plano.saldo)}</strong>`);

  const cartaoConfirmar = `
    <div class="cartao-passo${dataHoraEscolhidas ? "" : " passo-bloqueado"}">
      <h4>${n(3)}. Confirmar</h4>
      ${modalidades.length > 1 ? `
        <div class="campo-agendamento">
          <label>Modalidade</label>
          <div class="modalidades-agendamento">
            ${modalidades.map((m) => `<label><input type="radio" name="modalidade-agendamento" value="${m}" ${m === agendamento.modalidade ? "checked" : ""} onchange="agendamento.modalidade = this.value"> ${m === "online" ? "Online" : "Presencial"}</label>`).join("")}
          </div>
        </div>` : ""}
      <div class="plano-agendamento">${linhasPlano.map((l) => `<div>${l}</div>`).join("")}</div>
      <div class="campo-agendamento campo-reposicao">
        <label class="rotulo-reposicao"><input type="checkbox" id="chk-reposicao" ${agendamento.reposicao ? "checked" : ""} ${plano.semanaCheia ? "disabled" : ""} onchange="agendamento.reposicao = this.checked; renderizarAgendamento()"> Esta aula é uma reposição</label>
        ${agendamento.reposicao && !pedido ? `<p class="dica-reposicao">${plano.semanaCheia ? "As aulas do seu plano nessa semana já estão marcadas — e" : "E"}sta aula vai usar ${formatarMinutos(plano.duracao)} da sua reposição e já fica confirmada.</p>` : ""}
        ${pedido ? `<p class="dica-reposicao aviso-pedido">${plano.semanaCheia ? "As aulas do seu plano nessa semana já estão marcadas e v" : "V"}ocê ${!plano.saldo ? "não tem crédito de reposição" : creditosDeReposicao(plano.saldo) < 1 ? `ainda não tem um crédito completo (tem ${formatarMinutos(plano.saldo)}; faltam ${faltaParaProximoCredito(plano.saldo)} — a cada 60 min de reposição você ganha 1 crédito)` : `tem só ${formatarMinutos(plano.saldo)} de reposição (a aula tem ${formatarMinutos(plano.duracao)})`}: esta aula vai como <strong>pedido de reposição</strong>. O horário fica reservado e seu professor precisa aprovar.</p>` : ""}
      </div>
      ${agendamento.erro ? `<p class="erro-agendamento" role="alert">${escapeHtml(agendamento.erro)}</p>` : ""}
      <button type="button" class="btn btn-primario btn-confirmar-agendamento" id="btn-confirmar-agendamento" onclick="confirmarAgendamento()" ${dataHoraEscolhidas && !agendamento.salvando ? "" : "disabled"}>
        ${agendamento.salvando ? "Enviando..." : (pedido ? "Pedir reposição ao professor" : "Confirmar agendamento")}
      </button>
      ${dataHoraEscolhidas ? "" : `<p class="dica-confirmar">Escolha o dia e o horário para confirmar.</p>`}
    </div>`;

  corpo.innerHTML = montarPassosAgendamento() + cartaoIdioma + cartaoDiaHorario + cartaoConfirmar;

  if (!dataHoraEscolhidas && (!comIdioma || agendamento.idioma)) {
    montarCalendarioAgendamento();
    renderizarHorariosAgendamento();
  }
}

function escolherIdiomaDaAula(id) {
  agendamento.idioma = idiomaValido(id);
  agendamento.erro = "";
  renderizarAgendamento();
}

function trocarIdiomaDaAula() {
  agendamento.idioma = null;
  agendamento.erro = "";
  renderizarAgendamento();
}

function trocarDiaHorario() {
  agendamento.hora = null;
  agendamento.erro = "";
  renderizarAgendamento();
}

function marcarOutraAula() {
  agendamento = novoAgendamento();
  renderizarAgendamento();
}

// Desenha o calendário de mês (navegação + grade de dias), destacando quais
// dias o professor atende, pra o aluno escolher visualmente em vez de digitar uma data
function montarCalendarioAgendamento() {
  const container = document.getElementById("calendario-agendamento");
  if (!container) return;
  const hojeIso = dataDeHojeISO();
  const ano = mesCalendarioAgendamento.getFullYear();
  const mes = mesCalendarioAgendamento.getMonth();
  const primeiroDoMes = new Date(ano, mes, 1);
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const offsetInicio = primeiroDoMes.getDay();
  const liberado = mesLiberado(primeiroDoMes);

  const celulas = [];
  for (let i = 0; i < offsetInicio; i++) celulas.push(`<div class="cal-day cal-empty"></div>`);
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dataIso = chaveDataISO(new Date(ano, mes, dia));
    const passou = dataIso < hojeIso;
    const hoje = dataIso === hojeIso;
    const disponivel = !passou && liberado && diaTemDisponibilidade(dataIso);
    const selecionado = dataIso === agendamento.data;

    const classes = ["cal-day"];
    if (passou) classes.push("is-past");
    else if (!liberado) classes.push("is-locked");
    else if (!disponivel) classes.push("is-off");
    if (hoje) classes.push("is-today");
    if (disponivel) classes.push("is-available");
    if (selecionado) classes.push("is-selected");

    celulas.push(`
      <div class="${classes.join(" ")}" ${disponivel ? `data-calday="${dataIso}" role="button" tabindex="0" aria-pressed="${selecionado}"` : 'aria-disabled="true"'}>
        <span class="cal-num">${dia}</span>
      </div>
    `);
  }

  const hojeReal = new Date();
  const eMesAtual = ano === hojeReal.getFullYear() && mes === hojeReal.getMonth();

  container.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <div class="cal-nav"><button type="button" id="btn-cal-mes-anterior" ${eMesAtual ? "disabled" : ""} aria-label="Mês anterior">&larr;</button></div>
        <div class="cal-title">${NOMES_MESES[mes]} de ${ano}</div>
        <div class="cal-nav"><button type="button" id="btn-cal-mes-proximo" aria-label="Próximo mês">&rarr;</button></div>
      </div>
      <div class="cal-dow">${NOMES_DIAS_SEMANA_CURTO.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${celulas.join("")}</div>
      <div class="cal-legend">
        <span><span class="dot dot-disponivel"></span> Disponível</span>
        <span><span class="dot dot-indisponivel"></span> Indisponível</span>
        <span><span class="dot dot-selecionado"></span> Selecionado</span>
      </div>
      ${liberado ? "" : `<p class="aviso-mes-bloqueado">A agenda de ${NOMES_MESES[mes].toLowerCase()} ainda não foi liberada pelo seu professor.</p>`}
    </div>
  `;

  document.getElementById("btn-cal-mes-anterior").onclick = () => {
    mesCalendarioAgendamento = new Date(ano, mes - 1, 1);
    montarCalendarioAgendamento();
  };
  document.getElementById("btn-cal-mes-proximo").onclick = () => {
    mesCalendarioAgendamento = new Date(ano, mes + 1, 1);
    montarCalendarioAgendamento();
  };
  container.querySelectorAll("[data-calday]").forEach((celula) => {
    const escolher = () => selecionarDataAgendamento(celula.dataset.calday);
    celula.onclick = escolher;
    celula.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); escolher(); } };
  });
}

// Ao escolher uma data, busca as aulas já marcadas do professor naquele dia e calcula os horários livres
async function selecionarDataAgendamento(dataEscolhida) {
  agendamento.data = dataEscolhida;
  agendamento.hora = null;
  agendamento.horarios = null;
  agendamento.erroHorarios = false;
  agendamento.erro = "";
  renderizarAgendamento();
  await carregarHorariosLivres(dataEscolhida);
  if (agendamento && agendamento.data === dataEscolhida) renderizarAgendamento();
}

async function carregarHorariosLivres(dataEscolhida) {
  const blocos = blocosDoDia(dataEscolhida);
  let marcadas;
  try {
    const snap = await db.collection("aulas")
      .where("professorId", "==", professorIdDoAluno)
      .where("data", "==", dataEscolhida)
      .get();
    // Pedido de reposição pendente também segura o horário até o professor decidir
    marcadas = snap.docs.map((d) => d.data()).filter((a) => a.status === "agendada" || a.status === "pendente");
  } catch (e) {
    console.error(e);
    if (agendamento.data === dataEscolhida) agendamento.erroHorarios = true;
    return;
  }
  // Outra data pode ter sido escolhida enquanto esta carregava
  if (!agendamento || agendamento.data !== dataEscolhida) return;

  const config = configDoAgendamento();
  const duracao = config.duracaoAulaMinutos || 50;
  let horarios = slotsSemConflito(gerarSlotsDoDia(blocos, duracao, config.intervaloMinutos), duracao, marcadas);

  // Se a data escolhida for hoje, esconde horários que já passaram
  if (dataEscolhida === dataDeHojeISO()) {
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    horarios = horarios.filter((h) => minutosDoHorario(h) > minutosAgora);
  }
  agendamento.horarios = horarios;
}

function renderizarHorariosAgendamento() {
  const container = document.getElementById("slots-agendamento");
  if (!container) return;
  if (!agendamento.data) {
    container.innerHTML = `<p class="vazio">Escolha um dia no calendário para ver os horários.</p>`;
    return;
  }
  if (agendamento.erroHorarios) {
    container.innerHTML = `<p class="vazio">Não foi possível carregar os horários. <button type="button" class="link-trocar" onclick="selecionarDataAgendamento(agendamento.data)">Tentar de novo</button></p>`;
    return;
  }
  if (agendamento.horarios === null) {
    container.innerHTML = `<p class="vazio">Carregando horários...</p>`;
    return;
  }
  if (agendamento.horarios.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhum horário livre em ${escapeHtml(rotuloDiaCurto(agendamento.data))}. Tente outro dia.</p>`;
    return;
  }
  container.innerHTML = `<div class="slots-grade" id="slots-grade"></div>`;
  const grade = document.getElementById("slots-grade");
  agendamento.horarios.forEach((horaInicio) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn-slot-horario";
    // textContent: seguro, sem risco de injeção
    botao.textContent = faixaHorario(horaInicio, somarMinutos(horaInicio, configDoAgendamento().duracaoAulaMinutos || 50));
    botao.setAttribute("aria-pressed", "false");
    botao.onclick = () => {
      agendamento.hora = horaInicio;
      agendamento.erro = "";
      renderizarAgendamento();
    };
    grade.appendChild(botao);
  });
}

async function confirmarAgendamento() {
  const user = auth.currentUser;
  if (!user || !agendamento || !agendamento.data || !agendamento.hora || agendamento.salvando) return;
  if (!agendamento.idioma) {
    agendamento.erro = "Escolha o idioma da aula.";
    renderizarAgendamento();
    return;
  }

  if (aulasFuturasDoAluno(idiomaDoAgendamento()).length >= MAX_AULAS_FUTURAS_POR_ALUNO) {
    agendamento.erro = `Você já tem ${MAX_AULAS_FUTURAS_POR_ALUNO} aulas de ${IDIOMAS[idiomaDoAgendamento()].nome} marcadas. Cancele uma para marcar outra.`;
    renderizarAgendamento();
    return;
  }
  if (!agendamento.modalidade) {
    agendamento.erro = "Seu professor ainda não definiu se atende online ou presencial.";
    renderizarAgendamento();
    return;
  }
  const plano = situacaoDoPlano(agendamento.data);
  const pedido = agendamento.reposicao && !reposicaoCabeNoSaldo(plano); // sem crédito (ou tempo) suficiente: espera aprovação
  if (!agendamento.reposicao && plano.semanaCheia) {
    agendamento.erro = `Você já marcou as ${plano.limite} aula${plano.limite > 1 ? "s" : ""} do seu plano nessa semana.`;
    renderizarAgendamento();
    return;
  }

  const { data, hora, modalidade, reposicao, idioma } = agendamento;
  const duracao = configDoAgendamento().duracaoAulaMinutos || 50;

  // A aba do WhatsApp é aberta em branco JÁ AQUI, antes do "await" — celulares
  // (principalmente Safari/iOS) bloqueiam window.open() se ele só acontecer depois de uma
  // pausa assíncrona, porque nesse ponto deixa de contar como resposta direta a um toque
  // do usuário. Preenchendo o destino da aba só depois que a gravação terminar, o popup nunca é bloqueado.
  const linkConfirmacao = configAgendaProfessor.whatsapp
    ? linkWhatsapp(configAgendaProfessor.whatsapp, mensagemConfirmacaoAula(data, hora, modalidade, reposicao, idioma, pedido))
    : null;
  const abaWhatsapp = linkConfirmacao ? window.open("", "_blank") : null;

  agendamento.salvando = true;
  agendamento.erro = "";
  renderizarAgendamento();
  try {
    await agendarAula(professorIdDoAluno, data, hora, somarMinutos(hora, duracao), modalidade,
      user.uid, nomeDoAlunoAtual, reposicao, idioma, pedido ? "pendente" : "agendada");
  } catch (e) {
    if (abaWhatsapp) abaWhatsapp.close();
    agendamento.salvando = false;
    agendamento.erro = e.message || "Não foi possível agendar esse horário. Tente outro.";
    // o horário pode ter sido ocupado por outro aluno: volta pra lista atualizada
    agendamento.hora = null;
    agendamento.horarios = null;
    renderizarAgendamento();
    await carregarHorariosLivres(data);
    renderizarAgendamento();
    return;
  }

  if (abaWhatsapp) abaWhatsapp.location = linkConfirmacao;
  avisarProfessor(pedido ? "aluno-pediu-reposicao" : "aluno-marcou-aula", pedido
    ? `${nomeDoAlunoAtual} pediu uma reposição para ${descricaoAulaParaProfessor(data, hora, idioma)}. Aprove ou recuse na Agenda.`
    : `${nomeDoAlunoAtual} marcou ${reposicao ? "uma reposição" : "uma aula"} para ${descricaoAulaParaProfessor(data, hora, idioma)}.`, idioma);
  agendamento.salvando = false;
  agendamento.confirmada = { data, hora, modalidade, reposicao, idioma, pedido, linkWhatsapp: linkConfirmacao };
  renderizarAgendamento();
}
