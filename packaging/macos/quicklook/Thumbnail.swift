// Quick Look do Mirante: as miniaturas dos ícones no Finder.
// Quem desenha é a biblioteca em Rust (mirante_preview), a mesma das miniaturas do Linux e do Windows:
// a página com títulos, listas e fórmulas, o diagrama, ou a primeira página do Typst compilada.

import AppKit
import QuickLookThumbnailing

final class ThumbnailProvider: QLThumbnailProvider {
    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        let side = max(request.maximumSize.width, request.maximumSize.height) * request.scale
        var w: UInt32 = 0, h: UInt32 = 0, len = 0
        let pixels = request.fileURL.path.withCString { mirante_thumbnail($0, UInt32(min(side, 1024)), &w, &h, &len) }
        guard let pixels else {
            handler(nil, CocoaError(.fileReadUnknown))
            return
        }
        let data = Data(bytes: pixels, count: len)
        mirante_free(pixels, len)
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: Int(w), height: Int(h), bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: Int(w) * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else {
            handler(nil, CocoaError(.fileReadUnknown))
            return
        }
        // a página é em retrato: dentro do tamanho pedido, mantendo a proporção
        let scale = min(request.maximumSize.width / CGFloat(w), request.maximumSize.height / CGFloat(h))
        let size = CGSize(width: CGFloat(w) * scale, height: CGFloat(h) * scale)
        handler(QLThumbnailReply(contextSize: size) { context in
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(origin: .zero, size: size))
            return true
        }, nil)
    }
}
