#!/usr/bin/env python3
"""Build the CustomReskin object catalog from the Balatro game code.

Reads object registries and localization STRUCTURE out of Balatro.exe, but ships
**no game assets and no game creative text**: only object keys, sprite sizes,
frame counts, soul flags, object *names* (uncopyrightable short labels), and the
set of localization keys (which fields exist), with empty values.

Output: src/app/(home)/reskin/data/catalog.json
Re-runnable. Override the game path with BALATRO_EXE.

Usage: python3 scripts/build-catalog.py
"""
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
DATA_DIR = os.path.join(WEB, "src", "app", "(home)", "reskin", "data")
EXE = os.environ.get(
    "BALATRO_EXE",
    "/mnt/c/Program Files (x86)/Steam/steamapps/common/Balatro/Balatro.exe",
)

# Sprite cell size (1x) per object set. Everything card-shaped is 71x95.
SIZE_BY_SET = {
    "Joker": (71, 95),
    "Tarot": (71, 95),
    "Planet": (71, 95),
    "Spectral": (71, 95),
    "Voucher": (71, 95),
    "Booster": (71, 95),
    "Enhanced": (71, 95),
    "Edition": (71, 95),
    "Back": (71, 95),
    "Seal": (71, 95),
    "Default": (71, 95),
    "Tag": (34, 34),
    "Blind": (34, 34),
    "Stake": (29, 29),
}

# Which runtime table the loader repoints for each set.
REGISTRY_BY_SET = {
    "Joker": "P_CENTERS",
    "Tarot": "P_CENTERS",
    "Planet": "P_CENTERS",
    "Spectral": "P_CENTERS",
    "Voucher": "P_CENTERS",
    "Booster": "P_CENTERS",
    "Enhanced": "P_CENTERS",
    "Edition": "P_CENTERS",
    "Back": "P_CENTERS",
    "Tag": "P_TAGS",
    "Blind": "P_BLINDS",
    "Seal": "P_SEALS",
    "Stake": "P_STAKES",
}

# Per-object sprite categories shown in the Assets tab. registry = the runtime
# table the loader repoints; allOrNothing categories are composed full sheets.
CATEGORY_LABELS = {
    "Joker": "Jokers",
    "Tarot": "Tarot Cards",
    "Planet": "Planet Cards",
    "Spectral": "Spectral Cards",
    "Voucher": "Vouchers",
    "Booster": "Booster Packs",
    "Enhanced": "Card Enhancements",
    # Editions (foil/holo/polychrome/negative) are shader effects, not sprites,
    # so they are not replaceable and are intentionally absent from assets.
    "Back": "Decks",
    "Seal": "Seals",
    "Tag": "Tags",
    "Blind": "Blinds",
    # Stakes are intentionally absent: stake icons draw straight from the "chips"
    # atlas with a hard-coded atlas reference, so a per-object rebind has no
    # effect. They are reskinned via the "Stake Chips" sheet instead.
}

# Localization set -> friendly label.
LOC_SET_LABELS = {
    "Joker": "Jokers",
    "Tarot": "Tarot Cards",
    "Planet": "Planet Cards",
    "Spectral": "Spectral Cards",
    "Voucher": "Vouchers",
    "Enhanced": "Card Enhancements",
    "Edition": "Editions",
    "Back": "Decks",
    "Tag": "Tags",
    "Blind": "Blinds",
    "Stake": "Stakes",
    "Other": "Other Tooltips",
}

# Simple misc groups (one editable value per key), label by friendly name.
# `dictionary` is handled specially (split into Button Text / Dictionary); collab
# credits are intentionally dropped.
SIMPLE_MISC = {
    "labels": "Labels",
    "ranks": "Card Ranks",
    "blind_states": "Blind States",
    "high_scores": "High-score Labels",
    "quips": "Shop Quips",
    "tutorial": "Tutorial",
    "challenge_names": "Challenge Names",
}


def png_dims_from_zip(z, path):
    data = z.read(path)
    assert data[12:16] == b"IHDR"
    return struct.unpack(">II", data[16:24])


def table_body(src, name):
    """Return the body (without outer braces) of `self.<name> = { ... }`."""
    m = re.search(r"self\." + name + r"\s*=\s*\{", src)
    if not m:
        return None
    i = m.end() - 1
    depth = 0
    for j in range(i, len(src)):
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1 : j]
    return None


def entries(body):
    """Yield (key, entry_body) for each depth-1 `key = { ... }` in a table body."""
    i, n = 0, len(body)
    key_re = re.compile(r"([A-Za-z0-9_]+)\s*=\s*\{")
    while i < n:
        m = key_re.search(body, i)
        if not m:
            break
        key = m.group(1)
        j = m.end() - 1
        depth = 0
        end = None
        for k in range(j, n):
            c = body[k]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = k
                    break
        if end is None:
            break
        yield key, body[j + 1 : end]
        i = end + 1


def field_str(body, name):
    m = re.search(name + r"\s*=\s*['\"]([^'\"]*)['\"]", body)
    return m.group(1) if m else None


def parse_centers(g):
    """P_CENTERS split by set/prefix into per-object categories."""
    body = table_body(g, "P_CENTERS")
    if body is None:
        sys.exit("could not locate P_CENTERS")
    prefix_set = {
        "j_": "Joker",
        "v_": "Voucher",
        "b_": "Back",
        "m_": "Enhanced",
        "e_": "Edition",
        "p_": "Booster",
    }
    objs = []
    for key, eb in entries(body):
        s = field_str(eb, "set")
        if not s:
            # consumables (c_) always carry set; otherwise infer from prefix
            for pre, val in prefix_set.items():
                if key.startswith(pre):
                    s = val
                    break
        if not s:
            continue
        objs.append(
            {
                "key": key,
                "set": s,
                "name": field_str(eb, "name") or key,
                "soul": "soul_pos" in eb,
            }
        )
    return objs


def parse_simple(g, table, set_name):
    body = table_body(g, table)
    if body is None:
        return []
    out = []
    for key, eb in entries(body):
        out.append(
            {
                "key": key,
                "set": set_name,
                "name": field_str(eb, "name") or key,
                "soul": False,
            }
        )
    return out


def lua_to_dict(z, member):
    """Convert a localization lua file from the exe to a dict via luajit."""
    with tempfile.NamedTemporaryFile("wb", suffix=".lua", delete=False) as tmp:
        tmp.write(z.read(member))
        path = tmp.name
    try:
        out = subprocess.run(
            ["luajit", os.path.join(HERE, "lua2json.lua"), path],
            capture_output=True,
            check=True,
        ).stdout
        return json.loads(out)
    finally:
        os.unlink(path)


def main():
    if not os.path.exists(EXE):
        sys.exit(f"Balatro.exe not found at {EXE} (set BALATRO_EXE)")
    z = zipfile.ZipFile(EXE)
    g = z.read("game.lua").decode("utf-8", "replace")

    # --- per-object sprite categories --------------------------------------
    objects = parse_centers(g)
    objects += parse_simple(g, "P_TAGS", "Tag")
    objects += parse_simple(g, "P_BLINDS", "Blind")
    objects += parse_simple(g, "P_SEALS", "Seal")

    cats = {}
    for o in objects:
        s = o["set"]
        if s not in CATEGORY_LABELS:
            continue
        px, py = SIZE_BY_SET.get(s, SIZE_BY_SET["Default"])
        frames = 21 if s == "Blind" else 1
        cat = cats.setdefault(
            s,
            {
                "id": s,
                "label": CATEGORY_LABELS[s],
                "registry": REGISTRY_BY_SET[s],
                "px": px,
                "py": py,
                "frames": frames,
                "animated": frames > 1,
                "soul": False,
                "objects": [],
            },
        )
        if o["soul"]:
            cat["soul"] = True
        entry = {"key": o["key"], "name": o["name"]}
        if o["soul"]:
            entry["soul"] = True
        cat["objects"].append(entry)

    sprite_categories = [
        {k: v for k, v in c.items() if k != "objects"}
        for c in cats.values()
        if c["objects"]
    ]
    sprite_objects = {c["id"]: c["objects"] for c in cats.values() if c["objects"]}

    # --- composed sheets ---------------------------------------------------
    sheets = []

    # Playing cards: one upload of the whole deck face sheet (cards_1 / 8BitDeck).
    deck_w, deck_h = png_dims_from_zip(z, "resources/textures/1x/8BitDeck.png")
    sheets.append(
        {
            "id": "playing_cards",
            "label": "Playing Card Faces",
            "atlasKey": "cards_1",
            "group": "sheets",
            "mode": "whole",
            "px": 71,
            "py": 95,
            "cols": round(deck_w / 71),
            "rows": round(deck_h / 95),
            "cells": [],
            "note": "One image of the whole 13x4 card face sheet (ranks across, suits down).",
        }
    )

    # Stake chips: the "chips" atlas holds the stake icons, indexed by stake pos.
    chip_w, chip_h = png_dims_from_zip(z, "resources/textures/1x/chips.png")
    chip_cols = round(chip_w / 29)
    chip_rows = round(chip_h / 29)
    chip_cells = [{} for _ in range(chip_cols * chip_rows)]
    sbody = table_body(g, "P_STAKES")
    if sbody:
        for key, eb in entries(sbody):
            m = re.search(r"pos\s*=\s*\{\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)", eb)
            if not m:
                continue
            idx = int(m.group(2)) * chip_cols + int(m.group(1))
            if 0 <= idx < len(chip_cells):
                chip_cells[idx] = {"key": key, "name": field_str(eb, "name") or key}
    sheets.append(
        {
            "id": "chips",
            "label": "Stake Chips",
            "atlasKey": "chips",
            "group": "objects",
            "mode": "cells",
            "px": 29,
            "py": 29,
            "cols": chip_cols,
            "rows": chip_rows,
            "cells": chip_cells,
            "note": "The stake chip icons (White Stake, Red Stake, and so on).",
        }
    )

    # Shop sign animation.
    shop_w, _ = png_dims_from_zip(z, "resources/textures/1x/ShopSignAnimation.png")
    sheets.append(
        {
            "id": "shop_sign",
            "label": "Shop Sign Animation",
            "atlasKey": "shop_sign",
            "group": "sheets",
            "mode": "animated",
            "px": 113,
            "py": 57,
            "frames": round(shop_w / 113),
            "animated": True,
            "cells": [],
            "note": "Animated. Upload a GIF or a horizontal frame-strip.",
        }
    )

    # --- localization structure (language-independent; values shipped per ----
    # language as flat path->value maps under public/reskin/loc/<lang>.json) ---
    loc = lua_to_dict(z, "localization/en-us.lua")  # en-us drives the structure
    desc = loc.get("descriptions", {})
    misc = loc.get("misc", {})

    def ml(v):
        return isinstance(v, list)

    def field(key, label, path, multiline):
        return {"key": key, "label": label, "path": path, "multiline": multiline}

    loc_groups = []

    # Object groups: Name + Description + Unlock.
    for s, objs in desc.items():
        items = []
        for k, o in objs.items():
            fields = [field("name", "Name", f"descriptions.{s}.{k}.name", False)]
            if "text" in o:
                fields.append(field("text", "Description", f"descriptions.{s}.{k}.text", True))
            if "unlock" in o:
                fields.append(field("unlock", "Unlock", f"descriptions.{s}.{k}.unlock", ml(o["unlock"])))
            items.append({"key": k, "label": o.get("name", k), "fields": fields})
        # Fold voucher value-templates and effect text into the Vouchers group.
        if s == "Voucher":
            for k, v in misc.get("v_dictionary", {}).items():
                if isinstance(v, (str, list)):
                    items.append({"key": f"vd_{k}", "label": f"UI: {k}",
                                  "fields": [field("v", k, f"misc.v_dictionary.{k}", ml(v))]})
            for k, v in misc.get("v_text", {}).items():
                if isinstance(v, (str, list)):
                    items.append({"key": f"vt_{k}", "label": f"Text: {k}",
                                  "fields": [field("v", k, f"misc.v_text.{k}", ml(v))]})
        loc_groups.append({"id": f"descriptions.{s}", "label": LOC_SET_LABELS.get(s, s), "items": items})

    # Achievements: Name + Description combined.
    an, ad = misc.get("achievement_names", {}), misc.get("achievement_descriptions", {})
    loc_groups.append({
        "id": "group.achievements", "label": "Achievements",
        "items": [{"key": k, "label": k, "fields": [
            field("name", "Name", f"misc.achievement_names.{k}", False),
            field("desc", "Description", f"misc.achievement_descriptions.{k}", ml(ad.get(k, ""))),
        ]} for k in an],
    })

    # Poker hands: Name + Description combined.
    ph, phd = misc.get("poker_hands", {}), misc.get("poker_hand_descriptions", {})
    loc_groups.append({
        "id": "group.poker_hands", "label": "Poker Hands",
        "items": [{"key": k, "label": k, "fields": [
            field("name", "Name", f"misc.poker_hands.{k}", False),
            field("desc", "Description", f"misc.poker_hand_descriptions.{k}", ml(phd.get(k, ""))),
        ]} for k in ph],
    })

    # Suits: singular + plural combined.
    ss = misc.get("suits_singular", {})
    loc_groups.append({
        "id": "group.suits", "label": "Suits",
        "items": [{"key": k, "label": k, "fields": [
            field("sing", "Singular", f"misc.suits_singular.{k}", False),
            field("plur", "Plural", f"misc.suits_plural.{k}", False),
        ]} for k in ss],
    })

    # Dictionary split: Button Text (b_*) and Dictionary (everything else).
    dic = misc.get("dictionary", {})
    btn_items, dict_items = [], []
    for k, v in dic.items():
        if not isinstance(v, (str, list)):
            continue
        item = {"key": k, "label": k, "fields": [field("v", k, f"misc.dictionary.{k}", ml(v))]}
        (btn_items if k.startswith("b_") else dict_items).append(item)
    loc_groups.append({"id": "misc.dictionary.buttons", "label": "Button Text", "items": btn_items})
    loc_groups.append({"id": "misc.dictionary.other", "label": "Dictionary", "items": dict_items})

    # Remaining simple misc groups: one value per key.
    for grp, label in SIMPLE_MISC.items():
        vals = misc.get(grp, {})
        if not isinstance(vals, dict):
            continue
        items = [{"key": k, "label": k, "fields": [field("v", k, f"misc.{grp}.{k}", ml(v))]}
                 for k, v in vals.items() if isinstance(v, (str, list))]
        loc_groups.append({"id": f"misc.{grp}", "label": label, "items": items})

    loc_groups = [g for g in loc_groups if g["items"]]

    # Per-language value files: flat path -> value for every leaf string/array.
    public_loc = os.path.join(WEB, "public", "reskin", "loc")
    os.makedirs(public_loc, exist_ok=True)
    langs = sorted(
        n.split("/")[1][:-4]
        for n in z.namelist()
        if n.startswith("localization/") and n.endswith(".lua")
    )

    def flatten(node, prefix, out):
        if isinstance(node, str):
            out[prefix] = node
        elif isinstance(node, list):
            if all(isinstance(x, str) for x in node):
                out[prefix] = node
        elif isinstance(node, dict):
            for k, v in node.items():
                flatten(v, f"{prefix}.{k}" if prefix else k, out)

    for lang in langs:
        d = lua_to_dict(z, f"localization/{lang}.lua")
        flat = {}
        flatten({"descriptions": d.get("descriptions", {}), "misc": d.get("misc", {})}, "", flat)
        with open(os.path.join(public_loc, f"{lang}.json"), "w") as f:
            json.dump(flat, f, ensure_ascii=False, separators=(",", ":"))

    catalog = {
        "generatedFrom": os.path.basename(EXE),
        "languages": langs,
        "spriteCategories": sprite_categories,
        "spriteObjects": sprite_objects,
        "spriteSheets": sheets,
        "locGroups": loc_groups,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "catalog.json"), "w") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"catalog: {sum(len(v) for v in sprite_objects.values())} sprite objects "
        f"in {len(sprite_categories)} categories, {len(sheets)} sheets, "
        f"{len(loc_groups)} loc groups -> {DATA_DIR}/catalog.json"
    )


if __name__ == "__main__":
    main()
