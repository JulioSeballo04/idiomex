// ============================================================
// FUNCTION SERVERLESS (Vercel) — gera a frase de exemplo
// ============================================================
// Esse arquivo roda no servidor da Vercel, nunca no navegador.
// A chave da IA (GEMINI_API_KEY) fica guardada nas variáveis de
// ambiente da Vercel — o usuário do site nunca tem acesso a ela.
//
// Como configurar:
// 1. Crie uma chave gratuita em https://aistudio.google.com/app/apikey
// 2. No painel da Vercel: Project Settings -> Environment Variables
//    -> adicione GEMINI_API_KEY = sua_chave
// 3. Faça o deploy (vercel --prod ou via GitHub)
// ============================================================

// Só esses domínios podem chamar essa function. Ajuste aqui se o projeto do
// Firebase Hosting mudar de nome. Sem essa lista, "*" deixa qualquer site da
// internet usar sua chave e sua cota gratuita do Gemini.
const ORIGENS_PERMITIDAS = [
  "https://novo-dicionario.web.app",
  "https://novo-dicionario.firebaseapp.com"
];

// Idiomas aceitos (chave = código guardado no perfil do professor; valor = nome em
// português usado no prompt). Mantenha igual à lista IDIOMAS de js/util.js.
const IDIOMAS = {
  en: "inglês",
  es: "espanhol",
  it: "italiano",
  fr: "francês",
  ja: "japonês",
  zh: "mandarim (chinês simplificado)",
  de: "alemão",
  ko: "coreano"
};

// Chave pública do app web do Firebase (a mesma de js/firebase-config.js — não é
// segredo). Serve só pra perguntar ao Firebase Auth se o token de login é válido.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCRXSlpf1GTj3VirFel8SOdNwXuniG6el8";

// Limite de pedidos por usuário. Fica na memória de cada instância da function,
// então é uma barreira contra abuso (scripts disparando pedidos), não uma cota
// exata — a Vercel pode rodar mais de uma instância ao mesmo tempo.
const LIMITE_PEDIDOS = 30;
const JANELA_LIMITE_MS = 10 * 60 * 1000; // 10 minutos
const pedidosPorUsuario = new Map(); // uid -> [instantes dos pedidos recentes]

function excedeuLimite(uid) {
  const agora = Date.now();
  const recentes = (pedidosPorUsuario.get(uid) || []).filter((t) => agora - t < JANELA_LIMITE_MS);
  if (recentes.length >= LIMITE_PEDIDOS) {
    pedidosPorUsuario.set(uid, recentes);
    return true;
  }
  recentes.push(agora);
  pedidosPorUsuario.set(uid, recentes);
  return false;
}

// Confere o token de login (Firebase ID token) mandado pelo app. Usa a API REST do
// Firebase Auth, que valida o token contra este projeto — sem chave de serviço.
// Devolve { uid } se o login é válido, { invalido: true } se o token é inválido ou
// expirou, ou { erroServidor } se a própria conferência falhou (configuração).
//
// "site" vai no cabeçalho Referer: a chave web do Firebase costuma ser restrita aos
// sites do app (Google Cloud → Credenciais), e sem o Referer o Google recusa o
// pedido vindo do servidor como se fosse de um site desconhecido.
async function conferirLogin(idToken, site) {
  if (!idToken) return { invalido: true };
  try {
    const resposta = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": `${site}/` },
        body: JSON.stringify({ idToken })
      }
    );
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.ok) {
      const uid = dados?.users?.[0]?.localId;
      return uid ? { uid } : { invalido: true };
    }
    const mensagem = dados?.error?.message || `HTTP ${resposta.status}`;
    // Token ruim/expirado é problema do pedido; qualquer outra coisa (chave
    // bloqueada, API desativada...) é problema de configuração do servidor.
    if (/INVALID_ID_TOKEN|TOKEN_EXPIRED|USER_NOT_FOUND|USER_DISABLED/.test(mensagem)) return { invalido: true };
    console.error("Falha ao validar o login no Firebase:", mensagem);
    return { erroServidor: mensagem };
  } catch (e) {
    console.error("Falha ao validar o login:", e);
    return { erroServidor: String(e.message || e) };
  }
}

// Modelos do Gemini, na ordem de preferência. Se um deles não existir (404), estiver
// sem cota (429) ou sobrecarregado (5xx), tenta o próximo.
//
// O Google aposenta modelos de tempos em tempos (o gemini-2.5-flash-lite saiu do ar
// para chaves novas). Por isso, além desta lista, o servidor pergunta ao Google quais
// modelos "flash-lite" a chave pode usar (veja modelosParaTentar): os desta lista que
// ainda existem vêm primeiro, depois os outros "flash-lite", do mais novo para o mais
// antigo. Assim um modelo novo entra sozinho, sem precisar mudar o código.
const MODELOS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const MAXIMO_MODELOS_TENTADOS = 3;
const TEMPO_MAXIMO_MODELO_MS = 9000; // por modelo; a function pode rodar até 30 s (vercel.json)
const VALIDADE_LISTA_MODELOS_MS = 60 * 60 * 1000; // 1 hora

let cacheModelos = null; // {nomes: [...], em: instante} — lista de modelos da chave

// Só para os testes: esquece a lista de modelos guardada
export function limparCacheDeModelos() {
  cacheModelos = null;
}

// "gemini-3.5-flash-lite" -> 3.5 (para ordenar do mais novo para o mais antigo)
function versaoDoModelo(nome) {
  const m = nome.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

// Nomes dos modelos que a chave pode usar para gerar texto, ou null se a lista não veio
async function modelosDisponiveis(apiKey) {
  if (cacheModelos && Date.now() - cacheModelos.em < VALIDADE_LISTA_MODELOS_MS) return cacheModelos.nomes;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`,
      { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const dados = await r.json().catch(() => ({}));
    const nomes = (dados.models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
    if (!nomes.length) return null;
    cacheModelos = { nomes, em: Date.now() };
    return nomes;
  } catch (e) {
    console.warn("Não foi possível listar os modelos do Gemini:", e.message || e);
    return null;
  }
}

async function modelosParaTentar(apiKey) {
  const disponiveis = await modelosDisponiveis(apiKey);
  if (!disponiveis) return MODELOS; // sem a lista, tenta os preferidos mesmo assim
  const existentes = new Set(disponiveis);
  const outros = disponiveis
    .filter((m) => /^gemini-[\d.]+-flash-lite/.test(m) && !/(image|tts|audio|live)/.test(m) && !MODELOS.includes(m))
    // estáveis antes de "preview"/"exp"; dentro disso, o mais novo primeiro
    .sort((a, b) => (/preview|exp/.test(a) - /preview|exp/.test(b)) || versaoDoModelo(b) - versaoDoModelo(a));
  const lista = [...MODELOS.filter((m) => existentes.has(m)), ...outros].slice(0, MAXIMO_MODELOS_TENTADOS);
  return lista.length ? lista : MODELOS;
}

function siteDoPedido(req) {
  const origem = req.headers.origin;
  if (origem) return origem;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `https://${host}` : ORIGENS_PERMITIDAS[0];
}

// GET /api/gerar-frase?diagnostico=1 — confere a configuração sem gastar cota de
// geração e sem mostrar nenhum segredo: se a chave do Gemini existe e funciona,
// quais dos modelos usados estão disponíveis, e se a conferência de login funciona.
async function diagnostico(req, res) {
  const resultado = { chaveGeminiConfigurada: !!process.env.GEMINI_API_KEY };
  if (resultado.chaveGeminiConfigurada) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${process.env.GEMINI_API_KEY}`);
      const dados = await r.json().catch(() => ({}));
      resultado.chaveGeminiFunciona = r.ok;
      if (r.ok) {
        const existentes = new Set((dados.models || []).map((m) => m.name.replace(/^models\//, "")));
        resultado.modelos = Object.fromEntries(MODELOS.map((m) => [m, existentes.has(m)]));
        limparCacheDeModelos();
        resultado.modelosQueSeraoUsados = await modelosParaTentar(process.env.GEMINI_API_KEY);
      } else {
        resultado.erroGemini = dados?.error?.message || `HTTP ${r.status}`;
      }
    } catch (e) {
      resultado.chaveGeminiFunciona = false;
      resultado.erroGemini = String(e.message || e);
    }
  }
  // Um token de mentira: se a conferência estiver funcionando, o Firebase responde
  // "token inválido"; se a chave estiver bloqueada, aparece o erro de configuração.
  const login = await conferirLogin("token-de-diagnostico", siteDoPedido(req));
  resultado.conferenciaDeLoginFunciona = !login.erroServidor;
  if (login.erroServidor) resultado.erroLogin = login.erroServidor;
  return res.status(200).json(resultado);
}

const REGEX_TRADUCOES = /^TRADU[ÇC][ÕO]ES?\s*:\s*/i;

const TAMANHO_MAXIMO_CAMPO = 60; // caracteres — suficiente para qualquer palavra/expressão real

export default async function handler(req, res) {
  const origem = req.headers.origin;
  if (ORIGENS_PERMITIDAS.includes(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" && req.query && req.query.diagnostico !== undefined) {
    return diagnostico(req, res);
  }
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  // Só usuários logados no app podem gerar frases — sem isso, qualquer script
  // (que pode mandar o cabeçalho Origin que quiser) gastaria a cota da IA.
  const autorizacao = req.headers.authorization || "";
  const login = await conferirLogin(autorizacao.startsWith("Bearer ") ? autorizacao.slice(7) : "", siteDoPedido(req));
  if (login.erroServidor) {
    return res.status(500).json({ frases: [], aviso: "O servidor não conseguiu conferir o login (configuração da chave do Firebase)." });
  }
  if (login.invalido) {
    return res.status(401).json({ frases: [], aviso: "Faça login de novo para gerar frases." });
  }
  const uid = login.uid;
  if (excedeuLimite(uid)) {
    return res.status(429).json({ frases: [], aviso: "Muitos pedidos seguidos. Espere alguns minutos e tente de novo." });
  }

  const { palavra, traducao, idioma } = req.body || {};
  // Sem "idioma" (ou desconhecido) cai em inglês, o comportamento de antes
  const nomeIdioma = IDIOMAS[idioma] || IDIOMAS.en;
  if (!palavra || typeof palavra !== "string" || !palavra.trim()) {
    return res.status(400).json({ erro: "Informe a palavra." });
  }
  if (palavra.length > TAMANHO_MAXIMO_CAMPO || (traducao && String(traducao).length > TAMANHO_MAXIMO_CAMPO)) {
    return res.status(400).json({ erro: "Palavra ou tradução muito longa." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: "Chave da IA não configurada no servidor." });
  }

  try {
    // A primeira linha traz as traduções corretas da palavra: o app compara com a
    // tradução que o aluno digitou e avisa quando ela não bate (ex: "fees" = "juros").
    const prompt = `Você ajuda um aluno brasileiro a estudar ${nomeIdioma}. A palavra é "${palavra}"${traducao ? ` e o aluno anotou a tradução "${traducao}" (pode estar errada)` : ""}.
Responda APENAS com 6 linhas, sem numeração, sem aspas e sem explicações:
- Linha 1: TRADUÇÕES: até 3 traduções corretas e usuais da palavra em português, separadas por vírgula.
- Linhas 2 a 6: 5 frases curtas, simples e naturais em ${nomeIdioma} (nível iniciante/intermediário), cada uma usando a palavra exatamente como foi escrita, no sentido correto dela, no formato: frase em ${nomeIdioma} | tradução natural em português.`;

    // Tenta os modelos em ordem. Passa pro próximo se o modelo não existir (404),
    // estiver sem cota (429), sobrecarregado (5xx) ou responder vazio — modelos mais
    // novos "pensam" antes de responder e esse raciocínio também gasta o limite de
    // tokens da resposta, por isso o limite é folgado. Erros de chave (400/401/403)
    // valem para todos os modelos, então param na hora.
    // Guarda o motivo de cada modelo que falhou: só o último escondia por que os
    // anteriores não deram certo.
    let texto = "";
    const erros = [];
    for (const modelo of await modelosParaTentar(apiKey)) {
      let resposta;
      try {
        resposta = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 2048 }
            }),
            signal: AbortSignal.timeout(TEMPO_MAXIMO_MODELO_MS)
          }
        );
      } catch (e) {
        erros.push(`${modelo}: sem resposta (${e.name === "TimeoutError" ? "demorou demais" : e.message})`);
        console.warn("Gemini falhou, tentando o próximo modelo —", erros[erros.length - 1]);
        continue;
      }
      const dados = await resposta.json().catch(() => ({}));

      if (resposta.ok) {
        texto = (dados?.candidates?.[0]?.content?.parts || [])
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text).join("").trim();
        if (texto) break;
        erros.push(`${modelo}: resposta vazia (${dados?.candidates?.[0]?.finishReason || "sem motivo"})`);
      } else {
        erros.push(`${modelo}: ${dados?.error?.message || `HTTP ${resposta.status}`}`);
        if ([400, 401, 403].includes(resposta.status)) break;
      }
      console.warn("Gemini falhou, tentando o próximo modelo —", erros[erros.length - 1]);
    }

    if (!texto) {
      console.error("Nenhum modelo do Gemini gerou frases:", erros.join(" | "));
      return res.status(200).json({ frases: [], aviso: erros.join(" · ") || "IA não retornou frases desta vez." });
    }

    // Quebra a resposta em linhas: a linha "TRADUÇÕES:" vira a lista de traduções,
    // as demais são "frase | tradução"
    const linhas = texto
      .split("\n")
      .map((linha) => linha.replace(/\*\*/g, "").replace(/^[\s\-•\d.)]+/, "").trim())
      .filter((linha) => linha.length > 0);
    const linhaTraducoes = linhas.find((linha) => REGEX_TRADUCOES.test(linha));
    const traducoes = linhaTraducoes
      ? linhaTraducoes.replace(REGEX_TRADUCOES, "").split(/[,;]/).map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean).slice(0, 3)
      : [];
    const frases = linhas
      .filter((linha) => linha !== linhaTraducoes)
      .map((linha) => {
        const partes = linha.split("|");
        return {
          en: (partes[0] || "").replace(/^"|"$/g, "").trim(),
          pt: (partes[1] || "").replace(/^"|"$/g, "").trim()
        };
      })
      .filter((item) => item.en.length > 0)
      .slice(0, 5);

    return res.status(200).json({ frases, traducoes });
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: "Falha ao gerar frase de exemplo." });
  }
}
