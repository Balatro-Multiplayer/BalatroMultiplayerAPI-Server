import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { buildShaderProgram } from './shaderProgram'

function context(fail?: 'vertex' | 'fragment' | 'link') {
  const deletedShaders: number[] = []
  const deletedPrograms: object[] = []
  const program = {}
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader(type: number) {
      return type
    },
    shaderSource() {},
    compileShader() {},
    getShaderParameter(shader: number) {
      return !(
        (fail === 'vertex' && shader === 1) ||
        (fail === 'fragment' && shader === 2)
      )
    },
    getShaderInfoLog() {
      return 'synthetic compile failure'
    },
    createProgram() {
      return program
    },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() {
      return fail !== 'link'
    },
    getProgramInfoLog() {
      return 'synthetic link failure'
    },
    deleteShader(shader: number) {
      deletedShaders.push(shader)
    },
    deleteProgram(value: object) {
      deletedPrograms.push(value)
    },
  } as unknown as WebGLRenderingContext
  return { gl, program, deletedShaders, deletedPrograms }
}

test('successful preview programs release temporary shader handles but retain the linked program', () => {
  const fixture = context()
  assert.equal(
    buildShaderProgram(fixture.gl, 'vertex', 'fragment'),
    fixture.program
  )
  assert.deepEqual(fixture.deletedShaders, [1, 2])
  assert.deepEqual(fixture.deletedPrograms, [])
})

test('compilation failures are returned to the fallback UI without console errors or shader leaks', () => {
  for (const failure of ['vertex', 'fragment'] as const) {
    const fixture = context(failure)
    assert.throws(
      () => buildShaderProgram(fixture.gl, 'vertex', 'fragment'),
      /synthetic compile failure/
    )
    assert.deepEqual(
      fixture.deletedShaders,
      failure === 'vertex' ? [1] : [1, 2]
    )
    assert.deepEqual(fixture.deletedPrograms, [])
  }
})

test('link failures release both shaders and the failed program', () => {
  const fixture = context('link')
  assert.throws(
    () => buildShaderProgram(fixture.gl, 'vertex', 'fragment'),
    /synthetic link failure/
  )
  assert.deepEqual(fixture.deletedShaders, [1, 2])
  assert.deepEqual(fixture.deletedPrograms, [fixture.program])
})
