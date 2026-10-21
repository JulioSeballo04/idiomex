// Testes do servidor da IA (api/gerar-frase.js), sem internet: o login do Firebase
// e o Gemini são simulados. Rodar com: npm run test:ia
import assert from "node:assert/strict";

process.env.GEMINI_API_KEY = "chave-de-teste";
let ultimoPrompt = "";
globalThis.fetch = async (url, opts) => {
  if (url.includes("accounts:lookup")) {
    const { idToken } = JSON.parse(opts.body);
    return idToken === "token-bom"
      ? { ok: true, json: async () => ({ users: [{ localId: "U1" }] }) }
      : { ok: false, json: async () => ({}) };
  }
  ultimoPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Hallo Welt | Olá mundo" }] } }] }) };
};

const { default: handler } = await import(new URL("../api/gerar-frase.js", import.meta.url));

async function chamar(headers, body) {
  const r = {};
  const res = { setHeader() {}, status(c) { r.c = c; return this; }, json(j) { r.j = j; return this; }, end() { return this; } };
  await handler({ method: "POST", headers, body }, res);
  return r;
}
const logado = { authorization: "Bearer token-bom" };
let ok = 0;
async function caso(nome, fn) { await fn(); ok++; console.log("  ✔", nome); }

await caso("recusa pedido sem login", async () => assert.equal((await chamar({}, { palavra: "Welt" })).c, 401));
await caso("recusa token inválido", async () => assert.equal((await chamar({ authorization: "Bearer ruim" }, { palavra: "Welt" })).c, 401));
await caso("recusa palavra vazia ou longa demais", async () => {
  assert.equal((await chamar(logado, { palavra: " " })).c, 400);
  assert.equal((await chamar(logado, { palavra: "x".repeat(61) })).c, 400);
});
await caso("gera frases e separa frase | tradução", async () => {
  const r = await chamar(logado, { palavra: "Welt", traducao: "mundo", idioma: "de" });
  assert.equal(r.c, 200);
  assert.deepEqual(r.j.frases, [{ en: "Hallo Welt", pt: "Olá mundo" }]);
});
for (const [codigo, nome] of [["de", "alemão"], ["ko", "coreano"], ["ja", "japonês"], ["es", "espanhol"]]) {
  await caso(`pede as frases em ${nome}`, async () => {
    await chamar(logado, { palavra: "x", idioma: codigo });
    assert.ok(ultimoPrompt.includes(`em ${nome}`), ultimoPrompt);
  });
}
await caso("limita pedidos seguidos do mesmo usuário (429)", async () => {
  const codigos = [];
  for (let i = 0; i < 35; i++) codigos.push((await chamar(logado, { palavra: "x" })).c);
  assert.ok(codigos.includes(429));
});
console.log(`\n${ok} passaram`);
