// Testes do servidor da IA (api/gerar-frase.js), sem internet: o login do Firebase
// e o Gemini são simulados. Rodar com: npm run test:ia
import assert from "node:assert/strict";

process.env.GEMINI_API_KEY = "chave-de-teste";

// Comportamento simulado de cada serviço, ajustável por teste
const simulado = {
  chaveFirebaseBloqueada: false,   // chave web restrita e sem Referer aceito
  modelos: {},                     // modelo -> "ok" | "404" | "vazio" | "403"
  lista: null,                     // modelos que a chave enxerga (null = a lista padrão abaixo)
  listaFalha: false,               // a consulta da lista de modelos dá erro
  pedidosGemini: [],
  ultimoReferer: ""
};
const json = (status, corpo) => ({ ok: status < 300, status, json: async () => corpo });

globalThis.fetch = async (url, opts = {}) => {
  if (url.includes("accounts:lookup")) {
    simulado.ultimoReferer = (opts.headers || {}).Referer || "";
    if (simulado.chaveFirebaseBloqueada) {
      return json(403, { error: { message: "Requests from referer <empty> are blocked." } });
    }
    const { idToken } = JSON.parse(opts.body);
    return idToken === "token-bom"
      ? json(200, { users: [{ localId: "U1" }] })
      : json(400, { error: { message: "INVALID_ID_TOKEN" } });
  }
  if (url.includes("/models?")) {
    if (simulado.listaFalha) return json(500, { error: { message: "erro" } });
    const nomes = simulado.lista || ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview-tts"];
    return json(200, { models: nomes.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) });
  }
  const modelo = url.match(/models\/([^:]+):generateContent/)[1];
  const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
  simulado.pedidosGemini.push({ modelo, prompt });
  const modo = simulado.modelos[modelo] || "ok";
  if (modo === "404") return json(404, { error: { message: `models/${modelo} is not found` } });
  if (modo === "403") return json(403, { error: { message: "API key not valid" } });
  if (modo === "vazio") return json(200, { candidates: [{ content: { parts: [{ text: "pensando...", thought: true }] }, finishReason: "MAX_TOKENS" }] });
  return json(200, { candidates: [{ content: { parts: [{ text: "**TRADUÇÕES:** mundo, Terra\nHallo Welt | Olá mundo" }] } }] });
};

const { default: handler, limparCacheDeModelos } = await import(new URL("../api/gerar-frase.js", import.meta.url));

async function chamar(headers, body, method = "POST", query = {}) {
  const r = {};
  const res = { setHeader() {}, status(c) { r.c = c; return this; }, json(j) { r.j = j; return this; }, end() { return this; } };
  await handler({ method, headers: { origin: "https://idiomex.vercel.app", ...headers }, body, query }, res);
  return r;
}
const logado = { authorization: "Bearer token-bom" };
let ok = 0;
async function caso(nome, fn) {
  simulado.chaveFirebaseBloqueada = false; simulado.modelos = {}; simulado.pedidosGemini = [];
  simulado.lista = null; simulado.listaFalha = false; limparCacheDeModelos();
  await fn(); ok++; console.log("  ✔", nome);
}

await caso("recusa pedido sem login", async () => assert.equal((await chamar({}, { palavra: "Welt" })).c, 401));
await caso("recusa token inválido", async () => assert.equal((await chamar({ authorization: "Bearer ruim" }, { palavra: "Welt" })).c, 401));
await caso("manda o site no Referer ao conferir o login (chave web restrita)", async () => {
  await chamar(logado, { palavra: "Welt" });
  assert.equal(simulado.ultimoReferer, "https://idiomex.vercel.app/");
});
await caso("chave do Firebase bloqueada vira erro de servidor (500) com aviso claro", async () => {
  simulado.chaveFirebaseBloqueada = true;
  const r = await chamar(logado, { palavra: "Welt" });
  assert.equal(r.c, 500);
  assert.match(r.j.aviso, /conferir o login/);
});
await caso("recusa palavra vazia ou longa demais", async () => {
  assert.equal((await chamar(logado, { palavra: " " })).c, 400);
  assert.equal((await chamar(logado, { palavra: "x".repeat(61) })).c, 400);
});
await caso("gera frases e separa frase | tradução", async () => {
  const r = await chamar(logado, { palavra: "Welt", traducao: "mundo", idioma: "de" });
  assert.equal(r.c, 200);
  assert.deepEqual(r.j.frases, [{ en: "Hallo Welt", pt: "Olá mundo" }]);
});
await caso("devolve as traduções corretas da palavra (linha TRADUÇÕES)", async () => {
  const r = await chamar(logado, { palavra: "Welt", traducao: "juros", idioma: "de" });
  assert.deepEqual(r.j.traducoes, ["mundo", "Terra"]);
  assert.ok(simulado.pedidosGemini[0].prompt.includes('anotou a tradução "juros" (pode estar errada)'));
});
await caso("modelo inexistente (404) passa para o próximo", async () => {
  simulado.modelos = { "gemini-3.5-flash-lite": "404" };
  const r = await chamar(logado, { palavra: "Welt" });
  assert.equal(r.j.frases.length, 1);
  assert.deepEqual(simulado.pedidosGemini.map((p) => p.modelo), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
});
await caso("resposta vazia (só raciocínio) passa para o próximo modelo", async () => {
  simulado.lista = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.0-flash-lite"];
  simulado.modelos = { "gemini-3.5-flash-lite": "vazio", "gemini-3.1-flash-lite": "vazio" };
  const r = await chamar(logado, { palavra: "Welt" });
  assert.equal(r.j.frases.length, 1);
  assert.equal(simulado.pedidosGemini.length, 3);
});
await caso("chave do Gemini inválida para na hora e devolve o motivo", async () => {
  simulado.modelos = { "gemini-3.5-flash-lite": "403" };
  const r = await chamar(logado, { palavra: "Welt" });
  assert.deepEqual(r.j.frases, []);
  assert.match(r.j.aviso, /API key not valid/);
  assert.equal(simulado.pedidosGemini.length, 1);
});
await caso("só tenta modelos que a chave enxerga (um modelo aposentado não é tentado)", async () => {
  simulado.lista = ["gemini-3.1-flash-lite", "gemini-2.0-flash"];
  await chamar(logado, { palavra: "Welt" });
  assert.deepEqual(simulado.pedidosGemini.map((p) => p.modelo), ["gemini-3.1-flash-lite"]);
});
await caso("modelo flash-lite novo, fora da lista, entra sozinho (mais novo primeiro, sem tts)", async () => {
  simulado.lista = ["gemini-4.0-flash-lite-preview", "gemini-4.0-flash-lite", "gemini-3.1-flash-lite", "gemini-4.0-flash-lite-preview-tts"];
  simulado.modelos = { "gemini-3.1-flash-lite": "404" };
  await chamar(logado, { palavra: "Welt" });
  assert.deepEqual(simulado.pedidosGemini.map((p) => p.modelo), ["gemini-3.1-flash-lite", "gemini-4.0-flash-lite"]);
});
await caso("sem a lista de modelos, tenta os preferidos mesmo assim", async () => {
  simulado.listaFalha = true;
  simulado.modelos = { "gemini-3.5-flash-lite": "404" };
  const r = await chamar(logado, { palavra: "Welt" });
  assert.equal(r.j.frases.length, 1);
  assert.deepEqual(simulado.pedidosGemini.map((p) => p.modelo), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
});
await caso("quando todos falham, o aviso traz o motivo de cada modelo", async () => {
  simulado.modelos = { "gemini-3.5-flash-lite": "404", "gemini-3.1-flash-lite": "vazio" };
  const r = await chamar(logado, { palavra: "Welt" });
  assert.deepEqual(r.j.frases, []);
  assert.match(r.j.aviso, /gemini-3\.5-flash-lite: models\/gemini-3\.5-flash-lite is not found/);
  assert.match(r.j.aviso, /gemini-3\.1-flash-lite: resposta vazia/);
});
for (const [codigo, nome] of [["de", "alemão"], ["ko", "coreano"], ["ja", "japonês"], ["es", "espanhol"]]) {
  await caso(`pede as frases em ${nome}`, async () => {
    await chamar(logado, { palavra: "x", idioma: codigo });
    assert.ok(simulado.pedidosGemini[0].prompt.includes(`em ${nome}`));
  });
}
await caso("diagnóstico mostra a configuração sem expor segredos", async () => {
  const r = await chamar({}, undefined, "GET", { diagnostico: "1" });
  assert.equal(r.c, 200);
  assert.equal(r.j.chaveGeminiConfigurada, true);
  assert.equal(r.j.chaveGeminiFunciona, true);
  assert.deepEqual(r.j.modelos, { "gemini-3.5-flash-lite": true, "gemini-3.1-flash-lite": true });
  assert.deepEqual(r.j.modelosQueSeraoUsados, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.equal(r.j.conferenciaDeLoginFunciona, true);
  assert.ok(!JSON.stringify(r.j).includes("chave-de-teste"));
});
await caso("limita pedidos seguidos do mesmo usuário (429)", async () => {
  const codigos = [];
  for (let i = 0; i < 35; i++) codigos.push((await chamar(logado, { palavra: "x" })).c);
  assert.ok(codigos.includes(429));
});
console.log(`\n${ok} passaram`);
