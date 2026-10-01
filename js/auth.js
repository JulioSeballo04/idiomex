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

// -------------------- CADASTRO --------------------
async function cadastrar(nome, email, senha, tipo, codigoProfessor, idiomas) {
  const statusEl = document.getElementById("status-cadastro");

  // Valida antes de criar a conta no Auth, pra um erro aqui não deixar conta órfã
  if (tipo === "professor" && (!Array.isArray(idiomas) || idiomas.length === 0)) {
    statusEl.textContent = "Escolha pelo menos um idioma que você ensina.";
    return;
  }
  statusEl.textContent = "Criando conta...";

  try {
    // 1. Cria usuário no Firebase Auth
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    const uid = cred.user.uid;

    const dadosUsuario = {
      nome,
      email,
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
      if (!codigo) {
        throw new Error("Informe o código do professor para vincular sua conta.");
      }
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

    // Manda o e-mail de confirmação do endereço. Não bloqueia o acesso: um e-mail
    // que não chega não pode impedir o aluno de usar o app.
    cred.user.sendEmailVerification().catch((e) => console.warn("Falha ao enviar a confirmação de e-mail:", e));

    statusEl.textContent = "Conta criada! Redirecionando...";
    redirecionarPorTipo(tipo);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
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
    }
  }
  throw new Error("Não foi possível gerar seu código de professor. Tente novamente.");
}

// -------------------- LOGIN --------------------
async function entrar(email, senha) {
  const statusEl = document.getElementById("status-login");
  statusEl.textContent = "Entrando...";

  try {
    const cred = await auth.signInWithEmailAndPassword(email, senha);
    const uid = cred.user.uid;

    const doc = await db.collection("usuarios").doc(uid).get();
    if (!doc.exists) {
      throw new Error("Perfil não encontrado. Fale com o suporte.");
    }
    redirecionarPorTipo(doc.data().tipo);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
  }
}

// -------------------- ESQUECI MINHA SENHA --------------------
async function recuperarSenha(email) {
  const statusEl = document.getElementById("status-login");
  email = (email || "").trim();
  if (!email) {
    statusEl.textContent = "Digite seu e-mail acima e clique em \"Esqueci minha senha\" de novo.";
    return;
  }
  statusEl.textContent = "Enviando...";
  try {
    await auth.sendPasswordResetEmail(email);
    statusEl.textContent = "Se existir uma conta com esse e-mail, você vai receber um link para criar uma nova senha.";
  } catch (erro) {
    // "Conta não encontrada" recebe a mesma resposta, pra não revelar quais e-mails têm conta
    statusEl.textContent = erro.code === "auth/user-not-found"
      ? "Se existir uma conta com esse e-mail, você vai receber um link para criar uma nova senha."
      : traduzErro(erro);
  }
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

// Exclui a conta logada e os dados dela. Pede a senha de novo porque o Firebase
// só deixa excluir a conta logo depois de um login recente.
async function excluirMinhaConta(senha) {
  const user = auth.currentUser;
  if (!user) return;
  const credencial = firebase.auth.EmailAuthProvider.credential(user.email, senha);
  await user.reauthenticateWithCredential(credencial);

  const perfilRef = db.collection("usuarios").doc(user.uid);
  const perfil = (await perfilRef.get()).data() || {};

  if (perfil.tipo === "professor") {
    // Desvincula os alunos (eles mantêm a conta e podem entrar com o código de outro professor)
    const alunos = await db.collection("usuarios")
      .where("tipo", "==", "aluno").where("professorId", "==", user.uid).get();
    for (const aluno of alunos.docs) {
      await aluno.ref.update({ professorId: firebase.firestore.FieldValue.delete() });
    }
    for (const sub of ["anotacoesAgenda", "agendaOverrides", "configuracaoAgenda", "visualizacoes"]) {
      await apagarSubcolecao(perfilRef.collection(sub));
    }
    if (perfil.codigoProfessor) {
      await db.collection("codigosProfessor").doc(perfil.codigoProfessor).delete().catch(() => {});
    }
  } else {
    // Cancela as aulas futuras, pra o horário voltar a ficar livre na agenda do professor
    const hoje = new Date().toISOString().slice(0, 10);
    const aulas = await db.collection("aulas").where("alunoId", "==", user.uid).get();
    for (const aula of aulas.docs) {
      const dados = aula.data();
      if (dados.status === "agendada" && dados.data >= hoje) {
        await aula.ref.update({ status: "cancelada", canceladoPor: "aluno" });
      }
    }
    for (const sub of ["palavras", "anotacoes", "mensagens"]) {
      await apagarSubcolecao(perfilRef.collection(sub));
    }
  }

  await perfilRef.delete();
  await user.delete();
  window.location.href = "index.html";
}

// Fluxo de exclusão usado pelos botões "Excluir minha conta" (aluno e professor)
async function confirmarExclusaoDaConta(campoSenhaId, statusId) {
  const statusEl = document.getElementById(statusId);
  const senha = document.getElementById(campoSenhaId).value;
  if (!senha) {
    statusEl.textContent = "Digite sua senha para confirmar.";
    return;
  }
  if (!confirm("Excluir sua conta de vez? Seus dados serão apagados e isso não pode ser desfeito.")) return;
  statusEl.textContent = "Excluindo...";
  try {
    await excluirMinhaConta(senha);
  } catch (erro) {
    console.error(erro);
    statusEl.textContent = traduzErro(erro);
  }
}

function redirecionarPorTipo(tipo) {
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
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/user-not-found": "Não existe conta com esse e-mail.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-login-credentials": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
    "auth/requires-recent-login": "Por segurança, saia e entre de novo antes de fazer isso.",
    "permission-denied": "Você não tem permissão para fazer isso."
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
