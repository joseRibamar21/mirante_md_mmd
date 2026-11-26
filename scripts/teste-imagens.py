#!/usr/bin/env python3
"""Monta uma pasta de teste com um .md que usa imagens de todos os jeitos (usado pela CI).

Uso:  python3 scripts/teste-imagens.py <pasta>   (imprime o caminho do .md)
"""
import shutil
import sys
from pathlib import Path

ICONE = Path(__file__).resolve().parent.parent / "docs" / "assets" / "favicon.png"


def main() -> int:
    pasta = Path(sys.argv[1]).resolve()
    sub = pasta / "fotos da aula"
    sub.mkdir(parents=True, exist_ok=True)
    for nome in ("relativa.png", "absoluta.png", "file.png", "html.png"):
        shutil.copy(ICONE, sub / nome)
    shutil.copy(ICONE, pasta / "mesma-pasta.png")
    absoluta = (sub / "absoluta.png").as_posix()
    md = f"""# Imagens

| Jeito | Imagem |
| --- | --- |
| Mesma pasta | ![](mesma-pasta.png) |
| Subpasta com espaço | ![](<fotos da aula/relativa.png>) |
| Caminho absoluto | ![](<{absoluta}>) |
| file:// | ![]({(sub / "file.png").as_uri()}) |
| HTML absoluto | <img src="{sub / "html.png"}"> |
| Internet | ![](https://raw.githubusercontent.com/joseRibamar21/mirante_md_mmd/main/docs/assets/favicon.png) |
"""
    arquivo = pasta / "imagens.md"
    arquivo.write_text(md, encoding="utf-8")
    print(arquivo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
