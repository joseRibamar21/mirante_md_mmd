"""Grava a demonstração do Mirante (quadros brutos + capturas) para montar o GIF do README.

uso: python3 tools/demo/recorder.py <pasta_de_saida> mirante exemplos

Abre o app numa sessão isolada (pasta pessoal e preferências temporárias dentro da saída), executa o
roteiro de demo.js e grava um quadro a cada 80 ms. Precisa de uma sessão gráfica com X11 ou XWayland.
Depois rode make_gif.py com a mesma pasta de saída.
"""
import json
import os
import shutil
import sys
import time

out, app_dir, ex_dir = (os.path.abspath(a) for a in sys.argv[1:4])
if os.path.isdir(out) and os.listdir(out) and not os.path.exists(os.path.join(out, "meta.json")):
    sys.exit(f"{out} já existe e não é uma gravação anterior: escolha uma pasta nova")
os.environ["GDK_BACKEND"] = "x11"                      # no XWayland dá para ler os pixels da janela
home = os.path.join(out, "home")
docs = os.path.join(home, "Documentos", "exemplos")
shutil.rmtree(out, ignore_errors=True)
os.makedirs(docs)
for f in os.listdir(ex_dir):
    shutil.copy(os.path.join(ex_dir, f), docs)
os.environ["HOME"] = home                               # caminhos aparecem como ~/Documentos/exemplos
for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"):
    os.environ[k] = os.path.join(out, k.lower())
cfg = os.path.join(out, "xdg_config_home", "mirante")
os.makedirs(cfg)
recent = [{"name": n, "path": os.path.join(docs, n)} for n in ("bem-vindo.md", "mapa-mental.mmd", "fluxograma.mmd", "sequencia.mmd")]
json.dump({"theme": "light", "recent": recent, "files": {},
           "defaults": {"layout": "both", "glass": True, "autoHideDock": False, "renderMode": "quality", "editorWidth": 400}},
          open(os.path.join(cfg, "settings.json"), "w"))

sys.path.insert(0, app_dir)
import mirante as m  # noqa: E402
from gi.repository import Gdk, Gio, GLib  # noqa: E402

DEMO = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo.js")).read()
raw = os.path.join(out, "raw")
os.makedirs(raw)
meta = {"frames": []}
state = {"injected": False, "done": False, "t0": None}


def win():
    for w in app.get_windows():
        if isinstance(w, m.ViewerWindow):
            return w


def ev(code, cb):
    def fin(web, res, *_):
        try:
            cb(web.evaluate_javascript_finish(res).to_string())
        except Exception as e:  # noqa: BLE001
            cb("ERR " + str(e))
    win().web.evaluate_javascript(code, -1, None, None, None, fin, None)


def grab():
    gw = win().get_window()
    return Gdk.pixbuf_get_from_window(gw, 0, 0, gw.get_width(), gw.get_height())


def capture():
    if state["done"]:
        return False
    pb = grab()
    if pb:
        i = len(meta["frames"])
        with open(os.path.join(raw, f"{i:05d}.raw"), "wb") as f:
            f.write(pb.get_pixels())
        meta["frames"].append({"t": time.monotonic() - state["t0"], "w": pb.get_width(), "h": pb.get_height(),
                               "stride": pb.get_rowstride(), "alpha": pb.get_has_alpha()})
    return True


def on_msg(_ucm, js_result):
    try:
        msg = json.loads(js_result.get_js_value().to_string())
    except Exception:  # noqa: BLE001
        return
    if msg.get("type") == "demoShot":
        pb = grab()
        if pb:
            pb.savev(os.path.join(out, f"shot-{msg['name']}.png"), "png", [], [])


def poll():
    if not state["injected"]:
        def got(s):
            if "mode-welcome" in s and not state["injected"]:
                state["injected"] = True
                ev(DEMO + "; 1", lambda _s: None)
        ev("document.body.className", got)
        return True
    def done(s):
        if s == "true":
            state["done"] = True
            json.dump(meta, open(os.path.join(out, "meta.json"), "w"))
            print(f"gravado: {len(meta['frames'])} quadros, {meta['frames'][-1]['t']:.1f} s")
            GLib.timeout_add(300, lambda: (app.quit(), False)[1])
    ev("String(!!window.__demoDone)", done)
    return not state["done"]


def start():
    w = win()
    w.resize(1100, 700)
    w.web.get_user_content_manager().connect("script-message-received::mirante", on_msg)
    state["t0"] = time.monotonic()
    GLib.timeout_add(80, capture)
    GLib.timeout_add(100, poll)
    GLib.timeout_add(90000, lambda: (app.quit(), False)[1])   # trava de segurança


app = m.MiranteApp()
app.set_flags(app.get_flags() | Gio.ApplicationFlags.NON_UNIQUE)
app.connect("startup", lambda *_: GLib.timeout_add(50, lambda: (start(), False)[1] if win() else True))
app.run(["mirante"])
