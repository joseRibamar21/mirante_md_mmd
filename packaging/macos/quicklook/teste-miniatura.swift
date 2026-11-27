// Teste do CI no macOS: pede as miniaturas como o Finder pede (QLThumbnailGenerator, que usa as extensões
// instaladas) e salva cada uma em PNG. O `qlmanage -t` não serve: ele ainda usa o caminho antigo e devolve a
// miniatura genérica de texto.
//
// uso: swift teste-miniatura.swift <pasta de saída> <arquivo>...
// Sai com erro se alguma miniatura não vier. Se é a do Mirante (página com o selo do tipo no canto) ou a
// genérica de texto do sistema, só olhando as imagens: as duas chegam como "thumbnail".

import AppKit
import QuickLookThumbnailing

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    print("uso: swift teste-miniatura.swift <pasta de saída> <arquivo>...")
    exit(2)
}
let out = URL(fileURLWithPath: args[0], isDirectory: true)
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
var falhas = 0

for path in args.dropFirst() {
    let url = URL(fileURLWithPath: path)
    let request = QLThumbnailGenerator.Request(fileAt: url, size: CGSize(width: 256, height: 256), scale: 2,
                                               representationTypes: .thumbnail)
    let done = DispatchSemaphore(value: 0)
    QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { rep, error in
        defer { done.signal() }
        guard let rep else {
            print("miniatura FALHOU \(url.lastPathComponent): \(error.map { String(describing: $0) } ?? "sem imagem")")
            falhas += 1
            return
        }
        let image = rep.cgImage
        let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        try? png?.write(to: out.appendingPathComponent("miniatura-\(url.lastPathComponent).png"))
        print("miniatura OK \(url.lastPathComponent) (\(image.width)x\(image.height))")
    }
    if done.wait(timeout: .now() + 60) == .timedOut {
        print("miniatura FALHOU \(url.lastPathComponent): sem resposta em 60 s")
        falhas += 1
    }
}
exit(falhas == 0 ? 0 : 1)
