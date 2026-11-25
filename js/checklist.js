// ============================================================
// CHECKLIST DE TÓPICOS
// ============================================================
// O professor monta, em Configurações, a lista geral de tópicos (ex: "Present
// simple", "Verbo to be") e escolhe, em cada um, para quais alunos ele vale (todos
// ou só alguns). Em Meus alunos → aba Checklist, ele marca o que cada aluno já viu.
// O aluno acompanha a própria lista (só leitura) no painel dele.
//
// Dados: usuarios/{professor}/checklist/{topico} = {texto, paraTodos, alunos, criadoEm}
//        usuarios/{aluno}/checklistFeito/{topico} = {professorId, em}
// ============================================================

let checklistCache = [];                                   // tópicos do professor, na ordem em que foram criados
const quemUsaNovoTopico = { paraTodos: true, alunos: new Set() };
let edicaoTopicoChecklist = null;                          // {id, paraTodos, alunos: Set} do tópico com "Alunos" aberto

function topicoValeParaAluno(topico, alunoId) {
  return topico.paraTodos || (topico.alunos || []).includes(alunoId);
}

// Na ordem em que foram criados ("ordem" é gravada na hora; a hora do servidor pode
// chegar um pouco fora de ordem quando o professor adiciona vários em sequência)
function ordenarTopicos(lista) {
  const quando = (t) => (typeof t.ordem === "number" ? t.ordem : t.criadoEm && t.criadoEm.toMillis ? t.criadoEm.toMillis() : Date.now());
  return lista.sort((a, b) => quando(a) - quando(b));
}

// ==================== PROFESSOR ====================

function escutarChecklistProfessor(uid) {
  db.collection("usuarios").doc(uid).collection("checklist").onSnapshot((snap) => {
    checklistCache = ordenarTopicos(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })));
    renderizarChecklistConfig();
    if (typeof estadoAlunos !== "undefined" && Object.values(estadoAlunos).some((e) => e.abaAtiva === "checklist")) renderizarListaAlunos();
  }, (e) => console.warn("Não foi possível carregar o checklist:", e));
}

function nomesDosAlunosDoTopico(topico) {
  if (topico.paraTodos) return "Todos os alunos";
  const nomes = (topico.alunos || []).map((id) => (alunosCache.find((a) => a.id === id) || {}).nome).filter(Boolean);
  if (!nomes.length) return "Nenhum aluno";
  return nomes.length <= 3 ? nomes.join(", ") : `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}`;
}

// Escolha de "para quem vale" (todos / só alguns, com a lista de alunos)
function montarQuemUsa(estado, prefixo) {
  const lista = estado.paraTodos ? "" : alunosCache.length
    ? `<div class="alunos-quem-ve">${alunosCache.map((a) => `
        <label><input type="checkbox" ${estado.alunos.has(a.id) ? "checked" : ""} onchange="alternarAlunoQuemUsa('${prefixo}', '${a.id}')"> ${escapeHtml(a.nome)}</label>`).join("")}</div>`
    : `<p class="vazio">Você ainda não tem alunos vinculados.</p>`;
  return `
    <span class="rotulo-quem-ve">Vale para:</span>
    <label><input type="radio" name="quem-usa-${prefixo}" ${estado.paraTodos ? "checked" : ""} onchange="definirQuemUsa('${prefixo}', true)"> Todos os meus alunos</label>
    <label><input type="radio" name="quem-usa-${prefixo}" ${estado.paraTodos ? "" : "checked"} onchange="definirQuemUsa('${prefixo}', false)"> Só alguns alunos</label>
    ${lista}`;
}

function estadoQuemUsa(prefixo) {
  return prefixo === "novo" ? quemUsaNovoTopico : edicaoTopicoChecklist;
}

function definirQuemUsa(prefixo, paraTodos) {
  estadoQuemUsa(prefixo).paraTodos = paraTodos;
  renderizarChecklistConfig();
}

function alternarAlunoQuemUsa(prefixo, alunoId) {
  const alunos = estadoQuemUsa(prefixo).alunos;
  if (alunos.has(alunoId)) alunos.delete(alunoId); else alunos.add(alunoId);
}

function renderizarChecklistConfig() {
  const lista = document.getElementById("lista-checklist");
  const quemUsa = document.getElementById("quem-usa-novo-topico");
  if (!lista || !quemUsa) return;
  quemUsa.innerHTML = montarQuemUsa(quemUsaNovoTopico, "novo");
  lista.innerHTML = checklistCache.length ? checklistCache.map((t, i) => {
    const editando = edicaoTopicoChecklist && edicaoTopicoChecklist.id === t.id;
    return `
      <div class="item-topico-checklist" data-id="${t.id}">
        <div class="linha-topico-checklist">
          <span class="numero-topico">${i + 1}</span>
          <div class="info-topico-checklist">
            <strong>${escapeHtml(t.texto)}</strong>
            <span class="data-msg">${icone("users")} ${escapeHtml(nomesDosAlunosDoTopico(t))}</span>
          </div>
          <div class="aula-acoes">
            <button class="btn btn-secundario btn-mini" onclick="editarAlunosDoTopico('${t.id}')">Alunos</button>
            <button class="btn btn-secundario btn-mini" onclick="renomearTopicoChecklist('${t.id}')">Renomear</button>
            <button class="excluir" onclick="excluirTopicoChecklist('${t.id}')">Excluir</button>
          </div>
        </div>
        ${editando ? `
          <div class="quem-ve editor-quem-ve">
            ${montarQuemUsa(edicaoTopicoChecklist, "edicao")}
            <div class="acoes-edicao-nota">
              <button class="btn btn-primario btn-mini" onclick="salvarAlunosDoTopico()">Salvar</button>
              <button class="link-trocar" onclick="edicaoTopicoChecklist = null; renderizarChecklistConfig()">Cancelar</button>
            </div>
          </div>` : ""}
      </div>`;
  }).join("") : `<p class="vazio">Nenhum tópico ainda. Adicione o primeiro acima.</p>`;
}

async function adicionarTopicoChecklist() {
  const campo = document.getElementById("input-topico-checklist");
  const status = document.getElementById("status-checklist");
  const texto = campo.value.trim().slice(0, 300);
  if (!texto) { status.textContent = "Escreva o tópico."; return; }
  const paraTodos = quemUsaNovoTopico.paraTodos;
  const alunos = paraTodos ? [] : [...quemUsaNovoTopico.alunos].filter((id) => alunosCache.some((a) => a.id === id));
  if (!paraTodos && !alunos.length) { status.textContent = "Escolha pelo menos um aluno, ou marque \"Todos os meus alunos\"."; return; }
  campo.value = "";
  status.textContent = "";
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("checklist").add({
      texto, paraTodos, alunos, ordem: Date.now(), criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    campo.focus();
  } catch (e) {
    console.error(e);
    if (!campo.value) campo.value = texto;
    status.textContent = "Não foi possível salvar o tópico agora. Tente de novo.";
  }
}

function editarAlunosDoTopico(id) {
  const t = checklistCache.find((x) => x.id === id);
  if (!t) return;
  edicaoTopicoChecklist = { id, paraTodos: !!t.paraTodos, alunos: new Set(t.alunos || []) };
  renderizarChecklistConfig();
}

async function salvarAlunosDoTopico() {
  const e = edicaoTopicoChecklist;
  if (!e) return;
  const alunos = e.paraTodos ? [] : [...e.alunos].filter((id) => alunosCache.some((a) => a.id === id));
  if (!e.paraTodos && !alunos.length) { avisar("Escolha pelo menos um aluno, ou marque \"Todos os meus alunos\"."); return; }
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("checklist").doc(e.id).update({ paraTodos: e.paraTodos, alunos });
    edicaoTopicoChecklist = null;
    renderizarChecklistConfig();
  } catch (erro) {
    console.error(erro);
    avisar("Não foi possível salvar agora. Tente de novo.");
  }
}

async function renomearTopicoChecklist(id) {
  const t = checklistCache.find((x) => x.id === id);
  if (!t) return;
  const novo = ((await perguntar("Novo nome do tópico:", t.texto)) || "").trim().slice(0, 300);
  if (!novo || novo === t.texto) return;
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("checklist").doc(id).update({ texto: novo });
  } catch (e) {
    console.error(e);
    avisar("Não foi possível renomear agora. Tente de novo.");
  }
}

async function excluirTopicoChecklist(id) {
  const t = checklistCache.find((x) => x.id === id);
  if (!t || !(await confirmar(`Excluir o tópico "${t.texto}" do checklist? Ele some da lista de todos os alunos.`, { botao: "Excluir", perigo: true }))) return;
  try {
    await db.collection("usuarios").doc(professorIdAtual).collection("checklist").doc(id).delete();
  } catch (e) {
    console.error(e);
    avisar("Não foi possível excluir agora. Tente de novo.");
  }
}

// Aba "Checklist" de um aluno (Meus alunos): o professor marca o que ele já viu
function escutarChecklistDoAluno(alunoId) {
  const estado = estadoAlunos[alunoId];
  if (!estado || estado.unsubChecklist) return;
  estado.checklistFeito = estado.checklistFeito || null;
  estado.unsubChecklist = db.collection("usuarios").doc(alunoId).collection("checklistFeito").onSnapshot((snap) => {
    estado.checklistFeito = new Set(snap.docs.map((d) => d.id));
    if (estado.abaAtiva === "checklist") renderizarListaAlunos();
  }, (e) => console.warn("Não foi possível carregar o checklist do aluno:", e));
}

function montarAbaChecklist(alunoId) {
  escutarChecklistDoAluno(alunoId);
  const estado = estadoAlunos[alunoId];
  const topicos = checklistCache.filter((t) => topicoValeParaAluno(t, alunoId));
  if (!topicos.length) {
    return `<p class="vazio">Nenhum tópico vale para este aluno. Crie e escolha os tópicos em <button type="button" class="link-trocar" onclick="mostrarAbaProfessor('config'); document.getElementById('secao-checklist').scrollIntoView({ behavior: 'smooth' })">Configurações → Checklist de tópicos</button>.</p>`;
  }
  if (!estado.checklistFeito) return `<p class="vazio">Carregando...</p>`;
  const feitos = topicos.filter((t) => estado.checklistFeito.has(t.id)).length;
  return `
    <div class="checklist-aluno">
      <p class="progresso-checklist"><strong>${feitos} de ${topicos.length}</strong> tópicos vistos</p>
      <div class="barra-checklist"><span style="width:${Math.round((feitos / topicos.length) * 100)}%"></span></div>
      ${topicos.map((t) => `
        <label class="item-checklist${estado.checklistFeito.has(t.id) ? " feito" : ""}">
          <input type="checkbox" ${estado.checklistFeito.has(t.id) ? "checked" : ""} onchange="marcarTopicoDoAluno('${alunoId}', '${t.id}', this.checked)">
          <span>${escapeHtml(t.texto)}</span>
        </label>`).join("")}
      <p class="dica-plano">O aluno vê esta lista (sem poder marcar) no painel dele.</p>
    </div>`;
}

async function marcarTopicoDoAluno(alunoId, topicoId, feito) {
  const ref = db.collection("usuarios").doc(alunoId).collection("checklistFeito").doc(topicoId);
  try {
    if (feito) await ref.set({ professorId: professorIdAtual, em: firebase.firestore.FieldValue.serverTimestamp() });
    else await ref.delete();
  } catch (e) {
    console.error(e);
    avisar("Não foi possível salvar agora. Tente de novo.");
    renderizarListaAlunos();
  }
}

// ==================== ALUNO ====================

const checklistDoAluno = { todos: [], meus: [], feitos: null };

function escutarChecklistAluno(uid, professorId) {
  if (!professorId) return;
  const colecao = db.collection("usuarios").doc(professorId).collection("checklist");
  const juntar = (chave) => (snap) => {
    checklistDoAluno[chave] = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
    renderizarChecklistDoAluno();
  };
  const falha = (e) => console.warn("Não foi possível carregar o checklist:", e);
  colecao.where("paraTodos", "==", true).onSnapshot(juntar("todos"), falha);
  colecao.where("alunos", "array-contains", uid).onSnapshot(juntar("meus"), falha);
  db.collection("usuarios").doc(uid).collection("checklistFeito").onSnapshot((snap) => {
    checklistDoAluno.feitos = new Set(snap.docs.map((d) => d.id));
    renderizarChecklistDoAluno();
  }, falha);
}

function renderizarChecklistDoAluno() {
  const painel = document.getElementById("painel-checklist");
  const lista = document.getElementById("lista-checklist-aluno");
  if (!painel || !lista) return;
  const porId = {};
  [...checklistDoAluno.todos, ...checklistDoAluno.meus].forEach((t) => { porId[t.id] = t; });
  const topicos = ordenarTopicos(Object.values(porId));
  painel.classList.toggle("oculto", !topicos.length);
  if (!topicos.length) return;
  const feitos = checklistDoAluno.feitos || new Set();
  const total = topicos.filter((t) => feitos.has(t.id)).length;
  lista.innerHTML = `
    <p class="progresso-checklist"><strong>${total} de ${topicos.length}</strong> tópicos vistos</p>
    <div class="barra-checklist"><span style="width:${Math.round((total / topicos.length) * 100)}%"></span></div>
    <ul class="lista-checklist-aluno">${topicos.map((t) => `
      <li class="item-checklist${feitos.has(t.id) ? " feito" : ""}">
        <span class="marca-checklist" aria-hidden="true">${feitos.has(t.id) ? icone("check") : ""}</span>
        <span>${escapeHtml(t.texto)}</span>
        <span class="sr-only">${feitos.has(t.id) ? "(visto)" : "(ainda não)"}</span>
      </li>`).join("")}</ul>`;
}
