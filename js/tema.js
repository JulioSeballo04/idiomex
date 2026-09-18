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
  const cores = idiomaDoTema ? coresDaAmostra(idiomaDoTema, preferenciaDoIdioma(idiomaDoTema))
    : (TEMAS.find((t) => t.id === temaAtual()) || TEMAS[0]).cores;
  ponto.style.background = `linear-gradient(135deg, ${cores[0]} 50%, ${cores[1]} 50%)`;
}

// ============================================================
// TEMA POR IDIOMA (tela do aluno)
// ============================================================
// Cada idioma tem a própria aparência. O padrão é o modo "bandeira": acentos e fundo
// tirados das cores da bandeira do idioma (PALETAS_IDIOMA, em util.js). O aluno pode
// trocar, só naquele idioma, por um dos temas prontos ou por duas cores próprias.
// A escolha fica no localStorage: "temaIdioma:<idioma>" = {modo, preset?, principal?, destaque?}.
// O resultado aplicado também é guardado em "temaAluno" pra o <head> da página poder
// pintar as cores certas antes de o app carregar (sem piscar a cor padrão).
// ============================================================

let idiomaDoTema = null;
const VARIAVEIS_DE_TEMA = ["--bg", "--bg-cartao", "--ink-soft", "--borda", "--acento", "--acento-forte", "--acento-secundario"];

function preferenciaDoIdioma(id) {
  try {
    const salva = JSON.parse(localStorage.getItem("temaIdioma:" + id));
    if (salva && salva.modo) return salva;
  } catch (e) {}
  return { modo: "bandeira" };
}

function salvarPreferenciaDoIdioma(id, pref) {
  try { localStorage.setItem("temaIdioma:" + id, JSON.stringify(pref)); } catch (e) {}
}

// Escurece uma cor "#RRGGBB" (fator 0-1: quanto menor, mais escura)
function escurecerCor(hex, fator) {
  const n = parseInt(hex.slice(1), 16);
  const canal = (deslocamento) => Math.max(0, Math.min(255, Math.round(((n >> deslocamento) & 255) * fator)));
  return "#" + [16, 8, 0].map((d) => canal(d).toString(16).padStart(2, "0")).join("");
}

function coresDaAmostra(id, pref) {
  if (pref.modo === "preset") return (TEMAS.find((t) => t.id === pref.preset) || TEMAS[0]).cores;
  if (pref.modo === "custom") return [pref.principal, pref.destaque];
  const p = PALETAS_IDIOMA[id];
  return [p.acento, p.acentoSecundario];
}

// Converte a preferência em {tema: id do tema pronto ou null, vars: {--variável: cor}}
function temaDoIdioma(id, pref) {
  if (pref.modo === "preset") {
    return { tema: pref.preset === "classico" ? null : pref.preset, vars: {} };
  }
  if (pref.modo === "custom") {
    return { tema: null, vars: {
      "--acento": pref.principal,
      "--acento-forte": escurecerCor(pref.principal, 0.75),
      "--acento-secundario": pref.destaque
    } };
  }
  const p = PALETAS_IDIOMA[id];
  return { tema: null, vars: {
    "--bg": p.bg, "--bg-cartao": "#FFFFFF", "--ink-soft": p.inkSoft, "--borda": p.borda,
    "--acento": p.acento, "--acento-forte": p.acentoForte, "--acento-secundario": p.acentoSecundario
  } };
}

function aplicarTemaCalculado(tema) {
  const raiz = document.documentElement;
  if (tema.tema) raiz.setAttribute("data-tema", tema.tema); else raiz.removeAttribute("data-tema");
  VARIAVEIS_DE_TEMA.forEach((v) => raiz.style.removeProperty(v));
  Object.keys(tema.vars).forEach((v) => raiz.style.setProperty(v, tema.vars[v]));
  try { localStorage.setItem("temaAluno", JSON.stringify(tema)); } catch (e) {}
}

// Chamado pela tela do aluno toda vez que o idioma ativo muda (e na primeira carga)
function definirIdiomaDoTema(id) {
  idiomaDoTema = id;
  aplicarTemaCalculado(temaDoIdioma(id, preferenciaDoIdioma(id)));
  atualizarPontoAtivo();
  montarMenuTema();
}

function escolherTemaDoIdioma(pref) {
  salvarPreferenciaDoIdioma(idiomaDoTema, pref);
  aplicarTemaCalculado(temaDoIdioma(idiomaDoTema, pref));
  atualizarPontoAtivo();
}

// Menu de temas quando existe um idioma ativo: bandeira, temas prontos e personalizar
function montarMenuTemaDoIdioma(menu) {
  const pref = preferenciaDoIdioma(idiomaDoTema);
  const nomeIdioma = IDIOMAS[idiomaDoTema].nome;

  const itens = [];
  itens.push({
    ativa: pref.modo === "bandeira",
    html: `<span class="amostra-bandeira">${bandeiraSvg(idiomaDoTema, 22)}</span><span>Bandeira (${nomeIdioma})</span>`,
    aoClicar: () => escolherTemaDoIdioma({ modo: "bandeira" })
  });
  TEMAS.forEach((t) => {
    itens.push({
      ativa: pref.modo === "preset" && pref.preset === t.id,
      html: `<span class="amostra-tema" style="background:linear-gradient(135deg, ${t.cores[0]} 50%, ${t.cores[1]} 50%)"></span><span>${t.nome}</span>`,
      aoClicar: () => escolherTemaDoIdioma({ modo: "preset", preset: t.id })
    });
  });

  menu.innerHTML = "";
  itens.forEach((item) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "opcao-tema" + (item.ativa ? " ativa" : "");
    botao.innerHTML = item.html + (item.ativa ? '<span class="marca-ativa">✓</span>' : "");
    botao.onclick = () => {
      item.aoClicar();
      montarMenuTema();
      menu.classList.add("oculto");
    };
    menu.appendChild(botao);
  });

  // Personalizar: duas cores livres, aplicadas na hora. O menu fica aberto pra escolher.
  const padrao = coresDaAmostra(idiomaDoTema, { modo: "bandeira" });
  const principal = pref.modo === "custom" ? pref.principal : padrao[0];
  const destaque = pref.modo === "custom" ? pref.destaque : padrao[1];
  const bloco = document.createElement("div");
  bloco.className = "personalizar-tema" + (pref.modo === "custom" ? " ativa" : "");
  bloco.innerHTML = `
    <div class="personalizar-titulo">🎨 Personalizar${pref.modo === "custom" ? ' <span class="marca-ativa">✓</span>' : ""}</div>
    <label>Cor principal <input type="color" id="cor-principal-tema" value="${principal}"></label>
    <label>Cor de destaque <input type="color" id="cor-destaque-tema" value="${destaque}"></label>
  `;
  menu.appendChild(bloco);
  const aoMudarCor = () => escolherTemaDoIdioma({
    modo: "custom",
    principal: document.getElementById("cor-principal-tema").value,
    destaque: document.getElementById("cor-destaque-tema").value
  });
  document.getElementById("cor-principal-tema").oninput = aoMudarCor;
  document.getElementById("cor-destaque-tema").oninput = aoMudarCor;
}

function montarMenuTema() {
  const menu = document.getElementById("menu-tema");
  if (!menu) return;
  if (idiomaDoTema) { montarMenuTemaDoIdioma(menu); return; }
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
  if (idiomaDoTema) return; // a tela do aluno já definiu o tema do idioma
  aplicarTema(temaAtual(), false); // já foi aplicado pelo script inline, isso só sincroniza o botão
  montarMenuTema();
});
