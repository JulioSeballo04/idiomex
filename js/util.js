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

// Lê um texto em voz alta usando a Web Speech API do navegador (sem custo,
// sem depender de nenhuma API externa). Se o navegador não suportar, não faz nada.
function falar(texto) {
  if (!("speechSynthesis" in window) || !texto) return;
  window.speechSynthesis.cancel(); // corta qualquer fala em andamento antes de começar outra
  const utterancia = new SpeechSynthesisUtterance(texto);
  utterancia.lang = "en-US";
  window.speechSynthesis.speak(utterancia);
}

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

// A partir dos blocos de disponibilidade de um dia (ex: [{inicio:"08:00", fim:"12:00"}]),
// gera a lista de horários de início possíveis para aulas de "duracaoMinutos".
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
  return slots;
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
