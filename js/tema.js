// ============================================================
// SELETOR DE TEMA — troca a paleta de cores do app inteiro
// ============================================================
// Guarda a escolha no localStorage do navegador (por dispositivo).
// Um script inline no <head> de cada página já aplica o tema salvo
// antes da página desenhar, pra não "piscar" a cor padrão.
// ============================================================

const TEMAS = [
  { id: "classico",   nome: "Fichário Clássico", cores: ["#6B8F71", "#C98A2C"] },
  { id: "oceano",     nome: "Oceano",             cores: ["#2C6E8E", "#E0733F"] },
  { id: "lavanda",    nome: "Lavanda",            cores: ["#7C6A9C", "#D68FA0"] },
  { id: "terracota",  nome: "Terracota",          cores: ["#6E7F52", "#A9542F"] },
  { id: "noturno",    nome: "Noturno",            cores: ["#7FA6C9", "#E0B24C"] }
];

function temaAtual() {
  return localStorage.getItem("temaEscolhido") || "classico";
}

// Aplica o tema no elemento <html>. Quando salvar=true, grava a escolha.
function aplicarTema(id, salvar) {
  if (salvar === undefined) salvar = true;

  if (id === "classico") {
    document.documentElement.removeAttribute("data-tema");
  } else {
    document.documentElement.setAttribute("data-tema", id);
  }

  if (salvar) localStorage.setItem("temaEscolhido", id);
  atualizarPontoAtivo();
}

function atualizarPontoAtivo() {
  const ponto = document.getElementById("ponto-tema-atual");
  if (!ponto) return;
  const atual = TEMAS.find((t) => t.id === temaAtual()) || TEMAS[0];
  ponto.style.background = `linear-gradient(135deg, ${atual.cores[0]} 50%, ${atual.cores[1]} 50%)`;
}

function montarMenuTema() {
  const menu = document.getElementById("menu-tema");
  if (!menu) return;
  menu.innerHTML = "";

  TEMAS.forEach((t) => {
    const ativa = t.id === temaAtual();
    const item = document.createElement("button");
    item.type = "button";
    item.className = "opcao-tema" + (ativa ? " ativa" : "");
    item.innerHTML = `
      <span class="amostra-tema" style="background:linear-gradient(135deg, ${t.cores[0]} 50%, ${t.cores[1]} 50%)"></span>
      <span>${t.nome}</span>
      ${ativa ? '<span class="marca-ativa">✓</span>' : ""}
    `;
    item.onclick = () => {
      aplicarTema(t.id);
      montarMenuTema();
      document.getElementById("menu-tema").classList.add("oculto");
    };
    menu.appendChild(item);
  });
}

function alternarMenuTema() {
  const menu = document.getElementById("menu-tema");
  if (!menu) return;
  menu.classList.toggle("oculto");
}

// Fecha o menu se o usuário clicar fora dele
document.addEventListener("click", (evento) => {
  const seletor = document.getElementById("seletor-tema");
  const menu = document.getElementById("menu-tema");
  if (seletor && menu && !seletor.contains(evento.target)) {
    menu.classList.add("oculto");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  aplicarTema(temaAtual(), false); // já foi aplicado pelo script inline, isso só sincroniza o botão
  montarMenuTema();
});
