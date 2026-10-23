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

// -------------------- GOOGLE --------------------
// O Idiomex entra só com o Google: assim o e-mail da conta é comprovadamente da pessoa
// (com e-mail e senha, qualquer um podia criar conta com o e-mail de outro). Quem tinha
// conta antiga com e-mail e senha num Gmail entra com o Google desse mesmo Gmail: o
// Firebase junta as duas formas de login na mesma conta, com os mesmos dados.

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
async function cadastrar(nome, tipo, codigoProfessor, idiomas) {
  const statusEl = document.getElementById("status-cadastro");

  // Valida antes de abrir o Google, pra um erro aqui não deixar conta sem perfil
  if (tipo === "professor" && (!Array.isArray(idiomas) || idiomas.length === 0)) {
    statusEl.textContent = "Escolha pelo menos um idioma que você ensina.";
    return;
  }
  if (tipo === "aluno" && !normalizarCodigo(codigoProfessor)) {
    statusEl.textContent = "Informe o código do professor para vincular sua conta.";
    return;
  }

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
      await salvarPerfilDeProfessor(uid, dadosUsuario);
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
      // 2. Salva o perfil no Firestore
      await db.collection("usuarios").doc(uid).set(dadosUsuario);
    }

    statusEl.textContent = "Conta criada! Redirecionando...";
    redirecionarPorTipo(tipo);
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

// Exclui a conta logada e os dados dela. Confirma a identidade de novo pelo Google,
// porque o Firebase só deixa excluir a conta logo depois de um login recente.
async function excluirMinhaConta() {
  const user = auth.currentUser;
  if (!user) return;
  await user.reauthenticateWithPopup(provedorGoogle());

  const perfilRef = db.collection("usuarios").doc(user.uid);
  const perfil = (await perfilRef.get()).data() || {};

  if (perfil.tipo === "professor") {
    // Desvincula os alunos (eles mantêm a conta e podem entrar com o código de outro professor)
    const alunos = await db.collection("usuarios")
      .where("tipo", "==", "aluno").where("professorId", "==", user.uid).get();
    for (const aluno of alunos.docs) {
      await aluno.ref.update({ professorId: firebase.firestore.FieldValue.delete() });
    }
    for (const sub of ["anotacoesAgenda", "agendaOverrides", "configuracaoAgenda", "visualizacoes", "alunosSemApp"]) {
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
  if (!confirm("Excluir sua conta de vez? Seus dados serão apagados e isso não pode ser desfeito.\n\nO Google vai pedir para confirmar a sua conta.")) return;
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
    "auth/operation-not-allowed": "O login com Google ainda não foi ativado no Firebase (Authentication → Método de login → Google).",
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
