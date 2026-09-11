// ============================================================
// FUNCTION SERVERLESS (Vercel) — gera a frase de exemplo
// ============================================================
// Esse arquivo roda no servidor da Vercel, nunca no navegador.
// A chave da IA (GEMINI_API_KEY) fica guardada nas variáveis de
// ambiente da Vercel — o usuário do site nunca tem acesso a ela.
//
// Como configurar:
// 1. Crie uma chave gratuita em https://aistudio.google.com/app/apikey
// 2. No painel da Vercel: Project Settings -> Environment Variables
//    -> adicione GEMINI_API_KEY = sua_chave
// 3. Faça o deploy (vercel --prod ou via GitHub)
// ============================================================

// Só esses domínios podem chamar essa function. Ajuste aqui se o projeto do
// Firebase Hosting mudar de nome. Sem essa lista, "*" deixa qualquer site da
// internet usar sua chave e sua cota gratuita do Gemini.
const ORIGENS_PERMITIDAS = [
  "https://novo-dicionario.web.app",
  "https://novo-dicionario.firebaseapp.com"
];

const TAMANHO_MAXIMO_CAMPO = 60; // caracteres — suficiente para qualquer palavra/expressão real

export default async function handler(req, res) {
  const origem = req.headers.origin;
  if (ORIGENS_PERMITIDAS.includes(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido." });
  }

  const { palavra, traducao } = req.body || {};
  if (!palavra || typeof palavra !== "string" || !palavra.trim()) {
    return res.status(400).json({ erro: "Informe a palavra." });
  }
  if (palavra.length > TAMANHO_MAXIMO_CAMPO || (traducao && String(traducao).length > TAMANHO_MAXIMO_CAMPO)) {
    return res.status(400).json({ erro: "Palavra ou tradução muito longa." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: "Chave da IA não configurada no servidor." });
  }

  try {
    const prompt = `Crie exatamente 5 frases curtas e simples em inglês (nível iniciante/intermediário), cada uma usando a palavra "${palavra}"${traducao ? ` (que significa "${traducao}" em português)` : ""}. Para cada frase, forneça também a tradução dela em português. Responda APENAS com as 5 linhas, uma por frase, no formato exato: frase em inglês | tradução em português. Sem numeração, sem aspas, sem explicações extras.`;

    // Tenta o modelo principal; se estiver sobrecarregado (erro 503), tenta um modelo alternativo
    const modelos = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
    let dados, resposta;

    for (const modelo of modelos) {
      resposta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 320 }
          })
        }
      );
      dados = await resposta.json();

      if (resposta.ok) break; // deu certo, para de tentar outros modelos
      if (resposta.status !== 503) break; // erro diferente de sobrecarga, não adianta tentar outro modelo
      console.warn(`Modelo ${modelo} sobrecarregado, tentando o próximo...`);
    }

    if (!resposta.ok) {
      console.error("Erro da API do Gemini:", dados);
      return res.status(200).json({ frases: [], aviso: dados?.error?.message || "Erro ao consultar a IA." });
    }

    const texto = dados?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!texto) {
      return res.status(200).json({ frases: [], aviso: "IA não retornou frases desta vez." });
    }

    // Quebra a resposta em linhas e separa frase/tradução pelo "|"
    const frases = texto
      .split("\n")
      .map((linha) => linha.replace(/^[\s\-•\d.)]+/, "").trim())
      .filter((linha) => linha.length > 0)
      .map((linha) => {
        const partes = linha.split("|");
        return {
          en: (partes[0] || "").replace(/^"|"$/g, "").trim(),
          pt: (partes[1] || "").replace(/^"|"$/g, "").trim()
        };
      })
      .filter((item) => item.en.length > 0)
      .slice(0, 5);

    return res.status(200).json({ frases });
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: "Falha ao gerar frase de exemplo." });
  }
}
