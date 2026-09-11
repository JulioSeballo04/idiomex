# Meu Dicionário

App de vocabulário de inglês com contas de **professor** e **aluno**.
O aluno adiciona palavras aprendidas, recebe tradução e uma frase de
exemplo gerada por IA. O professor acompanha o vocabulário de cada
aluno vinculado e pode deixar recados/dicas de estudo.

**Custo: R$ 0,00.** Firebase no plano Spark (grátis, sem cartão) +
Vercel no plano Hobby (grátis, sem cartão) + Gemini API (camada
gratuita, sem cartão).

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com e crie um projeto novo.
2. Dentro do projeto, clique no ícone `</>` para adicionar um "App da Web".
3. Copie o objeto `firebaseConfig` que aparecer.
4. Cole esses valores no arquivo `js/firebase-config.js` (substitua os campos `SEU_...`).
5. No menu lateral, vá em **Build > Authentication** → aba "Sign-in method" → ative **E-mail/senha**.
6. Vá em **Build > Firestore Database** → "Criar banco de dados" → modo produção → escolha uma região (ex: `southamerica-east1`, mais perto do Brasil).

## Passo 2 — Aplicar as regras de segurança

1. Ainda no Firestore, vá na aba **Regras**.
2. Copie todo o conteúdo do arquivo `firestore.rules` deste projeto e cole lá.
3. Clique em **Publicar**.

Isso garante que um aluno só vê os próprios dados, e um professor só
vê os alunos vinculados a ele pelo código.

## Passo 3 — Criar a chave gratuita da IA (Gemini)

1. Acesse https://aistudio.google.com/app/apikey
2. Clique em "Create API key" (não pede cartão de crédito).
3. Guarde essa chave — ela vai para a Vercel, **nunca** para o código do site.

## Passo 4 — Publicar a function no Vercel (protege a chave da IA)

1. Crie uma conta grátis em https://vercel.com (dá para entrar com GitHub).
2. Suba esta pasta do projeto para um repositório no GitHub.
3. No painel da Vercel, clique em "Add New > Project" e importe esse repositório.
4. Antes de finalizar o deploy, vá em **Environment Variables** e adicione:
   - Nome: `GEMINI_API_KEY`
   - Valor: a chave que você criou no Passo 3
5. Clique em **Deploy**.
6. Quando terminar, copie a URL do projeto (ex: `https://meu-dicionario.vercel.app`).
7. No arquivo `js/firebase-config.js`, atualize a constante `AI_ENDPOINT` para:
   `https://meu-dicionario.vercel.app/api/gerar-frase`

## Passo 5 — Publicar o site (Firebase Hosting)

Também gratuito, sem cartão, dentro do plano Spark.

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # escolha "usar pasta atual" como public
firebase deploy
```

## Como o vínculo professor-aluno funciona

- Ao criar conta como **professor**, o sistema gera automaticamente um
  código único (ex: `PROF-8X2K`), visível no painel dele.
- Ao criar conta como **aluno**, é preciso digitar esse código — isso
  grava `professorId` no perfil do aluno.
- As regras do Firestore (`firestore.rules`) usam esse campo para
  liberar a leitura do vocabulário do aluno e das mensagens apenas
  para o professor vinculado.

## Estrutura de dados (Firestore)

```
usuarios/{uid}
  nome, email, tipo ("professor" | "aluno")
  codigoProfessor        -> só em professores
  professorId            -> só em alunos, aponta para o uid do professor

usuarios/{uid}/palavras/{id}
  palavraEn, traducaoPt, fraseExemplo, criadoEm

usuarios/{uid}/mensagens/{id}
  texto, criadoEm         -> escrito pelo professor, lido pelo aluno
```

## Por que a IA não fica direto no site?

Se a chave da IA ficasse no JavaScript do navegador, qualquer pessoa
poderia abrir o código-fonte da página e copiá-la — foi exatamente o
problema da versão anterior deste projeto, que usava uma "senha" para
tentar esconder isso. Agora a chamada para a IA acontece dentro da
function do Vercel (`api/gerar-frase.js`), que roda no servidor: o
navegador nunca vê a chave, só o resultado (a frase pronta).
