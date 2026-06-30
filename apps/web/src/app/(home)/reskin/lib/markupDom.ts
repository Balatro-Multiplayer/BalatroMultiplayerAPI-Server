// DOM <-> markup-model helpers for the WYSIWYG editor. Pure DOM (no React) so
// they can be unit-tested under jsdom. The editor renders the model to HTML via
// buildHtml and reads it back via readDoc; caret positions map through
// pointToIndex / indexToPoint (atom-index <-> DOM point).

import {
  type Atom,
  type Doc,
  groupRuns,
  resolveColor,
  type Style,
} from './balatroMarkup'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

function inlineStyle(style: Style): string {
  const parts: string[] = []
  if (style.X) {
    parts.push(`background-color:${resolveColor(style.X)}`)
    parts.push(`color:${style.C ? resolveColor(style.C) : '#FFFFFF'}`)
    parts.push('border-radius:4px', 'padding:0 4px')
  } else if (style.C) {
    parts.push(`color:${resolveColor(style.C)}`)
  }
  // No colour -> inherit the surrounding (input) foreground.
  if (style.s) parts.push(`font-size:${Number(style.s)}em`)
  return parts.join(';')
}

export function effectClass(style: Style): string {
  if (style.E === '1') return 'bal-e1'
  if (style.E === '2') return 'bal-e2'
  return ''
}

function atomsHtml(atoms: Atom[]): string {
  let html = ''
  for (const a of atoms) {
    if (a.kind === 'char') html += esc(a.ch)
    else
      html += `<span data-var="${escAttr(a.n)}" contenteditable="false" class="mx-[1px] inline-block rounded-sm bg-black/15 px-1 text-[0.85em]">#${esc(a.n)}#</span>`
  }
  return html
}

export function buildHtml(doc: Doc): string {
  return doc
    .map((line) => {
      if (line.length === 0) return '<div data-line><br></div>'
      const runs = groupRuns(line)
        .map(
          (run) =>
            `<span data-style="${escAttr(JSON.stringify(run.style))}" class="${effectClass(run.style)}" style="${inlineStyle(run.style)}">${atomsHtml(run.atoms)}</span>`
        )
        .join('')
      return `<div data-line>${runs}</div>`
    })
    .join('')
}

/** Read one line element back into atoms, inheriting the nearest span's style. */
function readLine(lineEl: Element): Atom[] {
  const atoms: Atom[] = []
  const rec = (node: Node, style: Style) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        for (const ch of child.textContent ?? '')
          atoms.push({ kind: 'char', ch, style })
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        if (el.dataset.var !== undefined) {
          atoms.push({ kind: 'var', n: el.dataset.var, style })
        } else if (el.dataset.style !== undefined) {
          let st: Style = {}
          try {
            st = JSON.parse(el.dataset.style)
          } catch {}
          rec(el, st)
        } else {
          rec(el, style) // <br> or stray wrapper
        }
      }
    })
  }
  rec(lineEl, {})
  return atoms
}

export function readDoc(root: HTMLElement): Doc {
  const lines = Array.from(root.querySelectorAll(':scope > [data-line]'))
  if (lines.length === 0) return [readLine(root)]
  return lines.map(readLine)
}

/** Count atoms before a DOM point within a line element. */
export function pointToIndex(lineEl: Element, node: Node, offset: number): number {
  let idx = 0
  let done = false
  const rec = (n: Node): boolean => {
    if (done) return true
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) {
        idx += offset
        done = true
        return true
      }
      idx += (n.textContent ?? '').length
      return false
    }
    const el = n as HTMLElement
    if (el.dataset && el.dataset.var !== undefined) {
      if (n === node) {
        done = true
        return true
      }
      idx += 1
      return false
    }
    const kids = Array.from(n.childNodes)
    for (let i = 0; i < kids.length; i++) {
      if (n === node && i === offset) {
        done = true
        return true
      }
      if (rec(kids[i]!)) return true
    }
    if (n === node && offset >= kids.length) {
      done = true
      return true
    }
    return false
  }
  rec(lineEl)
  return idx
}

/** Map an atom index within a line back to a DOM (node, offset) caret point. */
export function indexToPoint(
  lineEl: Element,
  target: number
): { node: Node; offset: number } {
  let idx = 0
  let result: { node: Node; offset: number } | null = null
  const rec = (n: Node): boolean => {
    if (result) return true
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.textContent ?? '').length
      if (target <= idx + len) {
        result = { node: n, offset: target - idx }
        return true
      }
      idx += len
      return false
    }
    const el = n as HTMLElement
    if (el.dataset && el.dataset.var !== undefined) {
      if (target <= idx) {
        const parent = n.parentNode!
        result = {
          node: parent,
          offset: Array.from(parent.childNodes).indexOf(n as ChildNode),
        }
        return true
      }
      idx += 1
      return false
    }
    for (const kid of Array.from(n.childNodes)) if (rec(kid)) return true
    return false
  }
  rec(lineEl)
  if (result) return result
  return { node: lineEl, offset: lineEl.childNodes.length }
}

export interface Caret {
  line: number
  idx: number
}

function lineElOf(node: Node, root: HTMLElement): Element | null {
  let n: Node | null = node
  while (n && n !== root) {
    if (
      n.nodeType === Node.ELEMENT_NODE &&
      (n as HTMLElement).dataset.line !== undefined
    )
      return n as Element
    n = n.parentNode
  }
  return null
}

export function getSelection(
  root: HTMLElement
): { start: Caret; end: Caret } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const lineEls = Array.from(root.querySelectorAll(':scope > [data-line]'))
  const toCaret = (node: Node, offset: number): Caret | null => {
    const le = lineElOf(node, root) ?? (lineEls[0] as Element | undefined)
    if (!le) return null
    return { line: lineEls.indexOf(le), idx: pointToIndex(le, node, offset) }
  }
  const a = toCaret(sel.anchorNode!, sel.anchorOffset)
  const b = toCaret(sel.focusNode!, sel.focusOffset)
  if (!a || !b) return null
  const before = a.line < b.line || (a.line === b.line && a.idx <= b.idx)
  return before ? { start: a, end: b } : { start: b, end: a }
}

export function restoreSelection(
  root: HTMLElement,
  caret: { start: Caret; end: Caret }
) {
  const lineEls = Array.from(root.querySelectorAll(':scope > [data-line]'))
  const s = lineEls[caret.start.line]
  const e = lineEls[caret.end.line]
  if (!s || !e) return
  const p1 = indexToPoint(s, caret.start.idx)
  const p2 = indexToPoint(e, caret.end.idx)
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.setStart(p1.node, p1.offset)
  range.setEnd(p2.node, p2.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}
