#!/usr/bin/env python3
"""Mirante — visualizador e editor de Markdown (.md) e Mermaid (.mmd) para Linux."""

import json
import os
import subprocess
import sys
from urllib.parse import unquote, urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, GObject, Gtk, WebKit2  # noqa: E402

APP_ID = "io.github.mirante.Viewer"
APP_NAME = "Mirante"
APP_VERSION = "2.0.0"
APP_DIR = os.path.dirname(os.path.realpath(__file__))
VIEWER_URI = GLib.filename_to_uri(os.path.join(APP_DIR, "viewer.html"), None)
WORKER_URI = GLib.filename_to_uri(os.path.join(APP_DIR, "worker.html"), None)
CONFIG_DIR = os.path.join(GLib.get_user_config_dir(), "mirante")
SETTINGS_FILE = os.path.join(CONFIG_DIR, "settings.json")

MD_EXT = {".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx", ".txt"}
MMD_EXT = {".mmd", ".mermaid"}

HEADER_CSS = b"""
headerbar.mirante {
  background: #111216; background-image: none; border: none; box-shadow: none;
  min-height: 44px; color: #f5f5f7;
}
headerbar.mirante.light { background: #f2f2f7; color: #1c1c1e; }
headerbar.mirante button {
  background: transparent; background-image: none; border: none; box-shadow: none;
  border-radius: 10px; min-height: 30px; min-width: 30px; color: inherit;
}
headerbar.mirante button:hover { background: alpha(currentColor, 0.08); }
headerbar.mirante button:active, headerbar.mirante button:checked { background: alpha(currentColor, 0.14); }
headerbar.mirante button.save-btn {
  background: #0A84FF; color: #ffffff; padding: 0 14px; font-weight: 600; border-radius: 999px;
}
headerbar.mirante button.save-btn:hover { background: #3395ff; }
headerbar.mirante .title { font-weight: 700; }
headerbar.mirante .subtitle { opacity: 0.55; }
headerbar.mirante button.titlebutton { min-width: 24px; min-height: 24px; }
"""


def kind_for(path):
    ext = os.path.splitext(path)[1].lower()
    return "mmd" if ext in MMD_EXT else "md"


def tilde(path):
    home = os.path.expanduser("~")
    return "~" + path[len(home):] if path == home or path.startswith(home + os.sep) else path


def boot_script(dark):
    """Roda antes do HTML da página: ela já nasce no tema salvo, sem piscar no tema errado."""
    return WebKit2.UserScript.new(
        "window.MIRANTE_THEME = %s;" % json.dumps("dark" if dark else "light"),
        WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None)


def system_prefers_dark():
    try:
        out = subprocess.run(
            ["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"],
            capture_output=True, text=True, timeout=2,
        ).stdout
        if "dark" in out:
            return True
        if "light" in out or "default" in out:
            return False
    except Exception:
        pass
    settings = Gtk.Settings.get_default()
    return bool(settings and settings.props.gtk_application_prefer_dark_theme)


class Settings:
    """Preferências em ~/.config/mirante/settings.json (padrões + ajustes por arquivo)."""

    def __init__(self):
        self.data = {"theme": None, "defaults": {}, "files": {}, "recent": []}
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                self.data.update(json.load(f))
        except (OSError, ValueError):
            pass

    def save(self):
        try:
            os.makedirs(CONFIG_DIR, exist_ok=True)
            tmp = SETTINGS_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, SETTINGS_FILE)
        except OSError:
            pass

    GLOBAL_KEYS = ("glass", "autoHideDock", "editorWidth", "renderMode")

    def prefs_for(self, path):
        d = self.data.get("defaults") or {}
        p = dict(d)
        p.update((self.data.get("files") or {}).get(path, {}))
        p.update({k: d[k] for k in self.GLOBAL_KEYS if k in d})  # globais valem para todos os arquivos
        return p

    def get(self, key, default=None):
        return (self.data.get("defaults") or {}).get(key, default)

    def set_prefs(self, path, prefs):
        self.data["defaults"] = dict(prefs)
        files = self.data.setdefault("files", {})
        if path:
            files.pop(path, None)
            files[path] = {k: v for k, v in prefs.items() if k not in self.GLOBAL_KEYS}
            while len(files) > 300:
                files.pop(next(iter(files)))
        self.save()

    RECENT_MAX = 8

    def recent(self):
        """Últimos arquivos abertos, do mais novo para o mais antigo: só nome e caminho."""
        out = []
        for r in self.data.get("recent") or []:
            if isinstance(r, dict) and isinstance(r.get("path"), str):
                out.append({"name": r.get("name") or os.path.basename(r["path"]), "path": r["path"]})
        return out

    def add_recent(self, path):
        items = [r for r in self.recent() if r["path"] != path]
        items.insert(0, {"name": os.path.basename(path), "path": path})
        self.data["recent"] = items[:self.RECENT_MAX]
        self.save()

    @property
    def theme(self):
        return self.data.get("theme")

    @theme.setter
    def theme(self, value):
        self.data["theme"] = value
        self.save()


def classify_hardware(renderer, threaded, policy, cores, ram_gb):
    """Escolhe o modo de renderização pelo hardware. Retorna (modo, motivo)."""
    r = (renderer or "").lower()
    if not r or policy == "never" or any(k in r for k in ("llvmpipe", "softpipe", "swrast", "software")):
        return "performance", "sem aceleração de GPU"
    integrated = any(k in r for k in (
        "intel", "uhd", "iris", "radeon graphics", "vega 3", "vega 6", "vega 8", "vega 10", "vega 11", "renoir",
        "cezanne", "rembrandt", "phoenix", "raphael", "lucienne", "barcelo", "mendocino", "vangogh", "gfx90c",
        "mali", "adreno", "videocore", "apple", "880m", "780m", "760m", "680m", "660m"))
    discrete = any(k in r for k in (
        "geforce", "nvidia", "quadro", "rtx", "radeon rx", "radeon pro", "navi", "polaris", "radeon vii",
        "intel(r) arc", "arc a", "arc b")) and not integrated
    cpu_paint = "cpu" in (threaded or "").lower()
    if discrete and not cpu_paint:
        if cores >= 6 and ram_gb >= 8:
            return "quality", "GPU dedicada"
        return "balanced", "GPU dedicada, CPU/RAM modestas"
    if integrated:
        if cores >= 4 and ram_gb >= 8 and not cpu_paint:
            return "balanced", "GPU integrada"
        return "performance", "GPU integrada e máquina modesta"
    return ("balanced", "GPU não identificada") if cores >= 4 else ("performance", "máquina modesta")


class HardwareProbe:
    """Lê a página interna webkit://gpu (numa WebView sem janela) para saber se o WebKit está usando
    a GPU e qual placa é, junta com núcleos de CPU e RAM e classifica o computador."""

    def __init__(self, on_done):
        self.on_done = on_done
        self.web = WebKit2.WebView()
        self.web.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        self.web.connect("load-changed", self._loaded)
        self.web.load_uri("webkit://gpu")

    def _loaded(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(1200, self._read)

    def _read(self):
        self.web.evaluate_javascript("document.body.innerText", -1, None, None, None, self._parse, None)
        return False

    def _parse(self, web, res, *_):
        try:
            lines = [l.strip() for l in web.evaluate_javascript_finish(res).to_string().splitlines()]
        except GLib.Error:
            lines = []
        val = lambda key: next((lines[i + 1] for i, l in enumerate(lines[:-1]) if l == key), "")
        renderer, threaded, policy = val("GL_RENDERER"), val("Threaded rendering"), val("Policy")
        cores = os.cpu_count() or 2
        ram_gb = 0
        try:
            with open("/proc/meminfo") as f:
                ram_gb = round(int(next(l for l in f if l.startswith("MemTotal")).split()[1]) / 1048576)
        except (OSError, StopIteration, ValueError):
            pass
        mode, reason = classify_hardware(renderer, threaded, policy, cores, ram_gb)
        gpu = renderer.split(" (")[0] if renderer else "sem GPU"
        self.on_done({"mode": mode, "reason": reason, "gpu": gpu, "cores": cores, "ramGB": ram_gb,
                      "label": f"{gpu} · {cores} núcleos · {ram_gb} GB · {reason}"})
        self.web = None


class RenderWorker:
    """WebView invisível (sem janela) que roda em OUTRO processo do WebKit e desenha os diagramas
    Mermaid. Assim os ~400 ms de um diagrama grande não travam a janela principal, que só recebe
    o SVG pronto. Um por aplicativo, compartilhado por todas as janelas."""

    def __init__(self):
        self.ready = False
        self.queue = []
        self.web = WebKit2.WebView()
        st = self.web.get_settings()
        st.set_allow_file_access_from_file_urls(True)
        st.set_enable_javascript(True)
        self.web.connect("load-changed", self._on_load)
        self.web.connect("web-process-terminated", self._on_crash)
        self.web.load_uri(WORKER_URI)

    def _on_load(self, _web, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.ready = True
            queued, self.queue = self.queue, []
            for job, cb in queued:
                self.render(job, cb)

    def _on_crash(self, *_):
        self.ready = False
        self.web.load_uri(WORKER_URI)

    def render(self, job, cb):
        if not self.ready:
            self.queue.append((job, cb))
            return

        def finish(web, res, *_):
            try:
                cb(json.loads(web.call_async_javascript_function_finish(res).to_string()))
            except (GLib.Error, ValueError):
                cb({"workerFailed": True})

        self.web.call_async_javascript_function(
            "return JSON.stringify(await window.mmRender(JSON.parse(job)))", -1,
            GLib.Variant("a{sv}", {"job": GLib.Variant("s", json.dumps(job))}),
            None, None, None, finish, None)


class EditorWindow(Gtk.Window):
    """Janela só com o editor de código. Cada alteração vai direto para a janela principal,
    que redesenha o conteúdo ao vivo; o histórico (desfazer) e o salvar ficam na principal."""

    def __init__(self, main, text):
        super().__init__(title="Código")
        self.main = main
        self.set_default_size(560, 820)
        self.set_icon_name("mirante")
        self.ready = False
        self.initial_text = text
        hb = Gtk.HeaderBar(show_close_button=True)
        hb.get_style_context().add_class("mirante")
        self.set_titlebar(hb)
        self.header = hb
        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler("mirante")
        ucm.connect("script-message-received::mirante", self._on_message)
        ucm.add_script(boot_script(main.dark))
        self.web = WebKit2.WebView.new_with_user_content_manager(ucm)
        st = self.web.get_settings()
        st.set_allow_file_access_from_file_urls(True)
        st.set_enable_developer_extras(True)
        self.web.connect("load-changed", self._on_load)
        self.web.connect("decide-policy", self._on_policy)
        self.add(self.web)
        self.apply_theme()
        self.web.load_uri(VIEWER_URI + "?editor=1")
        self.connect("destroy", lambda *_: main._editor_closed(self))

    def js(self, code):
        if self.ready:
            self.web.evaluate_javascript(code + ";void 0", -1, None, None, None, None, None)

    def apply_theme(self):
        bg = Gdk.RGBA()
        bg.parse("#111216" if self.main.dark else "#f2f2f7")
        self.web.set_background_color(bg)
        ctx = self.header.get_style_context()
        (ctx.remove_class if self.main.dark else ctx.add_class)("light")
        self.js("mirante.setTheme(%s)" % json.dumps("dark" if self.main.dark else "light"))

    def update_title(self):
        name = os.path.basename(self.main.path) if self.main.path else ""
        mark = "● " if self.main.dirty else ""
        self.header.set_title(f"{mark}Código")
        self.header.set_subtitle(name)
        self.set_title(f"{mark}Código — {name}")

    def _on_load(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.ready = True
            self.js("mirante.initEditor(%s)" % json.dumps(
                {"text": self.initial_text, "theme": "dark" if self.main.dark else "light"}))

    def _on_policy(self, _web, decision, dtype):
        if dtype == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(VIEWER_URI):
                decision.ignore()
                return True
        return False

    def _on_message(self, _ucm, js_result):
        try:
            msg = json.loads(js_result.get_js_value().to_string())
        except (ValueError, GLib.Error):
            return
        t, m = msg.get("type"), self.main
        if t == "edit":
            m._js("mirante.applyExternalEdit(%s)" % json.dumps(msg.get("text", "")))
        elif t in ("undo", "redo"):
            m._js(f"mirante.{t}()")
        elif t == "caret":
            m._js("mirante.selectLine(%d)" % int(msg.get("line", 0)))
        elif t == "save":
            m.save()
        elif t == "closeEditor":
            self.destroy()
        elif t == "attach":
            self.destroy()
            m._js("mirante.toggleEditor(true)")
            m.present()


class ViewerWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app)
        self.set_default_size(1180, 820)
        self.set_icon_name("mirante")

        self.path = None
        self.monitor = None
        self.reload_source = 0
        self.page_ready = False
        self.pending = None
        self.dirty = False
        self.last_text = None  # conteúdo que sabemos estar no disco
        self.dark = app.dark
        self.editor_win = None

        self._build_header()
        self._build_body()
        self._build_actions()
        self._apply_header_theme()
        self._update_title()
        self.connect("delete-event", self._on_delete)
        self.connect("destroy", lambda *_: self.editor_win and self.editor_win.destroy())

    # ---------- UI ----------
    def _build_header(self):
        hb = Gtk.HeaderBar(show_close_button=True)
        hb.get_style_context().add_class("mirante")
        self.set_titlebar(hb)
        self.header = hb

        def icon_button(icon, action, tip):
            b = Gtk.Button.new_from_icon_name(icon, Gtk.IconSize.BUTTON)
            b.set_action_name(action)
            b.set_tooltip_text(tip)
            return b

        hb.pack_start(icon_button("document-open-symbolic", "win.open", "Abrir arquivo (Ctrl+O)"))

        self.save_btn = Gtk.Button(label="Salvar")
        self.save_btn.get_style_context().add_class("save-btn")
        self.save_btn.set_action_name("win.save")
        self.save_btn.set_tooltip_text("Salvar alterações (Ctrl+S)")
        self.save_btn.set_no_show_all(True)
        hb.pack_start(self.save_btn)

        menu = Gio.Menu()
        sec = Gio.Menu()
        sec.append("Editor de código", "win.toggle-editor")
        sec.append("Editor de código em janela separada", "win.detach-editor")
        sec.append("Abrir no editor de texto externo", "win.edit")
        sec.append("Mostrar na pasta", "win.folder")
        menu.append_section(None, sec)
        sec = Gio.Menu()
        sec.append("Exportar diagrama como SVG…", "win.export-svg")
        sec.append("Imprimir / salvar PDF…", "win.print")
        menu.append_section(None, sec)
        sec = Gio.Menu()
        sec.append("Recarregar do disco", "win.reload")
        sec.append("Tema escuro", "win.dark")
        sec.append("Ocultar barra inferior automaticamente", "win.autohide")
        modes = Gio.Menu()
        for label, val in (("Automático", "auto"), ("Desempenho", "performance"),
                           ("Equilibrado", "balanced"), ("Qualidade", "quality")):
            modes.append(label, f"win.render-mode::{val}")
        sec.append_submenu("Renderização", modes)
        sec.append("Nova janela", "app.new-window")
        menu.append_section(None, sec)
        sec = Gio.Menu()
        sec.append("Atalhos de teclado", "win.shortcuts")
        sec.append("Sobre o Mirante", "win.about")
        menu.append_section(None, sec)
        menu_btn = Gtk.MenuButton(menu_model=menu)
        menu_btn.set_image(Gtk.Image.new_from_icon_name("open-menu-symbolic", Gtk.IconSize.BUTTON))
        hb.pack_end(menu_btn)

        find_btn = Gtk.ToggleButton()
        find_btn.set_image(Gtk.Image.new_from_icon_name("edit-find-symbolic", Gtk.IconSize.BUTTON))
        find_btn.set_tooltip_text("Buscar (Ctrl+F)")
        hb.pack_end(find_btn)
        self.find_btn = find_btn

    def _build_body(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.add(box)

        self.search_bar = Gtk.SearchBar(show_close_button=True)
        self.search_entry = Gtk.SearchEntry(width_chars=40)
        sbox = Gtk.Box(spacing=6)
        sbox.pack_start(self.search_entry, True, True, 0)
        prev_b = Gtk.Button.new_from_icon_name("go-up-symbolic", Gtk.IconSize.BUTTON)
        next_b = Gtk.Button.new_from_icon_name("go-down-symbolic", Gtk.IconSize.BUTTON)
        prev_b.connect("clicked", lambda *_: self.find.search_previous())
        next_b.connect("clicked", lambda *_: self.find.search_next())
        sbox.pack_start(prev_b, False, False, 0)
        sbox.pack_start(next_b, False, False, 0)
        self.match_label = Gtk.Label()
        self.match_label.get_style_context().add_class("dim-label")
        sbox.pack_start(self.match_label, False, False, 6)
        self.search_bar.add(sbox)
        self.search_bar.connect_entry(self.search_entry)
        self.find_btn.bind_property("active", self.search_bar, "search-mode-enabled",
                                    GObject.BindingFlags.BIDIRECTIONAL)
        box.pack_start(self.search_bar, False, False, 0)

        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler("mirante")
        ucm.connect("script-message-received::mirante", self._on_message)
        ucm.add_script(boot_script(self.dark))
        self.web = WebKit2.WebView.new_with_user_content_manager(ucm)
        s = self.web.get_settings()
        s.set_allow_file_access_from_file_urls(True)
        s.set_allow_universal_access_from_file_urls(True)
        s.set_enable_developer_extras(True)
        s.set_enable_back_forward_navigation_gestures(False)
        s.set_javascript_can_open_windows_automatically(False)
        s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        self._set_web_bg()
        self.web.connect("load-changed", self._on_load_changed)
        self.web.connect("decide-policy", self._on_decide_policy)
        self.web.connect("create", lambda *_: None)
        box.pack_start(self.web, True, True, 0)

        self.find = self.web.get_find_controller()
        self.find.connect("counted-matches", self._on_counted)
        self.find.connect("failed-to-find-text", lambda *_: self.match_label.set_text("Nenhum resultado"))
        self.search_entry.connect("search-changed", self._on_search_changed)
        self.search_entry.connect("activate", lambda *_: self.find.search_next())
        self.search_entry.connect("stop-search", lambda *_: self.find_btn.set_active(False))
        self.search_bar.connect("notify::search-mode-enabled", self._on_search_mode)

        self.web.load_uri(VIEWER_URI)

    def _build_actions(self):
        app = self.get_application()

        def add(name, cb, accels=()):
            a = Gio.SimpleAction.new(name, None)
            a.connect("activate", lambda *_: cb())
            self.add_action(a)
            if accels:
                app.set_accels_for_action("win." + name, list(accels))
            return a

        add("open", self.open_dialog, ["<Control>o"])
        add("save", self.save, ["<Control>s"])
        add("reload", self.reload_from_disk, ["F5", "<Control>r"])
        add("toggle-editor", lambda: self._js("mirante.toggleEditor()"), ["<Control>e"])
        add("edit", self.open_in_editor)
        add("folder", self.show_in_folder)
        add("export-svg", self.export_svg, ["<Control><Shift>e"])
        add("print", self.print_doc, ["<Control>p"])
        add("zoom-in", lambda: self._js("mirante.zoomBy(1)"), ["<Control>plus", "<Control>equal", "<Control>KP_Add"])
        add("zoom-out", lambda: self._js("mirante.zoomBy(-1)"), ["<Control>minus", "<Control>KP_Subtract"])
        add("zoom-reset", lambda: self._js("mirante.zoomBy(0)"), ["<Control>0", "<Control>KP_0"])
        add("fit", lambda: self._js("mirante.fit()"), ["<Control>1"])
        add("find", lambda: self.find_btn.set_active(True), ["<Control>f"])
        add("close", self.close, ["<Control>w"])
        add("shortcuts", self.show_shortcuts, ["<Control>question", "F1"])
        add("about", self.show_about)

        add("detach-editor", self.open_editor_window, ["<Control><Shift>o"])
        hide = Gio.SimpleAction.new_stateful(
            "autohide", None, GLib.Variant.new_boolean(bool(app.settings.get("autoHideDock", False))))
        hide.connect("activate", lambda a, _p: self._js(
            "mirante.setPref('autoHideDock', %s)" % json.dumps(not a.get_state().get_boolean())))
        self.add_action(hide)

        rmode = Gio.SimpleAction.new_stateful(
            "render-mode", GLib.VariantType.new("s"), GLib.Variant.new_string(app.settings.get("renderMode", "auto") or "auto"))
        rmode.connect("activate", lambda a, v: (a.set_state(v), self._js("mirante.setPref('renderMode', %s)" % json.dumps(v.get_string()))))
        self.add_action(rmode)

        dark = Gio.SimpleAction.new_stateful("dark", None, GLib.Variant.new_boolean(self.dark))
        dark.connect("activate", lambda a, _p: self.set_dark(not a.get_state().get_boolean(), notify_page=True))
        self.add_action(dark)
        app.set_accels_for_action("win.dark", ["<Control>d"])

        self._file_actions = ["reload", "edit", "folder", "print", "save", "toggle-editor", "detach-editor"]
        self._sync_actions()

    def _sync_actions(self):
        has = self.path is not None
        for name in self._file_actions:
            self.lookup_action(name).set_enabled(has)
        self.lookup_action("export-svg").set_enabled(has and kind_for(self.path) == "mmd")

    def _update_title(self):
        if self.path:
            name = os.path.basename(self.path)
            folder = tilde(os.path.dirname(self.path))
            mark = "● " if self.dirty else ""
            self.header.set_title(mark + name)
            self.header.set_subtitle(folder)
            self.set_title(f"{mark}{name} — {APP_NAME}")
        else:
            self.header.set_title(APP_NAME)
            self.header.set_subtitle(None)
            self.set_title(APP_NAME)
        self.save_btn.set_visible(self.dirty)
        if self.editor_win:
            self.editor_win.update_title()

    def _set_web_bg(self):
        bg = Gdk.RGBA()
        bg.parse("#111216" if self.dark else "#f2f2f7")
        self.web.set_background_color(bg)

    def _apply_header_theme(self):
        ctx = self.header.get_style_context()
        if self.dark:
            ctx.remove_class("light")
        else:
            ctx.add_class("light")

    def set_dark(self, dark, notify_page=False, remember=True):
        self.dark = dark
        app = self.get_application()
        app.dark = dark
        Gtk.Settings.get_default().props.gtk_application_prefer_dark_theme = dark
        self.lookup_action("dark").set_state(GLib.Variant.new_boolean(dark))
        self._set_web_bg()
        self._apply_header_theme()
        if remember:
            app.settings.theme = "dark" if dark else "light"
        if notify_page and self.page_ready:
            self._js("mirante.setTheme(%s)" % json.dumps("dark" if dark else "light"))
        if self.editor_win:
            self.editor_win.apply_theme()

    # ---------- arquivo ----------
    def open_path(self, path):
        path = os.path.realpath(path)
        if not os.path.isfile(path):
            self._error(f"Arquivo não encontrado:\n{path}")
            return
        if self.dirty and path != self.path and not self._confirm_discard():
            return
        self.path = path
        self.dirty = False
        self._watch(path)
        self._update_title()
        self._sync_actions()
        self.get_application().note_recent(path)
        self._load(keep_scroll=False)

    def _read(self):
        with open(self.path, "rb") as f:
            return f.read().decode("utf-8", errors="replace")

    def _load(self, keep_scroll):
        if not self.path:
            return
        try:
            text = self._read()
        except OSError as e:
            self._error(f"Não foi possível ler o arquivo:\n{e}")
            return
        self.last_text = text
        payload = {
            "kind": kind_for(self.path),
            "text": text,
            "path": self.path,
            "base": GLib.filename_to_uri(os.path.dirname(self.path) + os.sep, None),
            "keepScroll": keep_scroll,
            "prefs": self.get_application().settings.prefs_for(self.path),
        }
        if self.page_ready:
            self._js("mirante.render(%s)" % json.dumps(payload))
        else:
            self.pending = payload

    def reload_from_disk(self):
        if self.dirty and not self._confirm_discard():
            return
        self._load(keep_scroll=True)

    def save(self, then=None):
        if not self.path:
            return

        def done(text, err):
            if err:
                self._error(f"Falha ao obter o conteúdo: {err}")
                return
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    f.write(text)
            except OSError as e:
                self._error(f"Não foi possível salvar:\n{e}")
                return
            self.last_text = text
            self._js("mirante.markSaved(); mirante.toast('Salvo')")
            self.dirty = False
            self._update_title()
            if then:
                then()

        self._eval("mirante.getSource()", done)

    def _watch(self, path):
        if self.monitor:
            self.monitor.cancel()
        self.monitor = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, None)
        self.monitor.connect("changed", self._on_file_changed)

    def _on_file_changed(self, _mon, _f, _other, event):
        if event in (
            Gio.FileMonitorEvent.CHANGED, Gio.FileMonitorEvent.CHANGES_DONE_HINT,
            Gio.FileMonitorEvent.CREATED, Gio.FileMonitorEvent.MOVED_IN, Gio.FileMonitorEvent.RENAMED,
        ):
            if self.reload_source:
                GLib.source_remove(self.reload_source)
            self.reload_source = GLib.timeout_add(150, self._debounced_reload)

    def _debounced_reload(self):
        self.reload_source = 0
        if not (self.path and os.path.exists(self.path)):
            return False
        try:
            text = self._read()
        except OSError:
            return False
        if text == self.last_text:
            return False  # nossa própria gravação, ou nada mudou
        if self.dirty:
            self._js("mirante.toast(%s, 6000)" % json.dumps(
                "O arquivo mudou no disco. F5 recarrega (descarta suas edições)."))
            return False
        self._load(keep_scroll=True)
        return False

    def open_dialog(self):
        dlg = Gtk.FileChooserNative.new("Abrir arquivo", self, Gtk.FileChooserAction.OPEN, "_Abrir", "_Cancelar")
        f = Gtk.FileFilter()
        f.set_name("Markdown e Mermaid")
        for ext in sorted(MD_EXT | MMD_EXT):
            f.add_pattern("*" + ext)
            f.add_pattern("*" + ext.upper())
        dlg.add_filter(f)
        for name, exts in (("Markdown", MD_EXT), ("Mermaid", MMD_EXT)):
            ff = Gtk.FileFilter()
            ff.set_name(name)
            for ext in sorted(exts):
                ff.add_pattern("*" + ext)
            dlg.add_filter(ff)
        allf = Gtk.FileFilter()
        allf.set_name("Todos os arquivos")
        allf.add_pattern("*")
        dlg.add_filter(allf)
        if self.path:
            dlg.set_current_folder(os.path.dirname(self.path))
        if dlg.run() == Gtk.ResponseType.ACCEPT:
            self.open_path(dlg.get_filename())
        dlg.destroy()

    def open_editor_window(self):
        if not self.path:
            return
        if self.editor_win:
            self.editor_win.present()
            return

        def got(text, err):
            if err or self.editor_win:
                return
            self.editor_win = EditorWindow(self, text or "")
            self.editor_win.update_title()
            self.editor_win.show_all()
            self._js("mirante.setDetached(true)")

        self._eval("mirante.getSource()", got)

    def _editor_closed(self, win):
        if self.editor_win is win:
            self.editor_win = None
            self._js("mirante.setDetached(false)")

    def open_in_editor(self):
        if self.path:
            try:
                subprocess.Popen(["gnome-text-editor", self.path])
            except FileNotFoundError:
                Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(self.path, None), None)

    def show_in_folder(self):
        if self.path:
            Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(os.path.dirname(self.path), None), None)

    # ---------- exportar / imprimir ----------
    def export_svg(self):
        def done(svg, err):
            if err:
                self._error(f"Falha ao exportar: {err}")
                return
            if not svg:
                self._error("Não há diagrama renderizado para exportar.")
                return
            dlg = Gtk.FileChooserNative.new("Exportar SVG", self, Gtk.FileChooserAction.SAVE, "_Salvar", "_Cancelar")
            dlg.set_do_overwrite_confirmation(True)
            dlg.set_current_folder(os.path.dirname(self.path))
            dlg.set_current_name(os.path.splitext(os.path.basename(self.path))[0] + ".svg")
            if dlg.run() == Gtk.ResponseType.ACCEPT:
                with open(dlg.get_filename(), "w", encoding="utf-8") as f:
                    f.write(svg)
            dlg.destroy()

        self._eval("mirante.getSvg()", done)

    def print_doc(self):
        WebKit2.PrintOperation.new(self.web).run_dialog(self)

    # ---------- ponte com a página ----------
    def _js(self, code):
        if self.page_ready:
            self.web.evaluate_javascript(code + ";void 0", -1, None, None, None, None, None)

    def _eval(self, code, cb):
        """Executa JS e chama cb(texto, erro) com o resultado convertido em string."""
        def finish(web, res, *_):
            try:
                cb(web.evaluate_javascript_finish(res).to_string(), None)
            except GLib.Error as e:
                cb(None, e.message)
        self.web.evaluate_javascript(code, -1, None, None, None, finish, None)

    def _on_message(self, _ucm, js_result):
        try:
            msg = json.loads(js_result.get_js_value().to_string())
        except (ValueError, GLib.Error):
            return
        t = msg.get("type")
        if t == "dirty":
            self.dirty = bool(msg.get("value"))
            self._update_title()
        elif t == "prefs":
            prefs = msg.get("prefs") or {}
            self.get_application().settings.set_prefs(self.path, prefs)
            self.lookup_action("autohide").set_state(GLib.Variant.new_boolean(bool(prefs.get("autoHideDock"))))
            self.lookup_action("render-mode").set_state(GLib.Variant.new_string(prefs.get("renderMode") or "auto"))
        elif t == "source" and self.editor_win:
            self.editor_win.js("mirante.setSource(%s)" % json.dumps(msg.get("text", "")))
        elif t == "reveal" and self.editor_win:
            self.editor_win.js("mirante.revealLine(%d)" % int(msg.get("line", 0)))
        elif t == "mmdRender":
            rid = msg.get("id")
            job = {"id": rid, "code": msg.get("code", ""), "gen": msg.get("gen", 0),
                   "chan": id(self), "config": msg.get("config") or {}}

            def done(result, rid=rid):
                result["id"] = rid
                self._js("mirante.mmdDone(%s)" % json.dumps(result))
            self.get_application().worker.render(job, done)
        elif t == "detach":
            self.open_editor_window()
        elif t == "focusEditor" and self.editor_win:
            self.editor_win.present()
        elif t == "theme":
            self.set_dark(msg.get("value") == "dark")
        elif t == "openRecent":
            path = msg.get("path")
            if any(r["path"] == path for r in self.get_application().settings.recent()):
                self.open_path(path)

    def _on_load_changed(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED and web.get_uri() == VIEWER_URI:
            self.page_ready = True
            self._js("mirante.enableWorker()")
            hw = self.get_application().hardware
            if hw:
                self._js("mirante.setDetected(%s)" % json.dumps(hw))
            self._js("mirante.setTheme(%s)" % json.dumps("dark" if self.dark else "light"))
            if self.pending:
                p, self.pending = self.pending, None
                self._js("mirante.render(%s)" % json.dumps(p))
            else:  # a página espera esta decisão na tela de carregamento: nada a abrir → boas-vindas
                self._js("mirante.showWelcome(%s)" % json.dumps({"recent": self._recent_items()}))

    def _recent_items(self):
        return [{"name": r["name"], "path": r["path"], "folder": tilde(os.path.dirname(r["path"])),
                 "kind": kind_for(r["path"])}
                for r in self.get_application().settings.recent() if os.path.isfile(r["path"])]

    def _on_decide_policy(self, _web, decision, dtype):
        if dtype not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        uri = decision.get_navigation_action().get_request().get_uri()
        if uri == VIEWER_URI or uri.startswith(VIEWER_URI + "#"):
            return False
        decision.ignore()
        parsed = urlparse(uri)
        if parsed.scheme == "file":
            target = unquote(parsed.path)
            if os.path.isfile(target):
                ext = os.path.splitext(target)[1].lower()
                if ext in MD_EXT or ext in MMD_EXT:
                    self.open_path(target)
                    return True
            if os.path.exists(target):
                Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(target, None), None)
            return True
        if parsed.scheme in ("http", "https", "mailto", "ftp"):
            try:
                Gtk.show_uri_on_window(self, uri, Gdk.CURRENT_TIME)
            except GLib.Error:
                pass
        return True

    # ---------- busca ----------
    def _on_search_changed(self, entry):
        text = entry.get_text()
        if not text:
            self.find.search_finish()
            self.match_label.set_text("")
            return
        opts = WebKit2.FindOptions.CASE_INSENSITIVE | WebKit2.FindOptions.WRAP_AROUND
        self.find.count_matches(text, opts, 9999)
        self.find.search(text, opts, 9999)

    def _on_counted(self, _fc, n):
        self.match_label.set_text((f"{n} resultado" + ("" if n == 1 else "s")) if n else "Nenhum resultado")

    def _on_search_mode(self, bar, _p):
        if not bar.get_search_mode():
            self.find.search_finish()
            self.match_label.set_text("")

    # ---------- fechar com alterações ----------
    def _ask_unsaved(self):
        name = os.path.basename(self.path) if self.path else "arquivo"
        d = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                              text=f"Salvar as alterações em “{name}”?")
        d.format_secondary_text("Se você não salvar, as alterações serão perdidas.")
        d.add_button("Descartar", Gtk.ResponseType.REJECT)
        d.add_button("Cancelar", Gtk.ResponseType.CANCEL)
        b = d.add_button("Salvar", Gtk.ResponseType.ACCEPT)
        b.get_style_context().add_class("suggested-action")
        d.set_default_response(Gtk.ResponseType.ACCEPT)
        r = d.run()
        d.destroy()
        return r

    def _confirm_discard(self):
        r = self._ask_unsaved()
        if r == Gtk.ResponseType.ACCEPT:
            self.save()
            return True
        return r == Gtk.ResponseType.REJECT

    def _on_delete(self, *_):
        if not self.dirty:
            return False
        r = self._ask_unsaved()
        if r == Gtk.ResponseType.ACCEPT:
            self.save(then=self.destroy)
            return True
        if r == Gtk.ResponseType.REJECT:
            return False
        return True

    # ---------- diálogos ----------
    def _error(self, msg):
        d = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.ERROR,
                              buttons=Gtk.ButtonsType.CLOSE, text=msg)
        d.run()
        d.destroy()

    def show_about(self):
        d = Gtk.AboutDialog(transient_for=self, modal=True)
        d.set_program_name(APP_NAME)
        d.set_logo_icon_name("mirante")
        d.set_version(APP_VERSION)
        d.set_comments("Visualizador e editor de Markdown e diagramas Mermaid,\ncom mapas mentais editáveis.")
        d.set_license_type(Gtk.License.MIT_X11)
        d.run()
        d.destroy()

    def show_shortcuts(self):
        groups = [
            ("Geral", [
                ("Ctrl+O", "Abrir arquivo"), ("Ctrl+S", "Salvar"), ("Ctrl+E", "Editor de código"),
                ("F5", "Recarregar do disco"), ("Ctrl+F", "Buscar"), ("Ctrl+D", "Tema claro/escuro"),
                ("Ctrl+Z / Ctrl+Shift+Z", "Desfazer / refazer"), ("Ctrl+P", "Imprimir / PDF"),
                ("Ctrl+Shift+E", "Exportar SVG"), ("Ctrl+W", "Fechar janela"),
            ]),
            ("Visualização", [
                ("Ctrl+roda / pinça", "Zoom"), ("Ctrl+= / Ctrl+− / Ctrl+0", "Zoom"),
                ("Ctrl+1", "Ajustar diagrama à janela"), ("Arrastar o fundo / roda", "Mover o diagrama"),
            ]),
            ("Mapa mental", [
                ("Clique", "Selecionar nó"), ("Duplo clique / F2", "Renomear"),
                ("Tab", "Adicionar filho"), ("Enter", "Adicionar irmão"), ("Delete", "Excluir nó e filhos"),
                ("Setas", "Navegar entre nós"), ("Alt+↑ / Alt+↓", "Mover entre irmãos"),
                ("Arrastar nó sobre outro", "Mudar de pai"),
            ]),
        ]
        d = Gtk.Dialog(title="Atalhos de teclado", transient_for=self, modal=True)
        d.add_button("Fechar", Gtk.ResponseType.CLOSE)
        outer = Gtk.Box(spacing=36, margin=20)
        for title, rows in groups:
            grid = Gtk.Grid(column_spacing=18, row_spacing=7)
            h = Gtk.Label(xalign=0)
            h.set_markup(f"<b>{GLib.markup_escape_text(title)}</b>")
            h.set_margin_bottom(6)
            grid.attach(h, 0, 0, 2, 1)
            for i, (k, desc) in enumerate(rows, start=1):
                kl = Gtk.Label(xalign=0)
                kl.set_markup(f"<tt>{GLib.markup_escape_text(k)}</tt>")
                grid.attach(kl, 0, i, 1, 1)
                grid.attach(Gtk.Label(label=desc, xalign=0), 1, i, 1, 1)
            outer.pack_start(grid, False, False, 0)
        d.get_content_area().add(outer)
        d.show_all()
        d.run()
        d.destroy()


class MiranteApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_OPEN)
        self.dark = True
        self.settings = None

    def do_startup(self):
        Gtk.Application.do_startup(self)
        self.settings = Settings()
        self.worker = RenderWorker()
        self.hardware = self.settings.data.get("hardware")   # resultado da última detecção (instantâneo)
        self._probe = HardwareProbe(self._hardware_detected)
        theme = self.settings.theme
        self.dark = system_prefers_dark() if theme not in ("dark", "light") else theme == "dark"
        Gtk.Settings.get_default().props.gtk_application_prefer_dark_theme = self.dark
        provider = Gtk.CssProvider()
        provider.load_from_data(HEADER_CSS)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        a = Gio.SimpleAction.new("new-window", None)
        a.connect("activate", lambda *_: self._new_window().present())
        self.add_action(a)
        self.set_accels_for_action("app.new-window", ["<Control>n"])

    def _new_window(self):
        w = ViewerWindow(self)
        w.show_all()
        return w

    def do_activate(self):
        (self.get_active_window() or self._new_window()).present()

    def do_open(self, files, _n, _hint):
        for gfile in files:
            path = gfile.get_path()
            if not path:
                continue
            win = self.get_active_window()
            if win is None or win.path is not None:
                win = self._new_window()
            win.open_path(path)
            win.present()

    def _hardware_detected(self, hw):
        self._probe = None
        changed = hw != self.hardware
        self.hardware = hw
        if changed:
            self.settings.data["hardware"] = hw
            self.settings.save()
        for win in self.get_windows():
            if isinstance(win, ViewerWindow):
                win._js("mirante.setDetected(%s)" % json.dumps(hw))

    def note_recent(self, path):
        self.settings.add_recent(path)
        try:
            Gtk.RecentManager.get_default().add_item(GLib.filename_to_uri(path, None))
        except Exception:
            pass


def main():
    GLib.set_application_name(APP_NAME)
    GLib.set_prgname("mirante")
    return MiranteApp().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
