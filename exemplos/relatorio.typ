// Exemplo de documento Typst: o Mirante compila de verdade, offline, e mostra as páginas.
// Edite com o painel de código (Ctrl+E) e veja a página mudar; Arquivo → Exportar PDF gera o PDF final.

#set document(title: "Relatório de laboratório", author: "Ana Souza")
#set page(paper: "a4", margin: (x: 2.5cm, y: 2.5cm), numbering: "1")
#set text(lang: "pt", size: 11pt)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#set par(justify: true)

#align(center)[
  #text(18pt, weight: "bold")[Relatório de laboratório: queda livre]

  Ana Souza · Física I · #datetime.today().display("[day]/[month]/[year]")
]

#v(1em)

= Introdução

Neste experimento medimos o tempo de queda de uma esfera para estimar a aceleração
da gravidade $g$, como em @souza2020queda. Desprezando a resistência do ar, a posição obedece a

$ y(t) = y_0 - 1/2 g t^2 $ <eq-queda>

e, isolando $g$ na @eq-queda, obtemos $g = (2h) / t^2$.

= Resultados

#figure(
  table(
    columns: 3,
    align: (left, center, center),
    table.header[*Altura (m)*][*Tempo (s)*][*$g$ (m/s²)*],
    [0,50], [0,320], [9,77],
    [1,00], [0,452], [9,79],
    [1,50], [0,553], [9,81],
  ),
  caption: [Tempos medidos e o valor de $g$ calculado.],
) <tab-medidas>

A média dos valores da @tab-medidas é $overline(g) approx 9","79 "m/s"^2$, a menos de
$0","2%$ do valor de referência.

= Conclusão

- O modelo sem resistência do ar descreve bem quedas curtas.
- Para alturas maiores, vale incluir o arrasto.

#bibliography("referencias.bib", title: "Referências", style: "associacao-brasileira-de-normas-tecnicas")
