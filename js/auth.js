// ============================================================
// AUTENTICAÇÃO E CADASTRO — Professor / Aluno
// ============================================================

// Gera um código curto e legível para o professor compartilhar
// com os alunos, ex: "PROF-8X2K"
function gerarCodigoProfessor() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem letras/números ambíguos
  let codigo = "";
  for (let i = 0; i < 4; i++) {
    codigo += chars[Math.floor(Math.random() * chars.length)];
  }
  return `PROF-${codigo}`;
}

// Procura o professor dono de um código (ex: "PROF-8X2K") e devolve o uid dele,
// ou null se o código não existir. Lê só o índice "codigosProfessor" — os perfis
// dos professores não ficam visíveis pra quem ainda não está vinculado.
async function professorDoCodigo(codigo) {
  const doc = await db.collection("codigosProfessor").doc(codigo).get();
  return doc.exists ? doc.data().professorId : null;
}

function normalizarCodigo(codigo) {
  return (codigo || "").trim().toUpperCase();
}

// true enquanto entrar/cadastrar está em andamento: a própria função redireciona no
// final, e a tela inicial não deve redirecionar junto (seriam duas navegações)
let loginEmAndamento = false;
let redirecionando = false;

// -------------------- GOOGLE OU E-MAIL --------------------
// Duas formas de entrar: com o Google ou com qualquer e-mail e senha. Nas duas, o
// e-mail da conta é comprovadamente da pessoa: a conta de e-mail e senha só ganha
// cadastro no Idiomex depois que a pessoa clica no link de confirmação que o
// Firebase manda para o e-mail (sem isso, qualquer um criaria conta com o e-mail
// de outro). As regras do Firestore conferem isso (email_verified).

function provedorGoogle() {
  const provedor = new firebase.auth.GoogleAuthProvider();
  provedor.setCustomParameters({ prompt: "select_account" }); // deixa escolher a conta Google
  return provedor;
}

function entrouComGoogle(user) {
  return !!user && user.providerData.some((p) => p.providerId === "google.com");
}

// Botão "Entrar com Google" da tela de login. Se a conta Google ainda não tem
// cadastro no Idiomex, leva para "Criar conta" com o nome já preenchido.
async function entrarComGoogle() {
  const statusEl = document.getElementById("status-login");
  statusEl.textContent = "Abrindo o Google...";
  loginEmAndamento = true;
  try {
    const cred = await auth.signInWithPopup(provedorGoogle());
    const perfil = await db.collection("usuarios").doc(cred.user.uid).get();
    if (perfil.exists) {
      redirecionarPorTipo(perfil.data().tipo);
      return;
    }
    statusEl.textContent = "";
    pedirParaCompletarCadastro(cred.user);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
  } finally {
    loginEmAndamento = false;
  }
}

// Conta Google sem cadastro no Idiomex: abre a aba "Criar conta" já com o nome do Google
function pedirParaCompletarCadastro(user) {
  if (typeof mostrarAba === "function") mostrarAba("cadastro");
  const campoNome = document.getElementById("cadNome");
  if (campoNome && !campoNome.value) campoNome.value = user.displayName || "";
  document.getElementById("status-cadastro").textContent =
    `Falta pouco! Confira seu nome, escolha se você é aluno ou professor e clique em "Criar conta com Google" (${user.email}).`;
}

// -------------------- CADASTRO --------------------
// Confere o formulário antes de abrir o Google ou criar a conta de e-mail, pra um
// erro aqui não deixar conta sem perfil
function cadastroValido(tipo, codigoProfessor, idiomas, statusEl) {
  if (tipo === "professor" && (!Array.isArray(idiomas) || idiomas.length === 0)) {
    statusEl.textContent = "Escolha pelo menos um idioma que você ensina.";
    return false;
  }
  if (tipo === "aluno" && !normalizarCodigo(codigoProfessor)) {
    statusEl.textContent = "Informe o código do professor para vincular sua conta.";
    const campo = document.getElementById("campo-codigo");
    if (campo) {
      campo.classList.add("faltando");
      document.getElementById("cadCodigo").focus();
    }
    return false;
  }
  return true;
}

// Grava o perfil (e, para o professor, o código dele) e abre o painel
async function criarPerfil(user, nome, tipo, codigoProfessor, idiomas, statusEl) {
  statusEl.textContent = "Criando conta...";
  const dadosUsuario = {
    nome,
    email: user.email,
    tipo, // "professor" ou "aluno"
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (tipo === "professor") {
    // Idiomas que ele ensina; os alunos vinculados escolhem entre eles. "idioma"
    // (o primeiro) fica junto por compatibilidade com o formato antigo.
    dadosUsuario.idiomas = idiomasDoPerfil({ idiomas });
    dadosUsuario.idioma = dadosUsuario.idiomas[0];
    await salvarPerfilDeProfessor(user.uid, dadosUsuario);
  }

  if (tipo === "aluno") {
    const codigo = normalizarCodigo(codigoProfessor);
    // Verifica se o código pertence a um professor de verdade
    const professorId = await professorDoCodigo(codigo);
    if (!professorId) {
      throw new Error("Código de professor inválido. Confira com seu professor.");
    }
    dadosUsuario.professorId = professorId;
    dadosUsuario.codigoVinculo = codigo; // as regras do Firestore conferem esse código
    await db.collection("usuarios").doc(user.uid).set(dadosUsuario);
  }

  statusEl.textContent = "Conta criada! Redirecionando...";
  redirecionarPorTipo(tipo);
}

async function cadastrar(nome, tipo, codigoProfessor, idiomas) {
  const statusEl = document.getElementById("status-cadastro");
  if (!cadastroValido(tipo, codigoProfessor, idiomas, statusEl)) return;

  let user = entrouComGoogle(auth.currentUser) ? auth.currentUser : null;
  let contaNova = false;
  loginEmAndamento = true;
  try {
    // 1. Login com o Google (se ainda não entrou pelo botão da tela de login)
    if (!user) {
      statusEl.textContent = "Abrindo o Google...";
      const cred = await auth.signInWithPopup(provedorGoogle());
      user = cred.user;
      contaNova = !!(cred.additionalUserInfo && cred.additionalUserInfo.isNewUser);
    }
    const uid = user.uid;

    // Essa conta Google já tem cadastro: só entra
    const existente = await db.collection("usuarios").doc(uid).get();
    if (existente.exists) {
      statusEl.textContent = "Você já tem cadastro. Entrando...";
      redirecionarPorTipo(existente.data().tipo);
      return;
    }

    // O nome pode ser editado no formulário; em branco, vale o nome da conta Google
    nome = (nome || "").trim() || (user.displayName || "").trim();
    if (!nome) {
      statusEl.textContent = "Digite seu nome e clique em \"Criar conta com Google\" de novo.";
      return;
    }
    await criarPerfil(user, nome, tipo, codigoProfessor, idiomas, statusEl);
  } catch (erro) {
    // Conta Google recém-criada mas sem perfil (ex: código de professor errado):
    // desfaz, pra pessoa poder tentar de novo do zero
    if (contaNova && user) {
      await user.delete().catch((e) => console.warn("Não foi possível desfazer a conta incompleta:", e));
    }
    statusEl.textContent = traduzErro(erro);
  } finally {
    loginEmAndamento = false;
  }
}

// -------------------- E-MAIL E SENHA --------------------
// Criar conta: cria o login, manda o link de confirmação e guarda o formulário no
// aparelho ("cadastroPendente"). Depois que a pessoa confirma (clicando no link do
// e-mail e voltando aqui), o cadastro termina sozinho com esses dados.

function entrouComEmail(user) {
  return !!user && user.providerData.some((p) => p.providerId === "password");
}

const CHAVE_CADASTRO_PENDENTE = "cadastroPendente";

function guardarCadastroPendente(dados) {
  try { localStorage.setItem(CHAVE_CADASTRO_PENDENTE, JSON.stringify(dados)); } catch (e) {}
}

function cadastroPendenteDe(email) {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_CADASTRO_PENDENTE) || "null");
    return dados && email && dados.email === email.toLowerCase() ? dados : null;
  } catch (e) { return null; }
}

function urlDeVolta() {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, "")}index.html`;
}

async function enviarConfirmacao(user) {
  auth.languageCode = "pt-BR"; // o e-mail do Firebase em português
  try {
    await user.sendEmailVerification({ url: urlDeVolta() });
  } catch (e) {
    // Endereço de volta não autorizado no Firebase: manda sem ele
    if (e.code === "auth/unauthorized-continue-uri" || e.code === "auth/invalid-continue-uri") await user.sendEmailVerification();
    else throw e;
  }
}

function mostrarAvisoConfirmacao(email) {
  const aviso = document.getElementById("aviso-confirmar-email");
  if (!aviso) return;
  aviso.hidden = false;
  document.getElementById("texto-confirmar-email").innerHTML =
    `Enviamos um link de confirmação para <strong>${escapeHtml(email)}</strong>. Abra o e-mail, clique no link e depois volte aqui.`;
  document.getElementById("status-confirmar-email").textContent = "";
}

async function cadastrarComEmail(nome, tipo, codigoProfessor, idiomas, email, senha) {
  const statusEl = document.getElementById("status-cadastro");
  if (!cadastroValido(tipo, codigoProfessor, idiomas, statusEl)) return;
  email = (email || "").trim().toLowerCase();
  nome = (nome || "").trim();
  if (!nome) { statusEl.textContent = "Digite seu nome."; document.getElementById("cadNome").focus(); return; }
  if (!email) { statusEl.textContent = "Digite seu e-mail."; document.getElementById("cadEmail").focus(); return; }

  loginEmAndamento = true;
  try {
    // Já entrou com essa conta de e-mail (ex: voltou depois de confirmar): continua nela
    let user = auth.currentUser && entrouComEmail(auth.currentUser) && auth.currentUser.email === email ? auth.currentUser : null;
    if (!user) {
      if (!senha || senha.length < 6) { statusEl.textContent = "Crie uma senha com pelo menos 6 caracteres."; return; }
      statusEl.textContent = "Criando sua conta...";
      user = (await auth.createUserWithEmailAndPassword(email, senha)).user;
      await user.updateProfile({ displayName: nome }).catch(() => {}); // o e-mail diz "Olá, <nome>"
    }
    guardarCadastroPendente({ email, nome, tipo, codigoProfessor: normalizarCodigo(codigoProfessor), idiomas });
    await user.reload();
    if (auth.currentUser.emailVerified) {
      await auth.currentUser.getIdToken(true); // o "e-mail confirmado" passa a valer para o banco
      await criarPerfil(auth.currentUser, nome, tipo, codigoProfessor, idiomas, statusEl);
      return;
    }
    await enviarConfirmacao(user);
    statusEl.textContent = "";
    mostrarAvisoConfirmacao(email);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
  } finally {
    loginEmAndamento = false;
  }
}

// "Já confirmei meu e-mail": confere com o Firebase e termina o cadastro
async function jaConfirmeiMeuEmail() {
  const status = document.getElementById("status-confirmar-email");
  const user = auth.currentUser;
  if (!user) { status.textContent = 'Entre com seu e-mail e senha na aba "Entrar".'; return; }
  status.textContent = "Conferindo...";
  loginEmAndamento = true;
  try {
    await user.reload();
    if (!auth.currentUser.emailVerified) {
      status.textContent = "Ainda não está confirmado. Abra o e-mail que enviamos e clique no link. Não achou? Procure por \"Idiomex\" na pasta Spam.";
      return;
    }
    await auth.currentUser.getIdToken(true);
    status.textContent = "";
    await terminarCadastroComEmail(auth.currentUser);
  } catch (erro) {
    status.textContent = traduzErro(erro);
  } finally {
    loginEmAndamento = false;
  }
}

async function reenviarConfirmacao() {
  const status = document.getElementById("status-confirmar-email");
  const user = auth.currentUser;
  if (!user) return;
  try {
    await enviarConfirmacao(user);
    status.textContent = "Enviamos de novo. Confira a caixa de entrada e, principalmente, a pasta Spam.";
  } catch (erro) {
    status.textContent = traduzErro(erro);
  }
}

// E-mail confirmado: termina com o formulário guardado; sem ele (ex: confirmou em
// outro aparelho), pede para preencher o formulário de novo
async function terminarCadastroComEmail(user) {
  const statusEl = document.getElementById("status-cadastro");
  const pendente = cadastroPendenteDe(user.email);
  if (pendente) {
    try {
      await criarPerfil(user, pendente.nome, pendente.tipo, pendente.codigoProfessor, pendente.idiomas, statusEl);
      try { localStorage.removeItem(CHAVE_CADASTRO_PENDENTE); } catch (e) {}
    } catch (erro) {
      statusEl.textContent = traduzErro(erro);
    }
    return;
  }
  document.getElementById("aviso-confirmar-email").hidden = true;
  document.getElementById("cadEmail").value = user.email;
  statusEl.textContent = `E-mail confirmado (${user.email})! Agora escolha se você é aluno ou professor, preencha o formulário e clique em "Criar conta com e-mail".`;
}

// Entrou com uma conta de e-mail que ainda não tem cadastro: falta confirmar o
// e-mail, ou terminar o cadastro
async function continuarCadastroComEmail(user) {
  if (typeof mostrarAba === "function") mostrarAba("cadastro");
  await user.reload().catch(() => {}); // pode ter confirmado agora há pouco (link do e-mail)
  user = auth.currentUser || user;
  if (!user.emailVerified) {
    document.getElementById("cadEmail").value = user.email;
    mostrarAvisoConfirmacao(user.email);
    return;
  }
  await user.getIdToken(true);
  await terminarCadastroComEmail(user);
}

async function entrarComEmail(email, senha) {
  const statusEl = document.getElementById("status-login");
  email = (email || "").trim().toLowerCase();
  if (!email || !senha) { statusEl.textContent = "Digite seu e-mail e sua senha."; return; }
  statusEl.textContent = "Entrando...";
  loginEmAndamento = true;
  try {
    const cred = await auth.signInWithEmailAndPassword(email, senha);
    const perfil = await db.collection("usuarios").doc(cred.user.uid).get();
    if (perfil.exists) {
      redirecionarPorTipo(perfil.data().tipo);
      return;
    }
    statusEl.textContent = "";
    await continuarCadastroComEmail(cred.user);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
  } finally {
    loginEmAndamento = false;
  }
}

async function esqueciMinhaSenha(email) {
  const statusEl = document.getElementById("status-login");
  email = (email || "").trim().toLowerCase();
  if (!email) {
    statusEl.textContent = 'Digite seu e-mail no campo acima e clique em "Esqueci minha senha" de novo.';
    document.getElementById("loginEmail").focus();
    return;
  }
  auth.languageCode = "pt-BR";
  try {
    await auth.sendPasswordResetEmail(email, { url: urlDeVolta() });
  } catch (erro) {
    // Por segurança, a mesma resposta exista ou não uma conta com esse e-mail
    if (!["auth/user-not-found", "auth/invalid-email"].includes(erro.code)) {
      if (erro.code === "auth/unauthorized-continue-uri" || erro.code === "auth/invalid-continue-uri") {
        await auth.sendPasswordResetEmail(email).catch(() => {});
      } else {
        statusEl.textContent = traduzErro(erro);
        return;
      }
    }
  }
  statusEl.textContent = `Se existir uma conta com ${email}, enviamos um link para criar uma senha nova. Ele costuma cair na pasta Spam: procure por "Idiomex".`;
}

// Grava o perfil do professor junto com a entrada do código dele no índice
// "codigosProfessor", no mesmo lote (ou os dois, ou nenhum). Se o código sorteado
// já for de outro professor, as regras recusam o lote e sorteamos outro.
async function salvarPerfilDeProfessor(uid, dadosUsuario) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigoProfessor();
    const lote = db.batch();
    lote.set(db.collection("usuarios").doc(uid), { ...dadosUsuario, codigoProfessor: codigo });
    lote.set(db.collection("codigosProfessor").doc(codigo), { professorId: uid });
    try {
      await lote.commit();
      return;
    } catch (e) {
      if (e.code !== "permission-denied") throw e;
      // Só sorteia outro código se a recusa foi porque esse código já tem dono;
      // qualquer outra recusa (ex: regras do Firestore desatualizadas) é mostrada
      const jaExiste = await db.collection("codigosProfessor").doc(codigo).get()
        .then((d) => d.exists).catch(() => false);
      if (!jaExiste) throw e;
    }
  }
  throw new Error("Não foi possível gerar seu código de professor. Tente novamente.");
}

// -------------------- EXCLUIR CONTA --------------------
// Apaga todos os documentos de uma subcoleção do usuário (em lotes de até 400)
async function apagarSubcolecao(ref) {
  const snap = await ref.get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const lote = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
    await lote.commit();
  }
}

// Exclui a conta logada e os dados dela. Confirma a identidade de novo (pelo Google,
// ou pedindo a senha), porque o Firebase só deixa excluir a conta logo depois de um
// login recente.
async function excluirMinhaConta() {
  const user = auth.currentUser;
  if (!user) return;
  if (entrouComGoogle(user)) {
    await user.reauthenticateWithPopup(provedorGoogle());
  } else {
    const senha = await perguntar("Para excluir a conta, digite sua senha:", "", { senha: true });
    if (!senha) throw new Error("Exclusão cancelada.");
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, senha));
  }

  const perfilRef = db.collection("usuarios").doc(user.uid);
  const perfil = (await perfilRef.get()).data() || {};

  if (perfil.tipo === "professor") {
    // Desvincula os alunos (eles mantêm a conta e podem entrar com o código de outro professor)
    const alunos = await db.collection("usuarios")
      .where("tipo", "==", "aluno").where("professorId", "==", user.uid).get();
    for (const aluno of alunos.docs) {
      await aluno.ref.update({ professorId: firebase.firestore.FieldValue.delete() });
    }
    // Os arquivos dos Documentos de aula ficam em pedaços dentro de cada documento
    const biblioteca = await perfilRef.collection("biblioteca").get();
    for (const documento of biblioteca.docs) await apagarPartesDoDocumento(documento.ref);
    for (const sub of ["anotacoesAgenda", "agendaOverrides", "configuracaoAgenda", "visualizacoes", "alunosSemApp", "notificacoes", "biblioteca"]) {
      await apagarSubcolecao(perfilRef.collection(sub));
    }
    if (perfil.codigoProfessor) {
      await db.collection("codigosProfessor").doc(perfil.codigoProfessor).delete().catch(() => {});
    }
  } else {
    // Cancela as aulas futuras, pra o horário voltar a ficar livre na agenda do professor
    const hoje = dataDeHojeISO();
    const aulas = await db.collection("aulas").where("alunoId", "==", user.uid).get();
    for (const aula of aulas.docs) {
      const dados = aula.data();
      if (dados.status === "agendada" && dados.data >= hoje) {
        await aula.ref.update({ status: "cancelada", canceladoPor: "aluno" });
      }
    }
    // Os arquivos da sala de aula ficam em pedaços dentro de cada documento
    const documentos = await perfilRef.collection("documentosAula").get();
    for (const documento of documentos.docs) await apagarPartesDoDocumento(documento.ref);
    for (const sub of ["palavras", "anotacoes", "mensagens", "notificacoes", "documentosAula", "salaDeAula"]) {
      await apagarSubcolecao(perfilRef.collection(sub));
    }
  }

  await perfilRef.delete();
  await user.delete();
  window.location.href = "index.html";
}

// Fluxo de exclusão usado pelos botões "Excluir minha conta" (aluno e professor)
async function confirmarExclusaoDaConta(statusId) {
  const statusEl = document.getElementById(statusId);
  if (!(await confirmar("Excluir sua conta de vez? Seus dados serão apagados e isso não pode ser desfeito.\n\nVamos pedir para você confirmar a sua conta (pelo Google ou com a sua senha).", { botao: "Excluir minha conta", perigo: true }))) return;
  statusEl.textContent = "Excluindo...";
  try {
    await excluirMinhaConta();
  } catch (erro) {
    console.error(erro);
    statusEl.textContent = traduzErro(erro);
  }
}

function redirecionarPorTipo(tipo) {
  redirecionando = true;
  if (tipo === "professor") {
    window.location.href = "professor.html";
  } else {
    window.location.href = "dicionario.html";
  }
}

function sair() {
  auth.signOut().then(() => (window.location.href = "index.html"));
}

// Traduz os erros mais comuns do Firebase para português simples
function traduzErro(erro) {
  const codigo = erro.code || "";
  const mapa = {
    "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
    "auth/requires-recent-login": "Por segurança, saia e entre de novo antes de fazer isso.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada antes de terminar. Tente de novo.",
    "auth/cancelled-popup-request": "A janela do Google foi fechada antes de terminar. Tente de novo.",
    "auth/popup-blocked": "O navegador bloqueou a janela do Google. Permita pop-ups para este site e tente de novo.",
    "auth/unauthorized-domain": "Este endereço ainda não está autorizado para entrar com Google (Firebase → Authentication → Configurações → Domínios autorizados).",
    "auth/operation-not-allowed": "Essa forma de login ainda não foi ativada no Firebase (Authentication → Método de login → Google e E-mail/senha).",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Use a aba \"Entrar\" (com a senha, ou com o Google se for um Gmail).",
    "auth/invalid-email": "Esse e-mail não parece válido. Confira se digitou certo.",
    "auth/weak-password": "Senha fraca: use pelo menos 6 caracteres.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-login-credentials": "E-mail ou senha incorretos.",
    "auth/missing-password": "Digite sua senha.",
    "auth/account-exists-with-different-credential": "Esse e-mail tinha uma conta antiga com senha no Idiomex. Fale com o suporte para passar a conta para o Google.",
    "auth/user-mismatch": "Escolha a mesma conta Google com que você entrou.",
    "permission-denied": "O servidor recusou a gravação. Se você administra o Idiomex, confira se as regras do Firestore (arquivo firestore.rules) estão publicadas no Firebase."
  };
  return mapa[codigo] || erro.message || "Ocorreu um erro. Tente novamente.";
}

// Protege páginas: redireciona para login se não houver usuário logado
function exigirLogin(tipoEsperado) {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const doc = await db.collection("usuarios").doc(user.uid).get();
    if (!doc.exists || (tipoEsperado && doc.data().tipo !== tipoEsperado)) {
      window.location.href = "index.html";
    }
  });
}
