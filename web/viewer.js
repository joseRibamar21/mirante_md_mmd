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
    src: $("src"), gutter: $("ed-gutter"), hl: $("ed-hl"), pos: $("ed-pos"), resizer: $("resizer"),
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
    kind: null, sub: null, path: null, text: "", saved: "", dirty: false,
    prefs: { ...DEFAULTS }, theme: "dark",
    view: { x: 0, y: 0, s: 1 }, bounds: { w: 0, h: 0 }, mdZoom: 1, hasFit: false,
    parsed: null, els: null, selected: null, editing: null,
    history: [], future: [], typing: false, editorOpen: false, seq: 0, popover: null, detached: false,
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
    doc: '<path d="M14 3.5H7.5A1.5 1.5 0 006 5v14a1.5 1.5 0 001.5 1.5h9A1.5 1.5 0 0018 19V7.5z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h4"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
  document.querySelector('#editor [data-cmd="toggleEditor"]').innerHTML = icon("close");
  const detachBtn = document.querySelector('#editor [data-cmd="detach"]');
  detachBtn.innerHTML = icon(EDITOR_ONLY ? "attach" : "external");
  if (EDITOR_ONLY) detachBtn.title = "Voltar o editor para a janela principal";

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
      flowchart: { nodeSpacing: S.prefs.nodeSpacing, rankSpacing: S.prefs.rankSpacing, curve: "basis", htmlLabels: true },
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
  function setMode(kind) {
    body.classList.remove("mode-boot", "mode-welcome", "mode-md", "mode-mmd");
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
        let html;
        try {
          html = lang && hljs.getLanguage(lang) ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value : escapeHtml(token.text);
        } catch (_) { html = escapeHtml(token.text); }
        return `<pre><code class="hljs${lang ? " language-" + escapeHtml(lang) : ""}">${html}</code></pre>`;
      },
    },
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
      sc.onerror = () => { mermaidLoad = null; fail(new Error("não foi possível carregar o Mermaid")); };
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
    if (r.error) { el.innerHTML = errorBox("Erro no diagrama Mermaid", r.error); return false; }
    el.innerHTML = r.svg;
    return true;
  }
  async function renderMarkdown(my) {
    const raw = marked.parse(S.text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, ""));
    E.doc.innerHTML = DOMPurify.sanitize(raw, { ADD_ATTR: ["data-mermaid", "target"] });
    addHeadingIds(E.doc);
    for (const el of E.doc.querySelectorAll(".mermaid-block")) {
      const code = decodeURIComponent(el.dataset.mermaid || "");
      if (detectSub(code) === "mindmap" && S.prefs.layout !== "mermaid") {
        el.classList.add("mm-inline");
        const host = document.createElement("div");
        el.appendChild(host);
        const r = MM.render(host, MM.parse(code), { ...S.prefs, theme: S.theme });
        // encaixa na largura com scale() (vetorial; o CSS zoom esbarrava no limite de fonte do WebKit)
        const s = Math.min(1, el.clientWidth / r.width);
        const box = document.createElement("div");
        box.style.cssText = `width:${Math.floor(r.width * s)}px;height:${Math.ceil(r.height * s)}px;margin:0 auto;overflow:hidden;flex:none`;
        el.replaceChild(box, host); box.appendChild(host);
        if (s < 0.999) { host.style.transform = `scale(${s})`; host.style.transformOrigin = "0 0"; }
      } else {
        await mermaidInto(el, code, my);
      }
      if (my !== S.seq) return;
    }
  }

  /* ---------------- diagrama (.mmd) ---------------- */
  async function renderDiagram(my, live, force) {
    S.sub = detectSub(S.text);
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
    const r = await mermaidSvg(code, my);
    if (my !== S.seq || r.stale) return "kept";
    if (r.error && live && c.querySelector(".mermaid-host svg")) {
      showSyntaxBadge(r.error); // digitando: o último diagrama válido continua na tela
      return "kept";
    }
    hideSyntaxBadge();
    S.drawKey = drawKey;
    S.parsed = null; S.els = null; hideNodeBar();
    const tmp = document.createElement("div");
    tmp.className = "mermaid-host";
    const ok = !r.error;
    tmp.innerHTML = ok ? r.svg : errorBox("Erro no diagrama Mermaid", r.error);
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
    b.querySelector("span").textContent = msg + "\n(mostrando a última versão válida)";
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
        `<button class="icon-btn" data-op="addChild" title="Adicionar filho (Tab)">${icon("child")}Filho</button>` +
        (n.parent ? `<button class="icon-btn" data-op="addSibling" title="Adicionar irmão (Enter)">${icon("sibling")}Irmão</button>` : "") +
        `<button class="icon-btn" data-op="rename" title="Renomear (F2 ou duplo clique)">${icon("pencil")}</button>` +
        (n.parent ? `<button class="icon-btn danger" data-op="remove" title="Excluir com os filhos (Delete)">${icon("trash")}</button>` : "");
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
  function setDirty(d) { if (d !== S.dirty) { S.dirty = d; post({ type: "dirty", value: d }); } }
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
    if (!S.history.length) return toast("Nada para desfazer");
    S.future.push(S.text); S.text = S.history.pop(); S.typing = false;
    syncEditor(); setDirty(S.text !== S.saved); notifySource(); draw();
  }
  function redo() {
    if (!S.future.length) return toast("Nada para refazer");
    S.history.push(S.text); S.text = S.future.pop(); S.typing = false;
    syncEditor(); setDirty(S.text !== S.saved); notifySource(); draw();
  }

  /* ---------------- editor de código ---------------- */
  const LH = 20, PADT = 12; // igual ao line-height do CSS (px inteiros)
  function syncEditor() {
    if (E.src.value !== S.text) {
      const { selectionStart: a, selectionEnd: b, scrollTop } = E.src;
      E.src.value = S.text;
      E.src.setSelectionRange(Math.min(a, S.text.length), Math.min(b, S.text.length));
      E.src.scrollTop = scrollTop;
    }
    updateGutter(); updateHl();
  }
  let gutterN = 0;
  function updateGutter() {
    const n = E.src.value.split("\n").length;
    if (n !== gutterN) {
      gutterN = n;
      let s = ""; for (let i = 1; i <= n; i++) s += i + "\n";
      E.gutter.textContent = s + "\n\n\n";
    }
    E.gutter.scrollTop = E.src.scrollTop;
  }
  function caretLine() {
    const v = E.src.value, p = E.src.selectionStart;
    const line = v.slice(0, p).split("\n").length - 1;
    return { line, col: p - (v.lastIndexOf("\n", p - 1) + 1) };
  }
  function updateHl() {
    const { line, col } = caretLine();
    E.hl.style.top = PADT + line * LH - E.src.scrollTop + "px";
    E.pos.textContent = `Ln ${line + 1}, Col ${col + 1}`;
  }
  function lineStart(text, line) { let p = 0; for (let i = 0; i < line; i++) { p = text.indexOf("\n", p) + 1; if (!p) return text.length; } return p; }
  function revealLine(line) {
    const p = lineStart(E.src.value, line);
    E.src.setSelectionRange(p, p);
    const top = line * LH, h = E.src.clientHeight;
    if (top < E.src.scrollTop + LH || top > E.src.scrollTop + h - 3 * LH) E.src.scrollTop = Math.max(0, top - h / 3);
    updateGutter(); updateHl();
  }
  function onEditorChange() {
    if (EDITOR_ONLY) {
      S.text = E.src.value; updateGutter(); updateHl();
      post({ type: "edit", text: S.text });
      return;
    }
    const prev = S.text;
    if (!S.typing) pushHistory(prev);
    S.typing = true;
    clearTimeout(S.typeT); S.typeT = setTimeout(() => (S.typing = false), 900);
    S.text = E.src.value;
    setDirty(S.text !== S.saved);
    updateGutter(); updateHl();
    scheduleLiveDraw();
  }
  E.src.addEventListener("input", onEditorChange);
  E.src.addEventListener("scroll", () => { E.gutter.scrollTop = E.src.scrollTop; updateHl(); });
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
    if (!S.kind) return;
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
  const btn = (cmd, ic, title, on, extra = "") => `<button class="icon-btn${on ? " on" : ""}" data-cmd="${cmd}" title="${title}">${icon(ic)}${extra}</button>`;
  const seg = (key, items, cur) => `<div class="segmented" role="radiogroup">` + items.map(([val, ic, title]) =>
    `<button class="${val === cur ? "on" : ""}" data-seg="${key}" data-val="${val}" title="${title}" role="radio" aria-checked="${val === cur}">${icon(ic)}</button>`).join("") + `</div>`;
  const SEP = '<span class="dock-sep"></span>';
  function buildDock() {
    if (!S.kind) { E.dock.innerHTML = ""; return; }
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
      `<button class="icon-btn zoom-label" data-cmd="zoomReset" title="Tamanho original (Ctrl 0)"></button>` +
      btn("zoomIn", "plus", "Aumentar (Ctrl +)");
    if (S.kind === "mmd") h += btn("fit", "fit", "Ajustar à janela");
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
    zoomIn: () => zoomBy(1), zoomOut: () => zoomBy(-1), zoomReset: () => zoomBy(0),
    fit: () => fit(true), undo: () => undo(), redo: () => redo(),
    theme: () => { setTheme(S.theme === "dark" ? "light" : "dark"); post({ type: "theme", value: S.theme }); },
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
  function openPopover() {
    S.popover = "spacing";
    const list = S.kind === "mmd" ? SLIDERS[S.sub] || [] : [];
    let h = `<h3>${list.length ? "Espaçamento" : "Aparência"}</h3>`;
    for (const [k, label, min, max] of list) {
      const v = S.prefs[k], pct = ((v - min) / (max - min)) * 100;
      h += `<div class="pref-row"><label>${label}<span data-out="${k}">${v}px</span></label>` +
        `<input type="range" min="${min}" max="${max}" value="${v}" data-pref="${k}" style="--pct:${pct}%"></div>`;
    }
    const sw = (k, label) => `<div class="toggle-row">${label}<span class="switch"><input type="checkbox" data-pref="${k}"${S.prefs[k] ? " checked" : ""}><i></i></span></div>`;
    const cur = S.prefs.renderMode in MODES ? S.prefs.renderMode : "auto";
    h += `<h3 class="sub">Renderização</h3><div class="seg-text" role="radiogroup">` +
      [["auto", "Auto"], ["performance", "Desempenho"], ["balanced", "Equilibrado"], ["quality", "Qualidade"]].map(([v, l]) =>
        `<button data-mode="${v}" class="${v === cur ? "on" : ""}" role="radio" aria-checked="${v === cur}">${l}</button>`).join("") + `</div>`;
    h += `<p class="mode-note">${cur === "auto"
      ? `Usando <b>${MODE_NAMES[modeName()]}</b>${S.detected.label ? ` — ${escapeHtml(S.detected.label)}` : ""}`
      : `Recomendado para este computador: <b>${MODE_NAMES[S.detected.mode] || "Equilibrado"}</b>`}</p>`;
    h += sw("glass", "Efeito vidro");
    h += sw("autoHideDock", "Ocultar esta barra automaticamente");
    if (list.length) h += `<div class="pop-actions"><button class="text-btn" data-reset>Restaurar padrão</button></div>`;
    E.pop.innerHTML = h;
    E.pop.hidden = false;
    const b = E.dock.querySelector('[data-cmd="spacing"]');
    buildDock();
    const r = (E.dock.querySelector('[data-cmd="spacing"]') || b || E.dock).getBoundingClientRect();
    const pw = E.pop.offsetWidth, ph = E.pop.offsetHeight;
    E.pop.style.left = Math.round(clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8)) + "px";
    E.pop.style.top = Math.round(Math.max(8, r.top - ph - 12)) + "px";
  }
  function closePopover() {
    if (!S.popover) return;
    S.popover = null; E.pop.hidden = true; buildDock();
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
      const k = r.kind === "mmd" ? "mmd" : "md";
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
    const text = (root.textContent || "").toLowerCase(), needle = q.toLowerCase();
    let n = 0;
    for (let i = text.indexOf(needle); needle && i >= 0; i = text.indexOf(needle, i + needle.length)) n++;
    return n;
  }
  function findStep(back) {
    const q = FB.input.value;
    if (!q) { FB.count.textContent = ""; getSelection().removeAllRanges(); return; }
    const n = findCount(q);
    FB.count.textContent = n ? `${n} resultado${n === 1 ? "" : "s"}` : "Nenhum resultado";
    if (n && window.find(q, false, !!back, true, false, false, false)) {
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
    if (FB.input.value) FB.count.textContent = `${findCount(FB.input.value)} resultado(s)`;
  }
  function closeFind() { FB.bar.hidden = true; FB.count.textContent = ""; getSelection().removeAllRanges(); }
  let findT = 0;
  FB.input.addEventListener("input", () => { clearTimeout(findT); findT = setTimeout(() => findStep(false), 120); });
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
    box.innerHTML = `<header><h2>Atalhos de teclado</h2><button class="icon-btn small" data-close title="Fechar (Esc)">${icon("close")}</button></header>` +
      `<div class="sc-cols">${SHORTCUTS.map(([title, rows]) => `<section><h3>${title}</h3><dl>${rows.map(([k, d]) =>
        `<dt>${keys(k)}</dt><dd>${escapeHtml(d)}</dd>`).join("")}</dl></section>`).join("")}</div>`;
    box.hidden = false; $("scrim").hidden = false;
  }
  function closeShortcuts() { $("shortcuts").hidden = true; $("scrim").hidden = true; }
  $("shortcuts").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeShortcuts(); });
  $("scrim").addEventListener("click", closeShortcuts);

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
    S.path = p.path || null;
    S.kind = p.kind;
    if (p.prefs) S.prefs = { ...DEFAULTS, ...p.prefs };
    if (fresh) { S.history = []; S.future = []; S.selected = null; S.mdZoom = 1; S.hasFit = false; }
    else if (p.text !== S.text) pushHistory(S.text);
    S.text = p.text; S.saved = p.text; S.typing = false;
    setDirty(false);
    setBase(p.base);
    setMode(p.kind);
    applyGlass(); applyAutoHide(); applyMode(); setEditorOffset();
    syncEditor();
    notifySource();
    closePopover();
    try { await draw({ fit: fresh }); }
    finally { if (load === loadSeq) body.classList.remove("is-loading"); }
  }
  function setTheme(t) { applyTheme(t); if (!EDITOR_ONLY) draw(); }

  window.mirante = {
    render, setTheme, showWelcome, toggleEditor, zoomBy, getSvg, toast, undo, redo, openFind, showShortcuts,
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
    setDetected: (d) => { S.detected = { mode: d.mode in MODES ? d.mode : "balanced", label: d.label || "" }; applyMode(); if (S.popover) openPopover(); },
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
