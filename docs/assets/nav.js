/* Barra do topo: destaca o link da seção que está na tela enquanto a pessoa rola.
   Vale para os links da barra que apontam para uma seção desta página (#id ou ./#id). Sem seção na tela (no
   topo da página), fica destacado o link marcado com aria-current="page", se houver (ex.: "Formatos"). */
(function () {
  const links = [...document.querySelectorAll(".nav .links a")];
  const fixo = links.find((a) => a.getAttribute("aria-current") === "page");
  const alvos = links.map((a) => {
    const u = new URL(a.href, location.href);
    if (!u.hash || u.pathname !== location.pathname) return null;
    const el = document.getElementById(decodeURIComponent(u.hash.slice(1)));
    return el ? { a, el } : null;
  }).filter(Boolean);
  if (fixo) fixo.classList.add("on");
  if (!alvos.length) return;

  let atual = null;
  function marcar() {
    const topo = document.querySelector("header.nav").offsetHeight;
    const linha = topo + innerHeight * 0.3;          // a seção "atual" é a que passou desta linha
    let achado = null;
    for (const x of alvos) if (x.el.getBoundingClientRect().top <= linha) achado = x;
    // no fim da página, a última seção ganha mesmo que seja curta demais para chegar à linha
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) achado = alvos[alvos.length - 1];
    const a = achado ? achado.a : fixo || null;
    if (a === atual) return;
    for (const l of links) { l.classList.toggle("on", l === a); if (l !== fixo) l.removeAttribute("aria-current"); }
    if (a && a !== fixo) a.setAttribute("aria-current", "location");
    atual = a;
  }
  let pedido = 0;
  addEventListener("scroll", () => { if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; marcar(); }); }, { passive: true });
  addEventListener("resize", marcar);
  marcar();
})();
