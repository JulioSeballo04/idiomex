// ============================================================
// LEMBRETES ANTES DAS AULAS (Vercel) — notificação no celular do professor
// ============================================================
// Um agendador externo (ex: cron-job.org, grátis) chama este endereço a cada 5
// minutos. A cada chamada, para cada professor que ligou os lembretes num aparelho,
// procura aulas marcadas e compromissos da agenda que começam dentro do tempo
// escolhido (padrão: 1 hora) e manda uma notificação para o aparelho, pelo Firebase
// Cloud Messaging. Cada lembrete sai uma vez só (fica registrado em
// "lembretesEnviados").
//
// Como configurar (passo a passo no README):
// 1. Firebase → Configurações do projeto → Contas de serviço → "Gerar nova chave
//    privada" (baixa um arquivo .json).
// 2. Vercel → Settings → Environment Variables:
//      FIREBASE_SERVICE_ACCOUNT = o conteúdo inteiro desse .json
//      CRON_SECRET              = uma senha qualquer, longa (só o agendador sabe)
//    e faça um novo deploy.
// 3. cron-job.org → novo job a cada 5 minutos para
//      https://idiomex.vercel.app/api/lembretes?chave=<CRON_SECRET>
//
// Também atende o botão "Mandar um teste" do app (POST com o login do professor).
// Sem dependências: fala direto com as APIs REST do Google.
// ============================================================

import crypto from "node:crypto";

const PROJETO_PADRAO = "novo-dicionario";
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCRXSlpf1GTj3VirFel8SOdNwXuniG6el8";
const FUSO_PADRAO = "America/Sao_Paulo";
const ANTECEDENCIAS = [15, 30, 60, 120];
const ORIGENS_PERMITIDAS = ["https://novo-dicionario.web.app", "https://novo-dicionario.firebaseapp.com"];

// -------------------- CREDENCIAIS --------------------

function contaDeServico() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) return null;
  try {
    const conta = JSON.parse(bruto);
    if (conta.private_key) conta.private_key = conta.private_key.replace(/\\n/g, "\n");
    return conta.client_email && conta.private_key ? conta : null;
  } catch (e) {
    return null;
  }
}

function emulador() {
  return process.env.FIRESTORE_EMULATOR_HOST || "";
}

function projeto() {
  const conta = contaDeServico();
  return process.env.GCLOUD_PROJECT || (conta && conta.project_id) || PROJETO_PADRAO;
}

export function configurado() {
  return !!(emulador() || contaDeServico());
}

const base64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let tokenGuardado = null; // { valor, expira }

async function tokenDeAcesso() {
  if (emulador()) return "owner";
  if (tokenGuardado && tokenGuardado.expira > Date.now() + 60000) return tokenGuardado.valor;
  const conta = contaDeServico();
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(JSON.stringify({
    iss: conta.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600
  }));
  const assinatura = base64url(crypto.createSign("RSA-SHA256").update(`${cabecalho}.${corpo}`).sign(conta.private_key));
  const resposta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cabecalho}.${corpo}.${assinatura}` })
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) throw new Error(`Login do Google falhou: ${dados.error_description || dados.error || resposta.status}`);
  tokenGuardado = { valor: dados.access_token, expira: Date.now() + (dados.expires_in || 3600) * 1000 };
  return tokenGuardado.valor;
}

// -------------------- FIRESTORE (REST) --------------------

function raizDocumentos() {
  const host = emulador();
  return `${host ? `http://${host}` : "https://firestore.googleapis.com"}/v1/projects/${projeto()}/databases/(default)/documents`;
}

async function pedirFirestore(caminho, opcoes = {}) {
  const resposta = await fetch(`${raizDocumentos()}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenDeAcesso()}`, ...(opcoes.headers || {}) }
  });
  const dados = await resposta.json().catch(() => ({}));
  return { ok: resposta.ok, status: resposta.status, dados };
}

// Valor do Firestore REST -> valor comum
function lerValor(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(lerValor);
  if ("mapValue" in v) return lerCampos(v.mapValue.fields || {});
  return null;
}
function lerCampos(campos) {
  const obj = {};
  Object.keys(campos || {}).forEach((k) => { obj[k] = lerValor(campos[k]); });
  return obj;
}
const texto = (s) => ({ stringValue: String(s) });

async function consultar(pai, consulta) {
  const { ok, dados } = await pedirFirestore(`${pai}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery: consulta }) });
  if (!ok) throw new Error(`Consulta ao banco falhou: ${JSON.stringify(dados).slice(0, 300)}`);
  return (Array.isArray(dados) ? dados : []).filter((r) => r.document).map((r) => ({
    nome: r.document.name,
    id: r.document.name.split("/").pop(),
    ...lerCampos(r.document.fields)
  }));
}

const igual = (campo, valor) => ({ fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: texto(valor) } });
const entre = (campo, valores) => ({ fieldFilter: { field: { fieldPath: campo }, op: "IN", value: { arrayValue: { values: valores.map(texto) } } } });

// Aparelhos com lembrete ligado: usuarios/{uid}/dispositivos/{id}
async function dispositivosDe(uid) {
  const consulta = { from: [{ collectionId: "dispositivos", allDescendants: !uid }] };
  const lista = await consultar(uid ? `/usuarios/${uid}` : "", consulta);
  return lista.map((d) => ({ ...d, uid: d.nome.split("/documents/")[1].split("/")[1] }));
}

async function eventosDoProfessor(uid, datas) {
  const aulas = await consultar("", {
    from: [{ collectionId: "aulas" }],
    where: { compositeFilter: { op: "AND", filters: [igual("professorId", uid), entre("data", datas)] } }
  });
  const notas = await consultar(`/usuarios/${uid}`, {
    from: [{ collectionId: "anotacoesAgenda" }],
    where: entre("data", datas)
  });
  return [
    ...aulas.filter((a) => a.status === "agendada" && a.horaInicio).map((a) => ({ tipo: "aula", ...a })),
    ...notas.filter((n) => n.tipo === "compromisso" && n.horaInicio).map((n) => ({ tipo: "compromisso", ...n }))
  ];
}

// Marca o lembrete como enviado. Devolve false se outro disparo já mandou.
async function marcarEnviado(chave, campos) {
  const { ok, status } = await pedirFirestore(`/lembretesEnviados?documentId=${encodeURIComponent(chave)}`, {
    method: "POST",
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, texto(v)])) })
  });
  if (ok) return true;
  if (status === 409) return false;
  throw new Error(`Não foi possível registrar o lembrete (HTTP ${status})`);
}

async function apagar(nome) {
  const caminho = nome.split("/documents")[1];
  await pedirFirestore(caminho, { method: "DELETE" });
}

// -------------------- HORÁRIOS --------------------

// Data ("AAAA-MM-DD") e minutos do dia agora, no fuso do professor
export function agoraNoFuso(fuso, agora = new Date()) {
  let partes;
  try {
    partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora);
  } catch (e) {
    return agoraNoFuso(FUSO_PADRAO, agora);
  }
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

function somarDias(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const minutosDe = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };

// Quantos minutos faltam para o evento começar
export function minutosAte(evento, agora) {
  const dias = Math.round((Date.parse(`${evento.data}T00:00:00Z`) - Date.parse(`${agora.data}T00:00:00Z`)) / 86400000);
  return dias * 1440 + minutosDe(evento.horaInicio) - agora.minutos;
}

function faltam(minutos) {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const MODALIDADES = { online: "online", presencial: "presencial" };

export function textoDoLembrete(evento, minutos) {
  if (evento.tipo === "aula") {
    const detalhes = [MODALIDADES[evento.modalidade], evento.reposicao ? "reposição" : ""].filter(Boolean).join(" · ");
    return {
      titulo: `Aula às ${evento.horaInicio} com ${evento.alunoNome || "aluno"}`,
      corpo: `Começa em ${faltam(minutos)}${detalhes ? ` (${detalhes})` : ""}.`
    };
  }
  return {
    titulo: `Compromisso às ${evento.horaInicio}`,
    corpo: `${evento.texto || "Compromisso"} · em ${faltam(minutos)}.`
  };
}

const chaveDoLembrete = (uid, dispositivoId, evento) =>
  crypto.createHash("sha1").update([uid, dispositivoId, evento.tipo, evento.id, evento.data, evento.horaInicio].join("|")).digest("hex");

// -------------------- ENVIO (FCM) --------------------

async function enviarNotificacao(token, mensagem) {
  const url = process.env.FCM_URL_TESTE || `https://fcm.googleapis.com/v1/projects/${projeto()}/messages:send`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenDeAcesso()}` },
    body: JSON.stringify({
      message: {
        token,
        data: { titulo: mensagem.titulo, corpo: mensagem.corpo, tag: mensagem.tag, url: "professor.html" },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
        android: { priority: "high" }
      }
    })
  });
  if (resposta.ok) return { ok: true };
  const dados = await resposta.json().catch(() => ({}));
  const codigo = (dados.error && (dados.error.details || []).map((d) => d.errorCode).find(Boolean)) || (dados.error && dados.error.status) || "";
  // Aparelho que desinstalou o app / tirou a permissão: o token não vale mais
  const tokenMorto = resposta.status === 404 || ["UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"].includes(codigo);
  return { ok: false, tokenMorto, erro: `${resposta.status} ${codigo}` };
}

// -------------------- O QUE O AGENDADOR CHAMA --------------------

export async function processarLembretes(agora = new Date()) {
  const dispositivos = await dispositivosDe("");
  const porProfessor = {};
  dispositivos.filter((d) => d.token).forEach((d) => { (porProfessor[d.uid] = porProfessor[d.uid] || []).push(d); });

  const resumo = { professores: 0, enviados: 0, erros: 0 };
  for (const [uid, aparelhos] of Object.entries(porProfessor)) {
    resumo.professores++;
    try {
      const fuso = aparelhos[0].fuso || FUSO_PADRAO;
      const agoraLocal = agoraNoFuso(fuso, agora);
      const eventos = await eventosDoProfessor(uid, [agoraLocal.data, somarDias(agoraLocal.data, 1)]);
      for (const aparelho of aparelhos) {
        const antecedencia = ANTECEDENCIAS.includes(aparelho.antecedencia) ? aparelho.antecedencia : 60;
        const agoraDoAparelho = agoraNoFuso(aparelho.fuso || fuso, agora);
        for (const evento of eventos) {
          const minutos = minutosAte(evento, agoraDoAparelho);
          if (minutos <= 0 || minutos > antecedencia) continue;
          const chave = chaveDoLembrete(uid, aparelho.id, evento);
          if (!(await marcarEnviado(chave, { professorId: uid, evento: evento.id, data: evento.data, horaInicio: evento.horaInicio }))) continue;
          const resultado = await enviarNotificacao(aparelho.token, { ...textoDoLembrete(evento, minutos), tag: `lembrete-${evento.tipo}-${evento.id}-${evento.data}-${evento.horaInicio}` });
          if (resultado.ok) { resumo.enviados++; continue; }
          resumo.erros++;
          if (resultado.tokenMorto) { await apagar(aparelho.nome).catch(() => {}); break; }
          await apagar(`${raizDocumentos()}/lembretesEnviados/${chave}`).catch(() => {}); // tenta de novo no próximo disparo
        }
      }
    } catch (e) {
      console.error("Lembretes de", uid, e);
      resumo.erros++;
    }
  }
  return resumo;
}

// Botão "Mandar um teste": confere o login do professor e manda para os aparelhos dele
async function usuarioDoToken(idToken) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const url = host
    ? `http://${host}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=teste`
    : `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: "https://idiomex.vercel.app/" },
    body: JSON.stringify({ idToken })
  });
  const dados = await resposta.json().catch(() => ({}));
  return resposta.ok ? (dados.users && dados.users[0] && dados.users[0].localId) || null : null;
}

async function mandarTeste(uid, token) {
  const aparelhos = (await dispositivosDe(uid)).filter((d) => d.token && (!token || d.token === token));
  let enviados = 0;
  for (const aparelho of aparelhos) {
    const r = await enviarNotificacao(aparelho.token, {
      titulo: "Lembretes do Idiomex ligados",
      corpo: "Assim chega o aviso antes de cada aula e compromisso da agenda.",
      tag: "lembrete-teste"
    });
    if (r.ok) enviados++;
    else if (r.tokenMorto) await apagar(aparelho.nome).catch(() => {});
  }
  return { aparelhos: aparelhos.length, enviados };
}

export default async function handler(req, res) {
  const origem = req.headers.origin || "";
  if (ORIGENS_PERMITIDAS.includes(origem)) res.setHeader("Access-Control-Allow-Origin", origem);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const segredo = process.env.CRON_SECRET || "";
  const chave = (req.query && req.query.chave) || "";
  const autorizacao = req.headers.authorization || "";

  // Disparo do agendador
  if (segredo && (chave === segredo || autorizacao === `Bearer ${segredo}`)) {
    if (!configurado()) return res.status(503).json({ erro: "FIREBASE_SERVICE_ACCOUNT não configurada na Vercel." });
    try {
      return res.status(200).json(await processarLembretes());
    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: e.message });
    }
  }

  // Botão de teste do app
  if (req.method === "POST" && autorizacao.startsWith("Bearer ")) {
    if (!configurado()) return res.status(503).json({ erro: "servidor-nao-configurado" });
    const uid = await usuarioDoToken(autorizacao.slice(7)).catch(() => null);
    if (!uid) return res.status(401).json({ erro: "login-invalido" });
    try {
      const corpo = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      return res.status(200).json(await mandarTeste(uid, corpo.token));
    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: e.message });
    }
  }

  // Sem chave: só diz se o servidor está pronto (o app mostra um aviso se não estiver)
  return res.status(200).json({ pronto: configurado() && !!segredo });
}
