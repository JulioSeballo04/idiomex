// ============================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================
// 1. Vá em https://console.firebase.google.com
// 2. Crie um projeto novo (plano Spark / gratuito)
// 3. Adicione um "App da Web" dentro do projeto
// 4. Copie as credenciais que aparecerem e cole abaixo
// 5. Ative "Authentication" -> método "E-mail/senha"
// 6. Ative "Firestore Database" -> modo produção
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCRXSlpf1GTj3VirFel8SOdNwXuniG6el8",
  authDomain: "novo-dicionario.firebaseapp.com",
  projectId: "novo-dicionario",
  storageBucket: "novo-dicionario.firebasestorage.app",
  messagingSenderId: "805619827743",
  appId: "1:805619827743:web:0ce1cc1107445a4e6d012a"
};

// Inicializa Firebase (usando SDK modular via CDN, ver index.html)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Endereço da sua function no Vercel que gera as frases de exemplo.
// Depois de fazer o deploy no Vercel, troque pela URL real, ex:
// "https://meu-dicionario.vercel.app/api/gerar-frase"
const AI_ENDPOINT = "https://meu-dicionario.vercel.app/api/gerar-frase";
