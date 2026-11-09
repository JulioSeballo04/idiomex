// ============================================================
// DOCUMENTOS — tipos de arquivo, envio em pedaços e o visualizador
// ============================================================
// Usado pelo professor (Documentos de aula, Banco de dados, sala de cada aluno) e
// pelo aluno (Sala de aula). Os arquivos ficam no Firestore em pedaços (veja
// util.js); o visualizador junta os pedaços e mostra o arquivo dentro do app —
// vídeo e áudio num player, imagem, PDF desenhado página por página e texto —
// sem botão de baixar para o aluno.
//
// Bloquear o download dentro do app (sem botão, sem "Salvar como" no menu do
// clique direito, sem o leitor de PDF do navegador) desestimula, mas não impede
// quem estiver decidido: o arquivo precisa chegar ao aparelho para ser exibido, e
// sempre dá para gravar a tela.
// ============================================================

const CATEGORIAS_ARQUIVO = {
  pdf: { nome: "PDF", plural: "PDFs", icone: "file-text" },
  imagem: { nome: "Imagem", plural: "Imagens", icone: "image" },
  video: { nome: "Vídeo", plural: "Vídeos", icone: "clapperboard" },
  audio: { nome: "Áudio", plural: "Áudios", icone: "headphones" },
  texto: { nome: "Texto", plural: "Textos", icone: "notebook-pen" },
  link: { nome: "Link", plural: "Links", icone: "link" },
  outro: { nome: "Outro", plural: "Outros", icone: "paperclip" }
};

// Categoria de um arquivo pelo tipo (MIME) e, sem ele, pela extensão do nome
function categoriaDoArquivo(tipo, nome) {
  const t = String(tipo || "").toLowerCase();
  const ext = (String(nome || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (t === "application/pdf" || ext === "pdf") return "pdf";
  if (t.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "imagem";
  if (t.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (t.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "aac", "oga", "opus"].includes(ext)) return "audio";
  if (t === "text/plain" || ext === "txt") return "texto";
  return "outro";
}

// Categoria de um documento da lista: link (Drive, YouTube...) ou a do arquivo
function categoriaDoDocumento(d) {
  return d.url ? "link" : categoriaDoArquivo(d.tipoArquivo, d.nomeArquivo);
}

// Documentos de aula aceitam só o que o aluno consegue ver dentro do app
function arquivoVisualizavel(tipo, nome) {
  return categoriaDoArquivo(tipo, nome) !== "outro";
}

// Grava o arquivo em pedaços em docRef/partes/{n}. Devolve quantos pedaços gravou.
// aoProgresso(0–100) é chamado antes de cada pedaço.
async function enviarPartesDoArquivo(docRef, arquivo, aoProgresso) {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const partes = Math.max(1, Math.ceil(bytes.length / TAMANHO_PARTE_ARQUIVO));
  for (let i = 0; i < partes; i++) {
    if (aoProgresso) aoProgresso(Math.round((i / partes) * 100));
    const pedaco = bytes.slice(i * TAMANHO_PARTE_ARQUIVO, (i + 1) * TAMANHO_PARTE_ARQUIVO);
    await docRef.collection("partes").doc(String(i)).set({ dados: firebase.firestore.Blob.fromUint8Array(pedaco), indice: i });
  }
  return partes;
}

// Junta os pedaços de volta num arquivo (Blob)
async function juntarPartesDoArquivo(docRef, documento) {
  const snap = await docRef.collection("partes").orderBy("indice").get();
  if (snap.size !== documento.partes) throw new Error("arquivo incompleto");
  return new Blob(snap.docs.map((d) => d.data().dados.toUint8Array()),
    { type: documento.tipoArquivo || "application/octet-stream" });
}

// -------------------- VISUALIZADOR --------------------

let urlDoVisualizador = null;
let blobDoVisualizador = null;     // o arquivo aberto (a janela flutuante usa o dela)
let tituloDoVisualizador = "";
let zoomVisualizador = 1;          // 1 = do tamanho da janela
const NIVEIS_ZOOM = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function garantirModalVisualizador() {
  let modal = document.getElementById("modal-visualizador");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "modal-visualizador";
  modal.className = "modal-oculto";
  modal.innerHTML = `
    <div class="modal-conteudo modal-visualizador">
      <div class="modal-cabecalho">
        <h3 id="titulo-visualizador"></h3>
        <button type="button" class="btn-fechar-modal" title="Fechar" aria-label="Fechar" onclick="fecharVisualizador()">${icone("x")}</button>
      </div>
      <div id="ferramentas-visualizador" class="ferramentas-visualizador"></div>
      <div class="area-visualizador">
        <div id="corpo-visualizador" class="corpo-visualizador"></div>
        <aside id="painel-palavra-visualizador" class="painel-palavra-visualizador" hidden aria-label="Nova palavra"></aside>
      </div>
      <div id="rodape-visualizador" class="rodape-visualizador"></div>
    </div>`;
  // Sem "Salvar vídeo/imagem como..." no clique direito
  modal.addEventListener("contextmenu", (e) => e.preventDefault());
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharVisualizador(); });
  // Ctrl + rodinha do mouse (ou o gesto de pinça do touchpad) aproxima e afasta
  const corpo = modal.querySelector("#corpo-visualizador");
  corpo.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !temZoom(corpo.dataset.categoria)) return;
    e.preventDefault();
    mudarZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  arrastarParaMover(corpo);
  document.body.appendChild(modal);
  return modal;
}

// Com zoom, arrastar a imagem (ou o PDF) com o mouse move a parte que aparece
function arrastarParaMover(area) {
  let inicio = null;
  area.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || zoomVisualizador <= 1 || !temZoom(area.dataset.categoria)) return;
    inicio = { x: e.clientX, y: e.clientY, left: area.scrollLeft, top: area.scrollTop };
    area.classList.add("arrastando");
  });
  window.addEventListener("pointermove", (e) => {
    if (!inicio) return;
    area.scrollLeft = inicio.left - (e.clientX - inicio.x);
    area.scrollTop = inicio.top - (e.clientY - inicio.y);
  });
  window.addEventListener("pointerup", () => { inicio = null; area.classList.remove("arrastando"); });
}

function temZoom(categoria) {
  return ["imagem", "pdf", "texto"].includes(categoria);
}

// Barra acima do arquivo: zoom (imagem, PDF, texto) e janela flutuante (imagem, vídeo)
function montarFerramentas(categoria) {
  const zoom = temZoom(categoria) ? `
    <div class="grupo-ferramentas" role="group" aria-label="Zoom">
      <button type="button" class="btn-ferramenta" id="btn-zoom-menos" title="Diminuir" aria-label="Diminuir" onclick="mudarZoom(-1)">−</button>
      <button type="button" class="btn-ferramenta valor-zoom" id="valor-zoom" title="Voltar ao tamanho da janela" onclick="definirZoom(1)">100%</button>
      <button type="button" class="btn-ferramenta" id="btn-zoom-mais" title="Aumentar" aria-label="Aumentar" onclick="mudarZoom(1)">+</button>
    </div>` : "";
  const flutuante = categoria === "imagem" || (categoria === "video" && document.pictureInPictureEnabled)
    ? `<button type="button" class="btn-ferramenta btn-flutuante" onclick="abrirJanelaFlutuante()" title="Abrir numa janela pequena por cima das outras, para continuar usando o app">⧉ Janela flutuante</button>` : "";
  // Na tela do aluno: anotar palavras novas sem fechar o documento
  const palavra = podeAnotarPalavras()
    ? `<button type="button" class="btn-ferramenta btn-nova-palavra-visualizador" id="btn-nova-palavra-visualizador" onclick="alternarPainelPalavra()" title="Abrir, ao lado do documento, uma janela para adicionar palavras novas">＋ Nova palavra</button>` : "";
  return zoom + flutuante + palavra;
}

// -------------------- NOVA PALAVRA AO LADO DO DOCUMENTO --------------------
// O aluno lê o material (ex: a foto de uma página do livro) e, numa janela ao
// lado, já adiciona as palavras novas ao vocabulário — usa o mesmo cadastro do
// Início (adicionarPalavra, em dicionario.js), com tradução e frases da IA.

function podeAnotarPalavras() {
  return typeof adicionarPalavra === "function" && !!document.getElementById("input-palavra-en");
}

let palavrasDoPainel = []; // as adicionadas por este painel desde que ele abriu

function alternarPainelPalavra(abrir) {
  const painel = document.getElementById("painel-palavra-visualizador");
  const mostrar = abrir === undefined ? painel.hidden : abrir;
  painel.hidden = !mostrar;
  document.querySelector("#modal-visualizador .modal-visualizador").classList.toggle("com-painel", mostrar);
  const botao = document.getElementById("btn-nova-palavra-visualizador");
  if (botao) botao.classList.toggle("ativa", mostrar);
  if (mostrar && !painel.innerHTML) {
    palavrasDoPainel = [];
    painel.innerHTML = `
      <div class="cabecalho-painel-palavra">
        <h4>Nova palavra</h4>
        <button type="button" class="btn-fechar-modal" title="Fechar a janela de palavras" aria-label="Fechar a janela de palavras" onclick="alternarPainelPalavra(false)">${icone("x")}</button>
      </div>
      <form onsubmit="event.preventDefault(); adicionarPalavraDoPainel();">
        <input type="text" id="painel-palavra-en" placeholder="${escapeHtml(document.getElementById("input-palavra-en").placeholder)}" autocomplete="off">
        <input type="text" id="painel-palavra-pt" placeholder="${escapeHtml(document.getElementById("input-palavra-pt").placeholder)}" autocomplete="off">
        <textarea id="painel-palavra-nota" placeholder="Anotação (opcional)"></textarea>
        <button type="submit" class="btn btn-primario" id="btn-painel-palavra">Adicionar</button>
      </form>
      <p class="status-msg" id="status-painel-palavra"></p>
      <div id="lista-painel-palavra"></div>`;
  }
  if (mostrar) document.getElementById("painel-palavra-en").focus();
  definirZoom(zoomVisualizador); // a área do documento mudou de largura
}

async function adicionarPalavraDoPainel() {
  const campo = (id) => document.getElementById(id);
  const status = campo("status-painel-palavra");
  const palavra = campo("painel-palavra-en").value.trim();
  const traducao = campo("painel-palavra-pt").value.trim();
  const nota = campo("painel-palavra-nota").value.trim();
  if (!palavra || !traducao) { status.textContent = "Escreva a palavra e a tradução."; return; }
  const existe = () => palavrasDoIdiomaAtual().some((p) => p.palavraEn.trim().toLowerCase() === palavra.toLowerCase());
  if (existe()) { status.textContent = `"${palavra}" já está no seu vocabulário.`; return; }
  campo("btn-painel-palavra").disabled = true;
  status.textContent = "Salvando...";
  await adicionarPalavra(palavra, traducao, nota);
  if (!document.getElementById("painel-palavra-en")) return; // fechou o visualizador
  campo("btn-painel-palavra").disabled = false;
  if (!existe()) {
    status.textContent = (document.getElementById("status-palavra") || {}).textContent || "Não foi possível salvar a palavra. Tente de novo.";
    return;
  }
  campo("painel-palavra-en").value = "";
  campo("painel-palavra-pt").value = "";
  campo("painel-palavra-nota").value = "";
  status.textContent = `"${palavra}" adicionada ao seu vocabulário.`;
  palavrasDoPainel.unshift({ palavra, traducao });
  campo("lista-painel-palavra").innerHTML = `
    <p class="rotulo-painel-palavra">Adicionadas agora</p>
    <div class="chips-palavras">${palavrasDoPainel.map((p) => `<span class="chip-palavra"><strong>${escapeHtml(p.palavra)}</strong><span>${escapeHtml(p.traducao)}</span></span>`).join("")}</div>`;
  campo("painel-palavra-en").focus();
}

function mudarZoom(direcao) {
  const atual = NIVEIS_ZOOM.findIndex((n) => n >= zoomVisualizador - 0.001);
  const indice = Math.min(NIVEIS_ZOOM.length - 1, Math.max(0, (atual < 0 ? 2 : atual) + direcao));
  definirZoom(NIVEIS_ZOOM[indice]);
}

// Aplica o zoom: 1 = o arquivo cabe na janela; 2 = o dobro disso, e assim por diante
function definirZoom(nivel) {
  zoomVisualizador = nivel;
  const corpo = document.getElementById("corpo-visualizador");
  if (!corpo) return;
  const categoria = corpo.dataset.categoria;
  const valor = document.getElementById("valor-zoom");
  if (valor) valor.textContent = `${Math.round(nivel * 100)}%`;
  const menos = document.getElementById("btn-zoom-menos");
  const mais = document.getElementById("btn-zoom-mais");
  if (menos) menos.disabled = nivel <= NIVEIS_ZOOM[0];
  if (mais) mais.disabled = nivel >= NIVEIS_ZOOM[NIVEIS_ZOOM.length - 1];
  corpo.classList.toggle("com-zoom", nivel > 1);
  if (categoria === "imagem") {
    const img = corpo.querySelector("img");
    if (!img || !img.naturalWidth) return;
    const cabe = Math.min(1, (corpo.clientWidth - 8) / img.naturalWidth, (window.innerHeight * 0.68) / img.naturalHeight);
    img.style.width = `${Math.round(img.naturalWidth * cabe * nivel)}px`;
  } else if (categoria === "pdf") {
    corpo.querySelectorAll(".paginas-pdf canvas").forEach((c) => { c.style.width = `${Math.round(Number(c.dataset.largura) * nivel)}px`; });
  } else if (categoria === "texto") {
    const pre = corpo.querySelector("pre");
    if (pre) pre.style.fontSize = `${(0.92 * nivel).toFixed(2)}rem`;
  }
}

// Janela flutuante: a imagem numa janela pequena, por cima das outras, para o aluno
// continuar usando o app (ou outra aba) com ela ao lado. Usa a janela "picture in
// picture" do navegador quando existe (Chrome, Edge); senão, uma janela pop-up.
// O vídeo usa o "picture in picture" do próprio player.
async function abrirJanelaFlutuante() {
  const corpo = document.getElementById("corpo-visualizador");
  if (corpo.dataset.categoria === "video") {
    const video = corpo.querySelector("video");
    try {
      await video.requestPictureInPicture();
      // O vídeo continua tocando na janelinha; a janela do app sai da frente
      document.getElementById("modal-visualizador").classList.add("modal-oculto");
      video.addEventListener("leavepictureinpicture", () => fecharVisualizador(), { once: true });
    } catch (e) {
      console.warn(e);
      avisar("O navegador não deixou abrir o vídeo numa janela flutuante.");
    }
    return;
  }
  if (!blobDoVisualizador) return;
  const largura = 520, altura = 440;
  let janela = null;
  try {
    janela = window.documentPictureInPicture
      ? await window.documentPictureInPicture.requestWindow({ width: largura, height: altura })
      : window.open("", "idiomex-janela-flutuante", `popup,width=${largura},height=${altura}`);
  } catch (e) {
    console.warn(e);
    janela = window.open("", "idiomex-janela-flutuante", `popup,width=${largura},height=${altura}`);
  }
  if (!janela) {
    avisar("O navegador bloqueou a janela flutuante. Permita pop-ups deste site e tente de novo.");
    return;
  }
  montarJanelaFlutuante(janela, URL.createObjectURL(blobDoVisualizador), tituloDoVisualizador);
  fecharVisualizador();
}

// Monta a imagem na janela flutuante (que é uma página em branco do próprio app),
// com zoom e sem "Salvar imagem como..."
function montarJanelaFlutuante(janela, url, titulo) {
  const d = janela.document;
  d.title = titulo || "Idiomex";
  d.head.innerHTML = `<meta charset="UTF-8"><style>
    body { margin: 0; background: #1b1f24; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .barra { position: sticky; top: 0; display: flex; gap: 6px; align-items: center; padding: 6px 8px; background: rgba(27,31,36,.92); }
    .barra button { min-width: 34px; height: 30px; border-radius: 6px; border: 1px solid #555; background: #2a3038; color: #fff; font-size: 15px; cursor: pointer; }
    .barra span { font-size: 13px; opacity: .8; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .area { overflow: auto; height: calc(100vh - 42px); }
    img { display: block; margin: 0 auto; user-select: none; -webkit-user-drag: none; }
  </style>`;
  d.body.innerHTML = `<div class="barra"><button data-z="-1" aria-label="Diminuir">−</button><button data-z="0">100%</button><button data-z="1" aria-label="Aumentar">+</button><span></span></div><div class="area"><img alt="" draggable="false"></div>`;
  d.querySelector(".barra span").textContent = titulo || "";
  const img = d.querySelector("img");
  const area = d.querySelector(".area");
  let nivel = 1;
  const aplicar = () => {
    if (!img.naturalWidth) return;
    const cabe = Math.min(1, (area.clientWidth - 4) / img.naturalWidth, (area.clientHeight - 4) / img.naturalHeight);
    img.style.width = `${Math.round(img.naturalWidth * cabe * nivel)}px`;
    d.querySelector('[data-z="0"]').textContent = `${Math.round(nivel * 100)}%`;
  };
  d.querySelectorAll(".barra button").forEach((b) => b.addEventListener("click", () => {
    const passo = Number(b.dataset.z);
    if (passo === 0) nivel = 1;
    else {
      const i = NIVEIS_ZOOM.findIndex((n) => n >= nivel - 0.001);
      nivel = NIVEIS_ZOOM[Math.min(NIVEIS_ZOOM.length - 1, Math.max(0, i + passo))];
    }
    aplicar();
  }));
  d.addEventListener("contextmenu", (e) => e.preventDefault());
  janela.addEventListener("resize", aplicar);
  janela.addEventListener("pagehide", () => URL.revokeObjectURL(url));
  img.onload = aplicar;
  img.src = url;
}

function fecharVisualizador() {
  const modal = document.getElementById("modal-visualizador");
  if (!modal) return;
  modal.classList.add("modal-oculto");
  // Para o vídeo/áudio e libera a memória do arquivo
  document.getElementById("corpo-visualizador").innerHTML = "";
  document.getElementById("ferramentas-visualizador").innerHTML = "";
  document.getElementById("rodape-visualizador").innerHTML = "";
  const painel = document.getElementById("painel-palavra-visualizador");
  painel.hidden = true;
  painel.innerHTML = "";
  modal.querySelector(".modal-visualizador").classList.remove("com-painel");
  if (urlDoVisualizador) { URL.revokeObjectURL(urlDoVisualizador); urlDoVisualizador = null; }
  blobDoVisualizador = null;
}

// Mostra o arquivo de um documento. docRef: o documento no Firestore (com as
// "partes"); documento: {titulo, nomeArquivo, tipoArquivo, tamanho, partes}.
// permitirBaixar: só o professor (dono do arquivo) ganha o botão de baixar.
async function abrirVisualizador(docRef, documento, permitirBaixar) {
  const modal = garantirModalVisualizador();
  fecharVisualizador();
  const categoria = categoriaDoArquivo(documento.tipoArquivo, documento.nomeArquivo);
  tituloDoVisualizador = documento.titulo || documento.nomeArquivo || "Documento";
  document.getElementById("titulo-visualizador").textContent = tituloDoVisualizador;
  zoomVisualizador = 1;
  const corpo = document.getElementById("corpo-visualizador");
  corpo.dataset.categoria = categoria;
  corpo.innerHTML = `<p class="vazio">Carregando ${CATEGORIAS_ARQUIVO[categoria].nome.toLowerCase()}...</p>`;
  modal.classList.remove("modal-oculto");

  let blob;
  try {
    blob = await juntarPartesDoArquivo(docRef, documento);
  } catch (e) {
    console.error(e);
    corpo.innerHTML = `<p class="vazio">Não foi possível carregar o arquivo agora. Tente novamente.</p>`;
    return;
  }
  if (modal.classList.contains("modal-oculto")) return; // fechou enquanto carregava
  urlDoVisualizador = URL.createObjectURL(blob);
  blobDoVisualizador = blob;
  document.getElementById("ferramentas-visualizador").innerHTML = montarFerramentas(categoria);

  if (permitirBaixar) {
    document.getElementById("rodape-visualizador").innerHTML =
      `<a class="btn btn-secundario btn-mini" href="${urlDoVisualizador}" download="${escapeHtml(documento.nomeArquivo || "arquivo")}">Baixar (só você vê este botão)</a>`;
  }

  if (categoria === "video") {
    corpo.innerHTML = `<video class="player-documento" controls controlsList="nodownload noremoteplayback" playsinline preload="metadata"></video>`;
    corpo.querySelector("video").src = urlDoVisualizador;
  } else if (categoria === "audio") {
    corpo.innerHTML = `<div class="player-audio"><span class="icone-audio">${icone("headphones", "icone-grande")}</span><audio class="player-documento" controls controlsList="nodownload" preload="metadata"></audio></div>`;
    corpo.querySelector("audio").src = urlDoVisualizador;
  } else if (categoria === "imagem") {
    corpo.innerHTML = `<img class="imagem-documento" alt="" draggable="false">`;
    const img = corpo.querySelector("img");
    img.onload = () => definirZoom(zoomVisualizador);
    img.src = urlDoVisualizador;
  } else if (categoria === "texto") {
    const pre = document.createElement("pre");
    pre.className = "texto-documento";
    pre.textContent = await blob.text();
    corpo.innerHTML = "";
    corpo.appendChild(pre);
  } else if (categoria === "pdf") {
    await mostrarPdf(corpo, blob, permitirBaixar);
  } else {
    corpo.innerHTML = permitirBaixar
      ? `<p class="vazio">Este tipo de arquivo não abre dentro do app. Use o botão abaixo para baixar.</p>`
      : `<p class="vazio">Este tipo de arquivo não abre dentro do app. Peça ao professor uma versão em PDF.</p>`;
  }
}

// PDF desenhado página por página (pdf.js), sem o leitor do navegador — que teria
// botão de baixar e de imprimir. A biblioteca só é carregada na primeira vez.
const PDFJS_VERSAO = "3.11.174";
let carregandoPdfJs = null;

function carregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!carregandoPdfJs) {
    carregandoPdfJs = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSAO}/pdf.min.js`;
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSAO}/pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => { carregandoPdfJs = null; reject(new Error("pdf.js não carregou")); };
      document.head.appendChild(script);
    });
  }
  return carregandoPdfJs;
}

const MAXIMO_PAGINAS_PDF = 60;

async function mostrarPdf(corpo, blob, permitirBaixar) {
  try {
    const pdfjs = await carregarPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    corpo.innerHTML = `<div class="paginas-pdf"></div>`;
    const paginas = corpo.querySelector(".paginas-pdf");
    const largura = Math.min(900, (corpo.clientWidth || 600) - 8);
    const total = Math.min(pdf.numPages, MAXIMO_PAGINAS_PDF);
    for (let n = 1; n <= total; n++) {
      if (!corpo.isConnected || !paginas.isConnected) return; // fechou o visualizador
      const pagina = await pdf.getPage(n);
      const escala = largura / pagina.getViewport({ scale: 1 }).width;
      const viewport = pagina.getViewport({ scale: escala * (window.devicePixelRatio || 1) });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${Math.round(largura * zoomVisualizador)}px`;
      canvas.dataset.largura = largura;
      paginas.appendChild(canvas);
      await pagina.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
    if (pdf.numPages > total) {
      paginas.insertAdjacentHTML("beforeend", `<p class="vazio">Mostrando as primeiras ${total} de ${pdf.numPages} páginas.</p>`);
    }
  } catch (e) {
    console.error(e);
    corpo.innerHTML = permitirBaixar
      ? `<p class="vazio">Não foi possível mostrar o PDF aqui. Use o botão abaixo para baixar.</p>`
      : `<p class="vazio">Não foi possível mostrar o PDF agora. Confira sua internet e tente de novo.</p>`;
  }
}

// -------------------- LISTA COM FILTRO POR TIPO --------------------

// Botões de filtro por tipo ("Todos", "PDFs", "Vídeos"...), com a quantidade de cada
// um; só aparecem os tipos que existem na lista. aoFiltrar: código do onclick, com
// "%s" no lugar da categoria escolhida ("" = todos).
function montarFiltroDeTipos(documentos, filtroAtual, aoFiltrar) {
  const contagem = {};
  documentos.forEach((d) => {
    const c = categoriaDoDocumento(d);
    contagem[c] = (contagem[c] || 0) + 1;
  });
  const chip = (cat, rotulo, qtd) => `
    <button type="button" class="chip-idioma${filtroAtual === cat ? " ativo" : ""}" data-tipo="${cat}" onclick="${aoFiltrar.replace("%s", cat)}">
      ${rotulo} <span class="contagem-tipo">${qtd}</span></button>`;
  return `<div class="filtro-tipos-documento" role="tablist">
    ${chip("", "Todos", documentos.length)}
    ${Object.keys(CATEGORIAS_ARQUIVO).filter((c) => contagem[c]).map((c) => chip(c, `${icone(CATEGORIAS_ARQUIVO[c].icone)} ${CATEGORIAS_ARQUIVO[c].plural}`, contagem[c])).join("")}
  </div>`;
}

// Filtra por tipo e por texto (título ou nome do arquivo, sem ligar para acentos)
function filtrarDocumentos(documentos, tipo, busca) {
  const termo = semAcentos(busca).trim();
  return documentos.filter((d) =>
    (!tipo || categoriaDoDocumento(d) === tipo) &&
    (!termo || semAcentos(`${d.titulo} ${d.nomeArquivo || ""}`).includes(termo)));
}
