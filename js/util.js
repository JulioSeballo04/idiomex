// ============================================================
// UTILITÁRIOS COMPARTILHADOS
// ============================================================

// Escapa texto vindo do usuário antes de inserir via innerHTML,
// evitando XSS armazenado (ex: nome de aluno, recados, anotações,
// palavras). Sempre que um valor dinâmico for colocado dentro de
// um template innerHTML, ele deve passar por essa função.
function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto === null || texto === undefined ? "" : String(texto);
  return div.innerHTML;
}

// Ícone da biblioteca Lucide (assets/icones.svg). Decorativo: o texto ou o title/aria-label
// do botão é que diz o que ele faz. Ex.: icone("bell"), icone("x", "icone-grande").
function icone(nome, classe = "") {
  return `<svg class="icone${classe ? " " + classe : ""}" aria-hidden="true" focusable="false"><use href="assets/icones.svg#i-${nome}"></use></svg>`;
}

// Redesenha um pedaço da tela sem perder o que a pessoa está digitando. As telas
// são redesenhadas inteiras a cada atualização em tempo real (palavra nova de um
// aluno, aula marcada...) — sem isso, um recado ou anotação pela metade sumia, e
// o cursor saía do campo. Guarda o texto dos campos com id e o foco/cursor, roda o
// redesenho e devolve tudo aos campos que continuarem existindo.
function redesenharPreservandoCampos(container, redesenhar) {
  const valores = {};
  if (container) {
    container.querySelectorAll("textarea[id], input[type=text][id]").forEach((campo) => {
      valores[campo.id] = campo.value;
    });
  }
  const ativo = document.activeElement;
  const idAtivo = ativo && ativo.id && valores[ativo.id] !== undefined ? ativo.id : null;
  const selecao = idAtivo ? [ativo.selectionStart, ativo.selectionEnd] : null;

  redesenhar();

  Object.keys(valores).forEach((id) => {
    const campo = document.getElementById(id);
    if (campo && campo.value !== valores[id]) campo.value = valores[id];
  });
  if (idAtivo) {
    const campo = document.getElementById(idAtivo);
    if (campo) {
      campo.focus();
      try { campo.setSelectionRange(selecao[0], selecao[1]); } catch (e) {}
    }
  }
}

// Confere um link colado pelo professor (aula online, documento). Sem "https://"
// na frente, completa; aceita só http(s) — as regras do Firestore recusam o resto.
// Devolve "" se o link não servir.
function normalizarLink(texto) {
  let url = (texto || "").trim();
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url)) url = "https://" + url;
  url = url.replace(/^https?:/i, (esquema) => esquema.toLowerCase());
  if (!/^https?:\/\/\S+$/.test(url) || url.length > 2000) return "";
  return url;
}

// ============================================================
// CAIXAS DE AVISO DO APP — no lugar do alert/confirm/prompt do navegador
// ============================================================
// As caixas do navegador ("idiomex.vercel.app diz") não seguem o visual do app.
// avisar(texto), confirmar(texto, {botao, perigo}) e perguntar(texto, valor)
// mostram uma janela do app e devolvem uma Promise (com await). Uma caixa espera a
// anterior fechar. O alert() do código continua funcionando: abre a caixa do app.

let filaDeCaixas = Promise.resolve();

function caixaDoApp({ texto, botoes, campo }) {
  const vez = filaDeCaixas.then(() => new Promise((resolve) => {
    // Nos testes automáticos, a caixa é registrada e respondida sozinha
    const teste = window.__caixasDeTeste;
    if (teste) {
      teste.registrar(texto);
      Promise.resolve(campo !== undefined ? teste.resposta(campo) : true).then(resolve);
      return;
    }
    let modal = document.getElementById("modal-caixa");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal-caixa";
      modal.className = "modal-oculto";
      modal.setAttribute("role", "alertdialog");
      modal.setAttribute("aria-modal", "true");
      modal.innerHTML = `<div class="modal-conteudo caixa-do-app">
        <p class="texto-caixa" id="texto-caixa"></p>
        <input type="text" class="campo-caixa" id="campo-caixa" hidden>
        <div class="botoes-caixa" id="botoes-caixa"></div></div>`;
      document.body.appendChild(modal);
    }
    document.getElementById("texto-caixa").textContent = texto;
    const entrada = document.getElementById("campo-caixa");
    entrada.hidden = campo === undefined;
    entrada.value = campo === undefined ? "" : campo;
    const area = document.getElementById("botoes-caixa");
    area.innerHTML = "";
    const fechar = (valor) => {
      modal.classList.add("modal-oculto");
      document.removeEventListener("keydown", teclas, true);
      resolve(valor);
    };
    const resposta = (b) => (campo !== undefined && b.valor === true ? entrada.value : b.valor);
    botoes.forEach((b) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = `btn ${b.classe}`;
      botao.textContent = b.rotulo;
      botao.onclick = () => fechar(resposta(b));
      area.appendChild(botao);
    });
    // Enter confirma; Esc cancela (sem fechar a janela que estiver por baixo)
    const teclas = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); fechar(botoes.length > 1 ? (campo !== undefined ? null : false) : undefined); }
      if (e.key === "Enter" && (campo !== undefined ? e.target === entrada : true)) {
        e.stopImmediatePropagation(); e.preventDefault(); fechar(resposta(botoes[0]));
      }
    };
    document.addEventListener("keydown", teclas, true);
    modal.classList.remove("modal-oculto");
    (campo !== undefined ? entrada : area.firstChild).focus();
  }));
  filaDeCaixas = vez.catch(() => {});
  return vez;
}

function avisar(texto) {
  return caixaDoApp({ texto, botoes: [{ rotulo: "OK", classe: "btn-primario", valor: undefined }] });
}

// Devolve true (confirmou) ou false. botao: o texto do botão de confirmar;
// perigo: botão vermelho (excluir, cancelar aula...)
function confirmar(texto, opcoes = {}) {
  return caixaDoApp({ texto, botoes: [
    { rotulo: opcoes.botao || "Confirmar", classe: opcoes.perigo ? "btn-perigo" : "btn-primario", valor: true },
    { rotulo: opcoes.voltar || "Voltar", classe: "btn-secundario", valor: false }
  ] });
}

// Devolve o texto digitado, ou null se a pessoa desistiu
function perguntar(texto, valorInicial) {
  return caixaDoApp({ texto, campo: valorInicial || "", botoes: [
    { rotulo: "Salvar", classe: "btn-primario", valor: true },
    { rotulo: "Voltar", classe: "btn-secundario", valor: null }
  ] });
}

window.alert = (texto) => { avisar(String(texto === undefined ? "" : texto)); };

// Esc fecha a janela (modal) que estiver aberta, como o botão de fechar dela
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const aberto = document.querySelector('[id^="modal-"]:not(.modal-oculto)');
  const fechar = aberto && aberto.querySelector(".btn-fechar-modal");
  if (fechar) fechar.click();
});

// Frase de boas-vindas no idioma estudado (aluno) ou ensinado (professor), sorteada
// ao abrir a página. Fica a mesma até recarregar, pra não trocar a cada atualização.
const FRASES_BOAS_VINDAS = {
  aluno: {
    en: ["Welcome back!", "Great to see you!", "Ready to learn something new?", "Let's keep going!",
      "Nice to have you back!", "Every word counts!", "Let's make today count!", "Keep up the great work!",
      "Hello there!", "Time to practice!", "You're doing great!", "Small steps, big progress!"],
    es: ["¡Bienvenido de nuevo!", "¡Qué bueno verte!", "¿Listo para aprender algo nuevo?", "¡Sigamos adelante!", "¡Cada palabra cuenta!"],
    it: ["Bentornato!", "Che bello rivederti!", "Pronto a imparare qualcosa di nuovo?", "Andiamo avanti!", "Ogni parola conta!"],
    fr: ["Bon retour !", "Ravi de te revoir !", "Prêt à apprendre quelque chose de nouveau ?", "On continue !", "Chaque mot compte !"],
    de: ["Willkommen zurück!", "Schön, dich zu sehen!", "Bereit, etwas Neues zu lernen?", "Weiter geht's!", "Jedes Wort zählt!"],
    ja: ["おかえりなさい！", "今日もがんばろう！", "新しい言葉を学ぼう！", "一歩ずつ進もう！"],
    zh: ["欢迎回来！", "很高兴见到你！", "准备好学点新东西了吗？", "继续加油！"],
    ko: ["다시 오신 것을 환영해요!", "만나서 반가워요!", "오늘도 힘내요!", "새로운 단어를 배워 봐요!"]
  },
  professor: {
    en: ["Welcome back, teacher!", "Ready to inspire today?", "Great to see you!", "Your students are lucky to have you!",
      "Let's make today a great class!", "Teaching is a superpower!", "Hello, teacher!", "Another day, another breakthrough!",
      "Thanks for all you do!", "Let's get your week organized!"],
    es: ["¡Bienvenido de nuevo, profe!", "¿Listo para inspirar hoy?", "¡Qué bueno verte!", "¡Tus alumnos tienen suerte de tenerte!"],
    it: ["Bentornato, prof!", "Pronto a ispirare oggi?", "Che bello rivederti!", "I tuoi studenti sono fortunati ad averti!"],
    fr: ["Bon retour, prof !", "Prêt à inspirer aujourd'hui ?", "Ravi de te revoir !", "Tes élèves ont de la chance de t'avoir !"],
    de: ["Willkommen zurück!", "Bereit, heute zu inspirieren?", "Schön, dich zu sehen!", "Deine Schüler haben Glück mit dir!"],
    ja: ["おかえりなさい、先生！", "今日も素敵な授業を！", "お疲れさまです！"],
    zh: ["欢迎回来，老师！", "今天也要精彩上课！", "老师辛苦了！"],
    ko: ["다시 오신 것을 환영해요, 선생님!", "오늘도 멋진 수업 해요!", "선생님, 수고 많으세요!"]
  }
};
const frasesSorteadas = {};
function fraseDeBoasVindas(idioma, quem = "aluno") {
  const lista = FRASES_BOAS_VINDAS[quem] || FRASES_BOAS_VINDAS.aluno;
  const frases = lista[idioma] || lista.en;
  const chave = `${quem}:${idioma}`;
  if (!(chave in frasesSorteadas)) frasesSorteadas[chave] = frases[Math.floor(Math.random() * frases.length)];
  return frasesSorteadas[chave];
}

// Lê um texto em voz alta usando a Web Speech API do navegador (sem custo,
// sem depender de nenhuma API externa). Se o navegador não suportar, não faz nada.
function falar(texto, idioma) {
  if (!("speechSynthesis" in window) || !texto) return;
  window.speechSynthesis.cancel(); // corta qualquer fala em andamento antes de começar outra
  const utterancia = new SpeechSynthesisUtterance(texto);
  utterancia.lang = (IDIOMAS[idioma] || IDIOMAS.en).voz;
  window.speechSynthesis.speak(utterancia);
}

// ============================================================
// IDIOMAS — o professor escolhe o idioma que ensina, e o vocabulário de todos
// os alunos vinculados a ele passa a ser desse idioma. Os campos do Firestore
// continuam com o nome antigo (palavraEn, frasesExemplo[].en) por compatibilidade,
// mas guardam a palavra/frase no idioma estudado, seja ele qual for.
// ============================================================

const IDIOMAS = {
  // "cor" identifica o idioma nas aulas do calendário (pontos e etiquetas)
  en: { nome: "Inglês",   voz: "en-US", exemplo: "apple / maçã",     usaEspacos: true,  cor: "#3B6FD4" },
  es: { nome: "Espanhol", voz: "es-ES", exemplo: "manzana / maçã",   usaEspacos: true,  cor: "#D9822B" },
  it: { nome: "Italiano", voz: "it-IT", exemplo: "mela / maçã",      usaEspacos: true,  cor: "#2F9E6B" },
  fr: { nome: "Francês",  voz: "fr-FR", exemplo: "pomme / maçã",     usaEspacos: true,  cor: "#8A5FD0" },
  ja: { nome: "Japonês",  voz: "ja-JP", exemplo: "りんご / maçã",     usaEspacos: false, cor: "#D64A6E" },
  zh: { nome: "Mandarim", voz: "zh-CN", exemplo: "苹果 / maçã",       usaEspacos: false, cor: "#A67C00" },
  de: { nome: "Alemão",   voz: "de-DE", exemplo: "Apfel / maçã",     usaEspacos: true,  cor: "#B0313F" },
  ko: { nome: "Coreano",  voz: "ko-KR", exemplo: "사과 / maçã",       usaEspacos: true,  cor: "#0047A0" }
};
const IDIOMA_PADRAO = "en";

// Bandeira de cada idioma, desenhada em SVG (emojis de bandeira não aparecem no Windows).
// Todas em 60x40 pra caberem no mesmo tamanho.
const BANDEIRAS = {
  en: '<rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="13"/><path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="8"/>',
  es: '<rect width="60" height="40" fill="#AA151B"/><rect y="10" width="60" height="20" fill="#F1BF00"/>',
  it: '<rect width="20" height="40" fill="#009246"/><rect x="20" width="20" height="40" fill="#fff"/><rect x="40" width="20" height="40" fill="#CE2B37"/>',
  fr: '<rect width="20" height="40" fill="#0055A4"/><rect x="20" width="20" height="40" fill="#fff"/><rect x="40" width="20" height="40" fill="#EF4135"/>',
  ja: '<rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#BC002D"/>',
  zh: '<rect width="60" height="40" fill="#DE2910"/><polygon points="12,6 14.6,13.6 22.6,13.7 16.2,18.5 18.6,26.2 12,21.5 5.4,26.2 7.8,18.5 1.4,13.7 9.4,13.6" fill="#FFDE00"/>',
  de: '<rect width="60" height="40" fill="#000"/><rect y="13.33" width="60" height="13.34" fill="#DD0000"/><rect y="26.67" width="60" height="13.33" fill="#FFCE00"/>',
  ko: '<rect width="60" height="40" fill="#fff"/><g transform="translate(30,20)"><path d="M0,-10 A5,5 0 0,1 0,0 A5,5 0 0,0 0,10 A10,10 0 0,1 0,-10 Z" fill="#CD2E3A"/><path d="M0,10 A5,5 0 0,1 0,0 A5,5 0 0,0 0,-10 A10,10 0 0,1 0,10 Z" fill="#0047A0"/></g>'
};

function bandeiraSvg(idioma, largura) {
  const w = largura || 28;
  return `<svg class="bandeira-svg" viewBox="0 0 60 40" width="${w}" height="${Math.round(w * 2 / 3)}" role="img" aria-label="Bandeira: ${IDIOMAS[idioma].nome}">${BANDEIRAS[idioma]}</svg>`;
}

// Paleta do app quando o idioma está no modo "bandeira" (o padrão): acentos tirados das cores
// da bandeira e um fundo levemente tingido. O usuário pode trocar depois (ver tema.js).
const PALETAS_IDIOMA = {
  en: { acento: "#1F4E9C", acentoForte: "#173B76", acentoSecundario: "#C8102E", bg: "#F3F6FB", borda: "#D4DEEE", inkSoft: "#56657D" },
  es: { acento: "#B50E1C", acentoForte: "#8F0B16", acentoSecundario: "#C99700", bg: "#FBF6EA", borda: "#EBDDBF", inkSoft: "#7A6A4A" },
  it: { acento: "#008C45", acentoForte: "#006B35", acentoSecundario: "#CD212A", bg: "#F5F8F3", borda: "#D8E4D2", inkSoft: "#5B6E55" },
  fr: { acento: "#0055A4", acentoForte: "#003F7D", acentoSecundario: "#EF4135", bg: "#F3F6FA", borda: "#D3DEEB", inkSoft: "#566A80" },
  ja: { acento: "#BC002D", acentoForte: "#93001F", acentoSecundario: "#3D4A5C", bg: "#FBF6F6", borda: "#EBD9DA", inkSoft: "#7A6466" },
  zh: { acento: "#D02510", acentoForte: "#A21C0B", acentoSecundario: "#C98A00", bg: "#FCF5F1", borda: "#EEDCD2", inkSoft: "#7D6558" },
  de: { acento: "#B0313F", acentoForte: "#8A2531", acentoSecundario: "#C9A227", bg: "#FAF3F0", borda: "#EDD9D6", inkSoft: "#7A5C58" },
  ko: { acento: "#0047A0", acentoForte: "#00397F", acentoSecundario: "#CD2E3A", bg: "#F2F6FB", borda: "#D6E1EE", inkSoft: "#57697F" }
};

function idiomaValido(id) {
  return Object.prototype.hasOwnProperty.call(IDIOMAS, id) ? id : IDIOMA_PADRAO;
}

// Idiomas que um professor ensina: o campo novo "idiomas" (lista) ou, nas contas
// criadas antes dele, o campo único "idioma". Sempre devolve pelo menos um.
function idiomasDoPerfil(perfil) {
  const lista = perfil && Array.isArray(perfil.idiomas)
    ? perfil.idiomas.filter((id) => Object.prototype.hasOwnProperty.call(IDIOMAS, id))
    : [];
  return lista.length ? [...new Set(lista)] : [idiomaValido(perfil && perfil.idioma)];
}

// Idioma de uma palavra guardada. Palavras antigas (sem o campo) são de inglês.
function idiomaDaPalavra(palavra) {
  return idiomaValido(palavra && palavra.idioma);
}

// Letra do índice A–Z de uma palavra. Tira os acentos (é → E, ñ → N) pra
// espanhol/italiano/francês caírem no A–Z; palavras que não começam com letra
// latina (japonês, mandarim) vão pra "#".
function letraInicial(palavra) {
  const primeira = String(palavra || "").trim().charAt(0)
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return /^[A-Z]$/.test(primeira) ? primeira : "#";
}

const LETRAS_A_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// ============================================================
// DATA/HORA — usados pelo agendamento de aulas (professor.js e dicionario.js)
// ============================================================

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const NOMES_DIAS_SEMANA = {
  dom: "Domingo", seg: "Segunda", ter: "Terça", qua: "Quarta",
  qui: "Quinta", sex: "Sexta", sab: "Sábado"
};

// Data de hoje no formato "AAAA-MM-DD", usando o horário LOCAL do navegador
// (evita o bug clássico de "new Date().toISOString()" voltar o dia anterior
// perto da meia-noite, por causa do fuso horário).
function dataDeHojeISO() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// "2026-09-15" -> "15/09/2026"
function formatarDataBR(dataIso) {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// Retorna a chave do dia da semana ("seg", "ter"...) de uma data "AAAA-MM-DD".
// Usa meio-dia (T12:00:00) para não cair no dia errado por causa do fuso horário.
function chaveDiaSemana(dataIso) {
  const data = new Date(`${dataIso}T12:00:00`);
  return DIAS_SEMANA[data.getDay()];
}

// Um objeto Date -> "AAAA-MM-DD" no horário LOCAL (usado pelos calendários de mês)
function chaveDataISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

const NOMES_MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];
const NOMES_DIAS_SEMANA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

// Soma minutos a um horário "HH:MM" e devolve outro "HH:MM"
function somarMinutos(horaStr, minutos) {
  const [h, m] = horaStr.split(":").map(Number);
  const total = h * 60 + m + minutos;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Modalidades (online/presencial) de uma data: a exceção pontual daquela data, se o
// professor definiu; senão a do dia da semana (modo "dia por dia"); senão a geral.
function modalidadesDaData(config, overrides, dataIso) {
  const override = dataIso && overrides ? overrides[dataIso] : null;
  if (override && !override.fechado && override.modalidades && override.modalidades.length) {
    return override.modalidades;
  }
  const doDiaDaSemana = dataIso && config && config.modalidadesPorDia
    ? config.modalidadesPorDia[chaveDiaSemana(dataIso)] : null;
  if (doDiaDaSemana && doDiaDaSemana.length) return doDiaDaSemana;
  return (config && config.modalidades) || [];
}

function minutosDoHorario(horaStr) {
  const [h, m] = String(horaStr).split(":").map(Number);
  return h * 60 + m;
}

// Configuração das aulas de um idioma. O professor pode ter, por idioma, a própria
// duração, intervalo, modalidades e dias/horários de trabalho
// (configuracaoAgenda.porIdioma[idioma]); sem isso, o idioma usa a configuração
// padrão. WhatsApp, meses liberados e os ajustes de um dia valem para todos.
const CAMPOS_CONFIG_POR_IDIOMA = ["duracaoAulaMinutos", "intervaloMinutos", "modalidades", "modalidadesPorDia", "disponibilidade"];

function configDoIdioma(config, idioma) {
  const propria = config && config.porIdioma && idioma ? config.porIdioma[idioma] : null;
  return propria ? { ...config, ...propria } : config;
}

// Faixa de horário de uma aula, ex: "14:00 – 15:00"
function faixaHorario(horaInicio, horaFim) {
  return horaFim ? `${horaInicio} – ${horaFim}` : horaInicio;
}

// A partir dos blocos de disponibilidade de um dia (ex: [{inicio:"08:00", fim:"12:00"}]),
// gera a lista de horários de início possíveis para aulas de "duracaoMinutos", com
// "intervaloMinutos" de descanso entre uma aula e a próxima (ex: aula de 50 min +
// 10 min de intervalo = aulas começando sempre na hora cheia).
// Sem repetidos e em ordem, mesmo que o professor configure períodos que se sobrepõem.
function gerarSlotsDoDia(blocos, duracaoMinutos, intervaloMinutos) {
  const slots = [];
  (blocos || []).forEach((bloco) => {
    const [hIni, mIni] = bloco.inicio.split(":").map(Number);
    const [hFim, mFim] = bloco.fim.split(":").map(Number);
    let minutoAtual = hIni * 60 + mIni;
    const minutoFim = hFim * 60 + mFim;
    while (minutoAtual + duracaoMinutos <= minutoFim) {
      const h = String(Math.floor(minutoAtual / 60)).padStart(2, "0");
      const m = String(minutoAtual % 60).padStart(2, "0");
      slots.push(`${h}:${m}`);
      minutoAtual += duracaoMinutos + (intervaloMinutos || 0);
    }
  });
  return [...new Set(slots)].sort();
}

// Tira os horários que batem com alguma aula já marcada. Compara intervalos (e não
// só o horário de início): se o professor mudou a duração das aulas, uma aula das
// 09:00 às 09:50 ainda bloqueia um horário novo das 09:30.
function slotsSemConflito(slots, duracaoMinutos, aulasMarcadas) {
  const ocupados = aulasMarcadas.map((a) => {
    const inicio = minutosDoHorario(a.horaInicio);
    const fim = a.horaFim ? minutosDoHorario(a.horaFim) : inicio + duracaoMinutos;
    return [inicio, fim];
  });
  return slots.filter((h) => {
    const inicio = minutosDoHorario(h);
    const fim = inicio + duracaoMinutos;
    return !ocupados.some(([oi, of]) => inicio < of && oi < fim);
  });
}

// ============================================================
// PLANO DO ALUNO — aulas por semana e créditos de reposição
// ============================================================
// O professor define, por aluno E POR IDIOMA, quantas aulas ele pode marcar por
// semana (0 = sem limite) e dá tempo de reposição, EM MINUTOS: cada crédito vale
// 1 hora, mas nem toda reposição é uma hora cheia (às vezes a aula dura 1h20, ou
// a reposição é feita esticando uma aula em 15 minutos). O saldo é calculado a
// partir das próprias aulas daquele idioma: os minutos concedidos menos a duração
// das aulas de reposição marcadas ou feitas. Uma reposição cancelada devolve os
// minutos sozinha.
//
// No perfil: plano = {professorId, aulasPorSemana, reposicoesConcedidas,
// porIdioma: {en: {aulasPorSemana, reposicoesConcedidas, minutosReposicao}, ...}}.
// "minutosReposicao" são os minutos concedidos; sem ele (planos de antes), cada
// reposição concedida vale 1 hora. Os campos de fora de "porIdioma" são do plano
// antigo (antes de ser por idioma) e valem para o idioma principal do professor
// até ele ajustar o plano de novo.

const MINUTOS_POR_CREDITO = 60;
const SEM_PLANO = { aulasPorSemana: 0, reposicoesConcedidas: 0, minutosReposicao: 0 };

// Minutos de reposição concedidos de um plano (ou de um cadastro de aluno sem app)
function minutosConcedidos(p) {
  if (!p) return 0;
  if (Number.isInteger(p.minutosReposicao)) return p.minutosReposicao;
  return (p.reposicoesConcedidas || 0) * MINUTOS_POR_CREDITO;
}

// A cada 60 minutos de reposição, 1 crédito: com ele o aluno marca uma aula extra
// como reposição. Os minutos que sobram esperam completar o próximo crédito.
function creditosDeReposicao(minutos) {
  return Math.floor(Math.max(0, minutos || 0) / MINUTOS_POR_CREDITO);
}

// "2 créditos (2h45)", "1 crédito (1h)", "0 créditos (45 min)"
function formatarCreditos(minutos) {
  const n = creditosDeReposicao(minutos);
  return `${n} ${n === 1 ? "crédito" : "créditos"} (${formatarMinutos(minutos)})`;
}

// Quanto falta para o próximo crédito: "15 min"
function faltaParaProximoCredito(minutos) {
  return formatarMinutos(MINUTOS_POR_CREDITO - (Math.max(0, minutos || 0) % MINUTOS_POR_CREDITO));
}

// "3h", "1h15", "45 min", "0 min"
function formatarMinutos(total) {
  const m = Math.max(0, Math.round(total || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), resto = m % 60;
  return resto ? `${h}h${String(resto).padStart(2, "0")}` : `${h}h`;
}

// Duração de uma aula em minutos (aulas antigas, sem horário de fim: 1 hora)
function duracaoDaAula(a) {
  if (!a.horaFim) return MINUTOS_POR_CREDITO;
  const d = minutosDoHorario(a.horaFim) - minutosDoHorario(a.horaInicio);
  return d > 0 ? d : MINUTOS_POR_CREDITO;
}

// Plano do aluno com ESTE professor, num idioma (um plano de professor anterior não vale)
function planoDoAluno(perfilAluno, professorId, idioma, idiomaPrincipal) {
  const p = perfilAluno && perfilAluno.plano;
  if (!p || p.professorId !== professorId) return SEM_PLANO;
  const doIdioma = p.porIdioma && p.porIdioma[idioma];
  if (doIdioma) return { aulasPorSemana: doIdioma.aulasPorSemana || 0, reposicoesConcedidas: doIdioma.reposicoesConcedidas || 0, minutosReposicao: minutosConcedidos(doIdioma) };
  if (!p.porIdioma && idioma === idiomaPrincipal) {
    return { aulasPorSemana: p.aulasPorSemana || 0, reposicoesConcedidas: p.reposicoesConcedidas || 0, minutosReposicao: minutosConcedidos(p) };
  }
  return SEM_PLANO;
}

// Monta o plano inteiro (todos os idiomas) com uma mudança num idioma — já
// convertendo o plano antigo para "porIdioma"
function planoComMudanca(perfilAluno, professorId, idiomas, idioma, mudancas) {
  const p = (perfilAluno && perfilAluno.plano && perfilAluno.plano.professorId === professorId) ? perfilAluno.plano : {};
  const porIdioma = {};
  idiomas.forEach((id) => {
    const atual = planoDoAluno(perfilAluno, professorId, id, idiomas[0]);
    if (atual !== SEM_PLANO) porIdioma[id] = { ...atual };
  });
  porIdioma[idioma] = { ...planoDoAluno(perfilAluno, professorId, idioma, idiomas[0]), ...mudancas };
  return {
    professorId,
    aulasPorSemana: p.aulasPorSemana || 0,
    reposicoesConcedidas: p.reposicoesConcedidas || 0,
    porIdioma
  };
}

function aulaContaNoPlano(a) {
  return a.status === "agendada" || a.status === "concluida";
}

function aulaDoIdioma(a, idioma) {
  return idiomaValido(a.idioma) === idioma;
}

// Segunda-feira da semana de uma data "AAAA-MM-DD" (semana de segunda a domingo)
function inicioDaSemanaISO(dataIso) {
  const d = new Date(`${dataIso}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return chaveDataISO(d);
}

function aulasDeReposicao(aulas, professorId, idioma) {
  return aulas.filter((a) => a.professorId === professorId && a.reposicao === true &&
    aulaContaNoPlano(a) && aulaDoIdioma(a, idioma));
}

// Quantas aulas de reposição (marcadas ou feitas)
function reposicoesUsadas(aulas, professorId, idioma) {
  return aulasDeReposicao(aulas, professorId, idioma).length;
}

// Minutos de reposição usados: a soma da duração dessas aulas
function minutosReposicaoUsados(aulas, professorId, idioma) {
  return aulasDeReposicao(aulas, professorId, idioma).reduce((soma, a) => soma + duracaoDaAula(a), 0);
}

// Saldo de reposição, em minutos
function saldoReposicoes(plano, aulas, professorId, idioma) {
  return Math.max(0, minutosConcedidos(plano) - minutosReposicaoUsados(aulas, professorId, idioma));
}

// Aulas normais (não reposição) do aluno, num idioma, na semana da data informada
function aulasNaSemana(aulas, professorId, dataIso, idioma) {
  const semana = inicioDaSemanaISO(dataIso);
  return aulas.filter((a) => a.professorId === professorId && a.reposicao !== true &&
    aulaContaNoPlano(a) && aulaDoIdioma(a, idioma) && inicioDaSemanaISO(a.data) === semana).length;
}

// ============================================================
// FRASES DE EXEMPLO (IA) — usadas pelo aluno e pelo professor ao adicionar palavra
// ============================================================

// Pede à function da Vercel as frases de exemplo de uma palavra (a chave da IA fica
// só no servidor; o token de login prova que o pedido vem de um usuário do app).
// Devolve os campos a gravar na palavra: {frasesExemplo, traducoesSugeridas} ou,
// se a IA não trouxe frases, {frasesExemplo: [], falhaAoGerarFrases, motivoFalhaFrases}.
async function pedirFrasesDaIA(palavra, traducao, idioma) {
  try {
    const token = await auth.currentUser.getIdToken();
    const resposta = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ palavra, traducao, idioma })
    });
    const dados = await resposta.json().catch(() => ({}));
    if (dados.frases && dados.frases.length > 0) {
      const traducoes = Array.isArray(dados.traducoes) ? dados.traducoes.filter((t) => typeof t === "string" && t.trim()).slice(0, 3) : [];
      return { frasesExemplo: dados.frases, traducoesSugeridas: traducoes };
    }
    // A IA respondeu mas não trouxe frases (quota, sobrecarga etc.): o motivo aparece
    // discreto no cartão (ajuda a achar o problema)
    const motivo = String(dados.aviso || dados.erro || `servidor respondeu ${resposta.status}`).slice(0, 200);
    console.warn("IA:", motivo);
    return { frasesExemplo: [], falhaAoGerarFrases: true, motivoFalhaFrases: motivo };
  } catch (e) {
    console.warn("Não foi possível gerar as frases de exemplo agora:", e);
    return { frasesExemplo: [], falhaAoGerarFrases: true, motivoFalhaFrases: "sem conexão com o servidor da IA" };
  }
}

// ============================================================
// WHATSAPP — link "wa.me" com mensagem pré-preenchida, sem precisar de
// nenhuma API paga (o próprio aluno/professor manda a mensagem manualmente
// depois que o link abre o WhatsApp Web/app já com o texto pronto).
// ============================================================

function apenasDigitos(texto) {
  return String(texto || "").replace(/\D/g, "");
}

// Mensagens prontas do WhatsApp. O professor pode trocar o texto de cada uma
// (configuracaoAgenda/dados.mensagensWhatsapp); sem isso, vale o padrão daqui.
// Campos entre chaves são trocados pelos dados da aula. Uma linha com um campo que
// ficou vazio some — ex: "Idioma: {idioma}" quando o professor ensina um idioma só.
const MENSAGENS_WHATSAPP = {
  confirmacao: {
    nome: "Aluno confirma a aula com você",
    padrao: "Olá! Quero confirmar minha aula!\nAluno: {aluno}\nData: {data}\nHorário: {horario}\nModalidade: {modalidade}\nIdioma: {idioma}\nTipo: {tipo}"
  },
  cancelamento: {
    nome: "Aluno avisa você que cancelou",
    padrao: "Olá! Preciso cancelar minha aula:\nAluno: {aluno}\nData: {data}\nHorário: {horario}\nModalidade: {modalidade}\nIdioma: {idioma}"
  },
  confirmacaoProfessor: {
    nome: "Você confirma a aula com o aluno",
    padrao: "Olá {aluno}! Sua aula está marcada:\nData: {data}\nHorário: {horario}\nModalidade: {modalidade}\nIdioma: {idioma}\nTipo: {tipo}\nAté lá!"
  },
  cancelamentoProfessor: {
    nome: "Você avisa o aluno que cancelou",
    padrao: "Olá {aluno}! Infelizmente precisei cancelar sua aula:\nData: {data}\nHorário: {horario}\nVamos combinar um novo horário quando for melhor pra você. Desculpa o transtorno!"
  }
};
const CAMPOS_MENSAGEM_WHATSAPP = ["aluno", "data", "horario", "modalidade", "idioma", "tipo"];

// Texto do modelo "tipo" (o do professor, se ele configurou; senão o padrão)
function modeloMensagemWhatsapp(config, tipo) {
  const proprio = config && config.mensagensWhatsapp && config.mensagensWhatsapp[tipo];
  return typeof proprio === "string" && proprio.trim() ? proprio : MENSAGENS_WHATSAPP[tipo].padrao;
}

// Troca os {campos} pelos dados. Linhas com algum campo vazio são tiradas.
function preencherMensagemWhatsapp(modelo, dados) {
  return String(modelo).split("\n").filter((linha) => {
    const campos = linha.match(/\{(\w+)\}/g) || [];
    return campos.every((c) => { const k = c.slice(1, -1); return !(k in dados) || String(dados[k] || "").trim(); });
  }).map((linha) => linha.replace(/\{(\w+)\}/g, (c, k) => (k in dados ? String(dados[k]) : c))).join("\n").trim();
}

// Dados de uma aula para os campos da mensagem
function dadosDaMensagemWhatsapp({ aluno, data, hora, modalidade, idioma, mostrarIdioma, reposicao, pedido }) {
  return {
    aluno: aluno || "",
    data: data ? formatarDataBR(data) : "",
    horario: hora || "",
    modalidade: modalidade === "online" ? "Online" : modalidade === "presencial" ? "Presencial" : "",
    idioma: mostrarIdioma && idioma ? IDIOMAS[idiomaValido(idioma)].nome : "",
    tipo: pedido ? "Pedido de reposição (aguardando sua aprovação)" : reposicao ? "Reposição" : ""
  };
}

// Janela do app para confirmar algo que também manda mensagem no WhatsApp (ex:
// cancelar uma aula). O clique em "confirmar" é o que abre a aba do WhatsApp — o
// confirm() do navegador antes do window.open() fazia o celular bloquear a aba.
// Depois de feito, a janela mostra um botão para abrir o WhatsApp de novo, caso o
// navegador tenha bloqueado a aba mesmo assim.
// opcoes: {titulo, texto, botao, link (ou null), semLink (texto quando não há
// WhatsApp), feito (texto depois de confirmar), acao: async () => {...}}
function confirmarComWhatsapp(opcoes) {
  let modal = document.getElementById("modal-confirmar-whatsapp");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-confirmar-whatsapp";
    modal.className = "modal-oculto";
    modal.innerHTML = `<div class="modal-conteudo"><div class="modal-cabecalho"><h3 id="titulo-confirmar-whatsapp"></h3>
      <button type="button" class="btn-fechar-modal" title="Fechar" aria-label="Fechar" onclick="document.getElementById('modal-confirmar-whatsapp').classList.add('modal-oculto')">${icone("x")}</button></div>
      <div id="corpo-confirmar-whatsapp"></div></div>`;
    document.body.appendChild(modal);
  }
  const corpo = document.getElementById("corpo-confirmar-whatsapp");
  const fechar = () => modal.classList.add("modal-oculto");
  document.getElementById("titulo-confirmar-whatsapp").textContent = opcoes.titulo;
  corpo.innerHTML = `
    <p class="texto-confirmar-whatsapp"></p>
    <div class="acoes-confirmar-whatsapp">
      <button type="button" class="btn btn-perigo" id="btn-confirmar-whatsapp"></button>
      <button type="button" class="btn btn-secundario" id="btn-voltar-whatsapp">Voltar</button>
    </div>
    <p class="status-msg" id="status-confirmar-whatsapp"></p>`;
  corpo.querySelector(".texto-confirmar-whatsapp").textContent = opcoes.texto;
  document.getElementById("btn-confirmar-whatsapp").textContent = opcoes.botao + (opcoes.link ? " e avisar no WhatsApp" : "");
  document.getElementById("btn-voltar-whatsapp").onclick = fechar;
  document.getElementById("btn-confirmar-whatsapp").onclick = async () => {
    const aba = opcoes.link ? window.open("", "_blank") : null;
    document.getElementById("btn-confirmar-whatsapp").disabled = true;
    try {
      await opcoes.acao();
    } catch (e) {
      console.error(e);
      if (aba) aba.close();
      document.getElementById("btn-confirmar-whatsapp").disabled = false;
      document.getElementById("status-confirmar-whatsapp").textContent = "Não foi possível agora. Confira sua internet e tente de novo.";
      return;
    }
    if (aba) aba.location = opcoes.link;
    corpo.innerHTML = `<p class="texto-confirmar-whatsapp"></p>
      <div class="acoes-confirmar-whatsapp">
        ${opcoes.link ? `<a class="btn btn-primario btn-abrir-whatsapp" href="${escapeHtml(opcoes.link)}" target="_blank" rel="noopener">Abrir o WhatsApp${aba ? " de novo" : ""}</a>` : ""}
        <button type="button" class="btn btn-secundario" id="btn-fechar-confirmar-whatsapp">Fechar</button>
      </div>`;
    corpo.querySelector(".texto-confirmar-whatsapp").textContent = opcoes.link ? opcoes.feito : `${opcoes.feito} ${opcoes.semLink || ""}`.trim();
    document.getElementById("btn-fechar-confirmar-whatsapp").onclick = fechar;
  };
  modal.classList.remove("modal-oculto");
}

// O número é salvo só com DDD+número (mesma lógica da Barbearia B31), então
// sempre prefixamos o código do Brasil (55) antes de montar o link.
function linkWhatsapp(numeroBruto, mensagem) {
  let digitos = apenasDigitos(numeroBruto);
  if (!digitos) return null;
  if (digitos.length <= 11) digitos = "55" + digitos;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

// ============================================================
// MARCAR AULA — usado pelo aluno (agendamento) e pelo professor
// (aulas que ele marca para os alunos, inclusive os sem app)
// ============================================================

// Usa uma transação: o ID do documento é determinístico ("professor_data_hora"), então
// duas tentativas simultâneas de marcar o MESMO horário disputam o mesmo documento — a
// segunda falha com um erro claro, em vez de sobrescrever silenciosamente a primeira.
async function agendarAula(professorId, data, horaInicio, horaFim, modalidade, alunoId, alunoNome, reposicao, idioma, status) {
  const aulaId = `${professorId}_${data}_${horaInicio.replace(":", "")}`;
  const ref = db.collection("aulas").doc(aulaId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Horário cancelado ou com pedido de reposição recusado volta a ficar livre
    if (snap.exists && !["cancelada", "recusada"].includes(snap.data().status)) {
      throw new Error("Esse horário acabou de ser reservado. Escolha outro.");
    }
    tx.set(ref, {
      professorId, alunoId, alunoNome,
      data, horaInicio, horaFim, modalidade,
      reposicao: !!reposicao,
      idioma: idiomaValido(idioma),
      status: status === "pendente" ? "pendente" : "agendada",
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
  return aulaId;
}

// ============================================================
// ARQUIVOS DA SALA DE AULA — guardados no Firestore em pedaços
// ============================================================
// O Firebase Storage exigiria o plano pago (com cartão). Então o arquivo vai
// para usuarios/{aluno}/documentosAula/{id}/partes/{n}, em pedaços de até
// 900 KB (um documento do Firestore guarda no máximo 1 MB).

const TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024; // 10 MB
const TAMANHO_PARTE_ARQUIVO = 900 * 1024;

function formatarTamanhoArquivo(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// Tipos que o navegador mostra numa aba nova; os outros (Word, PowerPoint...) são baixados
function arquivoAbreNoNavegador(tipo) {
  return /^(application\/pdf|image\/|text\/plain|audio\/|video\/)/.test(tipo || "");
}

// Junta os pedaços de volta num arquivo (Blob)
function baixarArquivoDaAula(alunoId, documento) {
  return juntarPartesDoArquivo(db.collection("usuarios").doc(alunoId).collection("documentosAula").doc(documento.id), documento);
}

// Abre (PDF, imagem...) ou baixa o arquivo. A aba nova é aberta ANTES do "await"
// — senão o navegador do celular bloqueia como popup.
async function abrirArquivoDaAula(alunoId, documento) {
  const abreAqui = arquivoAbreNoNavegador(documento.tipoArquivo);
  const aba = abreAqui ? window.open("", "_blank") : null;
  if (aba) aba.document.title = documento.titulo || documento.nomeArquivo;
  try {
    const url = URL.createObjectURL(await baixarArquivoDaAula(alunoId, documento));
    if (aba) {
      aba.location = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = documento.nomeArquivo || "arquivo";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  } catch (e) {
    console.error(e);
    if (aba) aba.close();
    alert("Não foi possível abrir o arquivo agora. Tente novamente.");
  }
}

// Apaga os pedaços do arquivo de um documento (antes de apagar o documento)
async function apagarPartesDoDocumento(documentoRef) {
  const partes = await documentoRef.collection("partes").get();
  await Promise.all(partes.docs.map((d) => d.ref.delete()));
}

// Lista de documentos da sala de aula, pensada para muitos arquivos (aluno e
// professor): busca por título/nome do arquivo, agrupamento por mês e páginas
// de 6 documentos.
const DOCUMENTOS_POR_PAGINA = 6;

// Os itens da página "pagina" (1, 2, 3...) e o total de páginas. Uma página que
// não existe mais (ex: depois de excluir) vira a última.
function paginar(lista, pagina) {
  const total = Math.max(1, Math.ceil(lista.length / DOCUMENTOS_POR_PAGINA));
  const atual = Math.min(Math.max(1, pagina || 1), total);
  return { itens: lista.slice((atual - 1) * DOCUMENTOS_POR_PAGINA, atual * DOCUMENTOS_POR_PAGINA), pagina: atual, total };
}

// Botões "‹ 1 2 3 ›" — só com mais de uma página. aoMudar: código do onclick com
// "%n" no lugar do número da página.
function montarPaginacao(pagina, total, aoMudar) {
  if (total < 2) return "";
  const botao = (n, rotulo, extra) => `<button type="button" class="btn-pagina${n === pagina && !extra ? " ativa" : ""}" ${extra || ""}
    ${n === pagina && !extra ? 'aria-current="page"' : ""} onclick="${aoMudar.replace("%n", n)}">${rotulo}</button>`;
  // Com muitas páginas: a primeira, a última e as vizinhas da atual
  const numeros = [];
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - pagina) <= 1) numeros.push(n);
    else if (numeros[numeros.length - 1] !== "…") numeros.push("…");
  }
  return `<nav class="paginacao" aria-label="Páginas">
    ${botao(pagina - 1, "‹", `aria-label="Página anterior" ${pagina === 1 ? "disabled" : ""}`)}
    ${numeros.map((n) => n === "…" ? `<span class="reticencias-pagina">…</span>` : botao(n, n)).join("")}
    ${botao(pagina + 1, "›", `aria-label="Próxima página" ${pagina === total ? "disabled" : ""}`)}
    <span class="data-msg">Página ${pagina} de ${total}</span>
  </nav>`;
}

function semAcentos(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// opcoes: busca, pagina, idBusca, aoBuscar / aoMudarPagina (código do oninput/onclick, com "%n"),
// item(documento) -> html, vazio (texto quando não há documento nenhum)
function montarListaDocumentosAula(documentos, opcoes) {
  if (documentos.length === 0) return `<p class="vazio">${opcoes.vazio}</p>`;

  const termo = semAcentos(opcoes.busca).trim();
  const encontrados = termo
    ? documentos.filter((d) => semAcentos(`${d.titulo} ${d.nomeArquivo || ""}`).includes(termo))
    : documentos;
  const { itens: visiveis, pagina, total } = paginar(encontrados, opcoes.pagina);

  const grupos = [];
  visiveis.forEach((d) => {
    const data = d.criadoEm ? d.criadoEm.toDate() : new Date(); // recém-criado: data do servidor ainda não chegou
    const rotulo = data.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(d);
    else grupos.push({ rotulo, itens: [d] });
  });

  const busca = documentos.length > 5 || termo ? `
    <div class="busca-documentos">
      <input type="text" id="${opcoes.idBusca}" placeholder="Buscar documento..." value="${escapeHtml(opcoes.busca || "")}" oninput="${opcoes.aoBuscar}">
      <span class="data-msg">${termo ? `${encontrados.length} de ${documentos.length}` : `${documentos.length} documentos`}</span>
    </div>` : "";

  const lista = grupos.map((g) => `
    <div class="grupo-documentos">
      <div class="titulo-grupo-documentos">${escapeHtml(g.rotulo.charAt(0).toUpperCase() + g.rotulo.slice(1))}</div>
      ${g.itens.map(opcoes.item).join("")}
    </div>`).join("");

  return busca + (encontrados.length ? lista : `<p class="vazio">Nenhum documento encontrado.</p>`) +
    montarPaginacao(pagina, total, opcoes.aoMudarPagina);
}
