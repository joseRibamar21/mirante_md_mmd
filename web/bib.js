/* Mirante — BibTeX (.bib).
 * Lê o arquivo (com @string, concatenação com # e chaves aninhadas) e formata as referências no padrão da
 * ABNT (NBR 6023) e as citações autor-data (SOUZA, 2020) ou numéricas [1]. Serve para mostrar um .bib, para as
 * citações da prévia do .tex e para as citações [@chave] do Markdown. */
(function (root) {
  "use strict";

  const MONTHS = { jan: "1", feb: "2", mar: "3", apr: "4", may: "5", jun: "6", jul: "7", aug: "8", sep: "9", oct: "10", nov: "11", dec: "12" };
  const L = {
    pt: { refs: "Referências", in: "In", available: "Disponível em", access: "Acesso em", ed: "ed.", thesis: "Tese (Doutorado)",
      dissertation: "Dissertação (Mestrado)", tcc: "Trabalho de Conclusão de Curso", report: "Relatório técnico", sd: "s.d.",
      vol: "v.", num: "n.", pages: "p.", etal: "et al.", entries: "{n} referências", entry: "1 referência", key: "chave",
      skipped: "{n} entradas não puderam ser lidas e ficaram de fora." },
    en: { refs: "References", in: "In", available: "Available at", access: "Accessed on", ed: "ed.", thesis: "PhD thesis",
      dissertation: "Master's thesis", tcc: "Bachelor's thesis", report: "Technical report", sd: "n.d.",
      vol: "v.", num: "n.", pages: "p.", etal: "et al.", entries: "{n} references", entry: "1 reference", key: "key",
      skipped: "{n} entries could not be read and were left out." },
  };

  /* ---------------- leitura ---------------- */
  function parse(src) {
    const strings = Object.assign({}, MONTHS);
    const entries = [];
    let skipped = 0, i = 0;
    const s = String(src);
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const braced = (open, close) => {       // a partir de s[i] === open
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === open) depth++;
        else if (s[j] === close && --depth === 0) break;
      }
      const out = s.slice(i + 1, j);
      i = j + 1;
      return out;
    };
    const quoted = () => {
      let depth = 0, j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === "\\") { j++; continue; }
        if (s[j] === "{") depth++; else if (s[j] === "}") depth--;
        else if (s[j] === '"' && depth === 0) break;
      }
      const out = s.slice(i + 1, j);
      i = j + 1;
      return out;
    };
    const value = () => {                   // partes ligadas por #
      let out = "";
      for (;;) {
        ws();
        if (s[i] === "{") out += braced("{", "}");
        else if (s[i] === '"') out += quoted();
        else {
          const m = /^[^\s,#}\)]+/.exec(s.slice(i));
          if (!m) break;
          i += m[0].length;
          out += /^\d+$/.test(m[0]) ? m[0] : (strings[m[0].toLowerCase()] ?? m[0]);
        }
        ws();
        if (s[i] === "#") { i++; continue; }
        break;
      }
      return out;
    };
    while (i < s.length) {
      const at = s.indexOf("@", i);
      if (at < 0) break;
      i = at + 1;
      const m = /^([A-Za-z]+)\s*([{(])/.exec(s.slice(i));
      if (!m) continue;
      const type = m[1].toLowerCase();
      i += m[0].length - 1;
      const close = m[2] === "{" ? "}" : ")";
      if (type === "comment") { braced(m[2], close); continue; }
      if (type === "preamble") { braced(m[2], close); continue; }
      i++;
      if (type === "string") {
        ws();
        const k = /^[^\s=]+/.exec(s.slice(i));
        if (!k) { skipped++; continue; }
        i += k[0].length; ws();
        if (s[i] === "=") i++;
        strings[k[0].toLowerCase()] = value();
        ws(); if (s[i] === close) i++;
        continue;
      }
      ws();
      const key = /^[^\s,]+/.exec(s.slice(i));
      if (!key) { skipped++; continue; }
      i += key[0].length;
      const fields = {};
      let ok = true;
      for (;;) {
        ws();
        if (s[i] === ",") { i++; ws(); }
        if (i >= s.length) { ok = false; break; }
        if (s[i] === close) { i++; break; }
        const f = /^[A-Za-z][\w.:-]*/.exec(s.slice(i));
        if (!f) { ok = false; break; }
        i += f[0].length; ws();
        if (s[i] !== "=") { ok = false; break; }
        i++;
        fields[f[0].toLowerCase()] = value().replace(/\s+/g, " ").trim();
      }
      if (ok) entries.push({ type, key: key[0], fields });
      else skipped++;
    }
    return { entries, skipped };
  }

  /* ---------------- texto ---------------- */
  // os campos são LaTeX: {Brasil}, \'{e}, \textit{x}… viram Markdown pelo conversor do .tex
  function md(tex) {
    if (!tex) return "";
    if (root.MiranteTex && root.MiranteTex.inline) return root.MiranteTex.inline(tex);
    return tex.replace(/[{}]/g, "");
  }
  const plain = (tex) => md(tex).replace(/\\(.)/g, "$1").replace(/[*_`]/g, "");

  // "Souza, Ana Maria and João da Silva and {Instituto Brasileiro}"
  function names(field) {
    if (!field) return [];
    const parts = [];
    let depth = 0, start = 0;
    for (let j = 0; j < field.length; j++) {
      const c = field[j];
      if (c === "{") depth++; else if (c === "}") depth--;
      else if (depth === 0 && /\s/.test(c) && field.slice(j).match(/^\s+and\s+/i)) {
        const m = field.slice(j).match(/^\s+and\s+/i);
        parts.push(field.slice(start, j));
        j += m[0].length - 1; start = j + 1;
      }
    }
    parts.push(field.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
      if (p.toLowerCase() === "others") return { others: true };
      if (/^\{.*\}$/.test(p)) return { last: p.slice(1, -1), first: "", org: true };
      const comma = splitTop(p, ",");
      if (comma.length > 1) return { last: comma[0].trim(), first: comma.slice(1).join(",").trim() };
      const words = splitTop(p, " ").filter(Boolean);
      // partículas (da, de, van, von) ficam com o sobrenome
      let k = words.length - 1;
      while (k > 0 && /^[a-zà-ú]/.test(words[k - 1]) && /^(da|de|do|dos|das|di|van|von|der|del|la|le)$/.test(words[k - 1])) k--;
      return { last: words.slice(k).join(" "), first: words.slice(0, k).join(" ") };
    });
  }
  function splitTop(s, sep) {
    const out = [];
    let depth = 0, start = 0;
    for (let j = 0; j < s.length; j++) {
      if (s[j] === "{") depth++; else if (s[j] === "}") depth--;
      else if (s[j] === sep && depth === 0) { out.push(s.slice(start, j)); start = j + 1; }
    }
    out.push(s.slice(start));
    return out;
  }
  const upper = (s) => plain(s).toLocaleUpperCase("pt-BR");

  /* ---------------- referência (ABNT NBR 6023, simplificada) ---------------- */
  function authorsAbnt(list, lang) {
    if (!list.length) return "";
    const one = (n) => (n.org ? upper(n.last) : `${upper(n.last)}${n.first ? ", " + plain(n.first) : ""}`);
    const real = list.filter((n) => !n.others);
    if (real.length > 3 || list.some((n) => n.others)) return `${one(real[0])} ${L[lang].etal}`;
    return real.map(one).join("; ");
  }
  const year = (f) => plain(f.year || (f.date || "").slice(0, 4)) || null;

  function reference(e, lang = "pt") {
    const T = L[lang === "en" ? "en" : "pt"], f = e.fields;
    const who = authorsAbnt(names(f.author || f.editor), lang === "en" ? "en" : "pt");
    const title = md(f.title), y = year(f) || T.sd;
    const place = [md(f.address || f.location), md(f.publisher || f.institution || f.school || f.organization)].filter(Boolean).join(": ");
    const pages = f.pages ? `${T.pages} ${plain(f.pages).replace(/-+/g, "–")}` : "";
    const ed = f.edition && !/^1\D*$/.test(plain(f.edition)) ? `${plain(f.edition).replace(/\D+$/, "")}. ${T.ed}` : "";
    const parts = [];
    const head = (t, bold) => (who ? `${who}. ` : "") + (bold ? `**${t}**` : t);
    switch (e.type) {
      case "article":
        parts.push(head(title, false), `**${md(f.journal || f.journaltitle)}**`,
          [f.volume && `${T.vol} ${plain(f.volume)}`, f.number && `${T.num} ${plain(f.number)}`, pages, y].filter(Boolean).join(", "));
        return finish(parts.slice(0, 1).join("") + ". " + parts.slice(1).filter(Boolean).join(", "), f, T);
      case "book": case "booklet": case "manual":
        return finish([head(title, true), ed, [place, y].filter(Boolean).join(", ")].filter(Boolean).join(". "), f, T);
      case "inproceedings": case "conference": case "incollection": case "inbook":
        return finish([head(title, false), `${T.in}: **${md(f.booktitle || f.maintitle || f.title)}**`,
          [place, y].filter(Boolean).join(", "), pages].filter(Boolean).join(". "), f, T);
      case "phdthesis": case "mastersthesis": case "thesis": case "bachelorsthesis": {
        const kind = e.type === "phdthesis" ? T.thesis : e.type === "mastersthesis" ? T.dissertation : md(f.type) || T.tcc;
        return finish([head(title, true), y, `${kind} – ${md(f.school || f.institution)}`, [md(f.address), y].filter(Boolean).join(", ")].filter(Boolean).join(". "), f, T);
      }
      case "techreport": case "report":
        return finish([head(title, true), md(f.type) || T.report, [place, y].filter(Boolean).join(", ")].filter(Boolean).join(". "), f, T);
      default:
        return finish([head(title, true), md(f.howpublished), [place, y].filter(Boolean).join(", ")].filter(Boolean).join(". "), f, T);
    }
  }
  function finish(text, f, T) {
    let out = text.replace(/\.\s*\./g, ".").trim();
    if (!/[.!?]$/.test(out)) out += ".";
    if (f.doi) out += ` DOI: [${plain(f.doi)}](https://doi.org/${plain(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}).`;
    else if (f.url) out += ` ${T.available}: <${plain(f.url)}>.` + (f.urldate ? ` ${T.access}: ${plain(f.urldate)}.` : "");
    return out;
  }

  /* ---------------- citação ---------------- */
  // autor-data, como a ABNT: (SOUZA, 2020), (SOUZA; LIMA, 2019), (SOUZA et al., 2018)
  function authorYear(e, lang = "pt") {
    const list = names(e.fields.author || e.fields.editor).filter((n) => !n.others);
    const T = L[lang === "en" ? "en" : "pt"];
    let who;
    if (!list.length) who = upper(e.fields.title || e.key).split(/\s+/).slice(0, 3).join(" ");
    else if (list.length > 3) who = `${upper(list[0].last)} ${T.etal}`;
    else who = list.map((n) => upper(n.last)).join("; ");
    return { who, year: year(e.fields) || T.sd };
  }
  // chave → número ou rótulo, na ordem em que as citações aparecem
  function Citer(entries, { lang = "pt", style = "authoryear" } = {}) {
    this.byKey = new Map(entries.map((e) => [e.key, e]));
    this.lang = lang; this.style = style; this.order = [];
  }
  Citer.prototype.cite = function (items, { suppressAuthor = false } = {}) {
    // items: [{key, note}]
    if (this.style === "numeric") {
      const nums = items.map(({ key, note }) => {
        if (!this.byKey.has(key)) return `${key}?`;
        if (!this.order.includes(key)) this.order.push(key);
        return String(this.order.indexOf(key) + 1) + (note ? `, ${note}` : "");
      });
      return `[${nums.join("; ")}]`;
    }
    const parts = items.map(({ key, note }) => {
      const e = this.byKey.get(key);
      if (!e) return `${key}?`;
      if (!this.order.includes(key)) this.order.push(key);
      const a = authorYear(e, this.lang);
      return (suppressAuthor ? a.year : `${a.who}, ${a.year}`) + (note ? `, ${note}` : "");
    });
    return `(${parts.join("; ")})`;
  };
  /** As referências citadas (ou todas, com all), em Markdown: numeradas ou em ordem alfabética. */
  Citer.prototype.list = function ({ all = false, heading = true } = {}) {
    const keys = all ? [...this.byKey.keys()] : this.order;
    const items = keys.map((k) => this.byKey.get(k)).filter(Boolean);
    if (!items.length) return "";
    const T = L[this.lang === "en" ? "en" : "pt"];
    let body;
    if (this.style === "numeric") {
      if (all) for (const k of keys) if (!this.order.includes(k)) this.order.push(k);
      body = this.order.map((k) => this.byKey.get(k)).filter(Boolean).map((e, n) => `${n + 1}. ${reference(e, this.lang)}`).join("\n");
    } else {
      const sortKey = (e) => plain(authorsAbnt(names(e.fields.author || e.fields.editor), "pt") || e.fields.title || e.key) + (year(e.fields) || "");
      body = items.sort((a, b) => sortKey(a).localeCompare(sortKey(b), "pt")).map((e) => reference(e, this.lang)).join("\n\n");
    }
    return (heading ? `## ${T.refs}\n\n` : "") + body + "\n";
  };

  /** Um .bib aberto sozinho: a lista inteira, em ordem alfabética, com a chave de cada referência. */
  function toMarkdown(src, { lang = "pt", name = "" } = {}) {
    const { entries, skipped } = parse(src);
    const T = L[lang === "en" ? "en" : "pt"];
    const count = entries.length === 1 ? T.entry : T.entries.replace("{n}", entries.length);
    const sortKey = (e) => plain(authorsAbnt(names(e.fields.author || e.fields.editor), "pt") || e.fields.title || e.key) + (year(e.fields) || "");
    const list = entries.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b), "pt"))
      .map((e) => `${reference(e, lang)}\\\n<small>\`@${e.key}\` · ${e.type}</small>`).join("\n\n");
    const warn = skipped ? `\n\n> [!WARNING]\n> ${T.skipped.replace("{n}", skipped)}` : "";
    return `# ${T.refs}${name ? ` · ${name}` : ""}\n\n${count}${warn}\n\n${list}\n`;
  }

  root.MiranteBib = { parse, names, reference, authorYear, Citer, toMarkdown };
})(this);
