/* Mirante — motor de mapa mental.
 * Lê a sintaxe "mindmap" do Mermaid, calcula layouts (dois lados, direita, vertical, radial),
 * desenha em HTML (cartões de vidro) + SVG (ligações) e oferece operações de edição sobre o texto-fonte. */
(function () {
  "use strict";

  const SHAPES = [
    ["((", "))", "circle"], ["))", "((", "bang"], ["{{", "}}", "hexagon"],
    [")", "(", "cloud"], ["(", ")", "rounded"], ["[", "]", "square"],
  ];
  const PALETTE = {
    dark: ["#0A84FF", "#BF5AF2", "#FF9F0A", "#30D158", "#FF375F", "#64D2FF", "#5E5CE6", "#FFD60A", "#FF453A", "#66D4CF"],
    light: ["#007AFF", "#AF52DE", "#F28C00", "#28A745", "#FF2D55", "#1E9BD7", "#5856D6", "#C99700", "#FF3B30", "#00A89F"],
  };
  const NEW_TEXT = "Novo tópico";

  /* ---------------- parser ---------------- */
  function leadWidth(ws) { let n = 0; for (const ch of ws) n += ch === "\t" ? 4 : 1; return n; }

  function parseNodeStr(s) {
    let cls = "";
    const m = s.match(/^(.*?)\s*:::\s*([\w\s-]+)$/);
    if (m) { s = m[1]; cls = m[2].trim(); }
    for (const [o, c, shape] of SHAPES) {
      const i = s.indexOf(o);
      if (i >= 0 && s.endsWith(c) && s.length >= i + o.length + c.length) {
        const idStr = s.slice(0, i);
        if (/[()[\]{}]/.test(idStr)) continue;
        return { idStr, open: o, close: c, shape, inner: s.slice(i + o.length, s.length - c.length), cls };
      }
    }
    return { idStr: "", open: "", close: "", shape: "default", inner: s, cls };
  }

  function cleanText(inner) {
    let t = inner.trim(), quoted = false, md = false;
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) { t = t.slice(1, -1); quoted = true; }
    if (t.length >= 2 && t.startsWith("`") && t.endsWith("`")) { t = t.slice(1, -1); md = true; }
    return { text: t, quoted, md };
  }

  /** Retorna null se o texto não for um mindmap. */
  function parse(text) {
    const lines = text.split("\n");
    let header = -1, inFront = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (i === 0 && t === "---") { inFront = true; continue; }
      if (inFront) { if (t === "---") inFront = false; continue; }
      if (!t || t.startsWith("%%")) continue;
      if (/^mindmap\b/.test(t)) { header = i; break; }
      return null;
    }
    if (header < 0) return null;

    const nodes = [], stack = [];
    let root = null, last = null;
    const indents = new Set();
    for (let j = header + 1; j < lines.length; j++) {
      const raw = lines[j], t = raw.trim();
      if (!t || t.startsWith("%%")) continue;
      const ws = raw.match(/^\s*/)[0];
      const indent = leadWidth(ws);
      if (t.startsWith("::icon(") || t.startsWith(":::")) { if (last) last.extra.push(j); continue; }
      const p = parseNodeStr(t);
      const c = cleanText(p.inner);
      const node = {
        id: nodes.length, line: j, indent, ws, ...p, ...c,
        children: [], parent: null, extra: [], depth: 0,
      };
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (!stack.length) {
        if (!root) root = node;
        else { node.parent = root; root.children.push(node); }
      } else { node.parent = stack[stack.length - 1]; node.parent.children.push(node); }
      stack.push(node); nodes.push(node); last = node;
      indents.add(indent);
    }
    if (!root) return { lines, header, root: null, nodes, unit: 2 };

    // unidade de indentação: menor diferença entre pai e filho
    let unit = 0;
    for (const n of nodes) if (n.parent) {
      const d = n.indent - n.parent.indent;
      if (d > 0 && (!unit || d < unit)) unit = d;
    }
    const walk = (n, depth, branch) => {
      n.depth = depth; n.branch = branch;
      n.children.forEach((c, i) => walk(c, depth + 1, depth === 0 ? i : branch));
    };
    walk(root, 0, -1);
    return { lines, header, root, nodes, unit: unit || 2 };
  }

  function subtreeEnd(n) {
    let e = Math.max(n.line, ...n.extra);
    for (const c of n.children) e = Math.max(e, subtreeEnd(c));
    return e;
  }
  function isAncestor(a, b) { for (let p = b; p; p = p.parent) if (p === a) return true; return false; }

  /* ---------------- edição (texto -> texto) ---------------- */
  function nodeSource(node, text) {
    let inner = text.replace(/\r?\n/g, "<br>").replace(/"/g, "”");
    const special = /[()[\]{}]/.test(inner) || inner.startsWith("::") || inner.includes(":::");
    const cls = node && node.cls ? " :::" + node.cls : "";
    if (node && node.md) inner = '"`' + inner + '`"';
    else if (special || (node && node.quoted)) inner = '"' + inner + '"';
    if (node && node.open) return node.idStr + node.open + inner + node.close + cls;
    if (special || (node && node.md)) return "[" + inner + "]" + cls;
    return inner + cls;
  }
  function childWs(p, n) {
    if (n.children.length) return n.children[0].ws;
    return n.ws + (n.ws.includes("\t") ? "\t" : " ".repeat(p.unit));
  }

  const ops = {
    rename(p, n, text) {
      const lines = p.lines.slice();
      lines[n.line] = n.ws + nodeSource(n, text);
      return { text: lines.join("\n"), line: n.line };
    },
    addChild(p, n) {
      const lines = p.lines.slice(), at = subtreeEnd(n) + 1;
      lines.splice(at, 0, childWs(p, n) + NEW_TEXT);
      return { text: lines.join("\n"), line: at, rename: true };
    },
    addSibling(p, n) {
      if (!n.parent) return ops.addChild(p, n);
      const lines = p.lines.slice(), at = subtreeEnd(n) + 1;
      lines.splice(at, 0, n.ws + NEW_TEXT);
      return { text: lines.join("\n"), line: at, rename: true };
    },
    remove(p, n) {
      if (!n.parent) return null;
      const lines = p.lines.slice(), end = subtreeEnd(n);
      lines.splice(n.line, end - n.line + 1);
      const sibs = n.parent.children, i = sibs.indexOf(n);
      const sel = i > 0 ? sibs[i - 1].line : n.parent.line;
      return { text: lines.join("\n"), line: sel };
    },
    move(p, n, target) {
      if (!n.parent || target === n.parent || isAncestor(n, target)) return null;
      const lines = p.lines.slice(), start = n.line, end = subtreeEnd(n), count = end - start + 1;
      const block = lines.splice(start, count);
      const tLine = target.line > end ? target.line - count : target.line;
      const p2 = parse(lines.join("\n"));
      const t2 = p2.nodes.find((x) => x.line === tLine);
      if (!t2) return null;
      const ws = childWs(p2, t2);
      const re = block.map((l) => {
        if (!l.trim()) return "";
        const lw = leadWidth(l.match(/^\s*/)[0]);
        return ws + " ".repeat(Math.max(0, lw - n.indent)) + l.trimStart();
      });
      const at = subtreeEnd(t2) + 1;
      const out = p2.lines.slice();
      out.splice(at, 0, ...re);
      return { text: out.join("\n"), line: at };
    },
    reorder(p, n, dir) {
      if (!n.parent) return null;
      const sibs = n.parent.children, i = sibs.indexOf(n), o = sibs[i + dir];
      if (!o) return null;
      const [a, b] = dir < 0 ? [o, n] : [n, o];
      const aS = a.line, aE = subtreeEnd(a), bS = b.line, bE = subtreeEnd(b);
      const L = p.lines;
      const out = [...L.slice(0, aS), ...L.slice(bS, bE + 1), ...L.slice(aE + 1, bS), ...L.slice(aS, aE + 1), ...L.slice(bE + 1)];
      const line = dir < 0 ? aS : aS + (bE - bS + 1) + (bS - aE - 1);
      return { text: out.join("\n"), line };
    },
  };

  /* ---------------- layouts ---------------- */
  function layoutSide(root, L, S, rightOnly) {
    const sb = (n) => {
      if (n._sb != null) return n._sb;
      let t = 0; n.children.forEach((c) => (t += sb(c)));
      if (n.children.length) t += S * (n.children.length - 1);
      return (n._sb = Math.max(n.h, t));
    };
    const place = (n, x, top, dir) => {
      const s = sb(n);
      n.dir = dir; n.y = top + s / 2 - n.h / 2; n.x = dir > 0 ? x : x - n.w;
      let t = 0; n.children.forEach((c) => (t += sb(c))); t += S * Math.max(0, n.children.length - 1);
      let cy = top + (s - t) / 2;
      const nx = dir > 0 ? n.x + n.w + L : n.x - L;
      for (const c of n.children) { place(c, nx, cy, dir); cy += sb(c) + S; }
    };
    const group = (list, dir) => {
      let t = 0; list.forEach((c) => (t += sb(c))); t += S * Math.max(0, list.length - 1);
      let cy = -t / 2;
      const nx = dir > 0 ? root.x + root.w + L : root.x - L;
      for (const c of list) { place(c, nx, cy, dir); cy += sb(c) + S; }
    };
    root.x = rightOnly ? 0 : -root.w / 2; root.y = -root.h / 2; root.dir = 0;
    let right = [], left = [];
    if (rightOnly) right = root.children.slice();
    else {
      let total = 0; root.children.forEach((c) => (total += sb(c) + S));
      let acc = 0;
      for (const c of root.children) {
        if (!right.length || acc + sb(c) / 2 < total / 2) { right.push(c); acc += sb(c) + S; } else left.push(c);
      }
    }
    group(right, 1); group(left, -1);
    return (p, c) => {
      const d = c.dir;
      const x1 = d > 0 ? p.x + p.w : p.x, y1 = p.y + p.h / 2;
      const x2 = d > 0 ? c.x : c.x + c.w, y2 = c.y + c.h / 2;
      const mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    };
  }

  function layoutDown(root, L, S) {
    const IND = Math.round(16 + L * 0.15), STACK = Math.max(4, Math.round(S * 0.7)), COL = Math.max(20, S * 2);
    const bw = (n) => {
      if (n._bw != null) return n._bw;
      let w = n.w; for (const c of n.children) w = Math.max(w, IND + bw(c));
      return (n._bw = w);
    };
    const stack = (n, left, top) => {
      n.x = left; n.y = top; n.stacked = n.depth > 1;
      let cy = top + n.h + STACK;
      for (const c of n.children) { const e = stack(c, left + IND, cy); cy = e + STACK; }
      return n.children.length ? cy - STACK : top + n.h;
    };
    const kids = root.children;
    let total = 0; kids.forEach((c) => (total += bw(c))); total += COL * Math.max(0, kids.length - 1);
    root.x = -root.w / 2; root.y = 0;
    let cx = -total / 2;
    const top = root.h + L;
    for (const c of kids) { stack(c, cx, top); cx += bw(c) + COL; }
    return (p, c) => {
      if (c.stacked) {
        const x0 = p.x + IND / 2, y0 = p.y + p.h, y2 = c.y + c.h / 2, x2 = c.x, r = Math.min(8, (x2 - x0) / 2);
        return `M${x0},${y0} V${y2 - r} Q${x0},${y2} ${x0 + r},${y2} H${x2}`;
      }
      const x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y, my = (y1 + y2) / 2;
      return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    };
  }

  function layoutRadial(root, nodes, L, S) {
    const leaves = (n) => n._lv ?? (n._lv = n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
    const assign = (n, a0, a1) => {
      n.a = (a0 + a1) / 2; n.wedge = a1 - a0;
      const tot = leaves(n); let a = a0;
      for (const c of n.children) { const span = (a1 - a0) * (leaves(c) / tot); assign(c, a, a + span); a += span; }
    };
    assign(root, -Math.PI / 2, Math.PI * 1.5);
    // meia-extensão de um cartão na direção do ângulo a
    const ext = (n, a) => Math.abs(Math.cos(a)) * n.w / 2 + Math.abs(Math.sin(a)) * n.h / 2;
    const m = S / 2;
    const placed = [];
    const hits = (n) => placed.some((o) =>
      n.x < o.x + o.w + m && n.x + n.w + m > o.x && n.y < o.y + o.h + m && n.y + n.h + m > o.y);
    const put = (n, r) => {
      n.r = r; n.cx = r * Math.cos(n.a); n.cy = r * Math.sin(n.a);
      n.x = n.cx - n.w / 2; n.y = n.cy - n.h / 2;
    };
    root.r = 0; root.cx = 0; root.cy = 0; root.x = -root.w / 2; root.y = -root.h / 2;
    placed.push(root);
    // em largura (nível a nível, por ângulo): cada cartão o mais perto possível do pai sem colidir
    let level = root.children.slice();
    while (level.length) {
      level.sort((a, b) => a.a - b.a);
      for (const n of level) {
        const p = n.parent;
        let r = (p.depth ? p.r + ext(p, n.a) : ext(p, n.a)) + L + ext(n, n.a);
        put(n, r);
        for (let k = 0; k < 600 && hits(n); k++) put(n, (r += 6));
        placed.push(n);
      }
      level = level.flatMap((n) => n.children);
    }
    return (p, c) => {
      const pr = p.depth ? p.r : 0, m = pr + (c.r - pr) / 2;
      const c1 = p.depth ? [m * Math.cos(p.a), m * Math.sin(p.a)] : [p.cx, p.cy];
      const c2 = [m * Math.cos(c.a), m * Math.sin(c.a)];
      return `M${p.cx},${p.cy} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${c.cx},${c.cy}`;
    };
  }

  /* ---------------- render ---------------- */
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function labelHtml(n) {
    let h = escapeHtml(n.text).replace(/&lt;br\s*\/?&gt;/gi, "<br>");
    if (n.md) h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
    return h;
  }

  /* Congela as quebras de linha em 3 fases para forçar UM layout só (ler/escrever intercalado
   * custava ~60 ms por redesenho num mapa de 80 nós): 1) embrulha palavras em spans (só escrita),
   * 2) lê a posição de todas (uma leitura), 3) insere os <br> (só escrita). */
  function wrapWords(el) {
    const label = el.querySelector(".mm-label");
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const part of t.data.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(part); continue; }
        const w = document.createElement("span");
        w.className = "w"; w.textContent = part;
        frag.append(w);
      }
      t.replaceWith(frag);
    }
  }
  function findBreaks(el) {
    const out = [];
    let lastTop = null;
    for (const w of el.querySelectorAll(".mm-label span.w")) {
      const top = w.offsetTop;
      if (lastTop !== null && top > lastTop + 2) out.push(w);
      lastTop = top;
    }
    return out;
  }
  function applyBreaks(el, breaks) {
    for (const w of breaks) {
      // mantém o espaço (a busca Ctrl+F acha frases entre linhas); no fim da linha ele não ocupa largura
      let prev = w.previousSibling;
      if (prev && prev.nodeType === 3 && /^\s+$/.test(prev.data)) prev = prev.previousSibling;
      if (!(prev && prev.nodeName === "BR")) w.before(document.createElement("br"));
    }
    el.classList.add("frozen");
  }

  /**
   * Desenha o mapa dentro de `host` (limpo antes). Retorna { width, height, els: Map<id,el> }.
   * opts: { layout, levelGap, siblingGap, cardWidth, theme }
   */
  function render(host, parsed, opts) {
    host.innerHTML = "";
    host.classList.add("mm-host");
    if (!parsed || !parsed.root) {
      host.innerHTML = '<div class="mm-empty">Mapa vazio — adicione um nó raiz abaixo de <code>mindmap</code>.</div>';
      return { width: 400, height: 80, els: new Map() };
    }
    const pal = PALETTE[opts.theme === "light" ? "light" : "dark"];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mm-edges");
    const layer = document.createElement("div");
    layer.className = "mm-nodes";
    host.append(svg, layer);

    const els = new Map();
    for (const n of parsed.nodes) {
      const el = document.createElement("div");
      const d = n.depth === 0 ? "mm-root" : n.depth === 1 ? "d1" : "dn";
      el.className = `mm-node ${d} shape-${n.shape}`;
      el.dataset.id = n.id;
      n.color = n.depth === 0 ? null : pal[n.branch % pal.length];
      if (n.color) el.style.setProperty("--c", n.color);
      el.style.maxWidth = (n.depth === 0 ? opts.cardWidth * 1.3 : opts.cardWidth) + "px";
      el.innerHTML = `<span class="mm-label">${labelHtml(n) || "&nbsp;"}</span>`;
      layer.appendChild(el);
      els.set(n.id, el);
      n._sb = n._bw = n._lv = null; n.stacked = false;
    }
    // Congela as quebras de linha calculadas a 100%: a largura dos glifos muda um pouco com o zoom e,
    // sem isso, o texto quebraria em lugares diferentes. Com as quebras fixas (e nowrap), o cartão
    // acompanha o texto em qualquer zoom e nunca corta uma linha.
    const all = parsed.nodes.map((n) => els.get(n.id));
    all.forEach(wrapWords);
    const breaks = all.map(findBreaks);
    all.forEach((el, i) => applyBreaks(el, breaks[i]));
    for (const n of parsed.nodes) { const el = els.get(n.id); n.w = el.offsetWidth; n.h = el.offsetHeight; }

    const L = opts.levelGap, S = opts.siblingGap;
    const edgeFn = opts.layout === "down" ? layoutDown(parsed.root, L, S)
      : opts.layout === "radial" ? layoutRadial(parsed.root, parsed.nodes, L, S)
      : layoutSide(parsed.root, L, S, opts.layout === "right");

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of parsed.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    }
    const PAD = 40, ox = PAD - minX, oy = PAD - minY;
    const W = maxX - minX + PAD * 2, H = maxY - minY + PAD * 2;
    for (const n of parsed.nodes) {
      const el = els.get(n.id);
      n.left = n.x + ox; n.top = n.y + oy; // posição final em px do mapa (sem zoom)
      el.style.left = n.left + "px"; el.style.top = n.top + "px";
    }
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${ox},${oy})`);
    for (const n of parsed.nodes) {
      if (!n.parent) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgeFn(n.parent, n));
      path.setAttribute("stroke", n.color);
      path.setAttribute("stroke-width", n.depth === 1 ? 2.6 : n.depth === 2 ? 1.8 : 1.4);
      path.dataset.child = n.id;
      g.appendChild(path);
    }
    svg.appendChild(g);
    host.style.width = W + "px"; host.style.height = H + "px";
    return { width: W, height: H, els };
  }

  window.MiranteMindmap = { parse, render, ops, subtreeEnd, isAncestor, NEW_TEXT };
})();
