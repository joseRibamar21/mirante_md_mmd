#!/bin/bash
# Gera as extensões do Quick Look do Mirante (pré-visualização e miniaturas), universais (Apple Silicon e
# Intel), em src-tauri/target/quicklook/. O tauri.macos.conf.json as copia para Mirante.app/Contents/PlugIns.
# Rode num Mac antes do `npx tauri build`.
set -euo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$PWD
QL=$ROOT/packaging/macos/quicklook
OUT=$ROOT/src-tauri/target/quicklook
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
export MACOSX_DEPLOYMENT_TARGET=10.15
rm -rf "$OUT"
mkdir -p "$OUT/obj"

# a biblioteca em Rust que desenha as miniaturas
(cd src-tauri && for t in aarch64-apple-darwin x86_64-apple-darwin; do cargo build --release -p mirante-preview --target "$t"; done)
lipo -create src-tauri/target/aarch64-apple-darwin/release/libmirante_preview.a \
  src-tauri/target/x86_64-apple-darwin/release/libmirante_preview.a -output "$OUT/obj/libmirante_preview.a"

# appex <nome> <ponto de extensão> <classe> <chaves próprias do NSExtensionAttributes> <fonte> [opções do swiftc...]
appex() {
  local name=$1 point=$2 class=$3 attrs=$4 src=$5
  shift 5
  local dir="$OUT/$name.appex/Contents"
  mkdir -p "$dir/MacOS" "$dir/Resources"
  for arch in arm64 x86_64; do
    swiftc -O -target "$arch-apple-macos10.15" -module-name "$name" -parse-as-library -application-extension \
      "$src" -o "$OUT/obj/$name-$arch" -Xlinker -e -Xlinker _NSExtensionMain "$@"
  done
  lipo -create "$OUT/obj/$name-arm64" "$OUT/obj/$name-x86_64" -output "$dir/MacOS/$name"
  sed -e "s/@NAME@/$name/g" -e "s/@POINT@/$point/g" -e "s/@CLASS@/$class/g" -e "s/@VERSION@/$VERSION/g" \
    -e "s|@ATTRS@|      $attrs|" "$QL/Info.plist.in" > "$dir/Info.plist"
  plutil -lint "$dir/Info.plist"
}

# as chaves de cada uma seguem os modelos de extensão do Xcode
appex MirantePreview com.apple.quicklook.preview PreviewViewController \
  '<key>QLIsDataBasedPreview</key><false/><key>QLSupportsSearchableItems</key><false/>' "$QL/Preview.swift" \
  -framework Cocoa -framework Quartz -framework WebKit
# o visualizador do Mirante vai dentro da extensão
cp -R web "$OUT/MirantePreview.appex/Contents/Resources/web"

appex MiranteThumbnail com.apple.quicklook.thumbnail ThumbnailProvider \
  '<key>QLThumbnailMinimumDimension</key><integer>0</integer>' "$QL/Thumbnail.swift" \
  -import-objc-header "$QL/mirante.h" -L "$OUT/obj" -lmirante_preview \
  -framework QuickLookThumbnailing -framework AppKit -framework Security -framework SystemConfiguration -framework CoreFoundation

# assinatura local (a mesma do app, sem conta de desenvolvedor), com o isolamento que o Quick Look exige
for x in MirantePreview MiranteThumbnail; do
  codesign --force -s - --entitlements "$QL/extension.entitlements" "$OUT/$x.appex"
done
ls -la "$OUT"
