import { useEffect, useRef } from 'react'
import { useMap } from './MapCanvas'
import { FRAG, VERT } from './clouds.glsl'

/* Clouds and distance haze, rev 6 (replaces the SVG-ellipse version).

   A cloud deck between the camera and the city, not clouds in the sky:
   there is no sky. At DEFAULT_PITCH 55 the camera looks down far enough
   that the horizon never enters the frame (pitch plus half the field of
   view stays under 90 degrees, the same threshold SKY_MIN_PITCH encodes in
   style.ts), so the viewport is entirely ground and anything drawn above
   the skyline would have nowhere to sit.

   Its own <canvas> with its own WebGL context, sitting over the map like
   the previous SVG version did. Deliberately NOT a MapLibre
   CustomLayerInterface: this is decoration in screen space that never needs
   to be occluded by a building or depth-tested against the scene, so
   sharing MapLibre's context would buy nothing and couple this to the
   map's render lifecycle. */

/* Their own tokens, NOT --ink-soft/--paper. --paper is what the background
   and earth layers paint the ground with, so using it here drew the haze in
   the exact colour of the thing it floats over and the whole layer read as
   nothing. buildSky in style.ts carries the same warning about the same
   mistake. */
const CLOUD_TOKEN = '--cloud'
const FOG_TOKEN = '--haze'

/* Tuning. Coverage is a threshold, so HIGHER means less cloud. */
const COVERAGE = 0.45
const OPACITY = 0.9
const WIND = 1.0

/** Resolves a CSS custom property to normalised rgb. Goes through a real
    `color` property rather than parsing the token text, because several of
    these tokens are color-mix() results that getComputedStyle returns
    unevaluated. Same reason style.ts keeps its own probe. */
function tokenRgb(name: string): [number, number, number] {
  const probe = document.createElement('div')
  probe.style.display = 'none'
  probe.style.color = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const m = resolved.match(/-?[\d.]+/g)
  if (!m) return [0.5, 0.5, 0.5]
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Surfaced rather than swallowed: a shader that fails to compile
    // otherwise renders as nothing at all, which is indistinguishable from
    // the layer simply being switched off.
    console.error('[clouds] shader compile failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function Clouds() {
  const { isFlat, theme } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the rAF loop rather than in its dependencies, so toggling
  // 3D does not tear down and rebuild the whole GL context.
  const visibleRef = useRef(!isFlat)
  visibleRef.current = !isFlat

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // No alpha:false here: the whole point is compositing over the map.
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    })
    if (!gl) {
      // WebGL2 unavailable. The map is still fully usable; clouds are
      // decoration, so this degrades to nothing rather than to an error.
      console.warn('[clouds] no webgl2, skipping')
      return
    }

    const vert = compile(gl, gl.VERTEX_SHADER, VERT)
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vert || !frag) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[clouds] link failed:', gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    // One full-screen triangle pair.
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    )
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const u = {
      time: gl.getUniformLocation(program, 'uTime'),
      res: gl.getUniformLocation(program, 'uRes'),
      cloud: gl.getUniformLocation(program, 'uCloud'),
      fog: gl.getUniformLocation(program, 'uFog'),
      coverage: gl.getUniformLocation(program, 'uCoverage'),
      opacity: gl.getUniformLocation(program, 'uOpacity'),
      wind: gl.getUniformLocation(program, 'uWind'),
    }

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    gl.uniform1f(u.coverage, COVERAGE)
    gl.uniform1f(u.opacity, OPACITY)
    gl.uniform3fv(u.cloud, tokenRgb(CLOUD_TOKEN))
    gl.uniform3fv(u.fog, tokenRgb(FOG_TOKEN))

    /* Under reduced motion the deck holds one frame instead of drifting.
       Wind goes to zero rather than the loop being skipped, so the clouds
       are still there, just still. */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gl.uniform1f(u.wind, reduced ? 0 : WIND)

    /* Capped at 1.5 rather than devicePixelRatio: this is a full-screen
       fragment shader with four octaves of noise per pixel, and on a 3x
       phone screen the honest resolution costs about five times the work
       for detail that soft cloud edges cannot show anyway. */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    /* Tracks whether THIS invocation's resize() has ever run its real
       branch, alongside the pixel-dimension check below rather than
       instead of it. Found and fixed as the same bug already caught in
       map/Rain.tsx: under StrictMode this effect mounts, is cleaned up,
       and mounts again on the same persistent <canvas> DOM node. Cleanup
       cancels the animation frame but leaves canvas.width/height exactly
       as the first mount set them. The second (surviving) mount links its
       OWN fresh WebGL program with its OWN independent uRes uniform, and
       without this flag its resize() saw a canvas that already matched
       the target size and returned before ever calling
       gl.uniform2f(u.res, w, h) for that program, leaving uRes at its
       zero-initialised default forever. The shader divides by it on its
       very first line (`uv.x *= uRes.x / uRes.y`), so a never-set uRes is
       0/0: NaN silently poisons every pixel, no console error, the clouds
       just never appear. Reproduced outside the browser before this fix
       was written; see the scratch reproduction from that investigation. */
    let sized = false
    const resize = () => {
      const w = Math.floor(canvas.clientWidth * dpr)
      const h = Math.floor(canvas.clientHeight * dpr)
      if (sized && canvas.width === w && canvas.height === h) return
      sized = true
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
      gl.uniform2f(u.res, w, h)
    }
    resize()
    window.addEventListener('resize', resize)

    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick)
      // Flat view shows no cloud, and a paused shader costs nothing but the
      // rAF callback itself. Checked per frame rather than by tearing the
      // context down, so the 3D toggle stays instant.
      if (!visibleRef.current) return
      resize()
      gl.uniform1f(u.time, (now - start) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    })

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vert)
      gl.deleteShader(frag)
      /* Deliberately NOT calling WEBGL_lose_context here. StrictMode mounts,
         cleans up and remounts against the same <canvas> DOM node, and
         getContext('webgl2') on a canvas returns the one existing context
         rather than a new one — so losing it in cleanup would hand the
         second mount a dead context, on which every call fails silently and
         the layer renders nothing. In dev only, which is the worst place for
         it to hide. The context goes away with the canvas element when the
         component really unmounts, which is the only case that matters. */
    }
  }, [])

  /* Colours are the one thing a theme change has to push into the shader.
     Its own effect, so a theme flip re-uploads two uniforms instead of
     rebuilding the context. */
  useEffect(() => {
    const gl = canvasRef.current?.getContext('webgl2')
    const program = gl?.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
    if (!gl || !program) return
    gl.uniform3fv(gl.getUniformLocation(program, 'uCloud'), tokenRgb(CLOUD_TOKEN))
    gl.uniform3fv(gl.getUniformLocation(program, 'uFog'), tokenRgb(FOG_TOKEN))
  }, [theme])

  return (
    <canvas
      className="clouds"
      ref={canvasRef}
      data-visible={String(!isFlat)}
      aria-hidden="true"
    />
  )
}
