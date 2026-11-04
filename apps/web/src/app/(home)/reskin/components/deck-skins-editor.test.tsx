import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import catalog from '../data/catalog.json'
import type { CatalogSheet, PlayingCardSkin } from '../lib/types'
import { AssetModalProvider } from './asset-modal'
import { DeckSkinsEditor } from './deck-skins-editor'

function render(skins: PlayingCardSkin[]) {
  const sheet = catalog.spriteSheets.find(
    (entry) => entry.id === 'playing_cards'
  ) as CatalogSheet
  return renderToStaticMarkup(
    <AssetModalProvider>
      <DeckSkinsEditor
        skins={skins}
        setSkins={() => {}}
        modName='My Mod'
        sheet={sheet}
        archive={null}
      />
    </AssetModalProvider>
  )
}

test('card skin editor exposes multiple editable names with two contrast slots each', () => {
  const html = render([
    { id: 'bugs', name: 'Bugs', low: 'data:image/png;base64,YnVncw==' },
    { id: 'night', name: 'Night', high: 'data:image/png;base64,bmlnaHQ=' },
  ])
  assert.ok(html.includes('value="Bugs"'))
  assert.ok(html.includes('value="Night"'))
  assert.equal((html.match(/>Remove skin</g) ?? []).length, 2)
  assert.equal(
    (html.match(/<button[^>]*title="Low contrast"/g) ?? []).length,
    2
  )
  assert.equal(
    (html.match(/<button[^>]*title="High contrast"/g) ?? []).length,
    2
  )
  assert.ok(html.includes('Optional — uses the low-contrast sheet.'))
  assert.ok(html.includes('Optional — uses the high-contrast sheet.'))
  assert.ok(html.includes('Add card skin'))
})

test('draft card skin is editable but marked as not appearing in-game until art is provided', () => {
  const html = render([{ id: 'draft', name: '' }])
  assert.ok(html.includes('placeholder="My Mod"'))
  assert.ok(html.includes('will not appear in-game until you add a sheet'))
  assert.ok(!html.includes('title="Clear"'))
  assert.ok(render([]).includes('No card skins yet'))
})
