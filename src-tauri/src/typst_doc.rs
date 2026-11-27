//! Documentos Typst (`.typ`), compilados de verdade pelo próprio compilador do Typst, dentro do app.
//!
//! Ao contrário do `.tex` (uma prévia aproximada feita em JavaScript), aqui o resultado é o mesmo do
//! `typst compile`: as páginas saem em SVG para a tela e em PDF na exportação. Tudo offline, com as
//! fontes embutidas do Typst e as do sistema. A rede só é usada quando o documento importa um pacote
//! `@preview/…` que ainda não está no cache (o mesmo cache do Typst de linha de comando).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use typst::diag::{FileResult, Severity, SourceDiagnostic};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World, WorldExt};
use typst_kit::datetime::Time;
use typst_kit::downloader::SystemDownloader;
use typst_kit::files::{FileLoader, FileStore, FsRoot, SystemFiles};
use typst_kit::fonts::FontStore;
use typst_kit::packages::SystemPackages;
use typst_layout::PagedDocument;

/// O arquivo principal vem do editor (o texto que está na tela, salvo ou não); o resto, do disco.
struct Loader {
    files: SystemFiles,
    main: FileId,
    text: String,
}

impl FileLoader for Loader {
    fn load(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main {
            return Ok(Bytes::from_string(self.text.clone()));
        }
        self.files.load(id)
    }
}

/// Fontes embutidas do Typst (Libertinus, New Computer Modern, DejaVu Sans Mono) e as do sistema.
/// Procurar as do sistema leva um tempo: é feito uma vez por processo.
fn fonts() -> &'static FontStore {
    static FONTS: OnceLock<FontStore> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut store = FontStore::new();
        store.extend(typst_kit::fonts::embedded());
        store.extend(typst_kit::fonts::system());
        store
    })
}

fn library() -> &'static LazyHash<Library> {
    static LIB: OnceLock<LazyHash<Library>> = OnceLock::new();
    LIB.get_or_init(|| LazyHash::new(Library::default()))
}

pub struct Doc {
    store: FileStore<Loader>,
    main: FileId,
    time: Time,
}

impl Doc {
    fn new(path: &Path) -> Result<Self, String> {
        let root = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("arquivo sem nome")?;
        let vpath = VirtualPath::new(format!("/{name}")).map_err(|e| format!("{e:?}"))?;
        let main = FileId::new(RootedPath::new(VirtualRoot::Project, vpath));
        let user_agent = concat!("mirante/", env!("CARGO_PKG_VERSION"));
        let packages = SystemPackages::new(SystemDownloader::new(user_agent));
        let files = SystemFiles::new(FsRoot::new(root), packages);
        Ok(Doc { store: FileStore::new(Loader { files, main, text: String::new() }), main, time: Time::system() })
    }
}

impl World for Doc {
    fn library(&self) -> &LazyHash<Library> {
        library()
    }
    fn book(&self) -> &LazyHash<FontBook> {
        fonts().book()
    }
    fn main(&self) -> FileId {
        self.main
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        self.store.source(id)
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.store.file(id)
    }
    fn font(&self, index: usize) -> Option<Font> {
        fonts().font(index)
    }
    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        self.time.today(offset)
    }
}

/// Um documento por arquivo: reaproveitar o mesmo `Doc` deixa a recompilação incremental (rápida).
fn docs() -> &'static Mutex<HashMap<PathBuf, Doc>> {
    static DOCS: OnceLock<Mutex<HashMap<PathBuf, Doc>>> = OnceLock::new();
    DOCS.get_or_init(Default::default)
}

fn compile_doc(path: &Path, text: String) -> Result<(PagedDocument, Vec<Value>), Vec<Value>> {
    let mut all = docs().lock().unwrap();
    if !all.contains_key(path) {
        let doc = Doc::new(path).map_err(|e| vec![json!({ "message": e })])?;
        all.insert(path.to_path_buf(), doc);
    }
    let doc = all.get_mut(path).unwrap();
    // os outros arquivos (imagens, #include) podem ter mudado no disco: tudo é relido, o texto vem do editor
    doc.store.reset();
    doc.store.loader_mut().text = text;
    let result = typst::compile::<PagedDocument>(&*doc);
    let warnings: Vec<Value> = result.warnings.iter().map(|d| diag(&*doc, d)).collect();
    let out = match result.output {
        Ok(document) => Ok((document, warnings)),
        Err(errors) => Err(errors.iter().map(|d| diag(&*doc, d)).collect()),
    };
    comemo::evict(10);
    out
}

/// Uma mensagem do compilador com arquivo, linha e coluna (contadas de 1), para a página mostrar.
fn diag(world: &Doc, d: &SourceDiagnostic) -> Value {
    let mut file = String::new();
    let (mut line, mut col) = (0usize, 0usize);
    if let (Some(id), Some(range)) = (d.span.id(), world.range(d.span)) {
        if id != world.main {
            file = id.vpath().get_without_slash().to_string();
            if let VirtualRoot::Package(p) = id.root() {
                file = format!("{p}/{file}");
            }
        }
        if let Ok(src) = world.source(id) {
            if let Some((l, c)) = src.lines().byte_to_line_column(range.start) {
                (line, col) = (l + 1, c + 1);
            }
        }
    }
    json!({
        "error": d.severity == Severity::Error,
        "message": d.message.as_str(),
        "hints": d.hints.iter().map(|h| h.v.as_str()).collect::<Vec<_>>(),
        "file": file,
        "line": line,
        "col": col,
    })
}

/// Compila o texto do editor e devolve `{pages: [svg…], warnings}` ou `{errors}`.
pub fn render(path: &Path, text: String) -> Value {
    match compile_doc(path, text) {
        Ok((document, warnings)) => {
            let opts = typst_svg::SvgOptions::default();
            let pages: Vec<String> = document.pages().iter().map(|p| typst_svg::svg(p, &opts)).collect();
            json!({ "pages": pages, "warnings": warnings })
        }
        Err(errors) => json!({ "errors": errors }),
    }
}

/// O PDF final, igual ao do `typst compile`.
pub fn pdf(path: &Path, text: String) -> Result<Vec<u8>, String> {
    let (document, _) = compile_doc(path, text).map_err(|errors| {
        errors
            .iter()
            .map(|e| {
                let at = if e["line"].as_u64().unwrap_or(0) > 0 { format!(" (linha {})", e["line"]) } else { String::new() };
                format!("{}{at}", e["message"].as_str().unwrap_or_default())
            })
            .collect::<Vec<_>>()
            .join("\n")
    })?;
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default())
        .map_err(|errors| errors.iter().map(|e| e.message.to_string()).collect::<Vec<_>>().join("\n"))
}

/// Esquece o documento (janela fechada ou outro arquivo aberto): libera a memória das compilações.
pub fn forget(path: &Path) {
    docs().lock().unwrap().remove(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str, text: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mirante-typst-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn compila_paginas_e_aponta_erros() {
        let p = tmp("ok.typ", "");
        let v = render(&p, "= Título\n\nOlá, $x^2 + 1$.\n#pagebreak()\nSegunda página.".into());
        let pages = v["pages"].as_array().expect("páginas");
        assert_eq!(pages.len(), 2);
        assert!(pages[0].as_str().unwrap().starts_with("<svg"));

        // o texto do editor vale mais que o do disco; o erro vem com linha e coluna
        let v = render(&p, "Linha um\n#nao_existe()".into());
        let e = &v["errors"][0];
        assert_eq!(e["line"], 2);
        assert!(e["message"].as_str().unwrap().contains("nao_existe"));

        let pdf = pdf(&p, "Oi".into()).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn le_arquivos_ao_lado() {
        let p = tmp("main.typ", "");
        std::fs::write(p.with_file_name("parte.typ"), "Texto da parte").unwrap();
        let v = render(&p, "#include \"parte.typ\"".into());
        assert_eq!(v["pages"].as_array().map(Vec::len), Some(1));
    }
}

