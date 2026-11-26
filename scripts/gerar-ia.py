#!/usr/bin/env python3
"""Gera web/prompts.js (prompts e guia de formato para IAs, usados pelo app) a partir de docs/ia/.

Fonte única: docs/ia/prompts.json, docs/ia/guia.md e docs/ia/guide.md (o site também usa esses arquivos).
Rode depois de editar:  python3 scripts/gerar-ia.py
Com --check, só confere se web/prompts.js está em dia (para a CI).
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
IA = RAIZ / "docs" / "ia"
SAIDA = RAIZ / "web" / "prompts.js"


def gerar() -> str:
    dados = json.loads((IA / "prompts.json").read_text(encoding="utf-8"))
    dados.pop("_comentario", None)
    dados["guide"] = {
        "pt": (IA / "guia.md").read_text(encoding="utf-8"),
        "en": (IA / "guide.md").read_text(encoding="utf-8"),
    }
    corpo = json.dumps(dados, ensure_ascii=False, indent=1)
    return (
        "/* Gerado por scripts/gerar-ia.py a partir de docs/ia/: edite lá e rode o script. */\n"
        f"window.MIRANTE_PROMPTS = {corpo};\n"
    )


def main() -> int:
    novo = gerar()
    if "--check" in sys.argv:
        if not SAIDA.exists() or SAIDA.read_text(encoding="utf-8") != novo:
            print("web/prompts.js está desatualizado: rode python3 scripts/gerar-ia.py", file=sys.stderr)
            return 1
        print("web/prompts.js em dia")
        return 0
    SAIDA.write_text(novo, encoding="utf-8")
    print(f"gerado {SAIDA.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
