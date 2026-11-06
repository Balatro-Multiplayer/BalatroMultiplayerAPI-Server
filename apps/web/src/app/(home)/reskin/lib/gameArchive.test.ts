import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { readFusedZip, readLocFromExe } from './exeAssets'
import { GameArchive } from './gameArchive'

test('large archives expose no byte indices to React render inspection', () => {
  const bytes = new Uint8Array(70 * 1024 * 1024)
  const archive = new GameArchive(bytes)
  assert.equal(archive.readBytes(), bytes)
  assert.deepEqual(Object.keys(archive), [])
  const enumerable: string[] = []
  for (const key in archive) enumerable.push(key)
  assert.deepEqual(enumerable, [])
  assert.equal(JSON.stringify(archive), '{}')
})

test('opaque archives retain existing ZIP and localization reader behavior', async () => {
  const enc = new TextEncoder()
  const bytes = zipSync({
    'localization/en-us.lua': enc.encode(
      'return { misc = { test = "Synthetic" } }'
    ),
  })
  const archive = new GameArchive(bytes)
  assert.deepEqual(
    [...readFusedZip(archive).keys()],
    [...readFusedZip(bytes).keys()]
  )
  assert.deepEqual(
    await readLocFromExe(archive, 'en-us'),
    await readLocFromExe(bytes, 'en-us')
  )
})
