#!/usr/bin/env python3
"""Gera docs/en/index.html (versão em inglês do site) a partir de docs/index.html.

A página tem os textos nos dois idiomas; aqui só muda o idioma padrão, os metadados e os caminhos.
Rode depois de editar docs/index.html:  python3 scripts/gerar-site-en.py
"""
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
URL = "https://joseribamar21.github.io/mirante_md_mmd/"

TROCAS = [
    ('<html lang="pt-BR" data-lang="pt">', '<html lang="en" data-lang="en">'),
    (
        "<title>Mirante — visualizador e editor de Markdown, Mermaid e Graphviz grátis</title>",
        "<title>Mirante — free Markdown, Mermaid and Graphviz viewer and editor</title>",
    ),
    (
        'content="Mirante é um visualizador e editor grátis de Markdown, diagramas Mermaid (fluxogramas, mapas mentais) e Graphviz para Windows, macOS e Linux, com edição ao vivo e atualização automática."',
        'content="Mirante is a free Markdown, Mermaid (flowcharts, mind maps) and Graphviz viewer and editor for Windows, macOS and Linux, with live editing and automatic reload."',
    ),
    (f'<link rel="canonical" href="{URL}">', f'<link rel="canonical" href="{URL}en/">'),
    (
        'content="Mirante — visualizador e editor de Markdown, Mermaid e Graphviz"',
        'content="Mirante — Markdown, Mermaid and Graphviz viewer and editor"',
    ),
    (
        'content="Visualizador e editor grátis de Markdown, mapas mentais e diagramas para Windows, macOS e Linux."',
        'content="Free Markdown, mind map and diagram viewer and editor for Windows, macOS and Linux."',
    ),
    (f'<meta property="og:url" content="{URL}">', f'<meta property="og:url" content="{URL}en/">'),
    ('<meta property="og:locale" content="pt_BR">', '<meta property="og:locale" content="en_US">'),
    ('<meta property="og:locale:alternate" content="en_US">', '<meta property="og:locale:alternate" content="pt_BR">'),
    (
        '"description": "Visualizador e editor grátis de Markdown, diagramas Mermaid e Graphviz e mapas mentais, com edição ao vivo."',
        '"description": "Free Markdown, Mermaid, Graphviz and mind map viewer and editor, with live editing."',
    ),
    (f'"url": "{URL}",', f'"url": "{URL}en/",'),
    ('"priceCurrency": "BRL"', '"priceCurrency": "USD"'),
    (
        '<a class="pill-btn" id="lang-link" href="en/" hreflang="en" title="English">EN</a>',
        '<a class="pill-btn" id="lang-link" href="../" hreflang="pt-BR" title="Português">PT</a>',
    ),
]


def main() -> int:
    html = (DOCS / "index.html").read_text(encoding="utf-8")
    for old, new in TROCAS:
        if html.count(old) != 1:
            print(f"não achei (ou achei mais de uma vez) em docs/index.html:\n  {old[:90]}", file=sys.stderr)
            return 1
        html = html.replace(old, new)
    # arquivos da pasta docs/ ficam um nível acima
    html = re.sub(r'\b(href|src|poster)="(assets|capturas|loja)/', r'\1="../\2/', html)
    html = html.replace('href="privacidade.html"', 'href="../privacidade.html"')
    html = html.replace('href="ia/', 'href="../ia/').replace('"ia/prompts.json"', '"../ia/prompts.json"')
    html = re.sub(r'url\("(assets|capturas|loja)/', r'url("../\1/', html)  # fontes no CSS
    aviso = "<!-- Gerado por scripts/gerar-site-en.py a partir de docs/index.html: edite lá e rode o script. -->\n"
    out = DOCS / "en" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html.replace("<!doctype html>\n", "<!doctype html>\n" + aviso, 1), encoding="utf-8")
    print(f"gerado {out.relative_to(DOCS.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
