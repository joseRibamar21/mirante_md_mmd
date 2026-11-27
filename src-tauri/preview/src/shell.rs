//! Windows: os componentes do Explorer.
//!
//! - Miniaturas (IThumbnailProvider): o Explorer passa os bytes do arquivo (IInitializeWithStream, num processo
//!   isolado) e recebe um bitmap desenhado por `thumbnail.rs`, o mesmo das miniaturas do Linux.
//! - Painel de visualização (IPreviewHandler, Alt+P): abre o visualizador do Mirante (a pasta web/ instalada ao
//!   lado da DLL) num WebView2 dentro do painel e chama `mirante.preview(...)` com o arquivo. O Typst chega
//!   compilado daqui, porque a página sozinha não compila.
//!
//! O registro (DllRegisterServer) é por usuário, em HKCU, e o instalador o chama por meio do `mirante.exe
//! --register-preview` (o NSIS é 32 bits e não carregaria esta DLL de 64).

use std::cell::RefCell;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicIsize, Ordering};

use serde_json::json;
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    ExecuteScriptCompletedHandler, NavigationCompletedEventHandler,
};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Ole::*;
use windows::Win32::System::Registry::*;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::UI::Input::KeyboardAndMouse::GetFocus;
use windows::Win32::UI::Shell::PropertiesSystem::*;
use windows::Win32::UI::Shell::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::*;

use crate::thumbnail;

pub const CLSID_THUMBNAIL: GUID = GUID::from_u128(0x6c1d3b4e_8f2a_4c55_9e1b_2a7d4f0c9a01);
pub const CLSID_PREVIEW: GUID = GUID::from_u128(0x6c1d3b4e_8f2a_4c55_9e1b_2a7d4f0c9a02);
/// O processo do Windows que hospeda os painéis de visualização de 64 bits (prevhost.exe).
const PREVHOST_APPID: &str = "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}";
const SHELLEX_THUMBNAIL: &str = "{e357fccd-a995-4576-b01f-234630154e96}";
const SHELLEX_PREVIEW: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";

const THUMB_EXT: [&str; 12] = [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mmd", ".mermaid", ".gv", ".dot", ".tex", ".ltx", ".typ"];
const PREVIEW_EXT: [&str; 14] =
    [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mmd", ".mermaid", ".gv", ".dot", ".tex", ".latex", ".ltx", ".typ", ".bib"];

static INSTANCE: AtomicIsize = AtomicIsize::new(0);

#[unsafe(no_mangle)]
extern "system" fn DllMain(instance: HINSTANCE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        INSTANCE.store(instance.0 as isize, Ordering::Relaxed);
    }
    TRUE
}

/// Onde esta DLL está (a pasta web/ do visualizador fica ao lado).
fn dll_path() -> PathBuf {
    let mut buf = [0u16; 1024];
    let n = unsafe { GetModuleFileNameW(Some(HMODULE(INSTANCE.load(Ordering::Relaxed) as *mut c_void)), &mut buf) } as usize;
    PathBuf::from(String::from_utf16_lossy(&buf[..n]))
}

/* ---------------------------------------------------------------- fábrica */

#[unsafe(no_mangle)]
extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if ppv.is_null() || rclsid.is_null() {
        return E_POINTER;
    }
    unsafe { *ppv = std::ptr::null_mut() };
    let preview = match unsafe { *rclsid } {
        c if c == CLSID_THUMBNAIL => false,
        c if c == CLSID_PREVIEW => true,
        _ => return CLASS_E_CLASSNOTAVAILABLE,
    };
    let factory: IClassFactory = Factory(preview).into();
    unsafe { factory.query(riid, ppv) }
}

#[unsafe(no_mangle)]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    // o Explorer reusa: manter carregada é mais simples e mais rápido
    S_FALSE
}

#[implement(IClassFactory)]
struct Factory(bool);

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        if ppv.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe { *ppv = std::ptr::null_mut() };
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let unk: IUnknown = if self.0 { Preview::default().into() } else { Thumbnail::default().into() };
        unsafe { unk.query(riid, ppv).ok() }
    }
    fn LockServer(&self, _lock: BOOL) -> Result<()> {
        Ok(())
    }
}

/* ---------------------------------------------------------------- miniaturas */

#[implement(IInitializeWithStream, IThumbnailProvider)]
#[derive(Default)]
struct Thumbnail {
    data: RefCell<Option<(String, Option<String>)>>, // texto e nome do arquivo (quando o Explorer conta)
}

impl IInitializeWithStream_Impl for Thumbnail_Impl {
    fn Initialize(&self, stream: Ref<IStream>, _mode: u32) -> Result<()> {
        let stream = stream.ok()?;
        // o nome do arquivo, para saber o tipo pela extensão
        let mut stat = STATSTG::default();
        let name = unsafe { stream.Stat(&mut stat, STATFLAG_DEFAULT) }.ok().and_then(|_| {
            if stat.pwcsName.is_null() {
                return None;
            }
            let n = unsafe { stat.pwcsName.to_string() }.ok();
            unsafe { CoTaskMemFree(Some(stat.pwcsName.0 as *const c_void)) };
            n
        });
        let mut buf = vec![0u8; 512 * 1024];
        let mut total = 0usize;
        while total < buf.len() {
            let mut read = 0u32;
            let hr = unsafe { stream.Read(buf[total..].as_mut_ptr() as *mut c_void, (buf.len() - total) as u32, Some(&mut read)) };
            if hr.is_err() || read == 0 {
                break;
            }
            total += read as usize;
        }
        buf.truncate(total);
        *self.data.borrow_mut() = Some((String::from_utf8_lossy(&buf).into_owned(), name));
        Ok(())
    }
}

impl IThumbnailProvider_Impl for Thumbnail_Impl {
    fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> Result<()> {
        let data = self.data.borrow();
        let (text, name) = data.as_ref().ok_or(Error::from(E_UNEXPECTED))?;
        let kind = match name.as_deref().map(Path::new).and_then(|p| p.extension().map(|_| p)) {
            Some(p) => thumbnail::kind_of(p),
            None => thumbnail::sniff(text),
        };
        let pix = thumbnail::image(text, kind, None, cx.clamp(16, 1024)).map_err(|_| Error::from(E_FAIL))?;
        let bmp = bitmap(&pix)?;
        unsafe {
            *phbmp = bmp;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

/// RGBA pré-multiplicado (tiny-skia) → bitmap de 32 bits BGRA, de cima para baixo, como o Explorer quer.
fn bitmap(pix: &resvg::tiny_skia::Pixmap) -> Result<HBITMAP> {
    let (w, h) = (pix.width() as i32, pix.height() as i32);
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let bmp = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        return Err(E_OUTOFMEMORY.into());
    }
    let out = unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, (w * h * 4) as usize) };
    for (dst, src) in out.chunks_exact_mut(4).zip(pix.data().chunks_exact(4)) {
        dst[0] = src[2];
        dst[1] = src[1];
        dst[2] = src[0];
        dst[3] = src[3];
    }
    Ok(bmp)
}

/* ---------------------------------------------------------------- painel de visualização */

#[derive(Default)]
struct PreviewState {
    path: Option<PathBuf>,
    parent: HWND,
    rect: RECT,
    site: Option<IUnknown>,
    controller: Option<ICoreWebView2Controller>,
}

#[implement(IInitializeWithFile, IPreviewHandler, IObjectWithSite, IOleWindow)]
#[derive(Default)]
struct Preview {
    st: Rc<RefCell<PreviewState>>,
}

impl IInitializeWithFile_Impl for Preview_Impl {
    fn Initialize(&self, path: &PCWSTR, _mode: u32) -> Result<()> {
        self.st.borrow_mut().path = Some(PathBuf::from(unsafe { path.to_string() }?));
        Ok(())
    }
}

impl IPreviewHandler_Impl for Preview_Impl {
    fn SetWindow(&self, hwnd: HWND, prc: *const RECT) -> Result<()> {
        let mut st = self.st.borrow_mut();
        st.parent = hwnd;
        if !prc.is_null() {
            st.rect = unsafe { *prc };
        }
        if let Some(c) = &st.controller {
            unsafe {
                c.SetParentWindow(hwnd)?;
                c.SetBounds(st.rect)?;
            }
        }
        Ok(())
    }

    fn SetRect(&self, prc: *const RECT) -> Result<()> {
        if prc.is_null() {
            return Err(E_INVALIDARG.into());
        }
        let mut st = self.st.borrow_mut();
        st.rect = unsafe { *prc };
        if let Some(c) = &st.controller {
            unsafe { c.SetBounds(st.rect)? };
        }
        Ok(())
    }

    fn DoPreview(&self) -> Result<()> {
        let (path, parent) = {
            let st = self.st.borrow();
            (st.path.clone().ok_or(Error::from(E_UNEXPECTED))?, st.parent)
        };
        let script = preview_script(&path);
        let viewer = dll_path().with_file_name("web").join("viewer.html");
        let url = format!("{}?embed", file_url(&viewer));
        let data_dir = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("Mirante")
            .join("PreviewWebView2");
        let st = self.st.clone();
        let created = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(move |result, env| {
            result?;
            let env = env.ok_or(Error::from(E_FAIL))?;
            let st2 = st.clone();
            let controller_done = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |result, controller| {
                result?;
                let controller = controller.ok_or(Error::from(E_FAIL))?;
                unsafe {
                    controller.SetBounds(st2.borrow().rect)?;
                    controller.SetIsVisible(true)?;
                }
                let webview = unsafe { controller.CoreWebView2()? };
                // quando a página carregar, ela recebe o arquivo
                let js = HSTRING::from(script.as_str());
                let navigated = NavigationCompletedEventHandler::create(Box::new(move |webview, _args| {
                    if let Some(webview) = webview {
                        let ignore = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
                        unsafe { webview.ExecuteScript(&js, &ignore)? };
                    }
                    Ok(())
                }));
                let mut token = 0i64;
                unsafe {
                    webview.add_NavigationCompleted(&navigated, &mut token)?;
                    webview.Navigate(&HSTRING::from(url.as_str()))?;
                }
                st2.borrow_mut().controller = Some(controller);
                Ok(())
            }));
            unsafe { env.CreateCoreWebView2Controller(parent, &controller_done) }
        }));
        let options: ICoreWebView2EnvironmentOptions = CoreWebView2EnvironmentOptions::default().into();
        unsafe { CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &HSTRING::from(data_dir.as_os_str()), &options, &created) }
    }

    fn Unload(&self) -> Result<()> {
        let mut st = self.st.borrow_mut();
        if let Some(c) = st.controller.take() {
            unsafe { c.Close()? };
        }
        st.path = None;
        Ok(())
    }

    fn SetFocus(&self) -> Result<()> {
        if let Some(c) = &self.st.borrow().controller {
            unsafe { c.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)? };
        }
        Ok(())
    }

    fn QueryFocus(&self) -> Result<HWND> {
        let h = unsafe { GetFocus() };
        if h.is_invalid() { Err(E_FAIL.into()) } else { Ok(h) }
    }

    fn TranslateAccelerator(&self, _msg: *const MSG) -> Result<()> {
        Err(S_FALSE.into()) // nenhum atalho próprio: o Explorer trata
    }
}

impl IObjectWithSite_Impl for Preview_Impl {
    fn SetSite(&self, site: Ref<IUnknown>) -> Result<()> {
        self.st.borrow_mut().site = site.cloned();
        Ok(())
    }
    fn GetSite(&self, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        match &self.st.borrow().site {
            Some(s) => unsafe { s.query(riid, ppv).ok() },
            None => Err(E_FAIL.into()),
        }
    }
}

impl IOleWindow_Impl for Preview_Impl {
    fn GetWindow(&self) -> Result<HWND> {
        Ok(self.st.borrow().parent)
    }
    fn ContextSensitiveHelp(&self, _enter: BOOL) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
}

/// `file:///C:/pasta/arquivo` com espaços e acentos codificados.
fn file_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let enc: String = s
        .split('/')
        .map(|seg| percent_encoding::utf8_percent_encode(seg, percent_encoding::NON_ALPHANUMERIC).to_string().replace("%3A", ":"))
        .collect::<Vec<_>>()
        .join("/");
    format!("file:///{}", enc.trim_start_matches('/'))
}

/// A chamada `mirante.preview({...})` com o conteúdo do arquivo; o Typst vai compilado.
fn preview_script(path: &Path) -> String {
    let text = crate::read_text(path).unwrap_or_default();
    let kind = crate::viewer_kind(path);
    let base = path.parent().map(|d| format!("{}/", file_url(d))).unwrap_or_default();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut payload = json!({ "kind": kind, "text": text, "name": name, "base": base });
    if kind == "typ" {
        let v = crate::typst_doc::render(path, text);
        if let Some(pages) = v.get("pages") {
            payload["pages"] = pages.clone();
        } else {
            // erro de compilação: mostra o código
            payload["kind"] = json!("txt");
        }
    }
    format!("mirante.preview({payload})")
}

/* ---------------------------------------------------------------- registro (HKCU) */

fn set_value(key: &str, name: Option<&str>, value: &str) -> Result<()> {
    let mut h = HKEY::default();
    unsafe {
        RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(key), None, None, REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut h, None).ok()?;
        let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
        let r = match name {
            Some(n) => RegSetValueExW(h, &HSTRING::from(n), None, REG_SZ, Some(bytes)),
            None => RegSetValueExW(h, PCWSTR::null(), None, REG_SZ, Some(bytes)),
        };
        let _ = RegCloseKey(h);
        r.ok()
    }
}

fn delete_tree(key: &str) {
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key));
    }
}

fn clsid_str(g: &GUID) -> String {
    format!("{{{g:?}}}")
}

#[unsafe(no_mangle)]
extern "system" fn DllRegisterServer() -> HRESULT {
    match register() {
        Ok(()) => S_OK,
        Err(e) => e.code(),
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllUnregisterServer() -> HRESULT {
    unregister();
    S_OK
}

fn register() -> Result<()> {
    let dll = dll_path().to_string_lossy().into_owned();
    let (thumb, prev) = (clsid_str(&CLSID_THUMBNAIL), clsid_str(&CLSID_PREVIEW));
    for (clsid, name) in [(&thumb, "Mirante: miniaturas"), (&prev, "Mirante: painel de visualização")] {
        let k = format!(r"Software\Classes\CLSID\{clsid}");
        set_value(&k, None, name)?;
        set_value(&format!(r"{k}\InprocServer32"), None, &dll)?;
        set_value(&format!(r"{k}\InprocServer32"), Some("ThreadingModel"), "Apartment")?;
    }
    let k = format!(r"Software\Classes\CLSID\{prev}");
    set_value(&k, Some("AppID"), PREVHOST_APPID)?;
    set_value(&k, Some("DisplayName"), "Mirante")?;
    for ext in THUMB_EXT {
        set_value(&format!(r"Software\Classes\{ext}\ShellEx\{SHELLEX_THUMBNAIL}"), None, &thumb)?;
    }
    for ext in PREVIEW_EXT {
        set_value(&format!(r"Software\Classes\{ext}\ShellEx\{SHELLEX_PREVIEW}"), None, &prev)?;
    }
    set_value(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers", Some(&prev), "Mirante")?;
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    Ok(())
}

fn unregister() {
    let (thumb, prev) = (clsid_str(&CLSID_THUMBNAIL), clsid_str(&CLSID_PREVIEW));
    for ext in THUMB_EXT {
        delete_tree(&format!(r"Software\Classes\{ext}\ShellEx\{SHELLEX_THUMBNAIL}"));
    }
    for ext in PREVIEW_EXT {
        delete_tree(&format!(r"Software\Classes\{ext}\ShellEx\{SHELLEX_PREVIEW}"));
    }
    delete_tree(&format!(r"Software\Classes\CLSID\{thumb}"));
    delete_tree(&format!(r"Software\Classes\CLSID\{prev}"));
    unsafe {
        let mut h = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, w!(r"Software\Microsoft\Windows\CurrentVersion\PreviewHandlers"), None, KEY_WRITE, &mut h).is_ok() {
            let _ = RegDeleteValueW(h, &HSTRING::from(prev.as_str()));
            let _ = RegCloseKey(h);
        }
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
}
