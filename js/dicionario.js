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

exigirLogin("aluno");

auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  const perfil = await db.collection("usuarios").doc(user.uid).get();
  nomeDoAlunoAtual = perfil.data().nome;
  professorIdDoAluno = perfil.data().professorId;
  carregarMensagensDoProfessor(user.uid);
  escutarAnotacoes(user.uid);
  escutarPalavras(user.uid);
  escutarMinhasAulas(user.uid);
});

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
  await db.collection("usuarios").doc(user.uid).collection("anotacoes").add({
    texto: texto.trim(),
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById("input-anotacoes").value = "";
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
  await db.collection("usuarios").doc(user.uid).collection("anotacoes").doc(id)
    .update({ texto: novoTexto });
  anotacaoEmEdicaoId = null;
}

async function excluirAnotacao(id) {
  const user = auth.currentUser;
  if (!user) return;
  await db.collection("usuarios").doc(user.uid).collection("anotacoes").doc(id).delete();
}

// Escuta em tempo real a coleção de palavras do aluno logado
function escutarPalavras(uid) {
  db.collection("usuarios").doc(uid).collection("palavras")
    .orderBy("palavraEn")
    .onSnapshot((snapshot) => {
      cacheDePalavras = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      montarIndiceLetras();
      renderizarTela();
    });
}

// Monta as abas do menu lateral: "Início" + A-Z, marcando quantas palavras tem cada letra
function montarIndiceLetras() {
  const contagemPorLetra = {};
  cacheDePalavras.forEach((p) => {
    const letra = p.palavraEn[0].toUpperCase();
    contagemPorLetra[letra] = (contagemPorLetra[letra] || 0) + 1;
  });

  const container = document.getElementById("indice-letras-lista");
  container.innerHTML = "";

  const inicio = document.createElement("button");
  inicio.className = "letra-tab" + (letraSelecionada === "INICIO" ? " ativa" : "");
  inicio.textContent = "🏠";
  inicio.title = "Início";
  inicio.onclick = () => { letraSelecionada = "INICIO"; montarIndiceLetras(); renderizarTela(); };
  container.appendChild(inicio);

  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((letra) => {
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
    btn.onclick = () => { letraSelecionada = letra; montarIndiceLetras(); renderizarTela(); };
    container.appendChild(btn);
  });
}

// Decide o que mostrar no topo e no corpo da página, dependendo da tela ativa
function renderizarTela() {
  const painelMensagens = document.getElementById("painel-mensagens");
  const painelAnotacoes = document.getElementById("painel-anotacoes");
  const tituloTopo = document.getElementById("titulo-topo");
  const eyebrowTopo = document.getElementById("eyebrow-topo");
  const contadorTotal = document.getElementById("contador-total");

  if (letraSelecionada === "INICIO") {
    eyebrowTopo.textContent = "SEU VOCABULÁRIO";
    tituloTopo.textContent = nomeDoAlunoAtual || "Olá!";
    painelMensagens.classList.remove("forcar-oculto");
    painelAnotacoes.classList.remove("forcar-oculto");
    contadorTotal.classList.remove("forcar-oculto");
    contadorTotal.textContent = cacheDePalavras.length === 1
      ? "1 palavra aprendida"
      : `${cacheDePalavras.length} palavras aprendidas`;
  } else {
    eyebrowTopo.textContent = "VOCABULÁRIO";
    tituloTopo.textContent = `Palavras aprendidas com a inicial "${letraSelecionada}"`;
    painelMensagens.classList.add("forcar-oculto");
    painelAnotacoes.classList.add("forcar-oculto");
    contadorTotal.classList.add("forcar-oculto");
  }
  renderizarPalavras();
}

// Transforma o texto em asteriscos, preservando espaços (ex: "I like it" -> "* **** **")
function mascarar(texto) {
  return texto.replace(/\S/g, "*");
}

function alternarTraducao(id) {
  if (traducoesReveladas.has(id)) {
    traducoesReveladas.delete(id);
  } else {
    traducoesReveladas.add(id);
  }
  renderizarPalavras();
}

// Fala a palavra em inglês de um cartão específico
function falarPalavra(id) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (p) falar(p.palavraEn);
}

// Fala uma frase de exemplo específica de uma palavra
function falarFrase(id, indice) {
  const p = cacheDePalavras.find((x) => x.id === id);
  if (!p || !p.frasesExemplo || !p.frasesExemplo[indice]) return;
  const f = p.frasesExemplo[indice];
  falar(typeof f === "string" ? f : f.en);
}

function renderizarPalavras() {
  const grade = document.getElementById("grade-cartoes");
  grade.innerHTML = "";

  // Na tela Início não mostramos a lista de palavras — só nas telas de cada letra
  if (letraSelecionada === "INICIO") return;

  const lista = cacheDePalavras.filter((p) => p.palavraEn[0].toUpperCase() === letraSelecionada);

  if (lista.length === 0) {
    grade.innerHTML = `<p class="vazio">Nenhuma palavra aqui ainda. Adicione uma acima!</p>`;
    return;
  }

  lista.forEach((p) => {
    const cartao = document.createElement("div");
    cartao.className = "cartao-palavra";

    const revelada = traducoesReveladas.has(p.id);
    let frases;
    if (p.frasesExemplo && p.frasesExemplo.length > 0) {
      const linhas = p.frasesExemplo.map((f, indice) => {
        // Compatibilidade: frases antigas eram só texto (string); as novas são {en, pt}
        const en = typeof f === "string" ? f : f.en;
        const pt = typeof f === "string" ? "" : f.pt;
        const ptExibido = pt ? (revelada ? pt : mascarar(pt)) : "";
        return `<div class="frase-exemplo">"${escapeHtml(en)}" <button class="btn-falar-frase" type="button" title="Ouvir frase" onclick="falarFrase('${p.id}', ${indice})">🔊</button>${ptExibido ? `<br><span class="frase-traducao">${escapeHtml(ptExibido)}</span>` : ""}</div>`;
      }).join("");
      const temTraducao = p.frasesExemplo.some((f) => typeof f !== "string" && f.pt);
      const botaoRevelar = temTraducao
        ? `<button class="btn-ver-traducao" onclick="alternarTraducao('${p.id}')">${revelada ? "🙈 Ocultar tradução" : "👁 Ver tradução"}</button>`
        : "";
      frases = linhas + botaoRevelar;
    } else if (p.falhaAoGerarFrases) {
      frases = `<div class="frase-exemplo">Não foi possível gerar frases de exemplo agora.</div>`;
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
      <div class="palavra-en">${escapeHtml(p.palavraEn)} <button class="btn-falar" type="button" title="Ouvir pronúncia" onclick="falarPalavra('${p.id}')">🔊</button></div>
      <div class="palavra-pt">${escapeHtml(p.traducaoPt)}</div>
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
  await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id)
    .update({ notaPessoal: texto });
  notaPalavraEmEdicaoId = null;
}

async function removerNotaPalavra(id) {
  const user = auth.currentUser;
  if (!user) return;
  await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id)
    .update({ notaPessoal: firebase.firestore.FieldValue.delete() });
}

// Adiciona uma nova palavra: salva no Firestore e pede a frase de exemplo à IA
async function adicionarPalavra(palavraEn, traducaoPt, notaPessoal) {
  const user = auth.currentUser;
  if (!user || !palavraEn.trim() || !traducaoPt.trim()) return;

  const statusEl = document.getElementById("status-palavra");

  // Verifica se essa palavra já foi adicionada antes (ignorando maiúsculas/minúsculas e espaços)
  const jaExiste = cacheDePalavras.some(
    (p) => p.palavraEn.trim().toLowerCase() === palavraEn.trim().toLowerCase()
  );
  if (jaExiste) {
    statusEl.textContent = `"${palavraEn.trim()}" já está no seu vocabulário.`;
    setTimeout(() => (statusEl.textContent = ""), 2500);
    return;
  }

  statusEl.textContent = "Salvando...";

  const dadosPalavra = {
    palavraEn: palavraEn.trim(),
    traducaoPt: traducaoPt.trim(),
    frasesExemplo: [],
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  };
  // Anotação é opcional — só grava o campo se o usuário escreveu algo
  if (notaPessoal && notaPessoal.trim()) {
    dadosPalavra.notaPessoal = notaPessoal.trim();
  }

  const ref = await db.collection("usuarios").doc(user.uid).collection("palavras").add(dadosPalavra);

  document.getElementById("input-palavra-en").value = "";
  document.getElementById("input-palavra-pt").value = "";
  document.getElementById("input-palavra-nota").value = "";
  statusEl.textContent = "";

  // Pede as 5 frases de exemplo à function do Vercel (a chave da IA fica só lá no servidor)
  try {
    const resposta = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ palavra: palavraEn.trim(), traducao: traducaoPt.trim() })
    });
    const dados = await resposta.json();
    if (dados.frases && dados.frases.length > 0) {
      await db.collection("usuarios").doc(user.uid).collection("palavras").doc(ref.id)
        .update({ frasesExemplo: dados.frases });
    } else {
      // A IA respondeu mas não trouxe frases (quota, sobrecarga etc.) — marca a
      // palavra para não ficar com "Gerando frases de exemplo..." pra sempre.
      await db.collection("usuarios").doc(user.uid).collection("palavras").doc(ref.id)
        .update({ frasesExemplo: [], falhaAoGerarFrases: true });
    }
  } catch (e) {
    console.warn("Não foi possível gerar as frases de exemplo agora:", e);
    await db.collection("usuarios").doc(user.uid).collection("palavras").doc(ref.id)
      .update({ frasesExemplo: [], falhaAoGerarFrases: true }).catch(() => {});
  }
}

async function removerPalavra(id) {
  const user = auth.currentUser;
  if (!user) return;
  await db.collection("usuarios").doc(user.uid).collection("palavras").doc(id).delete();
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
  return cacheDePalavras.filter((p) => p.frasesExemplo && p.frasesExemplo.length > 0);
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
  const frasesValidas = alvo.frasesExemplo
    .map((f) => (typeof f === "string" ? f : f.en))
    .filter((texto) => texto && texto.toLowerCase().includes(alvo.palavraEn.toLowerCase()));

  if (frasesValidas.length === 0) {
    // Essa palavra não tem frase utilizável (raro) — tenta outra
    const restantes = elegiveis.filter((p) => p.id !== alvo.id);
    if (restantes.length < 2) { fecharQuiz(); return; }
    gerarPerguntaQuiz(restantes);
    return;
  }

  const fraseTexto = frasesValidas[Math.floor(Math.random() * frasesValidas.length)];
  const regexEscapada = alvo.palavraEn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fraseComLacuna = fraseTexto.replace(new RegExp(`\\b${regexEscapada}\\b`, "i"), "_____");

  const outrasPalavras = elegiveis.filter((p) => p.id !== alvo.id).map((p) => p.palavraEn);
  const distratores = embaralhar(outrasPalavras).slice(0, Math.min(3, outrasPalavras.length));
  const opcoes = embaralhar([alvo.palavraEn, ...distratores]);

  quizAtual = { respostaCerta: alvo.palavraEn, fraseComLacuna, opcoes };
  renderizarQuiz();
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

// -------------------- AGENDAMENTO DE AULAS --------------------

let configAgendaProfessor = null;
let minhasAulasCache = [];
let dataEscolhidaAgendamento = null;

function escutarMinhasAulas(uid) {
  db.collection("aulas").where("alunoId", "==", uid)
    .onSnapshot((snap) => {
      minhasAulasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarMinhasAulas();
    });
}

function renderizarMinhasAulas() {
  const painel = document.getElementById("painel-minhas-aulas");
  const lista = document.getElementById("lista-minhas-aulas");
  if (!painel || !lista) return;

  const hojeIso = dataDeHojeISO();
  const futuras = minhasAulasCache
    .filter((a) => a.status === "agendada" && a.data >= hojeIso)
    .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));

  if (futuras.length === 0) {
    painel.classList.add("oculto");
    return;
  }

  painel.classList.remove("oculto");
  lista.innerHTML = futuras.map((a) => `
    <div class="cartao-aula">
      <div class="aula-info">
        <span>${formatarDataBR(a.data)} às ${escapeHtml(a.horaInicio)}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${a.modalidade === "online" ? "Online" : "Presencial"}</span>
      </div>
      <button class="excluir" onclick="cancelarMinhaAula('${a.id}')">Cancelar</button>
    </div>
  `).join("");
}

async function cancelarMinhaAula(aulaId) {
  if (!confirm("Cancelar essa aula?")) return;
  await db.collection("aulas").doc(aulaId).update({ status: "cancelada", canceladoPor: "aluno" });
}

// Abre o modal de agendamento, carregando a configuração de agenda do professor vinculado
async function abrirAgendamento() {
  if (!professorIdDoAluno) return;

  const snap = await db.collection("usuarios").doc(professorIdDoAluno)
    .collection("configuracaoAgenda").doc("dados").get();

  if (!snap.exists) {
    alert("Seu professor ainda não configurou horários disponíveis para agendamento.");
    return;
  }

  configAgendaProfessor = snap.data();
  dataEscolhidaAgendamento = null;

  const inputData = document.getElementById("input-data-agendamento");
  inputData.min = dataDeHojeISO();
  inputData.value = "";

  const modalidades = configAgendaProfessor.modalidades || [];
  document.getElementById("modalidades-agendamento").innerHTML = modalidades.map((m, indice) => `
    <label><input type="radio" name="modalidade-agendamento" value="${m}" ${indice === 0 ? "checked" : ""}> ${m === "online" ? "Online" : "Presencial"}</label>
  `).join("");
  document.getElementById("campo-modalidades-agendamento").style.display = modalidades.length > 1 ? "block" : "none";

  document.getElementById("slots-agendamento").innerHTML = `<p class="vazio">Escolha uma data acima.</p>`;
  document.getElementById("modal-agendamento").classList.remove("modal-oculto");
}

function fecharAgendamento() {
  document.getElementById("modal-agendamento").classList.add("modal-oculto");
}

// Ao escolher uma data, busca as aulas já marcadas do professor naquele dia e calcula os horários livres
async function selecionarDataAgendamento() {
  const dataEscolhida = document.getElementById("input-data-agendamento").value;
  const container = document.getElementById("slots-agendamento");
  if (!dataEscolhida) { container.innerHTML = ""; return; }

  dataEscolhidaAgendamento = dataEscolhida;
  const diaSemana = chaveDiaSemana(dataEscolhida);
  const blocos = (configAgendaProfessor.disponibilidade || {})[diaSemana];

  if (!blocos || blocos.length === 0) {
    container.innerHTML = `<p class="vazio">Seu professor não atende nesse dia da semana.</p>`;
    return;
  }

  container.innerHTML = `<p class="vazio">Carregando horários...</p>`;

  const snap = await db.collection("aulas")
    .where("professorId", "==", professorIdDoAluno)
    .where("data", "==", dataEscolhida)
    .get();
  const ocupados = new Set(
    snap.docs.map((d) => d.data()).filter((a) => a.status === "agendada").map((a) => a.horaInicio)
  );

  const duracao = configAgendaProfessor.duracaoAulaMinutos || 50;
  let slots = gerarSlotsDoDia(blocos, duracao).filter((h) => !ocupados.has(h));

  // Se a data escolhida for hoje, esconde horários que já passaram
  if (dataEscolhida === dataDeHojeISO()) {
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    slots = slots.filter((h) => {
      const [hh, mm] = h.split(":").map(Number);
      return hh * 60 + mm > minutosAgora;
    });
  }

  if (slots.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhum horário livre nesse dia. Tente outra data.</p>`;
    return;
  }

  container.innerHTML = `<div class="slots-grade" id="slots-grade"></div>`;
  const grade = document.getElementById("slots-grade");
  slots.forEach((horaInicio) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "btn-slot-horario";
    botao.textContent = horaInicio; // textContent: seguro, sem risco de injeção
    botao.onclick = () => confirmarAgendamento(horaInicio, duracao);
    grade.appendChild(botao);
  });
}

async function confirmarAgendamento(horaInicio, duracaoMinutos) {
  const modalidadeInput = document.querySelector('input[name="modalidade-agendamento"]:checked');
  if (!modalidadeInput) {
    alert("Escolha a modalidade da aula.");
    return;
  }

  const user = auth.currentUser;
  if (!user) return;

  try {
    await agendarAula(
      professorIdDoAluno,
      dataEscolhidaAgendamento,
      horaInicio,
      somarMinutos(horaInicio, duracaoMinutos),
      modalidadeInput.value,
      user.uid,
      nomeDoAlunoAtual
    );
    fecharAgendamento();
  } catch (e) {
    alert(e.message || "Não foi possível agendar esse horário. Tente outro.");
    selecionarDataAgendamento(); // recarrega a lista de horários livres
  }
}

// Usa uma transação: o ID do documento é determinístico ("professor_data_hora"), então
// duas tentativas simultâneas de marcar o MESMO horário disputam o mesmo documento — a
// segunda falha com um erro claro, em vez de sobrescrever silenciosamente a primeira.
async function agendarAula(professorId, data, horaInicio, horaFim, modalidade, alunoId, alunoNome) {
  const aulaId = `${professorId}_${data}_${horaInicio.replace(":", "")}`;
  const ref = db.collection("aulas").doc(aulaId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().status !== "cancelada") {
      throw new Error("Esse horário acabou de ser reservado por outro aluno. Escolha outro.");
    }
    tx.set(ref, {
      professorId, alunoId, alunoNome,
      data, horaInicio, horaFim, modalidade,
      status: "agendada",
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
}
