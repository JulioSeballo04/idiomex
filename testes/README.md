# Testes automáticos do Idiomex

Três conjuntos de testes, todos rodando **no seu computador, sem tocar no
Firebase de verdade**: o login e o banco de dados são emulados, e a IA é
simulada.

| Comando | O que testa |
|---|---|
| `npm run test:regras` | Regras de segurança do Firestore (`firestore.rules`): quem pode ler e gravar o quê |
| `npm run test:e2e` | O app no navegador: cadastro, vocabulário, quiz, recados, agenda, exclusão de conta, tela de celular |
| `npm run test:ia` | O servidor da IA (`api/gerar-frase.js`): login obrigatório, idiomas, limite de pedidos |
| `npm test` | Regras + navegador |

## Como rodar

Precisa de **Node.js 20+** e **Java 11+** (o emulador do Firebase usa Java).

```bash
cd testes
npm install
npx playwright install chromium   # só na primeira vez: baixa o navegador dos testes
npm test
```

Rode antes de publicar mudanças: se algum teste ficar com ✘, alguma coisa
que funcionava parou de funcionar.
