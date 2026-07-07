#!/usr/bin/env python3
"""Derive the per-type card-border opaque-pixel maps for the Reskin Studio.

Reads one reference PNG per border variant (a frame, a frame + text, etc.) and
emits a 1-bit white-on-transparent silhouette of each — the map of where the
border sits. SHAPE-ONLY: no game art is embedded. At runtime the studio applies
a map to a vanilla cell (the object's own, or a fixed source Joker) to lift the
real coloured border, then composites it onto the card the user is editing.

The reference PNGs are NOT committed; only the derived maps are. Point BORDER_DIR
at the folder holding them (default ~/Downloads via /mnt/e/Downloads). Reuses the
PNG codec in build-catalog.py.

Output: src/app/(home)/reskin/data/border-masks.ts
Usage: BORDER_DIR=/path python3 scripts/build-border-masks.py
"""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(
    os.path.dirname(HERE), "src", "app", "(home)", "reskin", "data", "border-masks.ts"
)
BORDER_DIR = os.environ.get("BORDER_DIR", "/mnt/e/Downloads")
THRESHOLD = 128  # alpha >= this (50%) counts as an opaque border pixel — drops
# the faint anti-aliased stray pixels around the frames.

# export const name -> source PNG basename in BORDER_DIR
MAPS = {
    "JOKER_OUTLINE": "joker_border.png",
    "JOKER_TEXT": "joker_border_with_text.png",
    "PLANET_OUTLINE": "planet_border.png",
    "PLANET_TEXT": "planet_border_with_text.png",
    "TAROT_BORDER": "tarot_border.png",
    "SPECTRAL_BORDER": "spectral_border.png",
    "VOUCHER_BORDER": "voucher_border.png",
    "TAG_BORDER": "tag_border.png",
    "BLACKHOLE_BORDER": "blackhole_border.png",
}

_ns = {"__name__": "not_main", "__file__": os.path.join(HERE, "build-catalog.py")}
exec(compile(open(_ns["__file__"]).read(), _ns["__file__"], "exec"), _ns)
decode_png_rgba = _ns["decode_png_rgba"]
encode_png_rgba = _ns["encode_png_rgba"]


def opaque_map_b64(path: str) -> str:
    w, h, px = decode_png_rgba(open(path, "rb").read())
    out = bytearray(w * h * 4)
    count = 0
    for i in range(w * h):
        if px[i * 4 + 3] >= THRESHOLD:
            out[i * 4 : i * 4 + 4] = b"\xff\xff\xff\xff"
            count += 1
    print(f"  {os.path.basename(path):28s} {w}x{h}  {count} opaque px")
    return base64.b64encode(encode_png_rgba(w, h, out)).decode()


def main() -> None:
    lines = [
        "// Per-type opaque-pixel maps of the Balatro card borders, derived once",
        "// from reference PNGs (a frame, a frame + nameplate text, etc.). SHAPE-ONLY:",
        "// each is a 1-bit white-on-transparent silhouette of where the border sits —",
        "// no game art is embedded. At runtime applyMask() samples a vanilla cell",
        "// through a map to lift the real coloured border, which is then composited",
        "// onto the card the user is editing.",
        "//",
        "// 1x base64 PNG (no data-URL prefix). Regenerate: scripts/build-border-masks.py",
        "",
    ]
    for name, fn in MAPS.items():
        b64 = opaque_map_b64(os.path.join(BORDER_DIR, fn))
        lines.append(f"export const {name} =")
        lines.append(f"  '{b64}'")
        lines.append("")
    with open(DATA, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {DATA}")


if __name__ == "__main__":
    main()
