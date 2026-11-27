/* Mirante — Markdown → Word (.docx).
 * Gera o arquivo inteiro aqui, sem programa externo: o .docx é um ZIP de XMLs. Títulos usam os estilos do Word
 * (entram no sumário e no painel de navegação), fórmulas viram equações nativas do Word (OMML, editáveis),
 * diagramas e imagens entram como PNG. Quem chama fornece as imagens, os diagramas e as fórmulas. */
(function (root) {
  "use strict";

  const enc = new TextEncoder();
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const unent = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }[e]));

  /* ---------------- ZIP (sem compressão, que o Word aceita) ---------------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {                    // files: [{name, data: Uint8Array}]
    const chunks = [], central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
      chunks.push(head, name, f.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  /* ---------------- fórmulas: MathML do KaTeX → OMML do Word ---------------- */
  const NARY = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂"]);
  const ACCENT = { "¯": "̅", "‾": "̅", "^": "̂", "ˆ": "̂", "~": "̃", "˜": "̃", "→": "⃗", "⃗": "⃗", "˙": "̇", "¨": "̈", "ˇ": "̌", "˘": "̆", "´": "́", "`": "̀" };
  function mrun(text, plain) {
    if (!text) return "";
    return `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${xml(text)}</m:t></m:r>`;
  }
  const kids = (n) => [...n.children];
  // parte vazia (o \ce do KaTeX usa bases e índices invisíveis): o Word desenharia uma caixinha no lugar
  const ZW = mrun(" ", true);
  const filled = (x) => (x && x.replace(/<[^>]+>/g, "").replace(/\u200B/g, "").trim() ? x : "");
  const naryOp = (n) => {                  // ∑ e ∫, sozinhos ou com limites
    if (!n) return null;
    const tag = n.localName;
    if (tag === "mo" && NARY.has(n.textContent.trim())) return { chr: n.textContent.trim(), sub: null, sup: null, under: false };
    if (/^(msub|msup|msubsup|munder|mover|munderover)$/.test(tag)) {
      const [b, x, y] = kids(n);
      if (!b || b.localName !== "mo" || !NARY.has(b.textContent.trim())) return null;
      const under = tag.startsWith("mu") || tag === "mover";
      const lo = /sub|under/.test(tag) ? x : null;
      const hi = tag === "msup" || tag === "mover" ? x : /subsup|underover/.test(tag) ? y : null;
      return { chr: b.textContent.trim(), sub: lo, sup: hi, under };
    }
    return null;
  }
  // índice com base vazia (\ce{CO2} vira C, O e um ₂ solto): o índice gruda no que veio antes
  function script(base, lo, hi) {
    if (lo && hi) return `<m:sSubSup><m:e>${base}</m:e><m:sub>${lo}</m:sub><m:sup>${hi}</m:sup></m:sSubSup>`;
    if (lo) return `<m:sSub><m:e>${base}</m:e><m:sub>${lo}</m:sub></m:sSub>`;
    if (hi) return `<m:sSup><m:e>${base}</m:e><m:sup>${hi}</m:sup></m:sSup>`;
    return base;
  }
  function row(nodes) {
    const pieces = [];
    let out = "";
    const flush = () => { out += pieces.join(""); pieces.length = 0; };
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], tag = n.localName;
      if (/^(msub|msup|msubsup)$/.test(tag) && !filled(om(n.children[0]))) {
        const c = kids(n);
        const lo = tag === "msup" ? "" : filled(om(c[1])), hi = tag === "msub" ? "" : filled(om(c[tag === "msup" ? 1 : 2]));
        if (!lo && !hi) continue;
        pieces.push(script(pieces.length ? pieces.pop() : ZW, lo, hi));
        continue;
      }
      if (naryOp(n)) { flush(); }
      const op = naryOp(nodes[i]);
      if (op) {
        // o operando do ∑ é o que vem logo depois (o MathML não agrupa)
        const e = i + 1 < nodes.length ? om(nodes[++i]) : "";
        pieces.push(`<m:nary><m:naryPr><m:chr m:val="${xml(op.chr)}"/><m:limLoc m:val="${op.under ? "undOvr" : "subSup"}"/>` +
          `${op.sub ? "" : '<m:subHide m:val="1"/>'}${op.sup ? "" : '<m:supHide m:val="1"/>'}</m:naryPr>` +
          `<m:sub>${op.sub ? om(op.sub) : ""}</m:sub><m:sup>${op.sup ? om(op.sup) : ""}</m:sup><m:e>${e}</m:e></m:nary>`);
        continue;
      }
      const piece = om(n);
      if (piece) pieces.push(piece);
    }
    flush();
    return out;
  }
  function om(n) {
    const tag = n.localName, c = kids(n);
    switch (tag) {
      case "math": case "mrow": case "mstyle": case "mpadded": case "menclose": case "mtd": return row(c);
      case "semantics": return row(c.filter((x) => !/^annotation/.test(x.localName)));
      case "annotation": case "annotation-xml": case "mphantom": return "";
      case "mi": { const t = n.textContent; return mrun(t, t.length > 1 || n.getAttribute("mathvariant") === "normal"); }
      case "mn": return mrun(n.textContent, true);
      case "mo": return mrun(n.textContent, true);
      case "mtext": case "ms": return mrun(n.textContent.replace(/ /g, " "), true);
      case "mspace": return mrun(" ", true);
      case "msup": case "msub": case "msubsup": {
        const base = om(c[0]) || ZW;
        let lo = tag === "msup" ? "" : filled(om(c[1])), hi = tag === "msub" ? "" : filled(om(c[tag === "msup" ? 1 : 2]));
        if (lo && hi) return `<m:sSubSup><m:e>${base}</m:e><m:sub>${lo}</m:sub><m:sup>${hi}</m:sup></m:sSubSup>`;
        if (lo) return `<m:sSub><m:e>${base}</m:e><m:sub>${lo}</m:sub></m:sSub>`;
        if (hi) return `<m:sSup><m:e>${base}</m:e><m:sup>${hi}</m:sup></m:sSup>`;
        return base === ZW ? "" : base;
      }
      case "mfrac": {
        if (!filled(om(c[0])) && !filled(om(c[1]))) return "";
        const bar = n.getAttribute("linethickness");
        const pr = bar && parseFloat(bar) === 0 ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : "";
        return `<m:f>${pr}<m:num>${om(c[0])}</m:num><m:den>${om(c[1])}</m:den></m:f>`;
      }
      case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${row(c)}</m:e></m:rad>`;
      case "mroot": return `<m:rad><m:deg>${om(c[1])}</m:deg><m:e>${om(c[0])}</m:e></m:rad>`;
      case "mover": case "munder": case "munderover": {
        const accent = n.getAttribute("accent") === "true" || n.getAttribute("accentunder") === "true";
        if (tag === "mover" && accent && c[1] && c[1].localName === "mo") {
          const chr = ACCENT[c[1].textContent.trim()] || c[1].textContent.trim();
          return `<m:acc><m:accPr><m:chr m:val="${xml(chr)}"/></m:accPr><m:e>${om(c[0])}</m:e></m:acc>`;
        }
        const base = om(c[0]) || ZW;
        const lo = tag === "mover" ? "" : filled(om(c[1])), hi = tag === "munder" ? "" : filled(om(c[tag === "mover" ? 1 : 2]));
        let out = base;
        if (lo) out = `<m:limLow><m:e>${out}</m:e><m:lim>${lo}</m:lim></m:limLow>`;
        if (hi) out = `<m:limUpp><m:e>${out}</m:e><m:lim>${hi}</m:lim></m:limUpp>`;
        return out === ZW ? "" : out;
      }
      case "mtable": {
        const rows = c.filter((r) => /^mtr|mlabeledtr$/.test(r.localName));
        return `<m:m>${rows.map((r) => `<m:mr>${kids(r).filter((x) => x.localName === "mtd").map((d) => `<m:e>${om(d)}</m:e>`).join("")}</m:mr>`).join("")}</m:m>`;
      }
      default: return row(c);
    }
  }
  /** MathML (a saída do KaTeX com output: "mathml") em OMML. */
  function mathml2omml(mathml) {
    const doc = new DOMParser().parseFromString(mathml, "text/html");
    const m = doc.querySelector("math");
    return m ? om(m) : "";
  }

  /* ---------------- documento ---------------- */
  const CALLOUT = { note: "007AFF", info: "007AFF", tip: "34C759", hint: "34C759", important: "AF52DE", warning: "FF9500",
    attention: "FF9500", caution: "FF3B30", danger: "FF3B30", error: "FF3B30", example: "8E8E93", question: "32ADE6",
    faq: "32ADE6", summary: "30B0C7", abstract: "30B0C7", tldr: "30B0C7", success: "34C759", check: "34C759", quote: "8E8E93",
    done: "34C759", todo: "007AFF", help: "32ADE6", bug: "FF3B30", failure: "FF3B30", fail: "FF3B30", missing: "FF3B30", cite: "8E8E93" };
  const TITLES = { pt: { note: "Nota", tip: "Dica", important: "Importante", warning: "Atenção", caution: "Cuidado", example: "Exemplo",
    question: "Pergunta", summary: "Resumo", success: "Certo", quote: "Citação", todo: "A fazer", help: "Ajuda", bug: "Bug",
    failure: "Falha", missing: "Faltando", done: "Feito" },
    en: { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution", example: "Example",
    question: "Question", summary: "Summary", success: "Done", quote: "Quote", todo: "To do", help: "Help", bug: "Bug",
    failure: "Failure", missing: "Missing", done: "Done" } };
  const ALIAS = { info: "note", hint: "tip", attention: "warning", danger: "caution", error: "caution", faq: "question", abstract: "summary", tldr: "summary", check: "success", fail: "failure", cite: "quote" };
  const MAX_W = 6 * 914400;                // 6 polegadas de largura útil (A4 com margens de 2,5 cm), em EMU

  function Doc(opts) {
    this.o = opts;
    this.lang = opts.lang === "en" ? "en" : "pt";
    this.rels = [];                        // [{id, type, target, mode}]
    this.media = [];                       // [{name, data}]
    this.nums = [];                        // listas numeradas: cada uma recomeça
    this.fig = 0;
    this.imgId = 0;
    this.notes = new Map();                // [^id]: definições
    this.footnotes = [];                   // <w:footnote> prontos
    this.fnNum = new Map();                // [^id] → número da nota no Word
  }
  const D = Doc.prototype;
  D.rel = function (type, target, external) {
    const id = "rId" + (this.rels.length + 10);
    this.rels.push({ id, type, target, external });
    return id;
  };

  /* texto e formatação */
  D.runs = function (tokens, f = {}) {
    let out = "";
    for (const t of tokens || []) out += this.run(t, f);
    return out;
  };
  D.text = function (s, f) {
    if (!s) return "";
    const pr = [
      f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : "",
      f.b ? "<w:b/>" : "", f.i ? "<w:i/>" : "", f.strike ? "<w:strike/>" : "",
      f.color ? `<w:color w:val="${f.color}"/>` : "", f.u ? '<w:u w:val="single"/>' : "",
      f.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/>' : "",
      f.sup ? '<w:vertAlign w:val="superscript"/>' : f.sub ? '<w:vertAlign w:val="subscript"/>' : "",
      f.size ? `<w:sz w:val="${f.size}"/>` : "",
      f.mark ? '<w:highlight w:val="yellow"/>' : "",
    ].join("");
    // quebras de linha do texto viram <w:br/>
    // no Markdown, a quebra simples dentro do parágrafo é um espaço (a forçada vem como token "br")
    const txt = f.code ? unent(s) : unent(s).replace(/[ \t]*\n[ \t]*/g, " ");
    return txt.split("\n").map((part, k) => (k ? "<w:br/>" : "") + `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`).join("");
  };
  D.run = function (t, f) {
    switch (t.type) {
      case "text": return t.tokens ? this.runs(t.tokens, f) : this.text(t.text, f);
      case "escape": return this.text(t.text, f);
      case "strong": return this.runs(t.tokens, { ...f, b: true });
      case "em": return this.runs(t.tokens, { ...f, i: true });
      case "del": return this.runs(t.tokens, { ...f, strike: true });
      case "codespan": return this.text(t.text, { ...f, code: true });
      case "br": return "<w:r><w:br/></w:r>";
      case "link": {
        const href = t.href || "";
        // dentro da nota de rodapé o link não tem como ir (o vínculo seria de outra parte do arquivo): fica o texto
        if (this.inNote) return this.runs(t.tokens, f) + (/^https?:/i.test(href) ? this.text(` (${href})`, f) : "");
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return this.runs(t.tokens, f);   // âncora ou outro .md: só o texto
        const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", href, true);
        return `<w:hyperlink r:id="${id}">${this.runs(t.tokens, { ...f, color: "0563C1", u: true })}</w:hyperlink>`;
      }
      case "image": return this.o.images && this.o.images[t.href] ? this.drawing(this.o.images[t.href], true) : this.text(t.text ? `[${t.text}]` : "", f);
      case "mathInline": return this.math(t.text, false);
      // sintaxe do Obsidian; a nota de rodapé vira nota de rodapé do Word
      case "footnoteRef": return this.footnote(t);
      case "wikilink": {
        const img = t.embed && this.o.images && this.o.images[t.target];
        if (img) return this.drawing(img, false);
        return this.text(t.alias || t.target.replace(/#(.+)$/, " › $1").replace(/^ › /, ""), f);
      }
      case "highlight": return this.runs(t.tokens, { ...f, mark: true });
      case "tag": return this.text("#" + t.name, { ...f, color: "007AFF" });
      case "obsCommentInline": case "blockId": return "";
      case "citation": return this.text(this.o.cite ? this.o.cite(t.items) : t.raw, f);
      case "html": {
        const tag = /^<(\/?)(sub|sup|b|strong|i|em|u|kbd|code|br)\b/i.exec(t.text.trim());
        if (tag && tag[2].toLowerCase() === "br") return "<w:r><w:br/></w:r>";
        return "";                         // as tags de formatação soltas não têm texto
      }
      default: return t.tokens ? this.runs(t.tokens, f) : this.text(t.text || "", f);
    }
  };
  D.footnote = function (t) {
    const def = t.id ? this.notes.get(t.id) : null;
    if ((t.id && !def) || this.inNote) return "";
    // a mesma nota citada de novo: repete o número (o Word não liga duas chamadas à mesma nota)
    if (t.id && this.fnNum.has(t.id)) return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>${this.fnNum.get(t.id)}</w:t></w:r>`;
    this.inNote = true;
    let xml = def ? this.blocks(def) : this.p(this.runs(t.tokens));
    this.inNote = false;
    const id = this.footnotes.length + 1;
    if (t.id) this.fnNum.set(t.id, id);
    // o número da nota no começo do primeiro parágrafo, e o estilo de nota de rodapé em todos
    const mark = '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
    xml = xml.replace(/<w:p>(<w:pPr>)?/g, (_, pPr) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/>${pPr ? "" : "</w:pPr>"}`);
    xml = xml.replace(/(<w:p><w:pPr>[\s\S]*?<\/w:pPr>)/, `$1${mark}`);
    this.footnotes.push(`<w:footnote w:id="${id}">${xml || `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${mark}</w:p>`}</w:footnote>`);
    return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  };
  D.math = function (tex, display) {
    const omml = this.o.math ? this.o.math(tex, display) : "";
    if (!omml) return this.text(tex, { i: true });
    return display ? `<m:oMathPara><m:oMath>${omml}</m:oMath></m:oMathPara>` : `<m:oMath>${omml}</m:oMath>`;
  };

  /* parágrafos */
  D.p = function (content, pPr = "") {
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
  };
  D.drawing = function (img, inline) {
    // img: {data: Uint8Array, ext: "png"|"jpeg"|"gif", w, h} em pixels
    const n = this.media.length + 1, name = `image${n}.${img.ext}`;
    this.media.push({ name, data: img.data });
    const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/${name}`);
    let cx = Math.round(img.w * 9525), cy = Math.round(img.h * 9525);
    const max = inline ? 914400 * 0.25 : MAX_W;
    if (inline) { cy = Math.min(cy, max); cx = Math.round(cy * img.w / img.h); }
    else if (cx > max) { cy = Math.round(cy * max / cx); cx = max; }
    const did = ++this.imgId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${did}" name="Imagem ${did}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${did}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  D.figure = function (img, caption) {
    let out = this.p(this.drawing(img, false), '<w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/>');
    if (caption) out += this.p(this.text(caption, { i: true, size: 18 }), '<w:pStyle w:val="Caption"/><w:jc w:val="center"/>');
    return out;
  };

  D.blocks = function (tokens, ctx = {}) {
    return tokens.map((t) => this.block(t, ctx)).join("");
  };
  D.block = function (t, ctx) {
    const quote = ctx.quote ? `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${ctx.quote}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${ctx.fill || "FFFFFF"}"/><w:ind w:left="240"/>` : "";
    switch (t.type) {
      case "space": case "def": case "footnoteDef": case "obsComment": return "";
      case "heading": {
        const lvl = Math.max(1, t.depth - (this.shift || 0));
        if (t.depth === 1 && this.titleUsed === t) return this.p(this.runs(t.tokens), '<w:pStyle w:val="Title"/>');
        return this.p(this.runs(t.tokens), `<w:pStyle w:val="Heading${Math.min(lvl, 6)}"/>`);
      }
      case "paragraph": {
        const only = t.tokens.filter((x) => !(x.type === "text" && !x.text.trim()));
        if (only.length === 1 && only[0].type === "image") {
          const img = this.o.images && this.o.images[only[0].href];
          return img ? this.figure(img, only[0].text) : this.p(this.text(`[${only[0].text || only[0].href}]`, { i: true }), quote);
        }
        if (only.length === 1 && only[0].type === "mathInline" && only[0].display) return this.p(this.math(only[0].text, true), quote);
        if (only.length === 1 && only[0].type === "wikilink" && only[0].embed && this.o.images && this.o.images[only[0].target]) {
          return this.figure(this.o.images[only[0].target], "");
        }
        return this.p(this.runs(t.tokens), quote + (ctx.list || ""));
      }
      case "text": return this.p(t.tokens ? this.runs(t.tokens) : this.text(t.text, {}), quote + (ctx.list || ""));
      case "mathBlock": return this.p(this.math(t.text, true), quote);
      case "code": {
        const lang = (t.lang || "").trim().split(/\s+/)[0].toLowerCase();
        if (/^(mermaid|mmd|dot|graphviz|gv)$/.test(lang)) {
          const img = this.o.diagrams ? this.o.diagrams[this.fig++] : null;
          return img ? this.figure(img, "") : this.p(this.text(t.text, { code: true }), '<w:pStyle w:val="Code"/>');
        }
        if (lang === "math") return this.p(this.math(t.text, true));
        return t.text.replace(/\t/g, "    ").split("\n").map((l) => this.p(this.text(l || " ", { code: true }), '<w:pStyle w:val="Code"/>')).join("");
      }
      case "table": {
        const align = (k) => ({ center: "center", right: "right" }[t.align[k]] || "left");
        const cell = (c, k, head) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/>' : ""}</w:tcPr>` +
          this.p(this.runs(c.tokens, head ? { b: true } : {}), `<w:jc w:val="${align(k)}"/><w:spacing w:before="40" w:after="40"/>`) + "</w:tc>";
        const rows = [`<w:tr><w:trPr><w:tblHeader/></w:trPr>${t.header.map((c, k) => cell(c, k, true)).join("")}</w:tr>`,
          ...t.rows.map((r) => `<w:tr>${r.map((c, k) => cell(c, k, false)).join("")}</w:tr>`)];
        const b = '<w:top w:val="single" w:sz="4" w:color="C7C7CC"/><w:left w:val="single" w:sz="4" w:color="C7C7CC"/><w:bottom w:val="single" w:sz="4" w:color="C7C7CC"/><w:right w:val="single" w:sz="4" w:color="C7C7CC"/><w:insideH w:val="single" w:sz="4" w:color="C7C7CC"/><w:insideV w:val="single" w:sz="4" w:color="C7C7CC"/>';
        return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblBorders>${b}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${rows.join("")}</w:tbl>` + this.p("", '<w:spacing w:after="0"/>');
      }
      case "list": {
        const depth = (ctx.depth || 0);
        let num;
        if (t.ordered) { this.nums.push(t.start || 1); num = this.nums.length + 1; } else num = 1;   // 1 = marcadores
        return t.items.map((it) => {
          const mark = it.task ? (it.checked ? "☒ " : "☐ ") : "";
          const listPr = `<w:numPr><w:ilvl w:val="${Math.min(depth, 8)}"/><w:numId w:val="${it.task ? 0 : num}"/></w:numPr>` + (it.task ? `<w:ind w:left="${360 + depth * 360}"/>` : "");
          let first = true;
          return it.tokens.filter((x) => x.type !== "checkbox").map((x) => {
            if (x.type === "list") return this.block(x, { ...ctx, depth: depth + 1 });
            if ((x.type === "text" || x.type === "paragraph") && first) {
              first = false;
              const content = (mark ? this.text(mark, {}) : "") + (x.tokens ? this.runs(x.tokens) : this.text(x.text, {}));
              return this.p(content, listPr + '<w:spacing w:after="60"/>');
            }
            return this.block(x, { ...ctx, list: `<w:ind w:left="${720 + depth * 360}"/>` });
          }).join("");
        }).join("");
      }
      case "blockquote": {
        const first = t.tokens[0];
        const m = first && first.type === "paragraph" && /^\s*\[!([A-Za-z]+)\][+-]?[ \t]*([^\n]*)\n?/.exec(first.text);
        const kind = m && m[1].toLowerCase();
        if (kind && CALLOUT[kind]) {
          const color = CALLOUT[kind], fill = color + "";
          const title = m[2].trim() || TITLES[this.lang][ALIAS[kind] || kind] || m[1];
          const rest = first.text.slice(m[0].length);
          const restTokens = rest.trim() ? [{ type: "paragraph", tokens: root.marked.Lexer.lexInline(rest) }] : [];
          const sub = { quote: color, fill: tint(color) };
          return this.p(this.text(title, { b: true, color }), `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${color}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${tint(fill)}"/><w:ind w:left="240"/><w:spacing w:after="0"/>`) +
            this.blocks([...restTokens, ...t.tokens.slice(1)], sub);
        }
        return this.blocks(t.tokens, { quote: "C7C7CC", fill: "FFFFFF" });
      }
      case "html": {
        const sum = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(t.text);
        if (sum) return this.p(this.text(sum[1].replace(/<[^>]*>/g, "").trim(), { b: true }));
        const text = t.text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim();
        return text && !/^<!--/.test(t.text.trim()) ? this.p(this.text(text, {})) : "";
      }
      case "hr": return this.p("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C7C7CC"/></w:pBdr>');
      default: return t.tokens ? this.p(this.runs(t.tokens)) : "";
    }
  };
  // a cor da caixa bem clarinha, para o fundo
  function tint(hex) {
    const n = parseInt(hex, 16), mix = (c) => Math.round(c + (255 - c) * 0.9);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  /* ---------------- partes fixas do pacote ---------------- */
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  function styles(lang) {
    const h = (n, size, before) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="1C1C1E"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang === "en" ? "en-US" : "pt-BR"}"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>` +
      h(1, 36, 360) + h(2, 30, 320) + h(3, 26, 280) + h(4, 24, 240) + h(5, 22, 200) + h(6, 22, 200) +
      `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F7"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="6E6E73"/><w:sz w:val="18"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
      `</w:styles>`;
  }
  function numbering(starts) {
    const lvl = (k, fmt, text) => `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + k * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
    const bullets = ["•", "◦", "▪"];
    const abs0 = `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, k) => lvl(k, "bullet", bullets[k % 3])).join("")}</w:abstractNum>`;
    const abs1 = `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, k) => lvl(k, ["decimal", "lowerLetter", "lowerRoman"][k % 3], `%${k + 1}.`)).join("")}</w:abstractNum>`;
    const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      ...starts.map((st, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${st}"/></w:lvlOverride></w:num>`)];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${abs0}${abs1}${nums.join("")}</w:numbering>`;
  }

  /** Markdown → bytes do .docx. opts: {lang, title, images: {href: img}, diagrams: [img|null], math(tex, display), cite(items), references} */
  function fromMarkdown(md, opts = {}) {
    const d = new Doc(opts);
    const tokens = root.marked.lexer(String(md).replace(/^﻿?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, ""));
    root.marked.walkTokens(tokens, (t) => { if (t.type === "footnoteDef") d.notes.set(t.id, t.tokens); });
    // um único # no começo vira o título do documento, e os ## passam a ser o "Título 1" do Word
    const h1 = tokens.filter((t) => t.type === "heading" && t.depth === 1);
    const first = tokens.find((t) => t.type === "heading");
    if (h1.length === 1 && first === h1[0]) { d.titleUsed = h1[0]; d.shift = 1; } else d.shift = 0;
    let body = d.blocks(tokens);
    // as referências dependem das citações: só depois do corpo se sabe quais entram
    const refs = typeof opts.references === "function" ? opts.references() : opts.references;
    if (refs) body += d.blocks(root.marked.lexer(refs));
    const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
    const rels = [
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", target: "styles.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", target: "numbering.xml" },
      ...(d.footnotes.length ? [{ id: "rId3", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", target: "footnotes.xml" }] : []),
      ...d.rels,
    ];
    const sep = (type, id, tag) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${tag}/></w:r></w:p></w:footnote>`;
    const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}>${sep("separator", -1, "separator")}${sep("continuationSeparator", 0, "continuationSeparator")}${d.footnotes.join("")}</w:footnotes>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("") + "</Relationships>";
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(opts.title || "")}</dc:title><dc:creator>Mirante</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      (d.footnotes.length ? `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` : "") +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    return zip([
      { name: "[Content_Types].xml", data: enc.encode(types) },
      { name: "_rels/.rels", data: enc.encode(pkgRels) },
      { name: "docProps/core.xml", data: enc.encode(core) },
      { name: "word/document.xml", data: enc.encode(document) },
      { name: "word/styles.xml", data: enc.encode(styles(d.lang)) },
      { name: "word/numbering.xml", data: enc.encode(numbering(d.nums)) },
      { name: "word/_rels/document.xml.rels", data: enc.encode(docRels) },
      ...(d.footnotes.length ? [{ name: "word/footnotes.xml", data: enc.encode(footnotes) }] : []),
      ...d.media.map((m) => ({ name: "word/media/" + m.name, data: m.data })),
    ]);
  }

  root.MiranteDocx = { fromMarkdown, mathml2omml, zip };
})(this);
