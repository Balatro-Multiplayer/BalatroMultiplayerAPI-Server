// Load Balatro's real edition shaders from the user's exe and transpile LÖVE's
// GLSL dialect to WebGL1 so the studio can preview foil/holo/polychrome/etc.
// live. No shader source is shipped — it is read from the exe like the atlases.

import { inflateRaw, readFusedZip } from './exeAssets'
import type { GameArchive } from './gameArchive'

// A studio shader option -> the actual .fs the game draws with. gold_seal is
// rendered with the voucher shader in-game; everything else maps to itself.
const FILE_FOR: Record<string, string> = { gold_seal: 'voucher' }

export function shaderFile(option: string): string {
  return FILE_FOR[option] ?? option
}

// Editions driven by a vec2 uniform named after the file (the animation phase).
// vortex is the exception (a single float, vortex_amt).
export const VEC2_SHADERS = new Set([
  'foil',
  'holo',
  'polychrome',
  'negative',
  'negative_shine',
  'hologram',
  'played',
  'debuff',
  'booster',
  'voucher',
])

async function readMember(
  exe: Uint8Array | GameArchive,
  path: string
): Promise<string> {
  const entry = readFusedZip(exe).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const bytes =
    entry.method === 0 ? entry.data : await inflateRaw(entry.data, entry.size)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Transpile a LÖVE fragment shader to a WebGL1 (GLSL ES 1.00) fragment shader:
 *  drop the vertex-only hover block, map LÖVE's keywords, and add a main() that
 *  invokes effect() over a full-screen quad. */
export function transpileShader(src: string): string {
  // Remove the `#ifdef VERTEX … #endif` position() block (hover tilt); unused.
  let s = src.replace(/#ifdef VERTEX[\s\S]*?#endif/g, '')
  // `extern` is a reserved word, so swap the token itself rather than #define.
  s = s.replace(/\bextern\b/g, 'uniform')
  // Hologram's fixed glow radius is declared as an ordinary local int. GLSL
  // ES 1.00 requires a constant expression in both nested loop initializers
  // and bounds. Keep the imported radius, but make its declaration constant.
  s = s.replace(
    /^(\s*)int\s+glow_samples\s*=\s*(\d+)\s*;/gm,
    '$1const int glow_samples = $2;'
  )
  const header = [
    'precision highp float;',
    '#define number float',
    '#define Image sampler2D',
    '#define Texel texture2D',
    'varying vec2 vTexCoord;',
    'uniform sampler2D uMainTex;',
  ].join('\n')
  const main = [
    'void main() {',
    '  gl_FragColor = effect(vec4(1.0), uMainTex, vTexCoord, gl_FragCoord.xy);',
    '}',
  ].join('\n')
  return `${header}\n${s}\n${main}`
}

// Share in-flight reads within an imported game, never stale shader source
// across different game imports. Weak keys release cached fragments on forget.
const fragCache = new WeakMap<
  Uint8Array | GameArchive,
  Map<string, Promise<string>>
>()

/** Read a shader .fs from the exe and transpile it to a WebGL1 fragment shader. */
export function loadShaderFragment(
  exe: Uint8Array | GameArchive,
  file: string
): Promise<string> {
  let files = fragCache.get(exe)
  if (!files) {
    files = new Map()
    fragCache.set(exe, files)
  }
  const cached = files.get(file)
  if (cached) return cached
  const pending = readMember(exe, `resources/shaders/${file}.fs`).then(
    transpileShader
  )
  files.set(file, pending)
  void pending.catch(() => files.delete(file))
  return pending
}
