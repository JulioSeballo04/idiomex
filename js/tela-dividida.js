// ============================================================
// TELA DIVIDIDA — duas telas do painel lado a lado (computador / tablet deitado)
// ============================================================
// Professor: uma aba de cada lado (ex: Agenda | Meus alunos). Aluno: a Sala de aula
// ao lado do painel normal (vocabulário, letras...). O painel escolhido é MOVIDO
// para uma coluna ao lado (não é recriado): o que está digitado, aberto ou
// carregando continua igual. A divisória entre os dois lados pode ser arrastada.
// ============================================================

const LARGURA_MINIMA_TELA_DIVIDIDA = 1000;
const ABAS_DO_PROFESSOR = { agenda: "Agenda", alunos: "Meus alunos", sala: "Documentos", config: "Configurações" };

const telaDividida = {
  elemento: null,     // o painel que foi para o lado
  marcador: null,     // onde ele estava (para voltar no mesmo lugar)
  ladoProfessor: null // aba do professor que está no lado
};

function podeDividirTela() {
  return window.matchMedia(`(min-width: ${LARGURA_MINIMA_TELA_DIVIDIDA}px)`).matches;
}

function telaDivididaAtiva() {
  return !!telaDividida.elemento;
}

function larguraGuardadaDoLado() {
  try { return Number(localStorage.getItem("larguraTelaDividida")) || 0; } catch (e) { return 0; }
}

// Leva o elemento para a coluna do lado, com uma barra em cima (controles + fechar)
function abrirLado(elemento, barraHtml) {
  if (telaDividida.elemento) devolverLado();
  const shell = document.querySelector(".app-shell");
  let lado = document.getElementById("lado-dividido");
  if (!lado) {
    const divisoria = document.createElement("div");
    divisoria.className = "divisoria-tela";
    divisoria.id = "divisoria-tela";
    divisoria.title = "Arraste para mudar o tamanho dos lados";
    divisoria.setAttribute("role", "separator");
    divisoria.setAttribute("aria-orientation", "vertical");
    lado = document.createElement("aside");
    lado.id = "lado-dividido";
    lado.className = "lado-dividido";
    lado.innerHTML = `<div class="barra-lado-dividido" id="barra-lado-dividido"></div><div class="conteudo-lado-dividido" id="conteudo-lado-dividido"></div>`;
    shell.appendChild(divisoria);
    shell.appendChild(lado);
    arrastarDivisoria(divisoria, lado);
  }
  const guardada = larguraGuardadaDoLado();
  if (guardada) lado.style.width = `${Math.min(guardada, window.innerWidth - 420)}px`;
  document.getElementById("barra-lado-dividido").innerHTML = `${barraHtml}
    <button type="button" class="btn btn-secundario btn-mini btn-fechar-divisao" onclick="fecharTelaDividida()" title="Voltar para uma tela só">${icone("x")} Fechar divisão</button>`;
  telaDividida.marcador = document.createComment("lugar do painel da tela dividida");
  elemento.parentNode.insertBefore(telaDividida.marcador, elemento);
  document.getElementById("conteudo-lado-dividido").appendChild(elemento);
  telaDividida.elemento = elemento;
  document.body.classList.add("tela-dividida");
  atualizarBotoesTelaDividida();
}

// Devolve o painel ao lugar original
function devolverLado() {
  const { elemento, marcador } = telaDividida;
  if (elemento && marcador && marcador.parentNode) {
    marcador.parentNode.insertBefore(elemento, marcador);
    marcador.remove();
  }
  telaDividida.elemento = null;
  telaDividida.marcador = null;
}

function fecharTelaDividida() {
  const elemento = telaDividida.elemento;
  devolverLado();
  document.body.classList.remove("tela-dividida");
  if (telaDividida.ladoProfessor) {
    telaDividida.ladoProfessor = null;
    if (elemento) elemento.classList.add("oculto");
    guardarLadoDoProfessor(null);
  } else if (elemento && elemento.id === "tela-sala-aula") {
    elemento.hidden = true;
  }
  atualizarBotoesTelaDividida();
}

function arrastarDivisoria(divisoria, lado) {
  let inicio = null;
  divisoria.addEventListener("pointerdown", (e) => {
    inicio = { x: e.clientX, largura: lado.getBoundingClientRect().width };
    divisoria.setPointerCapture(e.pointerId);
    document.body.classList.add("arrastando-divisoria");
  });
  divisoria.addEventListener("pointermove", (e) => {
    if (!inicio) return;
    const largura = Math.max(320, Math.min(window.innerWidth - 420, inicio.largura - (e.clientX - inicio.x)));
    lado.style.width = `${largura}px`;
  });
  const soltar = () => {
    if (!inicio) return;
    inicio = null;
    document.body.classList.remove("arrastando-divisoria");
    try { localStorage.setItem("larguraTelaDividida", String(Math.round(lado.getBoundingClientRect().width))); } catch (e) {}
  };
  divisoria.addEventListener("pointerup", soltar);
  divisoria.addEventListener("pointercancel", soltar);
  // Duplo clique: metade e metade
  divisoria.addEventListener("dblclick", () => {
    lado.style.width = "";
    try { localStorage.removeItem("larguraTelaDividida"); } catch (e) {}
  });
}

// Tela ficou estreita (girou o tablet, diminuiu a janela): volta para uma tela só
window.addEventListener("resize", () => {
  if (telaDivididaAtiva() && !podeDividirTela()) fecharTelaDividida();
  atualizarBotoesTelaDividida();
});

function atualizarBotoesTelaDividida() {
  document.querySelectorAll(".btn-dividir-tela").forEach((b) => {
    b.hidden = !podeDividirTela();
    b.classList.toggle("ativa-divisao", telaDivididaAtiva());
    const rotulo = b.querySelector(".rotulo-dividir");
    if (rotulo) rotulo.textContent = telaDivididaAtiva() ? "Uma tela só" : "Dividir tela";
  });
  // Professor: a aba que está no lado fica marcada
  Object.keys(ABAS_DO_PROFESSOR).forEach((aba) => {
    const botao = document.getElementById(`btn-aba-${aba}`);
    if (botao) botao.classList.toggle("aba-no-lado", telaDividida.ladoProfessor === aba);
  });
}

// ==================== PROFESSOR ====================

function abaAtivaDoProfessor() {
  const ativa = document.querySelector(".abas-professor .aba-tipo.ativa");
  return ativa ? ativa.id.replace("btn-aba-", "") : "agenda";
}

function guardarLadoDoProfessor(aba) {
  try {
    if (aba) localStorage.setItem("ladoTelaDivididaProfessor", aba);
    else localStorage.removeItem("ladoTelaDivididaProfessor");
  } catch (e) {}
}

function alternarTelaDividida() {
  if (telaDivididaAtiva()) { fecharTelaDividida(); return; }
  if (!podeDividirTela()) return;
  if (document.getElementById("tela-sala-aula")) { dividirComSalaDeAula(); return; }
  const ativa = abaAtivaDoProfessor();
  colocarAbaNoLado(ativa === "agenda" ? "alunos" : "agenda");
}

function colocarAbaNoLado(aba, trocandoDeLado) {
  const painel = document.getElementById(`painel-aba-${aba}`);
  if (!painel) return;
  // A aba que estava no lado volta para o seu lugar (escondida)
  if (telaDividida.elemento && telaDividida.elemento !== painel) {
    const anterior = telaDividida.elemento;
    devolverLado();
    anterior.classList.add("oculto");
  }
  // Não dá para ter a mesma aba dos dois lados: a principal passa para outra
  if (!trocandoDeLado && abaAtivaDoProfessor() === aba) {
    const outra = Object.keys(ABAS_DO_PROFESSOR).find((a) => a !== aba);
    telaDividida.ladoProfessor = null;
    mostrarAbaProfessor(outra);
  }
  telaDividida.ladoProfessor = aba;
  const opcoes = Object.entries(ABAS_DO_PROFESSOR).map(([id, nome]) =>
    `<option value="${id}"${id === aba ? " selected" : ""}>${nome}</option>`).join("");
  abrirLado(painel, `<label class="seletor-lado">Deste lado: <select id="select-lado-dividido" onchange="colocarAbaNoLado(this.value)">${opcoes}</select></label>`);
  painel.classList.remove("oculto");
  guardarLadoDoProfessor(aba);
}

// ==================== ALUNO ====================

function dividirComSalaDeAula() {
  const sala = document.getElementById("tela-sala-aula");
  if (typeof salaDeAulaAberta === "function" && salaDeAulaAberta()) {
    // Sai da Sala de aula em tela cheia (sem mexer no botão "voltar" do navegador)
    esconderSalaDeAula();
    if (history.state && history.state.tela === "sala") history.replaceState(null, "", location.pathname + location.search);
  }
  sala.hidden = false;
  abrirLado(sala, `<strong class="titulo-lado">${icone("presentation")} Sala de aula</strong>`);
  if (typeof renderizarSalaDeAula === "function") renderizarSalaDeAula();
}

document.addEventListener("DOMContentLoaded", () => {
  atualizarBotoesTelaDividida();
  // Professor: volta com a tela dividida como estava
  let lado = null;
  try { lado = localStorage.getItem("ladoTelaDivididaProfessor"); } catch (e) {}
  if (lado && ABAS_DO_PROFESSOR[lado] && document.getElementById(`painel-aba-${lado}`) && podeDividirTela()) {
    setTimeout(() => colocarAbaNoLado(lado), 0);
  }
});
