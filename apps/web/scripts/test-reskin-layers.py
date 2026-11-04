#!/usr/bin/env python3
"""Test trusted metadata parsing and the generated loader, never game Lua.

Run: python3 -I scripts/test-reskin-layers.py
Lua loader assertions use LuaTeX when installed; otherwise that test is skipped.
"""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("catalog_builder", HERE / "build-catalog.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ReskinLayers(unittest.TestCase):
    def test_named_positions_do_not_confuse_background_and_soul(self):
        body = "soul_pos = {x=3,y=9}, pos = {x=3,y=8}"
        self.assertEqual(builder.parse_pos(body), {"x": 3, "y": 8})
        self.assertEqual(builder.parse_pos(body, "soul_pos"), {"x": 3, "y": 9})
        self.assertIsNone(builder.parse_pos("soul_pos = {x=3,y=9}"))

    def test_center_parser_recognizes_floating_and_shared_exceptions(self):
        fixture = """self.P_CENTERS = {
            j_caino = {set='Joker', soul_pos={x=3,y=9}, pos={x=3,y=8}},
            c_soul = {set='Spectral', pos={x=2,y=2}},
            j_hologram = {set='Joker', pos={x=4,y=12}, soul_pos={x=2,y=9}},
            j_joker = {set='Joker', pos={x=0,y=0}},
            soul = {pos={x=0,y=1}}
        }"""
        parsed = {obj["key"]: obj for obj in builder.parse_centers(fixture)}
        self.assertEqual(parsed["j_caino"]["soulPos"], {"x": 3, "y": 9})
        self.assertEqual(parsed["j_caino"]["pos"], {"x": 3, "y": 8})
        self.assertTrue(parsed["c_soul"]["soul"])
        self.assertEqual(parsed["c_soul"]["soulPos"], {"x": 0, "y": 1})
        self.assertEqual(parsed["c_soul"]["soulAtlasFile"], "Enhancers.png")
        self.assertEqual(parsed["c_soul"]["soulTarget"], "shared")
        self.assertEqual(parsed["j_hologram"]["soulShader"], "hologram")
        self.assertFalse(parsed["j_joker"]["soul"])

    def test_default_base_is_grouped_with_enhancements_without_changing_other_defaults(self):
        fixture = """self.P_CENTERS = {
            c_base = {set='Default', name='Default Base', pos={x=1,y=0}},
            m_bonus = {set='Enhanced', name='Bonus', pos={x=1,y=1}},
            c_other = {set='Default', name='Other', pos={x=0,y=0}}
        }"""
        parsed = {obj["key"]: obj for obj in builder.parse_centers(fixture)}
        base = parsed["c_base"]
        self.assertEqual(base["set"], "Enhanced")
        self.assertIn(base["set"], builder.CATEGORY_LABELS)
        self.assertEqual(builder.REGISTRY_BY_SET[base["set"]], "P_CENTERS")
        self.assertEqual(builder.ATLAS_FILE_BY_SET[base["set"]], "Enhancers.png")
        self.assertEqual(base["name"], "Default Card Background")
        self.assertEqual(base["pos"], {"x": 1, "y": 0})
        self.assertFalse(base["soul"])
        self.assertEqual(parsed["m_bonus"]["set"], "Enhanced")
        self.assertEqual(parsed["c_other"]["set"], "Default")

    @unittest.skipUnless(shutil.which("luatex"), "LuaTeX is not installed")
    def test_loader_with_mock_registries_and_shared_sprite(self):
        template = (HERE.parent / "src/app/(home)/reskin/templates/coreLua.ts").read_text()
        source = template.split("export const CORE_LUA = `", 1)[1].rsplit("`", 1)[0]
        self.assertNotIn("${", source)
        source = source.replace("\\`", "`")
        with tempfile.TemporaryDirectory(prefix="reskin-loader-test-") as directory:
            loader = Path(directory) / "core.lua"
            loader.write_text(source)
            result = subprocess.run(
                ["luatex", "--luaonly", str(HERE / "fixtures/reskin-layers.lua"), str(loader)],
                cwd=directory, capture_output=True, text=True, timeout=15,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("reskin layer loader assertions passed", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
