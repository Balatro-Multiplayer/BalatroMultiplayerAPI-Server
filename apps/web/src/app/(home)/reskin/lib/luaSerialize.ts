// Serialize plain JS data to a Lua `return { ... }` module, matching the format
// Balatro/SMODS data files use. Handles strings, numbers, booleans, arrays and
// string-keyed maps.

type LuaValue =
  | string
  | number
  | boolean
  | LuaValue[]
  | { [k: string]: LuaValue }

function luaString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

// A bare Lua identifier can be written as `key =`; everything else needs ["..."].
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function luaKey(k: string): string {
  return IDENT.test(k) ? `${k} =` : `[${luaString(k)}] =`
}

function serialize(v: LuaValue, indent: number): string {
  const pad = '\t'.repeat(indent)
  const padIn = '\t'.repeat(indent + 1)
  if (typeof v === 'string') return luaString(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) {
    if (v.length === 0) return '{}'
    const items = v.map((x) => `${padIn}${serialize(x, indent + 1)},`)
    return `{\n${items.join('\n')}\n${pad}}`
  }
  const keys = Object.keys(v)
  if (keys.length === 0) return '{}'
  const items = keys.map(
    (k) => `${padIn}${luaKey(k)} ${serialize(v[k]!, indent + 1)},`
  )
  return `{\n${items.join('\n')}\n${pad}}`
}

export function toLuaModule(value: LuaValue): string {
  return `return ${serialize(value, 0)}\n`
}

/**
 * Rebuild a nested object from dot-path edits, e.g.
 *   { "descriptions.Joker.j_x.name": "Foo", "misc.dictionary.k_y": "Bar" }
 * becomes { descriptions = { Joker = { j_x = { name = "Foo" } } }, ... }.
 * Array leaves (text lines) are passed through as-is.
 */
export function nestEdits(
  edits: Record<string, string | string[]>
): { [k: string]: LuaValue } {
  const root: { [k: string]: LuaValue } = {}
  for (const [path, value] of Object.entries(edits)) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      const existing = node[part]
      if (typeof existing !== 'object' || Array.isArray(existing)) {
        node[part] = {}
      }
      node = node[part] as { [k: string]: LuaValue }
    }
    node[parts[parts.length - 1]!] = value
  }
  return root
}
