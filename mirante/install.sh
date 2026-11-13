#!/usr/bin/env bash
# Instala o Mirante para o usuário atual (sem sudo).
#   ./install.sh            instala e define como app padrão para .md e .mmd
#   ./install.sh --no-default   instala sem mudar o app padrão
#   ./install.sh --uninstall    remove tudo
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA/mirante"
BIN="$HOME/.local/bin"
DESKTOP="$DATA/applications/io.github.mirante.Viewer.desktop"
ICON="$DATA/icons/hicolor/scalable/apps/mirante.svg"
MIMEXML="$DATA/mime/packages/mirante-mermaid.xml"
MD_TYPES="text/markdown text/x-markdown"
MMD_TYPES="text/vnd.mermaid"

refresh() {
  update-mime-database "$DATA/mime" >/dev/null 2>&1 || true
  update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
  gtk-update-icon-cache -q -t "$DATA/icons/hicolor" >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -rf "$DEST" "$BIN/mirante" "$DESKTOP" "$ICON" "$MIMEXML"
  refresh
  echo "Mirante removido."
  exit 0
fi

python3 - <<'EOF'
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2
EOF

mkdir -p "$DEST" "$BIN" "$(dirname "$DESKTOP")" "$(dirname "$ICON")" "$(dirname "$MIMEXML")"
rm -rf "$DEST"/*
cp -r "$SRC/mirante.py" "$SRC/viewer.html" "$SRC/viewer.css" "$SRC/viewer.js" "$SRC/mindmap.js" "$SRC/worker.html" "$SRC/vendor" "$DEST/"
chmod +x "$DEST/mirante.py"
ln -sf "$DEST/mirante.py" "$BIN/mirante"
cp "$SRC/data/mirante.svg" "$ICON"
cp "$SRC/data/mirante-mermaid.xml" "$MIMEXML"

# caminho completo no Exec: ~/.local/bin nem sempre está no PATH do menu de apps
sed "s|^Exec=.*|Exec=$BIN/mirante %U|" "$SRC/data/io.github.mirante.Viewer.desktop" > "$DESKTOP"

refresh

if [[ "${1:-}" != "--no-default" ]]; then
  for t in $MD_TYPES $MMD_TYPES; do
    xdg-mime default io.github.mirante.Viewer.desktop "$t"
  done
  echo "Mirante definido como app padrão para .md e .mmd."
fi

echo "Instalado em $DEST"
echo "Execute: mirante arquivo.md   (ou procure \"Mirante\" no menu de apps)"
