// Lists the pvp_* action keys the PvP mod registers or sends, so the relay
// allowlist (PVP_RELAY_KEYS in src/lobby/sender_guard.ts) can be checked against
// the real client.
//
// Usage: node scripts/pvp-relay-keys.mjs <path to the PvP mod> [output file]
//
// The output file defaults to src/lobby/pvp_relay_keys.fixture.json. The script
// exits 1, naming file:line, and writes nothing when it meets a call site it
// cannot read a key from, so the list never silently under-collects.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A pvp_* key counts only where it names a wire action:
//   A("pvp_x"   A_host("pvp_x"   relay("pvp_x"      (call sites, scanned)
//   ActionType({ key = "pvp_x" ...}) / ActionType{ ... }   (key anywhere at the
//     top level of the table, before or after other fields)
//   broadcast("pvp_x"   ActionTypes["pvp_x"]               (plain matches)
// host_only(), apply(), page/layer names and the like are not actions, and
// neither is the key of a game mode, ruleset, menu page or atlas.
//
// Every A / A_host / relay / ActionType call site must yield a key, or be one of:
//   - the helper's own definition: `function X.A(key, ...)`
//   - a forwarder: a call inside such a file that passes the helper's first
//     parameter on (`A(key, fn)`, `ActionType({ key = key, ... })`)
//   - a call with a string key that is not pvp_* (another mod's action)
// Anything else, such as `A(k)` with a variable `k`, is reported as a miss.
const PLAIN = [
	/\bbroadcast\(\s*["'](pvp_\w+)["']/g,
	/\bActionTypes\[\s*["'](pvp_\w+)["']\s*\]/g,
]
const HELPER_DEF = /\bfunction\s+[\w.:]*?\b(?:A|A_host|relay)\s*\(\s*(\w+)/g
const HELPER_CALL = /\b(?:A|A_host|relay)\s*\(/g
const ACTION_TYPE = /\bActionType\s*[({]/g
const LITERAL = /^\s*(["'])([^"'\n]*)\1/
const IDENT = /^\s*([A-Za-z_]\w*)\s*[,)}]/

// Comments blanked out (newlines kept, so line numbers hold); strings kept.
function stripComments(lua) {
	let out = ''
	let i = 0
	while (i < lua.length) {
		const c = lua[i]
		if (c === '"' || c === "'") {
			let j = i + 1
			while (j < lua.length && lua[j] !== c && lua[j] !== '\n')
				j += lua[j] === '\\' ? 2 : 1
			out += lua.slice(i, j + 1)
			i = j + 1
		} else if (c === '-' && lua[i + 1] === '-') {
			const long = /^--\[(=*)\[/.exec(lua.slice(i, i + 40))
			const end = long
				? lua.indexOf(`]${long[1]}]`, i + long[0].length)
				: lua.indexOf('\n', i)
			const stop =
				end === -1 ? lua.length : long ? end + long[1].length + 2 : end
			out += lua.slice(i, stop).replace(/[^\n]/g, ' ')
			i = stop
		} else {
			out += c
			i += 1
		}
	}
	return out
}

// The text of the table whose `{` is at `open`, up to its matching `}`.
function tableAt(text, open) {
	let depth = 0
	let i = open
	while (i < text.length) {
		const c = text[i]
		if (c === '"' || c === "'") {
			i += 1
			while (i < text.length && text[i] !== c && text[i] !== '\n')
				i += text[i] === '\\' ? 2 : 1
		} else if (c === '{') depth += 1
		else if (c === '}') {
			depth -= 1
			if (depth === 0) return { start: open, end: i }
		}
		i += 1
	}
	return { start: open, end: text.length }
}

// The index just after `key =` at depth 1 of the table text[start..end], or -1.
function topLevelKeyValue(text, start, end) {
	let depth = 0
	for (let i = start; i < end; i++) {
		const c = text[i]
		if (c === '"' || c === "'") {
			i += 1
			while (i < end && text[i] !== c && text[i] !== '\n')
				i += text[i] === '\\' ? 2 : 1
		} else if (c === '{') depth += 1
		else if (c === '}') depth -= 1
		else if (depth === 1 && c === 'k' && !/[\w.]/.test(text[i - 1] ?? ' ')) {
			const m = /^key\s*=(?!=)/.exec(text.slice(i, i + 20))
			if (m) return i + m[0].length
		}
	}
	return -1
}

/**
 * Reads one Lua source: the sorted pvp_* action keys it names, and the call
 * sites it could not read a key from (`{ line, text }`, line counted from 1).
 */
export function scanLua(lua) {
	const text = stripComments(lua)
	const keys = new Set()
	const misses = []
	const lineOf = (index) => text.slice(0, index).split('\n').length
	const lineText = (index) => {
		const from = text.lastIndexOf('\n', index) + 1
		const to = text.indexOf('\n', index)
		return text.slice(from, to === -1 ? undefined : to).trim()
	}
	const miss = (index) =>
		misses.push({ line: lineOf(index), text: lineText(index) })

	const forwarded = new Set()
	const defs = new Set()
	for (const m of text.matchAll(HELPER_DEF)) {
		forwarded.add(m[1])
		defs.add(m.index + m[0].indexOf('('))
	}

	// Reads the key value that starts at `at`; returns false when it is a miss.
	const readValue = (at) => {
		const rest = text.slice(at)
		const literal = LITERAL.exec(rest)
		if (literal) {
			if (literal[2].startsWith('pvp_') && /^pvp_\w+$/.test(literal[2]))
				keys.add(literal[2])
			return true
		}
		const ident = IDENT.exec(rest)
		return Boolean(ident && forwarded.has(ident[1]))
	}

	for (const m of text.matchAll(HELPER_CALL)) {
		const paren = m.index + m[0].length - 1
		if (defs.has(paren)) continue
		if (!readValue(paren + 1)) miss(m.index)
	}

	for (const m of text.matchAll(ACTION_TYPE)) {
		let open = m.index + m[0].length - 1
		if (text[open] === '(') {
			const brace = /^\s*\{/.exec(text.slice(open + 1))
			if (!brace) {
				miss(m.index)
				continue
			}
			open += brace[0].length
		}
		const { start, end } = tableAt(text, open)
		const at = topLevelKeyValue(text, start, end)
		if (at === -1 || !readValue(at)) miss(m.index)
	}

	for (const form of PLAIN) for (const m of text.matchAll(form)) keys.add(m[1])
	return { keys: [...keys].sort(), misses }
}

/** The sorted, de-duplicated pvp_* action keys named in one Lua source. */
export function extractPvpKeys(lua) {
	return scanLua(lua).keys
}

function luaFiles(dir) {
	const found = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'tests' || entry.name === '.git') continue
		const path = join(dir, entry.name)
		if (entry.isDirectory()) found.push(...luaFiles(path))
		else if (entry.name.endsWith('.lua')) found.push(path)
	}
	return found
}

/**
 * Every non-test .lua file under a mod dir: the sorted pvp_* action keys, and
 * the unreadable call sites as `{ file, line, text }` (file relative to modDir).
 */
export function pvpKeysInMod(modDir) {
	const keys = new Set()
	const misses = []
	for (const file of luaFiles(modDir)) {
		const scan = scanLua(readFileSync(file, 'utf8'))
		for (const key of scan.keys) keys.add(key)
		for (const m of scan.misses)
			misses.push({ file: relative(modDir, file).replace(/\\/g, '/'), ...m })
	}
	return { keys: [...keys].sort(), misses }
}

const isMain =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
	const [modDir, out] = process.argv.slice(2)
	if (!modDir) {
		console.error(
			'usage: node scripts/pvp-relay-keys.mjs <path to the PvP mod> [output file]',
		)
		process.exit(2)
	}
	const target =
		out ??
		join(
			dirname(fileURLToPath(import.meta.url)),
			'../src/lobby/pvp_relay_keys.fixture.json',
		)
	const { keys, misses } = pvpKeysInMod(resolve(modDir))
	if (misses.length > 0) {
		for (const m of misses)
			console.error(`${m.file}:${m.line}: no pvp_ key readable: ${m.text}`)
		console.error(`${misses.length} call site(s) unread; nothing written`)
		process.exit(1)
	}
	writeFileSync(target, `${JSON.stringify(keys, null, '\t')}\n`)
	console.log(`${keys.length} keys -> ${target}`)
}
