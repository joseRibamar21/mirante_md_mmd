// Quick Look do Mirante: a pré-visualização da barra de espaço no Finder.
// Mostra o arquivo com o próprio visualizador do Mirante (web/viewer.html?embed, copiado para dentro da
// extensão) num WKWebView: Markdown, LaTeX, BibTeX e diagramas Mermaid e Graphviz desenhados de verdade.

import Cocoa
import Quartz
import WebKit

final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var script: String?
    private var finish: ((Error?) -> Void)?

    override func loadView() {
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 820, height: 1000), configuration: WKWebViewConfiguration())
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        webView = web
        view = web
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let ext = url.pathExtension.lowercased()
        let text = (try? String(contentsOf: url, encoding: .utf8))
            ?? (try? String(contentsOf: url, encoding: .isoLatin1)) ?? ""
        let payload: [String: Any] = [
            "kind": Self.kind(ext),
            "text": text,
            "name": url.lastPathComponent,
            "base": url.deletingLastPathComponent().absoluteString,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8),
              let web = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            handler(CocoaError(.fileReadUnknown))
            return
        }
        script = "mirante.preview(\(json))"
        finish = handler
        var page = URLComponents(url: web.appendingPathComponent("viewer.html"), resolvingAgainstBaseURL: false)!
        page.query = "embed"
        NSLog("Mirante: abrindo %@ para %@", page.url!.path, url.lastPathComponent)
        webView.loadFileURL(page.url!, allowingReadAccessTo: web)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let js = script else { return }
        script = nil
        webView.evaluateJavaScript(js) { _, error in
            if let error { NSLog("Mirante: erro no mirante.preview: %@", String(describing: error)) }
        }
        // o desenho (fórmulas, diagramas) termina logo depois; o Quick Look já pode mostrar
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.finish?(nil)
            self?.finish = nil
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail(CocoaError(.fileReadUnknown))
    }

    /// Sem isto o Quick Look esperaria até desistir; com o erro, ele mostra a prévia genérica na hora.
    private func fail(_ error: Error) {
        NSLog("Mirante: a página não carregou: %@", String(describing: error))
        finish?(error)
        finish = nil
    }

    /// O tipo que o visualizador entende. O Typst precisa do compilador, que não cabe aqui: vai como texto.
    private static func kind(_ ext: String) -> String {
        switch ext {
        case "mmd", "mermaid": return "mmd"
        case "gv", "dot": return "dot"
        case "tex", "latex", "ltx": return "tex"
        case "bib": return "bib"
        case "typ", "txt": return "txt"
        default: return "md"
        }
    }
}
