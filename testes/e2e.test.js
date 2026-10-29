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

  console.log('\nSala de aula');
  await caso('professor deixa link e documento; aluno anota e o professor lê a anotação', async () => {
    await prof.click('.aba-detalhe:has-text("Sala de aula")');
    await prof.fill('input[id^="input-link-aula-"]', 'meet.google.com/abc-defg-hij');
    await prof.click('button:has-text("Salvar link")');
    await prof.waitForSelector('.acoes-link-aula a[href="https://meet.google.com/abc-defg-hij"]', { timeout: 5000 });
    await prof.fill('input[id^="input-titulo-documento-"]', 'Lesson 1');
    await prof.fill('input[id^="input-url-documento-"]', 'https://drive.google.com/file/d/abc');
    await prof.click('button:has-text("Adicionar documento")');
    await prof.waitForSelector('.documento-aula:has-text("Lesson 1")', { timeout: 5000 });

    await aluno.click('#btn-sala-aula');
    await aluno.waitForSelector('#corpo-sala-aula a[href="https://meet.google.com/abc-defg-hij"]', { timeout: 5000 });
    await aluno.click('#corpo-sala-aula .btn-notas-documento');
    await aluno.fill('textarea[id^="nota-documento-"]', 'Past simple: verbo + ed');
    await aluno.click('button:has-text("Salvar anotações")');
    await aluno.waitForFunction(() => /salvas/.test((document.querySelector('[id^="status-nota-documento-"]') || {}).textContent), null, { timeout: 5000 });
    await aluno.click('#modal-sala-aula .btn-fechar-modal');

    await prof.click('.documento-aula .btn-notas-documento');
    await prof.waitForSelector('.bloco-notas-documento:has-text("Past simple: verbo + ed")', { timeout: 5000 });
  });

  await caso('professor envia um arquivo; o aluno vê e baixa o mesmo conteúdo', async () => {
    const conteudo = 'Lesson 2 — Past simple\n'.repeat(60000); // ~1,4 MB: vai em 2 pedaços
    await prof.setInputFiles('input[id^="input-arquivo-documento-"]', { name: 'lesson2.txt', mimeType: 'text/plain', buffer: Buffer.from(conteudo) });
    await prof.waitForSelector('.arquivo-escolhido:has-text("lesson2.txt")', { timeout: 3000 });
    esperar((await prof.inputValue('input[id^="input-titulo-documento-"]')) === 'lesson2', 'título não veio do nome do arquivo');
    await prof.click('button:has-text("Adicionar documento")');
    await prof.waitForSelector('.documento-aula:has-text("lesson2.txt")', { timeout: 15000 });
    await aluno.waitForFunction(() => documentosAulaCache.some((d) => d.nomeArquivo === 'lesson2.txt'), null, { timeout: 5000 });
    const baixado = await aluno.evaluate(async () => {
      const d = documentosAulaCache.find((x) => x.nomeArquivo === 'lesson2.txt');
      return { partes: d.partes, texto: await (await baixarArquivoDaAula(auth.currentUser.uid, d)).text() };
    });
    esperar(baixado.partes === 2, `partes: ${baixado.partes}`);
    esperar(baixado.texto === conteudo, 'conteúdo baixado é diferente do enviado');
  });

  await caso('arquivo acima de 10 MB é recusado com explicação', async () => {
    prof.ultimoDialogo = null;
    await prof.setInputFiles('input[id^="input-arquivo-documento-"]', { name: 'grande.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024) });
    await dormir(500);
    esperar(prof.ultimoDialogo && /10 MB/.test(prof.ultimoDialogo), 'aceitou arquivo grande');
    esperar(!(await prof.$('.arquivo-escolhido')), 'arquivo grande ficou escolhido');
  });

  await caso('link que não é http(s) é recusado', async () => {
    prof.ultimoDialogo = null;
    await prof.fill('input[id^="input-link-aula-"]', 'javascript:alert(1)');
    await prof.click('button:has-text("Salvar link")');
    await dormir(500);
    esperar(prof.ultimoDialogo && /link válido/.test(prof.ultimoDialogo), 'aceitou link javascript:');
  });

  console.log('\nAgendamento');
  const dia = dataDaqui(3);
  const chaveMes = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  await prof.evaluate(async ({ dia, proximoMes }) => {
    await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').set({
      duracaoAulaMinutos: 50, modalidades: ['online'], whatsapp: '', mesesLiberados: [proximoMes],
      disponibilidade: { seg: [{ inicio: '08:00', fim: '12:00' }] } });
    // Dia ajustado com períodos que se sobrepõem (manhã 09–12 e "tarde" 11–13)
    await db.collection('usuarios').doc(professorIdAtual).collection('agendaOverrides').doc(dia).set({
      fechado: false, modalidades: ['online'], blocos: [{ inicio: '09:00', fim: '12:00' }, { inicio: '10:40', fim: '13:00' }] });
  }, { dia, proximoMes: chaveMes(1) });

  async function horariosDoDia(p, dia) {
    await p.click('button:has-text("Agendar aula")');
    await p.waitForSelector('#modal-agendamento:not(.modal-oculto)', { timeout: 8000 });
    for (let i = 0; i < 3 && !(await p.$(`[data-calday="${dia}"]`)); i++) await p.click('#btn-cal-mes-proximo');
    await p.click(`[data-calday="${dia}"]`);
    await p.waitForFunction(() => !/Carregando/.test(document.getElementById('slots-agendamento').textContent), null, { timeout: 8000 });
    // Cada botão mostra a faixa "10:00 – 10:30"; aqui interessa o horário de início
    const hs = await p.$$eval('.btn-slot-horario', (bs) => bs.map((b) => b.textContent.split(' – ')[0].trim()));
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

  // Aluna nova só para o fluxo de agendamento (a Bia já tem aula marcada)
  const ctxGabi = await h.novoContexto(browser); const gabi = await h.novaPagina(ctxGabi);
  await h.cadastrar(gabi, { tipo: 'aluno', nome: 'Gabi', email: `gabi-${id}@t.com`, codigo });
  await gabi.waitForURL('**/dicionario.html', { timeout: 10000 }); await gabi.waitForSelector('#input-palavra-en'); await dormir(1500);

  async function abrirAgendamentoNoDia(p, dia) {
    await p.click('button:has-text("Agendar aula")');
    await p.waitForSelector('#modal-agendamento:not(.modal-oculto) .passos-agendamento', { timeout: 8000 });
    for (let i = 0; i < 3 && !(await p.$(`[data-calday="${dia}"]`)); i++) await p.click('#btn-cal-mes-proximo');
    await p.click(`[data-calday="${dia}"]`);
    await p.waitForSelector('.btn-slot-horario', { timeout: 8000 });
  }

  await caso('agendar pelo passo a passo: escolher o horário não marca; só "Confirmar agendamento" marca', async () => {
    await abrirAgendamentoNoDia(gabi, dia);
    esperar(await gabi.isDisabled('#btn-confirmar-agendamento'), 'dava pra confirmar sem escolher horário');
    await gabi.click('.btn-slot-horario:has-text("10:00")');
    await gabi.waitForSelector('.resumo-passo:has-text("às 10:00")', { timeout: 3000 });
    await dormir(800);
    esperar((await gabi.evaluate(() => aulasFuturasDoAluno().length)) === 0, 'marcou a aula só de escolher o horário');
    await gabi.click('#btn-confirmar-agendamento');
    await gabi.waitForSelector('.agendamento-sucesso:has-text("Aula confirmada")', { timeout: 8000 });
    await gabi.waitForFunction(() => aulasFuturasDoAluno().length === 1, null, { timeout: 5000 });
    await gabi.click('.acoes-sucesso button:has-text("Fechar")');
    await gabi.waitForSelector('#painel-minhas-aulas:not(.oculto) .cartao-aula:has-text("10:00")', { timeout: 5000 });
  });

  await caso('"trocar" volta para escolher outro dia e horário', async () => {
    await abrirAgendamentoNoDia(gabi, dia);
    await gabi.click('.btn-slot-horario >> nth=0');
    await gabi.click('.resumo-passo .link-trocar');
    await gabi.waitForSelector('#calendario-agendamento .cal-grid', { timeout: 3000 });
    esperar(!(await gabi.$('.resumo-passo')), 'resumo continuou');
    await gabi.keyboard.press('Escape');
  });

  await caso('mês que o professor não liberou fica bloqueado; depois de liberar, abre', async () => {
    const mesBloqueado = chaveMes(2);
    await gabi.click('button:has-text("Agendar aula")');
    await gabi.waitForSelector('#modal-agendamento:not(.modal-oculto) .cal-grid', { timeout: 8000 });
    await gabi.click('#btn-cal-mes-proximo'); await gabi.click('#btn-cal-mes-proximo');
    await gabi.waitForSelector('.aviso-mes-bloqueado', { timeout: 3000 });
    esperar(!(await gabi.$('[data-calday]')), 'mês bloqueado tem dia clicável');
    await gabi.keyboard.press('Escape');
    // Professor libera o mês pelas configurações da agenda
    await prof.click('#btn-aba-agenda');
    await prof.click('button:has-text("Configurar disponibilidade")');
    await prof.check(`.chk-mes-liberado[value="${mesBloqueado}"]`);
    await prof.click('#modal-config-agenda button:has-text("Salvar disponibilidade")');
    await prof.waitForSelector('#modal-config-agenda.modal-oculto', { state: 'attached', timeout: 5000 });
    await gabi.click('button:has-text("Agendar aula")');
    await gabi.waitForSelector('#modal-agendamento:not(.modal-oculto) .cal-grid', { timeout: 8000 });
    await gabi.click('#btn-cal-mes-proximo'); await gabi.click('#btn-cal-mes-proximo');
    await gabi.waitForSelector('[data-calday]', { timeout: 3000 });
    esperar(!(await gabi.$('.aviso-mes-bloqueado')), 'continuou bloqueado depois de liberar');
    await gabi.keyboard.press('Escape');
  });

  await caso('aluno com 3 aulas futuras não consegue marcar a quarta', async () => {
    await gabi.evaluate(async (dia) => {
      for (const h of ['12:00', '12:30']) {
        await agendarAula(professorIdDoAluno, dia, h, somarMinutos(h, 30), 'online', auth.currentUser.uid, 'Gabi', false, 'en');
      }
    }, dia);
    await gabi.waitForFunction(() => aulasFuturasDoAluno().length === 3, null, { timeout: 5000 });
    await abrirAgendamentoNoDia(gabi, dia);
    await gabi.click('.btn-slot-horario >> nth=0');
    await gabi.click('#btn-confirmar-agendamento');
    await gabi.waitForSelector('.erro-agendamento:has-text("3 aulas")', { timeout: 3000 });
    esperar((await gabi.evaluate(() => aulasFuturasDoAluno().length)) === 3, 'marcou a quarta aula');
    await gabi.keyboard.press('Escape');
  });

  await caso('professor vê a próxima aula em destaque e as aulas agrupadas por dia', async () => {
    await prof.click('#btn-aba-agenda');
    await prof.waitForSelector('.cartao-proxima-aula:has-text("Próxima aula")', { timeout: 8000 });
    await prof.waitForSelector('.cartao-proximas-aulas .cartao-aula:has-text("Gabi")', { timeout: 8000 });
    esperar((await prof.$$('.cartao-proximas-aulas .titulo-grupo-dia')).length >= 1, 'sem agrupamento por dia');
  });

  const pendente = '#confirmar-aulas .cartao-aula:has-text("00:00")';
  await caso('aula que já passou pede confirmação ("Foi realizada"); Desfazer volta a pedir', async () => {
    await aluno.evaluate(async () => {
      const hoje = dataDeHojeISO();
      await agendarAula(professorIdDoAluno, hoje, '00:00', '00:30', 'online', auth.currentUser.uid, 'Bia', false, 'en');
    });
    await prof.waitForSelector(pendente, { timeout: 8000 });
    await prof.click(`${pendente} button:has-text("Foi realizada")`);
    const concluida = '.cartao-proximas-aulas .aula-concluida:has-text("00:00")';
    await prof.waitForSelector(concluida, { timeout: 5000 });
    await prof.click(`${concluida} button:has-text("Desfazer")`);
    await prof.waitForSelector(pendente, { timeout: 5000 });
  });

  await caso('"Não foi realizada" dá 1 reposição ao aluno e avisa no sino', async () => {
    const saldo = () => prof.evaluate(() => { const a = aulasCache.find((x) => x.horaInicio === '00:00' && x.data === dataDeHojeISO()); return creditosDoAluno(a.alunoId, idiomaValido(a.idioma)).saldo; });
    const antes = await saldo();
    prof.ultimoDialogo = null;
    await prof.click(`${pendente} button:has-text("Não foi realizada")`);
    await prof.waitForSelector(pendente, { state: 'detached', timeout: 5000 });
    esperar(prof.ultimoDialogo && /reposição/.test(prof.ultimoDialogo), 'não pediu confirmação');
    await dormir(800);
    esperar((await saldo()) === antes + 1, `saldo não aumentou (${antes} -> ${await saldo()})`);
    await aluno.waitForFunction(() => notificacoesCache.some((n) => n.tipo === 'aula-nao-realizada'), null, { timeout: 5000 });
  });
  await ctxGabi.close();

  console.log('\nAlunos sem app (aulas marcadas pelo professor)');
  await caso('aluno sem app gera lembrete até o professor marcar a aula', async () => {
    await prof.click('#btn-aba-alunos');
    await prof.fill('#input-nome-sem-app', 'Seu Zé');
    await prof.fill('#input-telefone-sem-app', '11 98888-7777');
    await prof.click('.secao-alunos-sem-app button:has-text("Adicionar aluno")');
    await prof.waitForSelector('.cartao-aluno-sem-app:has-text("Seu Zé"):has-text("Nenhuma aula marcada")', { timeout: 5000 });
    await prof.click('#btn-aba-agenda');
    const lembrete = '#lembretes-sem-app .cartao-aula:has-text("Seu Zé")';
    await prof.waitForSelector(lembrete, { timeout: 5000 });
    await prof.click(`${lembrete} button:has-text("Marcar aula")`);
    esperar((await prof.$eval('#marcar-aluno', (e) => e.options[e.selectedIndex].text)) === 'Seu Zé', 'aluno não veio escolhido');
    await prof.fill('#marcar-data', dataDaqui(5));
    await prof.click('#btn-outro-horario');
    await prof.fill('#marcar-hora', '15:00');
    await prof.click('#modal-marcar-aula button:has-text("Marcar aula")');
    await prof.waitForSelector('#modal-marcar-aula.modal-oculto', { state: 'attached', timeout: 5000 });
    await prof.waitForSelector(lembrete, { state: 'detached', timeout: 5000 });
    const aula = await prof.evaluate(() => aulasCache.find((a) => a.alunoNome === 'Seu Zé'));
    esperar(aula && aula.status === 'agendada' && aula.horaInicio === '15:00', 'aula não foi criada');
  });

  await caso('professor não marca aula por cima de outra', async () => {
    await prof.evaluate(() => abrirMarcarAula(alunosSemAppCache[0].id));
    await prof.fill('#marcar-data', dataDaqui(5));
    await prof.click('#btn-outro-horario');
    await prof.fill('#marcar-hora', '15:20');
    await prof.click('#modal-marcar-aula button:has-text("Marcar aula")');
    await prof.waitForFunction(() => /bate com a aula/.test(document.getElementById('status-marcar-aula').textContent), null, { timeout: 3000 });
    await prof.click('#modal-marcar-aula .btn-fechar-modal');
  });

  await caso('professor marca pelos horários livres, iguais aos do aluno (em faixa "início – fim")', async () => {
    await prof.evaluate(() => abrirMarcarAula(alunosSemAppCache[0].id));
    // Um dia de atendimento mais adiante, longe dos dias usados pelos outros testes
    const diaLivre = await prof.evaluate(() => {
      for (let i = 20; i < 60; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const iso = chaveDataISO(d);
        if (horariosLivresDoDia(iso).length) return iso;
      }
    });
    esperar(diaLivre, 'nenhum dia de atendimento nos próximos 2 meses');
    await prof.fill('#marcar-data', diaLivre);
    await prof.dispatchEvent('#marcar-data', 'change');
    const esperados = await prof.evaluate((d) => horariosLivresDoDia(d), diaLivre);
    esperar(esperados.length > 0, 'nenhum horário livre no dia de teste');
    await prof.waitForSelector('#marcar-slots .btn-slot-horario', { timeout: 3000 });
    const botoes = await prof.$$eval('#marcar-slots .btn-slot-horario', (bs) => bs.map((b) => b.textContent.trim()));
    esperar(botoes.length === esperados.length && / – /.test(botoes[0]), 'horários: ' + botoes.join(', '));
    await prof.click('#marcar-slots .btn-slot-horario >> nth=0');
    await prof.click('#modal-marcar-aula button:has-text("Marcar aula")');
    await prof.waitForSelector('#modal-marcar-aula.modal-oculto', { state: 'attached', timeout: 5000 });
    const criada = await prof.evaluate(({ d, h }) => aulasCache.find((a) => a.alunoNome === 'Seu Zé' && a.data === d && a.horaInicio === h), { d: diaLivre, h: esperados[0] });
    esperar(criada && criada.horaFim, 'aula não foi criada no horário escolhido');
  });

  await caso('aluno sem WhatsApp também pode ser cadastrado (e o formulário não oferece WhatsApp para ele)', async () => {
    await prof.click('#btn-aba-alunos');
    await prof.fill('#input-nome-sem-app', 'Dona Rosa');
    await prof.fill('#input-telefone-sem-app', '');
    await prof.click('.secao-alunos-sem-app button:has-text("Adicionar aluno")');
    await prof.waitForSelector('.cartao-aluno-sem-app:has-text("Dona Rosa")', { timeout: 5000 });
    const rosa = await prof.evaluate(() => alunosSemAppCache.find((a) => a.nome === 'Dona Rosa'));
    esperar(rosa && rosa.telefone === '', 'cadastro sem telefone não foi gravado');
    await prof.evaluate((id) => abrirMarcarAula(id), rosa.id);
    esperar(await prof.isHidden('#marcar-whatsapp-wrap'), 'ofereceu WhatsApp para aluno sem telefone');
    await prof.evaluate(() => abrirMarcarAula(alunosSemAppCache.find((a) => a.nome === 'Seu Zé').id));
    esperar(await prof.isVisible('#marcar-whatsapp-wrap') && await prof.isChecked('#marcar-whatsapp'), 'não ofereceu WhatsApp para aluno com telefone');
    await prof.click('#modal-marcar-aula .btn-fechar-modal');
    // Remove de novo: sem aula marcada, ela somaria um lembrete aos contadores dos próximos testes
    await prof.evaluate((id) => removerAlunoSemApp(id), rosa.id);
    await prof.waitForSelector('.cartao-aluno-sem-app:has-text("Dona Rosa")', { state: 'detached', timeout: 5000 });
  });

  await caso('professor registra uma aula que já aconteceu (horário que já passou): entra como realizada', async () => {
    const ze = await prof.evaluate(() => alunosSemAppCache.find((a) => a.nome === 'Seu Zé').id);
    await prof.evaluate((id) => abrirMarcarAula(id), ze);
    // Um dia de atendimento que já passou: os horários aparecem (antes sumiam)
    const diaPassado = await prof.evaluate(() => {
      for (let i = 1; i < 15; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const iso = chaveDataISO(d);
        if (horariosLivresDoDia(iso).length) return iso;
      }
    });
    esperar(diaPassado, 'nenhum dia de atendimento nas últimas 2 semanas');
    await prof.fill('#marcar-data', diaPassado);
    await prof.dispatchEvent('#marcar-data', 'change');
    await prof.waitForSelector('#marcar-slots .btn-slot-horario.slot-passado', { timeout: 3000 });
    const hora = (await prof.textContent('#marcar-slots .btn-slot-horario >> nth=0')).split(' – ')[0].trim();
    const popups = [];
    ctxP.on('page', (pg) => popups.push(pg));
    await prof.click('#marcar-slots .btn-slot-horario >> nth=0');
    await prof.click('#modal-marcar-aula button:has-text("Marcar aula")');
    await prof.waitForSelector('#modal-marcar-aula.modal-oculto', { state: 'attached', timeout: 5000 });
    await prof.waitForFunction(({ d, h }) => aulasCache.some((a) => a.data === d && a.horaInicio === h && a.status === 'concluida'), { d: diaPassado, h: hora }, { timeout: 5000 });
    esperar(popups.length === 0, 'abriu o WhatsApp para uma aula que já aconteceu');
    // Não fica pedindo confirmação: já entrou como realizada
    esperar(!(await prof.$(`#confirmar-aulas .cartao-aula:has-text("Seu Zé")`)), 'a aula registrada caiu em "aulas para confirmar"');

    // No dia que passou, só aparecem horários sem agendamento nenhum: nem a aula
    // registrada, nem uma cancelada, nem uma "não realizada"
    const [h2, h3] = await prof.evaluate((d) => horariosLivresDoDia(d).slice(0, 2), diaPassado);
    esperar(h2 && h3, 'o dia de teste não tem horários suficientes');
    await prof.evaluate(async ({ d, h2, h3, ze }) => {
      for (const [h, st] of [[h2, 'cancelada'], [h3, 'nao-realizada']]) {
        const id = await agendarAula(professorIdAtual, d, h, somarMinutos(h, 50), 'online', ze, 'Seu Zé', false, 'en', 'agendada');
        await db.collection('aulas').doc(id).update({ status: st });
      }
    }, { d: diaPassado, h2, h3, ze });
    await prof.waitForFunction(({ d, h2, h3 }) => aulasCache.filter((a) => a.data === d && [h2, h3].includes(a.horaInicio)).length === 2, { d: diaPassado, h2, h3 }, { timeout: 5000 });
    await prof.evaluate((id) => abrirMarcarAula(id), ze);
    await prof.fill('#marcar-data', diaPassado);
    await prof.dispatchEvent('#marcar-data', 'change');
    const mostrados = await prof.$$eval('#marcar-slots .btn-slot-horario', (bs) => bs.map((b) => b.textContent.split(' – ')[0].trim()));
    esperar(![hora, h2, h3].some((h) => mostrados.includes(h)), `mostrou horário que já teve agendamento: ${mostrados.join(', ')}`);
    // "Outro horário" no mesmo horário de uma aula cancelada também é recusado
    await prof.click('#btn-outro-horario');
    await prof.fill('#marcar-hora', h2);
    await prof.click('#modal-marcar-aula button:has-text("Marcar aula")');
    await prof.waitForFunction(() => /já houve um agendamento/.test(document.getElementById('status-marcar-aula').textContent), null, { timeout: 3000 });
    await prof.click('#modal-marcar-aula .btn-fechar-modal');
  });

  await caso('professor marca aula para aluno com WhatsApp: abre a confirmação pronta para o aluno', async () => {
    await prof.evaluate(() => abrirMarcarAula(alunosSemAppCache.find((a) => a.nome === 'Seu Zé').id));
    await prof.fill('#marcar-data', dataDaqui(6));
    await prof.click('#btn-outro-horario');
    await prof.fill('#marcar-hora', '16:00');
    const [aba] = await Promise.all([
      ctxP.waitForEvent('page', { timeout: 5000 }),
      prof.click('#modal-marcar-aula button:has-text("Marcar aula")')
    ]);
    await aba.waitForURL(/wa\.me/, { timeout: 5000 });
    const url = decodeURIComponent(aba.url());
    esperar(url.includes('wa.me/5511988887777') && url.includes('16:00'), 'link do WhatsApp errado: ' + url);
    await aba.close();
  });

  console.log('\nPlano do aluno (aulas por semana e reposições)');
  const ctxHugo = await h.novoContexto(browser); const hugo = await h.novaPagina(ctxHugo);
  await h.cadastrar(hugo, { tipo: 'aluno', nome: 'Hugo', email: `hugo-${id}@t.com`, codigo });
  await hugo.waitForURL('**/dicionario.html', { timeout: 10000 }); await hugo.waitForSelector('#input-palavra-en'); await dormir(1500);
  const blocoHugo = '.aluno-bloco:has(.item-aluno:has-text("Hugo"))';
  const saldoNoPainel = () => prof.textContent(`${blocoHugo} .saldo-reposicoes`);

  async function confirmarPrimeiroHorario(p) {
    await abrirAgendamentoNoDia(p, dia);
    await p.click('.btn-slot-horario >> nth=0');
    await p.waitForSelector('.resumo-passo', { timeout: 3000 });
  }

  await caso('professor define 1 aula por semana no painel do aluno', async () => {
    await prof.click('#btn-aba-alunos');
    await prof.click(`${blocoHugo} .item-aluno`);
    await prof.selectOption(`${blocoHugo} .plano-aluno select`, '1');
    await hugo.waitForFunction(async () => {
      const p = (await db.collection('usuarios').doc(auth.currentUser.uid).get()).data().plano;
      return p && p.aulasPorSemana === 1;
    }, null, { timeout: 5000 });
    esperar((await saldoNoPainel()).trim() === '0', 'saldo inicial diferente de 0');
  });

  const contadorSino = async (p) => (await p.isVisible('#contador-notificacoes')) ? (await p.textContent('#contador-notificacoes')).trim() : '0';

  await caso('com a semana cheia e sem crédito, a aula vira pedido de reposição (horário reservado)', async () => {
    await confirmarPrimeiroHorario(hugo);
    await hugo.click('#btn-confirmar-agendamento');
    await hugo.waitForSelector('.agendamento-sucesso:has-text("Aula confirmada")', { timeout: 8000 });
    await hugo.keyboard.press('Escape');
    await confirmarPrimeiroHorario(hugo);
    esperar(await hugo.isChecked('#chk-reposicao'), 'com a semana cheia, deveria virar reposição');
    await hugo.waitForSelector('.aviso-pedido', { timeout: 3000 });
    await hugo.click('#btn-confirmar-agendamento:has-text("Pedir reposição ao professor")');
    await hugo.waitForSelector('.agendamento-sucesso:has-text("Pedido de reposição enviado")', { timeout: 8000 });
    await hugo.keyboard.press('Escape');
    await hugo.waitForSelector('#painel-minhas-aulas .cartao-aula:has-text("Aguardando aprovação")', { timeout: 5000 });
    const pedido = await hugo.evaluate(() => minhasAulasCache.find((a) => a.status === 'pendente'));
    esperar(pedido && pedido.reposicao === true, 'pedido não gravado como reposição pendente');
  });

  await caso('professor recebe no sino a aula marcada e o pedido de reposição do aluno', async () => {
    await prof.waitForFunction(() => notificacoesProfessorCache.some((n) => n.tipo === 'aluno-pediu-reposicao'), null, { timeout: 5000 });
    // Outros alunos dos testes anteriores também avisaram: o sino conta todas as não lidas
    const naoLidas = await prof.evaluate(() => notificacoesProfessorCache.filter((n) => !n.lida).length);
    esperar(naoLidas >= 2 && (await contadorSino(prof)) === (naoLidas > 9 ? '9+' : String(naoLidas)), `sino do professor: ${await contadorSino(prof)} (não lidas: ${naoLidas})`);
    await prof.click('#btn-notificacoes');
    await prof.waitForSelector('#modal-notificacoes .item-notificacao:has-text("Hugo marcou uma aula")', { timeout: 3000 });
    await prof.waitForSelector('#modal-notificacoes .item-notificacao:has-text("Hugo pediu uma reposição")', { timeout: 3000 });
    await prof.waitForFunction(() => notificacoesProfessorCache.every((n) => n.lida), null, { timeout: 5000 });
    await prof.keyboard.press('Escape');
    esperar((await contadorSino(prof)) === '0', 'abrir não marcou como lidas');
  });

  await caso('professor vê o pedido em destaque (com contador) e aprova; o aluno é notificado', async () => {
    await prof.click('#btn-aba-agenda');
    await prof.waitForSelector('#pedidos-reposicao .cartao-aula:has-text("Hugo")', { timeout: 8000 });
    esperar((await prof.textContent('#btn-aba-agenda .contador-pedidos')).trim() === '1', 'sem contador de pedidos na aba Agenda');
    await prof.click('#pedidos-reposicao button:has-text("Aprovar")');
    await prof.waitForSelector('#pedidos-reposicao', { state: 'detached', timeout: 5000 });
    await hugo.waitForSelector('#painel-minhas-aulas .cartao-aula:has-text("Reposição"):not(:has-text("Aguardando"))', { timeout: 5000 });
    await hugo.waitForFunction(() => notificacoesCache.some((n) => n.tipo === 'reposicao-aprovada'), null, { timeout: 5000 });
    esperar((await contadorSino(hugo)) === '1', 'sino sem a notificação');
    await hugo.click('#btn-notificacoes');
    await hugo.waitForSelector('.item-notificacao:has-text("foi aprovado")', { timeout: 3000 });
    await hugo.waitForFunction(() => notificacoesCache.every((n) => n.lida), null, { timeout: 5000 });
    await hugo.keyboard.press('Escape');
    esperar((await contadorSino(hugo)) === '0', 'abrir não marcou como lida');
    // aprovar conta como 1 crédito concedido e usado: o saldo continua 0
    await prof.click('#btn-aba-alunos');
    await prof.waitForSelector(`${blocoHugo} .saldo-reposicoes:text-is("0")`, { timeout: 5000 });
  });

  await caso('professor dá 1 reposição (+) e o aluno marca a aula extra usando o crédito', async () => {
    await prof.click(`${blocoHugo} button[aria-label="Dar 1 reposição"]`);
    await prof.waitForSelector(`${blocoHugo} .saldo-reposicoes:text-is("1")`, { timeout: 5000 });
    await hugo.waitForFunction(() => notificacoesCache.some((n) => n.tipo === 'credito-reposicao' && !n.lida), null, { timeout: 5000 });
    esperar((await contadorSino(hugo)) === '1', 'aluno não foi notificado do crédito');
    await confirmarPrimeiroHorario(hugo);
    await hugo.waitForSelector('.plano-agendamento:has-text("Reposições disponíveis: 1")', { timeout: 3000 });
    esperar(await hugo.isChecked('#chk-reposicao'), 'não usou a reposição automaticamente com a semana cheia');
    await hugo.click('#btn-confirmar-agendamento');
    await hugo.waitForSelector('.agendamento-sucesso:has-text("Reposição")', { timeout: 8000 });
    await hugo.keyboard.press('Escape');
    await prof.waitForSelector(`${blocoHugo} .saldo-reposicoes:text-is("0")`, { timeout: 5000 });
  });

  await caso('cancelar a aula de reposição devolve o crédito', async () => {
    const repo = await hugo.evaluate(() => minhasAulasCache.find((a) => a.reposicao && a.status === 'agendada').id);
    await hugo.evaluate((id) => cancelarMinhaAula(id), repo);
    await hugo.waitForFunction(() => situacaoDoPlano(null).saldo === 1, null, { timeout: 5000 });
    await prof.waitForSelector(`${blocoHugo} .saldo-reposicoes:text-is("1")`, { timeout: 5000 });
    await prof.waitForFunction(() => notificacoesProfessorCache.some((n) => n.tipo === 'aluno-cancelou-aula' && /Hugo cancelou a reposição/.test(n.texto)), null, { timeout: 5000 });
  });

  await caso('professor tira o crédito (−) e o saldo não fica negativo', async () => {
    await prof.click(`${blocoHugo} button[aria-label="Tirar 1 reposição"]`);
    await prof.waitForSelector(`${blocoHugo} .saldo-reposicoes:text-is("0")`, { timeout: 5000 });
    esperar(await prof.isDisabled(`${blocoHugo} button[aria-label="Tirar 1 reposição"]`), '"−" continua ativo com saldo 0');
  });
  await caso('professor recusa um pedido: o horário é liberado e o aluno é notificado', async () => {
    await confirmarPrimeiroHorario(hugo);
    const horario = (await hugo.textContent('.resumo-passo span')).split(' às ')[1].trim();
    await hugo.click('#btn-confirmar-agendamento:has-text("Pedir reposição ao professor")');
    await hugo.waitForSelector('.agendamento-sucesso', { timeout: 8000 });
    await hugo.keyboard.press('Escape');
    await prof.click('#btn-aba-agenda');
    await prof.click('#pedidos-reposicao button:has-text("Recusar")');
    await prof.waitForSelector('#pedidos-reposicao', { state: 'detached', timeout: 5000 });
    await hugo.waitForFunction(() => notificacoesCache.some((n) => n.tipo === 'reposicao-recusada'), null, { timeout: 5000 });
    // o horário volta a aparecer como livre
    await abrirAgendamentoNoDia(hugo, dia);
    esperar(await hugo.$(`.btn-slot-horario:text-matches("^${horario} – ")`), `horário ${horario} não foi liberado`);
    await hugo.keyboard.press('Escape');
  });
  await ctxHugo.close();

  await caso('aluno sem professor recebe aviso ao clicar em "Agendar aula"', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Duda', email: `duda-${id}@t.com`, codigo });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en');
    await p.waitForFunction(() => auth.currentUser, null, { timeout: 8000 });
    await p.evaluate(async () => { await db.collection('usuarios').doc(auth.currentUser.uid).update({ professorId: null }); });
    await p.reload(); await p.waitForSelector('#input-palavra-en'); await dormir(1500);
    p.ultimoDialogo = null;
    await p.click('button:has-text("Agendar aula")'); await dormir(1000);
    esperar(p.ultimoDialogo && /professor/i.test(p.ultimoDialogo), 'clique não fez nada');
    await ctx.close();
  });

  console.log('\nSemana de trabalho e idioma da aula');
  const ctxDiego = await h.novoContexto(browser); const diego = await h.novaPagina(ctxDiego);
  await h.cadastrar(diego, { tipo: 'professor', nome: 'Diego', email: `diego-${id}@t.com` });
  await diego.waitForURL('**/professor.html', { timeout: 10000 });
  await diego.waitForFunction(() => /^PROF-/.test(document.getElementById('codigo-professor').textContent), null, { timeout: 10000 });
  const codigoDiego = await diego.textContent('#codigo-professor');
  await diego.evaluate(async () => { await db.collection('usuarios').doc(professorIdAtual).update({ idiomas: ['en', 'es'], idioma: 'en' }); });
  const dispDiego = () => diego.evaluate(async () =>
    (await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').get()).data().disponibilidade);
  const abrirConfig = async () => {
    await diego.click('#btn-aba-agenda');
    await diego.click('button:has-text("Configurar disponibilidade")');
    await diego.waitForSelector('#modal-config-agenda:not(.modal-oculto) #config-dias-trabalho .dia-trabalho', { state: 'attached', timeout: 5000 });
  };
  const salvarConfig = async () => {
    await diego.click('#modal-config-agenda button:has-text("Salvar disponibilidade")');
    await diego.waitForSelector('#modal-config-agenda.modal-oculto', { state: 'attached', timeout: 5000 });
  };

  await caso('professor configura a semana toda de uma vez: marca os dias e cadastra os períodos', async () => {
    await abrirConfig();
    esperar(await diego.isVisible('#config-semana-igual'), 'não abriu no modo "mesmo horário em todos os dias"');
    await diego.click('.dia-trabalho[data-dia="sex"]');          // desmarca sexta
    await diego.click('#config-semana-igual button:has-text("+ Adicionar período")');
    await diego.check('#config-modalidade-online');
    await salvarConfig();
    const disp = await dispDiego();
    const esperado = JSON.stringify([{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '18:00' }, { inicio: '19:00', fim: '22:00' }]);
    for (const d of ['seg', 'ter', 'qua', 'qui']) esperar(JSON.stringify(disp[d]) === esperado, `${d}: ${JSON.stringify(disp[d])}`);
    esperar(!disp.sex && !disp.sab && !disp.dom, 'salvou dia não marcado: ' + Object.keys(disp).join(','));
  });

  await caso('períodos que se sobrepõem são recusados com explicação', async () => {
    await abrirConfig();
    await diego.fill('#config-semana-igual .linha-periodo >> nth=1 >> .periodo-inicio', '11:00');
    diego.ultimoDialogo = null;
    await diego.click('#modal-config-agenda button:has-text("Salvar disponibilidade")');
    await dormir(500);
    esperar(diego.ultimoDialogo && /sobrepõem/.test(diego.ultimoDialogo), 'aceitou períodos sobrepostos: ' + diego.ultimoDialogo);
    await diego.click('#modal-config-agenda .btn-fechar-modal');
  });

  await caso('"Ajustar dia por dia" mantém o que já estava e permite um horário diferente num dia', async () => {
    await abrirConfig();
    await diego.click('#btn-modo-dia');
    esperar(await diego.isChecked('.chk-dia-trabalha[data-dia="seg"]') && !(await diego.isChecked('.chk-dia-trabalha[data-dia="sex"]')), 'não levou os dias marcados');
    esperar((await diego.$$('.lista-periodos[data-grupo="ter"] .linha-periodo')).length === 3, 'não levou os períodos');
    await diego.click('.lista-periodos[data-grupo="ter"] .linha-periodo >> nth=2 >> .remover-periodo');
    await diego.uncheck('.chk-dia-trabalha[data-dia="qua"]');
    await salvarConfig();
    const disp = await dispDiego();
    esperar(disp.ter.length === 2 && disp.seg.length === 3 && !disp.qua, JSON.stringify(disp));
    await abrirConfig();
    esperar(await diego.isVisible('#config-dias-semana'), 'com horários diferentes, deveria reabrir no "dia por dia"');
    await diego.click('#modal-config-agenda .btn-fechar-modal');
  });

  await caso('"dia por dia": cada dia tem o seu modo (online/presencial) e o aluno só vê o modo daquele dia', async () => {
    await abrirConfig();
    esperar(await diego.isHidden('#config-modalidades-gerais'), 'mostrou a modalidade geral no modo "dia por dia"');
    await diego.check('.chk-modalidade-semana[data-dia="ter"][value="presencial"]');
    await diego.uncheck('.chk-modalidade-semana[data-dia="ter"][value="online"]');
    await salvarConfig();
    const cfg = await diego.evaluate(async () =>
      (await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').get()).data());
    esperar(JSON.stringify(cfg.modalidadesPorDia.ter) === '["presencial"]' && JSON.stringify(cfg.modalidadesPorDia.seg) === '["online"]',
      JSON.stringify(cfg.modalidadesPorDia));
    esperar(cfg.modalidades.includes('online') && cfg.modalidades.includes('presencial'), 'modalidade geral não somou as dos dias');
    // libera o próximo mês, caso a próxima terça já seja no mês seguinte
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    await diego.evaluate(async (mes) => { await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').update({ mesesLiberados: [mes] }); },
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);

    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Joana', email: `joana-${id}@t.com`, codigo: codigoDiego });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en'); await dormir(1500);
    const proxima = (diaSemana) => { const x = new Date(); x.setDate(x.getDate() + 1); while (x.getDay() !== diaSemana) x.setDate(x.getDate() + 1);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    for (const [diaSemana, esperado, outro] of [[2, 'Presencial', 'Online'], [1, 'Online', 'Presencial']]) {
      await p.click('button:has-text("Agendar aula")');
      await p.click('.opcao-idioma-aula >> nth=0');
      const data = proxima(diaSemana);
      for (let i = 0; i < 3 && !(await p.$(`[data-calday="${data}"]`)); i++) await p.click('#btn-cal-mes-proximo');
      await p.click(`[data-calday="${data}"]`);
      await p.click('.btn-slot-horario >> nth=0');
      await p.waitForSelector('#btn-confirmar-agendamento:not([disabled])');
      esperar(!(await p.$(`input[name="modalidade-agendamento"][value="${outro.toLowerCase()}"]`)), `ofereceu ${outro} num dia só ${esperado}`);
      await p.click('#btn-confirmar-agendamento');
      await p.waitForSelector(`.agendamento-sucesso:has-text("${esperado}")`, { timeout: 8000 });
      await p.keyboard.press('Escape');
    }
    await ctx.close();
  });

  const ctxIris = await h.novoContexto(browser); const iris = await h.novaPagina(ctxIris);
  await caso('ao marcar aula, o aluno escolhe primeiro o idioma (com bandeiras)', async () => {
    const p = iris;
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Iris', email: `iris-${id}@t.com`, codigo: codigoDiego });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en'); await dormir(1500);
    await p.click('button:has-text("Agendar aula")');
    await p.waitForSelector('.opcao-idioma-aula', { timeout: 8000 });
    esperar((await p.$$('.opcao-idioma-aula')).length === 2, 'não mostrou os 2 idiomas do professor');
    esperar(!(await p.$('[data-calday]')), 'deixou escolher o dia antes do idioma');
    await p.click('.opcao-idioma-aula:has-text("Espanhol")');
    await p.waitForSelector('.resumo-passo:has-text("Espanhol")', { timeout: 3000 });
    // primeiro dia disponível no calendário (avança de mês se precisar)
    for (let i = 0; i < 3 && !(await p.$('[data-calday]')); i++) await p.click('#btn-cal-mes-proximo');
    await p.click('[data-calday] >> nth=0');
    await p.waitForSelector('.btn-slot-horario', { timeout: 8000 });
    await p.click('.btn-slot-horario >> nth=0');
    await p.click('#btn-confirmar-agendamento');
    await p.waitForSelector('.agendamento-sucesso:has-text("Espanhol")', { timeout: 8000 });
    const idioma = await p.evaluate(() => aulasFuturasDoAluno('es')[0] && aulasFuturasDoAluno('es')[0].idioma);
    esperar(idioma === 'es', 'aula gravada com idioma ' + idioma);
  });

  await caso('plano, reposições e avisos são separados por idioma', async () => {
    const blocoIris = '.aluno-bloco:has(.item-aluno:has-text("Iris"))';
    await diego.reload(); // os idiomas do professor foram trocados direto no banco, no começo
    await diego.waitForFunction(() => idiomasAtuaisProfessor.length === 2, null, { timeout: 10000 });
    await diego.click('#btn-aba-alunos');
    await diego.click(`${blocoIris} .item-aluno`);
    await diego.waitForSelector(`${blocoIris} .plano-idioma[data-idioma="es"]`, { timeout: 5000 });
    esperar((await diego.$$(`${blocoIris} .plano-idioma`)).length === 2, 'não mostrou um plano por idioma');
    await diego.click(`${blocoIris} .plano-idioma[data-idioma="es"] button[aria-label="Dar 1 reposição"]`);
    await diego.waitForSelector(`${blocoIris} .plano-idioma[data-idioma="es"] .saldo-reposicoes:text-is("1")`, { timeout: 5000 });
    esperar((await diego.textContent(`${blocoIris} .plano-idioma[data-idioma="en"] .saldo-reposicoes`)) === '0', 'o crédito de espanhol apareceu em inglês');

    // No aluno: o aviso do crédito de espanhol não aparece no sino do inglês
    await iris.waitForFunction(() => notificacoesCache.some((n) => n.idioma === 'es'), null, { timeout: 5000 });
    await iris.evaluate(() => trocarIdiomaAtivo('en'));
    esperar(await iris.isHidden('#contador-notificacoes'), 'aviso de espanhol contou no sino do inglês');
    esperar(/Espanhol \(1 aviso\)/.test(await iris.textContent('#seletor-idioma')), 'seletor não mostra o aviso do outro idioma');
    await iris.evaluate(() => trocarIdiomaAtivo('es'));
    esperar((await iris.textContent('#contador-notificacoes')) === '1', 'aviso não aparece no espanhol');
    // Notificação antiga (sem idioma): conta como do primeiro idioma do professor (inglês), não aparece no espanhol
    await diego.evaluate(async () => {
      const iris = alunosCache.find((a) => a.nome === 'Iris');
      await db.collection('usuarios').doc(iris.id).collection('notificacoes').add({
        tipo: 'credito-reposicao', texto: 'Você recebeu 1 crédito de reposição (aviso antigo).', lida: false,
        professorId: professorIdAtual, criadoEm: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await iris.waitForFunction(() => notificacoesCache.some((n) => !n.idioma), null, { timeout: 5000 });
    esperar((await iris.textContent('#contador-notificacoes')) === '1', 'aviso antigo apareceu no espanhol');
    esperar(/Inglês \(1 aviso\)/.test(await iris.textContent('#seletor-idioma')), 'aviso antigo não foi para o inglês');
    const saldos = await iris.evaluate(async () => {
      perfilAlunoAtual = (await db.collection('usuarios').doc(auth.currentUser.uid).get()).data(); // como "Agendar aula" faz
      return ['en', 'es'].map((id) => { agendamento = { idioma: id }; return situacaoDoPlano(null).saldo; });
    });
    esperar(saldos[0] === 0 && saldos[1] === 1, 'saldos por idioma: ' + saldos);
    await iris.evaluate(() => { agendamento = null; });
  });

  await caso('Agenda filtrada por idioma; "Não foi realizada" deixa escolher o idioma da reposição', async () => {
    await iris.evaluate(async () => {
      await agendarAula(professorIdDoAluno, dataDeHojeISO(), '00:00', '00:30', 'online', auth.currentUser.uid, 'Iris', false, 'es');
    });
    await diego.click('#btn-aba-agenda');
    const cartao = '#confirmar-aulas .cartao-aula:has-text("Iris")';
    await diego.waitForSelector(cartao, { timeout: 8000 });
    await diego.click('.chip-idioma[data-idioma="en"]');
    await diego.waitForSelector(cartao, { state: 'detached', timeout: 3000 });
    await diego.click('.chip-idioma[data-idioma="es"]');
    await diego.waitForSelector(cartao, { timeout: 3000 });

    const saldoEn = () => diego.evaluate(() => creditosDoAluno(alunosCache.find((a) => a.nome === 'Iris').id, 'en').saldo);
    const antes = await saldoEn();
    await diego.click(`${cartao} button:has-text("Não foi realizada")`);
    const seletor = `${cartao} .escolha-idioma-reposicao select`;
    await diego.waitForSelector(seletor, { timeout: 3000 });
    esperar((await diego.inputValue(seletor)) === 'es', 'não veio com o idioma da aula');
    await diego.selectOption(seletor, 'en');
    await diego.click(`${cartao} button:has-text("Confirmar")`);
    await diego.waitForSelector(cartao, { state: 'detached', timeout: 5000 });
    await diego.waitForFunction((n) => creditosDoAluno(alunosCache.find((a) => a.nome === 'Iris').id, 'en').saldo === n, antes + 1, { timeout: 5000 });
    await iris.waitForFunction(() => notificacoesCache.some((n) => n.tipo === 'aula-nao-realizada' && n.idioma === 'en'), null, { timeout: 5000 });
  });

  await caso('seletor de idioma no topo vale para o painel; cada idioma pode ter a própria configuração de aulas', async () => {
    await diego.click('#seletor-idioma-professor .chip-idioma[data-idioma="es"]');
    await diego.waitForSelector('#visao-geral-turma .metrica-label:has-text("de Espanhol")', { timeout: 3000 });

    // Configurar disponibilidade abre no idioma do topo; Espanhol ganha aulas de 1h30
    await diego.click('#btn-aba-agenda');
    await diego.click('button:has-text("Configurar disponibilidade")');
    await diego.waitForSelector('#modal-config-agenda:not(.modal-oculto)', { timeout: 5000 });
    esperar((await diego.inputValue('#config-idioma-alvo')) === 'es', 'não abriu no idioma escolhido no topo');
    esperar(await diego.isHidden('#config-campos-aula'), 'idioma sem configuração própria mostrou os campos');
    await diego.check('#config-idioma-proprio');
    await diego.selectOption('#config-duracao-aula', '90');
    await diego.click('#modal-config-agenda button:has-text("Salvar disponibilidade")');
    await diego.waitForSelector('#modal-config-agenda.modal-oculto', { state: 'attached', timeout: 5000 });
    const cfg = await diego.evaluate(() => configAgendaAtual);
    esperar(cfg.porIdioma && cfg.porIdioma.es && cfg.porIdioma.es.duracaoAulaMinutos === 90, 'não gravou a configuração do espanhol');
    esperar(cfg.duracaoAulaMinutos !== 90, 'mudou a configuração padrão junto');

    // O aluno, ao escolher Espanhol, vê horários de 1h30; em Inglês, a duração padrão
    const duracaoDoPrimeiroHorario = async (nomeIdioma) => {
      await iris.evaluate(() => fecharAgendamento()); // a janela de um agendamento anterior pode ter ficado aberta
      await iris.click('button:has-text("Agendar aula")');
      await iris.waitForSelector('.opcao-idioma-aula', { timeout: 8000 });
      await iris.click(`.opcao-idioma-aula:has-text("${nomeIdioma}")`);
      for (let i = 0; i < 3 && !(await iris.$('[data-calday]')); i++) await iris.click('#btn-cal-mes-proximo');
      await iris.click('[data-calday] >> nth=0');
      await iris.waitForSelector('.btn-slot-horario', { timeout: 8000 });
      const texto = await iris.textContent('.btn-slot-horario >> nth=0');
      await iris.evaluate(() => fecharAgendamento());
      const [ini, fim] = texto.split(' – ').map((h) => minutosDoHorarioTeste(h));
      return fim - ini;
    };
    const minutosDoHorarioTeste = (h) => { const [a, b] = h.trim().split(':').map(Number); return a * 60 + b; };
    esperar((await duracaoDoPrimeiroHorario('Espanhol')) === 90, 'espanhol não usou 1h30');
    esperar((await duracaoDoPrimeiroHorario('Inglês')) === cfg.duracaoAulaMinutos, 'inglês não usou a duração padrão');
    await diego.click('#seletor-idioma-professor .chip-idioma >> nth=0'); // volta para "Todos"
  });
  await ctxIris.close();
  await ctxDiego.close();

  console.log('\nWhatsApp do professor e tema noturno');
  await caso('professor cadastra o WhatsApp em Configurações; aparece também em "Configurar disponibilidade"', async () => {
    await prof.click('#btn-aba-config');
    esperar(await prof.isVisible('#aviso-sem-whatsapp'), 'sem aviso de WhatsApp não cadastrado');
    await prof.fill('#input-whatsapp-professor', '123');
    await prof.click('.secao-whatsapp-professor button:has-text("Salvar WhatsApp")');
    await prof.waitForSelector('#status-whatsapp-professor:has-text("inválido")', { timeout: 3000 });
    await prof.fill('#input-whatsapp-professor', '11 97777-6666');
    await prof.click('.secao-whatsapp-professor button:has-text("Salvar WhatsApp")');
    await prof.waitForSelector('#status-whatsapp-professor:has-text("Salvo")', { timeout: 5000 });
    esperar(await prof.isHidden('#aviso-sem-whatsapp'), 'aviso continuou depois de salvar');
    const cfg = await prof.evaluate(async () => (await db.collection('usuarios').doc(professorIdAtual).collection('configuracaoAgenda').doc('dados').get()).data());
    esperar(cfg.whatsapp === '11 97777-6666' && cfg.disponibilidade && Object.keys(cfg.disponibilidade).length, 'não gravou o WhatsApp (ou apagou a disponibilidade)');
    await prof.click('#btn-aba-agenda');
    await prof.click('button:has-text("Configurar disponibilidade")');
    await prof.waitForSelector('#modal-config-agenda:not(.modal-oculto)', { timeout: 5000 });
    esperar(await prof.isVisible('#config-whatsapp') && (await prof.inputValue('#config-whatsapp')) === '11 97777-6666', 'WhatsApp não aparece na configuração da agenda');
  });

  await caso('tema noturno: os campos da configuração têm fundo escuro (texto legível)', async () => {
    await prof.evaluate(() => aplicarTema('noturno'));
    const claros = await prof.evaluate(() => ['config-duracao-aula', 'config-intervalo-aula', 'config-whatsapp'].filter((id) => {
      const [r, g, b] = getComputedStyle(document.getElementById(id)).backgroundColor.match(/\d+/g).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
    }));
    await prof.evaluate(() => aplicarTema('classico'));
    await prof.click('#modal-config-agenda .btn-fechar-modal');
    esperar(claros.length === 0, 'campos com fundo claro no tema noturno: ' + claros.join(', '));
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
