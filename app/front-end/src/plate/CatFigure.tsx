import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bounds, OrbitControls, Outlines, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Cat } from '@/data/catsRepo'

/* The 3D cat, spec §7 / §8.4. The lesson here is the reconciler: <mesh> is
   not a DOM element — R3F renders a React tree into a three.js scene graph.

   Mounted only while a plate is open (App.tsx unmounts the whole plate on
   close), so there is never an idle WebGL context. That is also why
   frameloop can stay "always": the only time this renders continuously is
   while a plate is on screen and the cat is actually turning. */

const MODEL = '/cat.glb'
useGLTF.preload(MODEL)

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/* Two-step toon ramp: a 2px texture sampled with NEAREST, so lighting lands
   in exactly two bands — lit and shaded — the way an inked plate is hatched.
   Any filtering here and it becomes a gradient, which is the look we are
   specifically not doing. */
function twoStepRamp() {
  const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 255, 255, 255, 255]), 2, 1)
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.needsUpdate = true
  return ramp
}

function Figure({ colour }: { colour: Cat['colour'] }) {
  const { scene } = useGLTF(MODEL)
  const group = useRef<THREE.Group>(null)

  /* The GLB is a rigged, animated game asset. We want one still figure, so
     the skeleton is dropped entirely and the bind-pose geometry is baked
     through its node's world matrix — no mixer, no SkinnedMesh, and
     <Outlines> gets to be a plain child of a plain mesh. */
  const geometry = useMemo(() => {
    scene.updateMatrixWorld(true)
    let found: THREE.Mesh | undefined
    scene.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
    })
    if (!found) throw new Error(`${MODEL} has no mesh`)
    const baked = found.geometry.clone()
    baked.applyMatrix4(found.matrixWorld)
    baked.center()
    return baked
  }, [scene])

  const ramp = useMemo(twoStepRamp, [])

  // 4°/s, spec §7. Rotating the model rather than the camera keeps <Bounds>'s
  // fit valid and keeps OrbitControls' target where the user left it.
  useFrame((_, delta) => {
    if (group.current && !reduced()) group.current.rotation.y += 0.0698 * delta
  })

  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        {/* The atlas texture the model ships with is deliberately unused: a
            game asset's baked colours are the fastest way to make this look
            like an asset store. Flat toon in the cat's own territory token
            keeps the plate on-palette. */}
        <meshToonMaterial color={token(colour)} gradientMap={ramp} />
        <Outlines thickness={3} screenspace color={token('--ink')} />
      </mesh>
    </group>
  )
}

export function CatFigure({ colour }: { colour: Cat['colour'] }) {
  return (
    <div className="plate-figure">
      <Canvas
        orthographic
        frameloop={reduced() ? 'demand' : 'always'}
        camera={{ position: [2.4, 1.5, 2.4], zoom: 100 }}
        fallback={<span>[ 3D unavailable ]</span>}
        // three.js defaults the renderer's clear colour to opaque black no
        // matter what `alpha` is set to on the context — that flag only
        // permits transparency, it doesn't enable it. Nothing was ever
        // clearing to transparent, so every frame painted black first,
        // showing through wherever the model doesn't cover the canvas
        // (most of it — <Bounds margin={1.5}> leaves 50% slack on purpose).
        onCreated={({ gl }) => gl.setClearAlpha(0)}
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[3, 4, 2]} intensity={2.4} />
        <Suspense fallback={null}>
          {/* Fits the camera to the model instead of hand-tuned zoom values.
              The margin is slack for the turn: a fit measured at one angle
              clips at the next. */}
          <Bounds fit clip observe margin={1.5}>
            <Figure colour={colour} />
          </Bounds>
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          // Never past the horizon — a field-guide plate does not show the
          // underside of the specimen.
          minPolarAngle={Math.PI * 0.15}
          maxPolarAngle={Math.PI * 0.5}
        />
      </Canvas>
    </div>
  )
}
