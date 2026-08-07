import { promises as fs } from 'node:fs'
import path from 'node:path'

// A straight TypeScript port of the launcher's relocateModRoot() /
// findShallowestLuaDirs() / flattenSingleRootFolder() (see
// new-launcher/src/mods/modinstaller.cpp) - this has to produce the exact
// same on-disk layout the launcher's own extraction step would, since
// mods-sync.service.ts feeds the result straight into modzip (see
// native/modzip/modzip.c), and the resulting hash only means anything if
// this matches what a real install actually flattens a mod archive into.
//
// Safety bound on how many nested wrapper folders flattenSingleRootFolder()
// will unwrap - real mods are never nested this deep, this just stops a
// pathological/malformed archive from looping.
const MAX_FLATTEN_PASSES = 6

// Direct children only, not recursive - mirrors Qt's
// dir.entryList(QStringList() << "*.lua", QDir::Files). Case-insensitive:
// Windows' filesystem (where most players run the launcher) treats file
// extensions case-insensitively, so a Windows install's QDir::entryList
// with a "*.lua" filter matches ".LUA"/".Lua" too - matching that here
// keeps the flattening decision identical regardless of which OS actually
// installed the mod.
async function containsLuaFile(dir: string): Promise<boolean> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	return entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.lua'))
}

// Steamodded mods are Lua-based, so the folder that directly contains the
// mod's .lua files is the one that needs to sit right under the Mods
// folder. Archives often wrap that folder under one or more extra levels -
// GitHub's zipball fallback always adds an <owner>-<repo>-<sha>/ wrapper,
// and plenty of mod authors' own .zip assets nest a release/repo folder
// too, sometimes alongside sibling clutter (README, LICENSE, docs/) that a
// "single top-level entry" check would trip over. Breadth-first search for
// the shallowest folder(s) that directly hold a .lua file instead.
async function findShallowestLuaDirs(root: string): Promise<string[]> {
	let level = [root]

	for (let depth = 0; depth < MAX_FLATTEN_PASSES && level.length > 0; depth++) {
		const matches: string[] = []
		const nextLevel: string[] = []

		for (const dirPath of level) {
			if (await containsLuaFile(dirPath)) {
				matches.push(dirPath)
				continue // don't descend into a match looking for more
			}
			const entries = await fs.readdir(dirPath, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory()) {
					nextLevel.push(path.join(dirPath, entry.name))
				}
			}
		}

		if (matches.length > 0) {
			return matches
		}
		level = nextLevel
	}

	return []
}

// Falls back for archives with no .lua file anywhere findShallowestLuaDirs
// looked (e.g. a data-only mod) - unwraps as long as the folder contains
// nothing but a single subfolder, same idea without the content-based
// signal.
async function flattenSingleRootFolder(destFolder: string): Promise<void> {
	for (let pass = 0; pass < MAX_FLATTEN_PASSES; pass++) {
		const entries = await fs.readdir(destFolder, { withFileTypes: true })
		if (entries.length !== 1 || !entries[0].isDirectory()) {
			return
		}

		const wrapperName = entries[0].name
		const wrapperDir = path.join(destFolder, wrapperName)
		const children = await fs.readdir(wrapperDir, { withFileTypes: true })
		for (const child of children) {
			await fs.rename(path.join(wrapperDir, child.name), path.join(destFolder, child.name))
		}
		await fs.rmdir(wrapperDir)
	}
}

// Flattens destFolder in place to match what the launcher's ModInstaller
// deploys: either the single shallowest .lua-containing folder promoted to
// destFolder's own root (everything else - wrapper folders, README/LICENSE
// clutter - discarded), or, when that signal is absent or ambiguous, up to
// MAX_FLATTEN_PASSES of single-child-wrapper unwrapping.
export async function relocateModRoot(destFolder: string): Promise<void> {
	const matches = await findShallowestLuaDirs(destFolder)

	if (matches.length !== 1) {
		// Zero matches (no .lua anywhere) or multiple equally-shallow
		// candidates (ambiguous - the launcher doesn't guess here either,
		// see relocateModRoot()'s own comment) both fall back to the
		// single-wrapper unwrap, which is a no-op if destFolder already
		// has more than one top-level entry.
		await flattenSingleRootFolder(destFolder)
		return
	}

	const foundRoot = matches[0]
	if (path.resolve(foundRoot) === path.resolve(destFolder)) {
		return // already in the right place
	}

	// Move the found root out of the way, wipe everything else that came
	// with the archive (wrapper folders, README/LICENSE clutter), then
	// move it into destFolder's place. Mirrors modinstaller.cpp's own
	// tempPath naming (a sibling directory, not nested under destFolder -
	// it's about to be deleted wholesale).
	const tempPath = `${destFolder}__unwrapped_tmp`
	await fs.rm(tempPath, { recursive: true, force: true })
	try {
		await fs.rename(foundRoot, tempPath)
	} catch {
		// Mirrors relocateModRoot()'s own failure handling: leave the
		// extracted structure as-is rather than partially rewriting it.
		return
	}
	await fs.rm(destFolder, { recursive: true, force: true })
	await fs.rename(tempPath, destFolder)
}
