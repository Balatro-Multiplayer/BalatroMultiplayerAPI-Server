import { promises as fs } from 'node:fs'
import path from 'node:path'

// The canonical mod-root flatten for GitHub/custom archives. Thunderstore
// packages are never flattened (they deploy exactly as shipped -- see
// mod-version-hash.ts). The launcher implements the same algorithm in
// new-launcher/src/mods/modinstaller.cpp (relocateModRoot()), and both are
// checked against the shared fixture list in
// src/tests/fixtures/mod-layouts.json -- change one and you must change the
// other, or a ranked pin's hash stops matching what the launcher deploys.
// Spec: new-launcher's THUNDERSTORE_MIGRATION_PLAN.md, section 4.2.
//
// A directory's signals, all read from its direct contents only:
//   - manifest: a *.json object with string `id` and `main_file` (Steamodded
//     JSON manifest), or a *.lua whose first 600 chars carry
//     "--- STEAMODDED HEADER". A Thunderstore manifest.json (no id) is not one.
//   - lua: any *.lua file.
//   - lovely: a lovely.toml file, or a lovely/ folder holding a *.toml.
// Every entry is visible, dot-files included; symlinks are ignored; name
// matching is case-insensitive.

const MAX_DEPTH = 6
const HEADER_SCAN_CHARS = 600
const SOURCE_PATTERN = /^\s*source\s*=\s*["']([^"']+)["']/gm
const SOURCES_PATTERN = /^\s*sources\s*=\s*\[([^\]]*)\]/gm
const QUOTED_PATTERN = /["']([^"']+)["']/g

interface Listing {
	files: string[]
	dirs: string[]
}

async function list(dir: string): Promise<Listing> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	const files: string[] = []
	const dirs: string[] = []
	for (const entry of entries) {
		if (entry.isFile()) files.push(entry.name)
		else if (entry.isDirectory()) dirs.push(entry.name)
	}
	files.sort()
	dirs.sort()
	return { files, dirs }
}

const lower = (name: string) => name.toLowerCase()
const isLovelyDir = (name: string) => lower(name) === 'lovely'

async function readHead(file: string, chars: number): Promise<string> {
	const handle = await fs.open(file, 'r')
	try {
		const buffer = Buffer.alloc(chars * 4)
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
		return buffer.subarray(0, bytesRead).toString('utf8').slice(0, chars)
	} finally {
		await handle.close()
	}
}

async function isSmodsJsonManifest(file: string): Promise<boolean> {
	try {
		const text = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '')
		const parsed: unknown = JSON.parse(text)
		return (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			typeof (parsed as Record<string, unknown>).id === 'string' &&
			typeof (parsed as Record<string, unknown>).main_file === 'string'
		)
	} catch {
		return false
	}
}

async function hasManifest(dir: string, listing: Listing): Promise<boolean> {
	for (const name of listing.files) {
		const file = path.join(dir, name)
		if (lower(name).endsWith('.json') && (await isSmodsJsonManifest(file))) {
			return true
		}
		if (
			lower(name).endsWith('.lua') &&
			(await readHead(file, HEADER_SCAN_CHARS)).includes(
				'--- STEAMODDED HEADER',
			)
		) {
			return true
		}
	}
	return false
}

const hasLua = (listing: Listing) =>
	listing.files.some((name) => lower(name).endsWith('.lua'))

// lovely.toml plus every *.toml directly inside a lovely/ folder.
async function lovelyTomls(dir: string, listing: Listing): Promise<string[]> {
	const out = listing.files
		.filter((name) => lower(name) === 'lovely.toml')
		.map((name) => path.join(dir, name))
	for (const sub of listing.dirs.filter(isLovelyDir)) {
		const subListing = await list(path.join(dir, sub))
		out.push(
			...subListing.files
				.filter((name) => lower(name).endsWith('.toml'))
				.map((name) => path.join(dir, sub, name)),
		)
	}
	return out
}

interface Signals {
	manifest: boolean
	lua: boolean
	lovely: string[]
}

async function signalsOf(dir: string): Promise<Signals> {
	const listing = await list(dir)
	return {
		manifest: await hasManifest(dir, listing),
		lua: hasLua(listing),
		lovely: await lovelyTomls(dir, listing),
	}
}

const qualifies = (s: Signals) => s.manifest || s.lua || s.lovely.length > 0

// Every path named by a `source = "..."` or `sources = [...]` line in the
// given Lovely patch files, with #-comment lines stripped first.
export function extractLovelySourcePaths(tomlText: string): string[] {
	const text = tomlText
		.split(/\r?\n/)
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')
	const paths: string[] = []
	for (const match of text.matchAll(SOURCE_PATTERN)) paths.push(match[1])
	for (const match of text.matchAll(SOURCES_PATTERN)) {
		for (const quoted of match[1].matchAll(QUOTED_PATTERN)) {
			paths.push(quoted[1])
		}
	}
	return paths
}

async function isFile(file: string): Promise<boolean> {
	try {
		return (await fs.lstat(file)).isFile()
	} catch {
		return false
	}
}

// Section 4.2 step 4. Only a root whose sole signal is Lovely (no manifest,
// no .lua of its own) can be a decoy -- e.g. HandyBalatro's release asset,
// whose loose lovely.toml is an install guard that errors when the real mod
// sits one folder too deep. A lovely-module mod (DebugPlus, Frost_Utils) is
// kept because its patches load files from its own subfolder.
async function resolveDecoy(root: string): Promise<string> {
	const signals = await signalsOf(root)
	if (signals.manifest || signals.lua) return root

	const listing = await list(root)
	const modSubfolders: { name: string; manifest: boolean }[] = []
	for (const name of listing.dirs) {
		if (isLovelyDir(name)) continue
		const sub = await signalsOf(path.join(root, name))
		if (sub.manifest || sub.lua) {
			modSubfolders.push({ name, manifest: sub.manifest })
		}
	}
	if (modSubfolders.length === 0) return root

	const subfolderNames = new Set(modSubfolders.map((s) => lower(s.name)))
	for (const toml of signals.lovely) {
		const text = await fs.readFile(toml, 'utf8')
		for (const ref of extractLovelySourcePaths(text)) {
			const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '')
			const first = lower(normalized.split('/')[0])
			if (
				normalized.includes('/') &&
				subfolderNames.has(first) &&
				(await isFile(path.join(root, normalized)))
			) {
				return root
			}
		}
	}

	const withManifest = modSubfolders.filter((s) => s.manifest)
	if (withManifest.length === 1) return path.join(root, withManifest[0].name)
	if (withManifest.length === 0 && modSubfolders.length === 1) {
		return path.join(root, modSubfolders[0].name)
	}
	return root
}

// Steps 1-3: unwrap single-directory wrappers, then breadth-first search for
// the shallowest qualifying folder, then the decoy check on whatever won.
export async function findModRoot(extractedDir: string): Promise<string> {
	let root = extractedDir
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		const entries = await fs.readdir(root, { withFileTypes: true })
		if (entries.length !== 1 || !entries[0].isDirectory()) break
		root = path.join(root, entries[0].name)
	}

	if (qualifies(await signalsOf(root))) return resolveDecoy(root)

	let level = [root]
	for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
		const matches: string[] = []
		const next: string[] = []
		for (const dir of level) {
			if (qualifies(await signalsOf(dir))) {
				matches.push(dir)
				continue
			}
			for (const name of (await list(dir)).dirs) {
				if (!isLovelyDir(name)) next.push(path.join(dir, name))
			}
		}
		if (matches.length === 1) return resolveDecoy(matches[0])
		if (matches.length > 1) return root
		level = next
	}
	return root
}

// Flattens destFolder in place so its contents are exactly the mod root
// findModRoot() picks; everything outside that root is discarded.
export async function relocateModRoot(destFolder: string): Promise<void> {
	const root = await findModRoot(destFolder)
	if (path.resolve(root) === path.resolve(destFolder)) return

	const tempPath = `${destFolder}__unwrapped_tmp`
	await fs.rm(tempPath, { recursive: true, force: true })
	await fs.rename(root, tempPath)
	await fs.rm(destFolder, { recursive: true, force: true })
	await fs.rename(tempPath, destFolder)
}
