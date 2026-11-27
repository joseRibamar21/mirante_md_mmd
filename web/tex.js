/* Mirante — LaTeX → Markdown, para mostrar um .tex.
 * Não é um compilador: cobre o LaTeX de trabalhos, resumos e artigos (seções numeradas, listas, fórmulas,
 * tabelas, figuras, teoremas, notas de rodapé, citações e referências cruzadas) e devolve Markdown no
 * formato do Mirante, que o viewer.js desenha como um .md. O que não reconhece some sem quebrar o resto:
 * comandos desconhecidos deixam só o conteúdo dos {…}, ambientes desconhecidos só o miolo. */
(function (root) {
  "use strict";

  const T = {
    pt: {
      figure: "Figura", table: "Tabela", section: "Seção", equation: "Equação", chapter: "Capítulo",
      abstract: "Resumo", refs: "Referências", notes: "Notas", proof: "Demonstração", contents: "Sumário",
      include: "conteúdo de", image: "imagem",
      thm: { theorem: "Teorema", lemma: "Lema", corollary: "Corolário", proposition: "Proposição", definition: "Definição",
        example: "Exemplo", remark: "Observação", note: "Nota", exercise: "Exercício", problem: "Problema", claim: "Afirmação" },
    },
    en: {
      figure: "Figure", table: "Table", section: "Section", equation: "Equation", chapter: "Chapter",
      abstract: "Abstract", refs: "References", notes: "Notes", proof: "Proof", contents: "Contents",
      include: "contents of", image: "image",
      thm: { theorem: "Theorem", lemma: "Lemma", corollary: "Corollary", proposition: "Proposition", definition: "Definition",
        example: "Example", remark: "Remark", note: "Note", exercise: "Exercise", problem: "Problem", claim: "Claim" },
    },
  };
  // apelidos comuns (inglês e português) dos ambientes de teorema
  const THM_ALIAS = {
    theorem: "theorem", thm: "theorem", teorema: "theorem", teo: "theorem", lemma: "lemma", lem: "lemma", lema: "lemma",
    corollary: "corollary", cor: "corollary", corolario: "corollary", proposition: "proposition", prop: "proposition",
    proposicao: "proposition", definition: "definition", defn: "definition", definicao: "definition", def: "definition",
    example: "example", exemplo: "example", ex: "example", remark: "remark", rem: "remark", observacao: "remark", obs: "remark",
    note: "note", nota: "note", exercise: "exercise", exercicio: "exercise", problem: "problem", problema: "problem",
    claim: "claim", afirmacao: "claim",
  };
  const THM_CALLOUT = {
    theorem: "IMPORTANT", lemma: "IMPORTANT", corollary: "IMPORTANT", proposition: "IMPORTANT", claim: "IMPORTANT",
    definition: "NOTE", note: "NOTE", remark: "NOTE", example: "EXAMPLE", exercise: "QUESTION", problem: "QUESTION",
  };
  // cores do \newtcolorbox{mirantebox} que a exportação do Mirante usa, de volta para o tipo de caixa
  const BOX_COLOR = { blue: "NOTE", teal: "TIP", violet: "IMPORTANT", orange: "WARNING", red: "CAUTION", gray: "EXAMPLE", cyan: "QUESTION", green: "TIP" };
  const SECTIONING = ["part", "chapter", "section", "subsection", "subsubsection"];
  const ACCENT = { "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", '"': "\u0308", "=": "\u0304", ".": "\u0307",
    c: "\u0327", u: "\u0306", v: "\u030C", H: "\u030B", k: "\u0328", r: "\u030A", d: "\u0323", b: "\u0331" };
  const SYMBOL = {
    LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2ε", ldots: "…", dots: "…", textellipsis: "…", textendash: "–", textemdash: "—",
    textquotedblleft: "“", textquotedblright: "”", textquoteleft: "‘", textquoteright: "’", guillemotleft: "«", guillemotright: "»",
    S: "§", P: "¶", copyright: "©", textcopyright: "©", textregistered: "®", texttrademark: "™", textdegree: "°", degree: "°",
    euro: "€", texteuro: "€", pounds: "£", textsterling: "£", textbullet: "•", textdagger: "†", dag: "†", ddag: "‡",
    i: "ı", j: "ȷ", ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", l: "ł", L: "Ł",
    textbackslash: "\\", textasciitilde: "~", textasciicircum: "^", textbar: "|", textless: "<", textgreater: ">",
    textunderscore: "_", slash: "/", textperiodcentered: "·", checkmark: "✓", textordfeminine: "ª", textordmasculine: "º",
  };
  // comandos que não aparecem: o número diz quantos {…} eles consomem (os [..] são pulados antes)
  const DROP = {
    vspace: 1, hspace: 1, setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, addcontentsline: 3, pagestyle: 1,
    thispagestyle: 1, pagenumbering: 1, bibliographystyle: 1, graphicspath: 1, index: 1, hypersetup: 1, usepackage: 1,
    RequirePackage: 1, documentclass: 1, geometry: 1, captionsetup: 1, definecolor: 3, color: 1, selectlanguage: 1,
    setmainfont: 1, setsansfont: 1, setmonofont: 1, newenvironment: 3, renewenvironment: 3, newcounter: 1, numberwithin: 2,
    addbibresource: 1, bibliography: 1, thanks: 1, enlargethispage: 1, linespread: 1, onehalfspacing: 0, doublespacing: 0,
    newgeometry: 1, lstset: 1, tcbset: 1, theoremstyle: 1, setstretch: 1, nocite: 1, hyphenation: 1, input: 1, include: 1,
    newpage: 0, clearpage: 0, cleardoublepage: 0, pagebreak: 0, nopagebreak: 0, linebreak: 0, noindent: 0, indent: 0,
    centering: 0, raggedright: 0, raggedleft: 0, small: 0, footnotesize: 0, scriptsize: 0, tiny: 0, normalsize: 0, large: 0,
    Large: 0, LARGE: 0, huge: 0, Huge: 0, selectfont: 0, smallskip: 0, medskip: 0, bigskip: 0, vfill: 0, hfill: 0, null: 0,
    frontmatter: 0, mainmatter: 0, backmatter: 0, printbibliography: 0, protect: 0, relax: 0, sloppy: 0, FloatBarrier: 0,
    onecolumn: 0, twocolumn: 0, tableofcontents: 0, listoffigures: 0, listoftables: 0, maketitle: 0, normalfont: 0,
    rmfamily: 0, sffamily: 0, upshape: 0, mdseries: 0, displaystyle: 0, phantomsection: 0, quad: 0, qquad: 0, and: 0,
    endhead: 0, endfirsthead: 0, endfoot: 0, endlastfoot: 0, hline: 0, toprule: 0, midrule: 0, bottomrule: 0, cline: 1,
    cmidrule: 1, label: 1, item: 0, makeatletter: 0, makeatother: 0, sc: 0, scshape: 0, flushbottom: 0, raggedbottom: 0,
  };
  // trocas de fonte que valem até o fim do grupo: {\bf texto}
  const SWITCH = { bf: "**", bfseries: "**", it: "*", itshape: "*", em: "*", sl: "*", slshape: "*", tt: "`", ttfamily: "`" };
  const WRAP = {
    textbf: ["**", "**"], textit: ["*", "*"], emph: ["*", "*"], textsl: ["*", "*"], underline: ["<u>", "</u>"],
    uline: ["<u>", "</u>"], sout: ["~~", "~~"], st: ["~~", "~~"], xout: ["~~", "~~"], textsuperscript: ["<sup>", "</sup>"],
    textsubscript: ["<sub>", "</sub>"], hl: ["<mark>", "</mark>"], highlight: ["<mark>", "</mark>"],
    textrm: ["", ""], textsf: ["", ""], textsc: ["", ""], textup: ["", ""], textnormal: ["", ""], textmd: ["", ""],
    mbox: ["", ""], hbox: ["", ""], fbox: ["", ""], text: ["", ""], centerline: ["", ""], MakeUppercase: ["", ""],
    MakeLowercase: ["", ""], uppercase: ["", ""], lowercase: ["", ""], enquote: ["“", "”"], foreignlanguage: null,
  };
  const DISPLAY_ENVS = /^(equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math|dmath)\*?$/;
  const LIST_ENVS = /^(itemize|enumerate|description|compactitem|compactenum|inparaenum|asparaenum|asparaitem|checklist)$/;
  const TABLE_ENVS = /^(tabular\*?|tabularx|tabulary|longtable|xltabular|supertabular|tblr|longtblr)$/;
  const IMG_SHOWN = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

  const PH = (n) => `\uE000${n}\uE001`;
  const PH_RE = /\uE000(\d+)\uE001/g, PH_ANY = /\uE000\d+\uE001/;

  /* ---------------- leitura de argumentos ---------------- */
  function Reader(src) { this.s = src; this.i = 0; }
  const R = Reader.prototype;
  R.ws = function (newline = true) {
    const re = newline ? /[ \t\r]|\n(?![ \t]*\n)/y : /[ \t\r]/y;
    for (;;) { re.lastIndex = this.i; if (!re.exec(this.s)) break; this.i = re.lastIndex; }
  };
  R.group = function () {             // {…} equilibrado; sem chave, um único token
    this.ws();
    const s = this.s;
    if (s[this.i] !== "{") {
      if (this.i >= s.length) return "";
      if (s[this.i] === "\\") { const m = /^\\([a-zA-Z@]+|.)/.exec(s.slice(this.i)); this.i += m ? m[0].length : 1; return m ? m[0] : ""; }
      return s[this.i++];
    }
    let depth = 0, j = this.i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") { j++; continue; }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    const out = s.slice(this.i + 1, j);
    this.i = Math.min(j + 1, s.length);
    return out;
  };
  R.opt = function () {               // [..] opcional (com chaves dentro)
    const save = this.i;
    this.ws();
    if (this.s[this.i] !== "[") { this.i = save; return null; }
    let depth = 0, j = this.i + 1;
    for (; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === "\\") { j++; continue; }
      if (c === "{") depth++; else if (c === "}") depth--;
      else if (c === "]" && depth === 0) break;
    }
    const out = this.s.slice(this.i + 1, j);
    this.i = j + 1;
    return out;
  };
  R.star = function () { if (this.s[this.i] === "*") { this.i++; return true; } return false; };
  R.rest = function () { const r = this.s.slice(this.i); this.i = this.s.length; return r; };

  /* corta s em pedaços por um separador de nível zero (fora de {…}, $…$ e ambientes) */
  function splitTop(s, sep) {
    const out = [];
    let depth = 0, env = 0, start = 0;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (c === "\\") {
        if (s.startsWith("\\begin{", j)) env++;
        else if (s.startsWith("\\end{", j)) env--;
        if (depth === 0 && env === 0 && sep instanceof RegExp) {
          sep.lastIndex = j;
          const m = sep.exec(s);
          if (m && m.index === j) { out.push(s.slice(start, j)); start = j = j + m[0].length; j--; continue; }
        }
        j++; continue;
      }
      if (c === "{") depth++; else if (c === "}") depth--;
      else if (depth === 0 && env === 0 && typeof sep === "string" && c === sep) { out.push(s.slice(start, j)); start = j + 1; }
    }
    out.push(s.slice(start));
    return out;
  }
  // corpo de \begin{name} … \end{name} a partir de i (logo depois do \begin{name}), com aninhamento
  function envBody(s, i, name) {
    const open = "\\begin{" + name + "}", close = "\\end{" + name + "}";
    let depth = 1, j = i;
    while (j < s.length) {
      const a = s.indexOf(open, j), b = s.indexOf(close, j);
      if (b < 0) return { body: s.slice(i), end: s.length };
      if (a >= 0 && a < b) { depth++; j = a + open.length; continue; }
      if (--depth === 0) return { body: s.slice(i, b), end: b + close.length };
      j = b + close.length;
    }
    return { body: s.slice(i), end: s.length };
  }

  const escMd = (s) => s.replace(/[\\`*_[\]<>$|#~]/g, "\\$&");
  const oneLine = (s) => s.replace(/\s*\n\s*/g, " ").trim();
  const quoteLines = (s) => s.split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
  const indent = (s, n) => s.split("\n").map((l, k) => (k && l ? " ".repeat(n) + l : l)).join("\n");
  const block = (s) => `\n\n${s}\n\n`;

  /* ---------------- conversor ---------------- */
  function Conv(opts) {
    this.lang = opts.lang === "en" ? "en" : "pt";
    this.L = T[this.lang];
    this.ph = [];                         // trechos prontos (código, URLs) guardados fora do caminho do conversor
    this.macros = {};                     // \newcommand: name → {n, opt, body}
    this.mathMacros = {};                 // \newcommand e \DeclareMathOperator para dentro das fórmulas
    this.thm = {};                        // \newtheorem{env}{Título}
    this.labels = {};                     // \label → número
    this.cites = {};                      // \bibitem → número
    this.notes = [];
    this.count = { part: 0, chapter: 0, section: 0, subsection: 0, subsubsection: 0, figure: 0, table: 0, equation: 0, thm: {} };
    this.last = null;                     // o último número que um \label pegaria
    this.float = null;                    // figure | table, enquanto dentro de um
    this.appendix = false;
    this.meta = {};
    this.depth = 0;
  }
  const C = Conv.prototype;
  C.keep = function (md) { this.ph.push(md); return PH(this.ph.length - 1); };
  C.restore = function (s) {
    for (let k = 0; k < 5 && PH_ANY.test(s); k++) s = s.replace(PH_RE, (_, n) => this.ph[+n]);
    return s;
  };

  /* verbatim, comentários e URLs saem antes: dentro deles % e \ não são LaTeX */
  C.protect = function (src) {
    src = src.replace(/\\begin\{comment\}[\s\S]*?\\end\{comment\}/g, "");
    src = src.replace(/\\begin\{(verbatim\*?|Verbatim\*?|BVerbatim|lstlisting|minted|alltt|code|spverbatim)\}(\[[^\]\n]*\])?(\{[^}\n]*\})?\n?([\s\S]*?)\\end\{\1\}/g,
      (_, env, opt, arg, code) => {
        let lang = "";
        if (env === "minted" && arg) lang = arg.slice(1, -1);
        else if (opt) { const m = /language\s*=\s*\{?([\w+#-]+)/i.exec(opt); if (m) lang = m[1]; }
        lang = lang.toLowerCase().replace(/^(\[.*\])?/, "");
        const body = code.replace(/\s+$/, "");
        const fence = body.includes("```") ? "~~~~" : "```";
        return block(this.keep(`${fence}${lang}\n${body}\n${fence}`));
      });
    // \verb|x| e \lstinline|x| (qualquer delimitador) ou \lstinline{x}
    src = src.replace(/\\(?:verb\*?|lstinline(?:\[[^\]]*\])?|mintinline\{[^}]*\})(?:([^\sa-zA-Z{])([^\n]*?)\1|\{([^}\n]*)\})/g,
      (_, d, a, b) => this.keep(this.code(a != null ? a : b)));
    src = src.replace(/\\(url|nolinkurl)\{([^}]*)\}/g, (_, cmd, u) => this.keep(cmd === "url" ? `<${u.trim()}>` : this.code(u)));
    src = src.replace(/\\href\{([^}]*)\}/g, (_, u) => `\\href{${this.keep(u.trim().replace(/[()<> ]/g, encodeURIComponent))}}`);
    // comentários: % até o fim da linha (não \%); linha só de comentário some inteira
    src = src.replace(/^[ \t]*%.*\n/gm, "").replace(/((?:^|[^\\])(?:\\\\)*)%.*$/gm, "$1");
    return src;
  };
  C.code = function (s) {
    const ticks = s.includes("`") ? "`` " : "`";
    return ticks + s + (ticks.length > 1 ? " ``" : "`");
  };

  /* ---------------- preâmbulo: definições que valem para o resto ---------------- */
  C.definitions = function (src) {
    const rd = new Reader(src);
    const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|newtheorem|title|author|date)\b(\*?)/g;
    let m;
    while ((m = re.exec(src))) {
      rd.i = re.lastIndex;
      const cmd = m[1], star = !!m[2];
      if (cmd === "def") {
        const mm = /^\s*\\([a-zA-Z@]+)((?:#\d)*)\s*/.exec(src.slice(rd.i));
        if (!mm) continue;
        rd.i += mm[0].length;
        this.define(mm[1], mm[2].length / 2, null, rd.group());
      } else if (cmd === "DeclareMathOperator") {
        const name = rd.group().replace(/^\\/, ""), body = rd.group();
        this.mathMacros[name] = `\\def\\${name}{\\operatorname${star ? "*" : ""}{${body}}}`;
      } else if (cmd === "newtheorem") {
        const env = rd.group(); rd.opt(); const title = rd.group(); rd.opt();
        this.thm[env] = { title: this.inline(title), numbered: !star };
      } else if (cmd === "title" || cmd === "author" || cmd === "date") {
        rd.opt();
        this.meta[cmd] = rd.group();
      } else {
        const name = rd.group().replace(/^\\/, "");
        const n = +(rd.opt() || 0), opt = rd.opt();
        this.define(name, n, opt, rd.group());
      }
      re.lastIndex = rd.i;
    }
  };
  C.define = function (name, n, opt, body) {
    if (!/^[a-zA-Z@]+$/.test(name)) return;
    this.macros[name] = { n, opt, body };
    // \def e não \newcommand: o KaTeX já tem alguns (\R, \N…) e recusaria redefinir
    this.mathMacros[name] = opt != null
      ? `\\newcommand{\\${name}}[${n}][${opt}]{${body}}`
      : `\\def\\${name}${Array.from({ length: n }, (_, k) => "#" + (k + 1)).join("")}{${body}}`;
  };

  /* ---------------- fórmulas ---------------- */
  // as definições do usuário entram na frente de cada fórmula que as usa (o KaTeX aceita \newcommand)
  C.mathPrefix = function (tex) {
    const used = [], seen = new Set();
    const scan = (t) => {
      for (const [name, def] of Object.entries(this.mathMacros)) {
        if (seen.has(name) || !new RegExp("\\\\" + name + "(?![a-zA-Z])").test(t)) continue;
        seen.add(name); scan(def); used.push(def);
      }
    };
    scan(tex);
    return used.join("");
  };
  C.cleanMath = function (tex) {
    // \label marca o número da fórmula; \nonumber e afins não existem no KaTeX
    tex = tex.replace(/\\label\s*\{([^}]*)\}/g, (_, k) => { if (this.last) this.labels[k] = this.last; return ""; });
    return tex.replace(/\\(nonumber|notag|allowdisplaybreaks|intertext\{[^}]*\})/g, "").trim();
  };
  C.inlineMath = function (tex) {
    tex = this.cleanMath(tex).replace(/\s*\n\s*/g, " ");
    if (!tex) return "";
    return this.keep("$" + this.mathPrefix(tex) + tex + "$");
  };
  C.displayMath = function (tex, env) {
    let numbered = env && !env.endsWith("*") && !/^(displaymath|math)$/.test(env);
    const base = env ? env.replace(/\*$/, "") : "";
    let body;
    if (!env || base === "displaymath" || base === "math" || base === "dmath") {
      body = this.cleanMath(tex);
    } else if (base === "equation") {
      this.last = numbered ? String(++this.count.equation) : null;
      body = this.cleanMath(tex);
      if (numbered && !/\\tag\b/.test(body)) body += ` \\tag{${this.last}}`;
    } else {
      // várias linhas: cada uma ganha o seu número (o KaTeX não numera sozinho entre fórmulas separadas)
      const inner = base === "eqnarray" || base === "flalign" ? "align" : base === "multline" ? "gather" : base;
      const alignat = base === "alignat" ? `{${new Reader(tex).group()}}` : "";
      if (alignat) tex = tex.replace(/^\s*\{[^}]*\}/, "");
      const rows = splitTop(tex, /\\\\(\[[^\]]*\])?/y).map((row) => {
        if (base === "eqnarray") row = row.replace(/&([^&]*)&/, "&$1");
        const skip = /\\(nonumber|notag)\b/.test(row) || !numbered || !row.trim();
        this.last = skip ? null : String(++this.count.equation);
        let r = this.cleanMath(row);
        if (!skip && !/\\tag\b/.test(r)) r += ` \\tag{${this.last}}`;
        return r;
      }).filter((r, k, a) => r || k < a.length - 1);
      body = `\\begin{${inner}*}${alignat}\n${rows.join(" \\\\\n")}\n\\end{${inner}*}`;
      numbered = false;
    }
    return block(this.keep(`$$\n${this.mathPrefix(body)}${body}\n$$`));
  };

  /* ---------------- texto ---------------- */
  C.text = function (s, raw) {
    s = s.replace(/\n[ \t]*\n\s*/g, "\u0000").replace(/\s+/g, " ").replace(/\u0000/g, "\n\n");
    if (raw) return s;
    s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/``/g, "“").replace(/''/g, "”").replace(/`/g, "‘")
      .replace(/!´/g, "¡").replace(/\?´/g, "¿");
    return escMd(s);
  };

  /** Converte um trecho de LaTeX (já protegido) em Markdown. */
  C.conv = function (src, o = {}) {
    if (++this.depth > 60) { this.depth--; return escMd(src); }   // macro recursiva: para aqui
    const rd = new Reader(src), s = src;
    let out = "";
    while (rd.i < s.length) {
      const c = s[rd.i];
      if (c === "\\") { out += this.command(rd, o); continue; }
      if (c === "{") { out += this.conv(rd.group(), o); continue; }
      if (c === "}") { rd.i++; continue; }
      if (c === "$") {
        const dbl = s[rd.i + 1] === "$";
        const close = dbl ? s.indexOf("$$", rd.i + 2) : findDollar(s, rd.i + 1);
        if (close < 0) { out += "\\$"; rd.i++; continue; }
        const tex = s.slice(rd.i + (dbl ? 2 : 1), close);
        rd.i = close + (dbl ? 2 : 1);
        out += dbl ? this.displayMath(tex) : this.inlineMath(tex);
        continue;
      }
      if (c === "~") { out += "\u00a0"; rd.i++; continue; }
      if (c === "&") { out += " "; rd.i++; continue; }
      const m = /[^\\{}$~&]+/y; m.lastIndex = rd.i;
      const run = m.exec(s)[0];
      rd.i += run.length;
      out += this.text(run, o.raw);
    }
    this.depth--;
    return out;
  };
  function findDollar(s, from) {
    for (let j = from; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === "$") return j;
    }
    return -1;
  }
  C.inline = function (src) { return oneLine(this.restore(this.conv(src))); };

  C.command = function (rd, o) {
    const s = rd.s;
    const m = /\\([a-zA-Z@]+|.)/y; m.lastIndex = rd.i;
    const mm = m.exec(s);
    if (!mm) { rd.i++; return ""; }
    rd.i = m.lastIndex;
    const name = mm[1];
    if (!/^[a-zA-Z@]+$/.test(name)) return this.symbol(name, rd, o);
    const star = rd.star();
    rd.ws();                                       // como no TeX, o espaço depois de \comando some
    const L = this.L;

    if (name === "begin") return this.environment(rd, o);
    if (name === "end") { rd.group(); return ""; }
    if (SECTIONING.includes(name) || name === "paragraph" || name === "subparagraph") return this.heading(name, star, rd);
    if (name in SWITCH) {                          // vale até o fim do grupo atual
      const mark = SWITCH[name], inner = this.inline(rd.rest());
      return inner ? (mark === "`" ? this.code(inner) : mark + inner + mark) : "";
    }
    if (name in WRAP) {
      if (name === "foreignlanguage") { rd.opt(); rd.group(); return this.conv(rd.group(), o); }
      const [a, b] = WRAP[name];
      if (name === "fbox" || name === "mbox") rd.opt();
      const inner = this.inline(rd.group());
      return inner ? a + inner + b : "";
    }
    if (name in SYMBOL) return SYMBOL[name] === "\\" ? "\\\\" : escMd(SYMBOL[name]);
    if (name in ACCENT && name.length === 1) return this.accent(name, rd);

    switch (name) {
      case "texttt": case "textttt": { const t = this.restore(this.conv(rd.group(), { raw: true })).trim(); return t ? this.code(t) : ""; }
      case "textcolor": rd.opt(); rd.group(); return this.conv(rd.group(), o);
      case "colorbox": rd.opt(); rd.group(); return `<mark>${this.inline(rd.group())}</mark>`;
      case "href": { const url = rd.group(); const t = this.inline(rd.group()); return `[${t}](${url})`; }
      case "footnote": case "footnotetext": {
        rd.opt();
        this.notes.push(this.inline(rd.group()));
        return `<sup>${this.notes.length}</sup>`;
      }
      case "footnotemark": rd.opt(); return "";
      case "ce": case "pu": return this.inlineMath(`\\${name}{${rd.group()}}`);
      case "SI": case "qty": { rd.opt(); const n = rd.group(), u = rd.group(); return this.inlineMath(`${n}\\,${units(u)}`); }
      case "si": case "unit": rd.opt(); return this.inlineMath(units(rd.group()));
      case "num": rd.opt(); return escMd(rd.group());
      case "today": return new Date().toLocaleDateString(this.lang === "en" ? "en-US" : "pt-BR", { day: "numeric", month: "long", year: "numeric" });
      case "newline": case "break": return "<br>";
      case "quad": case "qquad": case "enspace": case "hfill": return " ";
      case "par": return "\n\n";
      case "appendix": this.appendix = true; this.count.chapter = this.count.section = 0; return "";
      case "maketitle": return this.titleBlock();
      case "title": case "author": case "date": rd.opt(); this.meta[name] = rd.group(); return "";
      case "newcommand": case "renewcommand": case "providecommand": case "DeclareMathOperator": case "def": case "newtheorem":
        return this.skipDefinition(name, rd);
      case "label": { const k = rd.group().trim(); if (this.last) this.labels[k] = this.last; return ""; }
      case "ref": case "eqref": case "autoref": case "cref": case "Cref": case "pageref": case "vref": case "nameref": {
        const keys = rd.group().split(",").map((k) => k.trim());
        return keys.map((k) => this.keep(`\uE002${name}\uE003${k}\uE004`)).join(", ");
      }
      case "cite": case "citep": case "citet": case "parencite": case "textcite": case "autocite": case "citeauthor":
      case "citeyear": case "footcite": case "Cite": case "Textcite": case "Parencite": case "smartcite": case "supercite": {
        const pre = rd.opt(), post = rd.opt();
        const note = post != null ? post : pre;
        const keys = rd.group().split(",").map((k) => k.trim());
        return this.keep(`\uE005${keys.join(",")}\uE006${note ? this.inline(note) : ""}\uE007`);
      }
      case "caption": {
        rd.opt();
        const text = this.inline(rd.group());
        if (!this.float) return block(`*${text}*`);
        const n = ++this.count[this.float];
        this.last = String(n);
        return block(`*${this.L[this.float]} ${n}: ${text}*`);
      }
      case "includegraphics": case "includesvg": case "includepdf": {
        rd.opt();
        let path = rd.group().trim().replace(/^"|"$/g, "");
        if (name === "includesvg" && !/\.svg$/i.test(path)) path += ".svg";
        return this.image(path);
      }
      case "rule": { rd.opt(); const w = rd.group(); rd.group(); return /linewidth|textwidth|columnwidth/.test(w) ? block("---") : ""; }
      case "hrule": case "hrulefill": return block("---");
      case "item": { const lbl = rd.opt(); return lbl != null ? `**${this.inline(lbl)}** ` : "• "; }
      case "bibitem": { rd.opt(); rd.group(); return ""; }
      case "multicolumn": { rd.group(); rd.group(); return this.conv(rd.group(), o); }
      case "multirow": { rd.opt(); rd.group(); rd.opt(); rd.group(); return this.conv(rd.group(), o); }
      case "makecell": case "shortstack": rd.opt(); return this.inline(rd.group()).replace(/\\\\/g, "<br>");
      case "input": case "include": case "subfile": case "import": {
        const f = rd.group();
        return block(`*[${this.L.include} ${escMd(f.trim())}]*`);
      }
      case "verb": return "";
    }
    if (name in DROP) {
      for (let k = 0; k < DROP[name]; k++) { rd.opt(); rd.group(); }
      return "";
    }
    const macro = this.macros[name];
    if (macro) {
      const args = [];
      for (let k = 0; k < macro.n; k++) {
        if (k === 0 && macro.opt != null) { const v = rd.opt(); args.push(v != null ? v : macro.opt); }
        else args.push(rd.group());
      }
      return this.conv(macro.body.replace(/#(\d)/g, (_, d) => args[+d - 1] || ""), o);
    }
    return "";                                     // desconhecido: os {…} seguintes saem como texto
  };

  C.symbol = function (c, rd, o) {
    switch (c) {
      case "\\": rd.star(); rd.opt(); return "<br>";
      case "(": { const e = rd.s.indexOf("\\)", rd.i); const t = rd.s.slice(rd.i, e < 0 ? undefined : e); rd.i = e < 0 ? rd.s.length : e + 2; return this.inlineMath(t); }
      case "[": { const e = rd.s.indexOf("\\]", rd.i); const t = rd.s.slice(rd.i, e < 0 ? undefined : e); rd.i = e < 0 ? rd.s.length : e + 2; return this.displayMath(t); }
      case ")": case "]": return "";
      case " ": case "\n": case "\t": return " ";
      case ",": case ";": case ":": case "!": case ">": return c === "!" ? "" : "\u2009";
      case "@": case "/": case "-": return "";
      case "%": case "$": case "&": case "#": case "_": case "{": case "}": return o.raw ? c : escMd(c);
    }
    if (c in ACCENT) return this.accent(c, rd);
    return escMd(c);
  };
  C.accent = function (a, rd) {
    let base = rd.group();
    if (base === "\\i") base = "i"; else if (base === "\\j") base = "j";
    base = base.replace(/^\\/, "");
    if (!base) return "";
    return escMd((base[0] + ACCENT[a]).normalize("NFC") + base.slice(1));
  };
  function units(u) {
    const U = { meter: "m", metre: "m", second: "s", kilogram: "kg", gram: "g", ampere: "A", kelvin: "K", mole: "mol",
      candela: "cd", newton: "N", joule: "J", watt: "W", pascal: "Pa", hertz: "Hz", volt: "V", ohm: "\\Omega", coulomb: "C",
      liter: "L", litre: "L", celsius: "^\\circ C", degreeCelsius: "^\\circ C", percent: "\\%", hour: "h", minute: "min",
      kilo: "k", mega: "M", giga: "G", milli: "m", micro: "\\mu ", nano: "n", centi: "c", square: "", cubic: "" };
    return "\\mathrm{" + u.replace(/\\per\s*/g, "/").replace(/\\squared/g, "^2").replace(/\\cubed/g, "^3")
      .replace(/\\([a-zA-Z]+)/g, (_, w) => (w in U ? U[w] : w)).replace(/\s+/g, "") + "}";
  }

  C.skipDefinition = function (name, rd) {
    if (name === "def") { rd.ws(); if (rd.s[rd.i] === "\\") rd.group(); while (/[#\d]/.test(rd.s[rd.i] || "")) rd.i++; rd.group(); return ""; }
    if (name === "newtheorem") { rd.group(); rd.opt(); rd.group(); rd.opt(); return ""; }
    rd.group(); rd.opt(); rd.opt(); rd.group();
    return "";
  };

  C.image = function (path) {
    const name = path.split("/").pop();
    if (/\.(pdf|eps|ps)$/i.test(path)) return block(`*[${this.L.image}: ${escMd(name)}]*`);
    // sem extensão o LaTeX procura .png, .jpg…; o viewer tenta as extensões quando a imagem falha
    const title = IMG_SHOWN.test(path) ? "" : ' "tex-noext"';
    return block(`![${escMd(name)}](<${path}>${title})`);
  };

  C.titleBlock = function () {
    const { title, author, date } = this.meta;
    if (!title) return "";
    let out = `# ${this.inline(title)}`;
    const who = author ? this.inline(author.replace(/\s*\\and\b\s*/g, ", ").replace(/\\\\/g, ", ")).replace(/\s*,\s*(,\s*)+/g, ", ") : "";
    const when = date != null ? this.inline(date) : "";
    const line = [who && `**${who}**`, when].filter(Boolean).join(" · ");
    return block(out + (line ? "\n\n" + line : ""));
  };

  /* ---------------- títulos ---------------- */
  C.heading = function (name, star, rd) {
    rd.opt();
    const rawTitle = rd.group();
    if (name === "paragraph" || name === "subparagraph") return `\n\n**${this.inline(rawTitle)}** `;
    const idx = SECTIONING.indexOf(name);
    let num = "";
    if (!star && name !== "part") {
      this.count[name]++;
      for (const lower of SECTIONING.slice(idx + 1)) this.count[lower] = 0;
      if (name === "chapter") this.count.figure = this.count.table = 0;
      const from = this.hasChapter ? 1 : 2;
      const parts = SECTIONING.slice(from, idx + 1).map((k, j) => {
        const v = this.count[k];
        return j === 0 && this.appendix ? String.fromCharCode(64 + v) : String(v);
      });
      num = parts.join(".");
      this.last = num;
    } else if (name === "part") {
      num = String(++this.count.part);
    }
    const title = this.inline(rawTitle);            // depois do número: um \label no título pega este
    const level = Math.min(6, Math.max(1, this.top + idx - this.first));
    return block(`${"#".repeat(level)} ${num ? num + " " : ""}${title}`);
  };

  /* ---------------- ambientes ---------------- */
  C.environment = function (rd, o) {
    const name = rd.group().trim();
    const { body, end } = envBody(rd.s, rd.i, name);
    rd.i = end;
    const base = name.replace(/\*$/, "");
    const b = new Reader(body);

    if (name === "document") return this.conv(body, o);
    if (DISPLAY_ENVS.test(name)) return this.displayMath(body, name);
    if (LIST_ENVS.test(name)) return this.list(base, body);
    if (TABLE_ENVS.test(name)) return this.tabular(base, b);
    if (base === "figure" || base === "wrapfigure" || base === "SCfigure" || base === "table" || base === "wraptable" || base === "sidewaystable" || base === "sidewaysfigure") {
      b.opt(); if (base.startsWith("wrap")) { b.opt(); b.group(); b.opt(); b.group(); }
      const was = this.float;
      this.float = /table/.test(base) ? "table" : "figure";
      const out = this.conv(b.rest(), o);
      this.float = was;
      return block(out.trim());
    }
    if (base === "subfigure" || base === "minipage" || base === "subtable") { b.opt(); b.opt(); b.opt(); b.group(); return this.conv(b.rest(), o); }
    if (base === "abstract") return this.callout("SUMMARY", this.L.abstract, b.rest());
    if (base === "quote" || base === "quotation" || base === "verse" || base === "displayquote") {
      return block(quoteLines(this.restore(this.conv(b.rest())).trim()));
    }
    if (base === "mirantebox") { const color = b.group(), title = this.inline(b.group()); return this.callout(BOX_COLOR[color] || "NOTE", title, b.rest()); }
    if (/^(tcolorbox|mdframed|framed|shaded|leftbar|tcb\w*)$/.test(base)) {
      const opt = b.opt() || "";
      const t = /title\s*=\s*\{([^}]*)\}|title\s*=\s*([^,\]]+)/.exec(opt);
      return this.callout("NOTE", t ? this.inline(t[1] || t[2]) : "", b.rest());
    }
    if (base === "proof" || base === "prova" || base === "demonstracao") {
      const t = b.opt();
      const inner = this.restore(this.conv(b.rest())).trim();
      return block(`*${t ? this.inline(t) : this.L.proof}.* ${inner} ∎`);
    }
    if (this.thm[base] || THM_ALIAS[base.toLowerCase()]) return this.theorem(base, name.endsWith("*"), b);
    if (base === "thebibliography") { b.group(); return this.bibliography(b.rest()); }
    if (base === "center" || base === "flushleft" || base === "flushright" || base === "small" || base === "footnotesize") return this.conv(body, o);
    if (base === "titlepage") return this.conv(body, o);
    // desconhecido: argumentos obrigatórios não dá para adivinhar; fica o miolo
    return this.conv(body, o);
  };

  C.callout = function (type, title, src) {
    const inner = this.restore(this.conv(src)).trim();
    return block(quoteLines(`[!${type}]${title ? " " + title : ""}\n${inner}`));
  };

  C.theorem = function (base, star, b) {
    const def = this.thm[base];
    const kind = THM_ALIAS[base.toLowerCase()] || guessThm(def ? def.title : base);
    const title = def ? def.title : this.L.thm[kind] || base;
    let num = "";
    if (!star && (!def || def.numbered)) {
      this.count.thm[title] = (this.count.thm[title] || 0) + 1;
      num = " " + this.count.thm[title];
      this.last = String(this.count.thm[title]);
    }
    const name = b.opt();
    return this.callout(THM_CALLOUT[kind] || "NOTE", `${title}${num}${name ? ` (${this.inline(name)})` : ""}`, b.rest());
  };
  function guessThm(title) {
    const t = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/teorema|theorem|lema|lemma|corol|propos|afirm|claim/.test(t)) return "theorem";
    if (/defini/.test(t)) return "definition";
    if (/exemplo|example/.test(t)) return "example";
    if (/exerc|quest|problem/.test(t)) return "exercise";
    return "note";
  }

  C.list = function (env, body) {
    const b = new Reader(body);
    b.opt();
    let start = 1;
    const sc = /^\s*\\setcounter\{enumi\}\{(\d+)\}/.exec(body.slice(b.i));
    if (sc) { start = +sc[1] + 1; b.i += sc[0].length; }
    const items = splitTop(b.rest(), /\\item\b/y).slice(1);
    const ordered = /enum/.test(env);
    const out = items.map((raw, k) => {
      const r = new Reader(raw);
      const lbl = r.opt();
      let mark = ordered ? `${start + k}.` : "-";
      let lead = "";
      if (lbl != null) {
        if (/boxtimes|checkmark|blacksquare|\\xmark|CheckedBox|\[x\]/.test(lbl)) mark = "- [x]";
        else if (/square|Box\b|\\ $/.test(lbl)) mark = "- [ ]";
        else lead = `**${this.inline(lbl)}** `;
      }
      const text = this.restore(this.conv(r.rest())).trim().replace(/\n{3,}/g, "\n\n");
      const pad = ordered ? mark.length + 1 : 2;
      return `${mark} ${indent(lead + text, pad)}`;
    });
    return block(out.join("\n"));
  };

  C.tabular = function (env, b) {
    if (env === "tabular*" || env === "tabularx" || env === "tabulary" || env === "xltabular") b.group();
    b.opt();
    const spec = env === "tblr" || env === "longtblr" ? tblrSpec(b.group()) : colSpec(b.group());
    let body = b.rest()
      .replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot|tabularnewline)\b/g, (m) => (m === "\\tabularnewline" ? "\\\\" : ""))
      .replace(/\\(cline|cmidrule)(\([^)]*\))?\{[^}]*\}/g, "")
      .replace(/\\(rowcolor|cellcolor)(\[[^\]]*\])?\{[^}]*\}/g, "");
    const extras = [];
    body = body.replace(/\\caption\*?(\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}(\s*\\\\)?/g, (_, o2, t) => { extras.push(`\\caption{${t}}`); return ""; });
    const rows = splitTop(body, /\\\\(\[[^\]]*\])?/y).map((r) => r.trim()).filter((r) => r && !/^\\(noalign|addlinespace)/.test(r));
    if (!rows.length) return "";
    const cells = rows.map((r) => {
      const cs = [];
      for (const cell of splitTop(r, "&")) {
        const mc = /^\s*\\multicolumn\{(\d+)\}/.exec(cell);
        // | solto (até dentro de fórmula) quebraria a coluna da tabela do Markdown
        cs.push(this.inline(cell).replace(/(^|[^\\])\|/g, "$1\\|").replace(/(^|[^\\])\|/g, "$1\\|").replace(/<br>/g, " ") || " ");
        if (mc) for (let k = 1; k < +mc[1]; k++) cs.push(" ");
      }
      return cs;
    });
    const cols = Math.max(spec.length, ...cells.map((r) => r.length));
    const al = (k) => ({ l: ":--", c: ":-:", r: "--:" }[spec[k] || "l"]);
    const line = (r) => "| " + Array.from({ length: cols }, (_, k) => r[k] || " ").join(" | ") + " |";
    const md = [line(cells[0]), "| " + Array.from({ length: cols }, (_, k) => al(k)).join(" | ") + " |", ...cells.slice(1).map(line)].join("\n");
    // legenda dentro da longtable
    const was = this.float;
    this.float = "table";
    const cap = extras.length ? this.conv(extras.join("")) : "";
    this.float = was;
    return block(md) + cap;
  };
  function colSpec(s) {
    const out = [];
    const r = new Reader(s.replace(/\s+/g, ""));
    while (r.i < r.s.length) {
      const c = r.s[r.i++];
      if (c === "l" || c === "c" || c === "r") out.push(c);
      else if (c === "L" || c === "C" || c === "R") out.push(c.toLowerCase());
      else if (c === "p" || c === "m" || c === "b") { r.group(); out.push("l"); }
      else if (c === "X" || c === "J") out.push("l");
      else if (c === "S") { if (r.s[r.i] === "[") r.opt(); out.push("r"); }
      else if (c === ">" || c === "<" || c === "@" || c === "!") r.group();
      else if (c === "*") { const n = +r.group(); const inner = colSpec(r.group()); for (let k = 0; k < n; k++) out.push(...inner); }
      else if (c === "{" ) { r.i--; r.group(); }
    }
    return out;
  }
  function tblrSpec(s) {
    const m = /colspec\s*=\s*\{(.*)\}/.exec(s);
    return colSpec(m ? m[1].replace(/Q\[[^\]]*\]/g, "l").replace(/\[[^\]]*\]/g, "") : s);
  }

  C.bibliography = function (src) {
    const items = splitTop(src, /\\bibitem\b/y).slice(1);
    const lines = items.map((raw, k) => {
      const r = new Reader(raw);
      const lbl = r.opt(), key = r.group().trim();
      const n = lbl != null ? this.inline(lbl) : String(k + 1);
      this.cites[key] = n;
      return `${k + 1}. ${this.restore(this.conv(r.rest())).trim().replace(/\n+/g, " ")}`;
    });
    return block(`## ${this.L.refs}\n\n${lines.join("\n")}`);
  };

  /* referências cruzadas e citações: resolvidas no fim, quando todos os \label e \bibitem já passaram */
  C.resolve = function (s) {
    const L = this.L;
    s = s.replace(/\uE002(\w+)\uE003([^\uE004]*)\uE004/g, (_, cmd, key) => {
      const v = this.labels[key];
      const n = v ? escMd(v) : "??";
      if (cmd === "eqref") return `(${n})`;
      if (cmd === "autoref" || cmd === "cref" || cmd === "Cref") {
        const kind = /^(fig|figura)/i.test(key) ? L.figure : /^(tab|tabela)/i.test(key) ? L.table : /^(eq|equa)/i.test(key) ? L.equation : /^(chap|cap)/i.test(key) ? L.chapter : L.section;
        return `${kind} ${/equa|eq/i.test(kind) ? `(${n})` : n}`;
      }
      return n;
    });
    return s.replace(/\uE005([^\uE006]*)\uE006([^\uE007]*)\uE007/g, (_, keys, note) => {
      const list = keys.split(",").map((k) => (this.cites[k] ? this.cites[k] : escMd(k))).join(", ");
      return `[${list}${note ? ", " + note : ""}]`;
    });
  };

  /** O .tex inteiro em Markdown. */
  function toMarkdown(src, opts = {}) {
    const c = new Conv(opts);
    let text = c.protect(String(src).replace(/\r\n?/g, "\n"));
    const begin = text.indexOf("\\begin{document}");
    let body = text;
    if (begin >= 0) {
      c.definitions(text.slice(0, begin));
      body = envBody(text, begin + "\\begin{document}".length, "document").body;
    }
    c.definitions(body.replace(/\\begin\{(verbatim|lstlisting)\}[\s\S]*?\\end\{\1\}/g, ""));
    // nível dos títulos: o maior que aparece vira ## (com \maketitle, o título do documento é o #)
    c.hasChapter = /\\chapter\*?\s*[{[]/.test(body);
    const used = SECTIONING.filter((k) => new RegExp(`\\\\${k}\\*?\\s*[{[]`).test(body));
    c.first = used.length ? SECTIONING.indexOf(used[0]) : 2;
    c.top = /\\maketitle\b/.test(body) && c.meta.title ? 2 : 1;
    let md = c.conv(body);
    if (c.notes.length) md += block(`---\n\n**${c.L.notes}**\n\n` + c.notes.map((n, k) => `${k + 1}. ${n}`).join("\n"));
    md = c.resolve(c.restore(md));
    // um espaço solto no começo da linha (texto logo depois de um \label) sai; recuo de lista tem 2 ou mais
    return md.replace(/[ \t]+$/gm, "").replace(/^ (?=\S)/gm, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  root.MiranteTex = { toMarkdown };
})(this);
