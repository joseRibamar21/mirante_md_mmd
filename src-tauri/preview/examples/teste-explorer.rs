//! Teste do CI no Windows: pede ao Explorer as miniaturas de alguns arquivos (passando pelo registro, como um
//! ícone de verdade) e abre o painel de visualização de cada um numa janela, capturando a tela.
//!
//! uso: teste-explorer <pasta de saída> <arquivo>...

#[cfg(not(windows))]
fn main() {}

#[cfg(windows)]
fn main() {
    if let Err(e) = imp::main() {
        eprintln!("erro: {e:?}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use resvg::tiny_skia::{IntSize, Pixmap};
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::PropertiesSystem::IInitializeWithFile;
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::core::*;

    const CLSID_PREVIEW: GUID = GUID::from_u128(0x6c1d3b4e_8f2a_4c55_9e1b_2a7d4f0c9a02);

    pub fn main() -> Result<()> {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let out = PathBuf::from(args.first().cloned().unwrap_or_else(|| ".".into()));
        std::fs::create_dir_all(&out).ok();
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
        let mut falhas = 0;
        for f in &args[1..] {
            let name = Path::new(f).file_name().unwrap().to_string_lossy().into_owned();
            match thumbnail(f) {
                Ok(pix) => {
                    save(&pix, &out.join(format!("miniatura-{name}.png")));
                    println!("miniatura OK  {name} ({}x{})", pix.width(), pix.height());
                }
                Err(e) => {
                    falhas += 1;
                    println!("miniatura FALHOU {name}: {e:?}");
                }
            }
            match preview(f) {
                Ok(pix) => {
                    save(&pix, &out.join(format!("painel-{name}.png")));
                    println!("painel OK     {name}");
                }
                Err(e) => {
                    falhas += 1;
                    println!("painel FALHOU {name}: {e:?}");
                }
            }
        }
        if falhas > 0 { Err(Error::new(E_FAIL, format!("{falhas} falhas"))) } else { Ok(()) }
    }

    fn save(pix: &Pixmap, path: &Path) {
        if let Ok(png) = pix.encode_png() {
            let _ = std::fs::write(path, png);
        }
    }

    /// A miniatura pelo caminho do Explorer (IShellItemImageFactory), só do handler (sem ícone genérico).
    fn thumbnail(file: &str) -> Result<Pixmap> {
        let item: IShellItemImageFactory = unsafe { SHCreateItemFromParsingName(&HSTRING::from(file), None)? };
        let bmp = unsafe { item.GetImage(SIZE { cx: 256, cy: 256 }, SIIGBF_THUMBNAILONLY)? };
        let pix = from_bitmap(bmp);
        unsafe {
            let _ = DeleteObject(bmp.into());
        }
        pix
    }

    fn from_bitmap(bmp: HBITMAP) -> Result<Pixmap> {
        let mut bm = BITMAP::default();
        unsafe { GetObjectW(bmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) };
        let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
        let mut info = BITMAPINFO {
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
        let mut data = vec![0u8; (w * h * 4) as usize];
        unsafe {
            let dc = GetDC(None);
            GetDIBits(dc, bmp, 0, h as u32, Some(data.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
        }
        rgba(data, w as u32, h as u32)
    }

    fn rgba(mut bgra: Vec<u8>, w: u32, h: u32) -> Result<Pixmap> {
        for p in bgra.chunks_exact_mut(4) {
            p.swap(0, 2);
        }
        let size = IntSize::from_wh(w, h).ok_or(Error::from(E_FAIL))?;
        Pixmap::from_vec(bgra, size).ok_or(Error::from(E_FAIL))
    }

    unsafe extern "system" fn wndproc(h: HWND, m: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(h, m, w, l) }
    }

    /// Abre o painel de visualização numa janela própria, espera o WebView2 desenhar e captura a tela.
    fn preview(file: &str) -> Result<Pixmap> {
        unsafe {
            let class = w!("MiranteTestePainel");
            let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), lpszClassName: class, ..Default::default() };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class,
                w!("Painel do Mirante"),
                WS_POPUP | WS_VISIBLE,
                40,
                40,
                900,
                1000,
                None,
                None,
                None,
                None,
            )?;
            let handler: IPreviewHandler = CoCreateInstance(&CLSID_PREVIEW, None, CLSCTX_INPROC_SERVER)?;
            let init: IInitializeWithFile = handler.cast()?;
            init.Initialize(&HSTRING::from(file), 0)?;
            let rect = RECT { left: 0, top: 0, right: 900, bottom: 1000 };
            handler.SetWindow(hwnd, &rect)?;
            handler.DoPreview()?;
            // o WebView2 cria-se de forma assíncrona: as mensagens precisam andar
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(12) {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            let pix = capture(hwnd);
            let _ = handler.Unload();
            let _ = DestroyWindow(hwnd);
            pix
        }
    }

    /// Copia da tela o pedaço onde a janela está (o WebView2 desenha por composição: PrintWindow sairia preto).
    fn capture(hwnd: HWND) -> Result<Pixmap> {
        unsafe {
            let mut r = RECT::default();
            GetWindowRect(hwnd, &mut r)?;
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp.into());
            BitBlt(mem, 0, 0, w, h, Some(screen), r.left, r.top, SRCCOPY)?;
            SelectObject(mem, old);
            let pix = from_bitmap(bmp);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            pix
        }
    }
}
