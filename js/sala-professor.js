// ============================================================
// ABA DOCUMENTOS DO PROFESSOR — Documentos de aula, Banco de dados e relatórios
// ============================================================
// - Documentos de aula: a biblioteca de arquivos do professor
//   (usuarios/{professor}/biblioteca). Cada arquivo diz quem vê: todos os alunos
//   ou só alguns. Os alunos veem dentro do app, sem botão de baixar.
// - Banco de dados: tudo o que está nas janelas dos alunos — os arquivos e links da
//   sala de cada aluno e os Documentos de aula que cada um pode ver.
// - Relatório mensal de cada aluno: o do mês só libera no dia 1º do mês seguinte.
// Usa o estado de professor.js (professorIdAtual, alunosCache, aulasCache...).
// ============================================================

const TAMANHO_MAXIMO_BIBLIOTECA = 25 * 1024 * 1024; // 25 MB (até 28 pedaços de 900 KB)

let bibliotecaCache = [];
let filtroTipoBiblioteca = "";
let buscaBiblioteca = "";
let paginaBiblioteca = 1;
let arquivoBiblioteca = null;      // escolhido e ainda não enviado
let enviandoBiblioteca = false;
// "Quem vê": o do formulário de envio e o do arquivo em edição
const quemVeEnvio = { paraTodos: true, alunos: new Set() };
let edicaoQuemVe = null;           // {id, paraTodos, alunos: Set} ou null

function mostrarJanelaSala(janela) {
  document.getElementById("janela-documentos").hidden = janela !== "documentos";
  document.getElementById("janela-banco").hidden = janela !== "banco";
  document.getElementById("btn-janela-documentos").classList.toggle("ativa", janela === "documentos");
  document.getElementById("btn-janela-banco").classList.toggle("ativa", janela === "banco");
  if (janela === "banco") carregarBancoDeDados();
}

function escutarBiblioteca(uid) {
  db.collection("usuarios").doc(uid).collection("biblioteca").onSnapshot((snap) => {
    bibliotecaCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((b.criadoEm && b.criadoEm.toMillis()) || Date.now()) - ((a.criadoEm && a.criadoEm.toMillis()) || Date.now()));
    renderizarSalaProfessor();
  }, (e) => console.warn("Não foi possível carregar os Documentos de aula:", e));
}

// Chamado também quando a lista de alunos muda (os nomes aparecem em "quem vê")
function renderizarSalaProfessor() {
  if (!document.getElementById("lista-biblioteca")) return;
  document.getElementById("quem-ve-envio").innerHTML = montarQuemVe(quemVeEnvio, "envio");
  renderizarBiblioteca();
  if (bancoPorAluno) renderizarBanco();
}

// -------------------- QUEM VÊ --------------------

function estadoQuemVe(prefixo) {
  return prefixo === "envio" ? quemVeEnvio : edicaoQuemVe;
}

function montarQuemVe(estado, prefixo) {
  const lista = estado.paraTodos ? "" : (alunosCache.length
    ? `<div class="alunos-quem-ve">${alunosCache.map((a) => `
        <label><input type="checkbox" ${estado.alunos.has(a.id) ? "checked" : ""} onchange="alternarAlunoQuemVe('${prefixo}', '${a.id}')"> ${escapeHtml(a.nome)}</label>`).join("")}</div>`
    : `<p class="vazio-inline">Nenhum aluno vinculado ainda.</p>`);
  return `
    <span class="rotulo-quem-ve">Quem vê:</span>
    <label><input type="radio" name="quem-ve-${prefixo}" ${estado.paraTodos ? "checked" : ""} onchange="definirQuemVe('${prefixo}', true)"> Todos os meus alunos</label>
    <label><input type="radio" name="quem-ve-${prefixo}" ${estado.paraTodos ? "" : "checked"} onchange="definirQuemVe('${prefixo}', false)"> Só alguns alunos</label>
    ${lista}`;
}

function definirQuemVe(prefixo, paraTodos) {
  estadoQuemVe(prefixo).paraTodos = paraTodos;
  renderizarSalaProfessor();
}

function alternarAlunoQuemVe(prefixo, alunoId) {
  const alunos = estadoQuemVe(prefixo).alunos;
  if (alunos.has(alunoId)) alunos.delete(alunoId); else alunos.add(alunoId);
}

function textoQuemVe(d) {
  if (d.paraTodos) return "Todos os alunos";
  const nomes = (d.alunos || []).map((id) => (alunosCache.find((a) => a.id === id) || {}).nome).filter(Boolean);
  if (!nomes.length) return "Nenhum aluno";
  return nomes.length <= 3 ? nomes.join(", ") : `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}`;
}

// Alunos (do app) que veem um arquivo da biblioteca
function alunosQueVeem(d) {
  return d.paraTodos ? alunosCache : alunosCache.filter((a) => (d.alunos || []).includes(a.id));
}

// -------------------- DOCUMENTOS DE AULA (biblioteca) --------------------

function escolherArquivoBiblioteca(arquivo) {
  const status = document.getElementById("status-biblioteca");
  const nome = document.getElementById("nome-arquivo-biblioteca");
  status.textContent = "";
  arquivoBiblioteca = null;
  if (arquivo && !arquivoVisualizavel(arquivo.type, arquivo.name)) {
    status.textContent = "Esse tipo de arquivo não abre dentro do app, e os alunos não podem baixar. Envie PDF, imagem, vídeo, áudio ou texto (um Word ou PowerPoint pode ser salvo como PDF).";
  } else if (arquivo && arquivo.size > TAMANHO_MAXIMO_BIBLIOTECA) {
    status.textContent = `Esse arquivo tem ${formatarTamanhoArquivo(arquivo.size)}. O limite é 25 MB — para vídeos maiores, use um link (ex: YouTube não listado) na sala do aluno.`;
  } else if (arquivo) {
    arquivoBiblioteca = arquivo;
    const titulo = document.getElementById("titulo-biblioteca");
    if (!titulo.value.trim()) titulo.value = arquivo.name.replace(/\.[^.]+$/, "").slice(0, 200);
  }
  nome.hidden = !arquivoBiblioteca;
  nome.textContent = arquivoBiblioteca
    ? `${CATEGORIAS_ARQUIVO[categoriaDoArquivo(arquivoBiblioteca.type, arquivoBiblioteca.name)].icone} ${arquivoBiblioteca.name} (${formatarTamanhoArquivo(arquivoBiblioteca.size)})` : "";
  if (!arquivoBiblioteca) document.getElementById("arquivo-biblioteca").value = "";
}

async function enviarParaBiblioteca() {
  if (enviandoBiblioteca) return;
  const status = document.getElementById("status-biblioteca");
  const botao = document.getElementById("btn-enviar-biblioteca");
  const arquivo = arquivoBiblioteca;
  const titulo = document.getElementById("titulo-biblioteca").value.trim().slice(0, 200);
  if (!arquivo) { status.textContent = "Escolha o arquivo."; return; }
  if (!titulo) { status.textContent = "Dê um título ao documento."; return; }
  const paraTodos = quemVeEnvio.paraTodos;
  const alunos = paraTodos ? [] : [...quemVeEnvio.alunos].filter((id) => alunosCache.some((a) => a.id === id));
  if (!paraTodos && !alunos.length) { status.textContent = "Escolha pelo menos um aluno, ou marque \"Todos os meus alunos\"."; return; }

  enviandoBiblioteca = true;
  botao.disabled = true;
  const docRef = db.collection("usuarios").doc(professorIdAtual).collection("biblioteca").doc();
  try {
    // Os pedaços primeiro: o aluno nunca vê um documento com o arquivo pela metade
    const partes = await enviarPartesDoArquivo(docRef, arquivo, (pct) => { status.textContent = `Enviando ${pct}%...`; });
    await docRef.set({
      titulo, nomeArquivo: arquivo.name.slice(0, 200), tipoArquivo: (arquivo.type || "").slice(0, 200),
      tamanho: arquivo.size, partes, paraTodos, alunos, criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    apagarPartesDoDocumento(docRef).catch(() => {}); // não deixa pedaços soltos
    status.textContent = mensagemErroGravacao(e, "Não foi possível enviar o arquivo.").replace(/\n+/g, " ");
    enviandoBiblioteca = false;
    botao.disabled = false;
    return;
  }
  avisarAlunosDoDocumento({ titulo, paraTodos, alunos });
  enviandoBiblioteca = false;
  botao.disabled = false;
  // Limpa o formulário só se o professor não escolheu outro arquivo durante o envio
  if (arquivoBiblioteca === arquivo) {
    const campoTitulo = document.getElementById("titulo-biblioteca");
    if (campoTitulo.value.trim().slice(0, 200) === titulo) campoTitulo.value = "";
    escolherArquivoBiblioteca(null);
    quemVeEnvio.paraTodos = true;
    quemVeEnvio.alunos.clear();
    renderizarSalaProfessor();
  }
  status.textContent = `"${titulo}" enviado.`;
}

// Notificação no sino de cada aluno que passa a ver o documento
function avisarAlunosDoDocumento(d, soEstes) {
  const alunos = (soEstes || alunosQueVeem(d)).slice(0, 400);
  if (!alunos.length) return;
  const lote = db.batch();
  alunos.forEach((a) => lote.set(db.collection("usuarios").doc(a.id).collection("notificacoes").doc(),
    notificacaoParaAluno("documento-aula", `Novo documento de aula: "${d.titulo}". Veja em Sala de aula.`.slice(0, 300), idiomasAtuaisProfessor[0])));
  lote.commit().catch((e) => console.warn("Não foi possível avisar os alunos do documento:", e));
}

function buscarNaBiblioteca(texto) {
  buscaBiblioteca = texto;
  paginaBiblioteca = 1;
  renderizarBiblioteca();
}

function filtrarBibliotecaPorTipo(tipo) {
  filtroTipoBiblioteca = tipo;
  paginaBiblioteca = 1;
  renderizarBiblioteca();
}

function irParaPaginaBiblioteca(n) {
  paginaBiblioteca = n;
  renderizarBiblioteca();
}

function renderizarBiblioteca() {
  const lista = document.getElementById("lista-biblioteca");
  if (!lista) return;
  if (!bibliotecaCache.length) {
    lista.innerHTML = `<p class="vazio">Nenhum documento ainda. Envie o primeiro acima.</p>`;
    return;
  }
  const encontrados = filtrarDocumentos(bibliotecaCache, filtroTipoBiblioteca, buscaBiblioteca);
  // O arquivo com "quem vê" aberto fica na página em que está
  if (edicaoQuemVe && encontrados.some((d) => d.id === edicaoQuemVe.id)) {
    paginaBiblioteca = Math.floor(encontrados.findIndex((d) => d.id === edicaoQuemVe.id) / DOCUMENTOS_POR_PAGINA) + 1;
  }
  const { itens: visiveis, pagina, total } = paginar(encontrados, paginaBiblioteca);
  paginaBiblioteca = pagina;
  lista.innerHTML = montarFiltroDeTipos(bibliotecaCache, filtroTipoBiblioteca, "filtrarBibliotecaPorTipo('%s')") +
    (visiveis.length ? visiveis.map((d) => {
      const cat = CATEGORIAS_ARQUIVO[categoriaDoArquivo(d.tipoArquivo, d.nomeArquivo)];
      const data = d.criadoEm ? d.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
      const editando = edicaoQuemVe && edicaoQuemVe.id === d.id;
      return `
        <div class="documento-aula item-biblioteca" data-id="${d.id}">
          <div class="linha-item-biblioteca">
            <span class="icone-tipo-documento" title="${cat.nome}">${cat.icone}</span>
            <div class="info-item-biblioteca">
              <button class="titulo-documento link-arquivo" onclick="abrirDaBiblioteca('${d.id}')">${escapeHtml(d.titulo)}</button>
              <span class="data-msg">${cat.nome} · ${formatarTamanhoArquivo(d.tamanho)} · ${escapeHtml(data)}</span>
              <span class="data-msg quem-ve-resumo">👁 ${escapeHtml(textoQuemVe(d))}</span>
            </div>
            <div class="aula-acoes">
              <button class="btn btn-secundario btn-mini" onclick="editarQuemVe('${d.id}')">Quem vê</button>
              <button class="excluir" onclick="excluirDaBiblioteca('${d.id}')">Excluir</button>
            </div>
          </div>
          ${editando ? `
            <div class="quem-ve editor-quem-ve">
              ${montarQuemVe(edicaoQuemVe, "edicao")}
              <div class="acoes-edicao-nota">
                <button class="btn btn-primario btn-mini" onclick="salvarQuemVe()">Salvar</button>
                <button class="link-trocar" onclick="cancelarQuemVe()">Cancelar</button>
              </div>
            </div>` : ""}
        </div>`;
    }).join("") : `<p class="vazio">Nenhum documento encontrado.</p>`) +
    montarPaginacao(pagina, total, "irParaPaginaBiblioteca(%n)");
}

function abrirDaBiblioteca(id) {
  const d = bibliotecaCache.find((x) => x.id === id);
  if (d) abrirVisualizador(db.collection("usuarios").doc(professorIdAtual).collection("biblioteca").doc(id), d, true);
}

function editarQuemVe(id) {
  const d = bibliotecaCache.find((x) => x.id === id);
  if (!d) return;
  edicaoQuemVe = { id, paraTodos: !!d.paraTodos, alunos: new Set(d.alunos || []) };
  mostrarJanelaSala("documentos");
  renderizarBiblioteca();
  const item = document.querySelector(`.item-biblioteca[data-id="${id}"]`);
  if (item) item.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function cancelarQuemVe() {
  edicaoQuemVe = null;
  renderizarBiblioteca();
}

async function salvarQuemVe() {
  const d = bibliotecaCache.find((x) => x.id === (edicaoQuemVe && edicaoQuemVe.id));
  if (!d) return;
  const paraTodos = edicaoQuemVe.paraTodos;
  const alunos = paraTodos ? [] : [...edicaoQuemVe.alunos].filter((id) => alunosCache.some((a) => a.id === id));
  const antes = new Set(alunosQueVeem(d).map((a) => a.id));
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("biblioteca").doc(d.id).update({ paraTodos, alunos });
  } catch (e) {
    console.error(e);
    alert(mensagemErroGravacao(e, "Não foi possível salvar quem vê."));
    return;
  }
  // Avisa só quem passou a ver agora
  avisarAlunosDoDocumento(d, alunosQueVeem({ paraTodos, alunos }).filter((a) => !antes.has(a.id)));
  edicaoQuemVe = null;
  renderizarBiblioteca();
}

async function excluirDaBiblioteca(id) {
  const d = bibliotecaCache.find((x) => x.id === id);
  if (!d || !(await confirmar(`Excluir "${d.titulo}"? Os alunos deixam de vê-lo.`, { botao: "Excluir", perigo: true }))) return;
  try {
    const ref = db.collection("usuarios").doc(professorIdAtual).collection("biblioteca").doc(id);
    await apagarPartesDoDocumento(ref);
    await ref.delete();
  } catch (e) {
    console.error(e);
    alert(mensagemErroGravacao(e, "Não foi possível excluir o documento."));
  }
}

// -------------------- BANCO DE DADOS --------------------
// Uma linha por documento e aluno. Os documentos da sala de cada aluno são lidos
// ao abrir a janela (e no "Atualizar"); os da biblioteca vêm do cache em tempo real.

let bancoPorAluno = null;          // {alunoId: [documentos da sala dele]} ou null (não carregado)
let carregandoBanco = false;
let filtroAlunoBanco = "";
let filtroTipoBanco = "";
let buscaBanco = "";
let paginaBanco = 1;

async function carregarBancoDeDados() {
  if (carregandoBanco) return;
  carregandoBanco = true;
  if (!bancoPorAluno) document.getElementById("lista-banco").innerHTML = `<p class="vazio">Carregando...</p>`;
  const resultado = {};
  await Promise.all(alunosCache.map(async (a) => {
    try {
      const snap = await db.collection("usuarios").doc(a.id).collection("documentosAula").get();
      resultado[a.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.professorId === professorIdAtual);
    } catch (e) {
      console.warn("Não foi possível ler os documentos de", a.nome, e);
      resultado[a.id] = [];
    }
  }));
  bancoPorAluno = resultado;
  carregandoBanco = false;
  renderizarBanco();
}

function linhasDoBanco() {
  const linhas = [];
  alunosCache.forEach((a) => (bancoPorAluno[a.id] || []).forEach((d) =>
    linhas.push({ origem: "sala", aluno: a, alunoId: a.id, d })));
  bibliotecaCache.forEach((d) => {
    if (d.paraTodos) linhas.push({ origem: "biblioteca", aluno: null, alunoId: "*", d });
    else alunosQueVeem(d).forEach((a) => linhas.push({ origem: "biblioteca", aluno: a, alunoId: a.id, d }));
  });
  return linhas.sort((x, y) => ((y.d.criadoEm && y.d.criadoEm.toMillis()) || 0) - ((x.d.criadoEm && x.d.criadoEm.toMillis()) || 0));
}

function buscarNoBanco(texto) { buscaBanco = texto; paginaBanco = 1; renderizarBanco(); }
function filtrarBancoPorAluno(id) { filtroAlunoBanco = id; paginaBanco = 1; renderizarBanco(); }
function filtrarBancoPorTipo(tipo) { filtroTipoBanco = tipo; paginaBanco = 1; renderizarBanco(); }
function irParaPaginaBanco(n) { paginaBanco = n; renderizarBanco(); }

function renderizarBanco() {
  const lista = document.getElementById("lista-banco");
  const seletor = document.getElementById("filtro-aluno-banco");
  if (!lista || !bancoPorAluno) return;
  if (filtroAlunoBanco && !alunosCache.some((a) => a.id === filtroAlunoBanco)) filtroAlunoBanco = "";
  seletor.innerHTML = `<option value="">Todos os alunos</option>` +
    alunosCache.map((a) => `<option value="${a.id}" ${a.id === filtroAlunoBanco ? "selected" : ""}>${escapeHtml(a.nome)}</option>`).join("");

  // O aluno escolhido vê o que é dele e o que é para todos
  const doAluno = linhasDoBanco().filter((l) => !filtroAlunoBanco || l.alunoId === filtroAlunoBanco || l.alunoId === "*");
  if (!doAluno.length) {
    lista.innerHTML = `<p class="vazio">Nenhum documento nas janelas ${filtroAlunoBanco ? "desse aluno" : "dos alunos"} ainda.</p>`;
    return;
  }
  const termo = semAcentos(buscaBanco).trim();
  const encontrados = doAluno.filter((l) =>
    (!filtroTipoBanco || categoriaDoDocumento(l.d) === filtroTipoBanco) &&
    (!termo || semAcentos(`${l.d.titulo} ${l.d.nomeArquivo || ""} ${l.aluno ? l.aluno.nome : "todos os alunos"}`).includes(termo)));
  const { itens: visiveis, pagina, total } = paginar(encontrados, paginaBanco);
  paginaBanco = pagina;
  const alunosComDocumento = new Set(doAluno.filter((l) => l.aluno).map((l) => l.alunoId));
  lista.innerHTML = `
    ${montarFiltroDeTipos(doAluno.map((l) => l.d), filtroTipoBanco, "filtrarBancoPorTipo('%s')")}
    <p class="data-msg">${doAluno.length} ${doAluno.length === 1 ? "documento" : "documentos"}${alunosComDocumento.size ? ` · ${alunosComDocumento.size} ${alunosComDocumento.size === 1 ? "aluno" : "alunos"}` : ""}</p>
    <div class="tabela-banco">
      ${visiveis.length ? visiveis.map((l) => {
        const cat = CATEGORIAS_ARQUIVO[categoriaDoDocumento(l.d)];
        const data = l.d.criadoEm ? l.d.criadoEm.toDate().toLocaleDateString("pt-BR") : "";
        const abrir = l.d.url
          ? `<a class="titulo-documento" href="${escapeHtml(l.d.url)}" target="_blank" rel="noopener">${escapeHtml(l.d.titulo)}</a>`
          : `<button class="titulo-documento link-arquivo" onclick="abrirDoBanco('${l.origem}', '${l.alunoId}', '${l.d.id}')">${escapeHtml(l.d.titulo)}</button>`;
        const acao = l.origem === "sala"
          ? `<button class="excluir" onclick="removerDoBanco('${l.alunoId}', '${l.d.id}')">Excluir</button>`
          : `<button class="btn btn-secundario btn-mini" onclick="editarQuemVe('${l.d.id}')">Quem vê</button>`;
        return `
          <div class="linha-banco" data-origem="${l.origem}">
            <span class="icone-tipo-documento" title="${cat.nome}">${cat.icone}</span>
            <div class="info-item-biblioteca">
              ${abrir}
              <span class="data-msg">${l.aluno ? escapeHtml(l.aluno.nome) : "Todos os alunos"} · ${l.origem === "sala" ? "Sala do aluno" : "Documentos de aula"} · ${escapeHtml(data)}</span>
            </div>
            <div class="aula-acoes">${acao}</div>
          </div>`;
      }).join("") : `<p class="vazio">Nenhum documento encontrado.</p>`}
    </div>
    ${montarPaginacao(pagina, total, "irParaPaginaBanco(%n)")}`;
}

function abrirDoBanco(origem, alunoId, id) {
  if (origem === "biblioteca") { abrirDaBiblioteca(id); return; }
  const d = (bancoPorAluno[alunoId] || []).find((x) => x.id === id);
  if (d) abrirVisualizador(db.collection("usuarios").doc(alunoId).collection("documentosAula").doc(id), d, true);
}

async function removerDoBanco(alunoId, id) {
  await removerDocumentoAula(alunoId, id); // pede confirmação
  carregarBancoDeDados();
}

// -------------------- RELATÓRIO MENSAL --------------------
// O relatório de um mês só libera no dia 1º do mês seguinte (o mês precisa ter
// terminado). Abre numa aba nova, pronta para imprimir ou salvar em PDF.

const mesRelatorioEscolhido = {}; // {alunoId: "AAAA-MM"}

function chaveDoMes(data) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function nomeDoMes(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  return `${NOMES_MESES[mes - 1]} de ${ano}`;
}

// O mês atual e os 12 anteriores, do mais recente para o mais antigo
function mesesDoRelatorio() {
  const hoje = new Date();
  return Array.from({ length: 13 }, (_, i) => chaveDoMes(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)));
}

function relatorioLiberado(chave) {
  return chave < chaveDoMes(new Date());
}

// Dia em que o relatório de um mês libera (dia 1º do mês seguinte), "01/12/2026"
function diaQueLibera(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  return chaveDataISO(new Date(ano, mes, 1)).split("-").reverse().join("/");
}

function montarRelatorioMensal(alunoId) {
  const meses = mesesDoRelatorio();
  const escolhido = mesRelatorioEscolhido[alunoId] || meses[1]; // o mês passado
  const liberado = relatorioLiberado(escolhido);
  return `
    <div class="relatorio-mensal">
      <label>Relatório do mês
        <select onchange="mesRelatorioEscolhido['${alunoId}'] = this.value; renderizarListaAlunos(); renderizarAlunosSemApp()">
          ${meses.map((m) => `<option value="${m}" ${m === escolhido ? "selected" : ""}>${nomeDoMes(m)}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="btn btn-secundario btn-mini btn-emitir-relatorio" ${liberado ? "" : "disabled"} onclick="emitirRelatorioMensal('${alunoId}')">📄 Emitir relatório</button>
      ${liberado ? "" : `<span class="dica-plano">O relatório de ${nomeDoMes(escolhido).split(" de ")[0].toLowerCase()} libera em ${diaQueLibera(escolhido)}.</span>`}
    </div>`;
}

async function emitirRelatorioMensal(alunoId) {
  const mes = mesRelatorioEscolhido[alunoId] || mesesDoRelatorio()[1];
  if (!relatorioLiberado(mes)) return;
  const alunoApp = alunosCache.find((a) => a.id === alunoId);
  const semApp = alunosSemAppCache.find((a) => a.id === alunoId);
  const aluno = alunoApp || semApp;
  if (!aluno) return;
  // A aba é aberta antes de qualquer "await" (senão o navegador bloqueia o popup)
  const aba = window.open("", "_blank");
  if (!aba) { alert("O navegador bloqueou a nova aba. Permita pop-ups deste site e tente de novo."); return; }
  aba.document.write("<p style='font-family:sans-serif'>Montando o relatório...</p>");

  const noMes = (ts) => ts && chaveDoMes(ts.toDate()) === mes;
  const aulas = aulasCache.filter((a) => a.alunoId === alunoId && a.data.startsWith(mes))
    .sort((a, b) => (a.data + a.horaInicio).localeCompare(b.data + b.horaInicio));
  let registros = [], documentos = [];
  if (alunoApp) {
    try {
      const [r, d] = await Promise.all([
        db.collection("usuarios").doc(alunoId).collection("relatorios").get(),
        db.collection("usuarios").doc(alunoId).collection("documentosAula").get()
      ]);
      registros = r.docs.map((x) => x.data()).filter((x) => noMes(x.criadoEm)).sort((a, b) => a.criadoEm.toMillis() - b.criadoEm.toMillis());
      documentos = d.docs.map((x) => x.data()).filter((x) => x.professorId === professorIdAtual && noMes(x.criadoEm));
    } catch (e) {
      console.warn("Não foi possível ler os registros do aluno:", e);
    }
    documentos = documentos.concat(bibliotecaCache.filter((d) => noMes(d.criadoEm) && alunosQueVeem(d).some((a) => a.id === alunoId)));
  }
  const palavras = alunoApp ? garantirEstado(alunoId).palavras.filter((p) => noMes(p.criadoEm)) : [];
  if (aba.closed) return;
  aba.document.open();
  aba.document.write(htmlDoRelatorio({ aluno, semApp: !alunoApp, mes, aulas, registros, documentos, palavras }));
  aba.document.close();
}

function htmlDoRelatorio({ aluno, semApp, mes, aulas, registros, documentos, palavras }) {
  const e = escapeHtml;
  const varios = idiomasAtuaisProfessor.length > 1;
  const conta = (f) => aulas.filter(f).length;
  const realizadas = conta((a) => a.status === "concluida");
  const naoRealizadas = conta((a) => a.status === "nao-realizada");
  const canceladas = conta((a) => a.status === "cancelada");
  const semConfirmar = conta((a) => a.status === "agendada" && fimDaAula(a) <= new Date());
  const reposicoes = conta((a) => a.reposicao && a.status === "concluida");
  const minutosRepostos = aulas.filter((a) => a.reposicao && a.status === "concluida").reduce((t, a) => t + duracaoDaAula(a), 0);
  const nomeProfessor = document.getElementById("nome-usuario").textContent;
  const plano = !semApp ? idiomasAtuaisProfessor.map((id) => {
    const p = planoNoIdioma(aluno, id);
    return `${varios ? `${IDIOMAS[id].nome}: ` : ""}${p.aulasPorSemana ? `${p.aulasPorSemana} aula(s) por semana` : "sem limite de aulas por semana"}`;
  }).join(" · ") : "";
  const statusAula = (a) => a.status === "cancelada" ? `Cancelada${a.canceladoPor ? ` (pelo ${a.canceladoPor === "aluno" ? "aluno" : "professor"})` : ""}` : legendaStatusAula(a.status);
  const tabelaAulas = aulas.length ? `
    <table>
      <thead><tr><th>Data</th><th>Horário</th>${varios ? "<th>Idioma</th>" : ""}<th>Modalidade</th><th>Situação</th></tr></thead>
      <tbody>${aulas.map((a) => `<tr>
        <td>${formatarDataBR(a.data)}</td><td>${e(faixaHorario(a.horaInicio, a.horaFim))}</td>
        ${varios ? `<td>${IDIOMAS[idiomaValido(a.idioma)].nome}</td>` : ""}
        <td>${legendaModalidade(a.modalidade)}</td><td>${e(statusAula(a))}${a.reposicao ? " · reposição" : ""}</td></tr>`).join("")}</tbody>
    </table>` : `<p class="vazio">Nenhuma aula neste mês.</p>`;
  const secaoRegistros = semApp ? "" : `
    <h2>O que foi trabalhado nas aulas</h2>
    ${registros.length ? registros.map((r) => `<div class="registro"><span class="data">${r.criadoEm.toDate().toLocaleDateString("pt-BR")}</span> ${e(r.texto)}</div>`).join("")
      : `<p class="vazio">Nenhum registro de aula neste mês.</p>`}`;
  const secaoPalavras = semApp ? "" : `
    <h2>Vocabulário novo (${palavras.length} ${palavras.length === 1 ? "palavra" : "palavras"})</h2>
    ${palavras.length ? `<p class="palavras">${palavras.map((p) => `<span><strong>${e(p.palavraEn)}</strong> — ${e(p.traducaoPt)}</span>`).join("")}</p>`
      : `<p class="vazio">Nenhuma palavra nova neste mês.</p>`}`;
  const secaoDocumentos = semApp ? "" : `
    <h2>Documentos de aula do mês</h2>
    ${documentos.length ? `<ul>${documentos.map((d) => `<li>${e(d.titulo)}</li>`).join("")}</ul>` : `<p class="vazio">Nenhum documento novo neste mês.</p>`}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relatório ${e(nomeDoMes(mes))} — ${e(aluno.nome)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; max-width: 820px; margin: 0 auto; padding: 24px 16px; line-height: 1.45; }
      h1 { font-family: Georgia, serif; font-size: 1.5rem; margin: 0 0 4px; }
      h2 { font-size: 1.05rem; margin: 28px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .sub { color: #666; margin: 0 0 4px; }
      .resumo { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      .resumo div { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; min-width: 110px; }
      .resumo strong { display: block; font-size: 1.4rem; }
      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
      th { background: #f5f5f5; }
      .registro { margin: 6px 0; } .registro .data { color: #666; margin-right: 6px; }
      .palavras span { display: inline-block; margin: 0 14px 6px 0; }
      .vazio { color: #777; font-style: italic; }
      .acoes { margin: 0 0 18px; } .acoes button { padding: 8px 14px; font-size: 0.95rem; cursor: pointer; }
      @media print { .acoes { display: none; } body { padding: 0; } }
    </style></head><body>
    <div class="acoes"><button onclick="window.print()">🖨️ Imprimir / salvar em PDF</button></div>
    <h1>Relatório mensal — ${e(nomeDoMes(mes))}</h1>
    <p class="sub">Aluno: <strong>${e(aluno.nome)}</strong>${semApp ? " (sem app)" : ""} · Professor: ${e(nomeProfessor)}</p>
    ${plano ? `<p class="sub">Plano: ${e(plano)}</p>` : ""}
    <p class="sub">Emitido em ${new Date().toLocaleDateString("pt-BR")}</p>
    <div class="resumo">
      <div><strong>${realizadas}</strong>aulas realizadas</div>
      <div><strong>${reposicoes}</strong>reposições feitas${minutosRepostos ? ` (${formatarMinutos(minutosRepostos)})` : ""}</div>
      <div><strong>${naoRealizadas}</strong>não realizadas</div>
      <div><strong>${canceladas}</strong>canceladas</div>
      ${semConfirmar ? `<div><strong>${semConfirmar}</strong>sem confirmar</div>` : ""}
      ${semApp ? "" : `<div><strong>${palavras.length}</strong>palavras novas</div>`}
    </div>
    <h2>Aulas</h2>
    ${tabelaAulas}
    ${secaoRegistros}
    ${secaoPalavras}
    ${secaoDocumentos}
  </body></html>`;
}
