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

// -------------------- CADASTRO --------------------
async function cadastrar(nome, email, senha, tipo, codigoProfessor) {
  const statusEl = document.getElementById("status-cadastro");
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
      dadosUsuario.codigoProfessor = gerarCodigoProfessor();
    }

    if (tipo === "aluno") {
      if (!codigoProfessor || codigoProfessor.trim() === "") {
        throw new Error("Informe o código do professor para vincular sua conta.");
      }
      // Verifica se o código pertence a um professor de verdade
      const professorSnap = await db
        .collection("usuarios")
        .where("tipo", "==", "professor")
        .where("codigoProfessor", "==", codigoProfessor.trim().toUpperCase())
        .limit(1)
        .get();

      if (professorSnap.empty) {
        throw new Error("Código de professor inválido. Confira com seu professor.");
      }

      dadosUsuario.professorId = professorSnap.docs[0].id;
    }

    // 2. Salva o perfil no Firestore
    await db.collection("usuarios").doc(uid).set(dadosUsuario);

    statusEl.textContent = "Conta criada! Redirecionando...";
    redirecionarPorTipo(tipo);
  } catch (erro) {
    statusEl.textContent = traduzErro(erro);
  }
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
    "auth/user-not-found": "Não existe conta com esse e-mail."
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
