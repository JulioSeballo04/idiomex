// Testes de ponta a ponta: simulam professor e alunos usando o app no navegador.
// Rodar com: npm run test:e2e (veja testes/README.md)
const h = require('./harness');
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
  await caso('professor se cadastra e vê o código', async () => {
    await h.cadastrar(prof, { tipo: 'professor', nome: 'Prof Ana', email: `ana-${id}@t.com` });
    await prof.waitForURL('**/professor.html', { timeout: 10000 });
    await prof.waitForFunction(() => /^PROF-/.test(document.getElementById('codigo-professor').textContent), null, { timeout: 10000 });
    codigo = await prof.textContent('#codigo-professor');
  });

  await caso('código inválido não deixa conta "presa": dá pra cadastrar de novo com o mesmo e-mail', async () => {
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', email: `bia-${id}@t.com`, codigo: 'PROF-ZZZZ' });
    await aluno.waitForFunction(() => /inválido/i.test(document.getElementById('status-cadastro').textContent), null, { timeout: 8000 });
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', email: `bia-${id}@t.com`, codigo });
    await aluno.waitForURL('**/dicionario.html', { timeout: 8000 }).catch(async () => {
      throw new Error('ficou na tela de cadastro: ' + await aluno.textContent('#status-cadastro'));
    });
  });
  if (!aluno.url().includes('dicionario')) {
    await h.cadastrar(aluno, { tipo: 'aluno', nome: 'Bia', email: `bia2-${id}@t.com`, codigo });
    await aluno.waitForURL('**/dicionario.html', { timeout: 10000 });
  }

  await caso('quem já está logado e abre a tela inicial vai direto para o painel', async () => {
    await aluno.goto(`${SITE}/index.html`);
    await aluno.waitForURL('**/dicionario.html', { timeout: 8000 });
  });

  await caso('login com senha errada mostra mensagem em português', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await p.goto(`${SITE}/index.html`);
    await p.fill('#loginEmail', `ana-${id}@t.com`); await p.fill('#loginSenha', 'errada!!');
    await p.click('#form-login button[type=submit]');
    await p.waitForFunction(() => { const t = document.getElementById('status-login').textContent; return t && t !== 'Entrando...'; }, null, { timeout: 8000 });
    const msg = await p.textContent('#status-login');
    esperar(/incorret|Senha/i.test(msg) && !/firebase|auth\//i.test(msg), 'mensagem: ' + msg);
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
  await caso('"Esqueci minha senha" envia o link', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await p.goto(`${SITE}/index.html`);
    await p.fill('#loginEmail', `ana-${id}@t.com`);
    await p.click('.link-esqueci-senha');
    await p.waitForFunction(() => /link/.test(document.getElementById('status-login').textContent), null, { timeout: 8000 });
    await ctx.close();
  });

  await caso('aluno exclui a conta e não consegue mais entrar', async () => {
    const ctx = await h.novoContexto(browser); const p = await h.novaPagina(ctx);
    await h.cadastrar(p, { tipo: 'aluno', nome: 'Edu', email: `edu-${id}@t.com`, codigo });
    await p.waitForURL('**/dicionario.html', { timeout: 10000 }); await p.waitForSelector('#input-palavra-en'); await dormir(1000);
    await p.click('button:has-text("Meu perfil")');
    await p.fill('#excluir-senha-aluno', 'senha123');
    await p.click('button:has-text("Excluir minha conta")');
    await p.waitForURL('**/index.html', { timeout: 10000, waitUntil: 'commit' }).catch(() => {}); await p.waitForSelector('#loginEmail');
    await p.fill('#loginEmail', `edu-${id}@t.com`); await p.fill('#loginSenha', 'senha123');
    await p.click('#form-login button[type=submit]');
    await p.waitForFunction(() => { const t = document.getElementById('status-login').textContent; return t && t !== 'Entrando...'; }, null, { timeout: 8000 });
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
