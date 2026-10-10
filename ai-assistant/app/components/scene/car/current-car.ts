import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface CarMaterials {
  paint: THREE.MeshStandardMaterial
  carbon: THREE.MeshStandardMaterial
  black: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  head: THREE.MeshBasicMaterial
  tail: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  tire: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  rotor: THREE.MeshStandardMaterial
  caliper: THREE.MeshStandardMaterial
  holo: THREE.MeshBasicMaterial
}

export interface CarBuild {
  group: THREE.Group
  materials: CarMaterials
  /** Libera todas las geometrías y materiales creados (seguro de llamar una vez). */
  dispose: () => void
}

/**
 * Geometría del Countach actual (porte fiel de la que vivía en AriaScene.tsx),
 * extraída a un módulo sin React ni DOM para poder medirla headless en tests.
 *
 * Se fusiona por material (`mergeGeometries`) lo que no se mueve, manteniendo
 * idéntico el aspecto: mismas primitivas, mismas transformaciones (horneadas
 * en la geometría), normalizadas las normales luego de escalas no uniformes.
 * Las mallas que se transforman (ruedas) quedan por pieza pero comparten
 * geometría/material entre ruedas equivalentes.
 */
export function buildCar(): CarBuild {
  const car = new THREE.Group()
  const geos = new Set<THREE.BufferGeometry>()
  const track = (g: THREE.BufferGeometry) => {
    geos.add(g)
    return g
  }

  const M: CarMaterials = {
    paint: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.9, roughness: 0.26, envMapIntensity: 1.45 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.8 }),
    black: new THREE.MeshStandardMaterial({ color: 0x08090b, metalness: 0.75, roughness: 0.2, envMapIntensity: 1.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1015, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.82, envMapIntensity: 2.2 }),
    head: new THREE.MeshBasicMaterial({ color: 0xddf4ff }),
    tail: new THREE.MeshStandardMaterial({ color: 0x2a0208, emissive: 0xff0836, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1.0, roughness: 0.24, envMapIntensity: 1.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.95, metalness: 0.1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x202328, metalness: 0.8, roughness: 0.34 }),
    rotor: new THREE.MeshStandardMaterial({ color: 0x121416, metalness: 0.75, roughness: 0.4 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc62828, metalness: 0.6, roughness: 0.35 }),
    holo: new THREE.MeshBasicMaterial({ color: 0xff0044, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
  }

  // Partes estáticas (se fusionan por material al final) y ruedas
  const staticMeshes: THREE.Mesh[] = []
  const add = (mesh: THREE.Mesh, emissive = false) => {
    if (emissive) (mesh.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending
    mesh.castShadow = false
    mesh.receiveShadow = false
    staticMeshes.push(mesh)
    car.add(mesh)
    return mesh
  }

  // cuerpo
  add(new THREE.Mesh(track(new THREE.BoxGeometry(2.0, 0.22, 4.4)), M.paint)).position.y = 0.3
  add(new THREE.Mesh(track(new THREE.BoxGeometry(2.02, 0.28, 4.3)), M.carbon)).position.y = 0.32

  const noseBase = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.98, 0.24, 1.4)), M.paint))
  noseBase.position.set(0, 0.38, 1.55)
  const beakGeo = track(new THREE.CylinderGeometry(0.72, 1.94, 0.9, 4))
  beakGeo.rotateY(Math.PI / 4)
  const beak = add(new THREE.Mesh(beakGeo, M.paint))
  beak.position.set(0, 0.34, 2.15)
  beak.scale.set(1.0, 0.28, 1.1)
  const splitter = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.95, 0.05, 0.55)), M.carbon))
  splitter.position.set(0, 0.16, 2.3)
  const frontSlit = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.08, 0.12)), M.black))
  frontSlit.position.set(0, 0.36, 2.5)
  const badge = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.08, 0.04)), M.gold))
  badge.position.set(0, 0.44, 2.35)

  // faros
  ;[-0.64, 0.64].forEach((x) => {
    const housing = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.48, 0.09, 0.22)), M.black))
    housing.position.set(x, 0.45, 2.22)
    const led = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.42, 0.045, 0.06)), M.head), true)
    led.position.set(x, 0.45, 2.33)
  })

  // cabina
  const cabinGeo = track(new THREE.CylinderGeometry(1.22, 1.82, 0.64, 4))
  cabinGeo.rotateY(Math.PI / 4)
  const cabin = add(new THREE.Mesh(cabinGeo, M.glass))
  cabin.position.set(0, 0.78, 0.02)
  cabin.scale.set(0.96, 1.0, 1.45)
  const roof = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.28, 0.06, 1.35)), M.paint))
  roof.position.set(0, 1.1, 0.02)
  const aPillars = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.45, 0.08, 0.1)), M.paint))
  aPillars.position.set(0, 0.88, 0.78)

  // laterales
  ;[-0.98, 0.98].forEach((x) => {
    const flank = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.48, 1.8)), M.paint))
    flank.position.set(x, 0.52, 0.05)
    const naca = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.32, 0.75)), M.carbon))
    naca.position.set(x * 0.98, 0.54, -0.45)
    const louver = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.22, 0.48)), M.black))
    louver.position.set(x * 0.92, 0.78, -0.68)
    const mirrorArm = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.18, 0.04, 0.06)), M.carbon))
    mirrorArm.position.set(x * 1.04, 0.82, 0.62)
    const mirrorCap = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.12, 0.1)), M.black))
    mirrorCap.position.set(x * 1.14, 0.84, 0.62)
  })

  // trasero
  const rearDeck = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.82, 0.26, 1.55)), M.paint))
  rearDeck.position.set(0, 0.6, -1.35)
  const engineCover = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.92, 0.05, 1.15)), M.glass))
  engineCover.position.set(0, 0.72, -1.25)
  const rearTailCluster = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.78, 0.1, 0.1)), M.black))
  rearTailCluster.position.set(0, 0.62, -2.14)
  ;[-0.62, 0.62].forEach((x) => {
    const tail = add(new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.045, 0.04)), M.tail), true)
    tail.position.set(x, 0.62, -2.19)
  })
  const diffuser = add(new THREE.Mesh(track(new THREE.BoxGeometry(1.88, 0.22, 0.42)), M.carbon))
  diffuser.position.set(0, 0.25, -2.12)
  ;[-0.32, -0.16, 0.16, 0.32].forEach((x) => {
    const tipGeo = track(new THREE.CylinderGeometry(0.055, 0.055, 0.18, 16))
    tipGeo.rotateX(Math.PI / 2)
    const tip = add(new THREE.Mesh(tipGeo, M.rim))
    tip.position.set(x, 0.28, -2.25)
  })

  // ruedas
  const wheelGeo = track(new THREE.CylinderGeometry(0.39, 0.39, 0.32, 28))
  wheelGeo.rotateZ(Math.PI / 2)
  const rotorGeo = track(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24))
  rotorGeo.rotateZ(Math.PI / 2)
  const caliperGeo = track(new THREE.BoxGeometry(0.08, 0.16, 0.14))
  const rimDialGeo = track(new THREE.TorusGeometry(0.26, 0.055, 12, 24))
  rimDialGeo.rotateY(Math.PI / 2)
  const wheelPositions: [number, number, number, number][] = [
    [-0.96, 0.39, 1.45, 1],
    [0.96, 0.39, 1.45, -1],
    [-0.98, 0.39, -1.42, 1],
    [0.98, 0.39, -1.42, -1],
  ]

  // Las ruedas girarán sobre su propio eje X: no se fusionan entre sí, pero cada
  // giro queda como pocas mallas por material compartiendo geometría con sus
  // pares (izquierda y derecha son especulares: offsets en X con signo).
  type SpinnerKey = 'tire' | 'rim' | 'rotor' | 'gold'
  interface SpinnerPart {
    mesh: THREE.Mesh
    key: SpinnerKey
  }
  interface WheelBuild {
    spinner: THREE.Group
    dir: number
    parts: SpinnerPart[]
  }
  const wheels: WheelBuild[] = []
  const spinnerCache = new Map<string, THREE.BufferGeometry>()

  const isIdentity = (m: THREE.Matrix4) => m.elements.every((v, i) => (i % 5 === 0 ? v === 1 : v === 0))

  const mergeSpinnerParts = (spinner: THREE.Group, parts: SpinnerPart[], key: SpinnerKey, cacheKey: string) => {
    const group = parts.filter((p) => p.key === key)
    if (!group.length) return null
    const first = group[0].mesh
    const material = first.material as THREE.Material
    if (group.length === 1 && isIdentity(first.matrix)) {
      // Transformación identidad: reutilizar la misma geometría (compartida).
      return new THREE.Mesh(first.geometry, material)
    }
    let geo = spinnerCache.get(cacheKey)
    if (!geo) {
      for (const p of group) p.mesh.updateMatrixWorld()
      if (group.length === 1) {
        geo = group[0].mesh.geometry.clone().applyMatrix4(group[0].mesh.matrixWorld)
      } else {
        const geos2 = group.map((p) => p.mesh.geometry.clone().applyMatrix4(p.mesh.matrixWorld))
        const merged = mergeGeometries(geos2, false)
        if (!merged) return null
        geo = merged
      }
      geo.normalizeNormals()
      geos.add(geo)
      spinnerCache.set(cacheKey, geo)
    }
    return new THREE.Mesh(geo, material)
  }

  wheelPositions.forEach(([x, y, z, dir]) => {
    const spinner = new THREE.Group()
    spinner.position.set(x, y, z)
    const parts: SpinnerPart[] = []

    const tag = (mesh: THREE.Mesh, key: SpinnerKey) => {
      mesh.castShadow = false
      mesh.receiveShadow = false
      parts.push({ mesh, key })
      spinner.add(mesh)
      return mesh
    }

    tag(new THREE.Mesh(wheelGeo, M.tire), 'tire')
    const rimOuter = tag(new THREE.Mesh(rimDialGeo, M.rim), 'rim')
    rimOuter.position.x = dir * 0.14
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5
      const dialHole = tag(new THREE.Mesh(track(new THREE.TorusGeometry(0.07, 0.02, 8, 16)), M.rim), 'rim')
      dialHole.rotateY(Math.PI / 2)
      dialHole.position.set(dir * 0.14, Math.sin(angle) * 0.14, Math.cos(angle) * 0.14)
    }
    const centerLock = tag(new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12)), M.gold), 'gold')
    centerLock.rotateZ(Math.PI / 2)
    centerLock.position.x = dir * 0.16
    tag(new THREE.Mesh(rotorGeo, M.rotor), 'rotor')

    const caliper = new THREE.Mesh(caliperGeo, M.caliper)
    caliper.castShadow = false
    caliper.receiveShadow = false
    caliper.position.set(x + dir * 0.02, y + 0.12, z + 0.04)
    staticMeshes.push(caliper)
    car.add(caliper)

    car.add(spinner)
    wheels.push({ spinner, dir, parts })
  })

  // Ruedas: reemplazar las ~9 mallas originales por 4 fusionadas por material
  // (compuestas en el espacio del spinner, que es el que rota).
  for (const { spinner, dir, parts } of wheels) {
    for (const key of ['tire', 'rim', 'rotor', 'gold'] as const) {
      const mesh = mergeSpinnerParts(spinner, parts, key, `${key}:${dir}`)
      if (mesh) spinner.add(mesh)
    }
    for (const p of parts) spinner.remove(p.mesh)
  }

  // Estáticos: fusionar por material para recortar draw calls sin tocar el
  // aspecto (las transformaciones se hornean y las normales se re-normalizan).
  car.updateMatrixWorld(true)
  const groupsByMaterial = new Map<THREE.Material, THREE.Mesh[]>()
  for (const m of staticMeshes) {
    const mat = m.material as THREE.Material
    let arr = groupsByMaterial.get(mat)
    if (!arr) {
      arr = []
      groupsByMaterial.set(mat, arr)
    }
    arr.push(m)
  }
  const mergedStatic: THREE.Mesh[] = []
  for (const [mat, meshes] of groupsByMaterial) {
    if (meshes.length === 1) {
      mergedStatic.push(meshes[0])
      continue
    }
    const geos2 = meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld))
    const merged = mergeGeometries(geos2, false)
    if (!merged) {
      mergedStatic.push(...meshes)
      continue
    }
    merged.normalizeNormals()
    geos.add(merged)
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mergedStatic.push(mesh)
  }
  for (const m of staticMeshes) car.remove(m)
  for (const m of mergedStatic) car.add(m)

  return {
    group: car,
    materials: M,
    dispose: () => {
      geos.forEach((g) => g.dispose())
      geos.clear()
      Object.values(M).forEach((m) => m.dispose())
    },
  }
}