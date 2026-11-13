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
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::window::Color;
use tauri::{AppHandle, DragDropEvent, Manager, Theme, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;

const APP_NAME: &str = "Mirante";
const MD_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"];
const MMD_EXT: &[&str] = &["mmd", "mermaid"];
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

// ---------------------------------------------------------------- arquivos e caminhos

fn ext_of(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_lowercase())
}

fn kind_for(path: &Path) -> &'static str {
    match ext_of(path) {
        Some(e) if MMD_EXT.contains(&e.as_str()) => "mmd",
        _ => "md",
    }
}

fn is_doc(path: &Path) -> bool {
    ext_of(path).is_some_and(|e| MD_EXT.contains(&e.as_str()) || MMD_EXT.contains(&e.as_str()))
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

/// Roda antes do HTML: a página já nasce no tema certo ("system" = seguir o sistema).
fn init_script(theme: &str, editor_only: bool) -> String {
    format!("window.MIRANTE_THEME = {};{}", js_str(theme), if editor_only { "window.MIRANTE_EDITOR_ONLY = true;" } else { "" })
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

    let nav = (app.clone(), label.clone());
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("viewer.html".into()))
        .title(APP_NAME)
        .inner_size(1180.0, 820.0)
        .min_inner_size(520.0, 380.0)
        .visible(false)
        .menu(build_menu(app)?)
        .on_menu_event(|w, e| menu_action(w.app_handle(), w.label(), e.id().as_ref()))
        .theme(saved.map(theme_of))
        .background_color(bg(dark))
        .initialization_script(init_script(theme, false))
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
            drop(doc); // solta o watcher fora da trava
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

/// Links clicados na página: arquivos .md/.mmd abrem aqui, o resto vai para o sistema.
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
    let Some((path, dirty)) = with_doc(app, label, |d| (d.path.clone(), d.dirty)) else { return };
    let mark = if dirty { "● " } else { "" };
    let title = match &path {
        Some(p) => format!("{mark}{} — {APP_NAME}", file_name(&p.to_string_lossy())),
        None => APP_NAME.to_string(),
    };
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_title(&title);
    }
    if let (Some(ed), Some(p)) = (app.get_webview_window(&format!("{label}{EDITOR_SUFFIX}")), &path) {
        let _ = ed.set_title(&format!("{mark}Código — {}", file_name(&p.to_string_lossy())));
    }
}

fn set_dark(app: &AppHandle, dark: bool, except: Option<&str>) {
    *state(app).dark.lock().unwrap() = dark;
    state(app).settings.lock().unwrap().set_theme(dark);
    let t = if dark { "dark" } else { "light" };
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
        error(app, label, &format!("Arquivo não encontrado:\n{}", path.display()));
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
            error(app, label, &format!("Não foi possível ler o arquivo:\n{e}"));
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
    let Some(path) = doc_path(app, label) else { return };
    let l = label.to_string();
    ask(app, label, "mirante.getSource()", move |app, v| {
        let Some(text) = v.as_str().map(str::to_string) else {
            error(app, &l, "Não foi possível obter o conteúdo do editor.");
            return;
        };
        if let Err(e) = fs::write(&path, &text) {
            error(app, &l, &format!("Não foi possível salvar:\n{e}"));
            return;
        }
        with_doc(app, &l, |d| {
            d.last_text = Some(text);
            d.dirty = false;
        });
        js(app, &l, "mirante.markSaved(); mirante.toast('Salvo')");
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
        toast(app, label, "O arquivo mudou no disco. F5 recarrega (descarta suas edições).", 6000);
        return;
    }
    load(app, label, true);
}

fn open_dialog(app: &AppHandle, label: &str) {
    let all: Vec<&str> = MD_EXT.iter().chain(MMD_EXT).copied().collect();
    let mut d = app
        .dialog()
        .file()
        .set_title("Abrir arquivo")
        .add_filter("Markdown e Mermaid", &all)
        .add_filter("Markdown", MD_EXT)
        .add_filter("Mermaid", MMD_EXT)
        .add_filter("Todos os arquivos", &["*"]);
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
    let Some(path) = doc_path(app, label) else { return };
    let l = label.to_string();
    ask(app, label, "mirante.getSvg()", move |app, v| {
        let svg = v.as_str().unwrap_or_default().to_string();
        if svg.is_empty() {
            error(app, &l, "Não há diagrama renderizado para exportar.");
            return;
        }
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "diagrama".into());
        let mut d = app.dialog().file().set_title("Exportar SVG").add_filter("SVG", &["svg"]).set_file_name(format!("{stem}.svg"));
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
                    error(&h, &l2, &format!("Não foi possível exportar:\n{e}"));
                }
            }
        });
    });
}

fn open_in_text_editor(app: &AppHandle, path: &Path) {
    #[cfg(windows)]
    let opened = std::process::Command::new("notepad.exe").arg(path).spawn().is_ok();
    #[cfg(not(windows))]
    let opened = std::process::Command::new("gnome-text-editor").arg(path).spawn().is_ok();
    if !opened {
        let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
    }
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
    if doc_path(app, main).is_none() {
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
            .title("Código")
            .inner_size(560.0, 820.0)
            .visible(false)
            .theme(Some(theme_of(dark)))
            .background_color(bg(dark))
            .initialization_script(init_script(if dark { "dark" } else { "light" }, true))
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
        "dirty" => {
            with_doc(&app, &label, |d| d.dirty = m["value"].as_bool().unwrap_or(false));
            update_title(&app, &label);
        }
        "prefs" => {
            let path = doc_path(&app, &label).map(|p| p.to_string_lossy().into_owned());
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
    let arquivo = SubmenuBuilder::new(app, "Arquivo")
        .item(&item("open", "Abrir…", Some("CmdOrCtrl+O"))?)
        .item(&item("save", "Salvar", Some("CmdOrCtrl+S"))?)
        .item(&item("reload", "Recarregar do disco", Some("F5"))?)
        .separator()
        .item(&item("export-svg", "Exportar diagrama como SVG…", Some("CmdOrCtrl+Shift+E"))?)
        .item(&item("print", "Imprimir / salvar PDF…", Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item("folder", "Mostrar na pasta", None)?)
        .item(&item("edit", "Abrir no editor de texto", None)?)
        .separator()
        .item(&item("new-window", "Nova janela", Some("CmdOrCtrl+N"))?)
        .item(&item("close", "Fechar janela", Some("CmdOrCtrl+W"))?)
        .build()?;
    let exibir = SubmenuBuilder::new(app, "Exibir")
        .item(&item("toggle-editor", "Editor de código", Some("CmdOrCtrl+E"))?)
        .item(&item("detach-editor", "Editor em janela separada", Some("CmdOrCtrl+Shift+O"))?)
        .item(&item("find", "Buscar…", Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item("zoom-in", "Aumentar zoom", Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", "Diminuir zoom", Some("CmdOrCtrl+-"))?)
        .item(&item("zoom-reset", "Zoom 100%", Some("CmdOrCtrl+0"))?)
        .item(&item("fit", "Ajustar à janela", Some("CmdOrCtrl+1"))?)
        .separator()
        .item(&item("theme", "Tema claro / escuro", Some("CmdOrCtrl+D"))?)
        .build()?;
    let ajuda = SubmenuBuilder::new(app, "Ajuda")
        .item(&item("shortcuts", "Atalhos de teclado", Some("F1"))?)
        .item(&item("about", "Sobre o Mirante", None)?)
        .build()?;
    MenuBuilder::new(app).item(&arquivo).item(&exibir).item(&ajuda).build()
}

fn menu_action(app: &AppHandle, label: &str, id: &str) {
    let path = doc_path(app, label);
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
        "about" => about(app, label),
        _ => {}
    }
}

enum Choice {
    Save,
    Discard,
    Cancel,
}

fn ask_unsaved(app: &AppHandle, label: &str, then: impl FnOnce(&AppHandle, Choice) + Send + 'static) {
    let name = doc_path(app, label).map(|p| file_name(&p.to_string_lossy())).unwrap_or_else(|| "arquivo".into());
    let mut d = app
        .dialog()
        .message(format!("Salvar as alterações em “{name}”?\n\nSe você não salvar, as alterações serão perdidas."))
        .title(APP_NAME)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom("Salvar".into(), "Descartar".into(), "Cancelar".into()));
    if let Some(w) = app.get_webview_window(label) {
        d = d.parent(&w);
    }
    let h = app.clone();
    d.show_with_result(move |r| {
        let choice = match r {
            MessageDialogResult::Yes => Choice::Save,
            MessageDialogResult::No => Choice::Discard,
            MessageDialogResult::Custom(s) if s == "Salvar" => Choice::Save,
            MessageDialogResult::Custom(s) if s == "Descartar" => Choice::Discard,
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
        .message(format!(
            "{APP_NAME} {version}\n\nVisualizador e editor de Markdown e diagramas Mermaid.\n\nCódigo e novidades:\nhttps://github.com/joseRibamar21/mirante_md_mmd\n\nLicença MIT."
        ))
        .title(format!("Sobre o {APP_NAME}"))
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
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            open_args(app.handle(), &args, &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![page_message])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Mirante");
}

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
}
