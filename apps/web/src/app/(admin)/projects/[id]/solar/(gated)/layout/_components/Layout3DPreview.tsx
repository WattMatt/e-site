'use client'
/**
 * Read-only 3D preview (functional spec §6.3): roof planes at their heights,
 * tilted module rows, obstructions; orbit/zoom, Reset view, Screenshot to PNG.
 * Loaded with next/dynamic (ssr: false) only when opened.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildScene3d, type LayoutObject, type Vec3 } from '@esite/shared'

function polygonMesh(top: Vec3[], color: string) {
  const shape2d = top.map((v) => new THREE.Vector2(v[0], v[1]))
  const tris = THREE.ShapeUtils.triangulateShape(shape2d, [])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(top.flatMap((v) => v), 3))
  g.setIndex(tris.flat())
  g.computeVertexNormals()
  return <mesh geometry={g}><meshStandardMaterial color={color} side={THREE.DoubleSide} /></mesh>
}

function Controls({ resetRef, target }: { resetRef: React.MutableRefObject<(() => void) | null>; target: THREE.Vector3 }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.copy(target)
    c.update()
    c.saveState()
    resetRef.current = () => c.reset()
    return () => c.dispose()
  }, [camera, gl, target, resetRef])
  return null
}

export function Layout3DPreview({ objects, framePpm = null }: { objects: LayoutObject[]; framePpm?: number | null }) {
  const scene = useMemo(() => buildScene3d(objects, framePpm), [objects, framePpm])
  const resetRef = useRef<(() => void) | null>(null)
  const glRef = useRef<HTMLCanvasElement | null>(null)
  const all = [...scene.roofs.flatMap((r) => r.top), ...scene.modules.flatMap((m) => m.corners)]
  const cx = all.length ? all.reduce((s, v) => s + v[0], 0) / all.length : 0
  const cy = all.length ? all.reduce((s, v) => s + v[1], 0) / all.length : 0
  const target = useMemo(() => new THREE.Vector3(cx, 0, -cy), [cx, cy])

  function screenshot() {
    const url = glRef.current?.toDataURL('image/png')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'layout-3d.png'
    a.click()
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, fontSize: 12, marginBottom: 4 }}>
        <button type="button" onClick={() => resetRef.current?.()}>Reset view</button>
        <button type="button" onClick={screenshot}>Screenshot</button>
      </div>
      <div style={{ height: 420, border: '1px solid var(--c-border)', borderRadius: 8 }}>
        <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [cx + 30, 40, -cy + 30], fov: 45 }}
          onCreated={({ gl }) => { glRef.current = gl.domElement }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[20, 40, 10]} intensity={0.8} />
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {scene.roofs.map((r) => <group key={r.id}>{polygonMesh(r.top, '#d6d3d1')}</group>)}
            {scene.modules.map((m, i) => <group key={`${m.arrayId}-${i}`}>{polygonMesh(m.corners, '#1d4ed8')}</group>)}
            {scene.obstructions.map((o) => <group key={o.id}>{polygonMesh(o.base.map((v) => [v[0], v[1], v[2] + o.heightM] as Vec3), '#dc2626')}</group>)}
          </group>
          <Controls resetRef={resetRef} target={target} />
        </Canvas>
      </div>
    </div>
  )
}
