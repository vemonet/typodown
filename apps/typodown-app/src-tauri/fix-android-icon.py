#!/usr/bin/env -S uv run --quiet --with pillow python3
"""Rebuild the Android adaptive icon as proper layers from the full-bleed logo.

Android launchers mask every icon to their own shape (circle / squircle /
rounded-square) and only the center ~66% is guaranteed visible. A square logo
placed in the foreground therefore loses its corners and looks cropped. So we
split the design the way adaptive icons want it:

  background layer = solid brand blue (== the logo frame color)
  foreground layer = the whole logo at 86%

Because the background matches the frame, wherever the launcher clips the
corners it clips blue-into-blue (invisible); a squircle fills edge-to-edge.
Nothing is zoomed, the whole design shows.

Desktop / iOS / Windows icons are untouched. Run AFTER `tauri icon`, which
overwrites the foreground PNGs.

Execute (requires uv):

```sh
./apps/typodown-app/src-tauri/fix-android-icon.py
```
"""
from pathlib import Path
from PIL import Image  # ty:ignore[unresolved-import]

ROOT = Path(__file__).parents[3]
LOGO = ROOT / "packages/typodown/public/logo.png"
RES = Path(__file__).parent / "gen/android/app/src/main/res"

BLUE = "#25426e"          # brand navy sampled from the logo frame == background
CONTENT = 0.86            # logo occupies this fraction of the canvas
SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

src = Image.open(LOGO).convert("RGBA")
src = src.crop(src.getbbox())  # trim transparent margin to the artwork

for dpi, size in SIZES.items():
    target = int(size * CONTENT)
    scale = target / max(src.size)
    art = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
    out = RES / f"mipmap-{dpi}/ic_launcher_foreground.png"
    canvas.save(out)
    print(f"wrote {out}")

bg = RES / "values/ic_launcher_background.xml"
bg.write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    f'    <color name="ic_launcher_background">{BLUE}</color>\n'
    "</resources>\n"
)
print(f"set background {BLUE} in {bg}")
