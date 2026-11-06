/** Compile/link a preview without logging console errors (Next's dev overlay
 * intercepts those). The caller displays a local fallback for unsupported GPUs
 * or shaders. Release temporary shader objects on both success and failure. */
export function buildShaderProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create a preview shader')
    shaders.push(shader)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(
        gl.getShaderInfoLog(shader) || 'Preview shader compilation failed'
      )
    }
    return shader
  }
  try {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
    program = gl.createProgram()
    if (!program) throw new Error('Could not create a preview program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        gl.getProgramInfoLog(program) || 'Preview shader linking failed'
      )
    }
    return program
  } catch (error) {
    if (program) gl.deleteProgram(program)
    throw error
  } finally {
    for (const shader of shaders) gl.deleteShader(shader)
  }
}
