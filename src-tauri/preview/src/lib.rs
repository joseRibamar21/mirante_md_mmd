//! Prévia do Mirante no gerenciador de arquivos.
//!
//! - Windows: uma DLL com dois componentes do Explorer — as miniaturas dos ícones e o painel de visualização
//!   (Alt+P), que mostra o documento com o próprio visualizador do Mirante num WebView2.
//! - Mac: uma biblioteca que a extensão de miniaturas do Quick Look chama para desenhar os ícones do Finder.
//!
//! O desenho das miniaturas e o compilador do Typst são os mesmos do app (os arquivos são compartilhados).

#![allow(dead_code)]

#[path = "../../src/thumbnail.rs"]
pub mod thumbnail;
#[path = "../../src/typst_doc.rs"]
pub mod typst_doc;

#[cfg(windows)]
pub mod shell;

use std::ffi::{CStr, c_char};
use std::path::Path;

/// Miniatura de um arquivo em pixels RGBA (pré-multiplicados, linha a linha). Devolve null se não der;
/// quem chama devolve o buffer com `mirante_free`. Usada pela extensão de miniaturas do Quick Look.
///
/// # Safety
/// `path` precisa ser uma string C válida; os ponteiros de saída, endereços válidos.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mirante_thumbnail(path: *const c_char, size: u32, out_w: *mut u32, out_h: *mut u32, out_len: *mut usize) -> *mut u8 {
    if path.is_null() || out_w.is_null() || out_h.is_null() || out_len.is_null() {
        return std::ptr::null_mut();
    }
    let Ok(path) = (unsafe { CStr::from_ptr(path) }).to_str() else { return std::ptr::null_mut() };
    let path = Path::new(path);
    let Some(pix) = read_text(path).and_then(|text| thumbnail::image(&text, thumbnail::kind_of(path), Some(path), size.clamp(16, 1024)).ok()) else {
        return std::ptr::null_mut();
    };
    let (w, h) = (pix.width(), pix.height());
    let mut data = pix.take().into_boxed_slice();
    unsafe {
        *out_w = w;
        *out_h = h;
        *out_len = data.len();
    }
    let ptr = data.as_mut_ptr();
    std::mem::forget(data);
    ptr
}

/// Devolve o buffer de `mirante_thumbnail`.
///
/// # Safety
/// `ptr` e `len` precisam ser exatamente o que `mirante_thumbnail` devolveu.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mirante_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
    }
}

/// O começo do arquivo, como texto (uma miniatura não precisa do resto).
pub fn read_text(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = Vec::new();
    std::fs::File::open(path).ok()?.take(512 * 1024).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// O tipo que o visualizador do Mirante entende, pela extensão (o mesmo que o app usa ao abrir).
pub fn viewer_kind(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("mmd" | "mermaid") => "mmd",
        Some("gv" | "dot") => "dot",
        Some("tex" | "latex" | "ltx") => "tex",
        Some("typ") => "typ",
        Some("bib") => "bib",
        Some("txt" | "text") => "txt",
        _ => "md",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn miniatura_pela_interface_c() {
        let ex = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../exemplos/fluxograma.mmd");
        let c = CString::new(ex.to_str().unwrap()).unwrap();
        let (mut w, mut h, mut len) = (0u32, 0u32, 0usize);
        let p = unsafe { mirante_thumbnail(c.as_ptr(), 128, &mut w, &mut h, &mut len) };
        assert!(!p.is_null());
        assert_eq!((w, h, len), (96, 128, 96 * 128 * 4));
        unsafe { mirante_free(p, len) };
    }
}
