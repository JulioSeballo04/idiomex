// Testes do servidor dos lembretes (api/lembretes.js) com o Firestore e o login
// emulados e um Firebase Cloud Messaging falso (servidor local que só anota os envios).
// Rodar com: npm run test:lembretes
import assert from "node:assert/strict";
import http from "node:http";

const PROJETO = "demo-idiomex";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8089";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.GCLOUD_PROJECT = PROJETO;
process.env.CRON_SECRET = "segredo-de-teste";

// FCM falso: anota cada envio; o token "tok-morto" responde como aparelho desinstalado
const envios = [];
const fcm = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => { corpo += c; });
  req.on("end", () => {
    const { message } = JSON.parse(corpo);
    if (message.token === "tok-morto") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }));
    }
    envios.push(message);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "ok" }));
  });
});
await new Promise((r) => fcm.listen(8799, r));
process.env.FCM_URL_TESTE = "http://127.0.0.1:8799/send";

const { default: handler, processarLembretes, minutosAte, agoraNoFuso, textoDoLembrete, ehDiaDeTrabalho } = await import("../api/lembretes.js");

const RAIZ = `http://${FIRESTORE}/v1/projects/${PROJETO}/databases/(default)/documents`;
const valor = (v) => (typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: v });
async function gravar(caminho, campos) {
  const r = await fetch(`${RAIZ}/${caminho}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, valor(v)])) })
  });
  assert.ok(r.ok, `gravar ${caminho}: ${r.status}`);
}
async function existe(caminho) {
  const r = await fetch(`${RAIZ}/${caminho}`, { headers: { Authorization: "Bearer owner" } });
  return r.ok;
}
await fetch(`http://${FIRESTORE}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });

let ok = 0, falhas = 0;
async function t(nome, fn) {
  try { await fn(); ok++; console.log("ok  ", nome); }
  catch (e) { falhas++; console.log("FAIL", nome, "—", e.message.split("\n")[0]); }
}

// Contas: P1 (professor com 2 aparelhos), P2 (sem aparelho)
await gravar("usuarios/P1/dispositivos/d1", { token: "tok-1", antecedencia: 60, fuso: "America/Sao_Paulo" });
await gravar("usuarios/P1/dispositivos/d2", { token: "tok-morto", antecedencia: 30, fuso: "America/Sao_Paulo" });
const aula = (id, campos) => gravar(`aulas/${id}`, { professorId: "P1", data: "2026-11-16", status: "agendada", alunoNome: "Ana", modalidade: "online", horaFim: "23:59", ...campos });
await aula("A1", { horaInicio: "10:45" });                       // em 45 min
await aula("A2", { horaInicio: "10:20", alunoNome: "Bruno" });   // em 20 min
await aula("A3", { horaInicio: "12:00" });                       // em 2h: ainda não
await aula("A4", { horaInicio: "10:30", status: "cancelada" });  // cancelada
await aula("A5", { horaInicio: "10:30", professorId: "P2" });    // de outro professor
await aula("A6", { horaInicio: "09:00" });                       // já começou
await gravar("usuarios/P1/anotacoesAgenda/C1", { tipo: "compromisso", data: "2026-11-16", horaInicio: "10:50", horaFim: "12:00", texto: "Médico" });
await gravar("usuarios/P1/anotacoesAgenda/C2", { tipo: "compromisso", data: "2026-11-16", horaInicio: "", texto: "Dia todo" });
await gravar("usuarios/P1/anotacoesAgenda/2026-11-16", { tipo: "dia", data: "2026-11-16", texto: "Anotação comum" });

// 13:00 UTC = 10:00 em São Paulo
const AGORA = new Date("2026-11-16T13:00:00Z");

await t("horário local no fuso do professor", async () => {
  assert.deepEqual(agoraNoFuso("America/Sao_Paulo", AGORA), { data: "2026-11-16", minutos: 600 });
  assert.deepEqual(agoraNoFuso("Fuso/Inexistente", AGORA), { data: "2026-11-16", minutos: 600 });
  assert.equal(minutosAte({ data: "2026-11-17", horaInicio: "00:15" }, { data: "2026-11-16", minutos: 23 * 60 + 30 }), 45);
});

await t("texto do lembrete da aula e do compromisso", async () => {
  assert.deepEqual(textoDoLembrete({ tipo: "aula", horaInicio: "10:45", alunoNome: "Ana", modalidade: "online" }, 45),
    { titulo: "Aula às 10:45 com Ana", corpo: "Começa em 45 min (online)." });
  assert.deepEqual(textoDoLembrete({ tipo: "compromisso", horaInicio: "14:00", texto: "Médico" }, 60),
    { titulo: "Compromisso às 14:00", corpo: "Médico · em 1h." });
});

await t("manda só o que começa dentro do tempo escolhido em cada aparelho", async () => {
  const resumo = await processarLembretes(AGORA);
  const titulos = envios.map((m) => `${m.token}: ${m.data.titulo}`).sort();
  assert.deepEqual(titulos, [
    "tok-1: Aula às 10:20 com Bruno",
    "tok-1: Aula às 10:45 com Ana",
    "tok-1: Compromisso às 10:50"
  ]);
  assert.equal(resumo.enviados, 3);
  assert.ok(envios.every((m) => m.data.url === "professor.html" && m.data.tag.startsWith("lembrete-")));
});

await t("aparelho que desinstalou o app sai da lista", async () => {
  assert.equal(await existe("usuarios/P1/dispositivos/d2"), false);
  assert.equal(await existe("usuarios/P1/dispositivos/d1"), true);
});

await t("cada lembrete sai uma vez só", async () => {
  envios.length = 0;
  await processarLembretes(new Date(AGORA.getTime() + 5 * 60000));
  assert.deepEqual(envios, []);
});

await t("perto da meia-noite, avisa a aula do dia seguinte", async () => {
  envios.length = 0;
  await aula("A7", { data: "2026-11-17", horaInicio: "00:15", alunoNome: "Carla" });
  await processarLembretes(new Date("2026-11-17T02:30:00Z")); // 23:30 em São Paulo
  assert.deepEqual(envios.map((m) => m.data.titulo), ["Aula às 00:15 com Carla"]);
});

await t('dia de atendimento sem aula: às 20h pergunta "não teve aula hoje?" uma vez só', async () => {
  envios.length = 0;
  await processarLembretes(new Date("2026-11-18T22:00:00Z")); // quarta, 19:00 em São Paulo: ainda não
  assert.deepEqual(envios, []);
  await processarLembretes(new Date("2026-11-18T23:30:00Z")); // 20:30
  assert.deepEqual(envios.map((m) => `${m.token}: ${m.data.titulo}`), ["tok-1: Não teve aula hoje?"]);
  assert.equal(await existe("usuarios/P1/notificacoes/dia-sem-aula-2026-11-18"), true);
  envios.length = 0;
  await processarLembretes(new Date("2026-11-18T23:50:00Z"));
  assert.deepEqual(envios, []);
});

await t("não pergunta em dia com aula, fora do atendimento ou com o aviso desligado", async () => {
  envios.length = 0;
  await processarLembretes(new Date("2026-11-17T23:30:00Z")); // terça: teve a aula das 00:15
  await processarLembretes(new Date("2026-11-21T23:30:00Z")); // sábado (sem grade: só de segunda a sexta)
  await gravar("usuarios/P1/agendaOverrides/2026-11-19", { fechado: true });
  await processarLembretes(new Date("2026-11-19T23:30:00Z")); // dia fechado
  await gravar("usuarios/P1/configuracaoAgenda/dados", { avisoDiaSemAula: false });
  await processarLembretes(new Date("2026-11-20T23:30:00Z")); // aviso desligado
  assert.deepEqual(envios, []);
  assert.equal(await existe("usuarios/P1/notificacoes/dia-sem-aula-2026-11-20"), false);
});

await t("dia de trabalho pela grade semanal (padrão ou de um idioma) e pelo ajuste do dia", async () => {
  const grade = { disponibilidade: { sab: [{ inicio: "08:00", fim: "12:00" }] } };
  assert.equal(ehDiaDeTrabalho(grade, null, "2026-11-21"), true);  // sábado
  assert.equal(ehDiaDeTrabalho(grade, null, "2026-11-23"), false); // segunda
  assert.equal(ehDiaDeTrabalho({ porIdioma: { en: grade } }, null, "2026-11-21"), true);
  assert.equal(ehDiaDeTrabalho(grade, { blocos: [{ inicio: "14:00", fim: "16:00" }] }, "2026-11-23"), true);
  assert.equal(ehDiaDeTrabalho({}, null, "2026-11-23"), true);
});

// O endereço público: sem a chave só diz se está pronto
const chamar = (req) => new Promise((resolve) => {
  const res = { cabecalhos: {}, setHeader(k, v) { this.cabecalhos[k] = v; }, status(c) { this.codigo = c; return this; }, json(d) { resolve({ codigo: this.codigo, dados: d }); }, end() { resolve({ codigo: this.codigo }); } };
  handler({ method: "GET", headers: {}, query: {}, ...req }, res);
});

await t("sem a chave do agendador, só responde se está pronto", async () => {
  const r = await chamar({});
  assert.deepEqual(r.dados, { pronto: true });
});

await t("com a chave errada não dispara nada", async () => {
  envios.length = 0;
  const r = await chamar({ query: { chave: "errada" } });
  assert.deepEqual(r.dados, { pronto: true });
  assert.equal(envios.length, 0);
});

await t("com a chave certa (na URL ou no cabeçalho) dispara", async () => {
  const r1 = await chamar({ query: { chave: "segredo-de-teste" } });
  assert.equal(r1.codigo, 200);
  assert.ok("enviados" in r1.dados);
  const r2 = await chamar({ headers: { authorization: "Bearer segredo-de-teste" } });
  assert.ok("enviados" in r2.dados);
});

await t('"Mandar um teste": só com login válido, e só para os aparelhos da pessoa', async () => {
  const conta = await (await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=teste`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "prof-lembrete@t.com", password: "senha123", returnSecureToken: true })
  })).json();
  await gravar(`usuarios/${conta.localId}/dispositivos/x1`, { token: "tok-teste", antecedencia: 60, fuso: "America/Sao_Paulo" });
  envios.length = 0;
  const ruim = await chamar({ method: "POST", headers: { authorization: "Bearer token-falso" }, body: {} });
  assert.equal(ruim.codigo, 401);
  const bom = await chamar({ method: "POST", headers: { authorization: `Bearer ${conta.idToken}` }, body: { token: "tok-teste" } });
  assert.deepEqual(bom.dados, { aparelhos: 1, enviados: 1 });
  assert.deepEqual(envios.map((m) => m.token), ["tok-teste"]);
  const deOutro = await chamar({ method: "POST", headers: { authorization: `Bearer ${conta.idToken}` }, body: { token: "tok-1" } });
  assert.deepEqual(deOutro.dados, { aparelhos: 0, enviados: 0 });
});

fcm.close();
console.log(`\n${ok} ok, ${falhas} failed`);
process.exit(falhas ? 1 : 0);
