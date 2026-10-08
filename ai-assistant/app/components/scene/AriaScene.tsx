'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

interface AriaSceneProps {
  enabled: boolean
  width?: number
  height?: number
  opacity?: number
  modelOpacity?: number
  className?: string
  autoSpin?: boolean
  reduceMotion?: boolean
  onReadyChange?: (ready: boolean) => void
}

type MaterialMap = {
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

/**
 * Escena 3D del Countach LPI 800-4, portada fielmente del visor standalone
 * (public/aria-countach.html), pensada para insertarse en React.
 * - Se monta solo cuando `enabled = true` (off-by-default).
 * - Respeta `prefers-reduced-motion`.
 * - No carga nada desde CDN: usa `three` instalado localmente.
 */
export default function AriaScene({
  enabled,
  width = 0,
  height = 0,
  opacity = 0.6,
  modelOpacity = 1.0,
  className = '',
  autoSpin = true,
  reduceMotion = false,
  onReadyChange,
}: AriaSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const rafRef = useRef<number>(0)
  const unmountedRef = useRef(false)

  // Three refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const carGroupRef = useRef<THREE.Group | null>(null)
  const cageRef = useRef<THREE.LineSegments | null>(null)
  const ring1Ref = useRef<THREE.LineSegments | null>(null)
  const ring2Ref = useRef<THREE.LineSegments | null>(null)
  const particlesRef = useRef<THREE.Points | null>(null)
  const underglowRef = useRef<THREE.Mesh | null>(null)
  const gridRef = useRef<THREE.Mesh | null>(null)
  const floorMeshRef = useRef<THREE.Mesh | null>(null)
  const wheelSpinnersRef = useRef<THREE.Group[]>([])
  const materialsRef = useRef<MaterialMap | null>(null)
  const pmremRef = useRef<THREE.PMREMGenerator | null>(null)
  const envTexRef = useRef<THREE.Texture | null>(null)

  // Estado animado
  const narrowRef = useRef(false)
  const zoomScaleRef = useRef(1)
  const targetRotYRef = useRef(0.65)
  const targetRotXRef = useRef(0.12)
  const currentRotYRef = useRef(0.65)
  const currentRotXRef = useRef(0.12)
  const camTargetRef = useRef(new THREE.Vector3(1.05, 0.5, -0.77))
  const camPosRef = useRef(new THREE.Vector3(3.8, 2.0, 5.2))
  const speedRef = useRef(0.014)
  const mouseXRef = useRef(0)
  const mouseYRef = useRef(0)
  const autoSpinRef = useRef(autoSpin && !reduceMotion)
  const lastTimeRef = useRef(0)

  const setReadyFlag = useCallback(
    (value: boolean) => {
      if (readyRef.current === value) return
      readyRef.current = value
      setReady(value)
      onReadyChange?.(value)
    },
    [onReadyChange]
  )

  const clampRotX = useCallback((v: number) => Math.max(-0.15, Math.min(0.55, v)), [])
  const clampZoom = useCallback((v: number) => Math.max(0.55, Math.min(1.6, v)), [])

  const computeView = useCallback(() => {
    narrowRef.current = typeof window !== 'undefined' && window.innerWidth < 1024
    if (narrowRef.current) {
      camPosRef.current.set(3.4, 2.6, 7.6)
      camTargetRef.current.set(0, 0.1, 0)
    } else {
      camPosRef.current.set(3.8, 2.0, 5.2)
      camTargetRef.current.set(1.05, 0.5, -0.77)
    }
  }, [])

  const applyCam = useCallback(() => {
    const cam = cameraRef.current
    const car = carGroupRef.current
    if (!cam) return
    const pos = camPosRef.current
    const tgt = camTargetRef.current
    const z = zoomScaleRef.current
    cam.position.set(tgt.x + (pos.x - tgt.x) * z, tgt.y + (pos.y - tgt.y) * z, tgt.z + (pos.z - tgt.z) * z)
    cam.lookAt(tgt)
    if (car) car.scale.setScalar(narrowRef.current ? 0.75 : 1)
  }, [])

  const makeEnvTexture = useCallback((): THREE.Texture => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const g = c.getContext('2d')!
    const grd = g.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0.0, '#4a0d1a')
    grd.addColorStop(0.38, '#14141c')
    grd.addColorStop(0.52, '#1b1b24')
    grd.addColorStop(1.0, '#000000')
    g.fillStyle = grd
    g.fillRect(0, 0, 512, 256)
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.fillRect(48, 34, 210, 20)
    g.fillStyle = 'rgba(180,220,255,0.55)'
    g.fillRect(300, 52, 130, 14)
    g.fillStyle = 'rgba(255,70,100,0.85)'
    g.fillRect(60, 96, 300, 12)
    const t = new THREE.CanvasTexture(c)
    t.mapping = THREE.EquirectangularReflectionMapping
    return t
  }, [])

  const makeShadowTexture = useCallback((): THREE.Texture => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128)
    grd.addColorStop(0.0, 'rgba(0,0,0,0.9)')
    grd.addColorStop(0.55, 'rgba(0,0,0,0.38)')
    grd.addColorStop(1.0, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 256, 256)
    return new THREE.CanvasTexture(c)
  }, [])

  const buildCar = useCallback(() => {
    const car = new THREE.Group()
    carGroupRef.current = car
    const M: MaterialMap = {
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
    materialsRef.current = M

    const add = (mesh: THREE.Mesh, emissive = false) => {
      if (emissive) (mesh.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending
      mesh.castShadow = false
      mesh.receiveShadow = false
      car.add(mesh)
      return mesh
    }

    // cuerpo
    add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 4.4), M.paint)).position.y = 0.3
    add(new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.28, 4.3), M.carbon)).position.y = 0.32

    const noseBase = add(new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.24, 1.4), M.paint))
    noseBase.position.set(0, 0.38, 1.55)
    const beakGeo = new THREE.CylinderGeometry(0.72, 1.94, 0.9, 4)
    beakGeo.rotateY(Math.PI / 4)
    const beak = add(new THREE.Mesh(beakGeo, M.paint))
    beak.position.set(0, 0.34, 2.15); beak.scale.set(1.0, 0.28, 1.1)
    const splitter = add(new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.55), M.carbon))
    splitter.position.set(0, 0.16, 2.3)
    const frontSlit = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.12), M.black))
    frontSlit.position.set(0, 0.36, 2.5)
    const badge = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), M.gold))
    badge.position.set(0, 0.44, 2.35)

    // faros
    ;[-0.64, 0.64].forEach((x) => {
      const housing = add(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.09, 0.22), M.black))
      housing.position.set(x, 0.45, 2.22)
      const led = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.06), M.head), true)
      led.position.set(x, 0.45, 2.33)
    })

    // cabina
    const cabinGeo = new THREE.CylinderGeometry(1.22, 1.82, 0.64, 4)
    cabinGeo.rotateY(Math.PI / 4)
    const cabin = add(new THREE.Mesh(cabinGeo, M.glass))
    cabin.position.set(0, 0.78, 0.02); cabin.scale.set(0.96, 1.0, 1.45)
    const roof = add(new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.06, 1.35), M.paint))
    roof.position.set(0, 1.1, 0.02)
    const aPillars = add(new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.1), M.paint))
    aPillars.position.set(0, 0.88, 0.78)

    // laterales
    ;[-0.98, 0.98].forEach((x) => {
      const flank = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 1.8), M.paint))
      flank.position.set(x, 0.52, 0.05)
      const naca = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.75), M.carbon))
      naca.position.set(x * 0.98, 0.54, -0.45)
      const louver = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.48), M.black))
      louver.position.set(x * 0.92, 0.78, -0.68)
      const mirrorArm = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.06), M.carbon))
      mirrorArm.position.set(x * 1.04, 0.82, 0.62)
      const mirrorCap = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.1), M.black))
      mirrorCap.position.set(x * 1.14, 0.84, 0.62)
    })

    // trasero
    const rearDeck = add(new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.26, 1.55), M.paint))
    rearDeck.position.set(0, 0.6, -1.35)
    const engineCover = add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 1.15), M.glass))
    engineCover.position.set(0, 0.72, -1.25)
    const rearTailCluster = add(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.1, 0.1), M.black))
    rearTailCluster.position.set(0, 0.62, -2.14)
    ;[-0.62, 0.62].forEach((x) => {
      const tail = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.04), M.tail), true)
      tail.position.set(x, 0.62, -2.19)
    })
    const diffuser = add(new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.22, 0.42), M.carbon))
    diffuser.position.set(0, 0.25, -2.12)
    ;[-0.32, -0.16, 0.16, 0.32].forEach((x) => {
      const tipGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.18, 16)
      tipGeo.rotateX(Math.PI / 2)
      const tip = add(new THREE.Mesh(tipGeo, M.rim))
      tip.position.set(x, 0.28, -2.25)
    })

    // ruedas
    const wheelGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.32, 28)
    wheelGeo.rotateZ(Math.PI / 2)
    const rotorGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24)
    rotorGeo.rotateZ(Math.PI / 2)
    const caliperGeo = new THREE.BoxGeometry(0.08, 0.16, 0.14)
    const rimDialGeo = new THREE.TorusGeometry(0.26, 0.055, 12, 24)
    rimDialGeo.rotateY(Math.PI / 2)
    const wheelPositions: [number, number, number, number][] = [
      [-0.96, 0.39, 1.45, 1],
      [0.96, 0.39, 1.45, -1],
      [-0.98, 0.39, -1.42, 1],
      [0.98, 0.39, -1.42, -1],
    ]
    wheelPositions.forEach(([x, y, z, dir]) => {
      const wGroup = new THREE.Group()
      const spinner = new THREE.Group()
      const tire = new THREE.Mesh(wheelGeo, M.tire)
      spinner.add(tire)
      const rimOuter = new THREE.Mesh(rimDialGeo, M.rim)
      rimOuter.position.x = dir * 0.14
      spinner.add(rimOuter)
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5
        const dialHole = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 8, 16), M.rim)
        dialHole.rotateY(Math.PI / 2)
        dialHole.position.set(dir * 0.14, Math.sin(angle) * 0.14, Math.cos(angle) * 0.14)
        spinner.add(dialHole)
      }
      const centerLock = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), M.gold)
      centerLock.rotateZ(Math.PI / 2)
      centerLock.position.x = dir * 0.16
      spinner.add(centerLock)
      const rotor = new THREE.Mesh(rotorGeo, M.rotor)
      spinner.add(rotor)
      const caliper = new THREE.Mesh(caliperGeo, M.caliper)
      caliper.position.set(dir * 0.02, 0.12, 0.04)
      wGroup.add(caliper)
      wGroup.add(spinner)
      wGroup.position.set(x, y, z)
      car.add(wGroup)
      wheelSpinnersRef.current.push(spinner)
    })

    return car
  }, [])

  const loop = useCallback(
    (t: number) => {
      if (unmountedRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return
      const dt = lastTimeRef.current === 0 ? 0.016 : (t - lastTimeRef.current) / 1000
      lastTimeRef.current = t
      currentRotYRef.current += (targetRotYRef.current - currentRotYRef.current) * 0.08
      currentRotXRef.current += (targetRotXRef.current - currentRotXRef.current) * 0.08
      if (carGroupRef.current) {
        carGroupRef.current.rotation.y = currentRotYRef.current
        carGroupRef.current.rotation.x = currentRotXRef.current
      }
      if (autoSpinRef.current && Math.abs(mouseXRef.current) < 0.8) {
        targetRotYRef.current += speedRef.current * dt * 60
      }
      wheelSpinnersRef.current.forEach((g) => (g.rotation.x += 0.012))
      if (ring1Ref.current) { ring1Ref.current.rotation.z -= 0.0004; }
      if (ring2Ref.current) { ring2Ref.current.rotation.z += 0.00025; }
      rendererRef.current.render(sceneRef.current, cameraRef.current)
      rafRef.current = requestAnimationFrame(loop)
    },
    [speedRef]
  )

  const init = useCallback(async () => {
    if (!enabled || !containerRef.current || readyRef.current) return
    unmountedRef.current = false
    const container = containerRef.current
    const canvas = canvasRef.current!
    try {
      computeView()
      autoSpinRef.current = autoSpin && !reduceMotion

      const scene = new THREE.Scene()
      sceneRef.current = scene
      scene.fog = new THREE.FogExp2(0x0a0c10, 0.028)

      const cam = new THREE.PerspectiveCamera(42, (width || container.clientWidth) / (height || container.clientHeight), 0.1, 100)
      cameraRef.current = cam
      applyCam()

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
      rendererRef.current = renderer
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.18
      renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 1.8))
      const rw = width || container.clientWidth || 1
      const rh = height || container.clientHeight || 1
      renderer.setSize(rw, rh)
      renderer.setClearColor(0x000000, 0)

      const pmrem = new THREE.PMREMGenerator(renderer)
      pmremRef.current = pmrem
      const envTex = makeEnvTexture()
      envTexRef.current = envTex
      const target = pmrem.fromEquirectangular(envTex) as any
      if (target?.then) {
        target.then((tex: any) => {
          if (tex?.texture) scene.environment = tex.texture
          tex?.dispose?.()
        })
      } else {
        if (target?.texture) scene.environment = target.texture
        target?.dispose?.()
      }

      // luz
      const amb = new THREE.AmbientLight(0x2a0d16, 1.0)
      scene.add(amb)
      const hemi = new THREE.HemisphereLight(0x8ea8d8, 0x140306, 0.55)
      scene.add(hemi)
      const key = new THREE.DirectionalLight(0xfff5ea, 2.6)
      key.position.set(4.5, 6.5, 4)
      scene.add(key)

      const car = buildCar()
      scene.add(car)
      car.position.set(0.15, -0.05, 0)
      car.rotation.y = 0.65
      currentRotYRef.current = 0.65
      targetRotYRef.current = 0.65
      currentRotXRef.current = 0.12
      targetRotXRef.current = 0.12

      // ambiente holografico
      const ring1 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(2.0, 2.0, 0.02, 48), 1), new THREE.LineBasicMaterial({ color: 0xff0044, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }))
      ring1.rotation.x = Math.PI / 2; ring1.position.y = 0.08; scene.add(ring1); ring1Ref.current = ring1
      const ring2 = ring1.clone(); ring2.scale.set(1.32, 1.32, 1); ring2.material = (ring2.material as THREE.LineBasicMaterial).clone(); (ring2.material as THREE.LineBasicMaterial).opacity = 0.08; scene.add(ring2); ring2Ref.current = ring2
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6, 1, 1), new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }))
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; scene.add(floor); floorMeshRef.current = floor

      setReadyFlag(true)
      loop(0)
    } catch (e) {
      console.warn('[AriaScene] init failed', e)
      setReadyFlag(false)
    }
  }, [enabled, width, height, autoSpin, reduceMotion, buildCar, computeView, applyCam, makeEnvTexture, makeShadowTexture, setReadyFlag, loop])

  const resize = useCallback(() => {
    if (!readyRef.current) return
    computeView()
    applyCam()
    const renderer = rendererRef.current
    const cam = cameraRef.current
    const container = containerRef.current
    if (!renderer || !cam || !container) return
    const rw = width || container.clientWidth || 1
    const rh = height || container.clientHeight || 1
    cam.aspect = rw / rh
    cam.updateProjectionMatrix()
    renderer.setSize(rw, rh)
  }, [width, height, computeView, applyCam])

  useEffect(() => {
    autoSpinRef.current = autoSpin && !reduceMotion
    if (reduceMotion) {
      targetRotYRef.current = 0.65
      targetRotXRef.current = 0.12
      zoomScaleRef.current = 1
      applyCam()
    }
  }, [autoSpin, reduceMotion, applyCam])

  useEffect(() => {
    if (enabled) init()
    return () => {
      unmountedRef.current = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      // limpieza ligera
      envTexRef.current?.dispose()
      pmremRef.current?.dispose()
      materialsRef.current?.holo.dispose()
      rendererRef.current?.dispose()
    }
  }, [enabled, init])

  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 ${className}`}
      style={{ pointerEvents: 'none', zIndex: 0, opacity }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />
    </div>
  )
}
