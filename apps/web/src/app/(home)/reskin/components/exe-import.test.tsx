import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExeImport } from './exe-import'

const props = {
  canPickHandle: false,
  onPickExe() {},
  onExeFile() {},
  onAppFiles() {},
  onForgetExe() {},
  savedExeName: null,
  borderReady: false,
  busy: false,
  importing: false,
}

test('game import offers a drop zone, every supported format and app fallback instructions', () => {
  const html = renderToStaticMarkup(<ExeImport {...props} />)
  for (const text of [
    'data-game-drop-zone',
    'Drop Balatro.app, .love, .exe, or an app ZIP here',
    'Files stay on your device',
    'App drops depend on your browser',
    'Choose installation folder',
    'Choose ZIP / .love / .exe',
    'Contents → Resources',
    'aria-label="Balatro game import"',
  ])
    assert.ok(html.includes(text), text)
  assert.ok(html.includes('accept=".exe,.love,.zip"'))
  assert.ok(!html.includes('accept=".app'))
})

test('the drop area reports import activity while picker controls stay disabled', () => {
  const html = renderToStaticMarkup(<ExeImport {...props} busy importing />)
  assert.ok(html.includes('Importing your game…'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4)
})
