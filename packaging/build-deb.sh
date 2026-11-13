#!/usr/bin/env bash
# Gera o pacote .deb do Mirante em dist/.
#   packaging/build-deb.sh            versão do APP_VERSION em mirante/mirante.py
#   packaging/build-deb.sh 2.1.0      versão explícita (o "v" inicial de uma tag é ignorado)
# Depende só de dpkg-deb. Os gatilhos do dpkg atualizam o menu de apps, os ícones e os tipos de
# arquivo sozinhos, então o pacote não precisa de scripts de instalação.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/mirante"
VERSION="${1:-$(sed -n 's/^APP_VERSION = "\(.*\)"/\1/p' "$APP/mirante.py")}"
VERSION="${VERSION#v}"
ID="io.github.mirante.Viewer"
PKG="$ROOT/build/deb/mirante_${VERSION}_all"
OUT="$ROOT/dist"

rm -rf "$PKG"
install -d "$PKG/DEBIAN" "$PKG/usr/bin" "$PKG/usr/share/mirante" "$PKG/usr/share/applications" \
  "$PKG/usr/share/metainfo" "$PKG/usr/share/icons/hicolor/scalable/apps" "$PKG/usr/share/mime/packages" \
  "$PKG/usr/share/doc/mirante" "$OUT"

cp -r "$APP/mirante.py" "$APP/viewer.html" "$APP/viewer.css" "$APP/viewer.js" "$APP/mindmap.js" \
  "$APP/worker.html" "$APP/vendor" "$PKG/usr/share/mirante/"
chmod 755 "$PKG/usr/share/mirante/mirante.py"
ln -s ../share/mirante/mirante.py "$PKG/usr/bin/mirante"

install -m 644 "$APP/data/$ID.desktop" "$PKG/usr/share/applications/$ID.desktop"
install -m 644 "$APP/data/$ID.metainfo.xml" "$PKG/usr/share/metainfo/$ID.metainfo.xml"
install -m 644 "$APP/data/mirante.svg" "$PKG/usr/share/icons/hicolor/scalable/apps/mirante.svg"
install -m 644 "$APP/data/mirante-mermaid.xml" "$PKG/usr/share/mime/packages/mirante-mermaid.xml"
install -m 644 "$ROOT/LICENSE" "$PKG/usr/share/doc/mirante/copyright"
cp -r "$ROOT/exemplos" "$PKG/usr/share/doc/mirante/exemplos"
find "$PKG" -type d -exec chmod 755 {} +
find "$PKG/usr/share" -type f ! -name mirante.py -exec chmod 644 {} +

SIZE="$(du -sk "$PKG/usr" | cut -f1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: mirante
Version: $VERSION
Architecture: all
Maintainer: José Ribamar <jose.21rb@outlook.com>
Installed-Size: $SIZE
Depends: python3 (>= 3.8), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1
Section: text
Priority: optional
Homepage: https://github.com/joseRibamar21/mirante_md_mmd
Description: visualizador e editor de Markdown e diagramas Mermaid
 Abre arquivos .md e .mmd com visual limpo e atualiza sozinho quando o
 arquivo muda no disco. Mapas mentais editáveis com quatro layouts, editor
 de código ao lado com o desenho ao vivo, tema claro e escuro e exportação
 para SVG e PDF.
EOF

dpkg-deb --root-owner-group --build "$PKG" "$OUT/mirante_${VERSION}_all.deb" >/dev/null
echo "$OUT/mirante_${VERSION}_all.deb"
