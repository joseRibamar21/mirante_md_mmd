/* Mirante — controlador da página. O lado Python chama window.mirante.*; a página responde via
 * window.webkit.messageHandlers.mirante (mensagens JSON: dirty, prefs, theme). */
(function () {
  "use strict";

  const MM = window.MiranteMindmap;
  const APP_BASE = document.baseURI;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const E = {
    doc: $("doc"), docScroll: $("doc-scroll"), stage: $("stage"), canvas: $("canvas"),
    dock: $("dock"), pop: $("popover"), nodeBar: $("node-bar"), toast: $("toast"),
    src: $("src"), scroll: $("ed-scroll"), gutter: $("ed-gutter"), hl: $("ed-hl"), pos: $("ed-pos"), resizer: $("resizer"),
    view: $("view"), editor: $("editor"), hint: $("dock-hint"),
  };
  /* viewer.html?editor=1 → janela separada só com o editor; o texto "de verdade" fica na janela principal */
  const EDITOR_ONLY = new URLSearchParams(location.search).has("editor") || !!window.MIRANTE_EDITOR_ONLY;

  const DEFAULTS = {
    layout: "both", levelGap: 56, siblingGap: 14, cardWidth: 220,
    dir: "", nodeSpacing: 50, rankSpacing: 60, glass: true, editorWidth: 380, autoHideDock: false, renderMode: "auto",
  };
  const MD_ZOOM = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

  const S = {
    kind: null, sub: null, lang: null, path: null, text: "", saved: "", dirty: false,
    prefs: { ...DEFAULTS }, theme: "dark",
    view: { x: 0, y: 0, s: 1 }, bounds: { w: 0, h: 0 }, mdZoom: 1, hasFit: false,
    parsed: null, els: null, selected: null, editing: null,
    history: [], future: [], typing: false, editorOpen: false, seq: 0, popover: null, detached: false,
    block: false, blockSent: "", linked: false, quietBlocks: null, // diagrama de um .md aberto em janela própria
  };

  /* Ponte com a camada nativa: Tauri (Windows e Linux) ou o app GTK antigo. Fora do app, nada. */
  const TAURI = window.__TAURI__ && window.__TAURI__.core;
  const post = (msg) => {
    if (TAURI) { TAURI.invoke("page_message", { msg: JSON.stringify(msg) }).catch(() => {}); return; }
    try { window.webkit.messageHandlers.mirante.postMessage(JSON.stringify(msg)); } catch (_) { /* fora do app */ }
  };
  const IN_APP = !!TAURI || !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mirante);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- idioma ----------------
   * O texto em português é a própria chave: tr("Salvar") devolve "Save" com a interface em inglês, e o
   * que faltar no dicionário aparece em português. {n} e afins são trocados pelos valores. O app
   * injeta MIRANTE_LANG antes do HTML; fora dele vale o idioma do navegador. */
  const EN = {
    "Código": "Code", "Texto": "Text", "Editor de código": "Code editor", "Abrir em janela separada": "Open in a separate window", "Abrir em nova janela": "Open in a new window", "Expandir": "Expand",
    "Mostrar todas as respostas": "Show all answers", "Esconder todas as respostas": "Hide all answers",
    "Mapa mental dos títulos": "Headings mind map", "Gerar material com IA": "Generate material with AI",
    "Gerar material de estudo com IA": "Generate study material with AI", "Copiar prompt": "Copy prompt", "Copiado": "Copied",
    "Copie um prompt, cole no Claude, ChatGPT ou Gemini junto com o seu conteúdo (texto, PDF ou só o assunto) e abra aqui o arquivo que ele devolver.":
      "Copy a prompt, paste it into Claude, ChatGPT or Gemini along with your content (text, PDF or just the topic) and open the file it returns here.",
    "Guia de formato completo": "Full format guide", "Copiar guia": "Copy guide", "Ver no site": "View on the website",
    "Para colar nas instruções de um Projeto do Claude ou nas instruções personalizadas do ChatGPT: tudo o que o Mirante desenha e os limites. Assim todo material já sai pronto.":
      "To paste into a Claude Project's instructions or ChatGPT's custom instructions: everything Mirante renders and its limits, so every answer comes out ready.", "Nota": "Note", "Dica": "Tip", "Importante": "Important",
    "Atenção": "Warning", "Cuidado": "Caution", "Exemplo": "Example", "Pergunta": "Question", "Resumo": "Summary",
    "Certo": "Success", "Citação": "Quote", "Clique num tópico para ir até ele": "Click a topic to jump to it", "Documento": "Document",
    "Afastar": "Zoom out", "Aproximar": "Zoom in", "Mover para a esquerda": "Move left", "Mover para a direita": "Move right",
    "Voltar ao tamanho original": "Reset view", "Fechar (Esc)": "Close (Esc)",
    "Não foi possível atualizar o diagrama no arquivo.": "Could not update the diagram in the file.",
    "Fechar editor (Ctrl+E)": "Close editor (Ctrl+E)", "Arraste para redimensionar": "Drag to resize",
    "Voltar o editor para a janela principal": "Move the editor back to the main window",
    welcome: "Open a <b>.md</b>, <b>.mmd</b>, <b>.gv</b> or <b>.txt</b> file with <kbd>Ctrl</kbd> <kbd>O</kbd><br>or drag it into this window.",
    "Recentes": "Recent", "Erro de sintaxe": "Syntax error", "(mostrando a última versão válida)": "(showing the last valid version)",
    "Buscar no texto": "Find in text", "Anterior (Shift+Enter)": "Previous (Shift+Enter)", "Próximo (Enter)": "Next (Enter)",
    "Fechar (Esc)": "Close (Esc)", "Atalhos de teclado": "Keyboard shortcuts", "Controles de visualização": "View controls",
    "Erro no diagrama Mermaid": "Mermaid diagram error", "Erro no grafo Graphviz": "Graphviz graph error",
    "não foi possível carregar o Mermaid": "could not load Mermaid", "não foi possível carregar o Graphviz": "could not load Graphviz",
    "grafo inválido": "invalid graph",
    "Desempenho": "Performance", "Equilibrado": "Balanced", "Qualidade": "Quality", "Auto": "Auto",
    "Adicionar filho (Tab)": "Add child (Tab)", "Filho": "Child", "Adicionar irmão (Enter)": "Add sibling (Enter)",
    "Irmão": "Sibling", "Renomear (F2 ou duplo clique)": "Rename (F2 or double-click)",
    "Excluir com os filhos (Delete)": "Delete with children (Delete)",
    "Nada para desfazer": "Nothing to undo", "Nada para refazer": "Nothing to redo",
    "Ir para a janela de código": "Go to the code window", "Editor de código (Ctrl+E)": "Code editor (Ctrl+E)",
    "Dois lados": "Both sides", "Para a direita": "To the right", "Vertical (de cima para baixo)": "Vertical (top to bottom)",
    "Radial": "Radial", "Original do Mermaid": "Mermaid original",
    "Espaçamento e aparência": "Spacing and appearance", "Aparência": "Appearance", "Espaçamento": "Spacing",
    "Direção definida no arquivo": "Direction set in the file", "De cima para baixo": "Top to bottom",
    "Da esquerda para a direita": "Left to right", "De baixo para cima": "Bottom to top", "Da direita para a esquerda": "Right to left",
    "Diminuir (Ctrl −)": "Zoom out (Ctrl −)", "Tamanho original (Ctrl 0)": "Actual size (Ctrl 0)", "Aumentar (Ctrl +)": "Zoom in (Ctrl +)",
    "Ajustar à janela": "Fit to window", "Desfazer (Ctrl Z)": "Undo (Ctrl Z)", "Refazer (Ctrl Shift Z)": "Redo (Ctrl Shift Z)",
    "Tema claro (Ctrl D)": "Light theme (Ctrl D)", "Tema escuro (Ctrl D)": "Dark theme (Ctrl D)",
    "Distância entre níveis": "Distance between levels", "Distância entre irmãos": "Distance between siblings",
    "Largura máxima do cartão": "Maximum card width", "Distância entre nós": "Distance between nodes",
    "Renderização": "Rendering", "Usando <b>{mode}</b>": "Using <b>{mode}</b>",
    "Recomendado para este computador: <b>{mode}</b>": "Recommended for this computer: <b>{mode}</b>",
    "Efeito vidro": "Glass effect", "Ocultar esta barra automaticamente": "Hide this bar automatically",
    "Restaurar padrão": "Restore defaults",
    "{n} núcleos": "{n} cores", "GPU não identificada": "Unidentified GPU", "sem aceleração de GPU": "no GPU acceleration",
    "GPU dedicada": "dedicated GPU", "GPU dedicada, CPU/RAM modestas": "dedicated GPU, modest CPU/RAM",
    "GPU integrada": "integrated GPU", "GPU integrada e máquina modesta": "integrated GPU on a modest machine",
    "máquina modesta": "modest machine",
    "1 resultado": "1 result", "{n} resultados": "{n} results", "Nenhum resultado": "No results",
    "Geral": "General", "Abrir arquivo": "Open file", "Salvar": "Save", "Recarregar do disco": "Reload from disk",
    "Buscar": "Find", "Tema claro / escuro": "Light / dark theme", "Desfazer · refazer": "Undo · redo",
    "Imprimir / PDF": "Print / PDF", "Exportar SVG": "Export SVG", "Nova janela": "New window", "Fechar janela": "Close window",
    "Visualização": "View", "Ctrl + roda, pinça": "Ctrl + wheel, pinch", "Zoom": "Zoom",
    "Arrastar o fundo, roda": "Drag the background, wheel", "Mover o diagrama": "Move the diagram",
    "Mapa mental": "Mind map", "Clique": "Click", "Selecionar nó": "Select node", "Duplo clique, F2": "Double-click, F2",
    "Renomear": "Rename", "Adicionar filho": "Add child", "Adicionar irmão": "Add sibling", "Excluir nó e filhos": "Delete node and children",
    "Setas": "Arrows", "Navegar entre nós": "Move between nodes", "Mover entre irmãos": "Move among siblings",
    "Arrastar nó sobre outro": "Drag a node onto another", "Mudar de pai": "Change parent",
  };
  const PT = { welcome: "Abra um arquivo <b>.md</b>, <b>.mmd</b>, <b>.gv</b> ou <b>.txt</b> com <kbd>Ctrl</kbd> <kbd>O</kbd><br>ou arraste-o para esta janela." };
  const langOf = (l) => (/^pt/i.test(l || "") ? "pt" : "en");
  let LANG = langOf(window.MIRANTE_LANG || navigator.language);
  function tr(s, vars) {
    let out = (LANG === "en" ? EN[s] : PT[s]) || s;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return out;
  }
  /* textos fixos do HTML: data-i18n (texto), -html, -title, -aria, -ph (placeholder) */
  function applyStaticText() {
    document.documentElement.lang = LANG === "en" ? "en" : "pt-BR";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", tr(el.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = tr(el.dataset.i18nPh); });
    window.MiranteMindmap?.setLang(LANG);
  }

  /* ---------------- ícones ---------------- */
  const P = {
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
    both: '<rect x="8.5" y="10" width="7" height="4" rx="2"/><path d="M8.5 12c-2 0-2-5-4.5-5M8.5 12c-2 0-2 5-4.5 5M15.5 12c2 0 2-5 4.5-5M15.5 12c2 0 2 5 4.5 5"/>',
    right: '<rect x="2.5" y="10" width="6" height="4" rx="2"/><path d="M8.5 12c3 0 3-6 6-6h6M8.5 12h12M8.5 12c3 0 3 6 6 6h6"/>',
    down: '<rect x="9" y="2.5" width="6" height="4" rx="2"/><path d="M12 6.5V9M6 9h12M6 9v11M18 9v11M6 14.5h3M6 20h3M18 14.5h3M18 20h3"/>',
    radial: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="3.6" r="1.6"/><circle cx="12" cy="20.4" r="1.6"/><circle cx="3.6" cy="12" r="1.6"/><circle cx="20.4" cy="12" r="1.6"/><path d="M12 9.4V5.2M12 14.6v4.2M9.4 12H5.2M14.6 12h4.2"/>',
    sparkle: '<path d="M11 3l1.9 4.9L17.8 9.8l-4.9 1.9L11 16.6l-1.9-4.9L4.2 9.8l4.9-1.9z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    minus: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
    auto: '<path d="M6 19l6-14 6 14M8.5 13.5h7"/>',
    aDown: '<path d="M12 4v16M6 14l6 6 6-6"/>', aRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
    aUp: '<path d="M12 20V4M6 10l6-6 6 6"/>', aLeft: '<path d="M20 12H4M10 6l-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    child: '<rect x="2.5" y="9" width="8" height="6" rx="2"/><path d="M10.5 12h3.5M18 9v6M15 12h6"/>',
    sibling: '<rect x="6" y="3" width="12" height="6" rx="2"/><path d="M12 13v8M8 17h8"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
    external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10"/>',
    attach: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3.5 3.5l17 17M10.4 5.7A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 01-3 3.8M6.7 6.8A16.3 16.3 0 002.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 004.3-1.1M9.9 9.9a3 3 0 004.2 4.2"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
    doc: '<path d="M14 3.5H7.5A1.5 1.5 0 006 5v14a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0018 19V7.5z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.3-2.4 3.6M12 16.8h.01"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
  document.querySelector('#editor [data-cmd="toggleEditor"]').innerHTML = icon("close");
  const detachBtn = document.querySelector('#editor [data-cmd="detach"]');
  detachBtn.innerHTML = icon(EDITOR_ONLY ? "attach" : "external");
  if (EDITOR_ONLY) detachBtn.dataset.i18nTitle = "Voltar o editor para a janela principal";
  applyStaticText();

  /* ---------------- tema / mermaid ---------------- */
  const vendorUrl = (n) => new URL("vendor/" + n, APP_BASE).href;
  function applyTheme(t) {
    S.theme = t === "light" ? "light" : "dark";
    const changed = document.documentElement.dataset.theme !== S.theme;
    document.documentElement.dataset.theme = S.theme;
    // O WebKitGTK não repinta as manchas desfocadas do fundo (filter: blur) quando só a cor, vinda de
    // variável CSS, muda: no tema escuro ficava o clarão do claro. Elementos novos são pintados do zero.
    if (changed) { const b = $("backdrop"); b.replaceWith(b.cloneNode(true)); }
    $("gh-css").href = vendorUrl(S.theme === "dark" ? "gh-dark.css" : "gh-light.css");
    $("hl-css").href = vendorUrl(S.theme === "dark" ? "hl-dark.css" : "hl-light.css");
  }
  function mermaidConfig() {
    const dark = S.theme === "dark";
    const tv = dark ? {
      darkMode: true, background: "#111216", fontSize: "14px",
      primaryColor: "#1d3557", primaryTextColor: "#f5f5f7", primaryBorderColor: "#0A84FF",
      secondaryColor: "#35214f", secondaryTextColor: "#f5f5f7", secondaryBorderColor: "#BF5AF2",
      tertiaryColor: "#1c3a2a", tertiaryTextColor: "#f5f5f7", tertiaryBorderColor: "#30D158",
      lineColor: "#8e8e93", textColor: "#f5f5f7", mainBkg: "#1d3557", nodeBorder: "#0A84FF",
      clusterBkg: "#161925", clusterBorder: "#3a3d4a", edgeLabelBackground: "#1d1f28",
      actorBkg: "#1d3557", actorBorder: "#0A84FF", actorTextColor: "#f5f5f7", actorLineColor: "#8e8e93",
      signalColor: "#c7c7cc", signalTextColor: "#f5f5f7", labelBoxBkgColor: "#1d3557", labelTextColor: "#f5f5f7",
      noteBkgColor: "#3a3320", noteTextColor: "#f5f5f7", noteBorderColor: "#FFD60A",
    } : {
      darkMode: false, background: "#f2f2f7", fontSize: "14px",
      primaryColor: "#dbeafe", primaryTextColor: "#1c1c1e", primaryBorderColor: "#007AFF",
      secondaryColor: "#f1e4fb", secondaryTextColor: "#1c1c1e", secondaryBorderColor: "#AF52DE",
      tertiaryColor: "#e2f6e7", tertiaryTextColor: "#1c1c1e", tertiaryBorderColor: "#34C759",
      lineColor: "#8e8e93", textColor: "#1c1c1e", mainBkg: "#dbeafe", nodeBorder: "#007AFF",
      clusterBkg: "#f7f8fb", clusterBorder: "#d1d5de", edgeLabelBackground: "#ffffff",
      actorBkg: "#dbeafe", actorBorder: "#007AFF", actorTextColor: "#1c1c1e", actorLineColor: "#8e8e93",
      signalColor: "#3a3a3c", signalTextColor: "#1c1c1e", labelBoxBkgColor: "#dbeafe", labelTextColor: "#1c1c1e",
      noteBkgColor: "#fff8d6", noteTextColor: "#1c1c1e", noteBorderColor: "#FFCC00",
    };
    return {
      startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: tv,
      fontFamily: '"Inter Variable", "Noto Sans", sans-serif',
      flowchart: {
        nodeSpacing: S.prefs.nodeSpacing, rankSpacing: S.prefs.rankSpacing, curve: "basis", htmlLabels: true,
        subGraphTitleMargin: { top: 4, bottom: 10 }, // respiro entre o título do subgraph e o conteúdo
      },
      mindmap: { padding: 14, maxNodeWidth: S.prefs.cardWidth },
    };
  }
  function mermaidInit() { mermaid.initialize(mermaidConfig()); }
  const fontsReady = Promise.all([
    document.fonts.load('450 13px "Inter Variable"', "Aa"),
    document.fonts.load('450 13px "Inter Variable"', "çãõ"),
  ]).catch(() => null);

  function setBase(href) {
    let b = document.querySelector("base");
    if (!b) { b = document.createElement("base"); document.head.prepend(b); }
    b.href = href || APP_BASE;
  }
  /* Caminhos absolutos do disco (/home/..., C:\..., file:///...) não resolvem pela <base> do protocolo asset
     (o Tauri tira a primeira barra) e o DOMPurify descarta file:. Viram uma URL asset completa, como as relativas. */
  function localUrl(raw) {
    const m = /^(asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/.exec(document.baseURI);
    if (!m || !raw) return null;
    let p = raw.trim(), frag = "";
    if (/^file:\/\//i.test(p)) {
      try { const u = new URL(p); p = u.pathname; frag = u.hash; } catch { return null; }
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    } else if (/^[A-Za-z]:[\\/]/.test(p) || (p[0] === "/" && p[1] !== "/")) {
      const h = p.indexOf("#");
      if (h > 0) { frag = p.slice(h); p = p.slice(0, h); }
    } else return null;
    try { p = decodeURIComponent(p); } catch { /* já estava sem codificação */ }
    p = p.replace(/\\/g, "/");
    const enc = (s) => s.split("/").map(encodeURIComponent).join("/");
    return m[1] + (p[0] === "/" ? "%2F" + enc(p.slice(1)) : enc(p)) + frag;
  }
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (!/^(src|href)$/.test(data.attrName) || !/^(IMG|A|SOURCE|VIDEO|AUDIO)$/.test(node.nodeName)) return;
    const url = localUrl(data.attrValue);
    // com forceKeepAttr o DOMPurify deixa o atributo como está no nó (não reaplica attrValue)
    if (url) { node.setAttribute(data.attrName, url); data.forceKeepAttr = true; }
  });
  function setMode(kind) {
    body.classList.remove("mode-boot", "mode-welcome", "mode-md", "mode-mmd", "mode-txt");
    body.classList.add("mode-" + (kind || "welcome"));
  }
  function errorBox(title, err) {
    const msg = (err && (err.message || err.str)) || String(err);
    return `<div class="render-error"><b>${escapeHtml(title)}</b>${escapeHtml(msg)}</div>`;
  }
  function detectSub(text) {
    let front = false;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (i === 0 && t === "---") { front = true; continue; }
      if (front) { if (t === "---") front = false; continue; }
      if (!t || t.startsWith("%%")) continue;
      if (/^mindmap\b/.test(t)) return "mindmap";
      if (/^(flowchart|graph)\b/.test(t)) return "flowchart";
      return "other";
    }
    return "other";
  }
  function setFlowDir(code, dir) {
    return code.replace(/^(\s*)(flowchart|graph)\b[ \t]*(TB|TD|BT|RL|LR)?/m, `$1$2 ${dir}`);
  }

  /* ---------------- markdown ---------------- */
  marked.use({
    gfm: true,
    renderer: {
      code(token) {
        const lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase();
        if (lang === "mermaid" || lang === "mmd") return `<div class="mermaid-block" data-mermaid="${encodeURIComponent(token.text)}"></div>`;
        if (lang === "dot" || lang === "graphviz" || lang === "gv") return `<div class="mermaid-block" data-dot="${encodeURIComponent(token.text)}"></div>`;
        if (lang === "math") return `<div class="math-block" data-tex="${escapeHtml(token.text)}"></div>`;
        let html;
        try {
          html = lang && hljs.getLanguage(lang) ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value : escapeHtml(token.text);
        } catch (_) { html = escapeHtml(token.text); }
        return `<pre><code class="hljs${lang ? " language-" + escapeHtml(lang) : ""}">${html}</code></pre>`;
      },
    },
  });
  /* fórmulas: $...$ no texto, $$...$$ em bloco e blocos ```math; quem desenha é o KaTeX, carregado só
   * quando o documento tem fórmula. "$5 e $10" continua texto: o $ de abertura precisa de algo colado
   * depois, o de fechamento de algo colado antes, e não pode vir seguido de número. */
  marked.use({
    extensions: [
      {
        name: "mathBlock", level: "block",
        start(src) { const i = src.search(/^ {0,3}(\$\$|\\\[)/m); return i < 0 ? undefined : i; },
        tokenizer(src) {
          // $$ ... $$ e também \[ ... \] (o jeito do ChatGPT e de muitas IAs)
          const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) || /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src);
          if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };
        },
        renderer: (t) => `<div class="math-block" data-tex="${escapeHtml(t.text)}"></div>\n`,
      },
      {
        name: "mathInline", level: "inline",
        start(src) { const i = src.search(/\$|\\[([]/); return i < 0 ? undefined : i; },
        tokenizer(src) {
          let m = /^\\\((.+?)\\\)/.exec(src);                 // \( ... \)
          if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: false };
          m = /^\\\[([\s\S]+?)\\\]/.exec(src);              // \[ ... \] no meio de um parágrafo
          if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: true };
          m = /^\$\$([^$]+?)\$\$/.exec(src);
          if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: true };
          m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
          if (m) return { type: "mathInline", raw: m[0], text: m[1], display: false };
        },
        renderer: (t) => `<span class="math-inline${t.display ? " display" : ""}" data-tex="${escapeHtml(t.text)}"></span>`,
      },
    ],
  });
  const slugify = (t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
  function addHeadingIds(root) {
    const seen = new Map();
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      if (h.id) return;
      const base = slugify(h.textContent) || "secao", n = seen.get(base) || 0;
      seen.set(base, n + 1); h.id = n ? `${base}-${n}` : base;
    });
  }
  /* mermaid.min.js tem 2,6 MB: só é carregado quando um arquivo realmente usa Mermaid
   * (mapas mentais usam o motor próprio e abrem sem ele). */
  /* Cache de SVGs já desenhados (código + tema + espaçamentos): desfazer/refazer, alternar opções e
   * editar o texto em volta de um diagrama no Markdown não pagam de novo os ~400 ms do Mermaid. */
  const mmdCache = new Map();
  const cacheKey = (code) => [S.theme, S.prefs.nodeSpacing, S.prefs.rankSpacing, S.prefs.cardWidth, code].join("\u0001");
  function cacheGet(k) { const v = mmdCache.get(k); if (v) { mmdCache.delete(k); mmdCache.set(k, v); } return v; }
  function cachePut(k, v) { mmdCache.set(k, v); while (mmdCache.size > 24) mmdCache.delete(mmdCache.keys().next().value); }
  let mermaidLoad = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve();
    return (mermaidLoad ||= new Promise((ok, fail) => {
      const sc = document.createElement("script");
      sc.src = vendorUrl("mermaid.min.js");
      sc.onload = () => ok();
      sc.onerror = () => { mermaidLoad = null; fail(new Error(tr("não foi possível carregar o Mermaid"))); };
      document.head.appendChild(sc);
    }));
  }
  async function localRender(id, code) {
    try { await loadMermaid(); } catch (err) { return { error: String(err.message || err) }; }
    mermaidInit();
    try { return { svg: (await mermaid.render(id, code)).svg }; }
    catch (err) { document.getElementById("d" + id)?.remove(); return { error: String((err && (err.message || err.str)) || err) }; }
  }
  async function mermaidSvg(code, my) {
    const key = cacheKey(code), hit = cacheGet(key);
    if (hit) return { svg: hit };
    const id = `mmd-${my}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await localRender(id, code);
    if (r.svg) cachePut(key, r.svg);
    return r;
  }
  async function mermaidInto(el, code, my) {
    const r = await mermaidSvg(code, my);
    if (my !== S.seq || r.stale) return false;
    if (r.error) { el.innerHTML = errorBox(tr("Erro no diagrama Mermaid"), r.error); return false; }
    el.innerHTML = r.svg;
    return true;
  }
  const FRONT_MATTER = /^﻿?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/;
  const DIAGRAM_LANGS = { mermaid: "mmd", mmd: "mmd", dot: "dot", graphviz: "dot", gv: "dot" };
  /* os blocos de diagrama do .md, na mesma ordem em que são desenhados */
  function diagramBlocks(text = S.text) {
    const out = [];
    marked.walkTokens(marked.lexer(text.replace(FRONT_MATTER, "")), (t) => {
      if (t.type !== "code") return;
      const lang = DIAGRAM_LANGS[(t.lang || "").trim().split(/\s+/)[0].toLowerCase()];
      if (lang) out.push({ code: t.text, lang, raw: t.raw });
    });
    return out;
  }
  /* troca o código do bloco i (edição vinda da janela do diagrama) */
  const indentLines = (t, ind) => (ind ? t.split("\n").map((l, k) => (k && l ? ind + l : l)).join("\n") : t);
  /* onde o bloco está no texto; dentro de uma lista o raw do marked vem sem o recuo, que é refeito aqui */
  function locateBlock(raw, pos) {
    const at = S.text.indexOf(raw, pos);
    if (at >= 0) return { at, len: raw.length, indent: "" };
    const first = raw.slice(0, raw.indexOf("\n") + 1 || raw.length);
    for (let i = S.text.indexOf(first, pos); i >= 0; i = S.text.indexOf(first, i + 1)) {
      const indent = S.text.slice(S.text.lastIndexOf("\n", i - 1) + 1, i);
      if (!/^[ \t]+$/.test(indent)) continue;
      const full = indentLines(raw, indent);
      if (S.text.startsWith(full, i)) return { at: i, len: full.length, indent };
    }
    return null;
  }
  function replaceBlock(i, code) {
    const blocks = diagramBlocks(), b = blocks[i];
    if (!b) return false;
    let pos = 0, loc = null;
    for (let k = 0; k <= i; k++) {
      loc = locateBlock(blocks[k].raw, pos);
      if (!loc) return false;
      pos = loc.at + loc.len;
    }
    const nl = b.raw.indexOf("\n"), off = nl < 0 ? -1 : b.raw.indexOf(b.code, nl + 1);
    if (off < 0) return false;
    const raw = b.raw.slice(0, off) + code + b.raw.slice(off + b.code.length);
    const text = S.text.slice(0, loc.at) + indentLines(raw, loc.indent) + S.text.slice(loc.at + loc.len);
    if (text === S.text) return true;
    if (!S.typing) pushHistory(S.text);
    S.typing = true; clearTimeout(S.typeT); S.typeT = setTimeout(() => (S.typing = false), 900);
    S.text = text; S.quietBlocks = text;   // quem mudou foi a janela do diagrama: não devolve para ela
    syncEditor(); setDirty(S.text !== S.saved); notifySource();
    scheduleLiveDraw();
    return true;
  }
  /* ---------------- diagramas no .md: mover, zoom e tela cheia (só visualização) ---------------- */
  /* arrastar move; roda com Ctrl (ou sempre, se wheelZoom) dá zoom no ponto do mouse */
  function panZoom(view, pan, o = {}) {
    const st = { x: 0, y: 0, s: 1 };
    const apply = (anim) => {
      pan.style.transition = anim && !calm() ? "transform .24s cubic-bezier(.32, .72, 0, 1)" : "none";
      pan.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.s})`;
      if (o.onChange) o.onChange(st);
    };
    const zoomAt = (k, cx, cy, anim) => {
      const s2 = clamp(st.s * k, o.min || 0.25, o.max || 6);
      k = s2 / st.s;
      st.x = cx - (cx - st.x) * k; st.y = cy - (cy - st.y) * k; st.s = s2;
      apply(anim);
    };
    const mid = () => { const r = view.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    let drag = null;
    view.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, target: e.target };
      view.setPointerCapture(e.pointerId);
      view.classList.add("dragging");
      e.preventDefault();
    });
    view.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      st.x = drag.sx + e.clientX - drag.x; st.y = drag.sy + e.clientY - drag.y;
      apply(false);
    });
    const end = (e) => {
      // soltar sem ter arrastado é um clique (com a captura do ponteiro, o click iria para a área toda)
      if (drag && o.onTap && e.type === "pointerup" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) o.onTap(drag.target);
      drag = null; view.classList.remove("dragging");
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener("wheel", (e) => {
      if (!o.wheelZoom && !(e.ctrlKey || e.metaKey)) return;   // sem Ctrl, a roda continua rolando o texto
      e.preventDefault(); e.stopPropagation();
      const r = view.getBoundingClientRect();
      zoomAt(Math.exp(-clamp(e.deltaY, -60, 60) * 0.006), e.clientX - r.left, e.clientY - r.top, false);
    }, { passive: false });
    return {
      st, apply,
      zoom: (d) => zoomAt(d > 0 ? 1.25 : 0.8, ...mid(), true),
      move: (dx, dy) => { st.x += dx; st.y += dy; apply(true); },
      set: (x, y, s2, anim) => { st.x = x; st.y = y; st.s = s2; apply(anim); },
    };
  }
  const toolBtn = (cmd, ic, title) => `<button class="icon-btn small" data-blk="${cmd}" title="${tr(title)}">${icon(ic)}</button>`;
  /* o bloco ganha uma área que move e dá zoom, e uma barrinha no canto */
  function enhanceBlock(el, i) {
    if (!el.querySelector("svg, .mm-host")) return;              // erro de sintaxe: fica como está
    const view = document.createElement("div"), pan = document.createElement("div");
    view.className = "blk-view"; pan.className = "blk-pan";
    pan.append(...el.childNodes); view.appendChild(pan); el.appendChild(view);
    const pz = panZoom(view, pan);
    const bar = document.createElement("div");
    bar.className = "blk-tools";
    bar.innerHTML = toolBtn("out", "minus", "Afastar") + toolBtn("in", "plus", "Aproximar") +
      toolBtn("left", "aLeft", "Mover para a esquerda") + toolBtn("right", "aRight", "Mover para a direita") +
      toolBtn("reset", "reset", "Voltar ao tamanho original") + '<span class="blk-sep"></span>' +
      toolBtn("expand", "expand", "Expandir") +
      (IN_APP && !S.block ? toolBtn("window", "external", "Abrir em nova janela") : "");
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-blk]");
      if (!b) return;
      e.stopPropagation();
      const step = view.clientWidth * 0.25;
      ({
        out: () => pz.zoom(-1), in: () => pz.zoom(1),
        left: () => pz.move(step, 0), right: () => pz.move(-step, 0),
        reset: () => pz.set(0, 0, 1, true),
        expand: () => openBlockModal(pan),
        window: () => post({ type: "openBlock", index: i }),
      })[b.dataset.blk]();
    });
    el.appendChild(bar);
  }

  /* tela cheia: o diagrama solto sobre um fundo escuro, sem cartão */
  let modal = null;
  function openBlockModal(srcPan) {
    openModal((pan) => {
      for (const n of srcPan.childNodes) pan.appendChild(n.cloneNode(true));
      // tamanho natural: o SVG do Mermaid vem com largura 100%; o mapa mental vem reduzido para caber no texto
      const svg = pan.querySelector(":scope > svg");
      if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) {
        const vb = svg.viewBox.baseVal;
        svg.setAttribute("width", vb.width); svg.setAttribute("height", vb.height);
        svg.style.maxWidth = "none";
      }
      const host = pan.querySelector(".mm-host");
      if (host) {
        host.style.transform = "none";
        const box = host.parentElement;
        if (box !== pan) { box.style.width = "auto"; box.style.height = "auto"; box.style.overflow = "visible"; }
      }
    });
  }
  /* tela cheia genérica: fill(pan) põe o conteúdo; opts.onTap recebe o elemento clicado; opts.hint é a dica no topo */
  function openModal(fill, opts = {}) {
    closeBlockModal(true);
    const m = document.createElement("div");
    m.id = "blk-modal";
    m.innerHTML = `<div class="bm-view"><div class="bm-pan"></div></div>${opts.hint ? `<div class="bm-hint glass-pill">${escapeHtml(opts.hint)}</div>` : ""}
      <div class="bm-bar glass-pill">${toolBtn("out", "minus", "Afastar")}<span class="bm-zoom">100%</span>${toolBtn("in", "plus", "Aproximar")}
      <span class="blk-sep"></span>${toolBtn("left", "aLeft", "Mover para a esquerda")}${toolBtn("right", "aRight", "Mover para a direita")}
      ${toolBtn("fit", "fit", "Ajustar à janela")}<span class="blk-sep"></span>${toolBtn("close", "close", "Fechar (Esc)")}</div>`;
    const view = m.querySelector(".bm-view"), pan = m.querySelector(".bm-pan");
    body.appendChild(m);                       // no documento antes de desenhar: o conteúdo precisa ser medido
    body.classList.add("blk-modal-open");
    fill(pan);
    const zl = m.querySelector(".bm-zoom");
    const pz = panZoom(view, pan, { wheelZoom: true, min: 0.1, max: 8, onTap: opts.onTap, onChange: (st) => (zl.textContent = Math.round(st.s * 100) + "%") });
    const fitIt = (anim) => {
      const w = pan.offsetWidth, h = pan.offsetHeight, W = view.clientWidth, H = view.clientHeight - 90;
      const s2 = Math.min(2, (W * 0.92) / w, (H * 0.92) / h);
      pz.set((W - w * s2) / 2, (H - h * s2) / 2 + 10, s2, anim);
    };
    fitIt(false);
    m.querySelector(".bm-bar").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-blk]");
      if (!b) return;
      const step = view.clientWidth * 0.2;
      ({
        out: () => pz.zoom(-1), in: () => pz.zoom(1),
        left: () => pz.move(step, 0), right: () => pz.move(-step, 0),
        fit: () => fitIt(true), close: () => closeBlockModal(),
      })[b.dataset.blk]();
    });
    const onKey = (e) => {
      const k = e.key;
      const act = {
        Escape: () => closeBlockModal(), "+": () => pz.zoom(1), "=": () => pz.zoom(1), "-": () => pz.zoom(-1), "0": () => fitIt(true),
        ArrowLeft: () => pz.move(80, 0), ArrowRight: () => pz.move(-80, 0), ArrowUp: () => pz.move(0, 80), ArrowDown: () => pz.move(0, -80),
      }[k];
      if (!act || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopImmediatePropagation(); act();
    };
    const onResize = () => fitIt(false);
    document.addEventListener("keydown", onKey, true);
    addEventListener("resize", onResize);
    modal = { el: m, off: () => { document.removeEventListener("keydown", onKey, true); removeEventListener("resize", onResize); } };
  }
  /* mapa mental dos títulos do .md: # ## ### #### viram a árvore; clicar num tópico leva até ele */
  function headingsMap() {
    const hs = [...E.doc.querySelectorAll("h1, h2, h3, h4")]
      .map((el) => ({ level: +el.tagName[1], text: el.textContent.trim(), el })).filter((h) => h.text);
    if (hs.length < 2) return null;
    const oneTitle = hs[0].level === 1 && hs.filter((h) => h.level === 1).length === 1;
    const name = (S.path || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "") || tr("Documento");
    const rest = oneTitle ? hs.slice(1) : hs;
    const q = (t) => '"' + t.replace(/"/g, "'").replace(/\s+/g, " ") + '"';
    const lines = ["mindmap", `  root((${q(oneTitle ? hs[0].text : name)}))`], targets = [oneTitle ? hs[0].el : null];
    const levels = [];
    for (const h of rest) {
      while (levels.length && levels[levels.length - 1] >= h.level) levels.pop();
      levels.push(h.level);
      lines.push("  ".repeat(levels.length + 1) + `n${targets.length}[${q(h.text)}]`);
      targets.push(h.el);
    }
    return { text: lines.join("\n"), targets };
  }
  function openHeadingsMap() {
    const map = headingsMap();
    if (!map) return;
    let els = null;
    openModal((pan) => {
      const host = document.createElement("div");
      pan.appendChild(host);
      const layout = ["both", "right", "down", "radial"].includes(S.prefs.layout) ? S.prefs.layout : "both";
      els = MM.render(host, MM.parse(map.text), { ...S.prefs, layout, theme: S.theme }).els;
    }, {
      hint: tr("Clique num tópico para ir até ele"),
      onTap: (t) => {
        const node = t.closest && t.closest(".mm-node");
        if (!node || !els) return;
        const id = [...els].find(([, el]) => el === node || el.contains(node));
        const target = id && map.targets[id[0]];
        if (!target) return;
        closeBlockModal();
        const det = target.closest("details");
        if (det && !det.open) det.open = true;
        target.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
        target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
      },
    });
  }
  function closeBlockModal(now) {
    if (!modal) return;
    const { el, off } = modal;
    modal = null; off();
    body.classList.remove("blk-modal-open");
    if (now || calm()) { el.remove(); return; }
    el.classList.add("closing");
    setTimeout(() => el.remove(), 180);
  }
  /* caixas de destaque (GitHub e Obsidian): > [!TIP] Título opcional. Com [!TIPO]- ela começa fechada e
   * abre ao clicar (bom para perguntas); com [!TIPO]+ começa aberta. */
  const CALLOUTS = {
    note: ["note", "Nota"], info: ["note", "Nota"], tip: ["tip", "Dica"], hint: ["tip", "Dica"],
    important: ["important", "Importante"], warning: ["warning", "Atenção"], attention: ["warning", "Atenção"],
    caution: ["caution", "Cuidado"], danger: ["caution", "Cuidado"], error: ["caution", "Cuidado"],
    example: ["example", "Exemplo"], question: ["question", "Pergunta"], faq: ["question", "Pergunta"],
    summary: ["summary", "Resumo"], abstract: ["summary", "Resumo"], tldr: ["summary", "Resumo"],
    success: ["tip", "Certo"], check: ["tip", "Certo"], quote: ["note", "Citação"],
  };
  const CALLOUT_ICON = {
    note: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6h.01"/>',
    tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0012 3z"/>',
    important: '<path d="M4.5 5.5h15v10h-7l-4 3.5v-3.5h-4z"/><path d="M12 8v3.5M12 13.6h.01"/>',
    warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    caution: '<path d="M8.3 3.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 16.2V8.8z"/><path d="M12 8v4.5M12 15.6h.01"/>',
    example: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.3-2.4 3.6M12 16.8h.01"/>',
    summary: '<path d="M14 3.5H7.5A1.5 1.5 0 006 5v14a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0018 19V7.5z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h4"/>',
  };
  function applyCallouts(root) {
    for (const bq of root.querySelectorAll("blockquote")) {
      const p = bq.firstElementChild, t = p && p.tagName === "P" ? p.firstChild : null;
      if (!t || t.nodeType !== 3) continue;
      const m = /^\s*\[!([A-Za-z]+)\]([+-]?)[ \t]*([^\n]*)\n?/.exec(t.data);
      if (!m) continue;
      const [kind, label] = CALLOUTS[m[1].toLowerCase()] || ["note", m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()];
      t.data = t.data.slice(m[0].length);
      // o título pode ter formatação depois do texto (ex.: **negrito**): leva tudo até a primeira quebra
      const title = document.createElement("span");
      title.className = "callout-label";
      title.append(m[3]);
      if (!m[0].endsWith("\n")) {           // o título continua em negrito, código ou fórmula até a quebra de linha
        let n = t.nextSibling;
        while (n && n.nodeName !== "BR" && !(n.nodeType === 3 && n.data.includes("\n"))) { const nx = n.nextSibling; title.appendChild(n); n = nx; }
        if (n && n.nodeName === "BR") n.remove();
        else if (n && n.nodeType === 3) { const i = n.data.indexOf("\n"); title.append(n.data.slice(0, i)); n.data = n.data.slice(i + 1); }
      }
      if (!title.textContent.trim() && !title.querySelector(".math-inline")) title.textContent = tr(label);
      if (!p.textContent.trim() && !p.querySelector("img, .math-inline")) p.remove();
      const fold = m[2];
      const box = document.createElement(fold ? "details" : "div");
      box.className = `callout callout-${kind}`;
      if (fold === "+") box.open = true;
      const head = document.createElement(fold ? "summary" : "div");
      head.className = "callout-title";
      head.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CALLOUT_ICON[kind]}</svg>`;
      head.appendChild(title);
      const content = document.createElement("div");
      content.className = "callout-body";
      content.append(...bq.childNodes);
      box.append(head, content);
      bq.replaceWith(box);
    }
  }
  let katexLoad = null;
  function loadKatex() {
    if (!document.querySelector("link[data-katex]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = vendorUrl("katex/katex.min.css"); css.dataset.katex = "";
      document.head.appendChild(css);
    }
    if (window.katex) return Promise.resolve(window.katex);
    return (katexLoad ||= new Promise((ok, fail) => {
      const sc = document.createElement("script");
      sc.src = vendorUrl("katex/katex.min.js");
      sc.onload = () => {                     // química (\ce, \pu): extensão do próprio KaTeX
        const ch = document.createElement("script");
        ch.src = vendorUrl("katex/mhchem.min.js");
        ch.onload = ch.onerror = () => ok(window.katex);
        document.head.appendChild(ch);
      };
      sc.onerror = () => { katexLoad = null; fail(new Error("KaTeX")); };
      document.head.appendChild(sc);
    }));
  }
  async function renderMath(root, my) {
    const els = root.querySelectorAll("[data-tex]");
    if (!els.length) return;
    let katex;
    try { katex = await loadKatex(); } catch (_) { return; }   // sem KaTeX, fica o código da fórmula
    if (my !== S.seq) return;
    for (const el of els) {
      const display = el.classList.contains("math-block") || el.classList.contains("display");
      try {
        katex.render(el.dataset.tex, el, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
      } catch (_) {
        el.textContent = el.dataset.tex; el.classList.add("math-error");
      }
    }
  }
  /* modo revisão: respostas em <details>; o botão da barra abre todas ou fecha todas */
  const allAnswersOpen = () => !E.doc.querySelector("details:not([open])");
  const answersBtn = () => allAnswersOpen()
    ? btn("answers", "eyeOff", "Esconder todas as respostas", true)
    : btn("answers", "eye", "Mostrar todas as respostas");
  function toggleAnswers() {
    const open = !allAnswersOpen();
    for (const d of E.doc.querySelectorAll("details")) d.open = open;
  }
  let answersT = 0;
  E.doc.addEventListener("toggle", (e) => {
    // um <details> que abre mostra mapas mentais que não tinham largura para se encaixar
    if (e.target.open) for (const el of e.target.querySelectorAll(".mm-inline")) if (el._fit && el._fit()) el._fit = null;
    cancelAnimationFrame(answersT);              // abrir todas dispara um toggle por resposta: troca o ícone uma vez
    answersT = requestAnimationFrame(() => {
      const b = E.dock.querySelector('[data-cmd="answers"]');
      if (b) b.outerHTML = answersBtn();
    });
  }, true);
  async function renderMarkdown(my) {
    const raw = marked.parse(S.text.replace(FRONT_MATTER, ""));
    // redesenhar (tema, digitação, arquivo salvo) não fecha as respostas que a pessoa abriu
    const openAnswers = S.answersFor === S.path ? [...E.doc.querySelectorAll("details")].map((d) => d.open) : [];
    S.answersFor = S.path;
    E.doc.innerHTML = DOMPurify.sanitize(raw, { ADD_ATTR: ["data-mermaid", "data-dot", "data-tex", "target"] });
    applyCallouts(E.doc);
    E.doc.querySelectorAll("details").forEach((d, i) => { if (openAnswers[i]) d.open = true; });
    addHeadingIds(E.doc);
    await renderMath(E.doc, my);
    if (my !== S.seq) return;
    const blockEls = [...E.doc.querySelectorAll(".mermaid-block")];
    for (const [i, el] of blockEls.entries()) {
      if (el.dataset.dot != null) {
        const r = await dotSvg(decodeURIComponent(el.dataset.dot));
        if (my !== S.seq) return;
        el.innerHTML = r.error ? errorBox(tr("Erro no grafo Graphviz"), r.error) : r.svg;
        enhanceBlock(el, i);
        continue;
      }
      const code = decodeURIComponent(el.dataset.mermaid || "");
      if (detectSub(code) === "mindmap" && S.prefs.layout !== "mermaid") {
        el.classList.add("mm-inline");
        // desenha fora da tela mas dentro do documento: dentro de um <details> fechado o bloco não tem
        // tamanho (no WebKit fica display:none) e os nós sairiam medidos com zero
        const host = document.createElement("div"), stage = document.createElement("div");
        stage.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden";
        stage.appendChild(host); E.doc.appendChild(stage);
        const r = MM.render(host, MM.parse(code), { ...S.prefs, theme: S.theme });
        stage.remove();
        const box = document.createElement("div");
        box.appendChild(host); el.appendChild(box);
        // encaixa na largura com scale() (vetorial; o CSS zoom esbarrava no limite de fonte do WebKit)
        const fitInline = () => {
          const w = el.clientWidth;
          if (!w) return false;
          const s = Math.min(1, w / r.width);
          box.style.cssText = `width:${Math.floor(r.width * s)}px;height:${Math.ceil(r.height * s)}px;margin:0 auto;overflow:hidden;flex:none`;
          host.style.transform = s < 0.999 ? `scale(${s})` : ""; host.style.transformOrigin = "0 0";
          return true;
        };
        if (!fitInline()) {                  // escondido agora: encaixa quando o <details> abrir
          box.style.cssText = `width:${Math.ceil(r.width)}px;height:${Math.ceil(r.height)}px;margin:0 auto;overflow:hidden;flex:none`;
          el._fit = fitInline;
        }
      } else {
        await mermaidInto(el, code, my);
      }
      if (my !== S.seq) return;
      enhanceBlock(el, i);
    }
    // janelas de diagrama abertas: mudanças feitas aqui (ou no disco) vão para elas
    if (S.linked && S.text !== S.quietBlocks) post({ type: "blocks", list: diagramBlocks().map((b) => b.code) });
  }

  /* ---------------- Graphviz (.gv / .dot) ----------------
   * viz-global.js (Graphviz compilado para WebAssembly, ~1,3 MB) só é carregado quando um grafo aparece.
   * As cores do tema entram como atributos padrão (-G/-N/-E): o que o arquivo define continua valendo. */
  let vizLoad = null;
  function loadViz() {
    if (!vizLoad) {
      vizLoad = new Promise((ok, fail) => {
        const sc = document.createElement("script");
        sc.src = vendorUrl("viz-global.js");
        sc.onload = () => window.Viz.instance().then(ok, fail);
        sc.onerror = () => fail(new Error(tr("não foi possível carregar o Graphviz")));
        document.head.appendChild(sc);
      });
      vizLoad.catch(() => { vizLoad = null; });
    }
    return vizLoad;
  }
  const DOT_ENGINES = ["dot", "neato", "fdp", "sfdp", "circo", "twopi", "osage", "patchwork"];
  function dotOptions(code) {
    const dark = S.theme === "dark", font = "Helvetica,Arial,sans-serif";
    const fg = dark ? "#f5f5f7" : "#1c1c1e", line = dark ? "#8e8e93" : "#6e6e73";
    // o motor vem do atributo `layout` do grafo; o Viz.js só olha a opção `engine`
    const m = /\blayout\s*=\s*"?([a-z]+)/i.exec(code), engine = m && m[1].toLowerCase();
    return {
      format: "svg", engine: DOT_ENGINES.includes(engine) ? engine : "dot",
      graphAttributes: { bgcolor: "transparent", fontcolor: fg, fontname: font, color: dark ? "#3a3d4a" : "#c7cad3" },
      nodeAttributes: { color: dark ? "#0A84FF" : "#007AFF", fontcolor: fg, fontname: font },
      edgeAttributes: { color: line, fontcolor: fg, fontname: font, fontsize: 12 },
    };
  }
  async function dotSvg(code) {
    const key = cacheKey("dot\u0002" + code), hit = cacheGet(key);
    if (hit) return { svg: hit };
    let viz;
    try { viz = await loadViz(); } catch (err) { return { error: String(err.message || err) }; }
    let r;
    try { r = viz.render(code, dotOptions(code)); } catch (err) { return { error: String(err.message || err) }; }
    if (r.status !== "success") {
      const msgs = r.errors.filter((e) => e.level === "error").map((e) => e.message);
      return { error: (msgs.length ? msgs : r.errors.map((e) => e.message)).join("\n") || tr("grafo inválido") };
    }
    // sem o prólogo XML; links e atributos perigosos saem pelo DOMPurify
    const svg = DOMPurify.sanitize(r.output.slice(r.output.indexOf("<svg")), { USE_PROFILES: { svg: true, svgFilters: true } });
    cachePut(key, svg);
    return { svg };
  }

  /* ---------------- diagrama (.mmd, .gv) ---------------- */
  async function renderDiagram(my, live, force) {
    const isDot = S.lang === "dot";
    S.sub = isDot ? "graphviz" : detectSub(S.text);
    const c = E.canvas;
    const drawKey = JSON.stringify([S.text, S.theme, S.prefs.layout, S.prefs.levelGap, S.prefs.siblingGap, S.prefs.cardWidth,
      S.prefs.dir, S.prefs.nodeSpacing, S.prefs.rankSpacing]);
    if (!force && drawKey === S.drawKey && c.firstElementChild) return; // nada mudou: não redesenha
    if (S.sub === "mindmap" && S.prefs.layout !== "mermaid") {
      S.drawKey = drawKey; hideSyntaxBadge();
      const parsed = MM.parse(S.text);
      c.innerHTML = "";
      c.className = "editable";
      const host = document.createElement("div");
      c.appendChild(host);
      const r = MM.render(host, parsed, { ...S.prefs, theme: S.theme });
      S.parsed = parsed; S.els = r.els; S.bounds = { w: r.width, h: r.height }; S.zoomed = null;
      applySelection();
      return;
    }
    const code = S.sub === "flowchart" && S.prefs.dir ? setFlowDir(S.text, S.prefs.dir) : S.text;
    const r = isDot ? await dotSvg(code) : await mermaidSvg(code, my);
    if (my !== S.seq || r.stale) return "kept";
    if (r.error && live && c.querySelector(".mermaid-host svg")) {
      showSyntaxBadge(r.error); // digitando: o último diagrama válido continua na tela
      return "kept";
    }
    hideSyntaxBadge();
    S.drawKey = drawKey;
    S.parsed = null; S.els = null; hideNodeBar();
    const tmp = document.createElement("div");
    tmp.className = isDot ? "mermaid-host gv" : "mermaid-host";
    const ok = !r.error;
    tmp.innerHTML = ok ? r.svg : errorBox(tr(isDot ? "Erro no grafo Graphviz" : "Erro no diagrama Mermaid"), r.error);
    c.className = ""; c.innerHTML = ""; c.appendChild(tmp);
    S.zoomed = null;
    const svg = tmp.querySelector("svg");
    const vb = ok && svg && svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width) {
      svg.style.maxWidth = "none";
      svg.setAttribute("width", vb.width); svg.setAttribute("height", vb.height);
      S.bounds = { w: vb.width, h: vb.height };
    } else {
      S.bounds = { w: tmp.offsetWidth || 600, h: tmp.offsetHeight || 120 };
    }
  }

  async function draw(o = {}) {
    const my = ++S.seq;
    await fontsReady;
    if (my !== S.seq) return;
    if (S.kind === "md") {
      const y = E.docScroll.scrollTop;
      E.doc.style.zoom = S.mdZoom;
      await renderMarkdown(my);
      if (my !== S.seq) return;
      E.docScroll.scrollTop = o.fit ? 0 : y;
    } else if (S.kind === "mmd") {
      const t0 = performance.now();
      const r = await renderDiagram(my, o.live, o.force);
      if (my !== S.seq) return;
      if (r !== "kept") S.lastDrawMs = performance.now() - t0;
      if (o.fit || !S.hasFit) fit(); else applyView();
    } else if (S.kind === "txt") {
      E.doc.innerHTML = `<pre class="txt-print">${escapeHtml(S.text)}</pre>`;
    }
    buildDock();
  }
  /* espera adaptativa ao digitar: diagramas pesados só redesenham depois de uma pausa maior */
  function scheduleLiveDraw() {
    clearTimeout(S.drawT);
    S.drawT = setTimeout(() => draw({ live: true }), Math.round(clamp((S.lastDrawMs || 0) * M().liveMul, 150, 1500)));
  }
  function showSyntaxBadge(err) {
    const b = $("syntax-badge");
    const msg = String((err && (err.message || err.str)) || err).split("\n").slice(0, 3).join("\n");
    b.querySelector("span").textContent = msg + "\n" + tr("(mostrando a última versão válida)");
    b.hidden = false;
  }
  function hideSyntaxBadge() { $("syntax-badge").hidden = true; }

  /* ---------------- modos de renderização ----------------
   * Todos animam na taxa do monitor: mover/escalar a camada do mapa é só composição na GPU (medido
   * na janela GTK: 60 fps sem perda nos três modos). O caro é redesenhar o mapa nítido depois do
   * zoom (20–45 ms numa RX 6700 XT, janela maximizada), então é nisso que os modos diferem.
   * `settle` = quanto tempo sem gesto antes de redesenhar nítido.
   * desempenho: sem sombras/vidro (redesenho mais barato) e espera mais, para não redesenhar entre
   *             um clique e outro da roda. Limitar a 30 fps não poupava nada e travava a imagem.
   * equilibrado: o padrão.
   * qualidade:  segue o mouse mais de perto e fica nítido mais cedo.
   * Sem supersampling: rasterizar 2× dobrava o custo do redesenho (até 90 ms, quadros perdidos) e,
   * depois de assentado, o texto em 1× já é o mais nítido. */
  const MODES = {
    performance: { tauZoom: 80, tauPan: 70, tauDrag: 30, glide: 300, settle: 320, liveMul: 1.8, fx: false },
    balanced:    { tauZoom: 80, tauPan: 70, tauDrag: 30, glide: 325, settle: 200, liveMul: 1.3, fx: true },
    // tauZoom igual ao equilibrado: com 55 ms o zoom mudava tanto por quadro que o WebKit precisava
    // rasterizar área nova demais de uma vez e perdia ~1 quadro por gesto (medido na janela GTK)
    quality:     { tauZoom: 80, tauPan: 50, tauDrag: 22, glide: 380, settle: 160, liveMul: 0.9, fx: true },
  };
  const MODE_NAMES = { performance: "Desempenho", balanced: "Equilibrado", quality: "Qualidade" };
  S.detected = { mode: "balanced", label: "" };
  /* a camada nativa manda a placa e o motivo da escolha como dados; o texto é montado aqui, no idioma
   * da interface (resultados guardados por versões antigas só trazem `label`, já em português) */
  const REASONS = {
    "no-gpu": "sem aceleração de GPU", dedicated: "GPU dedicada", "dedicated-modest": "GPU dedicada, CPU/RAM modestas",
    integrated: "GPU integrada", "integrated-modest": "GPU integrada e máquina modesta", "unknown-gpu": "GPU não identificada",
    modest: "máquina modesta",
  };
  function detectedLabel() {
    const d = S.detected;
    if (!(d.reason in REASONS)) return d.label || "";
    return [d.gpu || tr("GPU não identificada"), tr("{n} núcleos", { n: d.cores }), `${d.ramGB} GB`, tr(REASONS[d.reason])].join(" · ");
  }
  const modeName = () => (S.prefs.renderMode in MODES ? S.prefs.renderMode : S.detected.mode in MODES ? S.detected.mode : "balanced");
  const M = () => MODES[modeName()];
  function applyMode() {
    body.classList.toggle("fx-lite", !M().fx);
    if (E.canvas.firstElementChild) applyView();
  }

  /* ---------------- pan / zoom ---------------- */
  function stageSize() { const r = E.stage.getBoundingClientRect(); return { W: r.width, H: r.height, L: r.left, T: r.top }; }
  function fit(animate) {
    const { W, H } = stageSize(), { w, h } = S.bounds;
    if (!w || !h || !W) return;
    const usableH = H - 80;
    const s = clamp(Math.min((W - 48) / w, (usableH - 32) / h), 0.08, 1.4);
    const v = { s, x: (W - w * s) / 2, y: Math.max(16, (usableH - h * s) / 2) };
    S.hasFit = true;
    if (animate) setGoal(v, { tau: 110 });
    else { S.zoomed = s; jumpView(v); }
  }

  /* ---------------- movimento suave ----------------
   * S.view é o que está na tela; S.goal é para onde o usuário mandou ir. Cada entrada (roda, arrastar,
   * botões) só mexe no alvo, e um laço por quadro aproxima a vista dele com uma curva exponencial
   * (constante de tempo `tau`). Roda em "cliques" e mouse trêmulo viram um movimento contínuo.
   * No zoom, o ponto do mapa sob o cursor fica parado durante toda a animação. Ao soltar um arraste,
   * a velocidade vira inércia: o alvo continua deslizando e desacelera como no iOS. */
  const motion = { raf: 0, last: 0, tau: 80, ax: null, ay: null, momentum: null };
  const goal = () => S.goal || (S.goal = { ...S.view });
  function setGoal(g, o = {}) {
    S.goal = g; motion.tau = o.tau || 80; motion.ax = o.ax ?? null; motion.ay = o.ay ?? null;
    noteInput();                           // alvo novo (roda, botão, encaixar) adia o redesenho nítido
    if (!motion.raf) { motion.last = performance.now(); motion.raf = requestAnimationFrame(tick); }
  }
  function jumpView(v) {
    motion.momentum = null; if (motion.raf) cancelAnimationFrame(motion.raf); motion.raf = 0;
    S.view = { ...v }; S.goal = { ...v }; applyView();
  }
  function shiftView(dx, dy) {           // desloca vista e alvo juntos (sem animar)
    S.view.x += dx; S.view.y += dy;
    if (S.goal) { S.goal.x += dx; S.goal.y += dy; }
    applyView();
  }
  function tick(now) {
    motion.raf = 0;
    const v = S.view, g = S.goal;
    if (!g) return;
    const dt = Math.min(50, Math.max(1, now - motion.last)); motion.last = now;
    const m = motion.momentum;
    if (m) {                               // inércia empurra o alvo e vai perdendo força
      g.x += m.vx * dt; g.y += m.vy * dt;
      const f = Math.exp(-dt / M().glide); m.vx *= f; m.vy *= f;
      if (Math.hypot(m.vx, m.vy) < 0.015) motion.momentum = null;
    }
    const k = 1 - Math.exp(-dt / motion.tau);
    const { W, H } = stageSize();
    const ax = motion.ax ?? W / 2, ay = motion.ay ?? H / 2;
    // escala em espaço logarítmico; posição pelo ponto do mapa sob a âncora (cursor ou centro)
    const ns = Math.exp(Math.log(v.s) + (Math.log(g.s) - Math.log(v.s)) * k);
    const wx0 = (ax - v.x) / v.s, wy0 = (ay - v.y) / v.s, wx1 = (ax - g.x) / g.s, wy1 = (ay - g.y) / g.s;
    const wx = wx0 + (wx1 - wx0) * k, wy = wy0 + (wy1 - wy0) * k;
    v.s = ns; v.x = ax - wx * ns; v.y = ay - wy * ns;
    const done = !motion.momentum && Math.abs(Math.log(g.s / v.s)) < 1e-3 &&
      Math.abs(g.x - v.x) < 0.25 && Math.abs(g.y - v.y) < 0.25;
    if (done) { v.x = g.x; v.y = g.y; v.s = g.s; }
    applyView();
    if (!done) motion.raf = requestAnimationFrame(tick);
  }
  /* Nitidez: o nível de zoom "assentado" (S.zoomed) vai em CSS `zoom`, que o WebKit re-renderiza na
   * resolução real. Durante a roda/pinça só ajustamos um scale() temporário (rápido) e, ao parar,
   * assentamos o novo zoom. Assim o texto nunca fica como um bitmap ampliado. */
  /* O WebKit não desenha texto com zoom abaixo de ~9px (13px × 0,38 = 4,9px vira 9px): o texto
   * fica quase 2× maior que o layout e os cartões se sobrepõem. Então o CSS zoom nunca desce de
   * 0,75; o resto da redução é um scale(), que é desenhado vetorialmente e não sofre esse limite. */
  /* Dois níveis: o conteúdo é desenhado nítido no zoom "assentado" (S.zoomed: CSS zoom ≥ 0,75 +
   * scale() no resto, dentro da camada). #canvas é uma camada de GPU: arrastar só a move, e durante
   * a pinça/roda só ela é escalada (a GPU estica o que já está desenhado, sem repintar). Ao parar,
   * o novo zoom é assentado e o conteúdo é redesenhado nítido uma única vez. */
  let crispT = 0, settledInner = null, settledZoom = null;
  function applyView() {
    const v = S.view, inner = E.canvas.firstElementChild;
    if (inner) {
      if (S.zoomed == null) S.zoomed = v.s;
      if (inner !== settledInner || S.zoomed !== settledZoom) settleInner(inner);
    }
    const t = inner ? v.s / S.zoomed : 1;    // escala temporária, feita pela GPU sobre o já desenhado
    E.canvas.style.transform = `translate(${Math.round(v.x)}px, ${Math.round(v.y)}px)` +
      (Math.abs(t - 1) < 1e-4 ? "" : ` scale(${t})`);
    clearTimeout(crispT);
    if (inner && S.zoomed !== goal().s) crispT = setTimeout(settleWhenIdle, Math.max(0, idleNeeded() - (performance.now() - lastInputAt)));
    updateZoomLabel();
    positionNodeBar();
  }
  /* Assentar = só um scale() no conteúdo, desenhado vetorialmente dentro da camada do #canvas:
   * nítido em qualquer zoom, sem recalcular layout (o CSS zoom recalculava ~800 elementos, ~100 ms)
   * e sem o limite de ~9px de fonte do WebKit (que fazia os cartões se sobreporem). */
  /* Quando redesenhar nítido: `settle` ms depois do último gesto (roda, arraste, botão), sem esperar
   * a animação terminar, e já no zoom de DESTINO. O resto da animação só escala a camada nova até
   * 1:1, então ela termina nítida, sem um segundo redesenho. (Antes o relógio recomeçava a cada
   * quadro da animação: o mapa ficava borrado 0,5–1,3 s depois de cada zoom.)
   * Cliques da roda e botões +/− chegam a cada 100–250 ms: depois deles a espera é de pelo menos
   * NOTCH_HOLD, senão o redesenho (~25 ms) cairia entre um clique e outro, no meio do movimento.
   * A pinça do touchpad manda eventos contínuos, então o fim dela é detectado bem mais cedo. */
  const NOTCH_HOLD = 280;
  let lastInputAt = 0, inputHold = 0;
  function noteInput(hold) { lastInputAt = performance.now(); if (hold !== undefined) inputHold = hold; }
  const idleNeeded = () => Math.max(M().settle, inputHold);
  function settleWhenIdle() {
    const wait = idleNeeded() - (performance.now() - lastInputAt);
    if (wait > 0) { crispT = setTimeout(settleWhenIdle, wait + 5); return; }
    if (S.zoomed !== goal().s) { S.zoomed = goal().s; applyView(); }
  }
  function settleInner(inner) {
    inner.style.zoom = "";
    inner.style.transform = Math.abs(S.zoomed - 1) < 1e-4 ? "" : `scale(${S.zoomed})`;
    settledInner = inner; settledZoom = S.zoomed;
  }
  function zoomAt(f, cx, cy, smooth) {
    const g = goal(), ns = clamp(g.s * f, 0.08, 4), k = ns / g.s;
    setGoal({ s: ns, x: cx - (cx - g.x) * k, y: cy - (cy - g.y) * k }, { tau: smooth ? M().tauZoom : M().tauZoom * 1.5, ax: cx, ay: cy });
  }
  function zoomBy(d) {
    if (S.kind === "txt") return;
    if (S.kind === "md") {
      const i = MD_ZOOM.findIndex((z) => z >= S.mdZoom - 1e-3);
      S.mdZoom = d === 0 ? 1 : MD_ZOOM[clamp((i < 0 ? 4 : i) + (d > 0 ? 1 : -1), 0, MD_ZOOM.length - 1)];
      E.doc.style.zoom = S.mdZoom;
      updateZoomLabel();
      return;
    }
    const { W, H } = stageSize();
    noteInput(NOTCH_HOLD);
    if (d === 0) zoomAt(1 / goal().s, W / 2, H / 2);
    else zoomAt(d > 0 ? 1.2 : 1 / 1.2, W / 2, H / 2);
  }
  function updateZoomLabel() {
    const l = E.dock.querySelector(".zoom-label");
    if (l) l.textContent = Math.round((S.kind === "md" ? S.mdZoom : S.view.s) * 100) + "%";
  }

  E.stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    // clique de roda (passo grande/em linhas) × pinça ou rolagem contínua do touchpad (passos pequenos)
    noteInput(e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50 || Math.abs(e.deltaX) >= 50 ? NOTCH_HOLD : 0);
    const { L, T } = stageSize();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-clamp(e.deltaY, -60, 60) * 0.004), e.clientX - L, e.clientY - T, true);
    } else {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 18; dy *= 18; }
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      const g = goal();
      setGoal({ ...g, x: g.x - dx, y: g.y - dy }, { tau: M().tauPan });
    }
  }, { passive: false });
  E.docScroll.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) > 2) zoomBy(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  let pan = null, drag = null, lastClick = { id: null, t: 0 };
  E.stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#node-bar")) return;
    if (e.button !== 0 && e.button !== 1) return;
    closePopover();
    const nodeEl = e.target.closest(".mm-node");
    if (nodeEl && nodeEl.classList.contains("editing")) return;
    if (S.editing) commitRename();
    if (nodeEl && S.parsed && e.button === 0) {
      jumpView(goal());                    // para qualquer deslize antes de arrastar um nó
      drag = { node: S.parsed.nodes[+nodeEl.dataset.id], el: nodeEl, x0: e.clientX, y0: e.clientY, moving: false, target: null };
    } else {
      motion.momentum = null;
      const g = goal();
      pan = { x: e.clientX, y: e.clientY, vx: g.x, vy: g.y, moved: false, samples: [[performance.now(), e.clientX, e.clientY]] };
      E.stage.classList.add("panning");
    }
    E.stage.setPointerCapture(e.pointerId);
  });
  E.stage.addEventListener("pointermove", (e) => {
    if (pan || drag) noteInput();
    if (pan) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      const t = performance.now();
      pan.samples.push([t, e.clientX, e.clientY]);
      while (pan.samples.length > 2 && t - pan.samples[0][0] > 100) pan.samples.shift();
      setGoal({ ...goal(), x: pan.vx + dx, y: pan.vy + dy }, { tau: M().tauDrag });
    } else if (drag) {
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moving) {
        if (Math.hypot(dx, dy) < 6 || !drag.node.parent) return;
        drag.moving = true; drag.el.classList.add("dragging"); hideNodeBar();
      }
      drag.el.style.transform = `translate(${dx / S.view.s}px, ${dy / S.view.s}px)`;
      drag.el.style.pointerEvents = "none";
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      drag.el.style.pointerEvents = "";
      const tEl = hit && hit.closest(".mm-node");
      const t = tEl ? S.parsed.nodes[+tEl.dataset.id] : null;
      const valid = t && t !== drag.node && t !== drag.node.parent && !MM.isAncestor(drag.node, t);
      if (drag.target && drag.target !== tEl) drag.target.classList.remove("drop-target");
      drag.target = valid ? tEl : null;
      if (drag.target) drag.target.classList.add("drop-target");
    }
  });
  function endPointer() {
    if (pan) {
      if (!pan.moved) select(null);
      else {                               // velocidade dos últimos ~100 ms → inércia
        const sm = pan.samples, a = sm[0], b = sm[sm.length - 1], dt = b[0] - a[0];
        const idle = performance.now() - b[0];
        if (dt > 10 && idle < 60) {
          const vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt;
          if (Math.hypot(vx, vy) > 0.25) { motion.momentum = { vx, vy }; setGoal(goal(), { tau: M().tauDrag }); }
        }
      }
      pan = null; E.stage.classList.remove("panning");
    } else if (drag) {
      const d = drag; drag = null;
      if (d.moving) {
        d.el.classList.remove("dragging"); d.el.style.transform = "";
        if (d.target) {
          d.target.classList.remove("drop-target");
          applyOp(MM.ops.move(S.parsed, d.node, S.parsed.nodes[+d.target.dataset.id]));
        } else positionNodeBar();
      } else {
        const now = Date.now();
        const dbl = lastClick.id === d.node.id && now - lastClick.t < 380;
        lastClick = { id: d.node.id, t: now };
        select(d.node.line, true);
        if (dbl) beginRename(d.node.line);
      }
    }
  }
  E.stage.addEventListener("pointerup", endPointer);
  E.stage.addEventListener("pointercancel", endPointer);

  /* ---------------- seleção e barra do nó ---------------- */
  const nodeByLine = (line) => (S.parsed ? S.parsed.nodes.find((n) => n.line === line) : null) || null;
  function select(line, fromDiagram) {
    S.selected = line;
    applySelection();
    if (fromDiagram && line != null && S.editorOpen) revealLine(line);
    if (fromDiagram && line != null && S.detached) post({ type: "reveal", line });
  }
  function applySelection() {
    if (!S.els) return;
    for (const n of S.parsed.nodes) S.els.get(n.id).classList.toggle("selected", n.line === S.selected);
    positionNodeBar();
  }
  function hideNodeBar() { E.nodeBar.hidden = true; }
  function positionNodeBar() {
    const n = nodeByLine(S.selected);
    if (!n || S.editing || drag?.moving || S.kind !== "mmd") return hideNodeBar();
    const el = S.els.get(n.id), v = S.view;
    if (E.nodeBar.dataset.for !== String(n.id) || E.nodeBar.hidden) {
      E.nodeBar.innerHTML =
        `<button class="icon-btn" data-op="addChild" title="${tr("Adicionar filho (Tab)")}">${icon("child")}${tr("Filho")}</button>` +
        (n.parent ? `<button class="icon-btn" data-op="addSibling" title="${tr("Adicionar irmão (Enter)")}">${icon("sibling")}${tr("Irmão")}</button>` : "") +
        `<button class="icon-btn" data-op="rename" title="${tr("Renomear (F2 ou duplo clique)")}">${icon("pencil")}</button>` +
        (n.parent ? `<button class="icon-btn danger" data-op="remove" title="${tr("Excluir com os filhos (Delete)")}">${icon("trash")}</button>` : "");
      E.nodeBar.dataset.for = n.id;
    }
    E.nodeBar.hidden = false;
    const bw = E.nodeBar.offsetWidth, bh = E.nodeBar.offsetHeight;
    const x = v.x + (n.left + n.w / 2) * v.s;
    let y = v.y + n.top * v.s - bh - 10;
    if (y < 8) y = v.y + (n.top + n.h) * v.s + 10;
    E.nodeBar.style.left = Math.round(x - bw / 2) + "px"; E.nodeBar.style.top = Math.round(y) + "px";
  }
  E.nodeBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-op]"), n = nodeByLine(S.selected);
    if (!b || !n) return;
    const op = b.dataset.op;
    if (op === "rename") beginRename(n.line);
    else applyOp(MM.ops[op](S.parsed, n));
  });

  /* ---------------- edição do mapa ---------------- */
  function applyOp(res, opts = {}) {
    if (!res) return;
    setText(res.text, { history: !opts.noHistory });
    S.selected = res.line;
    hideNodeBar();
    draw().then(() => {
      if (res.rename) beginRename(res.line, true);
      else ensureVisible(res.line);
      if (S.editorOpen) revealLine(res.line);
    });
  }
  function beginRename(line, isNew) {
    const n = nodeByLine(line);
    if (!n) return;
    const el = S.els.get(n.id), label = el.querySelector(".mm-label");
    S.editing = { line, isNew: !!isNew, original: n.text, el, label };
    hideNodeBar();
    ensureVisible(line);
    el.classList.add("editing");
    label.textContent = n.text;
    try { label.contentEditable = "plaintext-only"; } catch (_) { label.contentEditable = "true"; }
    label.focus();
    const r = document.createRange(); r.selectNodeContents(label);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    label.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitRename(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
      else if (e.key === "Tab") { e.preventDefault(); commitRename("addChild"); }
    };
    label.onblur = () => commitRename();
  }
  function commitRename(then) {
    const ed = S.editing;
    if (!ed) return;
    S.editing = null;
    ed.label.onblur = ed.label.onkeydown = null;
    ed.label.contentEditable = "false";
    const text = ed.label.innerText.replace(/\s*\n\s*/g, " ").trim();
    const n = nodeByLine(ed.line);
    if (!n) return;
    if (!text || text === ed.original) {
      if (then) applyOp(MM.ops[then](S.parsed, n)); else draw({ force: true });
      return;
    }
    const res = MM.ops.rename(S.parsed, n, text);
    setText(res.text, { history: !ed.isNew });
    S.selected = res.line;
    draw().then(() => {
      if (then) { const m = nodeByLine(res.line); if (m) applyOp(MM.ops[then](S.parsed, m)); }
      else if (S.editorOpen) revealLine(res.line);
    });
  }
  function cancelRename() {
    if (!S.editing) return;
    const ed = S.editing; S.editing = null;
    ed.label.onblur = ed.label.onkeydown = null;
    draw({ force: true });
  }
  function ensureVisible(line) {
    const n = nodeByLine(line);
    if (!n || !S.els) return;
    const el = S.els.get(n.id), v = S.view, { W, H } = stageSize();
    const x1 = v.x + n.left * v.s, y1 = v.y + n.top * v.s;
    const x2 = x1 + n.w * v.s, y2 = y1 + n.h * v.s, M = 60;
    let dx = 0, dy = 0;
    if (x1 < M) dx = M - x1; else if (x2 > W - M) dx = W - M - x2;
    if (y1 < M) dy = M - y1; else if (y2 > H - 100) dy = H - 100 - y2;
    if (dx || dy) { const g = goal(); setGoal({ ...g, x: g.x + dx, y: g.y + dy }, { tau: 120 }); }
  }
  function navigate(n, key) {
    const c = (m) => [m.left + m.w / 2, m.top + m.h / 2];
    const [cx, cy] = c(n);
    let best = null, bestScore = Infinity;
    for (const m of S.parsed.nodes) {
      if (m === n) continue;
      const [mx, my] = c(m), dx = mx - cx, dy = my - cy;
      const prim = key === "ArrowRight" ? dx : key === "ArrowLeft" ? -dx : key === "ArrowDown" ? dy : -dy;
      const sec = key === "ArrowRight" || key === "ArrowLeft" ? dy : dx;
      if (prim <= 4) continue;
      const score = prim + 2.5 * Math.abs(sec);
      if (score < bestScore) { bestScore = score; best = m; }
    }
    if (best) { select(best.line, true); ensureVisible(best.line); }
  }

  /* ---------------- texto, histórico, sujo ---------------- */
  function setDirty(d) {
    if (S.block) return syncBlock();    // o diagrama de um .md não tem arquivo: quem fica sujo é o .md
    if (d !== S.dirty) { S.dirty = d; post({ type: "dirty", value: d }); }
  }
  function syncBlock() {
    clearTimeout(S.blockT);
    S.blockT = setTimeout(() => {
      if (S.text !== S.blockSent) { S.blockSent = S.text; post({ type: "blockEdit", text: S.text }); }
    }, 150);
  }
  function setText(t, { history }) {
    if (history) pushHistory(S.text);
    S.text = t;
    syncEditor();
    setDirty(S.text !== S.saved);
    notifySource();
  }
  /* mantém a janela de código separada em dia com qualquer mudança feita aqui */
  function notifySource() { if (S.detached) post({ type: "source", text: S.text }); }
  function pushHistory(t) { S.history.push(t); if (S.history.length > 300) S.history.shift(); S.future.length = 0; }
  function undo() {
    if (S.editing) cancelRename();
    if (!S.history.length) return toast(tr("Nada para desfazer"));
    S.future.push(S.text); S.text = S.history.pop(); S.typing = false;
    syncEditor(); setDirty(S.text !== S.saved); notifySource(); draw();
  }
  function redo() {
    if (!S.future.length) return toast(tr("Nada para refazer"));
    S.history.push(S.text); S.text = S.future.pop(); S.typing = false;
    syncEditor(); setDirty(S.text !== S.saved); notifySource(); draw();
  }

  /* ---------------- editor de código ---------------- */
  const LH = 20, PADT = 12, GUTTER = 46; // iguais ao CSS (px inteiros)
  function syncEditor() {
    if (E.src.value !== S.text) {
      const { selectionStart: a, selectionEnd: b } = E.src;
      E.src.value = S.text;
      E.src.setSelectionRange(Math.min(a, S.text.length), Math.min(b, S.text.length));
    }
    updateGutter(); updateHl();
  }
  let gutterN = 0;
  function updateGutter() {
    const n = E.src.value.split("\n").length;
    if (n !== gutterN) {
      gutterN = n;
      let s = ""; for (let i = 1; i <= n; i++) s += i + "\n";
      E.gutter.textContent = s;
    }
    sizeEditor();
  }
  /* o <textarea> do tamanho do texto: quem rola é a .ed-body (ver o CSS) */
  function sizeEditor() {
    const avail = Math.max(0, E.scroll.clientWidth - GUTTER);
    // uma linha a mais de folga: o Enter na última linha não chega a rolar o textarea por dentro
    E.src.style.height = (gutterN + 1) * LH + 2 * PADT + "px";
    E.src.style.width = avail + "px";
    const w = E.src.scrollWidth;
    if (w > avail) E.src.style.width = w + 4 * LH + "px";     // folga para digitar no fim da linha
    if (E.src.scrollTop || E.src.scrollLeft) { E.src.scrollTop = 0; E.src.scrollLeft = 0; }
  }
  let sizeRaf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(sizeRaf); sizeRaf = requestAnimationFrame(sizeEditor); }).observe(E.scroll);
  function caretLine() {
    const v = E.src.value, p = E.src.selectionStart;
    const line = v.slice(0, p).split("\n").length - 1;
    return { line, col: p - (v.lastIndexOf("\n", p - 1) + 1) };
  }
  function updateHl() {
    const { line, col } = caretLine();
    E.hl.style.top = PADT + line * LH + "px";
    E.pos.textContent = `Ln ${line + 1}, Col ${col + 1}`;
  }
  function lineStart(text, line) { let p = 0; for (let i = 0; i < line; i++) { p = text.indexOf("\n", p) + 1; if (!p) return text.length; } return p; }
  function scrollToLine(line) {
    const top = PADT + line * LH, h = E.scroll.clientHeight, st = E.scroll.scrollTop;
    if (top < st + LH || top > st + h - 3 * LH) E.scroll.scrollTop = Math.max(0, top - h / 3);
  }
  /* mantém o cursor à vista ao digitar ou andar com as setas (o textarea não rola mais sozinho) */
  let charW = 0;
  function monoW() {                     // largura de um caractere da fonte do editor (monoespaçada)
    if (!charW) { const c = document.createElement("canvas").getContext("2d"); c.font = getComputedStyle(E.src).font; charW = c.measureText("0").width || 7.5; }
    return charW;
  }
  function revealCaret() {
    const v = E.src.value, p = E.src.selectionDirection === "backward" ? E.src.selectionStart : E.src.selectionEnd;
    const ls = v.lastIndexOf("\n", p - 1) + 1, line = v.slice(0, p).split("\n").length - 1;
    const top = PADT + line * LH, h = E.scroll.clientHeight, st = E.scroll.scrollTop;
    if (top < st) E.scroll.scrollTop = top - PADT;
    else if (top + LH > st + h) E.scroll.scrollTop = top + LH + PADT - h;
    const x = 14 + (p - ls) * monoW(), w = E.scroll.clientWidth - GUTTER, sl = E.scroll.scrollLeft;
    if (x < sl + 8) E.scroll.scrollLeft = Math.max(0, x - w / 3);
    else if (x > sl + w - 16) E.scroll.scrollLeft = x - w + w / 3;
  }
  document.addEventListener("selectionchange", () => { if (document.activeElement === E.src) { updateHl(); revealCaret(); } });
  function revealLine(line) {
    const p = lineStart(E.src.value, line);
    E.src.setSelectionRange(p, p);
    scrollToLine(line);
    updateGutter(); updateHl();
  }
  function onEditorChange() {
    if (EDITOR_ONLY) {
      S.text = E.src.value; updateGutter(); updateHl(); revealCaret();
      post({ type: "edit", text: S.text });
      return;
    }
    const prev = S.text;
    if (!S.typing) pushHistory(prev);
    S.typing = true;
    clearTimeout(S.typeT); S.typeT = setTimeout(() => (S.typing = false), 900);
    S.text = E.src.value;
    setDirty(S.text !== S.saved);
    updateGutter(); updateHl(); revealCaret();
    scheduleLiveDraw();
  }
  E.src.addEventListener("input", onEditorChange);
  // o textarea não deve rolar por dentro (quem rola é a .ed-body); se o navegador rolar, desfaz
  E.src.addEventListener("scroll", () => { if (E.src.scrollTop || E.src.scrollLeft) { E.src.scrollTop = 0; E.src.scrollLeft = 0; } });
  let lastCaretLine = -1;
  const caretSync = () => {
    updateHl();
    if (EDITOR_ONLY) {
      const { line } = caretLine();
      if (line !== lastCaretLine) { lastCaretLine = line; post({ type: "caret", line }); }
      return;
    }
    if (S.parsed) { const { line } = caretLine(); if (nodeByLine(line) && S.selected !== line) { S.selected = line; applySelection(); } }
  };
  ["keyup", "click", "select"].forEach((ev) => E.src.addEventListener(ev, caretSync));
  E.src.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (EDITOR_ONLY && mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); post({ type: e.shiftKey ? "redo" : "undo" }); return; }
    if (EDITOR_ONLY && mod && e.key === "y") { e.preventDefault(); post({ type: "redo" }); return; }
    if (EDITOR_ONLY && mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); post({ type: "save" }); return; }
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key === "y") { e.preventDefault(); redo(); return; }
    if (e.key === "Enter" && !mod) {
      e.preventDefault();
      const v = E.src.value, p = E.src.selectionStart, ls = v.lastIndexOf("\n", p - 1) + 1;
      const ws = v.slice(ls).match(/^[ \t]*/)[0];
      document.execCommand("insertText", false, "\n" + ws);
      return;
    }
    if ((e.key === "PageDown" || e.key === "PageUp") && !mod && !e.altKey) {
      // o textarea tem a altura do texto, então "uma página" é a altura visível da .ed-body
      e.preventDefault();
      const v = E.src.value, dir = e.key === "PageDown" ? 1 : -1;
      const back = E.src.selectionDirection === "backward";
      const focus = back ? E.src.selectionStart : E.src.selectionEnd, anchor = back ? E.src.selectionEnd : E.src.selectionStart;
      const ls = v.lastIndexOf("\n", focus - 1) + 1, line = v.slice(0, focus).split("\n").length - 1;
      const page = Math.max(1, Math.floor(E.scroll.clientHeight / LH) - 2);
      const to = clamp(line + dir * page, 0, gutterN - 1), ts = lineStart(v, to), te = v.indexOf("\n", ts);
      const p = Math.min(ts + (focus - ls), te < 0 ? v.length : te);
      if (e.shiftKey) E.src.setSelectionRange(Math.min(anchor, p), Math.max(anchor, p), p < anchor ? "backward" : "forward");
      else E.src.setSelectionRange(p, p);
      E.scroll.scrollTop += (to - line) * LH;
      caretSync();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const v = E.src.value, a = E.src.selectionStart, b = E.src.selectionEnd;
      if (!e.shiftKey && a === b) { document.execCommand("insertText", false, "  "); return; }
      const ls = v.lastIndexOf("\n", a - 1) + 1, le = v.indexOf("\n", b - (b > a && v[b - 1] === "\n" ? 1 : 0));
      const end = le < 0 ? v.length : le;
      const block = v.slice(ls, end).split("\n");
      const out = block.map((l) => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, "") : "  " + l)).join("\n");
      E.src.setSelectionRange(ls, end);
      document.execCommand("insertText", false, out);
      E.src.setSelectionRange(ls, ls + out.length);
    }
  });

  const editorWidth = () => Math.round(clamp(S.prefs.editorWidth, 240, Math.max(240, innerWidth * 0.45)));
  function setEditorOffset() {
    const w = editorWidth();
    document.documentElement.style.setProperty("--ed-w", w + "px");
    document.documentElement.style.setProperty("--ed-offset", (S.editorOpen && S.kind ? w + 20 : 0) + "px");
  }
  function toggleEditor(force) {
    if (!S.kind || S.kind === "txt") return;
    const open = typeof force === "boolean" ? force : !S.editorOpen;
    if (open === S.editorOpen) return;
    S.editorOpen = open;
    body.classList.toggle("editor-open", open);
    setEditorOffset();
    animatePanel(open);
    if (open) {
      syncEditor();
      if (S.selected != null) revealLine(S.selected);
      E.src.focus({ preventScroll: true });
    }
    buildDock();
  }
  /* O painel desliza por cima (CSS, só transform). O conteúdo acompanha no #view e o último quadro
   * tem de ser idêntico ao layout final, senão o conteúdo "pula" quando a área muda de tamanho:
   * - diagrama, e Markdown cuja coluna cabe na área menor: transform no #view, e o layout real muda
   *   UMA vez (no fim ao abrir, no início ao fechar), com a vista compensada. No diagrama, um recorte
   *   avança junto com o painel, para os cartões que ficariam atrás dele não sumirem de uma vez no fim;
   * - Markdown cuja coluna precisa estreitar: anima a borda esquerda de verdade e o texto reflui
   *   durante o movimento (só com transform, a largura nova entraria toda no último quadro). */
  const PANEL_MS = 440, SPRING = "cubic-bezier(.32, .72, 0, 1)";
  let panelDone = null;
  function mdNarrows(off) {              // a coluna do Markdown fica mais estreita com o editor aberto?
    const cs = getComputedStyle(E.docScroll);
    const avail = E.docScroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return avail - off < E.doc.getBoundingClientRect().width - 0.5;
  }
  function animatePanel(open) {
    if (panelDone) panelDone();
    const off = editorWidth() + 20, half = off / 2;
    const dockFrom = E.dock.getBoundingClientRect().left;
    if (open) body.classList.add("ed-opening");          // mantém a área larga durante a animação
    let frames;
    if (S.kind === "md" && mdNarrows(off)) frames = [{ left: "0px" }, { left: off + "px" }];
    else if (S.kind === "mmd") frames = [{ transform: "translateX(0)", clipPath: "inset(0)" },
      { transform: `translateX(${half}px)`, clipPath: `inset(0 0 0 ${half}px)` }];
    else frames = [{ transform: "translateX(0)" }, { transform: `translateX(${half}px)` }];
    let anim;
    if (open) {
      anim = E.view.animate(frames, { duration: PANEL_MS, easing: SPRING, fill: "forwards" });
      panelDone = () => {
        panelDone = null;
        body.classList.remove("ed-opening");               // agora sim encolhe a área (1 layout)
        if (S.kind === "mmd") shiftView(-half, 0);
        anim.cancel();
        placeDock();
      };
    } else {
      if (S.kind === "mmd") shiftView(half, 0);
      anim = E.view.animate(frames.reverse(), { duration: PANEL_MS, easing: SPRING });
      panelDone = () => { panelDone = null; anim.cancel(); };
    }
    anim.onfinish = () => panelDone && panelDone();
    placeDock();
    const dockTo = E.dock.getBoundingClientRect().left;
    if (!body.classList.contains("dock-autohide") && Math.abs(dockTo - dockFrom) > 0.5) {
      E.dock.animate([{ translate: `${dockFrom - dockTo}px 0` }, { translate: "0 0" }], { duration: PANEL_MS, easing: SPRING });
    }
  }
  E.resizer.addEventListener("pointerdown", (e) => {
    E.resizer.setPointerCapture(e.pointerId);
    body.classList.add("resizing");
    const move = (ev) => { S.prefs.editorWidth = Math.round(clamp(ev.clientX - 10, 240, innerWidth * 0.75)); setEditorOffset(); placeDock(); positionNodeBar(); };
    const up = () => { body.classList.remove("resizing"); E.resizer.removeEventListener("pointermove", move); E.resizer.removeEventListener("pointerup", up); savePrefs(); };
    E.resizer.addEventListener("pointermove", move);
    E.resizer.addEventListener("pointerup", up);
  });

  /* ---------------- dock ---------------- */
  const btn = (cmd, ic, title, on, extra = "") => `<button class="icon-btn${on ? " on" : ""}" data-cmd="${cmd}" title="${tr(title)}">${icon(ic)}${extra}</button>`;
  const seg = (key, items, cur) => `<div class="segmented" role="radiogroup">` + items.map(([val, ic, title]) =>
    `<button class="${val === cur ? "on" : ""}" data-seg="${key}" data-val="${val}" title="${tr(title)}" role="radio" aria-checked="${val === cur}">${icon(ic)}</button>`).join("") + `</div>`;
  const SEP = '<span class="dock-sep"></span>';
  function buildDock() {
    if (!S.kind || S.kind === "txt") { E.dock.innerHTML = ""; return; }
    let h = btn("toggleEditor", "code", S.detached ? "Ir para a janela de código" : "Editor de código (Ctrl+E)", S.editorOpen || S.detached);
    if (S.kind === "mmd" && S.sub === "mindmap") {
      h += SEP + seg("layout", [
        ["both", "both", "Dois lados"], ["right", "right", "Para a direita"], ["down", "down", "Vertical (de cima para baixo)"],
        ["radial", "radial", "Radial"], ["mermaid", "sparkle", "Original do Mermaid"],
      ], S.prefs.layout);
      h += btn("spacing", "sliders", "Espaçamento e aparência", S.popover === "spacing");
    } else if (S.kind === "mmd" && S.sub === "flowchart") {
      h += SEP + seg("dir", [
        ["", "auto", "Direção definida no arquivo"], ["TB", "aDown", "De cima para baixo"], ["LR", "aRight", "Da esquerda para a direita"],
        ["BT", "aUp", "De baixo para cima"], ["RL", "aLeft", "Da direita para a esquerda"],
      ], S.prefs.dir);
      h += btn("spacing", "sliders", "Espaçamento e aparência", S.popover === "spacing");
    } else {
      h += btn("spacing", "sliders", "Aparência", S.popover === "spacing");
    }
    h += SEP + btn("zoomOut", "minus", "Diminuir (Ctrl −)") +
      `<button class="icon-btn zoom-label" data-cmd="zoomReset" title="${tr("Tamanho original (Ctrl 0)")}"></button>` +
      btn("zoomIn", "plus", "Aumentar (Ctrl +)");
    if (S.kind === "mmd") h += btn("fit", "fit", "Ajustar à janela");
    if (S.kind === "md") {                     // estudo: mapa dos títulos e modo revisão, quando o texto tem
      const study = (E.doc.querySelectorAll("h1, h2, h3, h4").length >= 2 ? btn("headingsMap", "both", "Mapa mental dos títulos") : "") +
        (E.doc.querySelector("details") ? answersBtn() : "");
      if (study) h += SEP + study;
    }
    h += SEP;
    if (S.kind === "mmd" && S.parsed) h += btn("undo", "undo", "Desfazer (Ctrl Z)") + btn("redo", "redo", "Refazer (Ctrl Shift Z)");
    h += btn("theme", S.theme === "dark" ? "sun" : "moon", S.theme === "dark" ? "Tema claro (Ctrl D)" : "Tema escuro (Ctrl D)");
    E.dock.innerHTML = h;
    updateZoomLabel();
    placeDock();
  }
  /* centraliza em pixels inteiros (transform/margin:auto dariam meio pixel e texto borrado) */
  function placeDock() {
    // centro da área de conteúdo no estado final (não lê o retângulo animado)
    const left = S.editorOpen && S.kind && !EDITOR_ONLY ? editorWidth() + 20 : 0, width = innerWidth - left;
    E.dock.style.left = Math.round(left + (width - E.dock.offsetWidth) / 2) + "px";
    E.hint.style.left = Math.round(left + (width - 120) / 2) + "px";
  }
  E.dock.addEventListener("click", (e) => {
    const s = e.target.closest("[data-seg]");
    if (s) {
      const key = s.dataset.seg, val = s.dataset.val;
      if (S.prefs[key] === val) return;
      S.prefs[key] = val; savePrefs();
      if (S.popover) openPopover("spacing");
      draw({ fit: true });
      return;
    }
    const b = e.target.closest("[data-cmd]");
    if (b) commands[b.dataset.cmd]?.(b);
  });
  document.querySelector("#editor .ed-head").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    if (EDITOR_ONLY) post({ type: b.dataset.cmd === "detach" ? "attach" : "closeEditor" });
    else if (b.dataset.cmd === "detach") post({ type: "detach" });
    else toggleEditor(false);
  });

  const commands = {
    toggleEditor: () => (S.detached ? post({ type: "focusEditor" }) : toggleEditor()),
    spacing: () => (S.popover ? closePopover() : openPopover("spacing")),
    answers: () => toggleAnswers(),
    headingsMap: () => openHeadingsMap(),
    zoomIn: () => zoomBy(1), zoomOut: () => zoomBy(-1), zoomReset: () => zoomBy(0),
    fit: () => fit(true), undo: () => undo(), redo: () => redo(),
    theme: () => { const t = (S.themeNext || S.theme) === "dark" ? "light" : "dark"; setTheme(t); post({ type: "theme", value: t }); },
  };

  /* ---------------- popover de espaçamento ---------------- */
  const SLIDERS = {
    mindmap: [
      ["levelGap", "Distância entre níveis", 16, 220],
      ["siblingGap", "Distância entre irmãos", 2, 80],
      ["cardWidth", "Largura máxima do cartão", 120, 460],
    ],
    flowchart: [
      ["nodeSpacing", "Distância entre nós", 10, 200],
      ["rankSpacing", "Distância entre níveis", 10, 240],
    ],
  };
  /* ---------------- animações "líquidas" ----------------
   * Popover: cresce a partir do botão e assenta com o balanço leve de uma mola amortecida (largura e
   * altura em molas um pouco diferentes). Tema: o novo tema se espalha
   * a partir do botão como uma mancha de borda ondulada (View Transitions + clip-path animado). */
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function spring(t, w, z) { // 0 → 1, com oscilação (z < 1)
    if (t <= 0) return 0;
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }
  let popAnim = [], popGeo = null;
  function stopPopAnim() { popAnim.forEach((a) => a.cancel()); popAnim = []; E.pop.style.pointerEvents = ""; }
  function popoverIn(anchor) {
    stopPopAnim();
    if (calm() || !E.pop.animate) return;
    const pr = E.pop.getBoundingClientRect();
    // começa um pouco menor que o cartão (não do tamanho do botão) e assenta com um balanço leve (~4%)
    const sx0 = 0.72, sy0 = 0.6;
    const ox = anchor.left + anchor.width / 2 - pr.left, oy = anchor.top + anchor.height / 2 - pr.top;
    popGeo = { sx0, sy0, ox, oy };
    const D = 420, N = 28, frames = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * D / 1000;
      const ky = i === N ? 1 : spring(t, 26, 0.72);          // a altura vem um pouco antes
      const kx = i === N ? 1 : spring(t - 0.02, 22, 0.75);   // da largura
      frames.push({
        transform: `scale(${(sx0 + (1 - sx0) * kx).toFixed(4)}, ${(sy0 + (1 - sy0) * ky).toFixed(4)})`,
        opacity: Math.min(1, i / (N * 0.3)),
      });
    }
    E.pop.style.transformOrigin = `${ox}px ${oy}px`;
    popAnim.push(E.pop.animate(frames, { duration: D, easing: "linear" }));
    [...E.pop.children].forEach((el, i) => popAnim.push(el.animate([
      { opacity: 0, transform: "translateY(5px)" },
      { opacity: 1, transform: "none" },
    ], { duration: 260, delay: 50 + i * 12, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "backwards" })));
  }
  function popoverOut(done) {
    stopPopAnim();
    if (calm() || !E.pop.animate || !popGeo) return done();
    const { ox, oy } = popGeo;
    E.pop.style.transformOrigin = `${ox}px ${oy}px`;
    E.pop.style.pointerEvents = "none";
    const a = E.pop.animate([
      { transform: "none", opacity: 1 },
      { transform: "scale(.9, .84)", opacity: 0 },
    ], { duration: 150, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    popAnim.push(a);
    // o evento de fim depende de quadros: com a janela parada ele atrasa, então há um limite de tempo
    let ended = false;
    const end = () => { if (ended || !popAnim.includes(a)) return; ended = true; stopPopAnim(); done(); };
    a.onfinish = end;
    setTimeout(end, 220);
  }

  function openPopover() {
    const opening = !S.popover;
    S.popover = "spacing";
    const list = S.kind === "mmd" ? SLIDERS[S.sub] || [] : [];
    let h = `<h3>${tr(list.length ? "Espaçamento" : "Aparência")}</h3>`;
    for (const [k, label, min, max] of list) {
      const v = S.prefs[k], pct = ((v - min) / (max - min)) * 100;
      h += `<div class="pref-row"><label>${tr(label)}<span data-out="${k}">${v}px</span></label>` +
        `<input type="range" min="${min}" max="${max}" value="${v}" data-pref="${k}" style="--pct:${pct}%"></div>`;
    }
    const sw = (k, label) => `<div class="toggle-row">${tr(label)}<span class="switch"><input type="checkbox" data-pref="${k}"${S.prefs[k] ? " checked" : ""}><i></i></span></div>`;
    const cur = S.prefs.renderMode in MODES ? S.prefs.renderMode : "auto";
    h += `<h3 class="sub">${tr("Renderização")}</h3><div class="seg-text" role="radiogroup">` +
      [["auto", "Auto"], ["performance", "Desempenho"], ["balanced", "Equilibrado"], ["quality", "Qualidade"]].map(([v, l]) =>
        `<button data-mode="${v}" class="${v === cur ? "on" : ""}" role="radio" aria-checked="${v === cur}">${tr(l)}</button>`).join("") + `</div>`;
    const hw = detectedLabel();
    h += `<p class="mode-note">${cur === "auto"
      ? tr("Usando <b>{mode}</b>", { mode: tr(MODE_NAMES[modeName()]) }) + (hw ? ` — ${escapeHtml(hw)}` : "")
      : tr("Recomendado para este computador: <b>{mode}</b>", { mode: tr(MODE_NAMES[S.detected.mode] || "Equilibrado") })}</p>`;
    h += sw("glass", "Efeito vidro");
    h += sw("autoHideDock", "Ocultar esta barra automaticamente");
    if (list.length) h += `<div class="pop-actions"><button class="text-btn" data-reset>${tr("Restaurar padrão")}</button></div>`;
    E.pop.innerHTML = h;
    E.pop.hidden = false;
    const b = E.dock.querySelector('[data-cmd="spacing"]');
    buildDock();
    const r = (E.dock.querySelector('[data-cmd="spacing"]') || b || E.dock).getBoundingClientRect();
    const pw = E.pop.offsetWidth, ph = E.pop.offsetHeight;
    E.pop.style.left = Math.round(clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8)) + "px";
    E.pop.style.top = Math.round(Math.max(8, r.top - ph - 12)) + "px";
    if (opening) popoverIn(r);
  }
  function closePopover() {
    if (!S.popover) return;
    S.popover = null; buildDock();
    popoverOut(() => { if (!S.popover) E.pop.hidden = true; });
    if (S.prefs.autoHideDock) hideDockSoon();
  }
  let sliderT = 0;
  E.pop.addEventListener("input", (e) => {
    const k = e.target.dataset.pref;
    if (!k) return;
    if (e.target.type === "checkbox") { setPref(k, e.target.checked); return; }
    const v = +e.target.value, min = +e.target.min, max = +e.target.max;
    S.prefs[k] = v;
    e.target.style.setProperty("--pct", ((v - min) / (max - min)) * 100 + "%");
    E.pop.querySelector(`[data-out="${k}"]`).textContent = v + "px";
    savePrefs();
    clearTimeout(sliderT);
    sliderT = setTimeout(() => draw(), S.sub === "mindmap" ? 0 : 140);
  });
  E.pop.addEventListener("click", (e) => {
    // só os botões do popover: o <body> também tem data-mode (modo atual), e casar com ele fazia
    // qualquer clique aqui fixar o modo e redesenhar o popover no meio do clique (switches não mudavam)
    const mb = e.target.closest("#popover button[data-mode]");
    if (mb) { S.prefs.renderMode = mb.dataset.mode; applyMode(); savePrefs(); openPopover(); return; }
    if (!e.target.closest("[data-reset]")) return;
    for (const [k] of SLIDERS[S.sub] || []) S.prefs[k] = DEFAULTS[k];
    savePrefs(); openPopover(); draw({ fit: true });
  });
  document.addEventListener("pointerdown", (e) => {
    if (S.popover && !e.target.closest("#popover") && !e.target.closest('[data-cmd="spacing"]')) closePopover();
  }, true);

  function applyGlass() { body.classList.toggle("no-glass", !S.prefs.glass); }
  function setPref(k, v) {
    S.prefs[k] = v;
    if (k === "glass") applyGlass();
    if (k === "autoHideDock") applyAutoHide();
    if (k === "renderMode") applyMode();
    savePrefs();
  }

  /* ---------------- barra que se esconde ---------------- */
  let peekT = 0;
  function applyAutoHide() {
    body.classList.toggle("dock-autohide", !!S.prefs.autoHideDock);
    if (S.prefs.autoHideDock) hideDockSoon(1200); else body.classList.remove("dock-peek");
  }
  function showDock() { clearTimeout(peekT); body.classList.add("dock-peek"); }
  function hideDockSoon(ms = 650) {
    clearTimeout(peekT);
    peekT = setTimeout(() => { if (!S.popover && !E.dock.matches(":hover")) body.classList.remove("dock-peek"); }, ms);
  }
  document.addEventListener("mousemove", (e) => {
    if (!S.prefs.autoHideDock || !S.kind) return;
    const r = E.view.getBoundingClientRect();
    const near = e.clientY > innerHeight - 90 && e.clientX >= r.left && e.clientX <= r.right;
    const overUi = e.target instanceof Element && e.target.closest("#dock, #popover");
    if (near || overUi) showDock(); else if (body.classList.contains("dock-peek")) hideDockSoon();
  });
  document.documentElement.addEventListener("mouseleave", () => { if (S.prefs.autoHideDock) hideDockSoon(); });
  let prefsT = 0;
  function savePrefs() { clearTimeout(prefsT); prefsT = setTimeout(() => post({ type: "prefs", prefs: S.prefs }), 250); }

  /* ---------------- teclado global ---------------- */
  document.addEventListener("keydown", (e) => {
    if (e.target === E.src || S.editing) return;
    if (e.key === "Escape" && !$("shortcuts").hidden) { closeShortcuts(); return; }
    if (e.key === "Escape" && !$("ai-dialog").hidden) { closeAiPrompts(); return; }
    if (e.target.closest && e.target.closest("#popover, #findbar")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key === "y") { e.preventDefault(); redo(); return; }
    if (e.key === "Escape") { closePopover(); select(null); return; }
    if (!S.parsed || S.kind !== "mmd" || mod) return;
    const n = nodeByLine(S.selected);
    const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!n) { if (arrows.includes(e.key) && S.parsed.root) { e.preventDefault(); select(S.parsed.root.line, true); } return; }
    if (e.key === "Tab") { e.preventDefault(); applyOp(MM.ops.addChild(S.parsed, n)); }
    else if (e.key === "Enter") { e.preventDefault(); applyOp(MM.ops.addSibling(S.parsed, n)); }
    else if (e.key === "F2" || e.key === " ") { e.preventDefault(); beginRename(n.line); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); applyOp(MM.ops.remove(S.parsed, n)); }
    else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); applyOp(MM.ops.reorder(S.parsed, n, e.key === "ArrowUp" ? -1 : 1)); }
    else if (arrows.includes(e.key)) { e.preventDefault(); navigate(n, e.key); }
  });

  /* âncoras internas no markdown */
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest && ev.target.closest("a[href^='#']");
    if (!a) return;
    ev.preventDefault();
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    const t = document.getElementById(id) || document.getElementsByName(id)[0];
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  let toastT = 0;
  function toast(msg, ms = 3200) {
    E.toast.textContent = msg; E.toast.hidden = false;
    E.toast.style.left = Math.round((E.toast.parentElement.clientWidth - E.toast.offsetWidth) / 2) + "px";
    clearTimeout(toastT); toastT = setTimeout(() => (E.toast.hidden = true), ms);
  }

  /* ---------------- exportar SVG ---------------- */
  function getSvg() {
    if (S.kind !== "mmd") return "";
    const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const msvg = E.canvas.querySelector(".mermaid-host svg");
    if (msvg) { const c = msvg.cloneNode(true); c.setAttribute("xmlns", "http://www.w3.org/2000/svg"); return head + c.outerHTML; }
    const host = E.canvas.querySelector(".mm-host");
    if (!host) return "";
    const { w, h } = S.bounds, bg = getComputedStyle(body).backgroundColor;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    out += `<rect width="100%" height="100%" fill="${bg}"/>`;
    out += `<g fill="none" stroke-linecap="round" opacity="0.78">${host.querySelector(".mm-edges").innerHTML}</g>`;
    for (const el of host.querySelectorAll(".mm-node")) {
      const cs = getComputedStyle(el);
      const style = [
        "box-sizing:border-box", "width:100%", "height:100%", `padding:${cs.padding}`, `border-radius:${cs.borderRadius}`,
        `background-color:${cs.backgroundColor}`, `background-image:${cs.backgroundImage}`,
        `border:${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, `color:${cs.color}`,
        `font-family:${cs.fontFamily.replace(/"/g, "'")}`, `font-size:${cs.fontSize}`, `font-weight:${cs.fontWeight}`,
        `line-height:${cs.lineHeight}`, `text-align:${cs.textAlign}`, `white-space:${cs.whiteSpace}`,
      ].join(";");
      let label = el.querySelector(".mm-label").innerHTML.replace(/<br>/g, "<br/>").replace(/&nbsp;/g, "&#160;");
      const n = S.parsed.nodes[+el.dataset.id];
      out += `<foreignObject x="${n.left}" y="${n.top}" width="${n.w}" height="${n.h}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeHtml(style)}">${label}</div></foreignObject>`;
    }
    return head + out + "</svg>";
  }

  /* ---------------- boas-vindas / recentes ---------------- */
  function renderRecent(items) {
    $("recent-list").innerHTML = items.map((r, i) => {
      const k = r.kind === "mmd" || r.kind === "dot" ? "mmd" : "md";
      return `<li style="--i:${i}"><button class="recent-item" data-path="${escapeHtml(r.path)}" title="${escapeHtml(r.path)}">` +
        `<span class="ri-icon ${k}">${icon(k === "mmd" ? "both" : "doc")}</span>` +
        `<span class="ri-text"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.folder || "")}</small></span></button></li>`;
    }).join("");
    $("recent").hidden = !items.length;
    $("welcome").classList.toggle("has-recent", items.length > 0);
  }
  $("recent-list").addEventListener("click", (e) => {
    const b = e.target.closest(".recent-item");
    if (b) post({ type: "openRecent", path: b.dataset.path });
  });
  async function showWelcome(o = {}) {
    renderRecent(o.recent || []);
    await fontsReady;                    // o cartão só entra com a fonte pronta (senão o texto nasce invisível)
    if (S.kind) return;                  // um arquivo chegou enquanto isso
    setMode(null);
    buildDock();
  }

  /* ---------------- busca no texto (Ctrl+F) ----------------
   * Usa a busca do próprio navegador (window.find), que funciona igual no WebKitGTK e no WebView2.
   * No mapa mental, o mapa desliza até o cartão encontrado. */
  const FB = { bar: $("findbar"), input: $("find-input"), count: $("find-count") };
  FB.bar.querySelector('[data-find="prev"]').innerHTML = icon("aUp");
  FB.bar.querySelector('[data-find="next"]').innerHTML = icon("aDown");
  FB.bar.querySelector('[data-find="close"]').innerHTML = icon("close");
  function findCount(q) {
    const root = S.kind === "md" ? E.doc : E.canvas;
    const text = (S.kind === "txt" ? S.text : root.textContent || "").toLowerCase(), needle = q.toLowerCase();
    let n = 0;
    for (let i = text.indexOf(needle); needle && i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
    return n;
  }
  const resultCount = (n) => (n === 0 ? tr("Nenhum resultado") : n === 1 ? tr("1 resultado") : tr("{n} resultados", { n }));
  /* no .txt o texto está no editor, onde window.find não procura: a busca seleciona no próprio editor */
  function findInEditor(q, back, again) {
    const v = E.src.value.toLowerCase(), needle = q.toLowerCase();
    const from = again ? E.src.selectionEnd : E.src.selectionStart;  // digitando, o trecho atual continua valendo
    let i = back ? (E.src.selectionStart > 0 ? v.lastIndexOf(needle, E.src.selectionStart - 1) : -1) : v.indexOf(needle, from);
    if (i < 0) i = back ? v.lastIndexOf(needle) : v.indexOf(needle);   // dá a volta
    if (i < 0) return;
    E.src.setSelectionRange(i, i + needle.length);
    const ls = v.lastIndexOf("\n", i - 1) + 1, line = v.slice(0, i).split("\n").length - 1;
    scrollToLine(line);
    const x = 14 + (i - ls) * monoW(), w = E.scroll.clientWidth - GUTTER, sl = E.scroll.scrollLeft;
    if (x < sl + 20 || x + needle.length * monoW() > sl + w - 20) E.scroll.scrollLeft = Math.max(0, x - w / 3);
    updateGutter(); updateHl();
  }
  function findStep(back, again = true) {
    const q = FB.input.value;
    if (!q) { FB.count.textContent = ""; getSelection().removeAllRanges(); return; }
    const n = findCount(q);
    FB.count.textContent = resultCount(n);
    if (S.kind === "txt") { if (n) findInEditor(q, back, again); }
    else if (n && window.find(q, false, !!back, true, false, false, false)) {
      const at = getSelection().anchorNode;
      const card = at && (at.nodeType === 1 ? at : at.parentElement).closest(".mm-node");
      if (card && S.parsed) { const node = S.parsed.nodes[+card.dataset.id]; if (node) ensureVisible(node.line); }
    }
    FB.input.focus({ preventScroll: true });
  }
  function openFind() {
    if (!S.kind) return;
    FB.bar.hidden = false;
    const sel = String(getSelection() || "").trim();
    if (sel && sel.length < 80 && !sel.includes("\n")) FB.input.value = sel;
    FB.input.focus(); FB.input.select();
    if (FB.input.value) FB.count.textContent = resultCount(findCount(FB.input.value));
  }
  function closeFind() { FB.bar.hidden = true; FB.count.textContent = ""; getSelection().removeAllRanges(); }
  let findT = 0;
  FB.input.addEventListener("input", () => { clearTimeout(findT); findT = setTimeout(() => findStep(false, false), 120); });
  FB.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  FB.bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-find]");
    if (!b) return;
    if (b.dataset.find === "close") closeFind(); else findStep(b.dataset.find === "prev");
  });

  /* ---------------- atalhos de teclado (F1) ---------------- */
  const SHORTCUTS = [
    ["Geral", [["Ctrl O", "Abrir arquivo"], ["Ctrl S", "Salvar"], ["Ctrl E", "Editor de código"], ["F5", "Recarregar do disco"],
      ["Ctrl F", "Buscar"], ["Ctrl D", "Tema claro / escuro"], ["Ctrl Z · Ctrl Shift Z", "Desfazer · refazer"],
      ["Ctrl P", "Imprimir / PDF"], ["Ctrl Shift E", "Exportar SVG"], ["Ctrl N", "Nova janela"], ["Ctrl W", "Fechar janela"]]],
    ["Visualização", [["Ctrl + roda, pinça", "Zoom"], ["Ctrl = · Ctrl − · Ctrl 0", "Zoom"], ["Ctrl 1", "Ajustar à janela"],
      ["Arrastar o fundo, roda", "Mover o diagrama"]]],
    ["Mapa mental", [["Clique", "Selecionar nó"], ["Duplo clique, F2", "Renomear"], ["Tab", "Adicionar filho"],
      ["Enter", "Adicionar irmão"], ["Delete", "Excluir nó e filhos"], ["Setas", "Navegar entre nós"],
      ["Alt ↑ · Alt ↓", "Mover entre irmãos"], ["Arrastar nó sobre outro", "Mudar de pai"]]],
  ];
  // "Ctrl Shift Z" → teclas; palavras ("roda", "Clique") ficam como texto
  const KEY = /^(Ctrl|Shift|Alt|Tab|Enter|Delete|Esc|F\d+|[A-Z0-9=−↑↓])$/;
  const keys = (k) => k.split(" ").map((t) => (KEY.test(t) ? `<kbd>${escapeHtml(t)}</kbd>` : escapeHtml(t))).join(" ");
  function showShortcuts() {
    const box = $("shortcuts");
    box.innerHTML = `<header><h2>${tr("Atalhos de teclado")}</h2><button class="icon-btn small" data-close title="${tr("Fechar (Esc)")}">${icon("close")}</button></header>` +
      `<div class="sc-cols">${SHORTCUTS.map(([title, rows]) => `<section><h3>${tr(title)}</h3><dl>${rows.map(([k, d]) =>
        `<dt>${keys(tr(k))}</dt><dd>${escapeHtml(tr(d))}</dd>`).join("")}</dl></section>`).join("")}</div>`;
    box.hidden = false; $("scrim").hidden = false;
  }
  function closeShortcuts() { $("shortcuts").hidden = true; $("scrim").hidden = true; }

  /* ---------------- gerar material com IA: prompts prontos e o guia de formato ----------------
   * Os textos vêm de prompts.js (gerado de docs/ia/ por scripts/gerar-ia.py). */
  const GUIDE_URL = { pt: "https://joseribamar21.github.io/mirante_md_mmd/ia/guia.md", en: "https://joseribamar21.github.io/mirante_md_mmd/ia/guide.md" };
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove(); return ok;
    }
  }
  function showAiPrompts() {
    const P = window.MIRANTE_PROMPTS;
    if (!P) return;
    const L = LANG === "en" ? "en" : "pt", box = $("ai-dialog");
    closeShortcuts();
    box.innerHTML = `<header><h2>${tr("Gerar material com IA")}</h2><button class="icon-btn small" data-close title="${tr("Fechar (Esc)")}">${icon("close")}</button></header>
      <p class="ai-intro">${tr("Copie um prompt, cole no Claude, ChatGPT ou Gemini junto com o seu conteúdo (texto, PDF ou só o assunto) e abra aqui o arquivo que ele devolver.")}</p>
      <div class="ai-cards">${P.prompts.map((p, i) => `<article class="ai-card">
        <div class="ai-card-ic">${icon(P_ICON[p.icon] || "doc")}</div>
        <h3>${escapeHtml(p.title[L])}</h3><p>${escapeHtml(p.desc[L])}</p>
        <button class="ai-copy" data-prompt="${i}">${icon("copy")}<span>${tr("Copiar prompt")}</span></button></article>`).join("")}</div>
      <div class="ai-guide">
        <div><h3>${tr("Guia de formato completo")}</h3><p>${tr("Para colar nas instruções de um Projeto do Claude ou nas instruções personalizadas do ChatGPT: tudo o que o Mirante desenha e os limites. Assim todo material já sai pronto.")}</p></div>
        <div class="ai-guide-btns"><button class="ai-copy" data-guide>${icon("copy")}<span>${tr("Copiar guia")}</span></button>
        <a class="ai-more" href="${GUIDE_URL[L]}">${tr("Ver no site")}</a></div>
      </div>`;
    box.hidden = false; $("scrim").hidden = false;
  }
  const P_ICON = { doc: "doc", question: "question", both: "both" };
  function closeAiPrompts() { $("ai-dialog").hidden = true; if ($("shortcuts").hidden) $("scrim").hidden = true; }
  $("ai-dialog").addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) return closeAiPrompts();
    const b = e.target.closest(".ai-copy");
    if (!b) return;
    const P = window.MIRANTE_PROMPTS, L = LANG === "en" ? "en" : "pt";
    const text = b.dataset.guide != null ? P.guide[L] : P.prompts[+b.dataset.prompt].text[L];
    if (await copyText(text)) {
      const label = b.querySelector("span"), was = label.textContent;
      b.classList.add("done"); label.textContent = tr("Copiado");
      setTimeout(() => { b.classList.remove("done"); label.textContent = was; }, 1600);
    }
  });
  $("ai-open").addEventListener("click", () => showAiPrompts());
  $("ai-open").querySelector(".ai-ic").innerHTML = icon("sparkle");
  $("shortcuts").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeShortcuts(); });
  $("scrim").addEventListener("click", () => { closeShortcuts(); closeAiPrompts(); });

  /* placa de vídeo, para a camada nativa escolher o modo de renderização */
  function gpuRenderer() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return "";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return r;
    } catch (_) { return ""; }
  }

  /* ---------------- API pública ---------------- */
  /* Arquivo novo: a tela de carregamento cobre o intervalo até o primeiro desenho; ela só aparece se
   * demorar mais que um instante (CSS), e o conteúdo entra com um fade quando fica pronto. */
  let loadSeq = 0;
  async function render(p) {
    const fresh = !p.keepScroll || p.path !== S.path;
    const load = ++loadSeq;
    if (fresh) {
      $("loading-name").textContent = (p.path || "").split("/").pop();
      body.classList.add("is-loading");
    }
    if (S.editing) { S.editing.label.onblur = null; S.editing = null; }
    if (fresh) closeBlockModal(true);
    S.path = p.path || null;
    // .gv/.dot usa o mesmo palco dos diagramas Mermaid ("mmd"); S.lang diz quem desenha
    S.kind = p.kind === "dot" ? "mmd" : p.kind;
    S.lang = p.kind === "dot" ? "dot" : null;
    if (p.prefs) S.prefs = { ...DEFAULTS, ...p.prefs };
    S.block = !!p.block; S.blockSent = p.text;
    if (fresh) { S.history = []; S.future = []; S.selected = null; S.mdZoom = 1; S.hasFit = false; }
    else if (p.text !== S.text) pushHistory(S.text);
    S.text = p.text; S.saved = p.text; S.typing = false;
    setDirty(false);
    setBase(p.base);
    setMode(S.kind);
    const edTitle = document.querySelector(".ed-title");
    edTitle.dataset.i18n = S.kind === "txt" ? "Texto" : "Código";
    edTitle.textContent = tr(edTitle.dataset.i18n);
    applyGlass(); applyAutoHide(); applyMode(); setEditorOffset();
    syncEditor();
    notifySource();
    closePopover();
    try { await draw({ fit: fresh }); }
    finally { if (load === loadSeq) body.classList.remove("is-loading"); }
    if (fresh && S.kind === "txt") { E.src.setSelectionRange(0, 0); E.scroll.scrollTop = 0; E.scroll.scrollLeft = 0; E.src.focus({ preventScroll: true }); updateHl(); }
  }
  function setTheme(t) {
    const next = t === "light" ? "light" : "dark";
    const from = S.themeNext || S.theme;
    S.themeNext = next; // a troca animada só aplica o tema depois da foto da tela: vale sempre o último pedido
    if (next === from || calm() || body.classList.contains("mode-boot") || document.hidden) {
      applyTheme(next); if (!EDITOR_ONLY) draw();
      return;
    }
    // o novo tema só é fotografado depois das folhas de estilo e do desenho prontos (com limite)
    const update = async () => {
      const css = Promise.all(["gh-css", "hl-css"].map((id) => new Promise((r) => $(id).addEventListener("load", r, { once: true }))));
      applyTheme(S.themeNext || next);
      await Promise.race([Promise.all([css, EDITOR_ONLY ? null : draw()]), sleep(700)]);
    };
    if (document.startViewTransition) liquidTheme(update); else fadeTheme(update);
  }
  let themeVT = null, fadeT = 0;
  function liquidTheme(update) {
    if (themeVT) themeVT.skipTransition();
    const b = E.dock.querySelector('[data-cmd="theme"]'), br = b && b.getBoundingClientRect();
    const [cx, cy] = br && br.width ? [br.left + br.width / 2, br.top + br.height / 2] : [innerWidth / 2, innerHeight / 2];
    const st = document.createElement("style");
    st.textContent = liquidCss(cx, cy, innerWidth, innerHeight);
    document.head.appendChild(st);
    let vt;
    try { vt = document.startViewTransition(update); }
    catch (_) { st.remove(); update(); return; }
    themeVT = vt;
    vt.finished.finally(() => { st.remove(); if (themeVT === vt) { themeVT = null; S.themeNext = null; } });
  }
  /* mancha que cresce do botão: polígono com o raio ondulado por três senos que giram em sentidos
   * diferentes; a ondulação diminui até virar um círculo maior que a janela */
  function liquidCss(cx, cy, W, H) {
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 60;
    const N = 64, F = 32;
    let kf = "";
    for (let f = 0; f <= F; f++) {
      const t = f / F;
      const g = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const a = f === F ? 0 : 0.22 * Math.pow(1 - t, 1.3);
      const pts = [];
      for (let i = 0; i < N; i++) {
        const th = (i / N) * 2 * Math.PI;
        const w = 0.55 * Math.sin(3 * th + 6 * t) + 0.3 * Math.sin(5 * th - 9 * t + 1.3) + 0.15 * Math.sin(8 * th + 14 * t + 2.1);
        const r = R * g * (1 + a * w);
        pts.push(`${(cx + r * Math.cos(th)).toFixed(1)}px ${(cy + r * Math.sin(th)).toFixed(1)}px`);
      }
      kf += `${(t * 100).toFixed(2)}%{clip-path:polygon(${pts.join(",")})}`;
    }
    return `@keyframes mirante-liquid{${kf}}` +
      "::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}" +
      "::view-transition-new(root){animation:mirante-liquid .55s linear both}";
  }
  /* sem View Transitions: as cores deslizam de um tema para o outro */
  function fadeTheme(update) {
    const root = document.documentElement;
    root.classList.add("theme-fade");
    update();
    clearTimeout(fadeT); fadeT = setTimeout(() => root.classList.remove("theme-fade"), 560);
  }

  /* troca de idioma pelo menu, sem recarregar: textos fixos, barra, popover e o desenho (mensagens de erro) */
  function setLang(l) {
    const next = langOf(l);
    if (next === LANG) return;
    LANG = next;
    applyStaticText();
    buildDock();
    if (S.popover) openPopover();
    if (!$("shortcuts").hidden) showShortcuts();
    if (!FB.bar.hidden && FB.input.value) FB.count.textContent = resultCount(findCount(FB.input.value));
    if (S.kind === "mmd" && S.parsed) E.nodeBar.dataset.for = "";
    if (S.kind && !EDITOR_ONLY) draw({ force: true });
  }

  window.mirante = {
    render, setTheme, setLang, showWelcome, toggleEditor, zoomBy, getSvg, toast, undo, redo, openFind, showShortcuts, showAiPrompts,
    /* a camada nativa pede um valor: executa fn e responde com {type:"reply"} */
    __ask: async (id, fn) => {
      let value = null;
      try { value = await fn(); } catch (_) { /* value fica null: quem pediu trata como falha */ }
      post({ type: "reply", id, value: value === undefined ? null : value });
    },
    fit: () => fit(true),
    _view: () => ({ ...S.view }),       // leitura para diagnóstico
    zoomReset: () => zoomBy(0),
    getSource: () => S.text,
    isDirty: () => S.dirty,
    markSaved: () => { S.saved = S.text; setDirty(false); },
    setDetected: (d) => { S.detected = { ...d, mode: d.mode in MODES ? d.mode : "balanced", label: d.label || "" }; applyMode(); if (S.popover) openPopover(); },
    _mode: () => ({ mode: modeName(), ...M() }),
    setPref: (k, v) => { setPref(k, v); if (S.popover) openPopover(); },
    /* janela de código separada ↔ principal */
    setDetached: (on) => {
      S.detached = !!on;
      if (on && S.editorOpen) toggleEditor(false);
      if (on) notifySource();
      buildDock();
    },
    applyExternalEdit: (text) => {                 // digitação vinda da janela separada
      if (text === S.text) return;
      if (!S.typing) pushHistory(S.text);
      S.typing = true; clearTimeout(S.typeT); S.typeT = setTimeout(() => (S.typing = false), 900);
      S.text = text; syncEditor(); setDirty(S.text !== S.saved);
      scheduleLiveDraw();
    },
    selectLine: (line) => { if (nodeByLine(line)) { S.selected = line; applySelection(); ensureVisible(line); } },
    /* usados só na janela separada */
    initEditor: (o) => { applyTheme(o.theme); S.text = o.text; E.src.value = o.text; syncEditor(); E.src.focus(); },
    setSource: (text) => { if (text !== E.src.value) { S.text = text; syncEditor(); } },
    revealLine: (line) => revealLine(line),
    /* diagrama de um .md em janela própria */
    getBlock: (i) => { const b = diagramBlocks()[i]; return b ? { code: b.code, lang: b.lang } : null; },
    replaceBlock: (i, code) => { if (!replaceBlock(i, code)) toast(tr("Não foi possível atualizar o diagrama no arquivo.")); },
    setLinked: (on) => { S.linked = !!on; S.quietBlocks = null; },
    setBlockText: (text) => {             // o .md mudou (editado lá ou no disco)
      if (!S.block || text === S.text || S.typing) return;
      pushHistory(S.text);
      S.text = text; S.blockSent = text;
      syncEditor(); notifySource(); draw();
    },
  };
  if (EDITOR_ONLY) {
    body.className = "editor-only editor-open mode-md";
    S.kind = "md"; S.editorOpen = true;
  } else if (!IN_APP) {
    showWelcome();                       // fora do app ninguém vai decidir: vai direto para as boas-vindas
  }

  applyTheme(document.documentElement.dataset.theme);
  addEventListener("resize", () => { if (S.popover) closePopover(); setEditorOffset(); placeDock(); positionNodeBar(); });
  // Tauri: a camada nativa espera este aviso para mandar o arquivo (ou a tela inicial)
  if (TAURI) post({ type: "ready", theme: S.theme, gpu: EDITOR_ONLY ? "" : gpuRenderer() });
})();
