# Cálculo I: revisão

Resumo para revisar antes da prova. Use o botão de **mapa mental** na barra de baixo para ver os tópicos,
e o botão de **olho** para mostrar ou esconder todas as respostas.

## Limites

O limite descreve o valor de que $f(x)$ se aproxima quando $x$ se aproxima de $a$:

$$
\lim_{x \to a} f(x) = L
$$

### Limite fundamental

**Pergunta:** quanto vale $\lim_{x \to 0} \frac{\sin x}{x}$?

<details>
<summary>Ver resposta</summary>

Vale $1$. Ele aparece na demonstração da derivada do seno.

</details>

## Derivadas

A derivada é a taxa de variação instantânea:

$$
f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}
$$

### Regras principais

| Função | Derivada |
| --- | --- |
| $x^n$ | $n\,x^{n-1}$ |
| $\sin x$ | $\cos x$ |
| $e^x$ | $e^x$ |
| $\ln x$ | $\frac{1}{x}$ |

### Regra da cadeia

**Pergunta:** qual é a derivada de $\sin(x^2)$?

<details>
<summary>Ver resposta</summary>

Pela regra da cadeia, $(f \circ g)'(x) = f'(g(x))\,g'(x)$. Então:

$$
\frac{d}{dx}\sin(x^2) = \cos(x^2) \cdot 2x
$$

</details>

## Integrais

### Teorema fundamental

$$
\int_a^b f(x)\,dx = F(b) - F(a)
$$

**Pergunta:** quanto vale $\int_0^1 x^2\,dx$?

<details>
<summary>Ver resposta</summary>

$$
\int_0^1 x^2\,dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}
$$

</details>

## Como os assuntos se ligam

```mermaid
flowchart LR
  L[Limites] --> D[Derivadas]
  D --> I[Integrais]
  I -->|Teorema fundamental| D
```
