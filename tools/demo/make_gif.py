"""Monta docs/demo.gif e as capturas do README a partir de uma gravação do recorder.py.

uso: python3 tools/demo/make_gif.py <gravacao> <docs_dir> [largura=800] [cores=96]

- recorta a janela (sem a sombra) e começa no primeiro quadro com conteúdo;
- usa uma paleta para a parte clara e outra para a escura (com uma só, os nós coloridos do tema
  escuro viravam cinza), e os tempos reais de cada quadro.
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageStat

rec, docs = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 800
colors = int(sys.argv[4]) if len(sys.argv) > 4 else 96
meta = json.load(open(os.path.join(rec, "meta.json")))["frames"]


def load(i):
    f = meta[i]
    data = open(os.path.join(rec, "raw", f"{i:05d}.raw"), "rb").read()
    mode = "RGBA" if f["alpha"] else "RGB"
    return Image.frombuffer(mode, (f["w"], f["h"]), data, "raw", mode, f["stride"], 1)


ref = load(len(meta) // 2)
box = ref.getchannel("A").point(lambda v: 255 if v == 255 else 0).getbbox() if ref.mode == "RGBA" else (0, 0) + ref.size


def flatten(im):
    im = im.crop(box)
    if im.mode == "RGBA":                     # cantos arredondados da janela sobre branco
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    return im


def busy(im):                                 # há conteúdo no centro (não é a tela vazia da abertura)?
    w, h = im.size
    return ImageStat.Stat(im.convert("L").crop((w // 3, h // 3, 2 * w // 3, 2 * h // 3))).stddev[0] > 5


first = max(0, next(i for i in range(len(meta)) if busy(flatten(load(i)))) - 1)
tmp = os.path.join(rec, "gif")
shutil.rmtree(tmp, ignore_errors=True)
os.makedirs(tmp)
idx = list(range(first, len(meta)))
h = round(width * (box[3] - box[1]) / (box[2] - box[0]))
frames, dark_from = [], None
for n, i in enumerate(idx):
    im = flatten(load(i)).resize((width, h), Image.LANCZOS)
    name = f"{n:05d}.png"
    im.save(os.path.join(tmp, name))
    dur = (meta[idx[n + 1]]["t"] - meta[i]["t"]) if n + 1 < len(idx) else 1.5   # segura o fim antes de repetir
    frames.append((name, dur))
    dark = ImageStat.Stat(im.convert("L")).mean[0] < 90
    if dark and dark_from is None and n > 0:
        dark_from = n


def concat_list(path, part):
    out = ["ffconcat version 1.0"]
    for name, dur in part:
        out += [f"file '{name}'", f"duration {dur:.3f}"]
    out.append(f"file '{part[-1][0]}'")
    open(path, "w").write("\n".join(out) + "\n")


def pal(i, o):
    return (f"[{i}]split[a{i}][b{i}];[a{i}]palettegen=max_colors={colors}:stats_mode=diff[p{i}];"
            f"[b{i}][p{i}]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[{o}]")


os.makedirs(docs, exist_ok=True)
gif = os.path.join(docs, "demo.gif")
cmd = ["ffmpeg", "-y", "-loglevel", "error"]
if dark_from:
    concat_list(os.path.join(tmp, "claro.txt"), frames[:dark_from])
    concat_list(os.path.join(tmp, "escuro.txt"), frames[dark_from:])
    cmd += ["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "claro.txt"),
            "-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "escuro.txt"),
            "-filter_complex", pal(0, "c") + ";" + pal(1, "d") + ";[c][d]concat=n=2:v=1[out]", "-map", "[out]"]
else:
    concat_list(os.path.join(tmp, "todos.txt"), frames)
    cmd += ["-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "todos.txt"), "-filter_complex", pal(0, "out"), "-map", "[out]"]
subprocess.run(cmd + ["-loop", "0", gif], check=True)
print(f"GIF: {len(frames)} quadros, {width}x{h}, {colors} cores, {os.path.getsize(gif) / 1e6:.1f} MB")

shots = os.path.join(docs, "capturas")
os.makedirs(shots, exist_ok=True)
for f in sorted(os.listdir(rec)):
    if f.startswith("shot-") and f.endswith(".png"):
        dst = os.path.join(shots, f[5:])
        flatten(Image.open(os.path.join(rec, f))).save(dst, optimize=True)
        print(f"captura {f[5:]}: {os.path.getsize(dst) / 1e3:.0f} KB")
