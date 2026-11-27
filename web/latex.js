/* Mirante — Markdown → LaTeX.
 * Converte os tokens do marked (com as extensões de fórmula do viewer.js) num documento .tex que compila
 * com pdflatex, xelatex ou lualatex, e também só uma tabela (para colar num trabalho que já existe).
 * Os diagramas não são desenhados aqui: quem chama passa os nomes dos arquivos SVG de cada um, na ordem
 * em que aparecem no texto, e eles entram com \includesvg. */
(function (root) {
  "use strict";

  const LABELS = {
    pt: {
      note: "Nota", tip: "Dica", important: "Importante", warning: "Atenção", caution: "Cuidado", example: "Exemplo",
      question: "Pergunta", summary: "Resumo", success: "Certo", quote: "Citação", todo: "A fazer", bug: "Bug", failure: "Falha", missing: "Faltando",
      remote: "Imagem da internet: baixe o arquivo e troque este texto por \\includegraphics.",
      unsupported: "Formato de imagem que o LaTeX não lê: converta para PNG, JPG ou PDF.",
      diagram: "Diagrama", noDiagram: "Diagrama sem SVG (erro de sintaxe ou mapa mental vazio). Código original:",
      image: "Imagem",
    },
    en: {
      note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution", example: "Example",
      question: "Question", summary: "Summary", success: "Done", quote: "Quote", todo: "To do", bug: "Bug", failure: "Failure", missing: "Missing",
      remote: "Image from the web: download it and replace this text with \\includegraphics.",
      unsupported: "Image format LaTeX can't read: convert it to PNG, JPG or PDF.",
      diagram: "Diagram", noDiagram: "Diagram without an SVG (syntax error or empty mind map). Original code:",
      image: "Image",
    },
  };
  // mesmos tipos e apelidos do viewer.js; a cor é um nome do xcolor
  const CALLOUTS = {
    note: ["note", "blue"], info: ["note", "blue"], tip: ["tip", "teal"], hint: ["tip", "teal"],
    important: ["important", "violet"], warning: ["warning", "orange"], attention: ["warning", "orange"],
    caution: ["caution", "red"], danger: ["caution", "red"], error: ["caution", "red"],
    example: ["example", "gray"], question: ["question", "cyan"], faq: ["question", "cyan"],
    summary: ["summary", "teal"], abstract: ["summary", "teal"], tldr: ["summary", "teal"],
    success: ["success", "green"], check: ["success", "green"], quote: ["quote", "gray"], cite: ["quote", "gray"],
    done: ["success", "green"], todo: ["todo", "blue"], help: ["question", "cyan"], bug: ["bug", "red"],
    failure: ["failure", "red"], fail: ["failure", "red"], missing: ["missing", "red"],
  };
  const SECTIONS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"];
  // no abnTeX2 (ABNT), as divisões principais são capítulos
  const ABNT_SECTIONS = ["chapter", "section", "subsection", "subsubsection", "paragraph"];
  // ambientes de fórmula que já são de bloco: não podem ir dentro de \[ \]
  const DISPLAY_ENV = /^\\begin\{(align|alignat|gather|multline|flalign|equation)\*?\}/;
  const IMG_OK = /\.(png|jpe?g|pdf|eps)$/i;

  /* ---------------- texto ---------------- */
  const ESC = {
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#", "%": "\\%", _: "\\_",
    "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
  };
  // emoji não existem nas fontes do LaTeX (no pdflatex param a compilação): saem
  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
  const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: "\u00a0" };
  const unentity = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITY[e]);
  function esc(s) {
    return unentity(String(s)).replace(EMOJI, "").replace(/[\\{}$&#%_^~]/g, (c) => ESC[c]).replace(/\u00a0/g, "~");
  }
  // URL dentro de \href/\url: só # % \ { } precisam de cuidado
  const escUrl = (s) => String(s).replace(/[\\#%{}]/g, (c) => "\\" + c);
  // caminho de arquivo para \includegraphics: barras normais, sem %20
  function filePath(src) {
    let p = src.trim();
    try { p = decodeURIComponent(p); } catch (_) {}
    return p.replace(/^file:\/\//, "").replace(/\\/g, "/").replace(/^\.\//, "");
  }

  /* ---------------- conversor ---------------- */
  function Converter(opts) {
    this.abnt = !!opts.abnt;
    this.notes = new Map();                // [^id]: definição das notas de rodapé
    this.fnNum = new Map();                // [^id] → número já usado
    this.fnInline = 0;
    this.L = LABELS[opts.lang === "en" ? "en" : "pt"];
    this.lang = opts.lang === "en" ? "en" : "pt";
    this.figures = opts.figures || [];   // [{file, width, height}] ou null, um por diagrama
    this.fig = 0;
    this.use = new Set();                // pacotes que o texto realmente usou
  }
  const C = Converter.prototype;

  C.inline = function (tokens, ctx = {}) {
    let out = "";
    const open = [];                     // tags HTML de formatação abertas (<sub>, <kbd>…)
    for (const t of tokens || []) out += this.inlineOne(t, ctx, open);
    return out + "}".repeat(open.length);
  };

  const HTML_INLINE = {
    b: "\\textbf{", strong: "\\textbf{", i: "\\emph{", em: "\\emph{", u: "\\underline{", kbd: "\\texttt{",
    code: "\\texttt{", sub: "\\textsubscript{", sup: "\\textsuperscript{", s: "\\sout{", del: "\\sout{", mark: "\\colorbox{yellow!40}{",
  };
  C.inlineOne = function (t, ctx, open) {
    switch (t.type) {
      case "text":
        return t.tokens ? this.inline(t.tokens, ctx) : esc(t.text);
      case "escape": return esc(t.text);
      case "strong": return `\\textbf{${this.inline(t.tokens, ctx)}}`;
      case "em": return `\\emph{${this.inline(t.tokens, ctx)}}`;
      case "del": this.use.add("ulem"); return `\\sout{${this.inline(t.tokens, ctx)}}`;
      case "codespan": return `\\texttt{${esc(t.text)}}`;
      case "br": return ctx.cell ? (ctx.wrap ? "\\newline " : " ") : "\\\\\n";
      case "mathInline": return this.math(t.text, t.display && !ctx.cell, true);
      // sintaxe do Obsidian
      case "footnoteRef": {
        const def = t.id ? this.notes.get(t.id) : null;
        if (t.id && !def) return "";
        if (this.inNote) return "";                 // nota dentro de nota: o LaTeX não aceita
        // a mesma nota citada de novo repete o número, como no Obsidian
        if (t.id && this.fnNum.has(t.id)) return `\\footnotemark[${this.fnNum.get(t.id)}]`;
        if (t.id) this.fnNum.set(t.id, this.fnNum.size + this.fnInline + 1); else this.fnInline++;
        this.inNote = true;
        const body = t.id ? this.blocks(def).trim().replace(/\n\n+/g, "\\par ") : this.inline(t.tokens, ctx);
        this.inNote = false;
        return `\\footnote{${body}}`;
      }
      case "wikilink": {
        if (t.embed && /\.(png|jpe?g|pdf|eps|svg)$/i.test(t.target)) return this.image({ href: t.target, text: "" }, true);
        return esc(t.alias || t.target.replace(/#(.+)$/, ", $1").replace(/^, /, ""));
      }
      case "highlight": return `\\colorbox{yellow!40}{${this.inline(t.tokens, ctx)}}`;
      case "tag": return esc("#" + t.name);
      case "obsCommentInline": case "blockId": return "";
      case "citation": {
        // natbib: \citep dá (Souza, 2020) e \citeyearpar, só (2020); no ABNT, o \cite do abntex2cite dá (SOUZA, 2020)
        const keys = t.items.map((x) => x.key).join(",");
        const note = t.items.map((x) => x.note).filter(Boolean).pop();
        this.use.add(this.abnt ? "abntcite" : "natbib");
        const cmd = this.abnt ? (t.items[0].suppress ? "citeyear" : "cite") : t.items[0].suppress ? "citeyearpar" : "citep";
        return `\\${cmd}${note ? `[${esc(note)}]` : ""}{${keys}}`;
      }
      case "link": return this.link(t, ctx);
      case "image": return this.image(t, true);
      case "html": {
        const m = /^<(\/?)([a-z]+)\b[^>]*?(\/?)>$/i.exec(t.text.trim());
        if (!m) return esc(t.text.replace(/<[^>]*>/g, ""));
        const tag = m[2].toLowerCase();
        if (tag === "br") return ctx.cell ? " " : "\\\\\n";
        if (!HTML_INLINE[tag] || m[3]) return "";
        if (!m[1]) {
          if (tag === "s" || tag === "del") this.use.add("ulem");
          open.push(tag); return HTML_INLINE[tag];
        }
        const i = open.lastIndexOf(tag);
        if (i < 0) return "";
        const n = open.length - i; open.length = i;
        return "}".repeat(n);
      }
      default:
        return t.tokens ? this.inline(t.tokens, ctx) : esc(t.text || "");
    }
  };

  C.link = function (t, ctx) {
    const label = this.inline(t.tokens, ctx);
    const href = t.href || "";
    if (/^#/.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href)) return label;   // âncora ou outro .md: só o texto
    this.use.add("hyperref");
    if (/^mailto:/i.test(href) || unentity(t.text) === href) return `\\url{${escUrl(href.replace(/^mailto:/i, ""))}}`;
    return `\\href{${escUrl(href)}}{${label}}`;
  };

  C.math = function (tex, display, inline) {
    this.scanMath(tex);
    if (!display) return `$${tex}$`;
    if (DISPLAY_ENV.test(tex.trim())) return (inline ? "\n" : "") + tex.trim() + (inline ? "\n" : "");
    return `\\[\n${tex}\n\\]`;
  };
  C.scanMath = function (tex) {
    if (/\\(ce|pu)\s*\{/.test(tex)) this.use.add("mhchem");
    if (/\\[bx]?cancel(to)?\s*\{/.test(tex)) this.use.add("cancel");
    if (/\\(color|textcolor|colorbox)\b/.test(tex)) this.use.add("xcolor");
  };

  C.image = function (t, inline) {
    const src = (t.href || "").trim(), alt = esc(t.text || "");
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) {
      return `\\fbox{\\parbox{.8\\linewidth}{\\small ${alt || this.L.image}\\\\ \\url{${escUrl(src.slice(0, 200))}}}}% ${this.L.remote}`;
    }
    const path = filePath(src);
    let cmd;
    if (/\.svg$/i.test(path)) { this.use.add("svg"); cmd = `\\includesvg[width=\\linewidth]{${path}}`; }
    else if (IMG_OK.test(path)) {
      this.use.add("graphicx");
      cmd = inline ? `\\includegraphics[height=1.2em]{${path}}` : `\\includegraphics[width=\\linewidth,height=.45\\textheight,keepaspectratio]{${path}}`;
    } else return `\\fbox{\\small ${alt || esc(path)}}% ${this.L.unsupported} (${path.replace(/[\r\n]/g, " ")})`;
    if (inline) return cmd;
    return `\\begin{figure}[htbp]\n  \\centering\n  ${cmd}\n${alt ? `  \\caption{${alt}}\n` : ""}\\end{figure}`;
  };

  C.diagram = function (t) {
    const f = this.figures[this.fig++];
    if (!f) {
      const code = t.text.split("\n").map((l) => "% " + l).join("\n");
      return `% ${this.L.noDiagram}\n${code}`;
    }
    this.use.add("svg");
    // pequeno fica no tamanho natural (1 px = 0,75 pt); grande encaixa na largura, e o alto não passa de 60% da página
    const wPt = f.width * 0.75, hPt = f.height * 0.75, LINE = 450, PAGE = 0.6 * 680;
    let size = "";
    if (hPt * Math.min(1, LINE / wPt) > PAGE) size = "[height=.6\\textheight]";
    else if (wPt > LINE) size = "[width=\\linewidth]";
    return `\\begin{figure}[htbp]\n  \\centering\n  \\includesvg${size}{${f.file.replace(/\.svg$/i, "")}}\n\\end{figure}`;
  };

  C.table = function (t) {
    const cols = t.header.length;
    // tabela larga (texto corrido nas células) quebra linha dentro da coluna com tabularx; curta usa tabular
    const width = [];
    for (let c = 0; c < cols; c++) width[c] = Math.max(...[t.header[c], ...t.rows.map((r) => r[c])].map((x) => (x ? x.text.length : 0)));
    const wrap = width.reduce((a, b) => a + b + 3, 0) > 75;
    const spec = t.align.slice(0, cols).map((a) => {
      if (!wrap) return a === "center" ? "c" : a === "right" ? "r" : "l";
      return a === "center" ? ">{\\centering\\arraybackslash}X" : a === "right" ? ">{\\raggedleft\\arraybackslash}X" : ">{\\raggedright\\arraybackslash}X";
    });
    this.use.add("booktabs"); if (wrap) this.use.add("tabularx");
    const ctx = { cell: true, wrap };
    const row = (cells) => "    " + cells.map((c) => (c ? this.inline(c.tokens, ctx).trim() : "")).join(" & ") + " \\\\";
    const env = wrap ? "tabularx" : "tabular";
    const lines = [
      `  \\begin{${env}}${wrap ? "{\\linewidth}" : ""}{${spec.join("")}}`, "    \\toprule",
      row(t.header).replace(/^ {4}/, "    "), "    \\midrule", ...t.rows.map(row), "    \\bottomrule", `  \\end{${env}}`,
    ];
    return `\\begin{table}[htbp]\n  \\centering\n${lines.join("\n")}\n\\end{table}`;
  };

  C.list = function (t) {
    const env = t.ordered ? "enumerate" : "itemize";
    const start = t.ordered && t.start > 1 ? `\n  \\setcounter{enumi}{${t.start - 1}}` : "";
    const items = t.items.map((it) => {
      let mark = "";
      if (it.task) { this.use.add("amssymb"); mark = it.checked ? "[$\\boxtimes$]" : "[$\\square$]"; }
      // o marked põe o próprio checkbox como primeiro token do item
      const toks = it.tokens.filter((x) => x.type !== "checkbox");
      const body = this.blocks(toks).trim().replace(/\n/g, "\n    ");
      return `  \\item${mark} ${body}`;
    });
    return `\\begin{${env}}${start}\n${items.join("\n")}\n\\end{${env}}`;
  };

  C.blockquote = function (t) {
    const first = t.tokens[0];
    const m = first && first.type === "paragraph" && /^\s*\[!([A-Za-z]+)\]([+-]?)[ \t]*([^\n]*)\n?/.exec(first.text);
    const kind = m && CALLOUTS[m[1].toLowerCase()];
    if (!kind) return `\\begin{quote}\n${this.blocks(t.tokens).trim()}\n\\end{quote}`;
    this.use.add("tcolorbox");
    // o título e o marcador [!TIPO] saem do primeiro parágrafo; o resto dele é o começo do conteúdo
    const restText = first.text.slice(m[0].length);
    const title = m[3].trim() ? this.inline(marked.Lexer.lexInline(m[3].trim())) : this.L[kind[0]];
    const rest = restText.trim() ? [{ ...first, tokens: marked.Lexer.lexInline(restText) }] : [];
    const body = this.blocks([...rest, ...t.tokens.slice(1)]).trim();
    return `\\begin{mirantebox}{${kind[1]}}{${title}}\n${body}\n\\end{mirantebox}`;
  };

  C.html = function (t) {
    // <details><summary>Ver resposta</summary> vira um rótulo em negrito; o resto do HTML some
    const sum = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(t.text);
    let out = sum ? `\\noindent\\textbf{${esc(sum[1].replace(/<[^>]*>/g, "").trim())}}\\par` : "";
    const text = t.text.replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
    if (text && !/^<!--/.test(t.text.trim())) out += (out ? "\n" : "") + esc(text);
    return out;
  };

  C.code = function (t) {
    const lang = (t.lang || "").trim().split(/\s+/)[0].toLowerCase();
    if (["mermaid", "mmd", "dot", "graphviz", "gv"].includes(lang)) return this.diagram(t);
    if (lang === "math" || lang === "latex" && /^\s*\\begin\{(align|equation|gather)/.test(t.text)) return this.math(t.text.trim(), true);
    this.use.add("fancyvrb");
    const code = t.text.replace(/\t/g, "    ").replace(/\\end\{Verbatim\}/g, "\\end {Verbatim}");
    return `\\begin{Verbatim}[fontsize=\\small,frame=single,framesep=2mm,rulecolor=\\color{black!25}]\n${code}\n\\end{Verbatim}`;
  };

  C.block = function (t) {
    switch (t.type) {
      case "space": case "def": case "footnoteDef": case "obsComment": return "";
      case "heading": {
        const lvl = Math.max(0, t.depth - 1 - this.shift);
        const secs = this.abnt ? ABNT_SECTIONS : SECTIONS;
        return `\\${secs[Math.min(lvl, secs.length - 1)]}{${this.inline(t.tokens, { heading: true })}}`;
      }
      case "paragraph": {
        const only = t.tokens.filter((x) => !(x.type === "text" && !x.text.trim()));
        if (only.length === 1 && only[0].type === "image") return this.image(only[0], false);
        if (only.length === 1 && only[0].type === "wikilink" && only[0].embed && /\.(png|jpe?g|pdf|eps|svg)$/i.test(only[0].target)) {
          return this.image({ href: only[0].target, text: "" }, false);
        }
        return this.inline(t.tokens);
      }
      case "text": return t.tokens ? this.inline(t.tokens) : esc(t.text);
      case "code": return this.code(t);
      case "mathBlock": return this.math(t.text, true);
      case "table": return this.table(t);
      case "list": return this.list(t);
      case "blockquote": return this.blockquote(t);
      case "html": return this.html(t);
      case "hr": return "\\bigskip\\noindent\\rule{\\linewidth}{0.4pt}\\bigskip";
      default: return t.tokens ? this.inline(t.tokens) : esc(t.text || "");
    }
  };
  C.blocks = function (tokens) {
    return tokens.map((t) => this.block(t)).filter((s) => s !== "").join("\n\n");
  };

  /* ---------------- documento ---------------- */
  const FRONT_MATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/;

  function preamble(use, lang, abnt) {
    const p = [
      abnt ? "\\documentclass[12pt,openright,oneside,a4paper,english,brazil]{abntex2}" : "\\documentclass[12pt,a4paper]{article}",
      "\\usepackage{iftex}",
      "\\ifPDFTeX",
      "  \\usepackage[utf8]{inputenc}",
      "  \\usepackage[T1]{fontenc}",
      "  \\usepackage{lmodern}",
      "\\else",
      "  \\usepackage{fontspec}",
      "\\fi",
      // o abnTeX2 já cuida de idioma e margens (3 cm em cima e à esquerda, 2 cm embaixo e à direita)
      ...(abnt ? ["\\usepackage{indentfirst}"] : [`\\usepackage[${lang === "en" ? "english" : "brazil"}]{babel}`, "\\usepackage[margin=2.5cm]{geometry}"]),
      "\\usepackage{amsmath,amssymb}",
      "\\usepackage{xcolor}",
    ];
    if (use.has("mhchem")) p.push("\\usepackage[version=4]{mhchem}");
    if (use.has("cancel")) p.push("\\usepackage{cancel}");
    if (use.has("graphicx") || use.has("svg")) p.push("\\usepackage{graphicx}");
    if (use.has("svg")) p.push("\\usepackage{svg} % diagramas em SVG: precisa do Inkscape (o Overleaf já tem) e de --shell-escape");
    if (use.has("booktabs")) p.push("\\usepackage{booktabs}");
    if (use.has("tabularx")) p.push("\\usepackage{tabularx}");
    if (use.has("ulem")) p.push("\\usepackage[normalem]{ulem}");
    if (use.has("fancyvrb")) p.push("\\usepackage{fancyvrb}");
    if (use.has("natbib")) p.push(`\\usepackage[${use.has("natbib-num") ? "numbers,sort&compress" : "round"}]{natbib}`);
    if (use.has("tcolorbox")) {
      p.push("\\usepackage{tcolorbox}");
      p.push("% caixas de destaque (> [!TIP], > [!WARNING]...): #1 é a cor, #2 o título");
      p.push("\\newtcolorbox{mirantebox}[2]{colback=#1!6,colframe=#1!70!black,coltitle=white,fonttitle=\\bfseries,title={#2},arc=2mm}");
    }
    if (abnt) {
      if (use.has("abntcite")) p.push("\\usepackage[alf]{abntex2cite} % citações autor-data: (SOUZA, 2020)");
      // o abnTeX2 carrega o hyperref sozinho: aqui só as cores
      p.push("\\hypersetup{colorlinks=true,linkcolor=blue!60!black,citecolor=blue!60!black,urlcolor=blue!60!black}");
    } else {
      p.push("\\usepackage[colorlinks=true,linkcolor=blue!60!black,urlcolor=blue!60!black]{hyperref}");
    }
    return p.join("\n");
  }

  /** Documento completo. figures: um item por diagrama, na ordem do texto ({file, width, height} ou null). */
  function fromMarkdown(text, opts = {}) {
    const conv = new Converter(opts);
    const tokens = marked.lexer(String(text).replace(FRONT_MATTER, ""));
    marked.walkTokens(tokens, (t) => { if (t.type === "footnoteDef") conv.notes.set(t.id, t.tokens); });
    // um único # no começo vira o título do documento; os ## passam a ser as seções
    const h1 = tokens.filter((t) => t.type === "heading" && t.depth === 1);
    const firstHeading = tokens.find((t) => t.type === "heading");
    let title = null;
    if (h1.length === 1 && firstHeading === h1[0]) {
      title = conv.inline(h1[0].tokens, { heading: true });
      tokens.splice(tokens.indexOf(h1[0]), 1);
      conv.shift = 1;
    } else {
      const depths = tokens.filter((t) => t.type === "heading").map((t) => t.depth);
      conv.shift = depths.length ? Math.min(...depths) - 1 : 0;
    }
    if (opts.abnt) return fromAbnt(text, opts, conv, tokens, title);
    let body = conv.blocks(tokens);
    if (opts.bib && opts.bib.length && (conv.use.has("natbib") || opts.nocite)) {
      conv.use.add("natbib");
      if (opts.numeric) conv.use.add("natbib-num");
      body += `\n\n${opts.nocite ? "\\nocite{*}\n" : ""}\\bibliographystyle{${opts.numeric ? "unsrtnat" : "plainnat"}}\n\\bibliography{${opts.bib.join(",")}}`;
    }
    const head = [
      `% ${opts.lang === "en" ? "Generated by Mirante from" : "Gerado pelo Mirante a partir de"} ${opts.source || "Markdown"}.`,
      opts.lang === "en"
        ? "% Compiles with pdflatex, xelatex or lualatex; on Overleaf, upload this file and the .svg files next to it."
        : "% Compila com pdflatex, xelatex ou lualatex; no Overleaf, envie este arquivo e os .svg que estão junto dele.",
      preamble(conv.use, conv.lang),
    ];
    if (title) head.push("", `\\title{${title}}`, "\\author{} % " + (opts.lang === "en" ? "your name" : "seu nome"), "\\date{\\today}");
    const doc = [...head, "", "\\begin{document}", ...(title ? ["\\maketitle", ""] : []), body, "", "\\end{document}", ""];
    return doc.join("\n").replace(/[ \t]+$/gm, "");
  }

  /* ---------------- ABNT (abnTeX2) ---------------- */

  // cabeçalho do .md: "chave: valor", aspas opcionais; listas "- item" viram "a; b; c"
  function parseMeta(text) {
    const m = FRONT_MATTER.exec(String(text));
    const meta = {};
    if (!m) return meta;
    let last = null;
    for (const line of m[0].split(/\r?\n/).slice(1, -1)) {
      const kv = /^([A-Za-zÀ-ú][\w\-À-ú ]*?):\s*(.*)$/.exec(line);
      if (kv) { last = kv[1].trim().toLowerCase(); meta[last] = kv[2].trim().replace(/^["']|["']$/g, ""); continue; }
      const item = /^\s+-\s*(.+)$/.exec(line);
      if (item && last) meta[last] = (meta[last] ? meta[last] + "; " : "") + item[1].trim().replace(/^["']|["']$/g, "");
    }
    return meta;
  }
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const pick = (meta, ...keys) => { for (const k of keys) if (meta[k]) return meta[k]; return ""; };

  function fromAbnt(text, opts, conv, tokens, title) {
    const meta = parseMeta(text), L = opts.lang === "en" ? "en" : "pt";
    // o que é capítulo depende de ter um # de título: com ele, os ## são capítulos
    const chapterDepth = conv.shift + 1;
    const buckets = { main: [], resumo: [], abstract: [], apendices: [], anexos: [] };
    let cur = "main";
    for (const t of tokens) {
      if (t.type === "heading" && t.depth <= chapterDepth) {
        const h = norm(t.text);
        if (/^resumo$/.test(h)) { cur = "resumo"; continue; }
        if (/^(abstract|resumen)$/.test(h)) { cur = "abstract"; continue; }
        if (/^(referencias|references|bibliografia)$/.test(h)) { cur = "drop"; continue; }
        if (/^apendices?\b/.test(h) || /^anexos?\b/.test(h)) {
          cur = /^ap/.test(h) ? "apendices" : "anexos";
          // "Apêndice A – Questionário" vira só "Questionário": a letra o abnTeX2 põe
          const clean = t.text.replace(/^\s*(ap[eê]ndices?|anexos?)\s*[A-Z]?\s*[–—:-]?\s*/i, "").trim();
          if (!clean) continue;
          buckets[cur].push({ ...t, text: clean, tokens: marked.Lexer.lexInline(clean) });
          continue;
        }
        cur = "main";
      }
      if (cur !== "drop") buckets[cur].push(t);
    }
    // uma caixa > [!SUMMARY] antes do primeiro capítulo serve de resumo, se não houver um "## Resumo"
    if (!buckets.resumo.length) {
      const i = buckets.main.findIndex((t) => t.type !== "space");
      const t = buckets.main[i];
      if (t && t.type === "blockquote" && /^\s*\[!(summary|abstract|tldr)\]/i.test(t.text)) {
        buckets.main.splice(i, 1);
        const rest = t.text.replace(/^\s*\[![^\]]+\][+-]?[^\n]*\n?/, "");
        buckets.resumo = marked.lexer(rest);
      }
    }
    const part = (ts) => conv.blocks(ts).trim();
    const body = part(buckets.main), resumo = part(buckets.resumo), abstract = part(buckets.abstract);
    const apendices = part(buckets.apendices), anexos = part(buckets.anexos);

    // campo da capa: o que faltar sai com um texto de exemplo e o aviso no comentário, depois da chave
    const field = (cmd, v, fallback) => `\\${cmd}{${v ? esc(v) : fallback}}${v ? "" : ` % ${L === "en" ? "fill in" : "preencha"}`}`;
    const tituloTxt = pick(meta, "titulo", "título", "title");
    const instituicao = pick(meta, "instituicao", "instituição", "universidade", "institution");
    const curso = pick(meta, "curso", "departamento", "programa", "course");
    const tipo = pick(meta, "tipo", "tipo de trabalho", "tipotrabalho", "type") || "Trabalho de Conclusão de Curso";
    const grau = pick(meta, "grau", "titulo obtido", "degree");
    const preambuloTxt = pick(meta, "preambulo", "preâmbulo") ||
      `${tipo} apresentado ${instituicao ? `à ${instituicao}` : "à instituição"}${curso ? `, ${curso},` : ""} como requisito parcial para a obtenção do ${grau ? `título de ${grau}` : "título"}.`;
    const kw = pick(meta, "palavras-chave", "palavras chave", "palavraschave");
    const kwEn = pick(meta, "keywords", "key-words");
    const bibs = opts.bib || [];
    if (bibs.length) conv.use.add("abntcite");

    const head = [
      `% ${L === "en" ? "Generated by Mirante from" : "Gerado pelo Mirante a partir de"} ${opts.source || "Markdown"}, no modelo da ABNT (abnTeX2).`,
      "% Compile com pdflatex e bibtex (o Overleaf faz tudo sozinho). A classe abntex2 já vem no TeX Live, no MiKTeX e no Overleaf.",
      "% Os dados da capa vêm do cabeçalho do .md (titulo, autor, instituicao, curso, tipo, orientador, cidade, ano, palavras-chave).",
      preamble(conv.use, conv.lang, true),
      "",
      tituloTxt ? field("titulo", tituloTxt) : title ? `\\titulo{${title}}` : field("titulo", "", "Título do trabalho"),
      field("autor", pick(meta, "autor", "autora", "author"), "Seu Nome"),
      field("local", pick(meta, "cidade", "local", "city"), "Cidade"),
      `\\data{${esc(pick(meta, "ano", "data", "year", "date") || String(new Date().getFullYear()))}}`,
      field("orientador", pick(meta, "orientador", "orientadora", "advisor"), "Prof. Dr. Nome do Orientador"),
      ...(pick(meta, "coorientador", "coorientadora") ? [`\\coorientador{${esc(pick(meta, "coorientador", "coorientadora"))}}`] : []),
      `\\instituicao{${instituicao ? esc(instituicao) : "Nome da Instituição"}${curso ? ` \\par ${esc(curso)}` : ""}}${instituicao ? "" : " % preencha"}`,
      `\\tipotrabalho{${esc(tipo)}}`,
      `\\preambulo{${esc(preambuloTxt)}}`,
    ];
    const kwLine = (label, v) => (v ? `\n\n\\vspace{\\onelineskip}\n\\noindent\\textbf{${label}}: ${esc(v.replace(/\s*[;,]\s*/g, ". ").replace(/\.?$/, "."))}` : "");
    const doc = [
      ...head, "",
      "\\begin{document}",
      "\\selectlanguage{brazil}",
      "\\frenchspacing",
      "",
      "% ---------- elementos pré-textuais",
      "\\pretextual",
      "\\imprimircapa",
      "\\imprimirfolhaderosto",
      "",
      "\\begin{resumo}",
      (resumo || "Escreva aqui o resumo do trabalho. % preencha, ou use um \"## Resumo\" no .md") + kwLine("Palavras-chave", kw),
      "\\end{resumo}",
      ...(abstract || kwEn ? ["", "\\begin{resumo}[Abstract]", "\\begin{otherlanguage*}{english}", (abstract || "") + kwLine("Keywords", kwEn), "\\end{otherlanguage*}", "\\end{resumo}"] : []),
      "",
      "\\pdfbookmark[0]{\\contentsname}{toc}",
      "\\tableofcontents*",
      "\\cleardoublepage",
      "",
      "% ---------- elementos textuais",
      "\\textual",
      "",
      body,
      "",
      "% ---------- elementos pós-textuais",
      "\\postextual",
      ...(bibs.length ? [`${opts.nocite ? "\\nocite{*}\n" : ""}\\bibliography{${bibs.join(",")}}`] : []),
      ...(apendices ? ["", "\\begin{apendicesenv}", "\\partapendices", apendices, "\\end{apendicesenv}"] : []),
      ...(anexos ? ["", "\\begin{anexosenv}", "\\partanexos", anexos, "\\end{anexosenv}"] : []),
      "",
      "\\end{document}", "",
    ];
    return doc.join("\n").replace(/[ \t]+$/gm, "");
  }

  /** Só uma tabela do marked, sem o documento em volta (para colar num .tex que já existe). */
  function fromTable(token, opts = {}) {
    const conv = new Converter(opts);
    const tex = conv.table(token);
    const pk = ["booktabs", "tabularx", "ulem", "mhchem", "cancel", "amssymb", "graphicx", "svg", "hyperref"].filter((p) => conv.use.has(p));
    return `% ${opts.lang === "en" ? "requires" : "requer"} \\usepackage{${pk.join(",")}}\n${tex}\n`;
  }

  /** As tabelas do texto, na ordem em que aparecem (as mesmas que o marked desenha como <table>). */
  function tables(text) {
    const out = [];
    marked.walkTokens(marked.lexer(String(text).replace(FRONT_MATTER, "")), (t) => { if (t.type === "table") out.push(t); });
    return out;
  }

  root.MiranteLatex = { fromMarkdown, fromTable, tables, escape: esc, parseMeta };
})(this);
