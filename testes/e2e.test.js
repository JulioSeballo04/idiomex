// Testes de ponta a ponta: simulam professor e alunos usando o app no navegador.
// Rodar com: npm run test:e2e (veja testes/README.md)
const h = require('./harness');
const fs = require('fs');
const path = require('path');
const { SITE, caso, esperar } = h;
const id = Date.now().toString(36);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function dataDaqui(dias) {
  const d = new Date(); d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  const servidor = await h.subirSite();
  const browser = await h.chromium.launch();
  const ctxP = await h.novoContexto(browser);
  const prof = await h.novaPagina(ctxP);
  const ctxA = await h.novoContexto(browser);
  const aluno = await h.novaPagina(ctxA);
  let codigo = '';

  console.log('\nCadastro e login');
  await caso('tela de login só tem "Entrar com Google" (sem e-mail, senha ou "Esqueci minha senha")', async () => {
    await prof.goto(`${SITE}/index.html`);
    esperar(await prof.isVisible('button:has-text("Entrar com Google")'), 'sem botão do Google');
    esperar(!(await prof.$('input[type=email]')) && !(await prof.$('input[type=password]')), 'ainda tem campo de e-mail ou senha');
    esperar(!(await prof.$('text=Esqueci minha senha')), 'ainda tem "Esqueci minha senha"');
  });

  await caso('cadastro não tem mais e-mail e senha (só Google)', async () => {
    await prof.goto(`${SITE}/index.html`);
    await prof.click('#btn-aba-cadastro');
    esperar(!(await prof.$('#cadEmail')) && !(await prof.$('#cadSenha')), 'ainda tem campos de e-mail/senha no cadastro');
    esperar(await prof.$('#form-cadastro button:has-text("Criar conta com Google")'), 'sem botão "Criar conta com Google"');
  });

  await caso('regras do Firestore desatualizadas: o cadastro explica o problema (não fala em "gerar código")', async () => {
    // Simula regras antigas, sem a parte de codigosProfessor, e depois devolve as atuais
    const atuais = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const antigas = atuais.replace(/match \/codigosProfessor\/\{codigo\} \{[\s\S]*?\n    \}\n/, '');
    esperar(antigas !== atuais, 'não consegui montar as regras antigas');
    const publicar = (conteudo) => fetch('http://127.0.0.1:8089/emulator/v1/projects/demo-idiomex:securityRules', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: conteudo }] } })
    });
    await publicar(antigas);
    try {
      const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
      await h.cadastrar(p, { tipo: 'professor', nome: 'Prof Velho', email: `velho-${id}@t.com` });
      await p.waitForFunction(() => /regras do Firestore/.test(document.getElementById('status-cadastro').textContent), null, { timeout: 10000 });
      await ctx.close();
    } finally {
      await publicar(atuais);
    }
  });

  await caso('professor se cadastra com Google; nome em branco usa o nome da conta Google', async () => {
    await h.cadastrar(prof, { tipo: 'professor', nome: '', nomeGoogle: 'Ana Google', email: `ana-${id}@t.com` });
    await prof.waitForURL('**/professor.html', { timeout: 10000 });
    await prof.waitForFunction(() => /^PROF-/.test(document.getElementById('codigo-professor').textContent), null, { timeout: 10000 });
    codigo = await prof.textContent('#codigo-professor');
    await prof.waitForFunction(() => document.getElementById('nome-usuario').textContent === 'Ana Google', null, { timeout: 5000 });
  });

  await caso('código inválido não deixa conta "presa": dá pra cadastrar de novo com o mesmo e-mail', async () => {
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', nomeGoogle: 'Beatriz Souza', email: `bia-${id}@t.com`, codigo: 'PROF-ZZZZ' });
    await aluno.waitForFunction(() => /inválido/i.test(document.getElementById('status-cadastro').textContent), null, { timeout: 8000 });
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', nomeGoogle: 'Beatriz Souza', email: `bia-${id}@t.com`, codigo });
    await aluno.waitForURL('**/dicionario.html', { timeout: 8000 }).catch(async () => {
      throw new Error('ficou na tela de cadastro: ' + await aluno.textContent('#status-cadastro'));
    });
  });
  if (!aluno.url().includes('dicionario')) {
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', nomeGoogle: 'Beatriz Souza', email: `bia2-${id}@t.com`, codigo });
    await aluno.waitForURL('**/dicionario.html', { timeout: 10000 });
  }

  await caso('quem já está logado e abre a tela inicial vai direto para o painel', async () => {
    await aluno.goto(`${SITE}/index.html`);
    await aluno.waitForURL('**/dicionario.html', { timeout: 8000 });
  });

  await caso('nome digitado no cadastro substitui o nome da conta Google', async () => {
    await aluno.waitForFunction(() => document.getElementById('titulo-topo').textContent === 'Bia', null, { timeout: 8000 });
  });

  await caso('"Entrar com Google" sem cadastro leva para completar o cadastro, com o nome do Google', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.usarContaGoogle(p, { email: `novo-${id}@t.com`, nome: 'Carla Nova' });
    await p.click('button:has-text("Entrar com Google")');
    await p.waitForSelector('#form-cadastro:not(.oculto)', { timeout: 8000 });
    esperar((await p.inputValue('#cadNome')) === 'Carla Nova', 'nome não veio do Google');
    esperar(/Falta pouco/.test(await p.textContent('#status-cadastro')), 'sem instrução para completar');
    await p.fill('#cadCodigo', codigo);
    await p.click('#form-cadastro button[type=submit]');
    await p.waitForURL('**/dicionario.html', { timeout: 10000 });
    await ctx.close();
  });

  await caso('conta nova de e-mail e senha criada por fora do app não consegue criar perfil', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await p.goto(`${SITE}/index.html`);
    // Cria a conta pelo Firebase (como um script faria) e tenta gravar o perfil direto
    // no servidor do banco, com o token dessa conta
    const { uid, token } = await p.evaluate(async () => {
      const cred = await auth.createUserWithEmailAndPassword('intruso@t.com', 'senha123');
      return { uid: cred.user.uid, token: await cred.user.getIdToken() };
    });
    const r = await fetch(`http://127.0.0.1:8089/v1/projects/demo-idiomex/databases/(default)/documents/usuarios/${uid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { nome: { stringValue: 'X' }, tipo: { stringValue: 'professor' } } })
    });
    esperar(r.status === 403, `perfil foi aceito (HTTP ${r.status})`);
    await ctx.close();
  });

  console.log('\nVocabulário do aluno');
  await aluno.waitForSelector('#input-palavra-en');
  await caso('adicionar palavra gera frases e manda o token de login para a IA', async () => {
    await aluno.fill('#input-palavra-en', 'apple'); await aluno.fill('#input-palavra-pt', 'maçã');
    await aluno.click('.formulario-palavra button[type=submit]');
    await aluno.click('.letra-tab:has-text("A")');
    await aluno.waitForSelector('.cartao-palavra .frase-exemplo:has-text("I like the apple")', { timeout: 8000 });
    esperar(ctxA.pedidosIA.length >= 1 && ctxA.pedidosIA[0].auth.startsWith('Bearer '), 'sem token');
  });

  await caso('palavra repetida avisa e NÃO apaga o que foi digitado', async () => {
    await aluno.fill('#input-palavra-en', 'Apple'); await aluno.fill('#input-palavra-pt', 'maçã de novo');
    await aluno.click('.formulario-palavra button[type=submit]');
    await aluno.waitForFunction(() => /já está/.test(document.getElementById('status-palavra').textContent), null, { timeout: 5000 });
    const v = await aluno.inputValue('#input-palavra-pt');
    esperar(v === 'maçã de novo', `campo ficou "${v}"`);
    await aluno.fill('#input-palavra-en', ''); await aluno.fill('#input-palavra-pt', '');
  });

  await caso('clique duplo em "Adicionar" não cria a palavra duas vezes', async () => {
    await aluno.fill('#input-palavra-en', 'banana'); await aluno.fill('#input-palavra-pt', 'banana');
    await aluno.dblclick('.formulario-palavra button[type=submit]');
    await dormir(2500);
    const n = await aluno.evaluate(() => cacheDePalavras.filter((p) => p.palavraEn.toLowerCase() === 'banana').length);
    esperar(n === 1, `${n} palavras "banana"`);
  });

  await caso('quando a IA falha, dá pra tentar gerar as frases de novo', async () => {
    const ctx = await h.novoContexto(browser, { iaFalha: true });
    const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Caio', email: `caio-${id}@t.com`, codigo });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 });
    await p.waitForSelector('#input-palavra-en');
    await p.fill('#input-palavra-en', 'cat'); await p.fill('#input-palavra-pt', 'gato');
    await p.click('.formulario-palavra button[type=submit]');
    await p.click('.letra-tab:has-text("C")');
    await p.waitForSelector('.frase-exemplo:has-text("Não foi possível")', { timeout: 8000 });
    const botao = await p.$('button:has-text("Tentar de novo")');
    esperar(botao, 'sem botão "Tentar de novo"');
    ctx.iaFalha = false;
    await botao.click();
    await p.waitForSelector('.frase-exemplo:has-text("I like the cat")', { timeout: 8000 });
    await ctx.close();
  });

  await caso('remover palavra pede confirmação', async () => {
    aluno.ultimoDialogo = null;
    await aluno.click('.letra-tab:has-text("B")');
    await aluno.click('.cartao-palavra .remover');
    await dormir(800);
    esperar(aluno.ultimoDialogo && /remover|excluir/i.test(aluno.ultimoDialogo), 'removeu sem perguntar');
  });

  await caso('anotação da palavra: salvar fecha o editor e mostra o texto', async () => {
    await aluno.click('.letra-tab:has-text("A")');
    await aluno.click('.btn-add-nota-palavra');
    await aluno.fill('textarea[id^="edicao-nota-"]', 'fruta vermelha');
    await aluno.click('.edicao-nota-palavra .btn-primario');
    await aluno.waitForSelector('.nota-palavra:has-text("fruta vermelha")', { timeout: 5000 });
    esperar(!(await aluno.$('textarea[id^="edicao-nota-"]')), 'editor continuou aberto');
  });

  await caso('tradução errada: a IA avisa e um clique corrige ("fees" ≠ "juros")', async () => {
    await aluno.fill('#input-palavra-en', 'fees'); await aluno.fill('#input-palavra-pt', 'Juros');
    await aluno.click('.formulario-palavra button[type=submit]');
    await aluno.click('.letra-tab:has-text("F")');
    await aluno.waitForSelector('.aviso-traducao:has-text("taxas, tarifas")', { timeout: 8000 });
    await aluno.click('.btn-usar-traducao:has-text("taxas")');
    await aluno.waitForFunction(() => /taxas/.test(document.querySelector('.cartao-palavra .palavra-pt').textContent), null, { timeout: 5000 });
    esperar(!(await aluno.$('.aviso-traducao')), 'aviso continuou depois de corrigir');
  });

  await caso('tradução certa não mostra aviso', async () => {
    await aluno.click('.letra-tab:has-text("A")');
    await aluno.waitForSelector('.cartao-palavra .frase-exemplo:has-text("apple")');
    esperar(!(await aluno.$('.aviso-traducao')), 'aviso apareceu para "apple = maçã"');
  });

  await caso('corrigir a tradução pelo ✎', async () => {
    aluno.respostaPrompt = 'maçã vermelha';
    await aluno.click('.cartao-palavra .btn-editar-traducao');
    await aluno.waitForSelector('.cartao-palavra .palavra-pt:has-text("maçã vermelha")', { timeout: 5000 });
    aluno.respostaPrompt = undefined;
  });

  await caso('palavra antiga (frases sem tradução) pode gerar frases já traduzidas', async () => {
    await aluno.evaluate(async () => {
      await db.collection('usuarios').doc(auth.currentUser.uid).collection('palavras').add({
        palavraEn: 'fear', traducaoPt: 'medo', idioma: 'en', criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        frasesExemplo: ['I have a fear of heights.', 'Do not let fear control you.'] });
    });
    await aluno.click('.letra-tab:has-text("F")');
    await aluno.click('button:has-text("Gerar frases com tradução")');
    await aluno.waitForSelector('.frase-exemplo:has-text("I like the fear")', { timeout: 8000 });
    esperar(await aluno.$('button:has-text("Ver tradução")'), 'frases novas sem tradução');
  });

  await caso('olho: "Ver tradução" mostra e "Ocultar tradução" esconde as traduções das frases', async () => {
    await aluno.click('.letra-tab:has-text("A")');
    const cartao = '.cartao-palavra:has(.palavra-en:has-text("apple"))';
    await aluno.waitForSelector(`${cartao}.traducoes-ocultas .btn-olho:has-text("Ver tradução")`, { timeout: 5000 });
    await aluno.click(`${cartao} .btn-olho`);
    await aluno.waitForSelector(`${cartao}:not(.traducoes-ocultas) .btn-olho.revelada:has-text("Ocultar tradução")`, { timeout: 3000 });
    esperar(await aluno.$eval(`${cartao} .frase-traducao`, (t) => t.getAttribute('aria-hidden') === 'false'), 'tradução continuou marcada como oculta');
    await aluno.click(`${cartao} .btn-olho`);
    await aluno.waitForSelector(`${cartao}.traducoes-ocultas .btn-olho:not(.revelada):has-text("Ver tradução")`, { timeout: 3000 });
  });

  await caso('quiz abre com 2 palavras e a frase tem a lacuna', async () => {
    await aluno.fill('#input-palavra-en', 'dog'); await aluno.fill('#input-palavra-pt', 'cachorro');
    await aluno.click('.formulario-palavra button[type=submit]');
    await aluno.waitForFunction(() => cacheDePalavras.filter((p) => p.frasesExemplo && p.frasesExemplo.length).length >= 2, null, { timeout: 8000 });
    await aluno.click('button:has-text("Quiz rápido")');
    const frase = await aluno.textContent('.quiz-frase');
    esperar(frase.includes('_____'), 'frase sem lacuna: ' + frase);
  });

  await caso('tecla Esc fecha a janela aberta', async () => {
    await aluno.keyboard.press('Escape');
    await dormir(300);
    esperar(await aluno.$eval('#modal-quiz', (m) => m.classList.contains('modal-oculto')), 'modal continuou aberto');
  });

  console.log('\nPainel do professor');
  await prof.reload();
  await prof.waitForFunction(() => /^PROF-/.test(document.getElementById('codigo-professor').textContent), null, { timeout: 10000 });
  await caso('texto de recado sendo digitado não some quando o aluno adiciona palavra', async () => {
    await prof.click('#btn-aba-alunos');
    await prof.click('.item-aluno:has-text("Bia")');
    await prof.click('.aba-detalhe:has-text("Recados")');
    const campo = 'textarea[id^="input-mensagem-"]';
    await prof.fill(campo, 'Revise os verbos');
    await aluno.fill('#input-palavra-en', 'egg'); await aluno.fill('#input-palavra-pt', 'ovo');
    await aluno.click('.formulario-palavra button[type=submit]');
    await dormir(3000);
    const v = await prof.inputValue(campo);
    esperar(v === 'Revise os verbos', `texto virou "${v}"`);
  });

  await caso('recado enviado limpa o campo e aparece para o aluno', async () => {
    await prof.click('button:has-text("Enviar recado")');
    await prof.waitForSelector('.acoes-msg .excluir', { timeout: 5000 });
    await dormir(500);
    esperar((await prof.inputValue('textarea[id^="input-mensagem-"]')) === '', 'campo não foi limpo');
    await aluno.click('.letra-tab[title="Início"]');
    await aluno.waitForSelector('#lista-mensagens .mensagem-item:has-text("Revise os verbos")', { timeout: 5000 });
  });

  await caso('excluir recado pede confirmação', async () => {
    prof.ultimoDialogo = null;
    await prof.click('.acoes-msg .excluir');
    await dormir(600);
    esperar(prof.ultimoDialogo, 'excluiu sem perguntar');
  });

  console.log('\nAgendamento');
  const dia = dataDaqui(3);
  await prof.evaluate(async (dia) => {
    await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').set({
      duracaoAulaMinutos: 50, modalidades: ['online'], whatsapp: '',
      disponibilidade: { seg: [{ inicio: '08:00', fim: '12:00' }] } });
    // Dia ajustado com períodos que se sobrepõem (manhã 09–12 e "tarde" 11–13)
    await db.collection('usuarios').doc(professorIdAtual).collection('agendaOverrides').doc(dia).set({
      fechado: false, modalidades: ['online'], blocos: [{ inicio: '09:00', fim: '12:00' }, { inicio: '10:40', fim: '13:00' }] });
  }, dia);

  async function horariosDoDia(p, dia) {
    await p.click('button:has-text("Agendar aula")');
    await p.waitForSelector('#modal-agendamento:not(.modal-oculto)', { timeout: 8000 });
    for (let i = 0; i < 3 && !(await p.$(`[data-calday="${dia}"]`)); i++) await p.click('#btn-cal-mes-proximo');
    await p.click(`[data-calday="${dia}"]`);
    await p.waitForFunction(() => !/Carregando/.test(document.getElementById('slots-agendamento').textContent), null, { timeout: 8000 });
    const hs = await p.$$eval('.btn-slot-horario', (bs) => bs.map((b) => b.textContent));
    await p.keyboard.press('Escape'); await p.evaluate(() => fecharAgendamento());
    return hs;
  }

  await caso('horários livres não aparecem repetidos quando os períodos se sobrepõem', async () => {
    await aluno.reload(); await aluno.waitForSelector('#input-palavra-en');
    const hs = await horariosDoDia(aluno, dia);
    esperar(hs.length > 0, 'nenhum horário');
    esperar(new Set(hs).size === hs.length, 'repetidos: ' + hs.join(' '));
  });

  await caso('depois de mudar a duração da aula, não oferece horário que bate com aula já marcada', async () => {
    await aluno.evaluate(async (dia) => {
      await agendarAula(professorIdDoAluno, dia, '09:00', '09:50', 'online', auth.currentUser.uid, 'Bia', false, 'en');
    }, dia);
    await prof.evaluate(async () => {
      await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').update({ duracaoAulaMinutos: 30 });
    });
    const hs = await horariosDoDia(aluno, dia);
    esperar(!hs.includes('09:30') && !hs.includes('09:00'), 'ofereceu horário em conflito: ' + hs.join(' '));
    esperar(hs.includes('10:00'), 'sumiu horário livre 10:00: ' + hs.join(' '));
  });

  await caso('aluno sem professor recebe aviso ao clicar em "Agendar aula"', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Duda', email: `duda-${id}@t.com`, codigo });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en');
    await p.evaluate(async () => { await db.collection('usuarios').doc(auth.currentUser.uid).update({ professorId: null }); });
    await p.reload(); await p.waitForSelector('#input-palavra-en'); await dormir(1500);
    p.ultimoDialogo = null;
    await p.click('button:has-text("Agendar aula")'); await dormir(1000);
    esperar(p.ultimoDialogo && /professor/i.test(p.ultimoDialogo), 'clique não fez nada');
    await ctx.close();
  });

  console.log('\nCelular (375 px)');
  for (const [nome, pg] of [['aluno', aluno], ['professor', prof]]) {
    await caso(`tela do ${nome} cabe na largura do celular, sem rolagem lateral`, async () => {
      await pg.setViewportSize({ width: 375, height: 800 });
      await pg.reload(); await dormir(2500);
      const { sw, cw } = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      esperar(sw <= cw + 1, `largura ${sw}px > ${cw}px`);
    });
  }

  console.log('\nConta');
  await caso('aluno com Google exclui a conta (sem pedir senha) e o cadastro some', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Edu', email: `edu-${id}@t.com`, codigo });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en'); await dormir(1000);
    await p.click('button:has-text("Meu perfil")');
    esperar(!(await p.$('input[type=password]')), 'pediu senha para excluir a conta');
    await p.click('button:has-text("Excluir minha conta")');
    await p.waitForURL('**/index.html', { timeout: 10000, waitUntil: 'commit' }).catch(() => {}); await p.waitForSelector('button:has-text("Entrar com Google")');
    await p.click('button:has-text("Entrar com Google")');
    await p.waitForSelector('#form-cadastro:not(.oculto)', { timeout: 8000 });
    esperar(!p.url().includes('dicionario'), 'entrou numa conta excluída');
    await ctx.close();
  });

  const erros = [...aluno.erros, ...prof.erros];
  await caso('nenhum erro de JavaScript nas páginas', async () => { esperar(erros.length === 0, erros.slice(0, 3).join(' | ')); });

  h.resumo();
  await browser.close();
  servidor.close();
  process.exit(h.falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
