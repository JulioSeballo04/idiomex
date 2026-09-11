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
const DURACAO_PADRAO_MINUTOS = 50;

exigirLogin("professor");

auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  professorIdAtual = user.uid;
  const perfil = (await db.collection("usuarios").doc(user.uid).get()).data();
  document.getElementById("nome-usuario").textContent = perfil.nome;
  document.getElementById("codigo-professor").textContent = perfil.codigoProfessor;
  carregarAlunos(user.uid);
  escutarAulasDoProfessor(user.uid);
});

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
  renderizarProximasAulas();

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

async function abrirConfigAgenda() {
  const snap = await db.collection("usuarios").doc(professorIdAtual)
    .collection("configuracaoAgenda").doc("dados").get();

  configAgendaAtual = snap.exists ? snap.data() : {
    duracaoAulaMinutos: DURACAO_PADRAO_MINUTOS,
    modalidades: [],
    disponibilidade: {}
  };

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

  const container = document.getElementById("config-dias-semana");
  container.innerHTML = DIAS_SEMANA.map((dia) => {
    const bloco = (configAgendaAtual.disponibilidade || {})[dia];
    const ativo = !!(bloco && bloco.length > 0);
    const inicio = ativo ? bloco[0].inicio : "08:00";
    const fim = ativo ? bloco[0].fim : "12:00";
    return `
      <div class="linha-dia-config">
        <label class="chk-dia-label">
          <input type="checkbox" class="chk-dia-ativo" data-dia="${dia}" ${ativo ? "checked" : ""}>
          ${NOMES_DIAS_SEMANA[dia]}
        </label>
        <input type="time" class="input-inicio-dia" data-dia="${dia}" value="${inicio}">
        <span>até</span>
        <input type="time" class="input-fim-dia" data-dia="${dia}" value="${fim}">
      </div>
    `;
  }).join("");
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
    const chk = document.querySelector(`.chk-dia-ativo[data-dia="${dia}"]`);
    if (chk && chk.checked) {
      const inicio = document.querySelector(`.input-inicio-dia[data-dia="${dia}"]`).value;
      const fim = document.querySelector(`.input-fim-dia[data-dia="${dia}"]`).value;
      if (inicio && fim && inicio < fim) {
        disponibilidade[dia] = [{ inicio, fim }];
        algumDiaValido = true;
      }
    }
  });

  if (!algumDiaValido) {
    alert("Marque pelo menos um dia da semana com um horário válido (início antes do fim).");
    return;
  }

  const dados = { duracaoAulaMinutos, modalidades, disponibilidade };
  await db.collection("usuarios").doc(professorIdAtual)
    .collection("configuracaoAgenda").doc("dados").set(dados);

  configAgendaAtual = dados;
  fecharConfigAgenda();
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

function renderizarProximasAulas() {
  const container = document.getElementById("lista-proximas-aulas");
  if (!container) return;

  const hojeIso = dataDeHojeISO();
  const futuras = aulasCache
    .filter((a) => a.status === "agendada" && a.data >= hojeIso)
    .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));

  if (futuras.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhuma aula marcada ainda. Configure sua disponibilidade acima para que os alunos possam agendar.</p>`;
    return;
  }

  container.innerHTML = futuras.map((a) => `
    <div class="cartao-aula">
      <div class="aula-info">
        <strong>${escapeHtml(a.alunoNome)}</strong>
        <span>${formatarDataBR(a.data)} às ${escapeHtml(a.horaInicio)}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
      </div>
      <div class="aula-acoes">
        <button class="btn btn-secundario" style="padding:0.35em 0.8em; font-size:0.8rem;" onclick="concluirAula('${a.id}')">Concluir</button>
        <button class="excluir" onclick="cancelarAulaComoProfessor('${a.id}')">Cancelar</button>
      </div>
    </div>
  `).join("");
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
