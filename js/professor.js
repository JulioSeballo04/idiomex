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
let anotacoesAgendaCache = {}; // {docId: {tipo:"dia"|"aula", data, texto}} — registros privados do professor
let rascunhosAnotacoes = {}; // {docId: texto digitado e ainda não salvo} — sobrevive aos re-renders em tempo real
let ultimaAssinaturaAnotacoes = null; // "snapshot" das anotações do dia na última vez que os campos foram (re)montados
let diaEditorRenderizadoPara = null; // último dia pra quem o editor de disponibilidade foi montado
let ultimaAssinaturaEditor = null; // "snapshot" do override desse dia na última vez que o editor foi (re)montado

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
  escutarAnotacoesAgenda(user.uid);
  montarCalendarioProfessor();
});

// Anotações privadas do professor sobre os dias e as aulas da agenda.
// Doc id = "AAAA-MM-DD" (anotação do dia) ou o id da aula (anotação da aula).
function escutarAnotacoesAgenda(uid) {
  db.collection("usuarios").doc(uid).collection("anotacoesAgenda")
    .onSnapshot(
      (snap) => {
        anotacoesAgendaCache = {};
        snap.docs.forEach((d) => { anotacoesAgendaCache[d.id] = d.data(); });
        montarCalendarioProfessor();
      },
      (erro) => console.warn("Não foi possível carregar as anotações da agenda:", erro)
    );
}

// Exceções pontuais de disponibilidade (fechar um dia, ou ajustar o horário
// só dele) — além da grade semanal recorrente configurada acima.
function escutarOverridesAgenda(uid) {
  db.collection("usuarios").doc(uid).collection("agendaOverrides")
    .onSnapshot(
      (snap) => {
        overridesAgendaCache = {};
        snap.docs.forEach((d) => { overridesAgendaCache[d.id] = d.data(); });
        montarCalendarioProfessor();
      },
      (erro) => console.warn("Não foi possível carregar as exceções de disponibilidade:", erro)
    );
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

// Desliga os listeners e apaga o estado em memória de alunos que não aparecem
// mais na lista (ex: o professor removeu o vínculo) — sem isso, o listener de
// palavras continuaria registrado apontando pra um aluno que o professor não
// tem mais permissão de ler, sem nenhum efeito além de ficar ocupando memória.
function limparEstadosDeAlunosRemovidos(idsAtuais) {
  const idsAtuaisSet = new Set(idsAtuais);
  Object.keys(estadoAlunos).forEach((alunoId) => {
    if (idsAtuaisSet.has(alunoId)) return;
    desativarListenersDetalheAluno(alunoId);
    const estado = estadoAlunos[alunoId];
    if (estado.unsubPalavras) estado.unsubPalavras();
    delete estadoAlunos[alunoId];
  });
}

function carregarAlunos(professorId) {
  db.collection("usuarios")
    .where("tipo", "==", "aluno")
    .where("professorId", "==", professorId)
    .onSnapshot(async (snapshot) => {
      if (snapshot.empty) {
        alunosCache = [];
        limparEstadosDeAlunosRemovidos([]);
        document.getElementById("lista-alunos").innerHTML =
          `<p class="vazio">Nenhum aluno vinculado ainda. Compartilhe seu código acima.</p>`;
        return;
      }

      alunosCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      limparEstadosDeAlunosRemovidos(alunosCache.map((a) => a.id));

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
    }, (erro) => {
      // Sem isso, uma falha aqui (ex: regras do Firestore desatualizadas) deixava a
      // lista de alunos simplesmente vazia, sem nenhuma pista do que aconteceu —
      // de longe o jeito mais confuso de "sumir" com os alunos vinculados.
      console.error("Não foi possível carregar os alunos vinculados:", erro);
      document.getElementById("lista-alunos").innerHTML =
        `<p class="vazio">Não foi possível carregar seus alunos agora (erro: ${escapeHtml(erro.code || erro.message)}). Recarregue a página; se persistir, confira se as regras do Firestore estão publicadas.</p>`;
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
        <button class="btn-remover-aluno" type="button" title="Remover aluno" onclick="event.stopPropagation(); removerAlunoDoProfessor('${aluno.id}')">✕</button>
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

// Desvincula o aluno (zera o professorId dele) — o aluno continua com a conta e
// o vocabulário dele intactos, só perde o vínculo com este professor e
// precisaria do código de novo pra se reconectar. Não apaga histórico de aulas.
async function removerAlunoDoProfessor(alunoId) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  const nome = aluno ? aluno.nome : "esse aluno";
  if (!confirm(`Remover ${nome} da sua lista de alunos?\n\nVocê deixa de ver o vocabulário, recados e relatórios dele(a). O aluno mantém a conta e precisaria digitar seu código de novo pra se vincular novamente.`)) return;

  try {
    await db.collection("usuarios").doc(alunoId).update({ professorId: firebase.firestore.FieldValue.delete() });
  } catch (e) {
    alert("Não foi possível remover esse aluno agora. Tente novamente em instantes.");
    console.error(e);
  }
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

  return montarContatoAluno(alunoId) + abas + conteudo;
}

// Linha de contato do aluno (telefone/e-mail que ele preencheu no perfil)
function montarContatoAluno(alunoId) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return "";
  const email = aluno.emailContato || aluno.email || "";
  const partes = [];
  if (aluno.telefone) {
    const link = linkWhatsapp(aluno.telefone, `Olá ${aluno.nome}! Tudo bem?`);
    partes.push(`<span>📱 ${escapeHtml(aluno.telefone)}${link ? ` — <a href="${link}" target="_blank" rel="noopener">Chamar no WhatsApp</a>` : ""}</span>`);
  } else {
    partes.push(`<span>📱 Telefone não informado pelo aluno</span>`);
  }
  if (email) partes.push(`<span>✉️ ${escapeHtml(email)}</span>`);
  return `<div class="contato-aluno">${partes.join("")}</div>`;
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
  const diasComNota = new Set(
    Object.values(anotacoesAgendaCache).filter((n) => n.texto && n.data).map((n) => n.data)
  );

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
    const temNota = diasComNota.has(dataIso);

    celulas.push(`
      <div class="${classes.join(" ")}" data-calday="${dataIso}">
        <span class="cal-num">${dia}</span>
        ${contagem > 0 ? `<span class="cal-dot">${contagem}</span>` : ""}
        ${temNota ? `<span class="cal-nota" title="Tem anotação">✎</span>` : ""}
      </div>
    `);
  }

  const hojeReal = new Date();
  const eMesAtual = ano === hojeReal.getFullYear() && mes === hojeReal.getMonth();

  // Estrutura fixa criada só uma vez: a grade do mês e o painel de detalhe do
  // dia vivem em containers IRMÃOS independentes. Se cada re-render (aula
  // nova chegando, etc.) recriasse os dois juntos, o editor de disponibilidade
  // dentro do painel de detalhe perderia qualquer edição ainda não salva toda
  // vez que algo não relacionado a ele mudasse.
  if (!document.getElementById("grade-calendario-professor")) {
    container.innerHTML = `
      <div id="grade-calendario-professor"></div>
      <div id="detalhe-dia-professor"></div>
    `;
  }

  document.getElementById("grade-calendario-professor").innerHTML = `
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
        <span><span class="legenda-nota">✎</span> Tem anotação</span>
      </div>
    </div>
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
  document.querySelectorAll("#grade-calendario-professor [data-calday]").forEach((celula) => {
    celula.onclick = () => {
      const dataIso = celula.dataset.calday;
      diaSelecionadoProfessor = diaSelecionadoProfessor === dataIso ? null : dataIso;
      montarCalendarioProfessor();
    };
  });

  renderizarDetalheDiaProfessor();
}

// "Fingerprint" do override salvo de um dia — usado só pra saber se o editor
// precisa ser reconstruído, não pra decidir disponibilidade.
function assinaturaOverride(dataIso) {
  return JSON.stringify(overridesAgendaCache[dataIso] || null);
}

// Lista as aulas do dia selecionado no calendário, e o editor de disponibilidade
// logo abaixo. Os dois são atualizados de forma independente: a lista de aulas
// pode mudar em tempo real a qualquer momento (outro aluno marcando/cancelando
// aula), mas isso não pode apagar um ajuste de horário que o professor ainda
// esteja digitando e não salvou — por isso o editor só é reconstruído quando o
// dia selecionado muda ou quando o override salvo dele muda de verdade.
function renderizarDetalheDiaProfessor() {
  const container = document.getElementById("detalhe-dia-professor");
  if (!container) return;
  if (!diaSelecionadoProfessor) {
    container.innerHTML = "";
    diaEditorRenderizadoPara = null;
    return;
  }

  const mudouDeDia = diaEditorRenderizadoPara !== diaSelecionadoProfessor
    || !document.getElementById("lista-aulas-dia-professor");
  if (mudouDeDia) {
    container.innerHTML = `
      <div class="detalhe-dia-professor-conteudo">
        <h3 id="titulo-dia-professor" style="font-size:0.95rem;"></h3>
        <div id="lista-aulas-dia-professor"></div>
        <div id="anotacoes-dia-wrap"></div>
        <div id="editor-dia-professor-wrap"></div>
      </div>
    `;
    ultimaAssinaturaAnotacoes = null;
  }

  document.getElementById("titulo-dia-professor").textContent = formatarDataBR(diaSelecionadoProfessor);
  document.getElementById("lista-aulas-dia-professor").innerHTML = montarListaAulasDia(diaSelecionadoProfessor);

  // Anotações: só reconstrói quando muda o conjunto de aulas do dia ou algo salvo;
  // o que está digitado e não salvo é preservado em rascunhosAnotacoes.
  const assinaturaNotas = assinaturaAnotacoesDia(diaSelecionadoProfessor);
  if (assinaturaNotas !== ultimaAssinaturaAnotacoes) {
    document.getElementById("anotacoes-dia-wrap").innerHTML = montarAnotacoesDia(diaSelecionadoProfessor);
    ultimaAssinaturaAnotacoes = assinaturaNotas;
  }

  const assinaturaAtual = assinaturaOverride(diaSelecionadoProfessor);
  if (mudouDeDia || assinaturaAtual !== ultimaAssinaturaEditor) {
    document.getElementById("editor-dia-professor-wrap").innerHTML = montarEditorDisponibilidadeDia();
    const chkFechado = document.getElementById("chk-dia-fechado");
    chkFechado.onchange = () => {
      document.getElementById("periodos-dia-editor").style.display = chkFechado.checked ? "none" : "";
    };
    ultimaAssinaturaEditor = assinaturaAtual;
  }

  diaEditorRenderizadoPara = diaSelecionadoProfessor;
}

function aulasAtivasDoDia(dataIso) {
  return aulasCache
    .filter((a) => a.data === dataIso && a.status !== "cancelada")
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
}

// Muda quando as aulas do dia mudam ou quando uma anotação salva daquele dia muda
function assinaturaAnotacoesDia(dataIso) {
  const ids = [dataIso, ...aulasAtivasDoDia(dataIso).map((a) => a.id)];
  return JSON.stringify(ids.map((id) => [id, (anotacoesAgendaCache[id] || {}).texto || ""]));
}

// Campos de anotação do dia: uma anotação geral do dia + uma por aula marcada
function montarAnotacoesDia(dataIso) {
  const campo = (id, rotulo) => {
    const salvo = (anotacoesAgendaCache[id] || {}).texto || "";
    const texto = rascunhosAnotacoes[id] !== undefined ? rascunhosAnotacoes[id] : salvo;
    return `
      <div class="campo-anotacao-agenda">
        <label for="nota-${escapeHtml(id)}">${rotulo}</label>
        <textarea id="nota-${escapeHtml(id)}" data-nota-id="${escapeHtml(id)}" placeholder="Registre o que foi trabalhado, combinados, lembretes...">${escapeHtml(texto)}</textarea>
      </div>
    `;
  };

  const porAula = aulasAtivasDoDia(dataIso).map((a) =>
    campo(a.id, `Aula das ${escapeHtml(a.horaInicio)} — ${escapeHtml(a.alunoNome)}`)
  ).join("");

  return `
    <div class="anotacoes-dia-professor" oninput="registrarRascunhoAnotacao(event)">
      <h4 style="font-size:0.85rem; margin:0 0 0.6rem;">Anotações (só você vê)</h4>
      ${campo(dataIso, "Anotações do dia")}
      ${porAula}
      <button type="button" class="btn btn-primario" style="padding:0.4em 0.9em; font-size:0.85rem;" onclick="salvarAnotacoesDia()">Salvar anotações</button>
    </div>
  `;
}

function registrarRascunhoAnotacao(evento) {
  const alvo = evento.target;
  if (alvo && alvo.dataset && alvo.dataset.notaId) {
    rascunhosAnotacoes[alvo.dataset.notaId] = alvo.value;
  }
}

async function salvarAnotacoesDia() {
  const dataIso = diaSelecionadoProfessor;
  if (!dataIso) return;
  const colecao = db.collection("usuarios").doc(professorIdAtual).collection("anotacoesAgenda");
  const lote = db.batch();
  const idsAulas = new Set(aulasAtivasDoDia(dataIso).map((a) => a.id));
  let alteradas = 0;

  document.querySelectorAll("#anotacoes-dia-wrap textarea[data-nota-id]").forEach((campo) => {
    const id = campo.dataset.notaId;
    const texto = campo.value.trim();
    const salvo = (anotacoesAgendaCache[id] || {}).texto || "";
    if (texto === salvo) { delete rascunhosAnotacoes[id]; return; }
    alteradas++;
    if (!texto) {
      lote.delete(colecao.doc(id));
    } else {
      lote.set(colecao.doc(id), {
        tipo: idsAulas.has(id) ? "aula" : "dia",
        data: dataIso,
        texto,
        atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  });

  if (alteradas === 0) return;
  try {
    await lote.commit();
    // limpa os rascunhos só depois de salvar; o listener em tempo real reconstrói os campos
    document.querySelectorAll("#anotacoes-dia-wrap textarea[data-nota-id]").forEach((campo) => {
      delete rascunhosAnotacoes[campo.dataset.notaId];
    });
  } catch (e) {
    alert("Não foi possível salvar as anotações. Tente novamente em instantes.");
    console.error(e);
  }
}

function montarListaAulasDia(dataIso) {
  const aulasDoDia = aulasCache
    .filter((a) => a.data === dataIso && a.status !== "cancelada")
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  if (aulasDoDia.length === 0) return `<p class="vazio">Nenhuma aula marcada nesse dia.</p>`;

  return aulasDoDia.map((a) => `
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
  `).join("");
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

  // Sem exceção salva, sugere as modalidades da configuração geral
  const modalidadesBase = (override && override.modalidades && override.modalidades.length)
    ? override.modalidades
    : (configAgendaAtual.modalidades || []);
  const modalidadesHtml = `
    <div class="modalidades-dia-editor">
      <span class="rotulo-modalidades-dia">Atendimento nesse dia:</span>
      <label><input type="checkbox" class="chk-modalidade-dia" value="online" ${modalidadesBase.includes("online") ? "checked" : ""}> Online</label>
      <label><input type="checkbox" class="chk-modalidade-dia" value="presencial" ${modalidadesBase.includes("presencial") ? "checked" : ""}> Presencial</label>
    </div>
  `;

  return `
    <div class="editor-dia-professor">
      <h4 style="font-size:0.85rem; margin:0 0 0.6rem;">Ajustar disponibilidade só desse dia</h4>
      <label class="chk-periodo-label" style="margin-bottom:0.7rem;">
        <input type="checkbox" id="chk-dia-fechado" ${fechado ? "checked" : ""}>
        Fechado nesse dia (sem atendimento)
      </label>
      <div id="periodos-dia-editor" class="periodos-dia" ${fechado ? 'style="display:none;"' : ""}>${periodosHtml}${modalidadesHtml}</div>
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
  let modalidades = [];

  if (!fechado) {
    modalidades = Array.from(document.querySelectorAll(".chk-modalidade-dia:checked")).map((c) => c.value);
    if (modalidades.length === 0) {
      alert("Marque pelo menos uma modalidade (online ou presencial) pra esse dia.");
      return;
    }
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

  try {
    await db.collection("usuarios").doc(professorIdAtual)
      .collection("agendaOverrides").doc(dataIso).set({ fechado, blocos, modalidades });
  } catch (e) {
    alert("Não foi possível salvar o ajuste desse dia. Tente novamente em instantes.");
    console.error(e);
  }
}

async function restaurarOverrideDia() {
  if (!confirm("Restaurar o horário padrão desse dia? Isso remove o ajuste feito só pra ele.")) return;
  try {
    await db.collection("usuarios").doc(professorIdAtual)
      .collection("agendaOverrides").doc(diaSelecionadoProfessor).delete();
  } catch (e) {
    alert("Não foi possível restaurar o horário padrão. Tente novamente em instantes.");
    console.error(e);
  }
}

function mensagemCancelamentoPeloProfessor(aula, nomeAluno) {
  return `Olá ${nomeAluno}! Infelizmente precisei cancelar sua aula:\n` +
    `Data: ${formatarDataBR(aula.data)}\n` +
    `Horário: ${aula.horaInicio}\n` +
    "Vamos combinar um novo horário quando for melhor pra você. Desculpa o transtorno!";
}

async function cancelarAulaComoProfessor(aulaId) {
  if (!confirm("Cancelar essa aula? O aluno vai poder marcar outro horário nesse mesmo lugar.")) return;

  // Se o aluno cadastrou telefone no perfil, abre o WhatsApp já com o aviso pronto.
  // A aba é aberta antes do await (senão o celular bloqueia o popup).
  const aula = aulasCache.find((a) => a.id === aulaId);
  const aluno = aula && alunosCache.find((a) => a.id === aula.alunoId);
  const link = aluno && aluno.telefone
    ? linkWhatsapp(aluno.telefone, mensagemCancelamentoPeloProfessor(aula, aluno.nome))
    : null;
  const abaWhatsapp = link ? window.open("", "_blank") : null;

  try {
    await db.collection("aulas").doc(aulaId).update({ status: "cancelada", canceladoPor: "professor" });
    if (abaWhatsapp) abaWhatsapp.location = link;
  } catch (e) {
    if (abaWhatsapp) abaWhatsapp.close();
    alert("Não foi possível cancelar a aula agora. Tente novamente em instantes.");
    console.error(e);
  }
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
