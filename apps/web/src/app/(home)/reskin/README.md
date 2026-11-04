# Reskin Studio game imports

All game imports run locally in the browser. No game files are sent to a server
or executed. The importer accepts:

- Windows `Balatro.exe` (LÖVE-fused ZIP, existing behavior).
- A plain `Balatro.love` archive.
- Drag-and-drop `.exe`, `.love`, and Finder-compressed app ZIP files.
- A dropped `Balatro.app` bundle, when the browser exposes directory entries.
  Only `Contents/Resources/*.love` is selected; no other app file is read or
  stored. Directory listing handles multiple batches and rejects ambiguous apps.
- A Mac app's containing Steam installation directory, through
  **Choose installation folder** (`webkitdirectory`). Only the `.love` inside
  `<app>.app/Contents/Resources/` is read/remembered.
- A Finder-compressed app ZIP through **Choose ZIP / .love / .exe**, the regular
  file chooser. Use this same button for a direct `.love` or `.exe`. Only the ZIP's
  inner `.love` is extracted/remembered. Both STORE and DEFLATE ZIP entries work.

Some macOS browser pickers will not select an `.app` directly because Finder
presents it as an application rather than a directory. Select the containing
folder, compress the app in Finder, or choose the inner `.love` instead. The
import panel includes Steam/Finder instructions and the default Steam path.
Multiple matching app archives are rejected instead of choosing arbitrarily.
Drops accept one game at a time and use the same worker, validation, progress,
and persistence path as picked files. Opaque app drops show folder/ZIP/inner
`.love` alternatives. App lookup has a visible cancellable status, a 15-second
timeout, and a 10,000-entry limit per directory; it never scans unrelated app
subdirectories. Drop errors leave the already imported game untouched.

The legacy IndexedDB database/store and saved-file shapes are unchanged so
previous Windows imports still reopen. App ZIPs are normalized to a standalone
`.love` before persistence; a whole app bundle is never stored. Source files are
limited to 512 MiB, and extracted game archives/individual DEFLATE outputs to
256 MiB. ZIP64, split, encrypted, and unsupported-compression ZIPs are rejected
with a direct `.love` fallback. A failed/canceled selection leaves the current
import intact. Storage failure warns but does not discard a successfully loaded
game.

## Import feedback and responsiveness

Reading, ZIP inspection, extraction, validation, and local persistence have visible
status messages. Extraction percentages use actual output bytes (not a simulated
whole-import percentage). A spinner, elapsed time, slow-import advice, and
**Cancel import** remain available during processing. Success, failure, and
cancellation stay visible; category artwork has its own loading/error feedback.

Parsing and decompression run in a Web Worker, including the synchronous JS
fallback. Cancel terminates it; a 120-second processing timeout reports an
explicit error. Persistence is a separate, non-cancellable phase. Raw archive
bytes are private inside `GameArchive` in React state/props: exposing a large
`Uint8Array` directly makes development render inspection enumerate millions of
byte indices and can freeze the demo after extraction.

Browser smoke checks used synthetic archives, including a roughly 70 MiB ZIP and
a ZIP expanding to a 70 MiB game archive. A test-only worker delay exercised
visible loading/elapsed time and cancellation; malformed ZIP feedback was checked
with an existing game still loaded. No actual macOS dialog was exercised.

## Layered card art

The five legendary Jokers, Hologram, and The Soul have independent background
and overlay previews. Their editor offers **Combined / Background / Overlay**
views, separate uploads, **Reset overlay** (restore the game's original), and
**Hide overlay** (an explicit transparent layer). Hologram previews its special
foreground shader. The Soul's gem comes from the shared `centers` sprite in
`Enhancers.png`, not a Joker-style `soul_pos` in the background atlas.

Original layers are read-only previews and do not count as edits. Replacing only
one layer preserves the other in-game, without exporting vanilla art. Overlay-only
and hidden-overlay edits survive export and pack reimport. Generated packs that
change layered cards require Steamodded `1.0.0~BETA-1814a` or newer, since the
previous minimum does not support independent floating-sprite atlases. The Soul's
shared sprite is rebound before its normal draw step, retaining the game's motion;
the browser preview shows layer placement, not the in-game floating animation.

Regression checks cover layer metadata/crops, combined and isolated rendering,
edit indicators, export/reimport, transparent overlays, and loader behavior against
mock registries/shared sprites. No proprietary game Lua is executed. In-game
installation and the new layer controls still need a manual visual pass:

1. Import your game, search each legendary and Hologram, then open The Soul in
   Spectral Cards. Confirm both original layers appear without adding edits.
2. Switch between all three views. Replace only a background, then only an overlay;
   the unchanged layer should remain. Hide/reset the overlay and clear the tile.
3. Export each variation and install with the declared Steamodded version. Verify
   the legendary portraits, Hologram effect, and Soul gem/animation, including
   after changing texture scaling. Reimport a pack and confirm its layer choices.

## Shader preview compatibility

Hologram's literal glow-sampling radius is promoted to `const int` during
LÖVE-to-WebGL conversion: WebGL 1 requires constant loop initializers/bounds.
The imported radius and effect body are otherwise unchanged. Shader fragments
are cached per imported archive, including in-flight reads, so a different game
import cannot reuse stale shader source.

Compilation/linking and image/setup failures keep the static sprite visible and
show **Shader preview unavailable** locally, without logging a console error that
opens Next's full-page development overlay. Temporary shaders and failed programs
are released. Unit tests use synthetic GLSL; a headless Chromium WebGL 1 smoke
check reproduced the old loop-index rejection, then compiled, linked and rendered
the converted fixture. This does not claim native Safari or in-game validation.

## Automated checks

From the repository root (pnpm 10.33.0 and Bun):

```sh
pnpm install --frozen-lockfile --filter balatro-multiplayer-web...
pnpm --filter @bmp/types build
pnpm --filter balatro-multiplayer-web typecheck
bun test apps/web/src
python3 -I apps/web/scripts/test-reskin-layers.py
```

The Python check imports only the trusted catalog parser and uses synthetic Lua
strings. It does not invoke the full catalog build or its localization evaluator.
When LuaTeX is available it also executes the generated loader against trusted
mocks; that runtime check is explicitly skipped when LuaTeX is absent.

`lib/gameImport.test.ts` and `lib/exeStore.test.ts` use synthetic archives only;
never commit game archives, extracted assets, or a real Mac bundle as fixtures.
They cover plain/fused archives, stored/deflated app ZIPs, folder resolution,
AppleDouble metadata, ambiguity, malformed archives, size limits, localization,
older-browser decompression fallback, native picker filters/cancellation, and
saved-file compatibility/permission handling. They do not exercise native macOS
file dialogs or actual IndexedDB persistence.

## Manual Mac/browser check

Use your own installation in current Safari and Chromium:

1. Open `/reskin`. In Steam, right-click **Balatro → Manage → Browse local
   files**. Expand the import panel's Mac instructions and check they match Finder.
2. Try dragging `Balatro.app` from Finder onto the game drop area. Confirm the
   lookup status followed by import progress and loaded art. If the browser
   presents the app as an opaque file, confirm the fallback error is visible.
   Drop a `.love`, `.exe`, and app ZIP too. Reject a multi-file drop without
   replacing the current import; cancel app lookup and check the same.
3. Use **Choose installation folder**. Select the Balatro installation folder
   containing `Balatro.app`, not the app or ZIP (both may be disabled in this
   folder-only dialog). Confirm the loaded message, faded vanilla art,
   borders/shapes, and editable English localization.
3. In Finder, use **Balatro.app → Show Package Contents → Contents → Resources**.
   Choose `Balatro.love` with **Choose ZIP / .love / .exe**. Repeat the same checks.
4. Compress `Balatro.app` in Finder and choose the resulting ZIP with
   **Choose ZIP / .love / .exe**, not the folder button. Repeat the same checks;
   the remembered filename should be the inner `.love`, not the ZIP.
5. Reload and accept re-import. Repeat with **No** / **Forget it** and ensure
   the saved import is removed. Deny a Chromium saved-handle permission request
   and confirm the UI reports it without reading the file.
6. Cancel each picker and try a wrong folder, an unrelated ZIP, and a truncated
   archive. Errors should be actionable; an already loaded game remains usable.
7. Re-select the same file after an error (inputs reset after selection). Generate
   a small reskin pack and re-import it with **Import pack**, which is separate
   from game-file import.
8. In Chromium, also check an existing Windows `Balatro.exe` import and its
   saved-handle reload. In a browser without File System Access, check the plain
   file input and stored-blob reload.
9. Inspect Network while importing: game bytes must never leave the browser.

Native Finder selection, persistence across browser reloads, canvas rendering,
and generated-pack behavior need this manual pass; passing unit tests alone
is not a claim that those UI flows were tested on macOS.
