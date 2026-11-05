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
  pdf: { nome: "PDF", plural: "PDFs", icone: "📄" },
  imagem: { nome: "Imagem", plural: "Imagens", icone: "🖼️" },
  video: { nome: "Vídeo", plural: "Vídeos", icone: "🎬" },
  audio: { nome: "Áudio", plural: "Áudios", icone: "🎧" },
  texto: { nome: "Texto", plural: "Textos", icone: "📝" },
  link: { nome: "Link", plural: "Links", icone: "🔗" },
  outro: { nome: "Outro", plural: "Outros", icone: "📎" }
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
        <button type="button" class="btn-fechar-modal" title="Fechar" onclick="fecharVisualizador()">✕</button>
      </div>
      <div id="corpo-visualizador" class="corpo-visualizador"></div>
      <div id="rodape-visualizador" class="rodape-visualizador"></div>
    </div>`;
  // Sem "Salvar vídeo/imagem como..." no clique direito
  modal.addEventListener("contextmenu", (e) => e.preventDefault());
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharVisualizador(); });
  document.body.appendChild(modal);
  return modal;
}

function fecharVisualizador() {
  const modal = document.getElementById("modal-visualizador");
  if (!modal) return;
  modal.classList.add("modal-oculto");
  // Para o vídeo/áudio e libera a memória do arquivo
  document.getElementById("corpo-visualizador").innerHTML = "";
  document.getElementById("rodape-visualizador").innerHTML = "";
  if (urlDoVisualizador) { URL.revokeObjectURL(urlDoVisualizador); urlDoVisualizador = null; }
}

// Mostra o arquivo de um documento. docRef: o documento no Firestore (com as
// "partes"); documento: {titulo, nomeArquivo, tipoArquivo, tamanho, partes}.
// permitirBaixar: só o professor (dono do arquivo) ganha o botão de baixar.
async function abrirVisualizador(docRef, documento, permitirBaixar) {
  const modal = garantirModalVisualizador();
  fecharVisualizador();
  const categoria = categoriaDoArquivo(documento.tipoArquivo, documento.nomeArquivo);
  document.getElementById("titulo-visualizador").textContent = documento.titulo || documento.nomeArquivo || "Documento";
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

  if (permitirBaixar) {
    document.getElementById("rodape-visualizador").innerHTML =
      `<a class="btn btn-secundario btn-mini" href="${urlDoVisualizador}" download="${escapeHtml(documento.nomeArquivo || "arquivo")}">Baixar (só você vê este botão)</a>`;
  }

  if (categoria === "video") {
    corpo.innerHTML = `<video class="player-documento" controls controlsList="nodownload noremoteplayback" disablePictureInPicture playsinline preload="metadata"></video>`;
    corpo.querySelector("video").src = urlDoVisualizador;
  } else if (categoria === "audio") {
    corpo.innerHTML = `<div class="player-audio"><span class="icone-audio">🎧</span><audio class="player-documento" controls controlsList="nodownload" preload="metadata"></audio></div>`;
    corpo.querySelector("audio").src = urlDoVisualizador;
  } else if (categoria === "imagem") {
    corpo.innerHTML = `<img class="imagem-documento" alt="" draggable="false">`;
    corpo.querySelector("img").src = urlDoVisualizador;
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
      canvas.style.width = `${largura}px`;
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
    ${Object.keys(CATEGORIAS_ARQUIVO).filter((c) => contagem[c]).map((c) => chip(c, `${CATEGORIAS_ARQUIVO[c].icone} ${CATEGORIAS_ARQUIVO[c].plural}`, contagem[c])).join("")}
  </div>`;
}

// Filtra por tipo e por texto (título ou nome do arquivo, sem ligar para acentos)
function filtrarDocumentos(documentos, tipo, busca) {
  const termo = semAcentos(busca).trim();
  return documentos.filter((d) =>
    (!tipo || categoriaDoDocumento(d) === tipo) &&
    (!termo || semAcentos(`${d.titulo} ${d.nomeArquivo || ""}`).includes(termo)));
}
