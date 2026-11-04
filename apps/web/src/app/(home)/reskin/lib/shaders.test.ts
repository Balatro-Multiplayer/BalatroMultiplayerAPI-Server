import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { GameArchive } from './gameArchive'
import { loadShaderFragment, transpileShader } from './shaders'
import { createZip, zipText } from './zip'

// Synthetic fixture with the same non-constant loop-bound declaration; no
// proprietary shader code or effect algorithm is embedded in these tests.
const loopShader = `
vec4 effect(vec4 color, Image tex, vec2 uv, vec2 screen) {
  int glow_samples = 2;
  float count = 0.0;
  for (int i = -glow_samples; i <= glow_samples; ++i) {
    for (int j = -glow_samples; j <= glow_samples; ++j) {
      count += float(i * i + j * j);
    }
  }
  return vec4(count / 100.0);
}`

test('WebGL 1 glow loop bounds become constant without changing their radius or loop body', () => {
  const converted = transpileShader(loopShader)
  assert.ok(converted.includes('const int glow_samples = 2;'))
  assert.ok(
    converted.includes('for (int i = -glow_samples; i <= glow_samples; ++i)')
  )
  assert.ok(
    converted.includes('for (int j = -glow_samples; j <= glow_samples; ++j)')
  )
  assert.ok(converted.includes('count += float(i * i + j * j);'))
  assert.ok(!converted.includes('const const'))
})

test('already-constant loop bounds are unchanged and runtime counters are not made const', () => {
  const src = loopShader.replace('int glow_samples', 'const int glow_samples')
  const converted = transpileShader(src)
  assert.equal((converted.match(/const int glow_samples/g) ?? []).length, 1)
  assert.ok(!converted.includes('const const'))
  const counter = transpileShader('int actual_glow_samples = 0;')
  assert.ok(counter.includes('int actual_glow_samples = 0;'))
  assert.ok(!counter.includes('const int actual_glow_samples'))
})

test('shader conversion still maps Love uniforms, texture calls and the fragment entrypoint', () => {
  const fragment = transpileShader(
    'extern number phase;\n#ifdef VERTEX\nvoid unused_vertex() {}\n#endif\n' +
      loopShader
  )
  assert.ok(fragment.includes('uniform number phase;'))
  assert.ok(!fragment.includes('unused_vertex'))
  assert.ok(fragment.includes('#define Texel texture2D'))
  assert.ok(fragment.includes('gl_FragColor = effect('))
})

function archive(shader: string) {
  return new GameArchive(
    createZip([
      { name: 'resources/shaders/hologram.fs', data: zipText(shader) },
    ])
  )
}

test('concurrent shader reads share work within an archive, not across game imports', async () => {
  const first = archive(loopShader)
  const second = archive(loopShader.replace('= 2;', '= 3;'))
  const pending = loadShaderFragment(first, 'hologram')
  assert.equal(loadShaderFragment(first, 'hologram'), pending)
  assert.ok((await pending).includes('const int glow_samples = 2;'))
  assert.ok(
    (await loadShaderFragment(second, 'hologram')).includes(
      'const int glow_samples = 3;'
    )
  )
})

test('failed shader reads can retry instead of poisoning the cache', async () => {
  const game = new GameArchive(createZip([]))
  const pending = loadShaderFragment(game, 'hologram')
  await assert.rejects(pending, /hologram.fs not found/)
  const retry = loadShaderFragment(game, 'hologram')
  assert.notEqual(retry, pending)
  await assert.rejects(retry, /hologram.fs not found/)
})
