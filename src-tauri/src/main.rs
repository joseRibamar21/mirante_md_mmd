//! Mirante — camada nativa (Tauri). A página web (web/viewer.html) desenha tudo; aqui ficam as
//! janelas, os menus, os arquivos (abrir, salvar, acompanhar mudanças), as preferências e a ponte:
//! a página chama o comando `page_message` com JSON; o app responde chamando `window.mirante.*`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod settings;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use serde_json::{json, Value};
use settings::{file_name, Settings};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::window::Color;
use tauri::{AppHandle, DragDropEvent, Manager, Theme, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;

const APP_NAME: &str = "Mirante";
const MD_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
const TXT_EXT: &[&str] = &["txt", "text"];
const MMD_EXT: &[&str] = &["mmd", "mermaid"];
const DOT_EXT: &[&str] = &["gv", "dot"];
const EDITOR_SUFFIX: &str = "-editor";

/// Um documento aberto: uma janela principal.
#[derive(Default)]
struct Doc {
    path: Option<PathBuf>,
    dirty: bool,
    last_text: Option<String>, // conteúdo que sabemos estar no disco
    ready: bool,
    pending: Option<Value>, // render() que chegou antes da página ficar pronta
    watcher: Option<RecommendedWatcher>,
    reload_generation: u64,
    editor_text: Option<String>, // texto inicial da janela de código separada
    block: Option<(String, usize)>, // janela que mostra só um diagrama de um .md: (janela do .md, nº do bloco)
}

type Reply = Box<dyn FnOnce(&AppHandle, Value) + Send>;

struct State {
    settings: Mutex<Settings>,
    docs: Mutex<HashMap<String, Doc>>,
    dark: Mutex<bool>,
    replies: Mutex<HashMap<u64, Reply>>,
    seq: AtomicU64,
}

fn state(app: &AppHandle) -> tauri::State<'_, State> {
    app.state::<State>()
}

fn with_doc<T>(app: &AppHandle, label: &str, f: impl FnOnce(&mut Doc) -> T) -> Option<T> {
    state(app).docs.lock().unwrap().get_mut(label).map(f)
}

fn doc_path(app: &AppHandle, label: &str) -> Option<PathBuf> {
    with_doc(app, label, |d| d.path.clone()).flatten()
}

fn block_of(app: &AppHandle, label: &str) -> Option<(String, usize)> {
    with_doc(app, label, |d| d.block.clone()).flatten()
}

/// Quem guarda o arquivo: a própria janela ou, no diagrama de um .md, a janela do .md.
fn owner(app: &AppHandle, label: &str) -> String {
    block_of(app, label).map(|(p, _)| p).unwrap_or_else(|| label.to_string())
}

fn file_of(app: &AppHandle, label: &str) -> Option<PathBuf> {
    doc_path(app, &owner(app, label))
}

/// Janelas abertas com diagramas do .md desta janela.
fn block_children(app: &AppHandle, parent: &str) -> Vec<(String, usize)> {
    state(app)
        .docs
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(l, d)| d.block.as_ref().filter(|(p, _)| p == parent).map(|(_, i)| (l.clone(), *i)))
        .collect()
}

/// Chave das preferências do diagrama (layout, espaçamento) dentro do .md.
fn block_key(path: &Path, index: usize) -> String {
    format!("{}#diagrama-{}", path.to_string_lossy(), index + 1)
}

// ---------------------------------------------------------------- idioma

#[derive(Clone, Copy, PartialEq, Debug)]
enum Lang {
    Pt,
    En,
}

impl Lang {
    fn code(self) -> &'static str {
        match self {
            Lang::Pt => "pt",
            Lang::En => "en",
        }
    }
}

/// Português quando o sistema está em português; qualquer outro idioma fica com o inglês.
fn lang_from_locale(locale: &str) -> Lang {
    let first = locale.split(':').next().unwrap_or_default().trim().to_ascii_lowercase();
    if first.starts_with("pt") { Lang::Pt } else { Lang::En }
}

fn system_lang() -> Lang {
    static CACHE: OnceLock<Lang> = OnceLock::new();
    *CACHE.get_or_init(|| {
        #[cfg(windows)]
        {
            // idioma da interface do Windows (LANGID); o idioma primário 0x16 é o português
            let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
            if id & 0x3ff == 0x16 { Lang::Pt } else { Lang::En }
        }
        #[cfg(not(windows))]
        {
            // a mesma ordem do gettext; LANGUAGE pode ser uma lista ("pt_BR:pt:en")
            let locale = ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]
                .iter()
                .filter_map(|v| std::env::var(v).ok())
                .find(|s| !s.is_empty())
                .unwrap_or_default();
            lang_from_locale(&locale)
        }
    })
}

/// O idioma escolhido em Exibir → Idioma, ou o do sistema.
fn lang(app: &AppHandle) -> Lang {
    match state(app).settings.lock().unwrap().language() {
        Some("pt") => Lang::Pt,
        Some("en") => Lang::En,
        _ => system_lang(),
    }
}

/// O texto no idioma da interface: `tr(app, "Salvar", "Save")`.
fn tr(app: &AppHandle, pt: &'static str, en: &'static str) -> &'static str {
    if lang(app) == Lang::En { en } else { pt }
}

fn set_language(app: &AppHandle, choice: Option<&str>) {
    state(app).settings.lock().unwrap().set_language(choice);
    let code = lang(app).code();
    #[cfg(target_os = "macos")]
    if let Ok(menu) = build_menu(app) {
        let _ = app.set_menu(menu);
    }
    for (label, w) in app.webview_windows() {
        if !label.ends_with(EDITOR_SUFFIX) {
            #[cfg(not(target_os = "macos"))]
            if let Ok(menu) = build_menu(app) {
                let _ = w.set_menu(menu);
            }
            update_title(app, &label);
        }
        let _ = w.eval(format!("mirante.setLang({})", js_str(code)));
    }
}

// ---------------------------------------------------------------- arquivos e caminhos

fn ext_of(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_lowercase())
}

fn kind_for(path: &Path) -> &'static str {
    match ext_of(path) {
        Some(e) if MMD_EXT.contains(&e.as_str()) => "mmd",
        Some(e) if DOT_EXT.contains(&e.as_str()) => "dot",
        Some(e) if TXT_EXT.contains(&e.as_str()) => "txt",
        _ => "md",
    }
}

fn is_doc(path: &Path) -> bool {
    ext_of(path).is_some_and(|e| [MD_EXT, MMD_EXT, DOT_EXT, TXT_EXT].iter().any(|l| l.contains(&e.as_str())))
}

/// Caminho absoluto. No Windows sem `canonicalize`, que devolve o formato `\\?\C:\...`.
fn normalize(p: &Path) -> PathBuf {
    if cfg!(windows) { std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf()) } else { fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()) }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn tilde(path: &Path) -> String {
    let s = path.to_string_lossy().into_owned();
    if let Some(home) = home_dir() {
        let h = home.to_string_lossy();
        if s == h || s.starts_with(&format!("{h}{}", std::path::MAIN_SEPARATOR)) {
            return format!("~{}", &s[h.len()..]);
        }
    }
    s
}

fn read_text(path: &Path) -> std::io::Result<String> {
    fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned())
}

const SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ').add(b'"').add(b'#').add(b'%').add(b'<').add(b'>').add(b'?').add(b'`')
    .add(b'{').add(b'}').add(b':').add(b'[').add(b']').add(b'^').add(b'|').add(b'\\');

/// URL da pasta do documento no protocolo `asset`, para imagens e links relativos do Markdown.
/// O protocolo tira a primeira "/" do caminho antes de decodificar; no Linux ela vai codificada.
fn asset_dir_url(dir: &Path) -> String {
    let s = dir.to_string_lossy().replace('\\', "/");
    let mut path = s.split('/').map(|seg| utf8_percent_encode(seg, SEGMENT).to_string()).collect::<Vec<_>>().join("/");
    if let Some(rest) = path.strip_prefix('/') {
        path = format!("%2F{rest}");
    }
    if !path.ends_with('/') {
        path.push('/');
    }
    let base = if cfg!(windows) { "http://asset.localhost/" } else { "asset://localhost/" };
    format!("{base}{path}")
}

fn asset_path(url: &Url) -> Option<PathBuf> {
    if url.scheme() != "asset" && url.host_str() != Some("asset.localhost") {
        return None;
    }
    let p = url.path();
    Some(PathBuf::from(percent_decode_str(p.strip_prefix('/').unwrap_or(p)).decode_utf8_lossy().into_owned()))
}

// ---------------------------------------------------------------- ponte com a página

fn js(app: &AppHandle, label: &str, code: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.eval(code);
    }
}

fn js_str(v: &str) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "\"\"".into())
}

/// Executa `expr` na página e chama `f` com o resultado (a página responde com {type:"reply"}).
fn ask(app: &AppHandle, label: &str, expr: &str, f: impl FnOnce(&AppHandle, Value) + Send + 'static) {
    let s = state(app);
    let id = s.seq.fetch_add(1, Ordering::Relaxed);
    s.replies.lock().unwrap().insert(id, Box::new(f));
    js(app, label, &format!("mirante.__ask({id}, () => {expr})"));
}

fn toast(app: &AppHandle, label: &str, msg: &str, ms: u32) {
    js(app, label, &format!("mirante.toast({}, {ms})", js_str(msg)));
}

// ---------------------------------------------------------------- janelas

fn bg(dark: bool) -> Color {
    if dark { Color(0x11, 0x12, 0x16, 255) } else { Color(0xf2, 0xf2, 0xf7, 255) }
}

fn theme_of(dark: bool) -> Theme {
    if dark { Theme::Dark } else { Theme::Light }
}

/// Nome do tema GTK para o modo pedido. Temas como "Yaru-blue-dark" ignoram o pedido de tema claro
/// e deixam o menu com texto branco sobre a janela clara; nesse caso usamos a variante sem "-dark".
fn gtk_variant(original: &str, dark: bool, exists: impl Fn(&str) -> bool) -> Option<String> {
    let base = original.strip_suffix("-dark").or_else(|| original.strip_suffix("-Dark"))?;
    let want = if dark { original } else { base };
    exists(want).then(|| want.to_string())
}

/// Troca o tema GTK do processo (barra de menu, caixas de diálogo) junto com o tema do Mirante.
///
/// Além do nome do tema, fixa a preferência "prefer dark" do GTK: o tao (camada de janelas do Tauri)
/// a copia do esquema de cores do sistema a cada janela criada, e com ela ligada até o tema claro
/// carrega a variante escura (menu de texto branco). Por isso a preferência é vigiada e reposta.
fn apply_gtk_theme(app: &AppHandle, dark: bool) {
    #[cfg(target_os = "linux")]
    let _ = app.run_on_main_thread(move || {
        use gtk::prelude::*;
        use std::sync::atomic::AtomicBool;
        static ORIGINAL: OnceLock<Option<String>> = OnceLock::new();
        static WANT_DARK: AtomicBool = AtomicBool::new(false);
        static WATCH: std::sync::Once = std::sync::Once::new();
        if std::env::var_os("GTK_THEME").is_some() {
            return; // o usuário fixou o tema; GtkSettings não manda nele
        }
        let Some(settings) = gtk::Settings::default() else { return };
        WANT_DARK.store(dark, Ordering::Relaxed);
        WATCH.call_once(|| {
            settings.connect_gtk_application_prefer_dark_theme_notify(|s| {
                let want = WANT_DARK.load(Ordering::Relaxed);
                if s.is_gtk_application_prefer_dark_theme() != want {
                    s.set_gtk_application_prefer_dark_theme(want);
                }
            });
        });
        if settings.is_gtk_application_prefer_dark_theme() != dark {
            settings.set_gtk_application_prefer_dark_theme(dark);
        }
        let original = ORIGINAL.get_or_init(|| settings.gtk_theme_name().map(|s| s.to_string()));
        let Some(original) = original else { return };
        if let Some(want) = gtk_variant(original, dark, gtk_theme_exists) {
            if settings.gtk_theme_name().as_deref() != Some(want.as_str()) {
                settings.set_gtk_theme_name(Some(&want));
            }
        }
    });
    #[cfg(not(target_os = "linux"))]
    let _ = (app, dark);
}

#[cfg(target_os = "linux")]
fn gtk_theme_exists(name: &str) -> bool {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".themes"));
        dirs.push(home.join(".local/share/themes"));
    }
    let data = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    dirs.extend(data.split(':').filter(|d| !d.is_empty()).map(|d| Path::new(d).join("themes")));
    dirs.push(PathBuf::from("/usr/share/themes"));
    dirs.iter().any(|d| d.join(name).join("gtk-3.0").is_dir())
}

/// Roda antes do HTML: a página já nasce no tema ("system" = seguir o sistema) e no idioma certos.
fn init_script(theme: &str, lang: Lang, editor_only: bool) -> String {
    format!(
        "window.MIRANTE_THEME = {};window.MIRANTE_LANG = {};{}",
        js_str(theme),
        js_str(lang.code()),
        if editor_only { "window.MIRANTE_EDITOR_ONLY = true;" } else { "" }
    )
}

fn saved_theme(app: &AppHandle) -> Option<bool> {
    state(app).settings.lock().unwrap().theme().map(|t| t == "dark")
}

fn new_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let s = state(app);
    let label = format!("main{}", s.seq.fetch_add(1, Ordering::Relaxed));
    let dark = *s.dark.lock().unwrap();
    let saved = saved_theme(app);
    let theme = match saved { Some(true) => "dark", Some(false) => "light", None => "system" };
    s.docs.lock().unwrap().insert(label.clone(), Doc::default());
    if saved.is_some() {
        apply_gtk_theme(app, dark);
    }

    let nav = (app.clone(), label.clone());
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("viewer.html".into()))
        .title(APP_NAME)
        .inner_size(1180.0, 820.0)
        .min_inner_size(520.0, 380.0)
        .visible(false);
    // no Mac o menu é um só, na barra do topo (ver setup); nos outros cada janela tem o seu
    #[cfg(not(target_os = "macos"))]
    let builder = builder
        .menu(build_menu(app)?)
        .on_menu_event(|w, e| menu_action(w.app_handle(), w.label(), e.id().as_ref()));
    let win = builder
        .theme(saved.map(theme_of))
        .background_color(bg(dark))
        .initialization_script(init_script(theme, lang(app), false))
        .on_navigation(move |url| navigate(&nav.0, &nav.1, url))
        .build()?;
    fit_and_show(&win, 1180.0, 820.0);

    let (h, l) = (app.clone(), label.clone());
    win.on_window_event(move |ev| match ev {
        WindowEvent::CloseRequested { api, .. } => {
            if with_doc(&h, &l, |d| d.dirty).unwrap_or(false) {
                api.prevent_close();
                let l2 = l.clone();
                ask_unsaved(&h, &l, move |app, choice| match choice {
                    Choice::Save => {
                        let target = l2.clone();
                        save(app, &l2, Some(Box::new(move |app: &AppHandle| destroy(app, &target))))
                    }
                    Choice::Discard => destroy(app, &l2),
                    Choice::Cancel => {}
                });
            }
        }
        WindowEvent::Destroyed => {
            let doc = state(&h).docs.lock().unwrap().remove(&l);
            if let Some((parent, _)) = doc.as_ref().and_then(|d| d.block.clone()) {
                if block_children(&h, &parent).is_empty() {
                    js(&h, &parent, "mirante.setLinked(false)");
                }
            }
            drop(doc); // solta o watcher fora da trava
            for (child, _) in block_children(&h, &l) {
                destroy(&h, &child);
            }
            if let Some(ed) = h.get_webview_window(&format!("{l}{EDITOR_SUFFIX}")) {
                let _ = ed.destroy();
            }
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            if let Some(p) = paths.iter().find(|p| is_doc(p)) {
                open_path(&h, &l, p.clone());
            }
        }
        _ => {}
    });
    Ok(win)
}

/// Cabe na tela: telas pequenas (1366×768, 1024×768) cortavam a barra de baixo da janela.
fn fit_and_show(win: &WebviewWindow, width: f64, height: f64) {
    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let (s, area) = (m.scale_factor(), m.work_area());
        let (max_w, max_h) = (area.size.width as f64 / s * 0.94, area.size.height as f64 / s * 0.94);
        if width > max_w || height > max_h {
            let _ = win.set_size(tauri::LogicalSize::new(width.min(max_w), height.min(max_h)));
        }
    }
    let _ = win.center();
    let _ = win.show();
}

fn destroy(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}

/// Links clicados na página: arquivos .md/.mmd/.gv abrem aqui, o resto vai para o sistema.
fn navigate(app: &AppHandle, label: &str, url: &Url) -> bool {
    if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") || url.scheme() == "about" {
        return true;
    }
    if let Some(path) = asset_path(url) {
        if is_doc(&path) && path.is_file() {
            let (h, l) = (app.clone(), label.to_string());
            std::thread::spawn(move || open_path(&h, &l, path));
        } else if path.exists() {
            let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
        }
        return false;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}

fn update_title(app: &AppHandle, label: &str) {
    let block = block_of(app, label);
    let Some(dirty) = with_doc(app, &owner(app, label), |d| d.dirty) else { return };
    let mark = if dirty { "● " } else { "" };
    let name = file_of(app, label).map(|p| file_name(&p.to_string_lossy()));
    let title = match (&name, &block) {
        (Some(n), Some((_, i))) => format!("{mark}{} {} — {n} — {APP_NAME}", tr(app, "Diagrama", "Diagram"), i + 1),
        (Some(n), None) => format!("{mark}{n} — {APP_NAME}"),
        (None, _) => APP_NAME.to_string(),
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_title(&title);
    }
    if let (Some(ed), Some(n)) = (app.get_webview_window(&format!("{label}{EDITOR_SUFFIX}")), &name) {
        let _ = ed.set_title(&format!("{mark}{} — {n}", tr(app, "Código", "Code")));
    }
    if block.is_none() {
        for (child, _) in block_children(app, label) {
            update_title(app, &child);
        }
    }
}

fn set_dark(app: &AppHandle, dark: bool, except: Option<&str>) {
    *state(app).dark.lock().unwrap() = dark;
    state(app).settings.lock().unwrap().set_theme(dark);
    let t = if dark { "dark" } else { "light" };
    apply_gtk_theme(app, dark);
    for (label, w) in app.webview_windows() {
        let _ = w.set_theme(Some(theme_of(dark)));
        let _ = w.set_background_color(Some(bg(dark)));
        if except != Some(label.as_str()) {
            let _ = w.eval(format!("mirante.setTheme({})", js_str(t)));
        }
    }
}

// ---------------------------------------------------------------- abrir / salvar

fn open_args(app: &AppHandle, args: &[String], cwd: &Path) {
    let files: Vec<PathBuf> = args
        .iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| match Url::parse(a).ok().filter(|u| u.scheme() == "file").and_then(|u| u.to_file_path().ok()) {
            Some(p) => p,
            None => PathBuf::from(a),
        })
        .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
        .filter(|p| p.is_file())
        .collect();
    if files.is_empty() {
        match app.webview_windows().into_iter().find(|(l, _)| !l.ends_with(EDITOR_SUFFIX)) {
            Some((_, w)) => {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            None => {
                let _ = new_window(app);
            }
        }
        return;
    }
    for f in files {
        // reaproveita uma janela sem arquivo (a tela inicial); senão abre outra
        let free = state(app).docs.lock().unwrap().iter().find(|(_, d)| d.path.is_none()).map(|(l, _)| l.clone());
        let label = match free {
            Some(l) => l,
            None => match new_window(app) {
                Ok(w) => w.label().to_string(),
                Err(_) => continue,
            },
        };
        open_path(app, &label, f);
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

fn open_path(app: &AppHandle, label: &str, path: PathBuf) {
    let path = normalize(&path);
    if !path.is_file() {
        error(app, label, &format!("{}\n{}", tr(app, "Arquivo não encontrado:", "File not found:"), path.display()));
        return;
    }
    let busy = with_doc(app, label, |d| d.dirty && d.path.as_deref() != Some(path.as_path())).unwrap_or(false);
    if busy {
        let l = label.to_string();
        ask_unsaved(app, label, move |app, choice| match choice {
            Choice::Save => save(app, &l.clone(), Some(Box::new(move |app: &AppHandle| open_now(app, &l, path)))),
            Choice::Discard => open_now(app, &l, path),
            Choice::Cancel => {}
        });
        return;
    }
    open_now(app, label, path);
}

fn open_now(app: &AppHandle, label: &str, path: PathBuf) {
    // a janela de um diagrama do .md que abre um arquivo vira uma janela comum
    if let Some((parent, _)) = with_doc(app, label, |d| d.block.take()).flatten() {
        if block_children(app, &parent).is_empty() {
            js(app, &parent, "mirante.setLinked(false)");
        }
    }
    if doc_path(app, label).as_deref() != Some(path.as_path()) {
        for (child, _) in block_children(app, label) {
            destroy(app, &child);
        }
    }
    with_doc(app, label, |d| {
        d.path = Some(path.clone());
        d.dirty = false;
    });
    watch(app, label, &path);
    update_title(app, label);
    state(app).settings.lock().unwrap().add_recent(&path.to_string_lossy());
    load(app, label, false);
}

fn load(app: &AppHandle, label: &str, keep_scroll: bool) {
    let Some(path) = doc_path(app, label) else { return };
    let text = match read_text(&path) {
        Ok(t) => t,
        Err(e) => {
            error(app, label, &format!("{}\n{e}", tr(app, "Não foi possível ler o arquivo:", "Could not read the file:")));
            return;
        }
    };
    let p = path.to_string_lossy().into_owned();
    let payload = json!({
        "kind": kind_for(&path),
        "text": text,
        "path": p,
        "base": asset_dir_url(path.parent().unwrap_or(Path::new("/"))),
        "keepScroll": keep_scroll,
        "prefs": state(app).settings.lock().unwrap().prefs_for(&p),
    });
    let ready = with_doc(app, label, |d| {
        d.last_text = Some(text.clone());
        if !d.ready {
            d.pending = Some(payload.clone());
        }
        d.ready
    });
    if ready == Some(true) {
        js(app, label, &format!("mirante.render({payload})"));
    }
}

fn reload_from_disk(app: &AppHandle, label: &str) {
    let label = &owner(app, label);
    if doc_path(app, label).is_none() {
        return;
    }
    if with_doc(app, label, |d| d.dirty).unwrap_or(false) {
        let l = label.to_string();
        ask_unsaved(app, label, move |app, choice| match choice {
            Choice::Save => save(app, &l.clone(), Some(Box::new(move |app: &AppHandle| load(app, &l, true)))),
            Choice::Discard => {
                with_doc(app, &l, |d| d.dirty = false);
                load(app, &l, true);
            }
            Choice::Cancel => {}
        });
    } else {
        load(app, label, true);
    }
}

type Then = Box<dyn FnOnce(&AppHandle) + Send>;

fn save(app: &AppHandle, label: &str, then: Option<Then>) {
    if let Some((parent, _)) = block_of(app, label) {
        return save(app, &parent, then);
    }
    let Some(path) = doc_path(app, label) else { return };
    let l = label.to_string();
    ask(app, label, "mirante.getSource()", move |app, v| {
        let Some(text) = v.as_str().map(str::to_string) else {
            error(app, &l, tr(app, "Não foi possível obter o conteúdo do editor.", "Could not get the editor's contents."));
            return;
        };
        if let Err(e) = fs::write(&path, &text) {
            error(app, &l, &format!("{}\n{e}", tr(app, "Não foi possível salvar:", "Could not save:")));
            return;
        }
        with_doc(app, &l, |d| {
            d.last_text = Some(text);
            d.dirty = false;
        });
        js(app, &l, &format!("mirante.markSaved(); mirante.toast({})", js_str(tr(app, "Salvo", "Saved"))));
        update_title(app, &l);
        if let Some(f) = then {
            f(app);
        }
    });
}

/// Acompanha o arquivo: vigia a pasta (editores costumam gravar um arquivo novo e renomear).
fn watch(app: &AppHandle, label: &str, path: &Path) {
    let old = with_doc(app, label, |d| d.watcher.take()).flatten();
    drop(old); // fora da trava: o watcher antigo pode estar chamando de volta
    let (h, l) = (app.clone(), label.to_string());
    let name = path.file_name().map(|n| n.to_os_string());
    let Ok(mut watcher) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_)) || !ev.paths.iter().any(|p| p.file_name() == name.as_deref()) {
            return;
        }
        schedule_reload(&h, &l);
    }) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
    }
    with_doc(app, label, |d| d.watcher = Some(watcher));
}

fn schedule_reload(app: &AppHandle, label: &str) {
    let Some(generation) = with_doc(app, label, |d| {
        d.reload_generation += 1;
        d.reload_generation
    }) else {
        return;
    };
    let (h, l) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        if with_doc(&h, &l, |d| d.reload_generation) == Some(generation) {
            reload_if_changed(&h, &l);
        }
    });
}

fn reload_if_changed(app: &AppHandle, label: &str) {
    let Some((Some(path), last, dirty)) = with_doc(app, label, |d| (d.path.clone(), d.last_text.clone(), d.dirty)) else { return };
    let Ok(text) = read_text(&path) else { return };
    if Some(&text) == last.as_ref() {
        return; // nossa própria gravação, ou nada mudou
    }
    if dirty {
        let msg = tr(app, "O arquivo mudou no disco. F5 recarrega (descarta suas edições).", "The file changed on disk. F5 reloads it (discards your edits).");
        toast(app, label, msg, 6000);
        return;
    }
    load(app, label, true);
}

fn open_dialog(app: &AppHandle, label: &str) {
    let all: Vec<&str> = MD_EXT.iter().chain(MMD_EXT).chain(DOT_EXT).chain(TXT_EXT).copied().collect();
    let mut d = app
        .dialog()
        .file()
        .set_title(tr(app, "Abrir arquivo", "Open file"))
        .add_filter(tr(app, "Markdown, diagramas e texto", "Markdown, diagrams and text"), &all)
        .add_filter("Markdown", MD_EXT)
        .add_filter("Mermaid", MMD_EXT)
        .add_filter("Graphviz", DOT_EXT)
        .add_filter(tr(app, "Texto", "Text"), TXT_EXT)
        .add_filter(tr(app, "Todos os arquivos", "All files"), &["*"]);
    if let Some(dir) = doc_path(app, label).and_then(|p| p.parent().map(Path::to_path_buf)) {
        d = d.set_directory(dir);
    }
    if let Some(w) = app.get_webview_window(label) {
        d = d.set_parent(&w);
    }
    let (h, l) = (app.clone(), label.to_string());
    d.pick_file(move |f| {
        if let Some(p) = f.and_then(|f| f.into_path().ok()) {
            open_path(&h, &l, p);
        }
    });
}

fn export_svg(app: &AppHandle, label: &str) {
    let Some(path) = file_of(app, label) else { return };
    let block = block_of(app, label);
    let l = label.to_string();
    ask(app, label, "mirante.getSvg()", move |app, v| {
        let svg = v.as_str().unwrap_or_default().to_string();
        if svg.is_empty() {
            error(app, &l, tr(app, "Não há diagrama renderizado para exportar.", "There is no rendered diagram to export."));
            return;
        }
        let mut stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| tr(app, "diagrama", "diagram").into());
        if let Some((_, i)) = block {
            stem = format!("{stem}-{}-{}", tr(app, "diagrama", "diagram"), i + 1);
        }
        let mut d = app.dialog().file().set_title(tr(app, "Exportar SVG", "Export SVG")).add_filter("SVG", &["svg"]).set_file_name(format!("{stem}.svg"));
        if let Some(dir) = path.parent() {
            d = d.set_directory(dir);
        }
        if let Some(w) = app.get_webview_window(&l) {
            d = d.set_parent(&w);
        }
        let (h, l2) = (app.clone(), l.clone());
        d.save_file(move |f| {
            if let Some(out) = f.and_then(|f| f.into_path().ok()) {
                if let Err(e) = fs::write(&out, svg) {
                    error(&h, &l2, &format!("{}\n{e}", tr(&h, "Não foi possível exportar:", "Could not export:")));
                }
            }
        });
    });
}

fn open_in_text_editor(app: &AppHandle, path: &Path) {
    #[cfg(windows)]
    let opened = std::process::Command::new("notepad.exe").arg(path).spawn().is_ok();
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("open").arg("-t").arg(path).spawn().is_ok();
    #[cfg(not(any(windows, target_os = "macos")))]
    let opened = std::process::Command::new("gnome-text-editor").arg(path).spawn().is_ok();
    if !opened {
        let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
    }
}

// ---------------------------------------------------------------- diagrama de um .md em janela própria

/// Abre o diagrama nº `index` do .md numa janela só dele. Ela fica ligada ao bloco: o que se edita lá
/// volta para o .md na hora (e Ctrl+S salva o .md); o que muda no .md chega lá.
fn open_block_window(app: &AppHandle, parent: &str, index: usize) {
    if let Some((child, _)) = block_children(app, parent).into_iter().find(|(_, i)| *i == index) {
        if let Some(w) = app.get_webview_window(&child) {
            let _ = w.set_focus();
        }
        return;
    }
    let Some(path) = doc_path(app, parent) else { return };
    let p = parent.to_string();
    ask(app, parent, &format!("mirante.getBlock({index})"), move |app, v| {
        let Some(code) = v["code"].as_str() else { return };
        let key = block_key(&path, index);
        let payload = json!({
            "kind": if v["lang"] == "dot" { "dot" } else { "mmd" },
            "text": code,
            "path": key,
            "base": asset_dir_url(path.parent().unwrap_or(Path::new("/"))),
            "keepScroll": false,
            "prefs": state(app).settings.lock().unwrap().prefs_for(&key),
            "block": true,
        });
        let Ok(win) = new_window(app) else { return };
        let label = win.label().to_string();
        let now = with_doc(app, &label, |d| {
            d.block = Some((p.clone(), index));
            if d.ready {
                Some(payload)
            } else {
                d.pending = Some(payload);
                None
            }
        })
        .flatten();
        if let Some(payload) = now {
            js(app, &label, &format!("mirante.render({payload})"));
        }
        update_title(app, &label);
        js(app, &p, "mirante.setLinked(true)");
    });
}

// ---------------------------------------------------------------- janela de código separada

fn editor_label(main: &str) -> String {
    format!("{main}{EDITOR_SUFFIX}")
}

fn open_editor_window(app: &AppHandle, main: &str) {
    let label = editor_label(main);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return;
    }
    if file_of(app, main).is_none() {
        return;
    }
    let m = main.to_string();
    ask(app, main, "mirante.getSource()", move |app, v| {
        if app.get_webview_window(&label).is_some() {
            return;
        }
        with_doc(app, &m, |d| d.editor_text = Some(v.as_str().unwrap_or_default().to_string()));
        let dark = *state(app).dark.lock().unwrap();
        let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("viewer.html".into()))
            .title(tr(app, "Código", "Code"))
            .inner_size(560.0, 820.0)
            .visible(false)
            .theme(Some(theme_of(dark)))
            .background_color(bg(dark))
            .initialization_script(init_script(if dark { "dark" } else { "light" }, lang(app), true))
            .on_navigation(|url| url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
            .build();
        let Ok(win) = built else { return };
        fit_and_show(&win, 560.0, 820.0);
        let (h, main2) = (app.clone(), m.clone());
        win.on_window_event(move |ev| {
            if matches!(ev, WindowEvent::Destroyed) {
                js(&h, &main2, "mirante.setDetached(false)");
            }
        });
        js(app, &m, "mirante.setDetached(true)");
        update_title(app, &m);
    });
}

fn editor_message(app: &AppHandle, main: &str, label: &str, t: &str, m: &Value) {
    match t {
        "ready" => {
            let text = with_doc(app, main, |d| d.editor_text.take()).flatten().unwrap_or_default();
            let theme = if *state(app).dark.lock().unwrap() { "dark" } else { "light" };
            js(app, label, &format!("mirante.initEditor({})", json!({"text": text, "theme": theme})));
        }
        "edit" => js(app, main, &format!("mirante.applyExternalEdit({})", js_str(m["text"].as_str().unwrap_or_default()))),
        "undo" | "redo" => js(app, main, &format!("mirante.{t}()")),
        "caret" => js(app, main, &format!("mirante.selectLine({})", m["line"].as_i64().unwrap_or(0))),
        "save" => save(app, main, None),
        "closeEditor" => destroy(app, label),
        "attach" => {
            destroy(app, label);
            js(app, main, "mirante.toggleEditor(true)");
            if let Some(w) = app.get_webview_window(main) {
                let _ = w.set_focus();
            }
        }
        "theme" => set_dark(app, m["value"].as_str() == Some("dark"), Some(label)),
        _ => {}
    }
}

// ---------------------------------------------------------------- mensagens da página

/// Assíncrono de propósito: no Windows, criar janelas dentro de um comando síncrono trava.
#[tauri::command]
async fn page_message(app: AppHandle, webview_window: WebviewWindow, msg: String) {
    let Ok(m) = serde_json::from_str::<Value>(&msg) else { return };
    let label = webview_window.label().to_string();
    let t = m["type"].as_str().unwrap_or_default();
    if t == "reply" {
        let f = m["id"].as_u64().and_then(|id| state(&app).replies.lock().unwrap().remove(&id));
        if let Some(f) = f {
            f(&app, m["value"].clone());
        }
        return;
    }
    if let Some(main) = label.strip_suffix(EDITOR_SUFFIX) {
        editor_message(&app, main, &label, t, &m);
        return;
    }
    match t {
        "ready" => on_ready(&app, &label, &m),
        "dirty" if block_of(&app, &label).is_none() => {
            with_doc(&app, &label, |d| d.dirty = m["value"].as_bool().unwrap_or(false));
            update_title(&app, &label);
        }
        "openBlock" => open_block_window(&app, &label, m["index"].as_u64().unwrap_or(0) as usize),
        "blockEdit" => {
            if let Some((parent, i)) = block_of(&app, &label) {
                js(&app, &parent, &format!("mirante.replaceBlock({i}, {})", js_str(m["text"].as_str().unwrap_or_default())));
            }
        }
        "blocks" => {
            for (child, i) in block_children(&app, &label) {
                if let Some(code) = m["list"][i].as_str() {
                    js(&app, &child, &format!("mirante.setBlockText({})", js_str(code)));
                }
            }
        }
        "prefs" => {
            let path = match block_of(&app, &label) {
                Some((parent, i)) => doc_path(&app, &parent).map(|p| block_key(&p, i)),
                None => doc_path(&app, &label).map(|p| p.to_string_lossy().into_owned()),
            };
            state(&app).settings.lock().unwrap().set_prefs(path.as_deref(), &m["prefs"]);
        }
        "source" => js(&app, &editor_label(&label), &format!("mirante.setSource({})", js_str(m["text"].as_str().unwrap_or_default()))),
        "reveal" => js(&app, &editor_label(&label), &format!("mirante.revealLine({})", m["line"].as_i64().unwrap_or(0))),
        "detach" => open_editor_window(&app, &label),
        "focusEditor" => {
            if let Some(w) = app.get_webview_window(&editor_label(&label)) {
                let _ = w.set_focus();
            }
        }
        "theme" => set_dark(&app, m["value"].as_str() == Some("dark"), Some(&label)),
        "openRecent" => {
            let path = m["path"].as_str().unwrap_or_default().to_string();
            let known = state(&app).settings.lock().unwrap().recent().iter().any(|(_, p)| *p == path);
            if known {
                open_path(&app, &label, PathBuf::from(path));
            }
        }
        _ => {}
    }
}

fn on_ready(app: &AppHandle, label: &str, m: &Value) {
    // sem tema salvo a página segue o sistema; guardamos o que ela escolheu para as janelas
    if saved_theme(app).is_none() {
        if let Some(t) = m["theme"].as_str() {
            let dark = t == "dark";
            *state(app).dark.lock().unwrap() = dark;
            apply_gtk_theme(app, dark);
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.set_background_color(Some(bg(dark)));
            }
        }
    }
    // hardware: o último resultado vale na hora; a detecção nova só substitui se mudou
    let cached = state(app).settings.lock().unwrap().hardware().cloned();
    if let Some(hw) = &cached {
        js(app, label, &format!("mirante.setDetected({hw})"));
    }
    let hw = hardware::detect(m["gpu"].as_str().unwrap_or_default());
    if cached.as_ref() != Some(&hw) {
        state(app).settings.lock().unwrap().set_hardware(hw.clone());
        js(app, label, &format!("mirante.setDetected({hw})"));
    }
    let pending = with_doc(app, label, |d| {
        d.ready = true;
        d.pending.take()
    })
    .flatten();
    match pending {
        Some(p) => js(app, label, &format!("mirante.render({p})")),
        None => js(app, label, &format!("mirante.showWelcome({})", json!({"recent": recent_items(app)}))),
    }
}

fn recent_items(app: &AppHandle) -> Vec<Value> {
    state(app)
        .settings
        .lock()
        .unwrap()
        .recent()
        .into_iter()
        .filter(|(_, p)| Path::new(p).is_file())
        .map(|(name, p)| {
            let path = Path::new(&p);
            json!({"name": name, "path": p, "folder": tilde(path.parent().unwrap_or(path)), "kind": kind_for(path)})
        })
        .collect()
}

// ---------------------------------------------------------------- menus e diálogos

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, text);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };
    let t = |pt, en| tr(app, pt, en);
    let arquivo = SubmenuBuilder::new(app, t("Arquivo", "File"))
        .item(&item("open", t("Abrir…", "Open…"), Some("CmdOrCtrl+O"))?)
        .item(&item("save", t("Salvar", "Save"), Some("CmdOrCtrl+S"))?)
        .item(&item("reload", t("Recarregar do disco", "Reload from disk"), Some("F5"))?)
        .separator()
        .item(&item("export-svg", t("Exportar diagrama como SVG…", "Export diagram as SVG…"), Some("CmdOrCtrl+Shift+E"))?)
        .item(&item("print", t("Imprimir / salvar PDF…", "Print / save as PDF…"), Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item("folder", t("Mostrar na pasta", "Show in folder"), None)?)
        .item(&item("edit", t("Abrir no editor de texto", "Open in text editor"), None)?)
        .separator()
        .item(&item("new-window", t("Nova janela", "New window"), Some("CmdOrCtrl+N"))?)
        .item(&item("close", t("Fechar janela", "Close window"), Some("CmdOrCtrl+W"))?)
        .build()?;
    // o nome do submenu leva os dois idiomas: quem caiu no idioma errado ainda acha a opção
    let chosen = state(app).settings.lock().unwrap().language().map(str::to_string);
    let check = |id: &str, text: &str, on: bool| CheckMenuItemBuilder::with_id(id, text).checked(on).build(app);
    let idioma = SubmenuBuilder::new(app, t("Idioma (Language)", "Language (Idioma)"))
        .item(&check("lang-auto", t("Igual ao sistema", "Same as system"), chosen.is_none())?)
        .item(&check("lang-pt", "Português", chosen.as_deref() == Some("pt"))?)
        .item(&check("lang-en", "English", chosen.as_deref() == Some("en"))?)
        .build()?;
    let exibir = SubmenuBuilder::new(app, t("Exibir", "View"))
        .item(&item("toggle-editor", t("Editor de código", "Code editor"), Some("CmdOrCtrl+E"))?)
        .item(&item("detach-editor", t("Editor em janela separada", "Editor in a separate window"), Some("CmdOrCtrl+Shift+O"))?)
        .item(&item("find", t("Buscar…", "Find…"), Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item("zoom-in", t("Aumentar zoom", "Zoom in"), Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", t("Diminuir zoom", "Zoom out"), Some("CmdOrCtrl+-"))?)
        .item(&item("zoom-reset", t("Zoom 100%", "Actual size"), Some("CmdOrCtrl+0"))?)
        .item(&item("fit", t("Ajustar à janela", "Fit to window"), Some("CmdOrCtrl+1"))?)
        .separator()
        .item(&item("theme", t("Tema claro / escuro", "Light / dark theme"), Some("CmdOrCtrl+D"))?)
        .item(&idioma)
        .build()?;
    let ajuda = SubmenuBuilder::new(app, t("Ajuda", "Help"))
        .item(&item("ai-prompts", t("Gerar material de estudo com IA…", "Generate study material with AI…"), None)?)
        .item(&item("shortcuts", t("Atalhos de teclado", "Keyboard shortcuts"), Some("F1"))?);
    #[cfg(not(target_os = "macos"))]
    let ajuda = ajuda.item(&item("about", t("Sobre o Mirante", "About Mirante"), None)?);
    let ajuda = ajuda.build()?;

    // no Mac o primeiro menu leva o nome do app; o "Sobre" fica nele
    #[cfg(target_os = "macos")]
    let menu = {
        let mirante = SubmenuBuilder::new(app, APP_NAME)
            .item(&item("about", t("Sobre o Mirante", "About Mirante"), None)?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        // sem os itens de Editar, Cmd+C, Cmd+V e Cmd+A não chegam à página; desfazer fica com o app (Cmd+Z na página)
        let editar = SubmenuBuilder::new(app, t("Editar", "Edit")).cut().copy().paste().select_all().build()?;
        MenuBuilder::new(app).item(&mirante).item(&arquivo).item(&editar).item(&exibir).item(&ajuda).build()
    };
    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app).item(&arquivo).item(&exibir).item(&ajuda).build();
    menu
}

/// No Mac o menu é do app: a ação vale para a janela em foco (a de código separada conta como a principal).
#[cfg(target_os = "macos")]
fn menu_target(app: &AppHandle) -> String {
    let windows = app.webview_windows();
    let focused = windows.iter().find(|(_, w)| w.is_focused().unwrap_or(false)).map(|(l, _)| l.clone());
    match focused {
        Some(l) => l.strip_suffix(EDITOR_SUFFIX).map(str::to_string).unwrap_or(l),
        None => windows.keys().find(|l| !l.ends_with(EDITOR_SUFFIX)).cloned().unwrap_or_default(),
    }
}

fn menu_action(app: &AppHandle, label: &str, id: &str) {
    let path = file_of(app, label);
    match id {
        "open" => open_dialog(app, label),
        "save" => save(app, label, None),
        "reload" => reload_from_disk(app, label),
        "export-svg" => export_svg(app, label),
        "print" => {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.print();
            }
        }
        "folder" => {
            if let Some(p) = path {
                let _ = app.opener().reveal_item_in_dir(p);
            }
        }
        "edit" => {
            if let Some(p) = path {
                open_in_text_editor(app, &p);
            }
        }
        "new-window" => {
            let _ = new_window(app);
        }
        "close" => {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.close();
            }
        }
        "toggle-editor" => js(app, label, "mirante.toggleEditor()"),
        "detach-editor" => open_editor_window(app, label),
        "find" => js(app, label, "mirante.openFind()"),
        "zoom-in" => js(app, label, "mirante.zoomBy(1)"),
        "zoom-out" => js(app, label, "mirante.zoomBy(-1)"),
        "zoom-reset" => js(app, label, "mirante.zoomBy(0)"),
        "fit" => js(app, label, "mirante.fit()"),
        "theme" => {
            let dark = !*state(app).dark.lock().unwrap();
            set_dark(app, dark, None);
        }
        "shortcuts" => js(app, label, "mirante.showShortcuts()"),
        "ai-prompts" => js(app, label, "mirante.showAiPrompts()"),
        "about" => about(app, label),
        "lang-auto" => set_language(app, None),
        "lang-pt" => set_language(app, Some("pt")),
        "lang-en" => set_language(app, Some("en")),
        _ => {}
    }
}

enum Choice {
    Save,
    Discard,
    Cancel,
}

fn ask_unsaved(app: &AppHandle, label: &str, then: impl FnOnce(&AppHandle, Choice) + Send + 'static) {
    let name = doc_path(app, label).map(|p| file_name(&p.to_string_lossy())).unwrap_or_else(|| tr(app, "arquivo", "file").into());
    let (save_b, discard_b, cancel_b) = (tr(app, "Salvar", "Save"), tr(app, "Descartar", "Don't Save"), tr(app, "Cancelar", "Cancel"));
    let msg = match lang(app) {
        Lang::Pt => format!("Salvar as alterações em “{name}”?\n\nSe você não salvar, as alterações serão perdidas."),
        Lang::En => format!("Save changes to “{name}”?\n\nIf you don't save, your changes will be lost."),
    };
    let mut d = app
        .dialog()
        .message(msg)
        .title(APP_NAME)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(save_b.into(), discard_b.into(), cancel_b.into()));
    if let Some(w) = app.get_webview_window(label) {
        d = d.parent(&w);
    }
    let h = app.clone();
    d.show_with_result(move |r| {
        let choice = match r {
            MessageDialogResult::Yes => Choice::Save,
            MessageDialogResult::No => Choice::Discard,
            MessageDialogResult::Custom(s) if s == save_b => Choice::Save,
            MessageDialogResult::Custom(s) if s == discard_b => Choice::Discard,
            _ => Choice::Cancel,
        };
        then(&h, choice);
    });
}

fn error(app: &AppHandle, label: &str, msg: &str) {
    let mut d = app.dialog().message(msg).title(APP_NAME).kind(MessageDialogKind::Error);
    if let Some(w) = app.get_webview_window(label) {
        d = d.parent(&w);
    }
    d.show(|_| {});
}

fn about(app: &AppHandle, label: &str) {
    let version = app.package_info().version.to_string();
    let mut d = app
        .dialog()
        .message(match lang(app) {
            Lang::Pt => format!(
                "{APP_NAME} {version}\n\nVisualizador e editor de Markdown e diagramas Mermaid e Graphviz.\n\nCódigo e novidades:\nhttps://github.com/joseRibamar21/mirante_md_mmd\n\nLicença MIT."
            ),
            Lang::En => format!(
                "{APP_NAME} {version}\n\nViewer and editor for Markdown and Mermaid and Graphviz diagrams.\n\nSource code and news:\nhttps://github.com/joseRibamar21/mirante_md_mmd\n\nMIT License."
            ),
        })
        .title(tr(app, "Sobre o Mirante", "About Mirante"))
        .kind(MessageDialogKind::Info);
    if let Some(w) = app.get_webview_window(label) {
        d = d.parent(&w);
    }
    d.show(|_| {});
}

// ---------------------------------------------------------------- início

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_args(app, &args, Path::new(&cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings = Settings::load(&app.path().config_dir()?);
            let dark = settings.theme() == Some("dark");
            app.manage(State {
                settings: Mutex::new(settings),
                docs: Mutex::new(HashMap::new()),
                dark: Mutex::new(dark),
                replies: Mutex::new(HashMap::new()),
                seq: AtomicU64::new(1),
            });
            #[cfg(target_os = "macos")]
            {
                app.set_menu(build_menu(app.handle())?)?;
                app.on_menu_event(|app, e| {
                    let mut label = menu_target(app);
                    if label.is_empty() {
                        // nenhuma janela aberta (o Mac mantém o app vivo): a ação ganha uma janela nova
                        match new_window(app) {
                            Ok(w) => label = w.label().to_string(),
                            Err(_) => return,
                        }
                    }
                    menu_action(app, &label, e.id().as_ref());
                });
            }
            let mut args: Vec<String> = std::env::args().collect();
            // arquivos que o Finder mandou antes de o app ficar pronto
            args.extend(OPENED_EARLY.lock().unwrap().drain(..));
            let cwd = std::env::current_dir().unwrap_or_default();
            open_args(app.handle(), &args, &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![page_message])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Mirante")
        .run(|_app, _event| {
            // Mac: clique duplo num arquivo no Finder (ou arrastar para o ícone no Dock)
            #[cfg(target_os = "macos")]
            match _event {
                tauri::RunEvent::Opened { urls } => {
                    let files: Vec<String> = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    if _app.try_state::<State>().is_some() {
                        let mut args = vec![APP_NAME.to_string()];
                        args.extend(files);
                        open_args(_app, &args, Path::new("/"));
                    } else {
                        OPENED_EARLY.lock().unwrap().extend(files);
                    }
                }
                // ícone do Dock clicado sem janela aberta: abre a tela inicial
                tauri::RunEvent::Reopen { has_visible_windows: false, .. } => {
                    if _app.try_state::<State>().is_some() {
                        let _ = new_window(_app);
                    }
                }
                _ => {}
            }
        });
}

/// Arquivos que o macOS pediu para abrir antes do setup terminar.
static OPENED_EARLY: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_da_pasta_no_protocolo_asset() {
        if cfg!(windows) {
            assert_eq!(asset_dir_url(Path::new(r"C:\Users\Ana\Meus Docs")), "http://asset.localhost/C%3A/Users/Ana/Meus%20Docs/");
        } else {
            let url = asset_dir_url(Path::new("/home/ana/Meus Docs"));
            assert_eq!(url, "asset://localhost/%2Fhome/ana/Meus%20Docs/");
            // o caminho de volta, como o protocolo faz: relativo ao documento
            let img = Url::parse(&url).unwrap().join("img/foto%20nova.png").unwrap();
            assert_eq!(asset_path(&img).unwrap(), PathBuf::from("/home/ana/Meus Docs/img/foto nova.png"));
        }
    }

    #[test]
    fn tipo_pela_extensao() {
        assert_eq!(kind_for(Path::new("notas.md")), "md");
        assert_eq!(kind_for(Path::new("mapa.MMD")), "mmd");
        assert_eq!(kind_for(Path::new("grafo.gv")), "dot");
        assert_eq!(kind_for(Path::new("grafo.dot")), "dot");
        assert_eq!(kind_for(Path::new("notas.TXT")), "txt");
        assert!(is_doc(Path::new("lista.txt")));
        assert!(is_doc(Path::new("grafo.gv")) && is_doc(Path::new("a.mermaid")));
        assert!(!is_doc(Path::new("foto.png")));
    }

    #[test]
    fn variante_do_tema_gtk() {
        let all = |_: &str| true;
        assert_eq!(gtk_variant("Yaru-blue-dark", false, all).as_deref(), Some("Yaru-blue"));
        assert_eq!(gtk_variant("Yaru-blue-dark", true, all).as_deref(), Some("Yaru-blue-dark"));
        assert_eq!(gtk_variant("Adwaita", false, all), None); // tema claro: o GTK já obedece
        assert_eq!(gtk_variant("Foo-dark", false, |n| n != "Foo"), None); // sem variante clara instalada
    }

    #[test]
    fn idioma_pelo_sistema() {
        assert_eq!(lang_from_locale("pt_BR.UTF-8"), Lang::Pt);
        assert_eq!(lang_from_locale("pt-PT"), Lang::Pt);
        assert_eq!(lang_from_locale("pt_BR:pt:en"), Lang::Pt);
        assert_eq!(lang_from_locale("en_US.UTF-8"), Lang::En);
        assert_eq!(lang_from_locale("es_ES.UTF-8"), Lang::En);
        assert_eq!(lang_from_locale("C"), Lang::En);
        assert_eq!(lang_from_locale(""), Lang::En);
    }
}
