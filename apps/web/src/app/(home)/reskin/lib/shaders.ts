// Load Balatro's real edition shaders from the user's exe and transpile LÖVE's
// GLSL dialect to WebGL1 so the studio can preview foil/holo/polychrome/etc.
// live. No shader source is shipped — it is read from the exe like the atlases.

import { inflateRaw, readFusedZip } from './exeAssets'

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

async function readMember(exe: Uint8Array, path: string): Promise<string> {
  const entry = readFusedZip(exe).get(path)
  if (!entry) throw new Error(`${path} not found in the game archive`)
  const bytes = entry.method === 0 ? entry.data : await inflateRaw(entry.data)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Transpile a LÖVE fragment shader to a WebGL1 (GLSL ES 1.00) fragment shader:
 *  drop the vertex-only hover block, map LÖVE's keywords, and add a main() that
 *  invokes effect() over a full-screen quad. */
function transpile(src: string): string {
  // Remove the `#ifdef VERTEX … #endif` position() block (hover tilt); unused.
  let s = src.replace(/#ifdef VERTEX[\s\S]*?#endif/g, '')
  // `extern` is a reserved word, so swap the token itself rather than #define.
  s = s.replace(/\bextern\b/g, 'uniform')
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

/** Read a shader .fs from the exe and transpile it to a WebGL1 fragment shader. */
export async function loadShaderFragment(
  exe: Uint8Array,
  file: string
): Promise<string> {
  const src = await readMember(exe, `resources/shaders/${file}.fs`)
  return transpile(src)
}
