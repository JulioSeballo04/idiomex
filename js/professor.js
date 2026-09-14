// ============================================================
// PAINEL DO PROFESSOR
// ============================================================
// Cada aluno é um bloco de "acordeão": clica para abrir/fechar.
// Dentro do bloco, três abas: Vocabulário (por letra), Recados
// e Relatório de aulas. O sistema guarda, por aluno e por letra,
// a última vez que o professor abriu aquela letra — o destaque
// de "novidade" (bolinha âmbar) some só na letra clicada, não
// no aluno inteiro.
// ============================================================

let professorIdAtual = null;
let alunosCache = []; // [{id, nome, ...}]
const estadoAlunos = {}; // por alunoId: ver garantirEstado()
let aulasCache = []; // todas as aulas (de todos os alunos) deste professor
let configAgendaAtual = null; // {duracaoAulaMinutos, modalidades, disponibilidade}
let mesCalendarioProfessor = null; // Date do 1º dia do mês exibido no calendário da agenda
let diaSelecionadoProfessor = null; // "AAAA-MM-DD" do dia clicado no calendário, ou null
let overridesAgendaCache = {}; // {"AAAA-MM-DD": {fechado, blocos}} — exceções pontuais por dia

// Períodos padrão exibidos na configuração de disponibilidade — cada um vira
// um bloco de horário independente dentro do dia (a agenda já suportava
// múltiplos blocos por dia, só a tela só deixava configurar um).
const PERIODOS_DIA = [
  { chave: "manha", nome: "Manhã", padraoInicio: "08:00", padraoFim: "12:00" },
  { chave: "tarde", nome: "Tarde", padraoInicio: "13:00", padraoFim: "18:00" },
  { chave: "noite", nome: "Noite", padraoInicio: "19:00", padraoFim: "22:00" }
];

// Classifica um horário de início dentro de um dos períodos acima, pra
// reconstruir a tela a partir dos blocos já salvos no Firestore.
function periodoDoHorario(horaInicio) {
  const hora = Number((horaInicio || "0").split(":")[0]);
  if (hora < 12) return "manha";
  if (hora < 18) return "tarde";
  return "noite";
}
const DURACAO_PADRAO_MINUTOS = 50;

exigirLogin("professor");

auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  professorIdAtual = user.uid;
  const perfil = (await db.collection("usuarios").doc(user.uid).get()).data();
  document.getElementById("nome-usuario").textContent = perfil.nome;
  document.getElementById("codigo-professor").textContent = perfil.codigoProfessor;

  const hoje = new Date();
  mesCalendarioProfessor = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  await carregarConfigAgenda();

  carregarAlunos(user.uid);
  escutarAulasDoProfessor(user.uid);
  escutarOverridesAgenda(user.uid);
  montarCalendarioProfessor();
});

// Exceções pontuais de disponibilidade (fechar um dia, ou ajustar o horário
// só dele) — além da grade semanal recorrente configurada acima.
function escutarOverridesAgenda(uid) {
  db.collection("usuarios").doc(uid).collection("agendaOverrides")
    .onSnapshot((snap) => {
      overridesAgendaCache = {};
      snap.docs.forEach((d) => { overridesAgendaCache[d.id] = d.data(); });
      montarCalendarioProfessor();
    });
}

function garantirEstado(alunoId) {
  if (!estadoAlunos[alunoId]) {
    estadoAlunos[alunoId] = {
      aberto: false,
      abaAtiva: "vocabulario",       // vocabulario | recados | relatorio | aulas
      letraSelecionada: "TODAS",
      palavras: [],
      mensagens: [],
      relatorios: [],
      unsubPalavras: null,
      unsubMensagens: null,
      unsubRelatorios: null,
      letrasVistas: null,            // {A: Timestamp, B: Timestamp, ...} última vez que cada letra foi aberta
      temNovidade: false,
      letrasNovas: new Set(),
      mensagemEmEdicaoId: null
    };
  }
  return estadoAlunos[alunoId];
}

// -------------------- LISTA DE ALUNOS --------------------

function carregarAlunos(professorId) {
  db.collection("usuarios")
    .where("tipo", "==", "aluno")
    .where("professorId", "==", professorId)
    .onSnapshot(async (snapshot) => {
      if (snapshot.empty) {
        alunosCache = [];
        document.getElementById("lista-alunos").innerHTML =
          `<p class="vazio">Nenhum aluno vinculado ainda. Compartilhe seu código acima.</p>`;
        return;
      }

      alunosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      for (const aluno of alunosCache) {
        const estado = garantirEstado(aluno.id);

        // Busca (uma única vez) as letras já vistas desse aluno
        if (estado.letrasVistas === null) {
          await carregarLetrasVistas(aluno.id);
        }

        // Mantém um listener sempre ativo nas palavras de cada aluno vinculado,
        // para o destaque de novidade funcionar em tempo real, mesmo com o bloco fechado.
        if (!estado.unsubPalavras) {
          estado.unsubPalavras = db.collection("usuarios").doc(aluno.id).collection("palavras")
            .orderBy("palavraEn")
            .onSnapshot((snap) => {
              estado.palavras = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
              calcularNovidades(aluno.id);
              renderizarListaAlunos();
            });
        }
      }

      renderizarListaAlunos();
    });
}

async function carregarLetrasVistas(alunoId) {
  const estado = estadoAlunos[alunoId];
  const ref = db.collection("usuarios").doc(professorIdAtual).collection("visualizacoes").doc(alunoId);
  const visSnap = await ref.get();

  if (visSnap.exists && visSnap.data().letras) {
    estado.letrasVistas = visSnap.data().letras;
  } else {
    // Primeira vez que esse aluno passa pelo sistema de novidades: grava "agora" em
    // todas as letras, como marco inicial, para não marcar palavras antigas como novas.
    const agora = firebase.firestore.Timestamp.now();
    const letras = {};
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((l) => { letras[l] = agora; });
    await ref.set({ letras });
    estado.letrasVistas = letras;
  }
  calcularNovidades(alunoId);
}

// Marca uma letra específica como vista agora — some o destaque só dela
async function marcarLetraComoVista(alunoId, letra) {
  const estado = estadoAlunos[alunoId];
  const agora = firebase.firestore.Timestamp.now();

  estado.letrasVistas[letra] = agora;
  estado.letrasNovas.delete(letra);
  estado.temNovidade = estado.letrasNovas.size > 0;

  await db.collection("usuarios").doc(professorIdAtual).collection("visualizacoes")
    .doc(alunoId).update({ [`letras.${letra}`]: agora });
}

// Verifica, letra por letra, quais têm palavra criada depois da última vez que foi vista
function calcularNovidades(alunoId) {
  const estado = estadoAlunos[alunoId];
  if (!estado.letrasVistas) return;

  const letrasNovas = new Set();

  estado.palavras.forEach((p) => {
    const letra = p.palavraEn[0].toUpperCase();
    const vistoEm = estado.letrasVistas[letra];
    if (!vistoEm || (p.criadoEm && p.criadoEm.toMillis() > vistoEm.toMillis())) {
      letrasNovas.add(letra);
    }
  });

  estado.letrasNovas = letrasNovas;
  estado.temNovidade = letrasNovas.size > 0;
}

const DIAS_INATIVIDADE = 7;

// Calcula e desenha o resumo da turma: total de alunos, total de palavras,
// aluno mais ativo e quem está sem adicionar palavra há mais de X dias.
function renderizarVisaoGeralTurma() {
  const container = document.getElementById("visao-geral-turma");
  if (!container) return;

  if (alunosCache.length === 0) {
    container.innerHTML = `<p class="vazio">Vincule alunos para ver o resumo da turma aqui.</p>`;
    return;
  }

  const agora = Date.now();
  const limiteInatividadeMs = DIAS_INATIVIDADE * 24 * 60 * 60 * 1000;

  let totalPalavras = 0;
  let maisAtivo = null;
  const inativos = [];

  alunosCache.forEach((aluno) => {
    const estado = garantirEstado(aluno.id);
    totalPalavras += estado.palavras.length;

    let ultimaAtividadeMs = null;
    estado.palavras.forEach((p) => {
      if (p.criadoEm) {
        const ms = p.criadoEm.toMillis();
        if (!ultimaAtividadeMs || ms > ultimaAtividadeMs) ultimaAtividadeMs = ms;
      }
    });

    if (!ultimaAtividadeMs || (agora - ultimaAtividadeMs) > limiteInatividadeMs) {
      inativos.push(aluno.nome);
    }

    if (!maisAtivo || estado.palavras.length > maisAtivo.qtd) {
      maisAtivo = { nome: aluno.nome, qtd: estado.palavras.length };
    }
  });

  container.innerHTML = `
    <div class="visao-geral-cartoes">
      <div class="cartao-metrica">
        <div class="metrica-numero">${alunosCache.length}</div>
        <div class="metrica-label">aluno(s) vinculado(s)</div>
      </div>
      <div class="cartao-metrica">
        <div class="metrica-numero">${totalPalavras}</div>
        <div class="metrica-label">palavras no total</div>
      </div>
      <div class="cartao-metrica">
        <div class="metrica-numero metrica-numero-nome">${maisAtivo && maisAtivo.qtd > 0 ? escapeHtml(maisAtivo.nome) : "—"}</div>
        <div class="metrica-label">aluno mais ativo</div>
      </div>
    </div>
    ${inativos.length > 0 ? `
      <div class="aviso-inativos">
        ⚠ Sem palavra nova há mais de ${DIAS_INATIVIDADE} dias: ${inativos.map(escapeHtml).join(", ")}
      </div>
    ` : ""}
  `;
}

function renderizarListaAlunos() {
  renderizarVisaoGeralTurma();
  montarCalendarioProfessor();

  const lista = document.getElementById("lista-alunos");
  lista.innerHTML = "";

  alunosCache.forEach((aluno) => {
    const estado = garantirEstado(aluno.id);

    const bloco = document.createElement("div");
    bloco.className = "aluno-bloco";

    const header = document.createElement("div");
    header.className = "item-aluno" + (estado.aberto ? " aberto" : "");
    header.innerHTML = `
      <span class="nome-aluno">
        ${escapeHtml(aluno.nome)}
        ${estado.temNovidade ? '<span class="badge-novidade" title="Tem palavra nova"></span>' : ""}
      </span>
      <span class="cabecalho-direita">
        <span class="contagem">${estado.palavras.length} palavra(s)</span>
        <span class="seta-expandir">▾</span>
      </span>
    `;
    header.onclick = () => alternarAluno(aluno.id);
    bloco.appendChild(header);

    if (estado.aberto) {
      const detalhe = document.createElement("div");
      detalhe.className = "detalhe-aluno-inline";
      detalhe.innerHTML = montarHtmlDetalheAluno(aluno.id);
      bloco.appendChild(detalhe);
    }

    lista.appendChild(bloco);
  });
}

// -------------------- ABRIR / FECHAR (ACORDEÃO) --------------------

async function alternarAluno(alunoId) {
  const estado = garantirEstado(alunoId);
  estado.aberto = !estado.aberto;

  if (estado.aberto) {
    ativarListenersDetalheAluno(alunoId);
  } else {
    desativarListenersDetalheAluno(alunoId);
  }

  renderizarListaAlunos();
}

function ativarListenersDetalheAluno(alunoId) {
  const estado = estadoAlunos[alunoId];

  if (!estado.unsubMensagens) {
    estado.unsubMensagens = db.collection("usuarios").doc(alunoId).collection("mensagens")
      .orderBy("criadoEm", "desc")
      .onSnapshot((snap) => {
        estado.mensagens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (estado.aberto) renderizarListaAlunos();
      });
  }

  if (!estado.unsubRelatorios) {
    estado.unsubRelatorios = db.collection("usuarios").doc(alunoId).collection("relatorios")
      .orderBy("criadoEm", "desc")
      .onSnapshot((snap) => {
        estado.relatorios = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (estado.aberto) renderizarListaAlunos();
      });
  }
}

function desativarListenersDetalheAluno(alunoId) {
  const estado = estadoAlunos[alunoId];
  if (estado.unsubMensagens) { estado.unsubMensagens(); estado.unsubMensagens = null; }
  if (estado.unsubRelatorios) { estado.unsubRelatorios(); estado.unsubRelatorios = null; }
}

// -------------------- DETALHE DO ALUNO (ABAS) --------------------

function montarHtmlDetalheAluno(alunoId) {
  const estado = estadoAlunos[alunoId];

  const abas = `
    <div class="abas-detalhe">
      <button class="aba-detalhe ${estado.abaAtiva === "vocabulario" ? "ativa" : ""}"
        onclick="mudarAbaAluno('${alunoId}','vocabulario')">Vocabulário</button>
      <button class="aba-detalhe ${estado.abaAtiva === "recados" ? "ativa" : ""}"
        onclick="mudarAbaAluno('${alunoId}','recados')">Recados</button>
      <button class="aba-detalhe ${estado.abaAtiva === "relatorio" ? "ativa" : ""}"
        onclick="mudarAbaAluno('${alunoId}','relatorio')">Relatório de aulas</button>
      <button class="aba-detalhe ${estado.abaAtiva === "aulas" ? "ativa" : ""}"
        onclick="mudarAbaAluno('${alunoId}','aulas')">Aulas marcadas</button>
    </div>
  `;

  let conteudo;
  if (estado.abaAtiva === "recados") conteudo = montarAbaRecados(alunoId);
  else if (estado.abaAtiva === "relatorio") conteudo = montarAbaRelatorio(alunoId);
  else if (estado.abaAtiva === "aulas") conteudo = montarAbaAulas(alunoId);
  else conteudo = montarAbaVocabulario(alunoId);

  return abas + conteudo;
}

function mudarAbaAluno(alunoId, aba) {
  estadoAlunos[alunoId].abaAtiva = aba;
  renderizarListaAlunos();
}

// -------------------- ABA: VOCABULÁRIO (abecedário) --------------------

function montarAbaVocabulario(alunoId) {
  const estado = estadoAlunos[alunoId];

  const contagemPorLetra = {};
  estado.palavras.forEach((p) => {
    const letra = p.palavraEn[0].toUpperCase();
    contagemPorLetra[letra] = (contagemPorLetra[letra] || 0) + 1;
  });

  const letrasHtml = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letra) => {
    const qtd = contagemPorLetra[letra] || 0;
    let classe = "letra-tab-mini";
    if (estado.letraSelecionada === letra) classe += " ativa";
    if (qtd === 0) classe += " vazia";
    const temNovidadeLetra = estado.letrasNovas.has(letra);
    return `
      <button class="${classe}" ${qtd === 0 ? "disabled" : ""} onclick="selecionarLetraAluno('${alunoId}','${letra}')">
        ${letra}${qtd > 0 ? `<span class="contagem-letra-mini">${qtd}</span>` : ""}
        ${temNovidadeLetra ? '<span class="badge-novidade-letra"></span>' : ""}
      </button>
    `;
  }).join("");

  let listaPalavras;
  if (estado.letraSelecionada === "TODAS") {
    listaPalavras = `<p class="vazio">Selecione uma letra acima para ver as palavras.</p>`;
  } else {
    const filtradas = estado.palavras.filter((p) => p.palavraEn[0].toUpperCase() === estado.letraSelecionada);
    if (filtradas.length === 0) {
      listaPalavras = `<p class="vazio">Nenhuma palavra com essa letra ainda.</p>`;
    } else {
      listaPalavras = `<div class="grade-cartoes">` + filtradas.map((p) => {
        const frases = p.frasesExemplo && p.frasesExemplo.length > 0
          ? p.frasesExemplo.map((f) => {
              const en = typeof f === "string" ? f : f.en;
              const pt = typeof f === "string" ? "" : f.pt;
              return `<div class="frase-exemplo">"${escapeHtml(en)}"${pt ? `<br><span class="frase-traducao">${escapeHtml(pt)}</span>` : ""}</div>`;
            }).join("")
          : "";
        return `
          <div class="cartao-palavra">
            <div class="palavra-en">${escapeHtml(p.palavraEn)}</div>
            <div class="palavra-pt">${escapeHtml(p.traducaoPt)}</div>
            ${frases}
          </div>
        `;
      }).join("") + `</div>`;
    }
  }

  return `<div class="indice-letras-mini">${letrasHtml}</div>${listaPalavras}`;
}

function selecionarLetraAluno(alunoId, letra) {
  const estado = estadoAlunos[alunoId];
  const abrindo = estado.letraSelecionada !== letra;
  estado.letraSelecionada = abrindo ? letra : "TODAS";

  if (abrindo) {
    marcarLetraComoVista(alunoId, letra);
  }

  renderizarListaAlunos();
}

// -------------------- ABA: RECADOS (com editar/excluir) --------------------

function montarAbaRecados(alunoId) {
  const estado = estadoAlunos[alunoId];

  const formulario = `
    <div class="caixa-mensagem" style="margin-bottom:1rem;">
      <textarea id="input-mensagem-${alunoId}" placeholder="Ex: Revise os phrasal verbs desta semana!"></textarea>
      <button class="btn btn-primario" style="margin-top:0.6em;" onclick="enviarMensagem('${alunoId}')">Enviar recado</button>
    </div>
  `;

  if (estado.mensagens.length === 0) {
    return formulario + `<p class="vazio">Nenhum recado enviado ainda.</p>`;
  }

  const lista = estado.mensagens.map((m) => {
    if (estado.mensagemEmEdicaoId === m.id) {
      return `
        <div class="mensagem-item">
          <textarea id="edicao-msg-${m.id}">${escapeHtml(m.texto)}</textarea>
          <div style="display:flex; gap:0.5em;">
            <button class="btn btn-primario" style="padding:0.4em 1em; font-size:0.85rem;"
              onclick="salvarEdicaoMensagem('${alunoId}','${m.id}')">Salvar</button>
            <button class="btn btn-secundario" style="padding:0.4em 1em; font-size:0.85rem;"
              onclick="cancelarEdicaoMensagem('${alunoId}')">Cancelar</button>
          </div>
        </div>
      `;
    }
    const data = m.criadoEm ? m.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
    return `
      <div class="mensagem-item">
        <div class="acoes-msg">
          <button onclick="editarMensagem('${alunoId}','${m.id}')">Editar</button>
          <button class="excluir" onclick="excluirMensagem('${alunoId}','${m.id}')">Excluir</button>
        </div>
        ${escapeHtml(m.texto)}<br><span class="data-msg">${escapeHtml(data)}</span>
      </div>
    `;
  }).join("");

  return formulario + lista;
}

function editarMensagem(alunoId, msgId) {
  estadoAlunos[alunoId].mensagemEmEdicaoId = msgId;
  renderizarListaAlunos();
}

function cancelarEdicaoMensagem(alunoId) {
  estadoAlunos[alunoId].mensagemEmEdicaoId = null;
  renderizarListaAlunos();
}

async function salvarEdicaoMensagem(alunoId, msgId) {
  const novoTexto = document.getElementById(`edicao-msg-${msgId}`).value.trim();
  if (!novoTexto) return;
  await db.collection("usuarios").doc(alunoId).collection("mensagens")
    .doc(msgId).update({ texto: novoTexto });
  estadoAlunos[alunoId].mensagemEmEdicaoId = null;
}

async function excluirMensagem(alunoId, msgId) {
  await db.collection("usuarios").doc(alunoId).collection("mensagens").doc(msgId).delete();
}

async function enviarMensagem(alunoId) {
  const input = document.getElementById(`input-mensagem-${alunoId}`);
  const texto = input.value.trim();
  if (!texto) return;
  await db.collection("usuarios").doc(alunoId).collection("mensagens").add({
    texto,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  input.value = "";
}

// -------------------- ABA: RELATÓRIO DE AULAS --------------------

function montarAbaRelatorio(alunoId) {
  const estado = estadoAlunos[alunoId];

  const formulario = `
    <div class="caixa-mensagem" style="margin-bottom:1rem;">
      <textarea id="input-relatorio-${alunoId}" placeholder='Ex: Na aula de hoje trabalhamos num jogo de conhecimento de palavras novas.'></textarea>
      <button class="btn btn-primario" style="margin-top:0.6em;" onclick="adicionarRelatorio('${alunoId}')">Registrar aula</button>
    </div>
  `;

  if (estado.relatorios.length === 0) {
    return formulario + `<p class="vazio">Nenhum registro de aula ainda.</p>`;
  }

  const lista = estado.relatorios.map((r) => {
    const data = r.criadoEm ? r.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
    return `
      <div class="mensagem-item">
        <div class="acoes-msg">
          <button class="excluir" onclick="excluirRelatorio('${alunoId}','${r.id}')">Excluir</button>
        </div>
        ${escapeHtml(r.texto)}<br><span class="data-msg">${escapeHtml(data)}</span>
      </div>
    `;
  }).join("");

  return formulario + lista;
}

async function adicionarRelatorio(alunoId) {
  const input = document.getElementById(`input-relatorio-${alunoId}`);
  const texto = input.value.trim();
  if (!texto) return;
  await db.collection("usuarios").doc(alunoId).collection("relatorios").add({
    texto,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });
  input.value = "";
}

async function excluirRelatorio(alunoId, relatorioId) {
  await db.collection("usuarios").doc(alunoId).collection("relatorios").doc(relatorioId).delete();
}

// -------------------- CÓDIGO DO PROFESSOR --------------------

function copiarCodigo() {
  const codigo = document.getElementById("codigo-professor").textContent;
  navigator.clipboard.writeText(codigo);
  const status = document.getElementById("status-copiar");
  status.textContent = "Copiado!";
  setTimeout(() => (status.textContent = ""), 1500);
}

// -------------------- AGENDA: DISPONIBILIDADE --------------------

// Escuta em tempo real TODAS as aulas deste professor (de todos os alunos vinculados).
// Uma coleção no nível raiz porque tanto a visão geral da agenda quanto a aba
// "Aulas marcadas" de cada aluno usam o mesmo cache, sem precisar de um listener por aluno.
function escutarAulasDoProfessor(uid) {
  db.collection("aulas").where("professorId", "==", uid)
    .onSnapshot((snap) => {
      aulasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarListaAlunos();
    });
}

async function carregarConfigAgenda() {
  const snap = await db.collection("usuarios").doc(professorIdAtual)
    .collection("configuracaoAgenda").doc("dados").get();

  configAgendaAtual = snap.exists ? snap.data() : {
    duracaoAulaMinutos: DURACAO_PADRAO_MINUTOS,
    modalidades: [],
    disponibilidade: {}
  };
}

async function abrirConfigAgenda() {
  await carregarConfigAgenda();
  preencherFormularioConfigAgenda();
  document.getElementById("modal-config-agenda").classList.remove("modal-oculto");
}

function fecharConfigAgenda() {
  document.getElementById("modal-config-agenda").classList.add("modal-oculto");
}

function preencherFormularioConfigAgenda() {
  document.getElementById("config-duracao-aula").value = String(configAgendaAtual.duracaoAulaMinutos || DURACAO_PADRAO_MINUTOS);
  document.getElementById("config-modalidade-online").checked = (configAgendaAtual.modalidades || []).includes("online");
  document.getElementById("config-modalidade-presencial").checked = (configAgendaAtual.modalidades || []).includes("presencial");
  document.getElementById("config-whatsapp").value = configAgendaAtual.whatsapp || "";

  const container = document.getElementById("config-dias-semana");
  container.innerHTML = DIAS_SEMANA.map((dia) => {
    const blocos = (configAgendaAtual.disponibilidade || {})[dia] || [];

    const periodosHtml = PERIODOS_DIA.map((periodo) => {
      const bloco = blocos.find((b) => periodoDoHorario(b.inicio) === periodo.chave);
      const ativo = !!bloco;
      const inicio = ativo ? bloco.inicio : periodo.padraoInicio;
      const fim = ativo ? bloco.fim : periodo.padraoFim;
      return `
        <div class="linha-periodo-config">
          <label class="chk-periodo-label">
            <input type="checkbox" class="chk-periodo-ativo" data-dia="${dia}" data-periodo="${periodo.chave}" ${ativo ? "checked" : ""} onchange="alternarPeriodoConfig(this)">
            ${periodo.nome}
          </label>
          <input type="time" class="input-inicio-periodo" data-dia="${dia}" data-periodo="${periodo.chave}" value="${inicio}" ${ativo ? "" : "disabled"}>
          <span>até</span>
          <input type="time" class="input-fim-periodo" data-dia="${dia}" data-periodo="${periodo.chave}" value="${fim}" ${ativo ? "" : "disabled"}>
        </div>
      `;
    }).join("");

    return `
      <div class="dia-config-grupo">
        <div class="dia-config-titulo">${NOMES_DIAS_SEMANA[dia]}</div>
        <div class="periodos-dia">${periodosHtml}</div>
      </div>
    `;
  }).join("");
}

// Habilita/desabilita os campos de horário do período conforme o checkbox dele
function alternarPeriodoConfig(checkbox) {
  const linha = checkbox.closest(".linha-periodo-config");
  linha.querySelectorAll('input[type="time"]').forEach((input) => {
    input.disabled = !checkbox.checked;
  });
}

async function salvarConfigAgenda() {
  const duracaoAulaMinutos = Number(document.getElementById("config-duracao-aula").value);

  const modalidades = [];
  if (document.getElementById("config-modalidade-online").checked) modalidades.push("online");
  if (document.getElementById("config-modalidade-presencial").checked) modalidades.push("presencial");
  if (modalidades.length === 0) {
    alert("Selecione pelo menos uma modalidade de atendimento (online ou presencial).");
    return;
  }

  const disponibilidade = {};
  let algumDiaValido = false;
  DIAS_SEMANA.forEach((dia) => {
    const blocos = [];
    PERIODOS_DIA.forEach((periodo) => {
      const chk = document.querySelector(`.chk-periodo-ativo[data-dia="${dia}"][data-periodo="${periodo.chave}"]`);
      if (chk && chk.checked) {
        const inicio = document.querySelector(`.input-inicio-periodo[data-dia="${dia}"][data-periodo="${periodo.chave}"]`).value;
        const fim = document.querySelector(`.input-fim-periodo[data-dia="${dia}"][data-periodo="${periodo.chave}"]`).value;
        if (inicio && fim && inicio < fim) blocos.push({ inicio, fim });
      }
    });
    if (blocos.length > 0) {
      disponibilidade[dia] = blocos;
      algumDiaValido = true;
    }
  });

  if (!algumDiaValido) {
    alert("Marque pelo menos um período (manhã, tarde ou noite) com um horário válido (início antes do fim).");
    return;
  }

  const whatsapp = document.getElementById("config-whatsapp").value.trim();
  const dados = { duracaoAulaMinutos, modalidades, disponibilidade, whatsapp };
  await db.collection("usuarios").doc(professorIdAtual)
    .collection("configuracaoAgenda").doc("dados").set(dados);

  configAgendaAtual = dados;
  fecharConfigAgenda();
  montarCalendarioProfessor();
}

// -------------------- AGENDA: PRÓXIMAS AULAS (todas) --------------------

function legendaModalidade(modalidade) {
  return modalidade === "online" ? "Online" : "Presencial";
}

function legendaStatusAula(status) {
  if (status === "concluida") return "Concluída";
  if (status === "cancelada") return "Cancelada";
  return "Agendada";
}

// Desenha o calendário de mês da agenda do professor: cada dia mostra se é
// dia de atendimento (conforme a disponibilidade configurada) e quantas aulas
// já estão marcadas nele. Clicar num dia abre a lista de aulas daquele dia.
function montarCalendarioProfessor() {
  const container = document.getElementById("calendario-professor");
  if (!container || !mesCalendarioProfessor) return;

  const hojeIso = dataDeHojeISO();
  const ano = mesCalendarioProfessor.getFullYear();
  const mes = mesCalendarioProfessor.getMonth();
  const primeiroDoMes = new Date(ano, mes, 1);
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const offsetInicio = primeiroDoMes.getDay();
  const disponibilidade = (configAgendaAtual && configAgendaAtual.disponibilidade) || {};
  const prefixoMes = `${ano}-${String(mes + 1).padStart(2, "0")}`;

  const contagemPorDia = {};
  aulasCache.forEach((a) => {
    if (a.status === "agendada" && a.data.startsWith(prefixoMes)) {
      contagemPorDia[a.data] = (contagemPorDia[a.data] || 0) + 1;
    }
  });

  const celulas = [];
  for (let i = 0; i < offsetInicio; i++) celulas.push(`<div class="cal-day cal-empty"></div>`);
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const dataIso = chaveDataISO(new Date(ano, mes, dia));
    const diaSemana = DIAS_SEMANA[new Date(ano, mes, dia).getDay()];
    const override = overridesAgendaCache[dataIso];
    const atende = override
      ? !override.fechado && (override.blocos || []).length > 0
      : !!(disponibilidade[diaSemana] && disponibilidade[diaSemana].length > 0);
    const passou = dataIso < hojeIso;
    const hoje = dataIso === hojeIso;
    const contagem = contagemPorDia[dataIso] || 0;
    const selecionado = dataIso === diaSelecionadoProfessor;

    const classes = ["cal-day"];
    if (passou) classes.push("is-past");
    else if (atende) classes.push("is-workday");
    else classes.push("is-off");
    if (hoje) classes.push("is-today");
    if (contagem > 0) classes.push("has-appts");
    if (override) classes.push("is-override");
    if (selecionado) classes.push("is-selected");

    celulas.push(`
      <div class="${classes.join(" ")}" data-calday="${dataIso}">
        <span class="cal-num">${dia}</span>
        ${contagem > 0 ? `<span class="cal-dot">${contagem}</span>` : ""}
      </div>
    `);
  }

  const hojeReal = new Date();
  const eMesAtual = ano === hojeReal.getFullYear() && mes === hojeReal.getMonth();

  container.innerHTML = `
    <div class="cal-wrap cal-wrap-professor">
      <div class="cal-head">
        <div class="cal-nav"><button type="button" id="btn-cal-prof-anterior" ${eMesAtual ? "disabled" : ""} aria-label="Mês anterior">&larr;</button></div>
        <div class="cal-title">${NOMES_MESES[mes]} de ${ano}</div>
        <div class="cal-nav"><button type="button" id="btn-cal-prof-proximo" aria-label="Próximo mês">&rarr;</button></div>
      </div>
      <div class="cal-dow">${NOMES_DIAS_SEMANA_CURTO.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${celulas.join("")}</div>
      <div class="cal-legend">
        <span><span class="dot dot-hoje"></span> Hoje</span>
        <span><span class="dot dot-atende"></span> Atende nesse dia</span>
        <span><span class="dot dot-tem-aula"></span> Tem aula marcada</span>
        <span><span class="dot dot-nao-atende"></span> Não atende</span>
        <span><span class="dot dot-ajustado"></span> Horário ajustado só nesse dia</span>
      </div>
    </div>
    <div id="detalhe-dia-professor"></div>
  `;

  document.getElementById("btn-cal-prof-anterior").onclick = () => {
    mesCalendarioProfessor = new Date(ano, mes - 1, 1);
    diaSelecionadoProfessor = null;
    montarCalendarioProfessor();
  };
  document.getElementById("btn-cal-prof-proximo").onclick = () => {
    mesCalendarioProfessor = new Date(ano, mes + 1, 1);
    diaSelecionadoProfessor = null;
    montarCalendarioProfessor();
  };
  container.querySelectorAll("[data-calday]").forEach((celula) => {
    celula.onclick = () => {
      const dataIso = celula.dataset.calday;
      diaSelecionadoProfessor = diaSelecionadoProfessor === dataIso ? null : dataIso;
      montarCalendarioProfessor();
    };
  });

  renderizarDetalheDiaProfessor();
}

// Lista as aulas do dia selecionado no calendário, logo abaixo da grade
function renderizarDetalheDiaProfessor() {
  const container = document.getElementById("detalhe-dia-professor");
  if (!container) return;
  if (!diaSelecionadoProfessor) { container.innerHTML = ""; return; }

  const aulasDoDia = aulasCache
    .filter((a) => a.data === diaSelecionadoProfessor && a.status !== "cancelada")
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  const corpo = aulasDoDia.length ? aulasDoDia.map((a) => `
    <div class="cartao-aula">
      <div class="aula-info">
        <strong>${escapeHtml(a.alunoNome)}</strong>
        <span>${escapeHtml(a.horaInicio)}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
        <span class="badge-status badge-status-${a.status}">${legendaStatusAula(a.status)}</span>
      </div>
      ${a.status === "agendada" ? `
        <div class="aula-acoes">
          <button class="btn btn-secundario" style="padding:0.35em 0.8em; font-size:0.8rem;" onclick="concluirAula('${a.id}')">Concluir</button>
          <button class="excluir" onclick="cancelarAulaComoProfessor('${a.id}')">Cancelar</button>
        </div>
      ` : ""}
    </div>
  `).join("") : `<p class="vazio">Nenhuma aula marcada nesse dia.</p>`;

  container.innerHTML = `
    <div class="detalhe-dia-professor-conteudo">
      <h3 style="font-size:0.95rem;">${formatarDataBR(diaSelecionadoProfessor)}</h3>
      ${corpo}
      ${montarEditorDisponibilidadeDia()}
    </div>
  `;

  const chkFechado = document.getElementById("chk-dia-fechado");
  chkFechado.onchange = () => {
    document.getElementById("periodos-dia-editor").style.display = chkFechado.checked ? "none" : "";
  };
}

// Monta o formulário que deixa o professor ajustar (ou fechar) a
// disponibilidade só do dia selecionado, sem afetar a grade semanal
// recorrente. Começa preenchido com a exceção já salva, se houver, ou
// com o horário padrão daquele dia da semana como sugestão.
function montarEditorDisponibilidadeDia() {
  const dataIso = diaSelecionadoProfessor;
  const override = overridesAgendaCache[dataIso];
  const diaSemana = chaveDiaSemana(dataIso);
  const blocosBase = override ? (override.blocos || []) : ((configAgendaAtual.disponibilidade || {})[diaSemana] || []);
  const fechado = !!(override && override.fechado);

  const periodosHtml = PERIODOS_DIA.map((periodo) => {
    const bloco = blocosBase.find((b) => periodoDoHorario(b.inicio) === periodo.chave);
    const ativo = !!bloco;
    const inicio = bloco ? bloco.inicio : periodo.padraoInicio;
    const fim = bloco ? bloco.fim : periodo.padraoFim;
    return `
      <div class="linha-periodo-config">
        <label class="chk-periodo-label">
          <input type="checkbox" class="chk-periodo-dia-ativo" data-periodo="${periodo.chave}" ${ativo ? "checked" : ""} onchange="alternarPeriodoConfig(this)">
          ${periodo.nome}
        </label>
        <input type="time" class="input-inicio-periodo-dia" data-periodo="${periodo.chave}" value="${inicio}" ${ativo ? "" : "disabled"}>
        <span>até</span>
        <input type="time" class="input-fim-periodo-dia" data-periodo="${periodo.chave}" value="${fim}" ${ativo ? "" : "disabled"}>
      </div>
    `;
  }).join("");

  return `
    <div class="editor-dia-professor">
      <h4 style="font-size:0.85rem; margin:0 0 0.6rem;">Ajustar disponibilidade só desse dia</h4>
      <label class="chk-periodo-label" style="margin-bottom:0.7rem;">
        <input type="checkbox" id="chk-dia-fechado" ${fechado ? "checked" : ""}>
        Fechado nesse dia (sem atendimento)
      </label>
      <div id="periodos-dia-editor" class="periodos-dia" ${fechado ? 'style="display:none;"' : ""}>${periodosHtml}</div>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.8rem;">
        <button type="button" class="btn btn-primario" style="padding:0.4em 0.9em; font-size:0.85rem;" onclick="salvarOverrideDia()">Salvar horário desse dia</button>
        ${override ? `<button type="button" class="btn btn-secundario" style="padding:0.4em 0.9em; font-size:0.85rem;" onclick="restaurarOverrideDia()">Restaurar horário padrão</button>` : ""}
      </div>
    </div>
  `;
}

async function salvarOverrideDia() {
  const dataIso = diaSelecionadoProfessor;
  const fechado = document.getElementById("chk-dia-fechado").checked;
  const blocos = [];

  if (!fechado) {
    PERIODOS_DIA.forEach((periodo) => {
      const chk = document.querySelector(`.chk-periodo-dia-ativo[data-periodo="${periodo.chave}"]`);
      if (chk && chk.checked) {
        const inicio = document.querySelector(`.input-inicio-periodo-dia[data-periodo="${periodo.chave}"]`).value;
        const fim = document.querySelector(`.input-fim-periodo-dia[data-periodo="${periodo.chave}"]`).value;
        if (inicio && fim && inicio < fim) blocos.push({ inicio, fim });
      }
    });
    if (blocos.length === 0) {
      alert('Marque pelo menos um período com horário válido, ou marque "Fechado nesse dia".');
      return;
    }
  }

  await db.collection("usuarios").doc(professorIdAtual)
    .collection("agendaOverrides").doc(dataIso).set({ fechado, blocos });
}

async function restaurarOverrideDia() {
  if (!confirm("Restaurar o horário padrão desse dia? Isso remove o ajuste feito só pra ele.")) return;
  await db.collection("usuarios").doc(professorIdAtual)
    .collection("agendaOverrides").doc(diaSelecionadoProfessor).delete();
}

async function cancelarAulaComoProfessor(aulaId) {
  if (!confirm("Cancelar essa aula? O aluno vai poder marcar outro horário nesse mesmo lugar.")) return;
  await db.collection("aulas").doc(aulaId).update({ status: "cancelada", canceladoPor: "professor" });
}

async function concluirAula(aulaId) {
  await db.collection("aulas").doc(aulaId).update({ status: "concluida" });
}

// -------------------- ABA: AULAS MARCADAS (por aluno) --------------------

function montarAbaAulas(alunoId) {
  const aulasDoAluno = aulasCache
    .filter((a) => a.alunoId === alunoId)
    .sort((a, b) => (b.data + b.horaInicio).localeCompare(a.data + a.horaInicio)); // mais recente primeiro

  if (aulasDoAluno.length === 0) {
    return `<p class="vazio">Nenhuma aula marcada com este aluno ainda.</p>`;
  }

  return aulasDoAluno.map((a) => `
    <div class="cartao-aula">
      <div class="aula-info">
        <span>${formatarDataBR(a.data)} às ${escapeHtml(a.horaInicio)}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
        <span class="badge-status badge-status-${a.status}">${legendaStatusAula(a.status)}</span>
      </div>
      ${a.status === "agendada" ? `
        <div class="aula-acoes">
          <button class="btn btn-secundario" style="padding:0.35em 0.8em; font-size:0.8rem;" onclick="concluirAula('${a.id}')">Concluir</button>
          <button class="excluir" onclick="cancelarAulaComoProfessor('${a.id}')">Cancelar</button>
        </div>
      ` : ""}
    </div>
  `).join("");
}
