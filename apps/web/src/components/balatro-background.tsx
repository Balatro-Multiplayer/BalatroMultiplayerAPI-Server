'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@/lib/reduced-motion'
import { BalatroSwirl } from './balatro-swirl'

// Direct port of Balatro's resources/shaders/background.fs (the main-menu swirl).
// LÖVE's effect(...) → main() using gl_FragCoord; love_ScreenSize → u_resolution.
const FRAG = `
precision highp float;
uniform float u_time;
uniform float u_spinTime;
uniform vec4 u_colour1;
uniform vec4 u_colour2;
uniform vec4 u_colour3;
uniform float u_contrast;
uniform float u_spinAmount;
uniform vec2 u_resolution;

#define PIXEL_SIZE_FAC 700.0
#define SPIN_EASE 0.5

void main() {
  vec2 screenSize = u_resolution;
  vec2 screen_coords = gl_FragCoord.xy;

  float pixel_size = length(screenSize.xy) / PIXEL_SIZE_FAC;
  vec2 uv = (floor(screen_coords.xy * (1.0 / pixel_size)) * pixel_size - 0.5 * screenSize.xy) / length(screenSize.xy);
  float uv_len = length(uv);

  float speed = (u_spinTime * SPIN_EASE * 0.2) + 302.2;
  float new_pixel_angle = atan(uv.y, uv.x) + speed - SPIN_EASE * 20.0 * (1.0 * u_spinAmount * uv_len + (1.0 - 1.0 * u_spinAmount));
  vec2 mid = (screenSize.xy / length(screenSize.xy)) / 2.0;
  uv = (vec2((uv_len * cos(new_pixel_angle) + mid.x), (uv_len * sin(new_pixel_angle) + mid.y)) - mid);

  uv *= 30.0;
  speed = u_time * 2.0;
  vec2 uv2 = vec2(uv.x + uv.y);

  for (int i = 0; i < 5; i++) {
    uv2 += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121), sin(uv2.x - 0.113 * speed));
    uv -= 1.0 * cos(uv.x + uv.y) - 1.0 * sin(uv.x * 0.711 - uv.y);
  }

  float contrast_mod = (0.25 * u_contrast + 0.5 * u_spinAmount + 1.2);
  float paint_res = min(2.0, max(0.0, length(uv) * 0.035 * contrast_mod));
  float c1p = max(0.0, 1.0 - contrast_mod * abs(1.0 - paint_res));
  float c2p = max(0.0, 1.0 - contrast_mod * abs(paint_res));
  float c3p = 1.0 - min(1.0, c1p + c2p);

  vec4 ret_col = (0.3 / u_contrast) * u_colour1 + (1.0 - 0.3 / u_contrast) * (u_colour1 * c1p + u_colour2 * c2p + vec4(c3p * u_colour3.rgb, c3p * u_colour1.a));
  gl_FragColor = ret_col;
}
`

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

// Main-menu palette: G.C.BLACK = #374244, mapped to the shader's three colours via
// ease_background_colour{new_colour = G.C.BLACK, contrast = 1}.
const BLACK = [0x37 / 255, 0x42 / 255, 0x44 / 255] as const
const COLOUR_1 = BLACK.map((c) => c * 0.9) // C
const COLOUR_2 = BLACK.map((c) => c * 1.3) // L
const COLOUR_3 = BLACK.map((c) => c * 0.7) // D
const CONTRAST = 1.0
const SPIN_AMOUNT = 0.5 // subtle centre rotation
const SPIN_RATE = 0.5 // how fast spin_time advances (seconds)
const STATIC_TIME = 6.0 // frozen frame shown when motion is reduced

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[balatro-bg] shader compile failed:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function BalatroBackground() {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  // Persisted clocks so toggling motion on/off doesn't jump.
  const timeRef = useRef(0)
  const spinTimeRef = useRef(0)
  const drawRef = useRef<((time: number, spin: number) => void) | null>(null)

  // One-time GL setup.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl =
      canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false }) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) {
      setFailed(true)
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      setFailed(true)
      return
    }
    const prog = gl.createProgram()
    if (!prog) {
      setFailed(true)
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[balatro-bg] link failed:', gl.getProgramInfoLog(prog))
      setFailed(true)
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    // Two triangles covering clip space.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const u = {
      time: gl.getUniformLocation(prog, 'u_time'),
      spinTime: gl.getUniformLocation(prog, 'u_spinTime'),
      colour1: gl.getUniformLocation(prog, 'u_colour1'),
      colour2: gl.getUniformLocation(prog, 'u_colour2'),
      colour3: gl.getUniformLocation(prog, 'u_colour3'),
      contrast: gl.getUniformLocation(prog, 'u_contrast'),
      spinAmount: gl.getUniformLocation(prog, 'u_spinAmount'),
      resolution: gl.getUniformLocation(prog, 'u_resolution'),
    }

    // Static uniforms (palette).
    gl.uniform4f(u.colour1, COLOUR_1[0]!, COLOUR_1[1]!, COLOUR_1[2]!, 1)
    gl.uniform4f(u.colour2, COLOUR_2[0]!, COLOUR_2[1]!, COLOUR_2[2]!, 1)
    gl.uniform4f(u.colour3, COLOUR_3[0]!, COLOUR_3[1]!, COLOUR_3[2]!, 1)
    gl.uniform1f(u.contrast, CONTRAST)
    gl.uniform1f(u.spinAmount, SPIN_AMOUNT)

    const draw = (time: number, spin: number) => {
      gl.uniform1f(u.time, time)
      gl.uniform1f(u.spinTime, spin)
      gl.uniform2f(u.resolution, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    drawRef.current = draw

    const resize = () => {
      // Render at CSS pixels (the shader pixelates by resolution anyway) — cheap
      // for a full-screen fragment pass.
      const w = Math.max(1, Math.floor(canvas.clientWidth))
      const h = Math.max(1, Math.floor(canvas.clientHeight))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
      draw(timeRef.current, spinTimeRef.current)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => {
      ro.disconnect()
      drawRef.current = null
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [])

  // Start/stop the animation loop based on the reduced-motion preference.
  useEffect(() => {
    const draw = drawRef.current
    if (!draw) return

    if (reduced) {
      draw(STATIC_TIME, spinTimeRef.current)
      return
    }

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      timeRef.current += dt
      spinTimeRef.current += dt * SPIN_RATE
      draw(timeRef.current, spinTimeRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [reduced, failed])

  if (failed) return <BalatroSwirl />

  return (
    <canvas
      ref={canvasRef}
      aria-hidden='true'
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        background: 'var(--bal-panel-dark)',
      }}
    />
  )
}
