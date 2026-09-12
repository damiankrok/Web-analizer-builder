/**
 * Three.js viewer.
 *
 * Three.js is a viewer and a debug surface only (§45). It owns no domain
 * geometry, no scoring and no camera truth: it receives triangles the portable
 * solid generator produced and displays them. The materials mirror the study
 * shader's intent so the browser view and the rendered audit images read alike.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type ViewerTri = {
  a: { x: number; y: number; z: number }
  b: { x: number; y: number; z: number }
  c: { x: number; y: number; z: number }
  part: string
  ownerId: string
}

export type ViewerEdge = { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; kind: string }

export type ViewerProps = {
  tris: ViewerTri[]
  edges: ViewerEdge[]
  /** Element classes to hide, for roof-off and storey views. */
  hidden: ReadonlySet<string>
}

const SOLID_PARTS = new Set(['WALL', 'WALL_INNER', 'REVEAL', 'SLAB', 'ROOF', 'ROOF_SOFFIT', 'FEATURE'])

export function Viewer({ tris, edges, hidden }: ViewerProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = host.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xeeedea)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    container.appendChild(renderer.domElement)

    // Study-model materials: near-white opaque solids, restrained glass.
    const solid = new THREE.MeshLambertMaterial({ color: 0xf2f0ec, side: THREE.DoubleSide })
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xa8c0d0,
      transparent: true,
      opacity: 0.38,
      roughness: 0.08,
      metalness: 0,
      side: THREE.DoubleSide,
    })

    const build = (predicate: (t: ViewerTri) => boolean, material: THREE.Material): THREE.Mesh | null => {
      const positions: number[] = []
      for (const t of tris) {
        if (hidden.has(t.part) || !predicate(t)) continue
        positions.push(t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z, t.c.x, t.c.y, t.c.z)
      }
      if (positions.length === 0) return null
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.computeVertexNormals()
      return new THREE.Mesh(geometry, material)
    }

    const opaque = build((t) => SOLID_PARTS.has(t.part), solid)
    const transparent = build((t) => !SOLID_PARTS.has(t.part), glass)
    if (opaque) scene.add(opaque)
    if (transparent) scene.add(transparent)

    const edgePositions: number[] = []
    for (const e of edges) edgePositions.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z)
    if (edgePositions.length > 0) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
      scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5c6066 })))
    }

    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-8, 14, 9)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(10, 6, -8)
    scene.add(fill)

    const box = new THREE.Box3()
    for (const t of tris) {
      box.expandByPoint(new THREE.Vector3(t.a.x, t.a.y, t.a.z))
      box.expandByPoint(new THREE.Vector3(t.b.x, t.b.y, t.b.z))
      box.expandByPoint(new THREE.Vector3(t.c.x, t.c.y, t.c.z))
    }
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2)

    // Orbit by drag; no external controls dependency.
    let azimuth = 0.6
    let elevation = 0.35
    let distance = radius * 2.6
    let dragging = false
    let lastX = 0
    let lastY = 0

    const place = (): void => {
      camera.position.set(
        centre.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
        centre.y + Math.sin(elevation) * distance,
        centre.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
      )
      camera.lookAt(centre)
    }

    const onDown = (e: PointerEvent): void => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      azimuth -= (e.clientX - lastX) * 0.008
      elevation = Math.max(-0.2, Math.min(1.3, elevation + (e.clientY - lastY) * 0.006))
      lastX = e.clientX
      lastY = e.clientY
      place()
      renderer.render(scene, camera)
    }
    const onUp = (): void => {
      dragging = false
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      distance = Math.max(radius * 1.2, Math.min(radius * 8, distance * (1 + Math.sign(e.deltaY) * 0.12)))
      place()
      renderer.render(scene, camera)
    }

    const resize = (): void => {
      const w = container.clientWidth
      const h = Math.max(260, Math.round(w * 0.62))
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      place()
      renderer.render(scene, camera)
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', resize)
    resize()

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [tris, edges, hidden])

  return <div ref={host} className="viewer" />
}
