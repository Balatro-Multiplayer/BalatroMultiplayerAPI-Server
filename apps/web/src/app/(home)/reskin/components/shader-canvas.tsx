'use client'

import { useEffect, useRef } from 'react'
import { loadShaderFragment, shaderFile, VEC2_SHADERS } from '../lib/shaders'

const VERT = `
attribute vec2 aPos;
varying vec2 vTexCoord;
void main() {
  vTexCoord = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

function buildProgram(
  gl: WebGLRenderingContext,
  vs: string,
  fs: string
): WebGLProgram | null {
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('reskin shader compile error:', gl.getShaderInfoLog(sh))
      return null
    }
    return sh
  }
  const v = compile(gl.VERTEX_SHADER, vs)
  const f = compile(gl.FRAGMENT_SHADER, fs)
  if (!v || !f) return null
  const p = gl.createProgram()
  if (!p) return null
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('reskin shader link error:', gl.getProgramInfoLog(p))
    return null
  }
  return p
}

/** Live WebGL preview of a Balatro edition shader applied to a sprite. Reads the
 *  shader from the exe, animates it via the same time-driven uniforms the game
 *  uses (dissolve/burn neutralized). Sizes itself to its container; pointer
 *  events pass through so an underlying tile stays clickable. */
export function ShaderCanvas({
  sprite,
  option,
  exeBuf,
}: {
  sprite: string
  option: string
  exeBuf: Uint8Array
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Match the canvas resolution to its laid-out display size.
    canvas.width = Math.round(canvas.clientWidth) || 128
    canvas.height = Math.round(canvas.clientHeight) || 128
    let raf = 0
    let disposed = false
    let cleanup = () => {}

    ;(async () => {
      const file = shaderFile(option)
      let frag: string
      try {
        frag = await loadShaderFragment(exeBuf, file)
      } catch {
        return
      }
      if (disposed) return
      const gl = canvas.getContext('webgl', {
        premultipliedAlpha: false,
        alpha: true,
      })
      if (!gl) return
      const prog = buildProgram(gl, VERT, frag)
      if (!prog) return

      const quad = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      )
      const aPos = gl.getAttribLocation(prog, 'aPos')

      const img = new Image()
      img.src = sprite
      try {
        await img.decode()
      } catch {
        /* fall through with a possibly-undecoded image */
      }
      if (disposed) return
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      // The vertex shader already flips Y into vTexCoord, so upload un-flipped:
      // texcoord t=0 = the image's top row (LÖVE's top-left origin).
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const w = img.naturalWidth || canvas.width
      const h = img.naturalHeight || canvas.height

      gl.useProgram(prog)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      const set = (
        name: string,
        fn: (loc: WebGLUniformLocation) => void
      ) => {
        const loc = gl.getUniformLocation(prog, name)
        if (loc) fn(loc)
      }

      const start = performance.now()
      const draw = () => {
        if (disposed) return
        const t = (performance.now() - start) / 1000
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(prog)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        set('uMainTex', (l) => gl.uniform1i(l, 0))
        // The edition's animation vector = { tilt + REAL/28, REAL } at rest.
        if (VEC2_SHADERS.has(file)) set(file, (l) => gl.uniform2f(l, t / 28, t))
        set('vortex_amt', (l) => gl.uniform1f(l, t))
        set('gold_seal', (l) => gl.uniform4f(l, t * 0.03, 0, 0, 0))
        set('time', (l) => gl.uniform1f(l, 100))
        set('dissolve', (l) => gl.uniform1f(l, 0))
        set('texture_details', (l) => gl.uniform4f(l, 0, 0, w, h))
        set('image_details', (l) => gl.uniform2f(l, w, h))
        set('shadow', (l) => gl.uniform1i(l, 0))
        set('burn_colour_1', (l) => gl.uniform4f(l, 0, 0, 0, 0))
        set('burn_colour_2', (l) => gl.uniform4f(l, 0, 0, 0, 0))
        gl.bindBuffer(gl.ARRAY_BUFFER, quad)
        gl.enableVertexAttribArray(aPos)
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        raf = requestAnimationFrame(draw)
      }
      draw()

      cleanup = () => {
        gl.deleteProgram(prog)
        gl.deleteBuffer(quad)
        gl.deleteTexture(tex)
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      cleanup()
    }
  }, [sprite, option, exeBuf])

  return (
    <canvas
      ref={canvasRef}
      className='pointer-events-none absolute inset-0 h-full w-full'
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
