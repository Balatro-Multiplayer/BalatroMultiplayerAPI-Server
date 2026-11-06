import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import catalogData from '../data/catalog.json'
import { type Catalog, emptyProject, type ProjectState } from '../lib/types'
import { AssetModalProvider } from './asset-modal'
import { AssetsTab } from './assets-tab'

const catalog: Catalog = {
  ...(catalogData as Catalog),
  spriteCategories: catalogData.spriteCategories.filter(
    (category) => category.id === 'Enhanced'
  ) as Catalog['spriteCategories'],
}

function render(project: ProjectState) {
  return renderToStaticMarkup(
    <AssetModalProvider>
      <AssetsTab
        catalog={catalog}
        project={project}
        setObject={() => {}}
        setSheetCell={() => {}}
        setDeckSkins={() => {}}
        exeBuf={null}
      />
    </AssetModalProvider>
  )
}

test('enhancement editor offers the default background without adding a project edit', () => {
  const project = emptyProject()
  const html = render(project)
  assert.ok(html.includes('title="Default Card Background"'))
  assert.ok(html.includes('c_base'))
  assert.ok(html.includes('title="Bonus"'))
  assert.ok(html.includes('unenhanced cards'))
  assert.ok(!html.includes('title="Clear"'))
  assert.deepEqual(project, emptyProject())
})

test('uploaded default background is shown as its own clearable object edit', () => {
  const project = emptyProject()
  const image = 'data:image/png;base64,c3ludGhldGlj'
  project.objects['Enhanced/c_base'] = { sprites: [image] }
  const html = render(project)
  assert.ok(html.includes(`src="${image}"`))
  assert.equal((html.match(/title="Clear"/g) ?? []).length, 1)
  assert.ok(html.includes('title="Bonus"'))
  assert.deepEqual(Object.keys(project.objects), ['Enhanced/c_base'])
})
