/* Roteiro da demonstração gravada para o README. Roda dentro da página do Mirante.
 * Um cursor falso mostra onde cada clique acontece; ao final, window.__demoDone = true. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = (name) => window.webkit.messageHandlers.mirante.postMessage(JSON.stringify({ type: "demoShot", name }));
  const $ = (s) => document.querySelector(s);

  // ---- cursor falso ----
  const cur = document.createElement("div");
  cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(cur.style, { position: "fixed", left: "0", top: "0", zIndex: 99999, pointerEvents: "none",
    transform: "translate(760px, 560px)", transition: "transform .55s cubic-bezier(.3,.7,.2,1)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" });
  document.body.appendChild(cur);
  let cx = 760, cy = 560;
  const ripple = (x, y) => {
    const r = document.createElement("div");
    Object.assign(r.style, { position: "fixed", left: x - 18 + "px", top: y - 18 + "px", width: "36px", height: "36px",
      borderRadius: "50%", background: "rgba(10,132,255,.35)", zIndex: 99998, pointerEvents: "none", transform: "scale(.3)",
      transition: "transform .35s ease-out, opacity .45s ease-out" });
    document.body.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
    setTimeout(() => r.remove(), 600);
  };
  const moveTo = async (x, y, ms = 600) => {
    cur.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.2,1)`;
    cur.style.transform = `translate(${x - 4}px, ${y - 2}px)`; cx = x; cy = y;
    await sleep(ms + 60);
  };
  const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const click = async (el, ms) => {
    const [x, y] = center(el);
    await moveTo(x, y, ms);
    ripple(x, y); await sleep(120);
    el.click();
  };
  // tecla mostrada na tela (para atalhos)
  const keycap = (text) => {
    const k = document.createElement("div");
    k.textContent = text;
    Object.assign(k.style, { position: "fixed", left: "50%", top: "22px", transform: "translateX(-50%)", zIndex: 99999,
      padding: "8px 16px", borderRadius: "12px", font: "600 15px 'Inter Variable', sans-serif", color: "#fff",
      background: "rgba(20,20,28,.82)", boxShadow: "0 6px 20px rgba(0,0,0,.25)", pointerEvents: "none", transition: "opacity .3s" });
    document.body.appendChild(k);
    setTimeout(() => { k.style.opacity = "0"; setTimeout(() => k.remove(), 350); }, 1100);
  };
  const scrollDoc = (to, ms) => new Promise((res) => {
    const sc = $("#doc-scroll"), from = sc.scrollTop, t0 = performance.now();
    const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (t) => { const p = Math.min(1, (t - t0) / ms); sc.scrollTop = from + (to - from) * ease(p); p < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
  const wheelZoom = async (x, y, steps, dy) => {
    const st = $("#stage");
    for (let i = 0; i < steps; i++) {
      st.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(16);
    }
  };
  const until = async (fn, ms = 6000) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await sleep(50); };

  // ---- 1. boas-vindas com recentes ----
  await sleep(1600);
  shot("boas-vindas");
  await click([...document.querySelectorAll(".recent-item")].find((b) => b.textContent.includes("bem-vindo.md")), 900);

  // ---- 2. Markdown ----
  await until(() => document.body.classList.contains("mode-md") && !document.body.classList.contains("is-loading"));
  await sleep(1300);
  shot("markdown");
  const sc = $("#doc-scroll");
  const diag = $("#doc .mermaid-block") || $("#doc h2");
  await scrollDoc(Math.max(0, diag.offsetTop - 120), 1600);
  await sleep(1300);
  shot("markdown-diagrama");
  await scrollDoc(0, 1000);
  await sleep(400);
  const link = [...document.querySelectorAll("#doc a")].find((a) => (a.getAttribute("href") || "").endsWith(".mmd"));
  await click(link, 800);

  // ---- 3. mapa mental ----
  await until(() => document.body.classList.contains("mode-mmd") && document.querySelectorAll("#canvas .mm-node").length > 5);
  await sleep(1400);
  shot("mapa-mental");
  const root = $("#canvas .mm-root");
  const [rx, ry] = center(root);
  await moveTo(rx + 160, ry - 40, 500);
  await wheelZoom(rx + 160, ry - 40, 34, -6);
  await sleep(900);
  keycap("Ctrl 1  ·  ajustar à janela");
  mirante.fit();
  await sleep(1100);
  for (const v of ["right", "down", "radial", "both"]) {
    await click($(`#dock [data-seg="layout"][data-val="${v}"]`), 420);
    await sleep(v === "radial" ? 1300 : 1050);
    if (v === "radial") shot("mapa-radial");
  }

  // ---- 4. editor ao vivo ----
  keycap("Ctrl E  ·  código ao lado");
  await sleep(250);
  mirante.toggleEditor(true);
  await sleep(900);
  const src = $("#src");
  const line = "      Próxima versão";
  const pos = src.value.indexOf(line) + line.length;
  src.focus(); src.setSelectionRange(pos, pos);
  for (const ch of "\n      Comemorar com o time") {
    document.execCommand("insertText", false, ch);
    await sleep(ch === "\n" ? 160 : 55);
  }
  await sleep(1800);
  shot("editor");
  mirante.toggleEditor(false);
  await sleep(900);

  // ---- 5. tema escuro ----
  await click($('#dock [data-cmd="theme"]'), 650);
  await sleep(1700);
  shot("mapa-escuro");
  await moveTo(cx + 300, cy - 200, 700);
  await sleep(500);
  window.__demoDone = true;
})();
