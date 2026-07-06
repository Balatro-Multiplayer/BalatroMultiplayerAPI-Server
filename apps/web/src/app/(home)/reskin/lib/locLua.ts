// Parse Balatro's localization `.lua` files in the browser. They are a strict,
// escape-free, comment-free JSON-subset of Lua: `return { ... }` over nested
// tables, array tables, and "..." strings, with trailing commas and keys that
// are bare identifiers or ["quoted"]. We parse that subset (numbers/booleans
// handled defensively) and flatten to the same path->value map the build script
// produces, so no game text needs to ship.

import type { LocValues } from './types'

export type LocNode =
  | string
  | number
  | boolean
  | null
  | LocNode[]
  | { [k: string]: LocNode }

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c)

/** Parse a `return <value>` localization Lua file into a JS value. */
export function parseLocLua(src: string): LocNode {
  let i = 0
  const n = src.length
  const fail = (m: string): never => {
    throw new Error(`locLua: ${m} at offset ${i}`)
  }

  const ws = () => {
    while (i < n) {
      const c = src[i]!
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++
      else break
    }
  }

  const parseString = (): string => {
    if (src[i] !== '"') fail('expected string')
    i++
    let out = ''
    while (i < n) {
      const c = src[i++]!
      if (c === '"') return out
      if (c === '\\') {
        const e = src[i++]!
        out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e
      } else out += c
    }
    return fail('unterminated string')
  }

  const parseValue = (): LocNode => {
    ws()
    const c = src[i]!
    if (c === '{') return parseTable()
    if (c === '"') return parseString()
    if (src.startsWith('true', i)) {
      i += 4
      return true
    }
    if (src.startsWith('false', i)) {
      i += 5
      return false
    }
    if (src.startsWith('nil', i)) {
      i += 3
      return null
    }
    if (/[0-9+\-.]/.test(c)) {
      const start = i
      while (i < n && /[0-9a-fA-F+\-.xXeE]/.test(src[i]!)) i++
      return Number(src.slice(start, i))
    }
    return fail(`unexpected '${c}'`)
  }

  const parseTable = (): LocNode => {
    i++ // consume '{'
    const arr: LocNode[] = []
    const obj: Record<string, LocNode> = {}
    let isMap = false
    for (;;) {
      ws()
      if (src[i] === '}') {
        i++
        break
      }
      const c = src[i]!
      if (c === '[') {
        i++
        ws()
        const key = parseString()
        ws()
        if (src[i] !== ']') fail("expected ']'")
        i++
        ws()
        if (src[i] !== '=') fail("expected '=' after [key]")
        i++
        obj[key] = parseValue()
        isMap = true
      } else if (isIdentStart(c)) {
        const start = i
        while (i < n && isIdent(src[i]!)) i++
        const key = src.slice(start, i)
        ws()
        if (src[i] !== '=') fail("expected '=' after key")
        i++
        obj[key] = parseValue()
        isMap = true
      } else {
        arr.push(parseValue())
      }
      ws()
      if (src[i] === ',') i++ // trailing comma allowed
    }
    return isMap ? obj : arr
  }

  ws()
  if (!src.startsWith('return', i)) fail("expected 'return'")
  i += 6
  return parseValue()
}

/** Flatten a parsed loc node to path->value, mirroring build-catalog's flatten:
 *  strings pass through, all-string arrays are kept, other arrays/scalars drop. */
export function flattenLoc(node: LocNode): LocValues {
  const out: LocValues = {}
  const walk = (v: LocNode, prefix: string) => {
    if (typeof v === 'string') {
      out[prefix] = v
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'string')) out[prefix] = v as string[]
    } else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        walk(val, prefix ? `${prefix}.${k}` : k)
      }
    }
  }
  walk(node, '')
  return out
}
