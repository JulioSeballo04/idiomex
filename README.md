# Idiomex

Plataforma de **professores e alunos de idiomas** (inglês, espanhol,
italiano, francês, japonês, mandarim, alemão e coreano), com contas de **professor** e
**aluno**. O professor escolhe o idioma que ensina; os alunos vinculados
pelo código adicionam palavras nesse idioma, recebem a tradução e frases
de exemplo geradas por IA. O professor acompanha o vocabulário de cada
aluno, deixa recados, registra anotações no calendário e gerencia a
agenda de aulas (com confirmação e cancelamento por WhatsApp).

**Custo: R$ 0,00.** Firebase no plano Spark (grátis, sem cartão) +
Vercel no plano Hobby (grátis, sem cartão) + Gemini API (camada
gratuita, sem cartão).

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com e crie um projeto novo.
2. Dentro do projeto, clique no ícone `</>` para adicionar um "App da Web".
3. Copie o objeto `firebaseConfig` que aparecer.
4. Cole esses valores no arquivo `js/firebase-config.js` (substitua os campos `SEU_...`).
5. No menu lateral, vá em **Build > Authentication** → aba "Sign-in method" → ative **Google**
   (contas novas são criadas só com o Google) e mantenha **E-mail/senha** ativo
   (para quem já tinha conta assim continuar entrando).
   Ainda em Authentication → **Settings → Authorized domains**, adicione o endereço
   do site (ex: `idiomex.vercel.app`) — sem isso, a janela do Google não abre.
6. Vá em **Build > Firestore Database** → "Criar banco de dados" → modo produção → escolha uma região (ex: `southamerica-east1`, mais perto do Brasil).

## Passo 2 — Aplicar as regras de segurança

As regras ficam no arquivo `firestore.rules` e são publicadas junto com o
site pelo `firebase deploy` (Passo 5). Se preferir publicar só elas, sem o
site, rode `firebase deploy --only firestore:rules` — ou, no Console do
Firebase, vá em Firestore → **Regras**, cole o conteúdo do arquivo e clique
em **Publicar**.

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
6. A Vercel publica o repositório inteiro: o site abre direto pelo endereço
   da Vercel e já chama a IA no mesmo endereço, sem configurar nada.
7. Se o site também for aberto pelo Firebase Hosting, confira em
   `js/firebase-config.js` se a constante `AI_ENDPOINT_VERCEL` aponta para o
   endereço de produção do projeto na Vercel (Settings → Domains), seguido de
   `/api/gerar-frase`.

## Passo 5 — Publicar o site (Firebase Hosting)

Também gratuito, sem cartão, dentro do plano Spark.

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # escolha "usar pasta atual" como public
firebase deploy
```

## Testes automáticos

A pasta `testes/` tem testes das regras do Firestore, do servidor da IA e do
app no navegador (cadastro, vocabulário, recados, agenda...), todos com o
Firebase emulado. Veja como rodar em [`testes/README.md`](testes/README.md).

## App no celular (PWA)

O Idiomex pode ser instalado como app: no Android (Chrome), toque em
**"Instalar app"** ou no menu ⋮ → **"Adicionar à tela inicial"**; no iPhone
(Safari), toque em **Compartilhar** → **"Adicionar à Tela de Início"**. O
`manifest.webmanifest` define nome, cores e ícones, e o `sw.js` guarda as
telas do site para abrirem mesmo sem internet (os dados continuam vindo
do Firebase).

## Como o vínculo professor-aluno funciona

- Ao criar conta como **professor**, o sistema gera automaticamente um
  código único (ex: `PROF-8X2K`), visível no painel dele, e registra esse
  código na coleção `codigosProfessor`.
- Ao criar conta como **aluno**, é preciso digitar esse código — o app
  procura o professor em `codigosProfessor` e grava `professorId` (e o
  `codigoVinculo` usado) no perfil do aluno. O aluno pode trocar de
  professor depois, em "Meu perfil", digitando o código do novo professor.
- As regras do Firestore (`firestore.rules`) usam esse campo para
  liberar a leitura do vocabulário do aluno e das mensagens apenas
  para o professor vinculado.

## Estrutura de dados (Firestore)

```
usuarios/{uid}
  nome, email, tipo ("professor" | "aluno")
  codigoProfessor        -> só em professores
  professorId            -> só em alunos, aponta para o uid do professor
  codigoVinculo          -> só em alunos, código usado para o vínculo

codigosProfessor/{codigo}
  professorId            -> uid do professor dono do código

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
