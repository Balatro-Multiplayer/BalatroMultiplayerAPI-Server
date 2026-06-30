// Balatro description-text markup: parse <-> a per-character atom model, and
// render-time helpers. Ported from the game's `loc_parse_string` / `localize`
// (functions/misc_functions.lua). A `{...}` tag RESETS all style and starts a new
// run; style never cascades. `{}` resets to default. `#n#` are runtime variable
// slots. Inside an `X:` run the game strips whitespace, which we replicate.

export type Style = Record<string, string>

export type Atom =
  | { kind: 'char'; ch: string; style: Style }
  | { kind: 'var'; n: string; style: Style }

export type Line = Atom[]
export type Doc = Line[]

// Named colours -> hex (verified against G.C in globals.lua). Unknown names fall
// back to the default body colour, exactly like loc_colour's `_default`.
export const DEFAULT_COLOR = '#4F6367'
export const COLORS: Record<string, string> = {
  red: '#FE5F55',
  mult: '#FE5F55',
  blue: '#009DFF',
  chips: '#009DFF',
  green: '#4BC292',
  money: '#F3B958',
  gold: '#EAC058',
  attention: '#FF9A00',
  purple: '#8867A5',
  white: '#FFFFFF',
  inactive: 'rgba(136,136,136,0.6)',
  spades: '#374649',
  hearts: '#FE5F55',
  clubs: '#424E54',
  diamonds: '#FE5F55',
  tarot: '#A782D1',
  planet: '#13AFCE',
  spectral: '#4584FA',
  edition: '#FFFFFF',
  dark_edition: '#000000',
  legendary: '#B26CBB',
  enhanced: '#8389DD',
}

/** Colour names offered in the toolbar (text colours). */
export const COLOR_NAMES = [
  'red',
  'blue',
  'green',
  'attention',
  'money',
  'gold',
  'purple',
  'spectral',
  'tarot',
  'planet',
  'enhanced',
  'legendary',
  'white',
  'inactive',
  'spades',
  'hearts',
  'clubs',
  'diamonds',
  'dark_edition',
]

/** Colours that make sense as an `X:` box fill. */
export const BOX_NAMES = ['mult', 'chips', 'money', 'gold', 'dark_edition', 'purple']

export function resolveColor(name: string | undefined): string {
  if (!name) return DEFAULT_COLOR
  return COLORS[name] ?? DEFAULT_COLOR
}

const KEY_ORDER = ['C', 'X', 'V', 's', 'E', 'T']

export function styleKey(style: Style): string {
  const keys = Object.keys(style).sort()
  return keys.map((k) => `${k}=${style[k]}`).join('|')
}

export function stylesEqual(a: Style, b: Style): boolean {
  return styleKey(a) === styleKey(b)
}

export function isEmptyStyle(style: Style): boolean {
  return Object.keys(style).length === 0
}

// --- parse ------------------------------------------------------------------

interface Part {
  strings: (string | { ref: string })[]
  control: Style
}

/** Port of loc_parse_string: a single line -> ordered parts. */
function parseLineToParts(line: string): Part[] {
  const parsed: Part[] = []
  let control: Style = {}
  let inControl = false
  let cName: string | null = null
  let cVal: string | null = null
  let cGather = false
  let sGather = false
  let sRef: string | null = null
  let strParts: (string | { ref: string })[] = []

  const flush = () => {
    if (strParts.length > 0) parsed.push({ strings: strParts, control })
  }
  // append a literal char to the trailing literal slot (creating one if needed)
  const appendChar = (ch: string) => {
    const last = strParts[strParts.length - 1]
    if (typeof last === 'string') strParts[strParts.length - 1] = last + ch
    else strParts.push(ch)
  }

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (char === '{') {
      flush()
      strParts = []
      control = {}
      inControl = true
      cName = null
      cVal = null
      cGather = false
      sGather = false
      sRef = null
    } else if (inControl && char !== ':' && char !== '}' && !cGather) {
      cName = (cName ?? '') + char
    } else if (inControl && char === ':') {
      cGather = true
    } else if (inControl && char !== ',' && char !== '}' && cGather) {
      cVal = (cVal ?? '') + char
    } else if (inControl && (char === ',' || char === '}')) {
      cGather = false
      if (cName) control[cName] = cVal ?? ''
      cName = null
      cVal = null
      if (char === '}') inControl = false
    } else if (!inControl && char !== '#' && !sGather) {
      appendChar(control.X ? char.replace(/\s+/g, '') : char)
    } else if (!inControl && char === '#' && !sGather) {
      sGather = true
    } else if (!inControl && char === '#' && sGather) {
      sGather = false
      if (sRef) {
        strParts.push({ ref: sRef })
        sRef = null
      }
    } else if (!inControl && sGather) {
      sRef = (sRef ?? '') + char
    }
  }
  flush()
  return parsed
}

function partToAtoms(part: Part): Atom[] {
  const out: Atom[] = []
  for (const s of part.strings) {
    if (typeof s === 'string') {
      for (const ch of s) out.push({ kind: 'char', ch, style: part.control })
    } else {
      out.push({ kind: 'var', n: s.ref, style: part.control })
    }
  }
  return out
}

export function parseMarkup(lines: string[]): Doc {
  return lines.map((line) =>
    parseLineToParts(line).flatMap(partToAtoms)
  )
}

// --- serialize --------------------------------------------------------------

function tagFor(style: Style): string {
  if (isEmptyStyle(style)) return '{}'
  const keys = Object.keys(style)
  const ordered = [
    ...KEY_ORDER.filter((k) => k in style),
    ...keys.filter((k) => !KEY_ORDER.includes(k)).sort(),
  ]
  return `{${ordered.map((k) => `${k}:${style[k]}`).join(',')}}`
}

function serializeLine(atoms: Line): string {
  let out = ''
  let prevStyled = false
  let i = 0
  while (i < atoms.length) {
    const style = atoms[i]!.style
    // gather the run of same-style atoms
    let text = ''
    while (i < atoms.length && stylesEqual(atoms[i]!.style, style)) {
      const a = atoms[i]!
      text += a.kind === 'char' ? a.ch : `#${a.n}#`
      i++
    }
    if (isEmptyStyle(style)) {
      if (prevStyled) out += '{}'
      out += text
      prevStyled = false
    } else {
      out += tagFor(style) + text
      prevStyled = true
    }
  }
  return out
}

export function serializeMarkup(doc: Doc): string[] {
  return doc.map(serializeLine)
}

/** serialize(parse(x)) — stable form used for change detection. */
export function normalize(lines: string[]): string[] {
  return serializeMarkup(parseMarkup(lines))
}

export interface Run {
  style: Style
  atoms: Atom[]
}

/** Group a line's atoms into consecutive same-style runs (for rendering). */
export function groupRuns(line: Line): Run[] {
  const runs: Run[] = []
  let i = 0
  while (i < line.length) {
    const style = line[i]!.style
    const atoms: Atom[] = []
    while (i < line.length && stylesEqual(line[i]!.style, style)) {
      atoms.push(line[i]!)
      i++
    }
    runs.push({ style, atoms })
  }
  return runs
}

export const asLines = (v: string | string[] | undefined): string[] =>
  v === undefined ? [''] : Array.isArray(v) ? v : [v]
