import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Countach LP5000 Quattrovalvole "clásico" (procedural, sin assets externos).
 *
 * Sistema de coordenadas: 1 u = 1 m, +Z frontal, +Y arriba, suelo en Y=0,
 * ejes de rueda en Y = radio de la llanta.
 * Dimensiones objetivo: largo 4.14 · ancho 2.00 (en los flares traseros) ·
 * alto 1.07 · batalla 2.50.
 *
 * Estrategia de partes (equivalente procedural a un GLB por nodos nombrados):
 * cada parte es un grupo con nombre cuya geometría queda horneada en su
 * coordenada final; el grupo se mueve para el efecto "explode" (`?explode=1`).
 * Cada parte fusiona sus mallas por material (mismo aspecto, pocos draw
 * calls). El casco principal sale de extrudir el perfil lateral (cuña con
 * pasos de rueda cóncavos) a lo ancho; los flares cubren los pasos.
 * Sin CSG, sin texturas de red y sin `document`: medible headless.
 */
export interface Lp5000Materials {
  paint: THREE.MeshPhysicalMaterial
  black: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  tail: THREE.MeshStandardMaterial
  tire: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  rotor: THREE.MeshStandardMaterial
  caliper: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  plate: THREE.MeshStandardMaterial
  holo: THREE.MeshBasicMaterial
}

export interface CarPart {
  id: string
  group: THREE.Group
  /** Posición del grupo en reposo (ensamblado). */
  base: THREE.Vector3
  /** Desplazamiento del grupo para explode en v=1 (v=0 = ensamblado). */
  explode: THREE.Vector3
}

export interface Lp5000Build {
  group: THREE.Group
  parts: CarPart[]
  spinners: THREE.Group[]
  materials: Lp5000Materials
  dispose: () => void
}

export interface WheelCfg {
  x: number
  z: number
  r: number
  w: number
}

/** Configuración por rueda: trochas 1.49 (delante) y 1.61 (atrás). */
export const WHEELS: WheelCfg[] = [
  { x: -0.745, z: 1.25, r: 0.29, w: 0.24 }, // delantero izquierdo
  { x: 0.745, z: 1.25, r: 0.29, w: 0.24 }, // delantero derecho
  { x: -0.805, z: -1.25, r: 0.31, w: 0.32 }, // trasero izquierdo
  { x: 0.805, z: -1.25, r: 0.31, w: 0.32 }, // trasero derecho
]

/** Arco de circunferencia como puntos del contorno (más suave que absarc por defecto). */
function addArc(shape: THREE.Shape, cx: number, cy: number, r: number, a0: number, a1: number, segments = 26) {
  for (let i = 1; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments
    shape.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
}

/**
 * Casco principal: silueta lateral de cuña con pasos de rueda cóncavos,
 * extrudida a lo ancho (winding CCW; los pasos quedan como arcos en el borde).
 */
function buildShell(width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(2.0, 0.3) // punta de la nariz (bajo)
  shape.lineTo(1.9, 0.86) // pared frontal
  shape.lineTo(1.5, 0.82) // capot
  shape.lineTo(0.65, 0.8) // parabrisas (base)
  shape.lineTo(0.05, 1.06) // parabrisas tendido → frente del techo
  shape.lineTo(-0.45, 1.06) // techo
  shape.quadraticCurveTo(-0.6, 1.04, -0.8, 0.94) // caída hacia la tapa del motor
  shape.lineTo(-1.3, 0.94) // tapa del motor
  shape.quadraticCurveTo(-1.75, 0.94, -2.16, 0.8) // cola (casi vertical)
  shape.lineTo(-2.14, 0.3) // cara trasera
  shape.lineTo(-1.65, 0.3) // piso hasta el paso trasero
  addArc(shape, -1.25, 0.3, 0.4, Math.PI, 0) // paso trasero (r 0.40)
  shape.lineTo(0.89, 0.3) // piso bajo cabina
  addArc(shape, 1.25, 0.3, 0.36, Math.PI, 0) // paso delantero (r 0.36)
  shape.lineTo(2.0, 0.3) // bajo la nariz
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false })
  // El extrude sale en el espacio del shape (x = z del auto, z = ancho): lo
  // rotamos para que el ancho caiga en X y el largo quede en Z, bien orientado.
  geo.rotateY(-Math.PI / 2)
  geo.translate(width / 2, 0, 0) // centrar el ancho en X ([-w/2, w/2])
  return geo
}

/**
 * Flare de paso de rueda: herradura superior de toroide en el plano YZ
 * (anillo alrededor del paso, faltando el tramo inferior).
 *
 * `TorusGeometry` no acepta ángulo inicial: nace en 0° y barre `arc`. Armamos
 * 220° y lo giramos -20° en Z para que la herradura quede simétrica sobre el
 * paso (de atrás-abajo, por el techo, hasta el frente-abajo).
 */
function buildFlare(ringR: number, tubeR: number): THREE.BufferGeometry {
  const arc = (Math.PI * 11) / 9 // 220°
  const geo = new THREE.TorusGeometry(ringR, tubeR, 8, 24, arc)
  geo.rotateZ(-Math.PI / 9) // -20°: la herradura queda centrada en el techo
  geo.rotateY(Math.PI / 2) // anillo en el plano YZ (perpendicular al eje de la rueda)
  return geo
}

/** Quad de vidrio con normal calculada (para parabrisas y ventanas). */
function buildQuad(corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]): THREE.BufferGeometry {
  const [a, b, c, d] = corners
  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a))
  if (normal.lengthSq() > 0) normal.normalize()
  const pos = [...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()]
  const nrm = Array.from({ length: 18 }, (_, i) => normal.getComponent(i % 3))
  const uv = [0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return geo
}

/**
 * Clona una geometría ya transformada a un espacio común, normalizando a
 * no indexada: `mergeGeometries` exige que todas tengan (o no) índice, y las
 * primitivas de three mezclan ambos (Extrude no indexa; Box/Torus sí).
 */
function bakedGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  g.applyMatrix4(matrix)
  return g
}

/** Fusiona los hijos Mesh de un grupo por material (hornea matrixWorld y re-normaliza). */
function mergeChildrenByMaterial(group: THREE.Group, geos: Set<THREE.BufferGeometry>): void {
  group.updateMatrixWorld(true) // primero hornea: los hijos aún están conectados
  const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
  for (const m of meshes) group.remove(m)
  const byMat = new Map<THREE.Material, THREE.Mesh[]>()
  for (const m of meshes) {
    const mat = m.material as THREE.Material
    let arr = byMat.get(mat)
    if (!arr) {
      arr = []
      byMat.set(mat, arr)
    }
    arr.push(m)
  }
  for (const [mat, ms] of byMat) {
    if (ms.length === 1) {
      group.add(ms[0])
      continue
    }
    const parts = ms.map((m) => bakedGeometry(m.geometry, m.matrixWorld))
    const merged = mergeGeometries(parts, false)
    if (!merged) {
      for (const m of ms) group.add(m)
      continue
    }
    merged.normalizeNormals()
    geos.add(merged)
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
  }
}

export function buildLp5000(): Lp5000Build {
  const car = new THREE.Group()
  const geos = new Set<THREE.BufferGeometry>()
  const track = (g: THREE.BufferGeometry) => {
    geos.add(g)
    return g
  }

  const M: Lp5000Materials = {
    // Rojo brillante con clearcoat: el acabado del documento (Fase 3 T3).
    // clearcoat 1 + clearcoatRoughness bajo da el reflejo nítido de laca.
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xc4161c,
      metalness: 0.4,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide, // el casco extrudido no debe verse por dentro a baja altura
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.35, roughness: 0.55, envMapIntensity: 0.9 }),
    // Vidrio oscuro con reflejo alto y refracción física sutil (sin transmission,
    // que exigiría un pipeline aparte): apenas un ior realzado.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0b1016,
      metalness: 0.1,
      roughness: 0.04,
      ior: 1.5,
      transparent: true,
      opacity: 0.85,
      envMapIntensity: 2.0,
      side: THREE.DoubleSide,
    }),
    tail: new THREE.MeshStandardMaterial({ color: 0x2a0208, emissive: 0xff2233, emissiveIntensity: 2.0, roughness: 0.35, metalness: 0.25 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95, metalness: 0.1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd4, metalness: 0.95, roughness: 0.2, envMapIntensity: 1.4 }),
    rotor: new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.4 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc62828, metalness: 0.7, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1.0, roughness: 0.22, envMapIntensity: 1.6 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe9e9ea, metalness: 0.15, roughness: 0.5 }),
    holo: new THREE.MeshBasicMaterial({ color: 0xff0044, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
  }

  const parts: CarPart[] = []
  const spinners: THREE.Group[] = []

  const addPart = (id: string, group: THREE.Group, base: THREE.Vector3, explode: THREE.Vector3) => {
    car.add(group)
    parts.push({ id, group, base, explode })
  }

  // ============================= CASCO + FLARES (parte "body") =============================
  const body = new THREE.Group()
  const shellMesh = new THREE.Mesh(track(buildShell(1.7)), M.paint)
  shellMesh.castShadow = false
  shellMesh.receiveShadow = false
  body.add(shellMesh)
  // Flares delanteros (tímidos) y traseros (marcados): llevan el ancho a ~2.00
  const flares: [number, number, number, number][] = [
    [-0.86, 1.25, 0.4, 0.07],
    [0.86, 1.25, 0.4, 0.07],
    [-0.88, -1.25, 0.44, 0.1],
    [0.88, -1.25, 0.44, 0.1],
  ]
  for (const [x, z, ringR, tubeR] of flares) {
    const f = new THREE.Mesh(track(buildFlare(ringR, tubeR)), M.paint)
    f.position.set(x, 0.3, z)
    f.castShadow = false
    f.receiveShadow = false
    body.add(f)
  }
  mergeChildrenByMaterial(body, geos)
  addPart('body', body, new THREE.Vector3(), new THREE.Vector3(0, 0.85, 0))

  // ============================= VIDRIOS (parte "glass") =============================
  const glass = new THREE.Group()

  const addQuad = (corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]) => {
    const m = new THREE.Mesh(track(buildQuad(corners)), M.glass)
    m.castShadow = false
    m.receiveShadow = false
    glass.add(m)
    return m
  }

  // Parabrisas tendido: sigue la pendiente del casco (de (0.65,0.8) a (0.05,1.06))
  // con 0.03 de despegue, para quedar justo por encima de la superficie.
  const windOffset = 0.03
  const yWindFront = 0.8 + (0.65 - 0.55) * ((1.06 - 0.8) / (0.65 - 0.05)) + windOffset
  const yWindRear = 1.06 + windOffset
  addQuad([
    new THREE.Vector3(-0.65, yWindFront, 0.55),
    new THREE.Vector3(0.65, yWindFront, 0.55),
    new THREE.Vector3(0.65, yWindRear, -0.1),
    new THREE.Vector3(-0.65, yWindRear, -0.1),
  ])

  // Ventanas laterales (polygonal, pegadas por fuera del costado del casco).
  for (const sx of [-1, 1]) {
    addQuad([
      new THREE.Vector3(sx * 0.855, 0.79, 0.55),
      new THREE.Vector3(sx * 0.855, 0.95, 0.28),
      new THREE.Vector3(sx * 0.855, 1.04, -0.45),
      new THREE.Vector3(sx * 0.855, 0.88, -0.15),
    ])
  }

  mergeChildrenByMaterial(glass, geos)
  addPart('glass', glass, new THREE.Vector3(), new THREE.Vector3(0, 0.35, 0))

  // ============================= NEGROS AGREGADOS (parte "black") =============================
  const black = new THREE.Group()
  const addB = (mesh: THREE.Mesh) => {
    mesh.castShadow = false
    mesh.receiveShadow = false
    black.add(mesh)
    return mesh
  }
  // Entrada de aire frontal profunda con barras
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 0.38, 0.1)), M.black)).position.set(0, 0.56, 2.01)
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.035, 0.04)), M.black)).position.set(0, 0.5, 2.045)
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.035, 0.04)), M.black)).position.set(0, 0.66, 2.045)
  // Faros pop-up rectangulares cerrados
  for (const hx of [-0.56, 0.56]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.38, 0.055, 0.14)), M.black)).position.set(hx, 0.885, 1.92)
  }
  // Tomas de aire laterales con rejillas verticales
  for (const sx of [-1, 1]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.06, 0.34, 0.55)), M.black)).position.set(sx * 0.86, 0.6, -0.35)
    for (let i = 0; i < 5; i++) {
      addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.025, 0.3, 0.02)), M.black)).position.set(sx * 0.885, 0.6, -0.52 + i * 0.085)
    }
  }
  // Ductos NACA sobre los guardabarros traseros
  for (const sx of [-1, 1]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.035, 0.16)), M.black)).position.set(sx * 0.97, 0.82, -0.58)
  }
  // Tapa de motor con lamas "libro" del QV
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.15, 0.05, 0.85)), M.black)).position.set(0, 0.955, -1.15)
  for (let i = 0; i < 5; i++) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.015, 0.05)), M.black)).position.set(0, 0.985, -0.98 + i * 0.09)
  }
  // Alerón trasero enorme y recto con brazos en los extremos
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.95, 0.05, 0.4)), M.black)).position.set(0, 1.17, -1.78)
  for (const wx of [-0.7, 0.7]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.28, 0.07)), M.black)).position.set(wx, 1.07, -1.72)
  }
  // Difusor trasero con aletas
  addB(new THREE.Mesh(track(new THREE.BoxGeometry(1.7, 0.16, 0.1)), M.black)).position.set(0, 0.38, -2.1)
  for (const dx of [-0.6, 0, 0.6]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.025, 0.15, 0.06)), M.black)).position.set(dx, 0.38, -2.13)
  }
  // Retrovisores grandes en brazos
  for (const sx of [-1, 1]) {
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.05, 0.14)), M.black)).position.set(sx * 0.87, 0.86, 0.62)
    addB(new THREE.Mesh(track(new THREE.BoxGeometry(0.17, 0.13, 0.24)), M.black)).position.set(sx * 0.95, 0.88, 0.55)
  }
  mergeChildrenByMaterial(black, geos)
  addPart('black', black, new THREE.Vector3(), new THREE.Vector3(0, -0.6, 0))

  // ============================= COLA (parte "tail"): banda de luces + escapes =============================
  const tail = new THREE.Group()
  const band = new THREE.Mesh(track(new THREE.BoxGeometry(1.9, 0.1, 0.05)), M.tail)
  band.position.set(0, 0.6, -2.145)
  band.castShadow = false
  band.receiveShadow = false
  tail.add(band)
  for (const ex of [-0.6, 0.6]) {
    const e = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.09, 0.12)), M.rim)
    e.position.set(ex, 0.36, -2.13)
    e.castShadow = false
    e.receiveShadow = false
    tail.add(e)
  }
  mergeChildrenByMaterial(tail, geos)
  addPart('tail', tail, new THREE.Vector3(), new THREE.Vector3(0, -0.35, 0))

  // ============================= PATENTE FRONTAL (parte "plate") =============================
  const plate = new THREE.Group()
  const plateMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.44, 0.13, 0.015)), M.plate)
  plateMesh.position.set(0, 0.4, 2.07)
  plateMesh.castShadow = false
  plateMesh.receiveShadow = false
  plate.add(plateMesh)
  addPart('plate', plate, new THREE.Vector3(), new THREE.Vector3(0, -0.2, 0))

  // ============================= RUEDAS (5 radios plateados) =============================
  const calipers: THREE.Mesh[] = []
  let rimGeoCache: THREE.BufferGeometry | null = null

  const rimSpokeGeo = track(new THREE.BoxGeometry(0.03, 0.26, 0.07))
  const rimHubGeo = track(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 12))
  rimHubGeo.rotateZ(Math.PI / 2)
  const rimBarrelGeo = track(new THREE.TorusGeometry(0.23, 0.032, 8, 24))
  rimBarrelGeo.rotateY(Math.PI / 2)
  const rotorGeo = track(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 18))
  rotorGeo.rotateZ(Math.PI / 2)
  const goldGeo = track(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10))
  goldGeo.rotateZ(Math.PI / 2)

  WHEELS.forEach((cfg, i) => {
    const side = cfg.x < 0 ? -1 : 1
    const spinner = new THREE.Group()
    spinner.position.set(cfg.x, cfg.r, cfg.z)

    const tireGeo = track(new THREE.CylinderGeometry(cfg.r, cfg.r, cfg.w, 24))
    tireGeo.rotateZ(Math.PI / 2)
    const tire = new THREE.Mesh(tireGeo, M.tire)
    tire.castShadow = false
    tire.receiveShadow = false
    spinner.add(tire)

    // Llanta de 5 radios: una sola geometría fusionada compartida entre ruedas.
    if (!rimGeoCache) {
      const rimParts: THREE.Mesh[] = []
      rimParts.push(new THREE.Mesh(rimHubGeo, M.rim))
      rimParts.push(new THREE.Mesh(rimBarrelGeo, M.rim))
      for (let k = 0; k < 5; k++) {
        const spoke = new THREE.Mesh(rimSpokeGeo, M.rim)
        spoke.rotation.x = (k * Math.PI * 2) / 5
        spoke.position.set(0, 0.13, 0)
        rimParts.push(spoke)
      }
      for (const rp of rimParts) rp.updateMatrixWorld()
      const geos2 = rimParts.map((rp) => bakedGeometry(rp.geometry, rp.matrixWorld))
      const merged = mergeGeometries(geos2, false)
      if (merged) {
        merged.normalizeNormals()
        geos.add(merged)
        rimGeoCache = merged
      }
    }
    if (rimGeoCache) {
      const rim = new THREE.Mesh(rimGeoCache, M.rim)
      rim.castShadow = false
      rim.receiveShadow = false
      spinner.add(rim)
    }

    // Rotor y tuerca central dorada.
    const rotor = new THREE.Mesh(rotorGeo, M.rotor)
    rotor.castShadow = false
    rotor.receiveShadow = false
    spinner.add(rotor)
    const gold = new THREE.Mesh(goldGeo, M.gold)
    gold.position.x = side * 0.018
    gold.castShadow = false
    gold.receiveShadow = false
    spinner.add(gold)

    // Pinza (estática, no gira): se fusiona entre las 4 ruedas.
    const caliper = new THREE.Mesh(track(new THREE.BoxGeometry(0.055, 0.14, 0.11)), M.caliper)
    caliper.position.set(cfg.x + side * 0.03, cfg.r + 0.04, cfg.z + 0.04)
    caliper.castShadow = false
    caliper.receiveShadow = false
    calipers.push(caliper)

    const wheelId = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'][i]
    addPart(wheelId, spinner, new THREE.Vector3(cfg.x, cfg.r, cfg.z), new THREE.Vector3(side * 0.75, 0.2, 0))
    spinners.push(spinner)
  })

  // Pinzas fusionadas en una sola malla (parte "calipers").
  const caliperGroup = new THREE.Group()
  for (const c of calipers) caliperGroup.add(c)
  mergeChildrenByMaterial(caliperGroup, geos)
  addPart('calipers', caliperGroup, new THREE.Vector3(), new THREE.Vector3(0, 0.2, 0.5))

  return {
    group: car,
    parts,
    spinners,
    materials: M,
    dispose: () => {
      geos.forEach((g) => g.dispose())
      geos.clear()
      Object.values(M).forEach((m) => m.dispose())
    },
  }
}