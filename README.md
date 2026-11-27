<div align="center">

<img src="packaging/mirante.svg" width="88" alt="Ícone do Mirante">

# Mirante

**Visualizador e editor de Markdown e diagramas Mermaid e Graphviz para Windows, Linux e macOS**

[![CI](https://github.com/joseRibamar21/mirante_md_mmd/actions/workflows/ci.yml/badge.svg)](https://github.com/joseRibamar21/mirante_md_mmd/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/joseRibamar21/mirante_md_mmd?label=vers%C3%A3o)](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest)
[![Licença MIT](https://img.shields.io/github/license/joseRibamar21/mirante_md_mmd?label=licen%C3%A7a)](LICENSE)
![Windows, Linux e macOS](https://img.shields.io/badge/plataforma-Windows%20%7C%20Linux%20%7C%20macOS-informational)

[**Site do Mirante**](https://joseribamar21.github.io/mirante_md_mmd/) ·
[**Baixar para Windows**](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-windows-x64-setup.exe) ·
[**Baixar para Linux (.deb)**](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-linux-amd64.deb) ·
[**Baixar para Mac**](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-macos-universal.dmg) ·
[Todas as versões](https://github.com/joseRibamar21/mirante_md_mmd/releases) ·
[Reportar um problema](https://github.com/joseRibamar21/mirante_md_mmd/issues) ·
[**Apoiar no GitHub Sponsors**](https://github.com/sponsors/joseRibamar21)

<img src="docs/demo.gif" width="800" alt="Demonstração: tela inicial com arquivos recentes, um documento Markdown com diagrama, um mapa mental com zoom e troca de layout, edição ao vivo no painel de código e tema escuro">

</div>

O Mirante abre arquivos **Markdown** (`.md`) e diagramas **Mermaid** (`.mmd`) e **Graphviz** (`.gv`, `.dot`) com um
clique duplo, com um visual limpo, e atualiza sozinho quando o arquivo muda no disco. Escreva no seu editor favorito e leia no Mirante, ou
edite direto nele: o painel de código fica ao lado e o desenho acompanha enquanto você digita.

## Recursos

- **Abre com um clique duplo**: no Windows, no macOS e no Linux, o Mirante se registra como app dos `.md`,
  `.mmd` e `.gv`, e vários arquivos abertos ficam todos no mesmo Mirante.
- **Markdown completo**: tabelas, listas de tarefas, código com destaque de sintaxe, citações, links
  internos e diagramas Mermaid e Graphviz no meio do texto (blocos ` ```mermaid ` e ` ```dot `).
- **Diagramas do Markdown com controles próprios**: zoom, mover arrastando ou pelos botões e **expandir** em
  tela cheia sobre fundo escuro. Também dá para abrir um diagrama numa **janela só dele**, ligada ao `.md`:
  o que se edita lá volta para o bloco na hora, e <kbd>Ctrl</kbd> <kbd>S</kbd> salva o `.md`.
- **Qualquer diagrama Mermaid** em arquivos `.mmd`: fluxogramas, sequência, Gantt, classes, estados e outros.
- **Grafos Graphviz** em arquivos `.gv` e `.dot`, com todos os motores de layout (`dot`, `neato`, `circo`,
  `twopi`, `fdp` e outros, escolhidos pelo atributo `layout` do grafo), sem precisar instalar o Graphviz.
- **Documentos Typst** (`.typ`): compilados de verdade pelo próprio compilador do Typst, dentro do app e
  offline. As páginas aparecem como no PDF final e acompanham a digitação; erros aparecem com linha e coluna, e
  **Arquivo → Exportar PDF** gera o PDF. A internet só é usada se o documento importar um pacote `@preview/…`
  que ainda não está no computador.
- **Compatível com o Obsidian**: notas de rodapé (`[^1]` e `^[inline]`), links `[[nota]]`, `[[nota|apelido]]` e
  `[[nota#seção]]` (a nota é procurada no cofre inteiro, como no Obsidian), imagens `![[foto.png|300]]`,
  `==destaque==`, `#etiquetas`, `%%comentários%%` e os tipos de caixa do Obsidian (`todo`, `bug`, `failure`…).
  As notas de rodapé viram `\footnote` no LaTeX e notas de rodapé de verdade no Word.
- **Bibliografia** (`.bib`): abre a lista de referências formatada no padrão da ABNT, com a chave de cada uma.
  O mesmo `.bib` serve às citações do Markdown (`[@chave]`, `[@chave, p. 10]`, com `bibliography: refs.bib`
  no cabeçalho), do LaTeX (`\cite`, `\citet`, `\bibliography`) e do Typst (`@chave`, `#bibliography`): as
  citações saem como (SOUZA; LIMA, 2020) e a lista de referências aparece no fim.
- **Documentos LaTeX** (`.tex`): o Mirante mostra uma prévia formatada, com seções numeradas, fórmulas, tabelas,
  figuras, teoremas, notas de rodapé, citações e referências cruzadas, e atualiza enquanto você edita. É uma prévia
  para ler e revisar, não um compilador: pacotes como TikZ e a bibliografia em `.bib` não são desenhados.
- **Texto simples** em arquivos `.txt`: abre direto no editor, ocupando a janela, com busca (Ctrl+F) e
  salvamento como nos outros formatos.
- **Mapas mentais editáveis**: quatro layouts (dois lados, direita, vertical, radial) além do original do
  Mermaid; arraste um nó sobre outro para mudar de pai, renomeie com duplo clique e crie filhos e irmãos
  pelo teclado, com desfazer e refazer.
- **Editor ao lado** (<kbd>Ctrl</kbd> <kbd>E</kbd>) ou em janela separada (<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd>),
  com o desenho atualizando ao vivo.
- **Miniaturas no gerenciador de arquivos** (Linux): no Nautilus e em outros que seguem o padrão do
  freedesktop, os `.md`, `.tex`, `.typ`, `.mmd` e `.gv` mostram uma prévia da página (títulos, listas, tabelas,
  fórmulas) ou do diagrama no lugar do ícone genérico.
- **Sempre em dia com o disco**: salvou em outro programa, o Mirante redesenha na hora.
- **Tela inicial com os arquivos recentes**; links para outros `.md`/`.mmd`/`.gv` e arquivos arrastados para a
  janela abrem no próprio app.
- **Tema claro e escuro**, efeito de vidro e barra de controles que se esconde.
- **Em português e em inglês**: segue o idioma do sistema, ou escolha em **Exibir → Idioma (Language)**.
- **Zoom e movimento suaves a 60 fps**, com o modo de renderização escolhido pela sua placa de vídeo.
- **Buscar** no texto (<kbd>Ctrl</kbd> <kbd>F</kbd>), **exportar** o diagrama em SVG e **imprimir** ou salvar em PDF.
- **Modo apresentação** (<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd> ou o botão ▶ da barra): o `.md` vira slides em
  tela cheia, um para cada parte separada por `---` (sem nenhum, cada `##` começa um slide), com fórmulas,
  diagramas, caixas, tabelas e código. Setas, espaço ou clique avançam e <kbd>Esc</kbd> sai. Também apresenta
  `.tex` feitos no Beamer (um slide por `frame`) e `.typ` (uma página por slide). Veja `exemplos/apresentacao.md`.
- **Trabalho no padrão ABNT** (Arquivo → Exportar como LaTeX ABNT): o `.md` vira um `.tex` na classe abnTeX2, com
  capa, folha de rosto, resumo, abstract, sumário, capítulos, citações autor-data (abntex2cite), referências e
  apêndices. Os dados da capa vêm do cabeçalho do `.md` (`titulo`, `autor`, `instituicao`, `curso`, `tipo`,
  `orientador`, `cidade`, `ano`, `palavras-chave`); o que faltar sai marcado para preencher. Veja
  `exemplos/tcc-abnt.md`.
- **Exportar para Word** (menu Arquivo): o `.md` (e também o `.tex` e o `.bib`) vira um `.docx` com os estilos de
  título do Word (entram no sumário), listas, tabelas, caixas de destaque, código, citações com a lista de
  referências, fórmulas como **equações do Word, editáveis**, e os diagramas e imagens no lugar. Sem precisar
  de outro programa instalado.
- **Exportar para LaTeX** (menu Arquivo): o `.md` vira um `.tex` pronto para compilar ou subir no Overleaf, com
  título, seções, fórmulas, tabelas, caixas de destaque e os diagramas em `.svg` ao lado. Cada tabela também tem um
  botão **LaTeX** que copia só ela, para colar num trabalho que já existe.
- **Também para estudar**: fórmulas matemáticas e de química (`$...$`, `$$...$$`, `\ce{}`), caixas de
  destaque (`> [!TIP]`, `> [!WARNING]`...), perguntas com **resposta escondida** (`<details>`) e um **modo
  revisão** que mostra ou esconde todas de uma vez, e um **mapa mental gerado pelos títulos** do documento.
- **Gerar material com IA** (menu Ajuda): prompts prontos e um [guia de formato](docs/ia/guia.md) para o
  Claude, o ChatGPT ou o Gemini devolverem o material já no formato do Mirante.

## Capturas

| | |
| :---: | :---: |
| <img src="docs/capturas/markdown-diagrama.png" alt="Documento Markdown com diagrama Mermaid"> | <img src="docs/capturas/editor.png" alt="Mapa mental com o painel de código ao lado"> |
| Markdown com diagrama no meio do texto | Mapa mental com o código ao lado |
| <img src="docs/capturas/mapa-radial.png" alt="Mapa mental no layout radial"> | <img src="docs/capturas/mapa-escuro.png" alt="Mapa mental no tema escuro"> |
| Layout radial | Tema escuro |

<div align="center">
<img src="docs/capturas/windows.png" width="640" alt="Mirante no Windows 11 com um mapa mental aberto"><br>
<sub>No Windows 11</sub>
</div>

## Instalação

### Windows 10 e 11

Baixe e rode o [**instalador**](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-windows-x64-setup.exe)
(cerca de 3 MB; instala só para o seu usuário, sem pedir administrador). Ele registra o Mirante para abrir
arquivos `.md`, `.mmd` e `.gv`. Também há um [`.msi`](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-windows-x64.msi)
para quem distribui em empresas.

A extensão `.dot` fica de fora do registro porque no Windows ela também é de modelos do Word; abra esses
arquivos pelo Mirante (<kbd>Ctrl</kbd> <kbd>O</kbd>, arrastando para a janela) ou por **Abrir com**.

> O instalador ainda não tem assinatura digital. Se o Windows mostrar "O Windows protegeu o computador",
> clique em **Mais informações → Executar assim mesmo**.

### Ubuntu 22.04+ e Debian 12+

```bash
wget https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-linux-amd64.deb
sudo apt install ./Mirante-linux-amd64.deb
```

Depois procure **Mirante** no menu de apps, ou abra um `.md`/`.mmd`/`.gv` pelo gerenciador de arquivos.
Para remover: `sudo apt remove mirante`.

### macOS 10.15+ (Apple Silicon e Intel)

Baixe o [**.dmg**](https://github.com/joseRibamar21/mirante_md_mmd/releases/latest/download/Mirante-macos-universal.dmg),
abra e arraste o **Mirante** para **Aplicativos**.

> O app ainda não é autenticado pela Apple. Na primeira vez, abra o Mirante e feche o aviso; depois vá em
> **Ajustes do Sistema → Privacidade e Segurança**, role até o fim e clique em **Abrir Mesmo Assim**.
> Isso só é preciso uma vez.

O Mirante já aparece em **Abrir com** para `.md`, `.mmd` e `.gv`. Se outro app abrir os `.md` no clique
duplo, selecione um arquivo, vá em **Arquivo → Obter Informações → Abrir com → Mirante** e clique em
**Alterar Tudo…**.

## Atalhos

| Geral | | Mapa mental | |
| --- | --- | --- | --- |
| <kbd>Ctrl</kbd> <kbd>O</kbd> | Abrir arquivo | Clique | Selecionar nó |
| <kbd>Ctrl</kbd> <kbd>S</kbd> | Salvar | Duplo clique, <kbd>F2</kbd> | Renomear |
| <kbd>Ctrl</kbd> <kbd>E</kbd> | Mostrar o código | <kbd>Tab</kbd> | Adicionar filho |
| <kbd>Ctrl</kbd> <kbd>F</kbd> | Buscar no texto | <kbd>Enter</kbd> | Adicionar irmão |
| <kbd>Ctrl</kbd> <kbd>D</kbd> | Tema claro / escuro | <kbd>Delete</kbd> | Excluir nó e filhos |
| <kbd>F5</kbd> | Recarregar do disco | Setas | Navegar entre nós |
| <kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> | Desfazer / refazer | <kbd>Alt</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Mover entre irmãos |
| <kbd>Ctrl</kbd> <kbd>=</kbd> <kbd>−</kbd> <kbd>0</kbd> | Zoom | Arrastar nó sobre outro | Mudar de pai |
| <kbd>Ctrl</kbd> <kbd>1</kbd> | Ajustar à janela | Arrastar o fundo, roda | Mover o diagrama |
| <kbd>Ctrl</kbd> <kbd>P</kbd> | Imprimir / PDF | <kbd>Ctrl</kbd> + roda, pinça | Zoom |
| <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>E</kbd> | Exportar SVG | | |
| <kbd>Ctrl</kbd> <kbd>N</kbd> / <kbd>Ctrl</kbd> <kbd>W</kbd> | Nova janela / fechar | | |

A lista completa fica em <kbd>F1</kbd> dentro do app.

## Exemplos

A pasta [`exemplos/`](exemplos) tem um arquivo de cada tipo para experimentar:

| Arquivo | O que mostra |
| --- | --- |
| [`bem-vindo.md`](exemplos/bem-vindo.md) | Markdown com tabela, tarefas, código e um fluxograma no meio do texto |
| [`mapa-mental.mmd`](exemplos/mapa-mental.mmd) | Mapa mental para testar layouts, arrastar nós e editar |
| [`fluxograma.mmd`](exemplos/fluxograma.mmd) | Fluxograma com decisões e subgrupo |
| [`sequencia.mmd`](exemplos/sequencia.mmd) | Diagrama de sequência |
| [`arquitetura.gv`](exemplos/arquitetura.gv) | Grafo Graphviz com subgrupo e rótulos nas setas |

## Como funciona

O Mirante é feito com [Tauri 2](https://tauri.app): uma camada nativa pequena em Rust e uma página web que
desenha tudo. No Windows a página roda no WebView2 (o motor do Edge, que já vem no sistema); no Linux, no
WebKitGTK; no Mac, no WebKit do Safari. Por isso o instalador tem poucos megabytes.

| Pasta / arquivo | Papel |
| --- | --- |
| `src-tauri/src/main.rs` | Janelas e menus, abrir/salvar, acompanhar o arquivo no disco, instância única, diálogos, idioma |
| `src-tauri/src/settings.rs` | Preferências e arquivos recentes |
| `src-tauri/src/hardware.rs` | Escolha do modo de renderização pela placa de vídeo |
| `web/viewer.html`, `viewer.js`, `viewer.css` | A página: Markdown, diagramas, editor, busca, zoom, animações e os textos em inglês |
| `web/mindmap.js` | Motor do mapa mental: leitura da sintaxe, layouts, desenho e edição |
| `docs/index.html` | O site ([joseribamar21.github.io/mirante_md_mmd](https://joseribamar21.github.io/mirante_md_mmd/)); depois de editar, rode `python3 scripts/gerar-site-en.py` para gerar a versão em inglês |
| `web/vendor/` | Mermaid, Graphviz (Viz.js), marked, DOMPurify, highlight.js e a fonte Inter ([licenças](web/vendor/LICENSES.md)) |
| `packaging/` | Ícone, atalho do menu, tipo `.mmd` e metainfo do Linux |

**Traduções.** O texto em português é a própria chave: na página, `tr("Salvar")` busca a versão
inglesa no dicionário `EN` do `viewer.js`; no Rust, `tr(app, "Salvar", "Save")`. Um texto novo na
interface precisa da versão em inglês nos dois lugares em que aparecer.

As preferências e a lista de recentes (só nome e caminho de cada arquivo) ficam em
`~/.config/mirante/settings.json` no Linux, em `%APPDATA%\mirante\settings.json` no Windows e em
`~/Library/Application Support/mirante/settings.json` no Mac.

## Desenvolvimento

Precisa de [Node.js](https://nodejs.org) 18+ e [Rust](https://rustup.rs) estável. No Linux, também dos
pacotes de desenvolvimento do WebKitGTK; no Windows, das ferramentas de C++ do Visual Studio
([detalhes](https://tauri.app/start/prerequisites/)).

```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev build-essential   # só no Linux
npm install
npm run dev            # abre o app em modo de desenvolvimento
npm run build          # gera os instaladores em src-tauri/target/release/bundle/
cd src-tauri && cargo test
```

**Builds automáticos.** A cada push na `main` e em pull requests, o [CI](https://github.com/joseRibamar21/mirante_md_mmd/actions/workflows/ci.yml)
compila no Linux, no Windows e no Mac, roda os testes, instala os pacotes em sistemas limpos (Windows, macOS,
Ubuntu 22.04 e 24.04), abre o app e guarda os instaladores e capturas de tela como artefatos da execução.

**Publicar uma versão.** Atualize `version` em `src-tauri/Cargo.toml` e a seção `<releases>` em
`packaging/linux/io.github.mirante.Viewer.metainfo.xml`, faça o commit e envie uma tag com o mesmo número:

```bash
git tag v2.2.0
git push origin v2.2.0
```

O [workflow de release](.github/workflows/release.yml) confere a versão, gera os instaladores das duas
plataformas e cria a release com eles anexados.

## Próximos passos

Distribuição:

- [x] Windows
- [x] macOS (sem autenticação da Apple, por enquanto)
- [ ] Snap Store (App Center do Ubuntu)
- [ ] Microsoft Store
- [ ] Flathub
- [ ] Assinatura digital do instalador do Windows

Recursos:

- [ ] **Próximo:** modo de edição visual, no estilo do Notion: escrever direto no documento formatado,
  com `/` para inserir blocos (título, lista, tabela, citação, aviso, fórmula, diagrama), barra de formatação
  ao selecionar texto e arrastar blocos para reordenar. O arquivo continua sendo Markdown puro, e o editor de
  código segue disponível para quem prefere
- [x] LaTeX: prévia de `.tex` e exportação do Markdown para `.tex`
- [ ] Prévia no gerenciador de arquivos: miniaturas no Linux, painel de visualização do Explorer no Windows
  e Quick Look no Mac
- [x] Typst (`.typ`) compilado de verdade, offline
- [x] Bibliografia (`.bib`): abrir a lista de referências e usá-la nas citações do Markdown, do `.tex` e do `.typ`
- [x] Exportar para Word (`.docx`)
- [x] Modo apresentação: um `.md` com `---` entre as partes vira slides em tela cheia
- [x] Modelo ABNT (abnTeX2) na exportação para LaTeX: capa, folha de rosto e sumário
- [x] Compatibilidade com o Obsidian: notas de rodapé `[^1]` e links `[[assim]]`
- [ ] Notebooks Jupyter (`.ipynb`): texto, código e resultados
- [ ] Planilhas `.csv` e `.tsv` como tabela formatada

## Apoiar

O Mirante é gratuito e de código aberto. Se ele te ajuda, você pode apoiar o projeto pelo
[GitHub Sponsors](https://github.com/sponsors/joseRibamar21).

## Licença

[MIT](LICENSE) © José Ribamar. Os componentes de terceiros em `web/vendor/` mantêm as próprias
licenças, listadas em [`web/vendor/LICENSES.md`](web/vendor/LICENSES.md).
