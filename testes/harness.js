// Ambiente dos testes de ponta a ponta: o site servido localmente, o Firebase
// emulado (login e banco, com as regras de verdade) e a IA simulada.
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const PORTA = 8765;
const SITE = `http://localhost:${PORTA}`;
// Mesma versão do Firebase que as páginas carregam do CDN (instalada como "firebase-site")
// Traduções "corretas" que a IA simulada devolve (as demais palavras: a do aluno)
const TRADUCOES_SIMULADAS = { fees: ['taxas', 'tarifas'] };

// A janela real do Google precisa de apis.google.com. Nos testes, "entrar com Google"
// usa uma credencial Google simulada, que o emulador do Firebase aceita: a conta
// escolhida vem de sessionStorage (veja usarContaGoogle) e o login fica registrado
// como Google de verdade (provedor google.com), inclusive para as regras do banco.
const GOOGLE_SIMULADO = `
function __credencialGoogleTeste() {
  const c = JSON.parse(sessionStorage.getItem("__contaGoogle") || "null");
  if (!c) { const e = new Error("sem conta Google simulada"); e.code = "auth/popup-closed-by-user"; throw e; }
  return firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: c.sub, email: c.email, email_verified: true, name: c.nome }));
}
auth.signInWithPopup = async () => auth.signInWithCredential(__credencialGoogleTeste());
auth.onAuthStateChanged((u) => { if (u) u.reauthenticateWithPopup = async () => u.reauthenticateWithCredential(__credencialGoogleTeste()); });
`;

const FB = path.join(__dirname, 'node_modules/firebase-site');

// Servidor de arquivos estáticos do site (sem dependências)
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function subirSite() {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      const caminho = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
      const arquivo = path.join(RAIZ, caminho || 'index.html');
      if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
      fs.createReadStream(arquivo).pipe(res);
    });
    servidor.listen(PORTA, () => resolve(servidor));
  });
}

async function novoContexto(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 } });
  await ctx.route('https://www.gstatic.com/firebasejs/9.23.0/*', (r) => {
    const nome = r.request().url().split('/').pop();
    r.fulfill({ path: path.join(FB, nome), contentType: 'application/javascript' });
  });
  await ctx.route('**/js/firebase-config.js', (r) => {
    let src = fs.readFileSync(path.join(RAIZ, 'js/firebase-config.js'), 'utf8')
      .replace(/projectId: "[^"]+"/, 'projectId: "demo-idiomex"')
      .replace(/const AI_ENDPOINT = [^;]+;/, `const AI_ENDPOINT = "${SITE}/api/gerar-frase";`);
    src += '\nauth.useEmulator("http://127.0.0.1:9099");\ndb.useEmulator("127.0.0.1", 8089);\n' + GOOGLE_SIMULADO;
    r.fulfill({ body: src, contentType: 'application/javascript' });
  });
  ctx.pedidosIA = [];
  ctx.iaFalha = !!opts.iaFalha;
  await ctx.route('**/api/gerar-frase', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200 });
    const corpo = JSON.parse(req.postData() || '{}');
    ctx.pedidosIA.push({ auth: req.headers()['authorization'] || '', corpo });
    if (ctx.iaFalha) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ frases: [], aviso: 'falhou' }) });
    const p = corpo.palavra;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ frases: [
      { en: `I like the ${p} a lot.`, pt: 'Eu gosto muito.' }, { en: `This ${p} is new.`, pt: 'Isso é novo.' }],
      traducoes: (TRADUCOES_SIMULADAS[p.toLowerCase()] || [corpo.traducao]) }) });
  });
  // Links do WhatsApp abrem numa aba nova: responde ali mesmo, sem sair para a internet
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'WhatsApp' }));
  // Não deixa o service worker interferir nos testes
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.resolve() } }); } catch (e) {} });
  return ctx;
}

async function novaPagina(ctx) {
  const p = await ctx.newPage();
  p.erros = [];
  p.on('pageerror', (e) => p.erros.push(e.message));
  p.on('dialog', (d) => { p.ultimoDialogo = d.message(); d.type() === 'prompt' && p.respostaPrompt !== undefined ? d.accept(p.respostaPrompt) : d.accept(); });
  return p;
}

// Escolhe a conta Google que a "janela do Google" simulada vai devolver nessa aba
async function usarContaGoogle(p, { email, nome }) {
  if (!p.url().startsWith(SITE)) await p.goto(`${SITE}/index.html`);
  await p.evaluate((c) => sessionStorage.setItem('__contaGoogle', JSON.stringify(c)),
    { sub: 'g-' + email.replace(/[^a-z0-9]/gi, ''), email, nome });
}

// Cadastro pela tela "Criar conta" (com Google). "nome" é o que a pessoa digita no
// formulário (pode ficar em branco); "nomeGoogle" é o nome da conta Google.
async function cadastrar(p, { tipo, nome = '', nomeGoogle = 'Conta Google', email, codigo = '' }) {
  await p.goto(`${SITE}/index.html`);
  await usarContaGoogle(p, { email, nome: nomeGoogle });
  await p.click('#btn-aba-cadastro');
  await p.selectOption('#cadTipo', tipo);
  await p.fill('#cadNome', nome);
  if (tipo === 'aluno') await p.fill('#cadCodigo', codigo);
  await p.click('#form-cadastro button[type=submit]');
}

let ok = 0, falhas = [];
async function caso(nome, fn) {
  try { await fn(); ok++; console.log('  ✔', nome); }
  catch (e) { falhas.push(nome); console.log('  ✘', nome, '—', e.message.split('\n')[0]); }
}
function esperar(cond, msg) { if (!cond) throw new Error(msg); }
function resumo() { console.log(`\n${ok} passaram, ${falhas.length} falharam`); if (falhas.length) console.log('Falhas:\n - ' + falhas.join('\n - ')); }

module.exports = { chromium, SITE, subirSite, usarContaGoogle, novoContexto, novaPagina, cadastrar, caso, esperar, resumo, falhas };
