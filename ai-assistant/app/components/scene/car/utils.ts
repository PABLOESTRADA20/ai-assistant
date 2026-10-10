import * as THREE from 'three'

export interface CarStats {
  meshes: number
  lines: number
  points: number
  /**
   * En esta escena no hay instancing: cada objeto con geometría equivale a un
   * draw call del renderer. Coincide con `renderer.info.render.calls` cuando
   * todo el grupo está en pantalla.
   */
  drawCalls: number
  triangles: number
  vertices: number
  materials: number
}

/** Cuenta los objetos del grupo sin depender de WebGL (para tests y CI). */
export function collectStats(root: THREE.Object3D): CarStats {
  let meshes = 0
  let lines = 0
  let points = 0
  let triangles = 0
  let vertices = 0
  const mats = new Set<THREE.Material>()

  root.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material
    if (Array.isArray(mat)) mat.forEach((m) => mats.add(m))
    else if (mat) mats.add(mat)

    if (obj instanceof THREE.Points) {
      points++
      return
    }
    if (obj instanceof THREE.LineSegments) {
      lines++
      return
    }
    if (obj instanceof THREE.Line) {
      lines++
      return
    }
    if (obj instanceof THREE.Mesh) {
      meshes++
      const g = obj.geometry
      const pos = g?.attributes?.position
      if (pos) {
        vertices += pos.count
        if (g.index) triangles += Math.floor(g.index.count / 3)
        else triangles += Math.floor(pos.count / 3)
      }
    }
  })

  return {
    meshes,
    lines,
    points,
    drawCalls: meshes + lines + points,
    triangles,
    vertices,
    materials: mats.size,
  }
}

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'envMap',
  'alphaMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'lightMap',
  'specularMap',
] as const

/**
 * Libera geometrías, materiales y texturas de un subárbol. Seguro de llamar
 * con objetos ya liberados (los Sets evitan dobles disposes).
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  const collectMaterial = (m: THREE.Material) => {
    if (materials.has(m)) return
    materials.add(m)
    const anyM = m as unknown as Record<string, unknown>
    for (const key of MATERIAL_TEXTURE_KEYS) {
      const v = anyM[key]
      if (v instanceof THREE.Texture) textures.add(v)
    }
  }

  root.traverse((obj) => {
    const o = obj as THREE.Mesh
    if (o.geometry) geometries.add(o.geometry)
    const mat = o.material
    if (Array.isArray(mat)) mat.forEach(collectMaterial)
    else if (mat) collectMaterial(mat)
  })

  geometries.forEach((g) => g.dispose())
  materials.forEach((m) => m.dispose())
  textures.forEach((t) => t.dispose())
}