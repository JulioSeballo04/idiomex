// ============================================================
// PAINEL DO PROFESSOR
// ============================================================
// Cada aluno é um bloco de "acordeão": clica para abrir/fechar.
// Dentro do bloco, abas: Vocabulário (por letra), Recados,
// Relatório de aulas, Aulas marcadas e Sala de aula. O sistema guarda, por aluno e por letra,
// a última vez que o professor abriu aquela letra — o destaque
// de "novidade" (bolinha âmbar) some só na letra clicada, não
// no aluno inteiro.
// ============================================================

let professorIdAtual = null;
let alunosCache = []; // [{id, nome, ...}]
const estadoAlunos = {}; // por alunoId: ver garantirEstado()
let aulasCache = []; // todas as aulas (de todos os alunos) deste professor
let alunosSemAppCache = []; // alunos cadastrados pelo professor, que não usam o app
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
  garantirCodigoNoIndice(user.uid, perfil.codigoProfessor);
  prepararSeletorIdioma(perfil);

  const hoje = new Date();
  mesCalendarioProfessor = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  await carregarConfigAgenda();

  carregarAlunos(user.uid);
  escutarAlunosSemApp(user.uid);
  escutarAulasDoProfessor(user.uid);
  escutarOverridesAgenda(user.uid);
  escutarAnotacoesAgenda(user.uid);
  montarCalendarioProfessor();
});

// Contas criadas antes do índice "codigosProfessor" ainda não têm o código lá — e,
// sem ele, novos alunos não conseguem usar o código. Cria a entrada na primeira
// vez que o professor abre o painel.
async function garantirCodigoNoIndice(uid, codigo) {
  if (!codigo) return;
  try {
    const ref = db.collection("codigosProfessor").doc(codigo);
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({ professorId: uid });
    } else if (doc.data().professorId !== uid) {
      console.error("O código", codigo, "está registrado para outra conta.");
    }
  } catch (e) {
    console.warn("Não foi possível registrar o código do professor:", e);
  }
}

// Idiomas que o professor ensina (guardados em usuarios/{uid}.idiomas; contas antigas,
// com o campo único "idioma" ou sem nada, aparecem só com esse idioma / Inglês)
let idiomasAtuaisProfessor = [IDIOMA_PADRAO];

// Idioma do aluno sem app no cadastro: só aparece quando o professor ensina mais de um
function preencherIdiomaSemApp() {
  const seletor = document.getElementById("input-idioma-sem-app");
  if (!seletor) return;
  seletor.innerHTML = idiomasAtuaisProfessor.map((id) => `<option value="${id}">${IDIOMAS[id].nome}</option>`).join("");
  seletor.hidden = idiomasAtuaisProfessor.length < 2;
}

function prepararSeletorIdioma(perfil) {
  idiomasAtuaisProfessor = idiomasDoPerfil(perfil);
  preencherIdiomaSemApp();
  document.getElementById("grupo-idiomas-professor").innerHTML = Object.keys(IDIOMAS).map((id) => `
    <label class="opcao-idioma">
      <input type="checkbox" value="${id}" ${idiomasAtuaisProfessor.includes(id) ? "checked" : ""} onchange="alterarIdiomasProfessor()">
      ${IDIOMAS[id].nome}
    </label>
  `).join("");
}

async function alterarIdiomasProfessor() {
  const marcados = Array.from(document.querySelectorAll("#grupo-idiomas-professor input:checked")).map((c) => c.value);
  if (marcados.length === 0) {
    alert("Deixe pelo menos um idioma marcado.");
    prepararSeletorIdioma({ idiomas: idiomasAtuaisProfessor }); // desfaz o desmarcar
    return;
  }

  const status = document.getElementById("status-idioma");
  try {
    // "idioma" (o primeiro) segue junto pra compatibilidade com o formato antigo
    await db.collection("usuarios").doc(professorIdAtual).update({ idiomas: marcados, idioma: marcados[0] });
    idiomasAtuaisProfessor = marcados;
    preencherIdiomaSemApp();
    renderizarListaAlunos();
    renderizarAlunosSemApp();
    status.textContent = "Salvo!";
    setTimeout(() => (status.textContent = ""), 1500);
  } catch (e) {
    console.error(e);
    prepararSeletorIdioma({ idiomas: idiomasAtuaisProfessor });
    alert("Não foi possível salvar os idiomas agora. Tente novamente em instantes.");
  }
}

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
      abaAtiva: "vocabulario",       // vocabulario | recados | relatorio | aulas | sala
      letraSelecionada: "TODAS",
      idiomaFiltro: null,            // idioma do vocabulário em exibição (só importa se o aluno estuda mais de um)
      palavras: [],
      mensagens: [],
      relatorios: [],
      linkAula: null,                // {url, professorId} do doc salaDeAula/link
      documentosAula: [],
      notasDocumentoAbertas: new Set(), // ids dos documentos com o bloco de anotações aberto
      buscaDocumentos: "",
      limiteDocumentos: DOCUMENTOS_POR_PAGINA,
      unsubPalavras: null,
      unsubMensagens: null,
      unsubRelatorios: null,
      unsubLinkAula: null,
      unsubDocumentosAula: null,
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
    [...LETRAS_A_Z, "#"].forEach((l) => { letras[l] = agora; });
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
    // FieldPath explícito: a letra "#" não é aceita num caminho "letras.#" em texto
    .doc(alunoId).update(new firebase.firestore.FieldPath("letras", letra), agora);
}

// Verifica, letra por letra, quais têm palavra criada depois da última vez que foi vista
function calcularNovidades(alunoId) {
  const estado = estadoAlunos[alunoId];
  if (!estado.letrasVistas) return;

  const letrasNovas = new Set();

  estado.palavras.forEach((p) => {
    const letra = letraInicial(p.palavraEn);
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
        <div class="metrica-label">${alunosCache.length === 1 ? "aluno vinculado" : "alunos vinculados"}</div>
      </div>
      <div class="cartao-metrica">
        <div class="metrica-numero">${totalPalavras}</div>
        <div class="metrica-label">${totalPalavras === 1 ? "palavra no total" : "palavras no total"}</div>
      </div>
      ${alunosCache.length > 1 ? `
        <div class="cartao-metrica">
          <div class="metrica-numero metrica-numero-nome">${maisAtivo && maisAtivo.qtd > 0 ? escapeHtml(maisAtivo.nome) : "—"}</div>
          <div class="metrica-label">aluno mais ativo</div>
        </div>
      ` : ""}
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

  // A lista é redesenhada a cada atualização em tempo real (palavra nova de qualquer
  // aluno, aula marcada...) — preserva o recado/relatório que estiver sendo digitado
  const lista = document.getElementById("lista-alunos");
  redesenharPreservandoCampos(lista, () => desenharListaAlunos(lista));
}

function desenharListaAlunos(lista) {
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

  const salaRef = db.collection("usuarios").doc(alunoId);
  if (!estado.unsubLinkAula) {
    estado.unsubLinkAula = salaRef.collection("salaDeAula").doc("link")
      .onSnapshot((snap) => {
        estado.linkAula = snap.exists ? snap.data() : null;
        if (estado.aberto) renderizarListaAlunos();
      });
  }

  if (!estado.unsubDocumentosAula) {
    estado.unsubDocumentosAula = salaRef.collection("documentosAula")
      .orderBy("criadoEm", "desc")
      .onSnapshot((snap) => {
        estado.documentosAula = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (estado.aberto) renderizarListaAlunos();
      });
  }
}

function desativarListenersDetalheAluno(alunoId) {
  const estado = estadoAlunos[alunoId];
  if (estado.unsubMensagens) { estado.unsubMensagens(); estado.unsubMensagens = null; }
  if (estado.unsubRelatorios) { estado.unsubRelatorios(); estado.unsubRelatorios = null; }
  if (estado.unsubLinkAula) { estado.unsubLinkAula(); estado.unsubLinkAula = null; }
  if (estado.unsubDocumentosAula) { estado.unsubDocumentosAula(); estado.unsubDocumentosAula = null; }
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
      <button class="aba-detalhe ${estado.abaAtiva === "sala" ? "ativa" : ""}"
        onclick="mudarAbaAluno('${alunoId}','sala')">Sala de aula</button>
    </div>
  `;

  let conteudo;
  if (estado.abaAtiva === "recados") conteudo = montarAbaRecados(alunoId);
  else if (estado.abaAtiva === "relatorio") conteudo = montarAbaRelatorio(alunoId);
  else if (estado.abaAtiva === "aulas") conteudo = montarAbaAulas(alunoId);
  else if (estado.abaAtiva === "sala") conteudo = montarAbaSalaDeAula(alunoId);
  else conteudo = montarAbaVocabulario(alunoId);

  return montarContatoAluno(alunoId) + montarPlanoAluno(alunoId) + abas + conteudo;
}

// -------------------- PLANO DO ALUNO (aulas por semana e reposições) --------------------

// Um plano por idioma que o professor ensina: cada idioma tem as próprias aulas
// por semana e os próprios créditos de reposição
function planoNoIdioma(aluno, idioma) {
  return planoDoAluno(aluno, professorIdAtual, idioma, idiomasAtuaisProfessor[0]);
}

function montarPlanoAluno(alunoId) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return "";
  const aulasDoAluno = aulasCache.filter((a) => a.alunoId === alunoId);
  const varios = idiomasAtuaisProfessor.length > 1;
  const linhas = idiomasAtuaisProfessor.map((idioma) => {
    const plano = planoNoIdioma(aluno, idioma);
    const saldo = saldoReposicoes(plano, aulasDoAluno, professorIdAtual, idioma);
    const usadas = reposicoesUsadas(aulasDoAluno, professorIdAtual, idioma);
    const nestaSemana = aulasNaSemana(aulasDoAluno, professorIdAtual, dataDeHojeISO(), idioma);
    const opcoes = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
      `<option value="${n}" ${n === plano.aulasPorSemana ? "selected" : ""}>${n === 0 ? "Sem limite" : n}</option>`).join("");
    return `
      <div class="plano-idioma" data-idioma="${idioma}">
        ${varios ? `<span class="badge-idioma" style="background:${IDIOMAS[idioma].cor}">${IDIOMAS[idioma].nome}</span>` : ""}
        <div class="campos-plano-idioma">
          <label class="campo-plano">Aulas por semana
            <select onchange="definirAulasPorSemana('${alunoId}', '${idioma}', this.value)">${opcoes}</select>
          </label>
          <div class="campo-plano">
            <span>Reposições disponíveis</span>
            <div class="contador-reposicoes">
              <button type="button" class="btn-contador" aria-label="Tirar 1 reposição" onclick="ajustarReposicoes('${alunoId}', '${idioma}', -1)" ${saldo === 0 ? "disabled" : ""}>−</button>
              <strong class="saldo-reposicoes">${saldo}</strong>
              <button type="button" class="btn-contador" aria-label="Dar 1 reposição" onclick="ajustarReposicoes('${alunoId}', '${idioma}', 1)">+</button>
            </div>
          </div>
        </div>
        <p class="dica-plano">Nesta semana: ${nestaSemana}${plano.aulasPorSemana ? ` de ${plano.aulasPorSemana}` : ""} aula${nestaSemana === 1 ? "" : "s"} do plano · ${usadas} reposiç${usadas === 1 ? "ão usada" : "ões usadas"}.</p>
      </div>`;
  }).join("");
  return `
    <div class="plano-aluno">
      ${linhas}
      <p class="dica-plano">Cada reposição é um crédito para o aluno marcar uma aula a mais${varios ? " naquele idioma" : ""}.</p>
    </div>`;
}

async function salvarPlanoAluno(alunoId, idioma, mudancas) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return false;
  const plano = planoComMudanca(aluno, professorIdAtual, idiomasAtuaisProfessor, idioma, mudancas);
  try {
    await db.collection("usuarios").doc(alunoId).update({ plano });
    return true;
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar o plano do aluno. Tente novamente.");
    renderizarListaAlunos();
    return false;
  }
}

function definirAulasPorSemana(alunoId, idioma, valor) {
  salvarPlanoAluno(alunoId, idioma, { aulasPorSemana: Math.max(0, Math.min(14, parseInt(valor, 10) || 0)) });
}

// +1 dá um crédito; −1 tira um crédito ainda não usado. Os créditos concedidos são
// guardados em total; o saldo é esse total menos as reposições já marcadas/feitas.
function ajustarReposicoes(alunoId, idioma, delta) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return;
  const plano = planoNoIdioma(aluno, idioma);
  const usadas = reposicoesUsadas(aulasCache.filter((a) => a.alunoId === alunoId), professorIdAtual, idioma);
  const saldo = Math.max(0, plano.reposicoesConcedidas - usadas);
  const novoSaldo = Math.max(0, saldo + delta);
  if (novoSaldo === saldo) return;
  salvarPlanoAluno(alunoId, idioma, { reposicoesConcedidas: usadas + novoSaldo }).then((ok) => {
    if (ok && delta > 0) {
      db.collection("usuarios").doc(alunoId).collection("notificacoes")
        .add(notificacaoParaAluno("credito-reposicao", `Você recebeu 1 crédito de reposição de ${IDIOMAS[idioma].nome}. Agora tem ${novoSaldo} para usar ao marcar aulas de ${IDIOMAS[idioma].nome}.`, idioma))
        .catch((e) => console.warn("Não foi possível avisar o aluno do crédito:", e));
    }
  });
}

// Linha de contato do aluno (telefone/e-mail que ele preencheu no perfil)
function montarContatoAluno(alunoId) {
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return "";
  const email = aluno.emailContato || aluno.email || "";
  const partes = [];
  if (aluno.telefone) {
    const link = linkWhatsapp(aluno.telefone, `Olá ${aluno.nome}! Tudo bem?`);
    partes.push(`<span>${escapeHtml(aluno.telefone)}${link ? ` — <a href="${link}" target="_blank" rel="noopener">Chamar no WhatsApp</a>` : ""}</span>`);
  } else {
    partes.push(`<span>Telefone não informado pelo aluno</span>`);
  }
  if (email) partes.push(`<span>${escapeHtml(email)}</span>`);
  return `<div class="contato-aluno">${partes.join("")}</div>`;
}

function mudarAbaAluno(alunoId, aba) {
  estadoAlunos[alunoId].abaAtiva = aba;
  renderizarListaAlunos();
}

// -------------------- ABA: VOCABULÁRIO (abecedário) --------------------

function montarAbaVocabulario(alunoId) {
  const estado = estadoAlunos[alunoId];

  // Se o aluno estuda mais de um idioma, o professor vê um idioma de cada vez
  const idiomasDoAluno = Object.keys(IDIOMAS).filter((id) => estado.palavras.some((p) => idiomaDaPalavra(p) === id));
  const idiomaEmExibicao = idiomasDoAluno.includes(estado.idiomaFiltro) ? estado.idiomaFiltro : idiomasDoAluno[0];
  const palavrasVisiveis = idiomasDoAluno.length > 1
    ? estado.palavras.filter((p) => idiomaDaPalavra(p) === idiomaEmExibicao)
    : estado.palavras;
  const seletorIdioma = idiomasDoAluno.length > 1 ? `
    <div class="filtro-idioma-aluno">
      <label for="filtro-idioma-${alunoId}">Idioma:</label>
      <select id="filtro-idioma-${alunoId}" onchange="trocarIdiomaFiltroAluno('${alunoId}', this.value)">
        ${idiomasDoAluno.map((id) => `<option value="${id}" ${id === idiomaEmExibicao ? "selected" : ""}>${IDIOMAS[id].nome}</option>`).join("")}
      </select>
    </div>
  ` : "";

  const contagemPorLetra = {};
  palavrasVisiveis.forEach((p) => {
    const letra = letraInicial(p.palavraEn);
    contagemPorLetra[letra] = (contagemPorLetra[letra] || 0) + 1;
  });

  // "#" (palavras que não começam com A–Z, ex: japonês/mandarim) só aparece se existir alguma
  const letrasDoIndice = contagemPorLetra["#"] ? [...LETRAS_A_Z, "#"] : LETRAS_A_Z;
  const letrasHtml = letrasDoIndice.map((letra) => {
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
    const filtradas = palavrasVisiveis.filter((p) => letraInicial(p.palavraEn) === estado.letraSelecionada);
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

  return `${seletorIdioma}<div class="indice-letras-mini">${letrasHtml}</div>${listaPalavras}`;
}

function trocarIdiomaFiltroAluno(alunoId, idioma) {
  const estado = estadoAlunos[alunoId];
  estado.idiomaFiltro = idiomaValido(idioma);
  estado.letraSelecionada = "TODAS";
  renderizarListaAlunos();
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
  try {
    await db.collection("usuarios").doc(alunoId).collection("mensagens")
      .doc(msgId).update({ texto: novoTexto });
    estadoAlunos[alunoId].mensagemEmEdicaoId = null;
    renderizarListaAlunos(); // fecha o editor (a atualização em tempo real chega antes de zerar o id)
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar o recado. Tente novamente.");
  }
}

async function excluirMensagem(alunoId, msgId) {
  if (!confirm("Excluir esse recado? O aluno deixa de vê-lo.")) return;
  try {
    await db.collection("usuarios").doc(alunoId).collection("mensagens").doc(msgId).delete();
  } catch (e) {
    console.error(e);
    alert("Não foi possível excluir o recado. Tente novamente.");
  }
}

// Envia o texto de um campo e limpa o campo só depois de gravar. O campo é buscado
// de novo depois do "await": a tela pode ter sido redesenhada nesse meio-tempo, e
// limpar a referência antiga não limparia o campo que está na tela.
async function enviarTextoDoCampo(idCampo, colecao) {
  const campo = document.getElementById(idCampo);
  const texto = campo ? campo.value.trim() : "";
  if (!texto) return;
  try {
    await colecao.add({ texto, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    const atual = document.getElementById(idCampo);
    if (atual) atual.value = "";
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar agora. Confira sua internet e tente de novo — o texto continua no campo.");
  }
}

function enviarMensagem(alunoId) {
  return enviarTextoDoCampo(`input-mensagem-${alunoId}`,
    db.collection("usuarios").doc(alunoId).collection("mensagens"));
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

function adicionarRelatorio(alunoId) {
  return enviarTextoDoCampo(`input-relatorio-${alunoId}`,
    db.collection("usuarios").doc(alunoId).collection("relatorios"));
}

async function excluirRelatorio(alunoId, relatorioId) {
  if (!confirm("Excluir esse registro de aula?")) return;
  try {
    await db.collection("usuarios").doc(alunoId).collection("relatorios").doc(relatorioId).delete();
  } catch (e) {
    console.error(e);
    alert("Não foi possível excluir o registro. Tente novamente.");
  }
}

// -------------------- ABA: SALA DE AULA --------------------
// O professor deixa o link da aula online e os documentos usados em aula
// (título + link). Cada documento tem um bloco de anotações que o aluno escreve
// e o professor acompanha (só leitura), como o vocabulário.

function montarAbaSalaDeAula(alunoId) {
  const estado = estadoAlunos[alunoId];
  // Só o que foi deixado por este professor (o aluno pode ter vindo de outro)
  const link = estado.linkAula && estado.linkAula.professorId === professorIdAtual ? estado.linkAula.url : "";
  const documentos = estado.documentosAula.filter((d) => d.professorId === professorIdAtual);
  const arquivo = arquivosEscolhidos[alunoId];

  const blocoLink = `
    <div class="sala-secao">
      <h4>Link da aula</h4>
      <p class="dica-plano">Meet, Zoom, Teams... O aluno entra na aula por este link.</p>
      <div class="linha-sala">
        <input type="text" inputmode="url" id="input-link-aula-${alunoId}" placeholder="https://meet.google.com/..." value="${escapeHtml(link)}">
        <button class="btn btn-primario" onclick="salvarLinkAula('${alunoId}')">Salvar link</button>
      </div>
      ${link ? `
        <div class="acoes-link-aula">
          <a href="${escapeHtml(link)}" target="_blank" rel="noopener">Abrir a aula ↗</a>
          <button class="excluir" onclick="removerLinkAula('${alunoId}')">Remover link</button>
        </div>` : ""}
    </div>`;

  const lista = montarListaDocumentosAula(documentos, {
    busca: estado.buscaDocumentos, limite: estado.limiteDocumentos, idBusca: `busca-documentos-${alunoId}`,
    aoBuscar: `buscarDocumentosAluno('${alunoId}', this.value)`, aoMostrarMais: `mostrarMaisDocumentosAluno('${alunoId}')`,
    vazio: "Nenhum documento adicionado ainda.",
    item: (d) => {
        const aberto = estado.notasDocumentoAbertas.has(d.id);
        const data = d.criadoEm ? d.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
        const nota = aberto ? `
          <div class="bloco-notas-documento">
            ${d.anotacao
              ? `<span class="texto-nota-documento">${escapeHtml(d.anotacao)}</span>${d.anotacaoEm ? `<span class="data-msg">Atualizada em ${escapeHtml(d.anotacaoEm.toDate().toLocaleDateString("pt-BR"))}</span>` : ""}`
              : `<span class="vazio-inline">O aluno ainda não fez anotações sobre este documento.</span>`}
          </div>` : "";
        return `
          <div class="documento-aula">
            <div class="acoes-msg">
              <button class="excluir" onclick="removerDocumentoAula('${alunoId}','${d.id}')">Excluir</button>
            </div>
            ${d.url
              ? `<a class="titulo-documento" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.titulo)}</a>`
              : `<button class="titulo-documento link-arquivo" onclick="abrirArquivoDocumentoProfessor('${alunoId}','${d.id}')">${escapeHtml(d.titulo)}</button>
                 <span class="data-msg">${escapeHtml(d.nomeArquivo)} · ${formatarTamanhoArquivo(d.tamanho)}</span>`}
            <span class="data-msg">${escapeHtml(data)}</span>
            <button class="btn-notas-documento ${d.anotacao ? "tem-nota" : ""}" onclick="alternarNotasDocumentoProfessor('${alunoId}','${d.id}')">
              ${aberto ? "Fechar anotações" : "Anotações do aluno"}${d.anotacao && !aberto ? " •" : ""}
            </button>
            ${nota}
          </div>`;
      }
  });

  const blocoDocumentos = `
    <div class="sala-secao">
      <h4>Documentos da aula</h4>
      <p class="dica-plano">Envie um arquivo (PDF, Word, imagem, áudio... até 10 MB) ou cole um link (Google Drive, YouTube...).</p>
      <div class="linha-sala">
        <input type="text" id="input-titulo-documento-${alunoId}" placeholder="Título (ex: Lesson 3 — Past simple)">
      </div>
      <div class="linha-sala">
        ${arquivo
          ? `<span class="arquivo-escolhido">${escapeHtml(arquivo.name)} (${formatarTamanhoArquivo(arquivo.size)})
               <button type="button" title="Tirar arquivo" onclick="escolherArquivoDocumento('${alunoId}', null)">✕</button></span>`
          : `<label class="btn btn-secundario btn-escolher-arquivo">Escolher arquivo
               <input type="file" id="input-arquivo-documento-${alunoId}" hidden onchange="escolherArquivoDocumento('${alunoId}', this.files[0])">
             </label>
             <input type="text" inputmode="url" id="input-url-documento-${alunoId}" placeholder="ou cole um link: https://drive.google.com/...">`}
        <button class="btn btn-primario" id="btn-adicionar-documento-${alunoId}" onclick="adicionarDocumentoAula('${alunoId}')" ${envioEmAndamento[alunoId] ? "disabled" : ""}>
          ${envioEmAndamento[alunoId] ? escapeHtml(envioEmAndamento[alunoId]) : "Adicionar documento"}
        </button>
      </div>
      ${lista}
    </div>`;

  return blocoLink + blocoDocumentos;
}

async function salvarLinkAula(alunoId) {
  const campo = document.getElementById(`input-link-aula-${alunoId}`);
  const url = normalizarLink(campo ? campo.value : "");
  if (!url) {
    alert("Cole um link válido, começando com https:// (ex: https://meet.google.com/abc-defg-hij).");
    return;
  }
  try {
    await db.collection("usuarios").doc(alunoId).collection("salaDeAula").doc("link").set({
      url, professorId: professorIdAtual, atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar o link. Tente novamente.");
  }
}

async function removerLinkAula(alunoId) {
  if (!confirm("Remover o link da aula? O aluno deixa de vê-lo.")) return;
  try {
    await db.collection("usuarios").doc(alunoId).collection("salaDeAula").doc("link").delete();
    const campo = document.getElementById(`input-link-aula-${alunoId}`);
    if (campo) campo.value = "";
  } catch (e) {
    console.error(e);
    alert("Não foi possível remover o link. Tente novamente.");
  }
}

// Arquivo escolhido (ainda não enviado), por aluno. Fica guardado aqui porque a
// tela é redesenhada a cada atualização em tempo real — e um <input type=file>
// redesenhado perde o arquivo escolhido.
const arquivosEscolhidos = {};
const envioEmAndamento = {}; // {alunoId: "Enviando 40%..."} enquanto um arquivo sobe

function escolherArquivoDocumento(alunoId, arquivo) {
  if (arquivo && arquivo.size > TAMANHO_MAXIMO_ARQUIVO) {
    alert(`Esse arquivo tem ${formatarTamanhoArquivo(arquivo.size)}. O limite é 10 MB — para arquivos maiores, use um link (ex: Google Drive).`);
    arquivo = null;
  }
  if (arquivo) {
    arquivosEscolhidos[alunoId] = arquivo;
    // Sem título digitado, usa o nome do arquivo (sem a extensão)
    const campoTitulo = document.getElementById(`input-titulo-documento-${alunoId}`);
    if (campoTitulo && !campoTitulo.value.trim()) campoTitulo.value = arquivo.name.replace(/\.[^.]+$/, "").slice(0, 200);
  } else {
    delete arquivosEscolhidos[alunoId];
  }
  renderizarListaAlunos();
}

// Envia o arquivo em pedaços e só então cria o documento — o aluno nunca vê
// um documento com o arquivo pela metade
async function enviarArquivoDocumento(alunoId, titulo, arquivo) {
  const docRef = db.collection("usuarios").doc(alunoId).collection("documentosAula").doc();
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const partes = Math.max(1, Math.ceil(bytes.length / TAMANHO_PARTE_ARQUIVO));
  try {
    for (let i = 0; i < partes; i++) {
      envioEmAndamento[alunoId] = `Enviando ${Math.round((i / partes) * 100)}%...`;
      renderizarListaAlunos();
      const pedaco = bytes.slice(i * TAMANHO_PARTE_ARQUIVO, (i + 1) * TAMANHO_PARTE_ARQUIVO);
      await docRef.collection("partes").doc(String(i)).set({ dados: firebase.firestore.Blob.fromUint8Array(pedaco), indice: i });
    }
    await docRef.set({
      titulo, professorId: professorIdAtual, criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      nomeArquivo: arquivo.name.slice(0, 200), tipoArquivo: (arquivo.type || "").slice(0, 200),
      tamanho: arquivo.size, partes
    });
  } catch (e) {
    apagarPartesDoDocumento(docRef).catch(() => {}); // não deixa pedaços soltos
    throw e;
  }
}

async function adicionarDocumentoAula(alunoId) {
  if (envioEmAndamento[alunoId]) return;
  const campoTitulo = document.getElementById(`input-titulo-documento-${alunoId}`);
  const campoUrl = document.getElementById(`input-url-documento-${alunoId}`);
  const titulo = (campoTitulo ? campoTitulo.value : "").trim().slice(0, 200);
  const arquivo = arquivosEscolhidos[alunoId];
  const url = arquivo ? "" : normalizarLink(campoUrl ? campoUrl.value : "");
  if (!titulo) { alert("Dê um título ao documento."); return; }
  if (!arquivo && !url) { alert("Escolha um arquivo ou cole um link válido, começando com https://."); return; }
  try {
    if (arquivo) {
      await enviarArquivoDocumento(alunoId, titulo, arquivo);
      delete arquivosEscolhidos[alunoId];
    } else {
      await db.collection("usuarios").doc(alunoId).collection("documentosAula").add({
        titulo, url, professorId: professorIdAtual, criadoEm: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    delete envioEmAndamento[alunoId];
    renderizarListaAlunos();
    // Busca os campos de novo: a tela pode ter sido redesenhada durante o "await"
    const t = document.getElementById(`input-titulo-documento-${alunoId}`);
    const u = document.getElementById(`input-url-documento-${alunoId}`);
    if (t) t.value = "";
    if (u) u.value = "";
  } catch (e) {
    console.error(e);
    delete envioEmAndamento[alunoId];
    renderizarListaAlunos();
    alert("Não foi possível adicionar o documento. Confira sua internet e tente novamente.");
  }
}

async function removerDocumentoAula(alunoId, documentoId) {
  if (!confirm("Excluir esse documento? O aluno deixa de vê-lo, junto com as anotações dele sobre o documento.")) return;
  try {
    const ref = db.collection("usuarios").doc(alunoId).collection("documentosAula").doc(documentoId);
    await apagarPartesDoDocumento(ref);
    await ref.delete();
  } catch (e) {
    console.error(e);
    alert("Não foi possível excluir o documento. Tente novamente.");
  }
}

function buscarDocumentosAluno(alunoId, texto) {
  estadoAlunos[alunoId].buscaDocumentos = texto;
  estadoAlunos[alunoId].limiteDocumentos = DOCUMENTOS_POR_PAGINA;
  renderizarListaAlunos();
}

function mostrarMaisDocumentosAluno(alunoId) {
  estadoAlunos[alunoId].limiteDocumentos += DOCUMENTOS_POR_PAGINA * 2;
  renderizarListaAlunos();
}

function abrirArquivoDocumentoProfessor(alunoId, documentoId) {
  const documento = estadoAlunos[alunoId].documentosAula.find((d) => d.id === documentoId);
  if (documento) abrirArquivoDaAula(alunoId, documento);
}

function alternarNotasDocumentoProfessor(alunoId, documentoId) {
  const abertas = estadoAlunos[alunoId].notasDocumentoAbertas;
  if (abertas.has(documentoId)) abertas.delete(documentoId); else abertas.add(documentoId);
  renderizarListaAlunos();
}

// -------------------- CÓDIGO DO PROFESSOR --------------------

async function copiarCodigo() {
  const codigo = document.getElementById("codigo-professor").textContent;
  const status = document.getElementById("status-copiar");
  try {
    await navigator.clipboard.writeText(codigo);
    status.textContent = "Copiado!";
  } catch (e) {
    // Sem permissão de área de transferência (alguns navegadores/celulares)
    status.textContent = "Não deu pra copiar — selecione o código e copie manualmente.";
  }
  setTimeout(() => (status.textContent = ""), 2500);
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
      renderizarHojeProfessor();
      renderizarAlunosSemApp();
      renderizarHorariosMarcarAula(); // um horário pode ter acabado de ser ocupado
    });
  // "em 25 min" e as aulas que já passaram mudam com o relógio, mesmo sem dado novo
  setInterval(renderizarHojeProfessor, 60 * 1000);
}

// -------------------- AGENDA: HOJE E PRÓXIMAS AULAS --------------------
// Igual ao painel da barbearia: a próxima aula em destaque, as aulas dos próximos
// dias agrupadas por dia e, separadas, as que já passaram sem ninguém marcar
// como concluída (aluno faltou, ou o professor esqueceu de concluir).

const DIAS_PAINEL_HOJE = 7;
const NOMES_DIAS_CURTOS_PROF = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function inicioDaAula(a) {
  return new Date(`${a.data}T${a.horaInicio}:00`);
}

function fimDaAula(a) {
  const fim = a.horaFim || somarMinutos(a.horaInicio, (configAgendaAtual && configAgendaAtual.duracaoAulaMinutos) || DURACAO_PADRAO_MINUTOS);
  return new Date(`${a.data}T${fim}:00`);
}

function rotuloDiaPainel(dataIso, hojeIso, amanhaIso) {
  if (dataIso === hojeIso) return "Hoje";
  if (dataIso === amanhaIso) return "Amanhã";
  return `${NOMES_DIAS_CURTOS_PROF[new Date(`${dataIso}T12:00:00`).getDay()]}, ${formatarDataBR(dataIso).slice(0, 5)}`;
}

// "agora" / "em 25 min" / "em 2h 10min" pra hoje; "Amanhã às 09:00" / "Qua, 29/10 às 14:00" depois
function rotuloQuandoAula(a, agora, hojeIso, amanhaIso) {
  if (a.data !== hojeIso) return `${rotuloDiaPainel(a.data, hojeIso, amanhaIso)} às ${a.horaInicio}`;
  const minutos = Math.round((inicioDaAula(a).getTime() - agora.getTime()) / 60000);
  if (minutos <= 0) return "agora";
  if (minutos < 60) return `em ${minutos} min`;
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return `em ${h}h${m ? ` ${m}min` : ""}`;
}

function linhaAulaPainel(a, mostrarData) {
  const concluida = a.status === "concluida";
  const acoes = concluida
    ? `<span class="selo-concluida">✓ Concluída</span><button class="btn btn-secundario btn-mini" onclick="desfazerConclusaoAula('${a.id}')">Desfazer</button>`
    : `<button class="btn btn-secundario btn-mini" onclick="concluirAula('${a.id}')">Concluir</button><button class="excluir" onclick="cancelarAulaComoProfessor('${a.id}')">Cancelar</button>`;
  return `
    <div class="cartao-aula${concluida ? " aula-concluida" : ""}">
      <div class="aula-info">
        <strong>${escapeHtml(a.alunoNome)}</strong>
        <span>${mostrarData ? `${formatarDataBR(a.data).slice(0, 5)} · ` : ""}${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
        ${a.reposicao ? '<span class="badge-status badge-reposicao">Reposição</span>' : ""}
        ${badgeIdiomaAula(a)}
      </div>
      <div class="aula-acoes">${acoes}</div>
    </div>`;
}

function renderizarHojeProfessor() {
  const container = document.getElementById("painel-hoje-professor");
  if (!container) return;

  const agora = new Date();
  const hojeIso = dataDeHojeISO();
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  const amanhaIso = chaveDataISO(amanha);
  const limite = new Date(); limite.setDate(limite.getDate() + DIAS_PAINEL_HOJE);
  const limiteIso = chaveDataISO(limite);
  const ordenar = (lista) => lista.sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));

  // Já passaram e continuam "agendada": ninguém concluiu nem cancelou
  const atrasadas = ordenar(aulasCache.filter((a) => a.status === "agendada" && fimDaAula(a) <= agora));
  // Próximos dias: as que ainda vão acontecer, mais as de hoje já concluídas (com "Desfazer")
  const proximas = ordenar(aulasCache.filter((a) =>
    a.data >= hojeIso && a.data <= limiteIso &&
    ((a.status === "agendada" && fimDaAula(a) > agora) || (a.status === "concluida" && a.data === hojeIso))));
  const proxima = proximas.find((a) => a.status === "agendada");

  const grupos = [];
  proximas.forEach((a) => {
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.data !== a.data) grupos.push({ data: a.data, aulas: [a] });
    else ultimo.aulas.push(a);
  });

  const pedidos = ordenar(aulasCache.filter((a) => a.status === "pendente"));
  const lembretes = lembretesAlunosSemApp();
  atualizarContadorPedidos(pedidos.length + atrasadas.length + lembretes.length);

  const aulasHoje = proximas.filter((a) => a.data === hojeIso && a.status === "agendada").length;
  const resumo = [`${aulasHoje} ${aulasHoje === 1 ? "aula hoje" : "aulas hoje"}`];
  if (atrasadas.length) resumo.push(`${atrasadas.length} para confirmar`);

  container.innerHTML = `
    ${atrasadas.length ? `
      <div class="cartao-pedidos-reposicao" id="confirmar-aulas">
        <h3>${atrasadas.length === 1 ? "1 aula para confirmar" : `${atrasadas.length} aulas para confirmar`}</h3>
        <p>A aula aconteceu? Se não foi realizada, o aluno ganha 1 reposição automaticamente.</p>
        ${atrasadas.map((a) => `
          <div class="cartao-aula">
            <div class="aula-info">
              <strong>${escapeHtml(a.alunoNome)}</strong>
              <span>${escapeHtml(rotuloDiaPainel(a.data, hojeIso, amanhaIso))} · ${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
              <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
              ${a.reposicao ? '<span class="badge-status badge-reposicao">Reposição</span>' : ""}
              ${badgeIdiomaAula(a)}
            </div>
            <div class="aula-acoes">
              <button class="btn btn-primario btn-mini" onclick="concluirAula('${a.id}')">Foi realizada</button>
              <button class="btn btn-secundario btn-mini" onclick="marcarAulaNaoRealizada('${a.id}')">Não foi realizada</button>
            </div>
          </div>`).join("")}
      </div>` : ""}
    ${lembretes.length ? `
      <div class="cartao-pedidos-reposicao" id="lembretes-sem-app">
        <h3>Marque as aulas dos alunos sem app</h3>
        <p>Esse aviso aparece todo dia até a aula ser marcada.</p>
        ${lembretes.map((l) => `
          <div class="cartao-aula">
            <div class="aula-info">
              <strong>${escapeHtml(l.aluno.nome)}</strong>
              <span>${escapeHtml(l.motivo)}</span>
            </div>
            <div class="aula-acoes">
              <button class="btn btn-primario btn-mini" onclick="abrirMarcarAula('${l.aluno.id}')">Marcar aula</button>
            </div>
          </div>`).join("")}
      </div>` : ""}
    ${pedidos.length ? `
      <div class="cartao-pedidos-reposicao" id="pedidos-reposicao">
        <h3>🔔 ${pedidos.length === 1 ? "1 pedido de reposição" : `${pedidos.length} pedidos de reposição`} para aprovar</h3>
        <p>O aluno marcou uma reposição sem ter crédito. O horário fica reservado até você decidir. Aprovar já conta como 1 crédito usado.</p>
        ${pedidos.map((a) => `
          <div class="cartao-aula">
            <div class="aula-info">
              <strong>${escapeHtml(a.alunoNome)}</strong>
              <span>${escapeHtml(rotuloDiaPainel(a.data, hojeIso, amanhaIso))} · ${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
              <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
              ${badgeIdiomaAula(a)}
              ${inicioDaAula(a) < agora ? '<span class="badge-status badge-status-recusada">Horário já passou</span>' : ""}
            </div>
            ${acoesAulaHtml(a)}
          </div>`).join("")}
      </div>` : ""}
    ${proxima ? `
      <div class="cartao-proxima-aula">
        <div class="rotulo-proxima-aula">Próxima aula</div>
        <div class="corpo-proxima-aula">
          <div><strong>${escapeHtml(proxima.alunoNome)}</strong> · ${legendaModalidade(proxima.modalidade)}${idiomasAtuaisProfessor.length > 1 ? ` · ${IDIOMAS[idiomaValido(proxima.idioma)].nome}` : ""}</div>
          <div class="quando-proxima-aula">${rotuloQuandoAula(proxima, agora, hojeIso, amanhaIso)}</div>
        </div>
      </div>` : ""}
    <div class="cartao-proximas-aulas">
      <div class="cabecalho-proximas-aulas">
        <h3>Aulas dos próximos ${DIAS_PAINEL_HOJE} dias</h3>
        <span>${resumo.join(" · ")}</span>
      </div>
      ${grupos.length ? grupos.map((g) => `
        <div class="grupo-dia-aulas">
          <div class="titulo-grupo-dia">${rotuloDiaPainel(g.data, hojeIso, amanhaIso)}</div>
          ${g.aulas.map((a) => linhaAulaPainel(a, false)).join("")}
        </div>`).join("") : `<p class="vazio">Nenhuma aula marcada nos próximos ${DIAS_PAINEL_HOJE} dias.</p>`}
    </div>`;
}

// Contador de avisos na aba "Agenda" e no ícone da barra lateral: pedidos de
// reposição, aulas para confirmar e alunos sem app esperando aula
function atualizarContadorPedidos(qtd) {
  const aba = document.getElementById("btn-aba-agenda");
  if (aba) aba.innerHTML = `Agenda${qtd ? ` <span class="contador-pedidos" title="Avisos da agenda">${qtd}</span>` : ""}`;
  const lateral = document.getElementById("navlat-agenda");
  if (lateral) {
    lateral.innerHTML = `📅${qtd ? `<span class="contador-pedidos contador-lateral">${qtd}</span>` : ""}`;
    lateral.title = qtd ? `Agenda — ${qtd} aviso(s)` : "Agenda";
  }
}

// Cria uma notificação para o aluno (sino na tela dele), do idioma a que ela se refere
function notificacaoParaAluno(tipo, texto, idioma) {
  return { tipo, texto, idioma: idiomaValido(idioma), lida: false, professorId: professorIdAtual, criadoEm: firebase.firestore.FieldValue.serverTimestamp() };
}

function descricaoAula(a) {
  return `${IDIOMAS[idiomaValido(a.idioma)].nome}, ${formatarDataBR(a.data)} às ${a.horaInicio}`;
}

// Aprovar: a aula vira "agendada" e o professor concede o crédito que ela usa
// (+1 em reposicoesConcedidas), então o saldo do aluno não muda
async function aprovarPedidoReposicao(aulaId) {
  const aula = aulasCache.find((a) => a.id === aulaId);
  if (!aula) return;
  const aluno = alunosCache.find((a) => a.id === aula.alunoId);
  const lote = db.batch();
  lote.update(db.collection("aulas").doc(aulaId), { status: "agendada" });
  if (aluno) {
    const idioma = idiomaValido(aula.idioma);
    lote.update(db.collection("usuarios").doc(aluno.id), {
      plano: planoComMudanca(aluno, professorIdAtual, idiomasAtuaisProfessor, idioma,
        { reposicoesConcedidas: planoNoIdioma(aluno, idioma).reposicoesConcedidas + 1 })
    });
    lote.set(db.collection("usuarios").doc(aluno.id).collection("notificacoes").doc(),
      notificacaoParaAluno("reposicao-aprovada", `Seu pedido de reposição (${descricaoAula(aula)}) foi aprovado. A aula está confirmada.`, aula.idioma));
  }
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível aprovar o pedido agora. Tente novamente.");
  }
}

async function recusarPedidoReposicao(aulaId) {
  const aula = aulasCache.find((a) => a.id === aulaId);
  if (!aula) return;
  if (!confirm(`Recusar o pedido de reposição de ${aula.alunoNome} (${descricaoAula(aula)})? O horário volta a ficar livre.`)) return;
  const lote = db.batch();
  lote.update(db.collection("aulas").doc(aulaId), { status: "recusada" });
  if (alunosCache.some((a) => a.id === aula.alunoId)) {
    lote.set(db.collection("usuarios").doc(aula.alunoId).collection("notificacoes").doc(),
      notificacaoParaAluno("reposicao-recusada", `Seu pedido de reposição (${descricaoAula(aula)}) foi recusado pelo professor. O horário foi liberado.`, aula.idioma));
  }
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível recusar o pedido agora. Tente novamente.");
  }
}

// -------------------- AULA NÃO REALIZADA --------------------
// A aula passou e não aconteceu: vira "nao-realizada" (não conta no plano) e o
// aluno ganha 1 reposição. Se ela já era uma reposição, o crédito usado volta
// sozinho (aula não realizada não conta como reposição usada); senão, o
// professor concede +1. O aluno do app é avisado no sino.

// Idioma de um aluno sem app (cadastros antigos, sem o campo: o idioma principal)
function idiomaDoAlunoSemApp(aluno) {
  return idiomaValido(aluno.idioma || idiomasAtuaisProfessor[0]);
}

// Créditos de reposição de um aluno do app ou sem app, num idioma: {concedidas, usadas, saldo}.
// O aluno sem app estuda um idioma só; os créditos dele são desse idioma.
function creditosDoAluno(alunoId, idioma) {
  const aulas = aulasCache.filter((a) => a.alunoId === alunoId);
  const usadas = reposicoesUsadas(aulas, professorIdAtual, idioma);
  const semApp = alunosSemAppCache.find((a) => a.id === alunoId);
  const aluno = alunosCache.find((a) => a.id === alunoId);
  const concedidas = semApp ? (idiomaDoAlunoSemApp(semApp) === idioma ? semApp.reposicoesConcedidas || 0 : 0)
    : aluno ? planoNoIdioma(aluno, idioma).reposicoesConcedidas : 0;
  return { concedidas, usadas, saldo: Math.max(0, concedidas - usadas) };
}

// Grava um novo total de reposições concedidas, num idioma, no lote (perfil do aluno ou cadastro sem app)
function gravarReposicoesConcedidas(lote, alunoId, idioma, total) {
  const semApp = alunosSemAppCache.find((a) => a.id === alunoId);
  if (semApp) {
    if (idiomaDoAlunoSemApp(semApp) !== idioma) return;
    lote.update(db.collection("usuarios").doc(professorIdAtual).collection("alunosSemApp").doc(alunoId),
      { reposicoesConcedidas: Math.max(0, total) });
    return;
  }
  const aluno = alunosCache.find((a) => a.id === alunoId);
  if (!aluno) return;
  lote.update(db.collection("usuarios").doc(alunoId), {
    plano: planoComMudanca(aluno, professorIdAtual, idiomasAtuaisProfessor, idioma, { reposicoesConcedidas: Math.max(0, total) })
  });
}

async function marcarAulaNaoRealizada(aulaId) {
  const aula = aulasCache.find((a) => a.id === aulaId);
  if (!aula) return;
  if (!confirm(`A aula de ${aula.alunoNome} (${descricaoAula(aula)}) não foi realizada?\n\nO aluno ganha 1 reposição para marcar outra aula.`)) return;
  const lote = db.batch();
  const gerarCredito = !aula.reposicao;
  lote.update(db.collection("aulas").doc(aulaId), { status: "nao-realizada", reposicaoGerada: gerarCredito });
  const idioma = idiomaValido(aula.idioma);
  if (gerarCredito) gravarReposicoesConcedidas(lote, aula.alunoId, idioma, creditosDoAluno(aula.alunoId, idioma).concedidas + 1);
  if (alunosCache.some((a) => a.id === aula.alunoId)) {
    lote.set(db.collection("usuarios").doc(aula.alunoId).collection("notificacoes").doc(),
      notificacaoParaAluno("aula-nao-realizada", `A aula (${descricaoAula(aula)}) não foi realizada. Você ganhou 1 reposição de ${IDIOMAS[idioma].nome} para marcar outra aula.`, idioma));
  }
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível registrar agora. Tente novamente.");
  }
}

// Volta a aula para "agendada" (de novo em "aulas para confirmar") e tira o
// crédito que ela tinha gerado, se ainda não foi usado
async function desfazerAulaNaoRealizada(aulaId) {
  const aula = aulasCache.find((a) => a.id === aulaId);
  if (!aula) return;
  const lote = db.batch();
  lote.update(db.collection("aulas").doc(aulaId), { status: "agendada", reposicaoGerada: firebase.firestore.FieldValue.delete() });
  if (aula.reposicaoGerada) {
    const idioma = idiomaValido(aula.idioma);
    const { concedidas, usadas } = creditosDoAluno(aula.alunoId, idioma);
    gravarReposicoesConcedidas(lote, aula.alunoId, idioma, Math.max(usadas, concedidas - 1));
  }
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível desfazer agora. Tente novamente em instantes.");
  }
}

async function desfazerConclusaoAula(aulaId) {
  try {
    await db.collection("aulas").doc(aulaId).update({ status: "agendada" });
  } catch (e) {
    console.error(e);
    alert("Não foi possível desfazer agora. Tente novamente em instantes.");
  }
}

// Meses que o professor pode liberar no formulário: o atual (sempre liberado) e os 6 seguintes
function proximosMesesParaLiberar() {
  const hoje = new Date();
  return Array.from({ length: 6 }, (_, i) => new Date(hoje.getFullYear(), hoje.getMonth() + 1 + i, 1));
}

function chaveMesProfessor(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
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
  document.getElementById("config-intervalo-aula").value = String(configAgendaAtual.intervaloMinutos || 0);
  document.getElementById("config-modalidade-online").checked = (configAgendaAtual.modalidades || []).includes("online");
  document.getElementById("config-modalidade-presencial").checked = (configAgendaAtual.modalidades || []).includes("presencial");
  document.getElementById("config-whatsapp").value = configAgendaAtual.whatsapp || "";

  const liberados = configAgendaAtual.mesesLiberados || [];
  const hoje = new Date();
  document.getElementById("config-meses-liberados").innerHTML =
    `<label class="opcao-mes"><input type="checkbox" checked disabled> ${NOMES_MESES[hoje.getMonth()]} (atual)</label>` +
    proximosMesesParaLiberar().map((d) => {
      const chave = chaveMesProfessor(d);
      return `<label class="opcao-mes"><input type="checkbox" class="chk-mes-liberado" value="${chave}" ${liberados.includes(chave) ? "checked" : ""}> ${NOMES_MESES[d.getMonth()]}${d.getFullYear() !== hoje.getFullYear() ? ` de ${d.getFullYear()}` : ""}</label>`;
    }).join("");

  preencherSemanaDeTrabalho(configAgendaAtual.disponibilidade || {}, configAgendaAtual.modalidadesPorDia || {});
}

// -------------------- SEMANA DE TRABALHO (configurar disponibilidade) --------------------
// Dois jeitos de configurar a semana:
// - "igual": marca os dias em que trabalha e cadastra os períodos uma vez só
//   (ex: 08:00–12:00 e 14:00–18:00), que valem para todos os dias marcados;
// - "dia": períodos diferentes em cada dia da semana.
// Os dois gravam o mesmo formato: disponibilidade[dia] = [{inicio, fim}, ...].

const PERIODOS_PADRAO_NOVOS = [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }];
const DIAS_PADRAO_NOVOS = ["seg", "ter", "qua", "qui", "sex"];
let modoSemana = "igual";

function linhaPeriodoHtml(periodo) {
  return `
    <div class="linha-periodo">
      <input type="time" class="periodo-inicio" value="${escapeHtml(periodo.inicio)}" aria-label="Início do período">
      <span>até</span>
      <input type="time" class="periodo-fim" value="${escapeHtml(periodo.fim)}" aria-label="Fim do período">
      <button type="button" class="excluir remover-periodo" title="Remover período" aria-label="Remover período" onclick="removerPeriodo(this)">✕</button>
    </div>`;
}

function listaPeriodos(grupo) {
  return document.querySelector(`#modal-config-agenda .lista-periodos[data-grupo="${grupo}"]`);
}

function preencherListaPeriodos(grupo, periodos) {
  listaPeriodos(grupo).innerHTML = periodos.map(linhaPeriodoHtml).join("");
}

function adicionarPeriodo(grupo) {
  const lista = listaPeriodos(grupo);
  const atuais = lerPeriodosBrutos(grupo);
  // Sugere um período 1 h depois do último (ex: depois de 14–18, sugere 19–22)
  const ultimo = atuais[atuais.length - 1];
  const inicio = ultimo && ultimo.fim && ultimo.fim <= "20:00" ? somarMinutos(ultimo.fim, 60) : "08:00";
  const fim = inicio === "08:00" ? "12:00" : (minutosDoHorario(inicio) + 180 >= 24 * 60 ? "23:30" : somarMinutos(inicio, 180));
  lista.insertAdjacentHTML("beforeend", linhaPeriodoHtml({ inicio, fim }));
}

function removerPeriodo(botao) {
  botao.closest(".linha-periodo").remove();
}

function lerPeriodosBrutos(grupo) {
  return Array.from(listaPeriodos(grupo).querySelectorAll(".linha-periodo")).map((linha) => ({
    inicio: linha.querySelector(".periodo-inicio").value,
    fim: linha.querySelector(".periodo-fim").value
  }));
}

// Lê e valida os períodos de um grupo: em ordem, sem horário vazio, início antes do
// fim e sem um período invadindo o outro
function lerPeriodos(grupo, nomeDoGrupo) {
  const periodos = lerPeriodosBrutos(grupo).sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (const p of periodos) {
    if (!p.inicio || !p.fim || p.inicio >= p.fim) {
      return { erro: `${nomeDoGrupo}: cada período precisa de início e fim, com o início antes do fim.` };
    }
  }
  for (let i = 1; i < periodos.length; i++) {
    if (periodos[i].inicio < periodos[i - 1].fim) {
      return { erro: `${nomeDoGrupo}: os períodos ${periodos[i - 1].inicio}–${periodos[i - 1].fim} e ${periodos[i].inicio}–${periodos[i].fim} se sobrepõem.` };
    }
  }
  return { periodos };
}

function diasMarcados() {
  return Array.from(document.querySelectorAll("#config-dias-trabalho .dia-trabalho[aria-pressed='true']")).map((b) => b.dataset.dia);
}

function alternarDiaTrabalho(botao) {
  botao.setAttribute("aria-pressed", String(botao.getAttribute("aria-pressed") !== "true"));
}

// Abre o formulário no modo que representa a configuração salva: "igual" quando
// todos os dias de trabalho têm os mesmos períodos, senão "dia por dia"
function modalidadesGeraisDoFormulario() {
  const m = [];
  if (document.getElementById("config-modalidade-online").checked) m.push("online");
  if (document.getElementById("config-modalidade-presencial").checked) m.push("presencial");
  return m;
}

function preencherSemanaDeTrabalho(disponibilidade, modalidadesPorDia) {
  const diasComHorario = DIAS_SEMANA.filter((d) => (disponibilidade[d] || []).length);
  // Cada dia "diferente" (períodos ou modalidades) força o modo "dia por dia"
  const gerais = modalidadesGeraisDoFormulario();
  const modalidadesDe = (d) => (modalidadesPorDia[d] && modalidadesPorDia[d].length ? modalidadesPorDia[d] : gerais);
  const assinaturas = new Set(diasComHorario.map((d) =>
    JSON.stringify([disponibilidade[d], [...modalidadesDe(d)].sort()])));
  const modalidadesDiferentes = diasComHorario.some((d) => JSON.stringify([...modalidadesDe(d)].sort()) !== JSON.stringify([...gerais].sort()));
  const novo = diasComHorario.length === 0;
  const dias = novo ? DIAS_PADRAO_NOVOS : diasComHorario;
  const periodosGerais = novo ? PERIODOS_PADRAO_NOVOS : disponibilidade[diasComHorario[0]];

  document.getElementById("config-dias-trabalho").innerHTML = DIAS_SEMANA.map((d) => `
    <button type="button" class="dia-trabalho" data-dia="${d}" aria-pressed="${dias.includes(d)}" onclick="alternarDiaTrabalho(this)">${NOMES_DIAS_SEMANA[d].slice(0, 3)}</button>`).join("");
  preencherListaPeriodos("geral", periodosGerais);
  preencherDiaPorDia(novo ? {} : disponibilidade, periodosGerais, modalidadesPorDia);
  mudarModoSemana(assinaturas.size > 1 || modalidadesDiferentes ? "dia" : "igual", true);
}

function preencherDiaPorDia(disponibilidade, periodosSugeridos, modalidadesPorDia) {
  const gerais = modalidadesGeraisDoFormulario();
  document.getElementById("config-dias-semana").innerHTML = DIAS_SEMANA.map((dia) => {
    const periodos = disponibilidade[dia] || [];
    const trabalha = periodos.length > 0;
    const modalidades = (modalidadesPorDia && modalidadesPorDia[dia] && modalidadesPorDia[dia].length)
      ? modalidadesPorDia[dia] : (gerais.length ? gerais : ["online"]);
    return `
      <div class="dia-config-grupo">
        <label class="chk-periodo-label">
          <input type="checkbox" class="chk-dia-trabalha" data-dia="${dia}" ${trabalha ? "checked" : ""} onchange="this.closest('.dia-config-grupo').classList.toggle('dia-de-folga', !this.checked)">
          <span class="dia-config-titulo">${NOMES_DIAS_SEMANA[dia]}</span>
        </label>
        <div class="periodos-do-dia">
          <div class="lista-periodos" data-grupo="${dia}">${(trabalha ? periodos : periodosSugeridos).map(linhaPeriodoHtml).join("")}</div>
          <button type="button" class="link-trocar" onclick="adicionarPeriodo('${dia}')">+ Adicionar período</button>
          <div class="modalidades-semana">
            <span>Atende:</span>
            <label><input type="checkbox" class="chk-modalidade-semana" data-dia="${dia}" value="online" ${modalidades.includes("online") ? "checked" : ""}> Online</label>
            <label><input type="checkbox" class="chk-modalidade-semana" data-dia="${dia}" value="presencial" ${modalidades.includes("presencial") ? "checked" : ""}> Presencial</label>
          </div>
        </div>
      </div>`;
  }).join("");
  document.querySelectorAll("#config-dias-semana .chk-dia-trabalha").forEach((chk) => {
    chk.closest(".dia-config-grupo").classList.toggle("dia-de-folga", !chk.checked);
  });
}

// Troca entre os dois modos levando junto o que já foi preenchido
function mudarModoSemana(modo, inicial) {
  if (!inicial && modo !== modoSemana) {
    if (modo === "dia") {
      const geral = lerPeriodosBrutos("geral");
      const marcados = diasMarcados();
      const disp = {};
      marcados.forEach((d) => { disp[d] = geral; });
      preencherDiaPorDia(disp, geral, {});
    } else {
      const disp = {};
      DIAS_SEMANA.forEach((d) => {
        if (document.querySelector(`.chk-dia-trabalha[data-dia="${d}"]`).checked) disp[d] = lerPeriodosBrutos(d);
      });
      const primeiro = DIAS_SEMANA.find((d) => disp[d]);
      if (primeiro) preencherListaPeriodos("geral", disp[primeiro]);
      document.querySelectorAll("#config-dias-trabalho .dia-trabalho").forEach((b) => {
        b.setAttribute("aria-pressed", String(!!disp[b.dataset.dia]));
      });
      // Volta pro horário único: a modalidade geral passa a ser a soma das dos dias
      const usadas = new Set(modalidadesMarcadasPorDia(Object.keys(disp)).flat());
      if (usadas.size) {
        document.getElementById("config-modalidade-online").checked = usadas.has("online");
        document.getElementById("config-modalidade-presencial").checked = usadas.has("presencial");
      }
    }
  }
  modoSemana = modo;
  document.getElementById("config-semana-igual").hidden = modo !== "igual";
  document.getElementById("config-dias-semana").hidden = modo !== "dia";
  document.getElementById("btn-modo-igual").classList.toggle("ativa", modo === "igual");
  document.getElementById("btn-modo-dia").classList.toggle("ativa", modo === "dia");
  // No "dia por dia", online/presencial é escolhido em cada dia
  document.getElementById("config-modalidades-gerais").hidden = modo === "dia";
  document.getElementById("dica-modalidades-por-dia").hidden = modo !== "dia";
}

function modalidadesMarcadasPorDia(dias) {
  return dias.map((d) => Array.from(document.querySelectorAll(`.chk-modalidade-semana[data-dia="${d}"]:checked`)).map((c) => c.value));
}

// Monta disponibilidade[dia] a partir do formulário, no modo em uso
function lerSemanaDeTrabalho() {
  const disponibilidade = {};
  const modalidadesPorDia = {};
  if (modoSemana === "igual") {
    const dias = diasMarcados();
    if (!dias.length) return { erro: "Marque pelo menos um dia em que você trabalha." };
    const lidos = lerPeriodos("geral", "Períodos de trabalho");
    if (lidos.erro) return lidos;
    if (!lidos.periodos.length) return { erro: "Adicione pelo menos um período de trabalho." };
    dias.forEach((d) => { disponibilidade[d] = lidos.periodos; });
  } else {
    for (const dia of DIAS_SEMANA) {
      if (!document.querySelector(`.chk-dia-trabalha[data-dia="${dia}"]`).checked) continue;
      const lidos = lerPeriodos(dia, NOMES_DIAS_SEMANA[dia]);
      if (lidos.erro) return lidos;
      if (!lidos.periodos.length) return { erro: `${NOMES_DIAS_SEMANA[dia]}: adicione um período ou desmarque o dia.` };
      const [modalidades] = modalidadesMarcadasPorDia([dia]);
      if (!modalidades.length) return { erro: `${NOMES_DIAS_SEMANA[dia]}: marque se atende online, presencial ou os dois.` };
      disponibilidade[dia] = lidos.periodos;
      modalidadesPorDia[dia] = modalidades;
    }
    if (!Object.keys(disponibilidade).length) return { erro: "Marque pelo menos um dia em que você trabalha." };
    return { disponibilidade, modalidadesPorDia };
  }
  return { disponibilidade };
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
  const intervaloMinutos = Number(document.getElementById("config-intervalo-aula").value) || 0;

  const lida = lerSemanaDeTrabalho();
  if (lida.erro) {
    alert(lida.erro);
    return;
  }
  const disponibilidade = lida.disponibilidade;

  // Modo "igual": uma modalidade geral. Modo "dia por dia": cada dia tem a sua, e a
  // geral vira a soma delas (usada onde não houver nada mais específico).
  const modalidadesPorDia = lida.modalidadesPorDia || {};
  const modalidades = lida.modalidadesPorDia
    ? ["online", "presencial"].filter((m) => Object.values(modalidadesPorDia).some((l) => l.includes(m)))
    : modalidadesGeraisDoFormulario();
  if (modalidades.length === 0) {
    alert("Selecione pelo menos uma modalidade de atendimento (online ou presencial).");
    return;
  }

  const whatsapp = document.getElementById("config-whatsapp").value.trim();
  const digitos = apenasDigitos(whatsapp);
  if (whatsapp && (digitos.length < 10 || digitos.length > 13)) {
    alert("WhatsApp inválido — use DDD + número (ex: 11 91234-5678), ou deixe em branco.");
    return;
  }
  const mesesLiberados = Array.from(document.querySelectorAll(".chk-mes-liberado:checked")).map((c) => c.value);
  const dados = { duracaoAulaMinutos, intervaloMinutos, modalidades, modalidadesPorDia, disponibilidade, whatsapp, mesesLiberados };
  try {
    await db.collection("usuarios").doc(professorIdAtual)
      .collection("configuracaoAgenda").doc("dados").set(dados);
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar a disponibilidade. Tente novamente.");
    return;
  }

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
  if (status === "pendente") return "Aguardando aprovação";
  if (status === "recusada") return "Reposição recusada";
  if (status === "nao-realizada") return "Não realizada";
  return "Agendada";
}

// Botões de uma aula nas listas: concluir/cancelar, ou aprovar/recusar um pedido
function acoesAulaHtml(a) {
  if (a.status === "agendada") return `
        <div class="aula-acoes">
          <button class="btn btn-secundario" style="padding:0.35em 0.8em; font-size:0.8rem;" onclick="concluirAula('${a.id}')">Concluir</button>
          <button class="excluir" onclick="cancelarAulaComoProfessor('${a.id}')">Cancelar</button>
        </div>`;
  if (a.status === "pendente") return `
        <div class="aula-acoes">
          <button class="btn btn-primario btn-mini" onclick="aprovarPedidoReposicao('${a.id}')">Aprovar</button>
          <button class="excluir" onclick="recusarPedidoReposicao('${a.id}')">Recusar</button>
        </div>`;
  if (a.status === "nao-realizada") return `
        <div class="aula-acoes">
          <button class="btn btn-secundario btn-mini" onclick="desfazerAulaNaoRealizada('${a.id}')">Desfazer</button>
        </div>`;
  return "";
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
  const idiomasPorDia = {}; // {data: [códigos de idioma das aulas agendadas nesse dia]}
  aulasCache.forEach((a) => {
    if ((a.status === "agendada" || a.status === "pendente") && a.data.startsWith(prefixoMes)) {
      contagemPorDia[a.data] = (contagemPorDia[a.data] || 0) + 1;
      (idiomasPorDia[a.data] = idiomasPorDia[a.data] || new Set()).add(idiomaValido(a.idioma));
    }
  });
  const variosIdiomas = idiomasAtuaisProfessor.length > 1;

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
        ${variosIdiomas && idiomasPorDia[dataIso] ? `<span class="cal-idiomas">${[...idiomasPorDia[dataIso]].map((id) => `<i style="background:${IDIOMAS[id].cor}" title="${IDIOMAS[id].nome}"></i>`).join("")}</span>` : ""}
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
        ${variosIdiomas ? idiomasAtuaisProfessor.map((id) => `<span><i class="dot" style="background:${IDIOMAS[id].cor}"></i> Aula de ${IDIOMAS[id].nome}</span>`).join("") : ""}
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
      // Com o "Marcar aula" aberto ao lado, o dia clicado já vai para o formulário
      const formularioAberto = !document.getElementById("modal-marcar-aula").classList.contains("modal-oculto");
      if (formularioAberto && dataIso >= dataDeHojeISO()) {
        document.getElementById("marcar-data").value = dataIso;
        selecionarDiaMarcarAula();
      }
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
        <div class="cabecalho-dia-professor">
          <h3 id="titulo-dia-professor" style="font-size:0.95rem;"></h3>
          <button class="btn btn-secundario btn-mini" onclick="abrirMarcarAula('', diaSelecionadoProfessor)">Marcar aula neste dia</button>
        </div>
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

// Etiqueta colorida com o idioma da aula (só quando o professor ensina mais de um idioma;
// aulas antigas, sem o campo, contam como inglês)
function badgeIdiomaAula(aula) {
  if (idiomasAtuaisProfessor.length < 2) return "";
  const idioma = IDIOMAS[idiomaValido(aula.idioma)];
  return `<span class="badge-idioma" style="background:${idioma.cor}">${idioma.nome}</span>`;
}

function aulasAtivasDoDia(dataIso) {
  return aulasCache
    .filter((a) => a.data === dataIso && a.status !== "cancelada" && a.status !== "recusada")
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
    campo(a.id, `Aula ${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))} — ${escapeHtml(a.alunoNome)}`)
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
    .filter((a) => a.data === dataIso && a.status !== "cancelada" && a.status !== "recusada")
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

  if (aulasDoDia.length === 0) return `<p class="vazio">Nenhuma aula marcada nesse dia.</p>`;

  return aulasDoDia.map((a) => `
    <div class="cartao-aula">
      <div class="aula-info">
        <strong>${escapeHtml(a.alunoNome)}</strong>
        <span>${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
        ${a.reposicao ? '<span class="badge-status badge-reposicao">Reposição</span>' : ""}
        ${badgeIdiomaAula(a)}
        <span class="badge-status badge-status-${a.status}">${legendaStatusAula(a.status)}</span>
      </div>
      ${acoesAulaHtml(a)}
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
  const modalidadesBase = modalidadesDaData(configAgendaAtual, overridesAgendaCache, dataIso);
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
  if (!confirm("Cancelar essa aula? O horário volta a ficar livre.\n\nPara o aluno repor essa aula, dê 1 crédito de reposição para ele em \"Meus Alunos\".")) return;

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
  const aula = aulasCache.find((a) => a.id === aulaId);
  const agora = new Date();
  const aindaNaoComecou = aula && (aula.data > dataDeHojeISO() ||
    (aula.data === dataDeHojeISO() && minutosDoHorario(aula.horaInicio) > agora.getHours() * 60 + agora.getMinutes()));
  if (aindaNaoComecou && !confirm("Essa aula ainda não aconteceu. Marcar como concluída mesmo assim?")) return;
  try {
    await db.collection("aulas").doc(aulaId).update({ status: "concluida" });
  } catch (e) {
    console.error(e);
    alert("Não foi possível concluir a aula agora. Tente novamente.");
  }
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
        <span>${formatarDataBR(a.data)} · ${escapeHtml(faixaHorario(a.horaInicio, a.horaFim))}</span>
        <span class="badge-modalidade badge-${a.modalidade}">${legendaModalidade(a.modalidade)}</span>
        ${a.reposicao ? '<span class="badge-status badge-reposicao">Reposição</span>' : ""}
        ${badgeIdiomaAula(a)}
        <span class="badge-status badge-status-${a.status}">${legendaStatusAula(a.status)}</span>
      </div>
      ${acoesAulaHtml(a)}
    </div>
  `).join("");
}

// -------------------- ALUNOS SEM APP --------------------
// Para quem não consegue usar o app: o professor cadastra o aluno (nome e
// WhatsApp) e marca as aulas por ele. Enquanto o aluno estiver sem aula marcada
// (ou com reposição para usar), a agenda mostra um lembrete — todo dia, até a
// aula ser marcada.

function escutarAlunosSemApp(uid) {
  db.collection("usuarios").doc(uid).collection("alunosSemApp").orderBy("nome")
    .onSnapshot((snap) => {
      alunosSemAppCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderizarAlunosSemApp();
      renderizarHojeProfessor();
    }, (erro) => console.warn("Não foi possível carregar os alunos sem app:", erro));
}

// Próxima aula marcada (ainda por acontecer) de um aluno — num idioma, se informado — ou null
function proximaAulaDoAluno(alunoId, idioma) {
  const agora = new Date();
  return aulasCache
    .filter((a) => a.alunoId === alunoId && a.status === "agendada" && fimDaAula(a) > agora &&
      (!idioma || aulaDoIdioma(a, idioma)))
    .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio))[0] || null;
}

function lembretesAlunosSemApp() {
  return alunosSemAppCache.map((aluno) => {
    const idioma = idiomaDoAlunoSemApp(aluno);
    const { saldo } = creditosDoAluno(aluno.id, idioma);
    const motivos = [];
    if (idiomasAtuaisProfessor.length > 1) motivos.push(IDIOMAS[idioma].nome);
    if (!proximaAulaDoAluno(aluno.id, idioma)) motivos.push("nenhuma aula marcada");
    if (saldo > 0) motivos.push(saldo === 1 ? "1 reposição para marcar" : `${saldo} reposições para marcar`);
    return motivos.length ? { aluno, motivo: motivos.join(" · ") } : null;
  }).filter(Boolean);
}

function renderizarAlunosSemApp() {
  const lista = document.getElementById("lista-alunos-sem-app");
  if (!lista) return;
  if (alunosSemAppCache.length === 0) {
    lista.innerHTML = `<p class="vazio">Nenhum aluno sem app cadastrado.</p>`;
    return;
  }
  lista.innerHTML = alunosSemAppCache.map((aluno) => {
    const idioma = idiomaDoAlunoSemApp(aluno);
    const proxima = proximaAulaDoAluno(aluno.id, idioma);
    const { saldo } = creditosDoAluno(aluno.id, idioma);
    const link = aluno.telefone ? linkWhatsapp(aluno.telefone, `Olá ${aluno.nome}! Tudo bem?`) : "";
    return `
      <div class="cartao-aluno-sem-app">
        <div class="aula-info">
          <strong>${escapeHtml(aluno.nome)}</strong>
          ${idiomasAtuaisProfessor.length > 1 ? `<span class="badge-idioma" style="background:${IDIOMAS[idioma].cor}">${IDIOMAS[idioma].nome}</span>` : ""}
          ${aluno.telefone ? `<span>${escapeHtml(aluno.telefone)}${link ? ` — <a href="${link}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</span>` : ""}
          <span class="${proxima ? "" : "aviso-pedido"}">${proxima ? `Próxima aula: ${formatarDataBR(proxima.data)} · ${escapeHtml(faixaHorario(proxima.horaInicio, proxima.horaFim))}` : "Nenhuma aula marcada"}</span>
        </div>
        <div class="campo-plano">
          <span>Reposições disponíveis</span>
          <div class="contador-reposicoes">
            <button type="button" class="btn-contador" aria-label="Tirar 1 reposição" onclick="ajustarReposicoesSemApp('${aluno.id}', -1)" ${saldo === 0 ? "disabled" : ""}>−</button>
            <strong class="saldo-reposicoes">${saldo}</strong>
            <button type="button" class="btn-contador" aria-label="Dar 1 reposição" onclick="ajustarReposicoesSemApp('${aluno.id}', 1)">+</button>
          </div>
        </div>
        <div class="aula-acoes">
          <button class="btn btn-primario btn-mini" onclick="abrirMarcarAula('${aluno.id}')">Marcar aula</button>
          <button class="excluir" onclick="removerAlunoSemApp('${aluno.id}')">Remover</button>
        </div>
      </div>`;
  }).join("");
}

async function adicionarAlunoSemApp() {
  const nome = document.getElementById("input-nome-sem-app").value.trim().slice(0, 100);
  const telefone = document.getElementById("input-telefone-sem-app").value.trim().slice(0, 30);
  const idioma = idiomaValido(document.getElementById("input-idioma-sem-app").value || idiomasAtuaisProfessor[0]);
  if (!nome) { alert("Digite o nome do aluno."); return; }
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("alunosSemApp").add({
      nome, telefone, idioma, reposicoesConcedidas: 0, criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("input-nome-sem-app").value = "";
    document.getElementById("input-telefone-sem-app").value = "";
  } catch (e) {
    console.error(e);
    alert("Não foi possível cadastrar o aluno. Tente novamente.");
  }
}

async function ajustarReposicoesSemApp(alunoId, delta) {
  const aluno = alunosSemAppCache.find((a) => a.id === alunoId);
  if (!aluno) return;
  const idioma = idiomaDoAlunoSemApp(aluno);
  const { usadas, saldo } = creditosDoAluno(alunoId, idioma);
  const novoSaldo = Math.max(0, saldo + delta);
  if (novoSaldo === saldo) return;
  const lote = db.batch();
  gravarReposicoesConcedidas(lote, alunoId, idioma, usadas + novoSaldo);
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível salvar as reposições. Tente novamente.");
  }
}

// Remove o cadastro e cancela as próximas aulas dele (o horário volta a ficar livre)
async function removerAlunoSemApp(alunoId) {
  const aluno = alunosSemAppCache.find((a) => a.id === alunoId);
  if (!aluno) return;
  if (!confirm(`Remover ${aluno.nome}? As próximas aulas marcadas para ele(a) são canceladas.`)) return;
  const agora = new Date();
  const lote = db.batch();
  aulasCache
    .filter((a) => a.alunoId === alunoId && a.status === "agendada" && fimDaAula(a) > agora)
    .forEach((a) => lote.update(db.collection("aulas").doc(a.id), { status: "cancelada", canceladoPor: "professor" }));
  lote.delete(db.collection("usuarios").doc(professorIdAtual).collection("alunosSemApp").doc(alunoId));
  try {
    await lote.commit();
  } catch (e) {
    console.error(e);
    alert("Não foi possível remover o aluno. Tente novamente.");
  }
}

// -------------------- MARCAR AULA PELO PROFESSOR --------------------
// Para qualquer aluno: os do app e os sem app. O professor escolhe dia, horário e
// modalidade livremente (pode até ser fora da disponibilidade configurada); só não
// deixa encavalar com outra aula já marcada.

function abrirMarcarAula(alunoId, dataIso) {
  const seletor = document.getElementById("marcar-aluno");
  const opcao = (a) => `<option value="${a.id}" ${a.id === alunoId ? "selected" : ""}>${escapeHtml(a.nome)}</option>`;
  seletor.innerHTML = `<option value="">Escolha o aluno</option>` +
    (alunosCache.length ? `<optgroup label="Alunos do app">${alunosCache.map(opcao).join("")}</optgroup>` : "") +
    (alunosSemAppCache.length ? `<optgroup label="Alunos sem app">${alunosSemAppCache.map(opcao).join("")}</optgroup>` : "");

  const campoData = document.getElementById("marcar-data");
  campoData.min = dataDeHojeISO();
  campoData.value = dataIso || dataDeHojeISO();
  horarioEscolhidoMarcar = null;
  definirHorarioManual(false);
  renderizarHorariosMarcarAula();

  const modalidades = (configAgendaAtual && configAgendaAtual.modalidades && configAgendaAtual.modalidades.length)
    ? configAgendaAtual.modalidades : ["online", "presencial"];
  document.getElementById("marcar-modalidade").innerHTML = ["online", "presencial"]
    .map((m) => `<option value="${m}" ${m === modalidades[0] ? "selected" : ""}>${legendaModalidade(m)}</option>`).join("");

  const campoIdioma = document.getElementById("marcar-idioma");
  campoIdioma.innerHTML = idiomasAtuaisProfessor.map((id) => `<option value="${id}">${IDIOMAS[id].nome}</option>`).join("");
  document.getElementById("marcar-idioma-wrap").hidden = idiomasAtuaisProfessor.length < 2;
  escolherIdiomaDoAlunoNoFormulario();

  document.getElementById("status-marcar-aula").textContent = "";
  atualizarReposicaoMarcarAula();
  // O formulário fica ao lado do calendário, na Agenda (pode ter sido aberto em "Meus Alunos")
  mostrarAbaProfessor("agenda");
  const painel = document.getElementById("modal-marcar-aula");
  painel.classList.remove("modal-oculto");
  painel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Horários livres do dia, iguais aos que o aluno vê ao agendar: a disponibilidade do
// professor (com a exceção do dia, se houver), em aulas da duração configurada, sem
// os horários já ocupados. "Outro horário" deixa marcar fora disso.
let horarioEscolhidoMarcar = null;
let horarioManualMarcar = false;

function formularioMarcarAulaAberto() {
  const painel = document.getElementById("modal-marcar-aula");
  return painel && !painel.classList.contains("modal-oculto");
}

function duracaoDasAulas() {
  return (configAgendaAtual && configAgendaAtual.duracaoAulaMinutos) || DURACAO_PADRAO_MINUTOS;
}

function horariosLivresDoDia(dataIso) {
  const override = overridesAgendaCache[dataIso];
  const blocos = override
    ? (override.fechado ? [] : override.blocos || [])
    : ((configAgendaAtual && configAgendaAtual.disponibilidade) || {})[chaveDiaSemana(dataIso)] || [];
  const duracao = duracaoDasAulas();
  const ocupadas = aulasCache.filter((a) => a.data === dataIso && ["agendada", "pendente", "concluida"].includes(a.status));
  let horarios = slotsSemConflito(gerarSlotsDoDia(blocos, duracao, configAgendaAtual && configAgendaAtual.intervaloMinutos), duracao, ocupadas);
  if (dataIso === dataDeHojeISO()) {
    const agora = new Date();
    horarios = horarios.filter((h) => minutosDoHorario(h) > agora.getHours() * 60 + agora.getMinutes());
  }
  return horarios;
}

function renderizarHorariosMarcarAula() {
  const container = document.getElementById("marcar-slots");
  if (!container || !formularioMarcarAulaAberto()) return;
  const data = document.getElementById("marcar-data").value;
  if (!data) {
    container.innerHTML = `<p class="vazio">Escolha o dia para ver os horários.</p>`;
    return;
  }
  const horarios = horariosLivresDoDia(data);
  if (horarioEscolhidoMarcar && !horarios.includes(horarioEscolhidoMarcar)) horarioEscolhidoMarcar = null;
  if (horarios.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhum horário livre na sua disponibilidade nesse dia.</p>`;
    return;
  }
  const duracao = duracaoDasAulas();
  container.innerHTML = `<div class="slots-grade">${horarios.map((h) => `
    <button type="button" class="btn-slot-horario${h === horarioEscolhidoMarcar && !horarioManualMarcar ? " escolhido" : ""}"
      aria-pressed="${h === horarioEscolhidoMarcar && !horarioManualMarcar}" onclick="escolherHorarioMarcarAula('${h}')">${faixaHorario(h, somarMinutos(h, duracao))}</button>`).join("")}
  </div>`;
}

function selecionarDiaMarcarAula() {
  horarioEscolhidoMarcar = null;
  document.getElementById("status-marcar-aula").textContent = "";
  renderizarHorariosMarcarAula();
}

function escolherHorarioMarcarAula(hora) {
  horarioEscolhidoMarcar = hora;
  definirHorarioManual(false);
  renderizarHorariosMarcarAula();
}

function definirHorarioManual(ligado) {
  horarioManualMarcar = ligado;
  const campo = document.getElementById("marcar-hora");
  campo.hidden = !ligado;
  if (!ligado) campo.value = "";
  document.getElementById("btn-outro-horario").textContent = ligado
    ? "Usar os horários da minha disponibilidade" : "Outro horário (fora da sua disponibilidade)";
}

function alternarHorarioManual() {
  definirHorarioManual(!horarioManualMarcar);
  if (horarioManualMarcar) document.getElementById("marcar-hora").focus();
  renderizarHorariosMarcarAula();
}

function fecharMarcarAula() {
  document.getElementById("modal-marcar-aula").classList.add("modal-oculto");
}

// Aluno sem app estuda um idioma só: escolher ele já escolhe o idioma da aula
function escolherIdiomaDoAlunoNoFormulario() {
  const semApp = alunosSemAppCache.find((a) => a.id === document.getElementById("marcar-aluno").value);
  if (semApp) document.getElementById("marcar-idioma").value = idiomaDoAlunoSemApp(semApp);
}

function trocarAlunoMarcarAula() {
  escolherIdiomaDoAlunoNoFormulario();
  atualizarReposicaoMarcarAula();
}

// A opção "reposição" só aparece se o aluno escolhido tem crédito no idioma da aula
function atualizarReposicaoMarcarAula() {
  const alunoId = document.getElementById("marcar-aluno").value;
  const idioma = idiomaValido(document.getElementById("marcar-idioma").value);
  const { saldo } = alunoId ? creditosDoAluno(alunoId, idioma) : { saldo: 0 };
  const wrap = document.getElementById("marcar-reposicao-wrap");
  const chk = document.getElementById("marcar-reposicao");
  wrap.hidden = saldo === 0;
  chk.checked = saldo > 0 && alunosSemAppCache.some((a) => a.id === alunoId) && !proximaAulaDoAluno(alunoId, idioma);
  document.getElementById("marcar-reposicao-saldo").textContent =
    `${saldo === 1 ? "1 disponível" : `${saldo} disponíveis`}${idiomasAtuaisProfessor.length > 1 ? ` em ${IDIOMAS[idioma].nome}` : ""}`;
}

async function confirmarMarcarAula() {
  const status = document.getElementById("status-marcar-aula");
  const alunoId = document.getElementById("marcar-aluno").value;
  const data = document.getElementById("marcar-data").value;
  const hora = horarioManualMarcar ? document.getElementById("marcar-hora").value : horarioEscolhidoMarcar;
  const modalidade = document.getElementById("marcar-modalidade").value;
  const idioma = document.getElementById("marcar-idioma").value;
  const reposicao = !document.getElementById("marcar-reposicao-wrap").hidden && document.getElementById("marcar-reposicao").checked;
  const aluno = alunosCache.find((a) => a.id === alunoId) || alunosSemAppCache.find((a) => a.id === alunoId);

  if (!aluno) { status.textContent = "Escolha o aluno."; return; }
  if (!data || !hora) { status.textContent = "Escolha o dia e o horário."; return; }
  const duracao = (configAgendaAtual && configAgendaAtual.duracaoAulaMinutos) || DURACAO_PADRAO_MINUTOS;
  const horaFim = somarMinutos(hora, duracao);
  if (new Date(`${data}T${hora}:00`) < new Date()) { status.textContent = "Esse horário já passou."; return; }

  const inicio = minutosDoHorario(hora), fim = inicio + duracao;
  const choque = aulasCache.find((a) => a.data === data && ["agendada", "pendente", "concluida"].includes(a.status) &&
    minutosDoHorario(a.horaInicio) < fim && minutosDoHorario(a.horaFim || somarMinutos(a.horaInicio, duracao)) > inicio);
  if (choque) {
    status.textContent = `Esse horário bate com a aula de ${choque.alunoNome} às ${choque.horaInicio}.`;
    return;
  }

  status.textContent = "Marcando...";
  try {
    await agendarAula(professorIdAtual, data, hora, horaFim, modalidade, aluno.id, aluno.nome, reposicao, idioma, "agendada");
    if (alunosCache.some((a) => a.id === aluno.id)) {
      db.collection("usuarios").doc(aluno.id).collection("notificacoes")
        .add(notificacaoParaAluno("aula-marcada", `Seu professor marcou ${reposicao ? "uma reposição" : "uma aula"} de ${IDIOMAS[idiomaValido(idioma)].nome} para você: ${formatarDataBR(data)} às ${hora}.`, idioma))
        .catch((e) => console.warn("Não foi possível avisar o aluno da aula marcada:", e));
    }
    fecharMarcarAula();
  } catch (e) {
    console.error(e);
    status.textContent = e.message && /reservado/.test(e.message) ? e.message : "Não foi possível marcar a aula. Tente novamente.";
  }
}
