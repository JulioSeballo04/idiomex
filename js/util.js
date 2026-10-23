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

// Esc fecha a janela (modal) que estiver aberta, como o botão ✕ dela
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const aberto = document.querySelector('[id^="modal-"]:not(.modal-oculto)');
  const fechar = aberto && aberto.querySelector(".btn-fechar-modal");
  if (fechar) fechar.click();
});

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

// A partir dos blocos de disponibilidade de um dia (ex: [{inicio:"08:00", fim:"12:00"}]),
// gera a lista de horários de início possíveis para aulas de "duracaoMinutos".
// Sem repetidos e em ordem, mesmo que o professor configure períodos que se sobrepõem.
function gerarSlotsDoDia(blocos, duracaoMinutos) {
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
      minutoAtual += duracaoMinutos;
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
// semana (0 = sem limite) e dá créditos de reposição. O saldo de reposições é
// calculado a partir das próprias aulas daquele idioma: créditos concedidos menos
// as aulas de reposição marcadas ou feitas. Uma reposição cancelada devolve o
// crédito sozinha.
//
// No perfil: plano = {professorId, aulasPorSemana, reposicoesConcedidas,
// porIdioma: {en: {aulasPorSemana, reposicoesConcedidas}, ...}}. Os campos de fora
// de "porIdioma" são do plano antigo (antes de ser por idioma) e valem para o
// idioma principal do professor até ele ajustar o plano de novo.

const SEM_PLANO = { aulasPorSemana: 0, reposicoesConcedidas: 0 };

// Plano do aluno com ESTE professor, num idioma (um plano de professor anterior não vale)
function planoDoAluno(perfilAluno, professorId, idioma, idiomaPrincipal) {
  const p = perfilAluno && perfilAluno.plano;
  if (!p || p.professorId !== professorId) return SEM_PLANO;
  const doIdioma = p.porIdioma && p.porIdioma[idioma];
  if (doIdioma) return { aulasPorSemana: doIdioma.aulasPorSemana || 0, reposicoesConcedidas: doIdioma.reposicoesConcedidas || 0 };
  if (!p.porIdioma && idioma === idiomaPrincipal) {
    return { aulasPorSemana: p.aulasPorSemana || 0, reposicoesConcedidas: p.reposicoesConcedidas || 0 };
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

function reposicoesUsadas(aulas, professorId, idioma) {
  return aulas.filter((a) => a.professorId === professorId && a.reposicao === true &&
    aulaContaNoPlano(a) && aulaDoIdioma(a, idioma)).length;
}

function saldoReposicoes(plano, aulas, professorId, idioma) {
  return Math.max(0, plano.reposicoesConcedidas - reposicoesUsadas(aulas, professorId, idioma));
}

// Aulas normais (não reposição) do aluno, num idioma, na semana da data informada
function aulasNaSemana(aulas, professorId, dataIso, idioma) {
  const semana = inicioDaSemanaISO(dataIso);
  return aulas.filter((a) => a.professorId === professorId && a.reposicao !== true &&
    aulaContaNoPlano(a) && aulaDoIdioma(a, idioma) && inicioDaSemanaISO(a.data) === semana).length;
}

// ============================================================
// WHATSAPP — link "wa.me" com mensagem pré-preenchida, sem precisar de
// nenhuma API paga (o próprio aluno/professor manda a mensagem manualmente
// depois que o link abre o WhatsApp Web/app já com o texto pronto).
// ============================================================

function apenasDigitos(texto) {
  return String(texto || "").replace(/\D/g, "");
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
async function baixarArquivoDaAula(alunoId, documento) {
  const snap = await db.collection("usuarios").doc(alunoId).collection("documentosAula").doc(documento.id)
    .collection("partes").orderBy("indice").get();
  if (snap.size !== documento.partes) throw new Error("arquivo incompleto");
  return new Blob(snap.docs.map((d) => d.data().dados.toUint8Array()),
    { type: documento.tipoArquivo || "application/octet-stream" });
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
// professor): busca por título/nome do arquivo, agrupamento por mês e só os
// mais recentes de início, com "Mostrar mais".
const DOCUMENTOS_POR_PAGINA = 10;

function semAcentos(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// opcoes: busca, limite, idBusca, aoBuscar / aoMostrarMais (código do onclick/oninput),
// item(documento) -> html, vazio (texto quando não há documento nenhum)
function montarListaDocumentosAula(documentos, opcoes) {
  if (documentos.length === 0) return `<p class="vazio">${opcoes.vazio}</p>`;

  const termo = semAcentos(opcoes.busca).trim();
  const encontrados = termo
    ? documentos.filter((d) => semAcentos(`${d.titulo} ${d.nomeArquivo || ""}`).includes(termo))
    : documentos;
  const visiveis = encontrados.slice(0, opcoes.limite);

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

  const restantes = encontrados.length - visiveis.length;
  const mais = restantes > 0
    ? `<button class="btn btn-secundario btn-mostrar-mais" onclick="${opcoes.aoMostrarMais}">Mostrar mais (${restantes})</button>`
    : "";

  return busca + (encontrados.length ? lista : `<p class="vazio">Nenhum documento encontrado.</p>`) + mais;
}
