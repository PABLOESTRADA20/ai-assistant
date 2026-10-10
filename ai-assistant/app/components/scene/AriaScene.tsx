'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildLp5000, type CarPart, type Lp5000Build } from './car/lp5000'
import { disposeObject3D } from './car/utils'

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
  /** Se invoca si la escena no puede iniciar (WebGL roto, shader, etc.). */
  onError?: (err: unknown) => void
}

/**
 * Escena 3D del Countach (three.js local, pensada para insertarse en React).
 * - Se monta solo cuando `enabled = true` (off-by-default).
 * - Respeta `prefers-reduced-motion` (escena estática, sin ciclo continuo).
 * - No carga nada desde CDN: usa `three` instalado localmente.
 * - El loop se pausa cuando la pestaña está oculta o el visor sale del
 *   viewport, renderiza bajo demanda cuando no hay animación, adapta el DPR
 *   al rendimiento y libera todo al desmontar.
 * - Con `?stats=1` en la URL expone `window.__aria3dStats()` para medir
 *   `renderer.info`, DPR, frame time promedio y cap de fps.
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
  onError,
}: AriaSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  // `?explode=1`: muestra un slider que desarma/arma el auto por partes.
  // Se lee una sola vez del query string (client-only).
  const [explodeMode] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('explode')
  )
  const [explodeValue, setExplodeValue] = useState(0)
  const frameIdRef = useRef(0)
  const frameKindRef = useRef<'raf' | 'timeout' | null>(null)
  const unmountedRef = useRef(false)

  // Three refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const carGroupRef = useRef<THREE.Group | null>(null)
  const carBuildRef = useRef<Lp5000Build | null>(null)
  const carPartsRef = useRef<CarPart[]>([])
  const ring1Ref = useRef<THREE.LineSegments | null>(null)
  const ring2Ref = useRef<THREE.LineSegments | null>(null)
  const floorMeshRef = useRef<THREE.Mesh | null>(null)
  const wheelSpinnersRef = useRef<THREE.Group[]>([])
  const pmremRef = useRef<THREE.PMREMGenerator | null>(null)
  const envTexRef = useRef<THREE.Texture | null>(null)
  const envSceneTexRef = useRef<THREE.Texture | null>(null)
  const ioRef = useRef<IntersectionObserver | null>(null)

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
  const autoSpinRef = useRef(autoSpin && !reduceMotion)
  const lastTimeRef = useRef(0)

  // Rendimiento
  const activeRef = useRef(true) // visible && en viewport
  const intersectingRef = useRef(true)
  const dirtyRef = useRef(false)
  const idleRef = useRef(true)
  const cap30Ref = useRef(false)
  const frameEmaMsRef = useRef(0)
  const dprRef = useRef(1)
  const dprReducedRef = useRef(false)
  const isMobileRef = useRef(false)
  const statsModeRef = useRef(false)

  const setReadyFlag = useCallback(
    (value: boolean) => {
      if (readyRef.current === value) return
      readyRef.current = value
      setReady(value)
      onReadyChange?.(value)
    },
    [onReadyChange]
  )

  /** Desarma/arma el auto moviendo cada parte desde su base según `v` (0..1). */
  const applyExplode = useCallback((v: number) => {
    const parts = carPartsRef.current
    if (parts.length === 0) return
    for (const p of parts) {
      p.group.position.copy(p.base).addScaledVector(p.explode, v)
    }
  }, [])

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

  /**
   * Ciclo principal. Solo renderiza cuando hace falta:
   * - autoSpin encendido: anima y renderiza en cada frame.
   * - autoSpin apagado (reduceMotion / escena estática): renderiza una vez y
   *   queda en reposo hasta que algo lo ensucie (resize, cambio de props).
   * Con batería baja y sin carga, la cadencia baja a 30 fps (setTimeout).
   */
  const tick = useCallback(
    (now: number) => {
      if (unmountedRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) {
        frameKindRef.current = null
        return
      }
      const prev = lastTimeRef.current
      const first = prev === 0
      const dt = first ? 0.016 : Math.min((now - prev) / 1000, 0.1)
      if (!first) frameEmaMsRef.current = frameEmaMsRef.current * 0.92 + (now - prev) * 0.08
      lastTimeRef.current = now

      currentRotYRef.current += (targetRotYRef.current - currentRotYRef.current) * 0.08
      currentRotXRef.current += (targetRotXRef.current - currentRotXRef.current) * 0.08

      let needsRender = first || dirtyRef.current
      dirtyRef.current = false

      const car = carGroupRef.current
      if (car) {
        car.rotation.y = currentRotYRef.current
        car.rotation.x = currentRotXRef.current
      }

      let settled = true
      if (autoSpinRef.current) {
        targetRotYRef.current += speedRef.current * dt * 60
        wheelSpinnersRef.current.forEach((g) => (g.rotation.x += 0.85 * dt))
        if (ring1Ref.current) ring1Ref.current.rotation.z -= 0.0004
        if (ring2Ref.current) ring2Ref.current.rotation.z += 0.00025
        needsRender = true
      } else {
        settled =
          Math.abs(currentRotYRef.current - targetRotYRef.current) < 0.0005 &&
          Math.abs(currentRotXRef.current - targetRotXRef.current) < 0.0005
      }

      if (needsRender) rendererRef.current.render(sceneRef.current, cameraRef.current)

      // DPR adaptativo: si el frame promedio pesa y todavía no bajamos, baja a 1.
      if (!dprReducedRef.current && dprRef.current > 1 && frameEmaMsRef.current > 22) {
        rendererRef.current.setPixelRatio(1)
        dprRef.current = 1
        dprReducedRef.current = true
      }

      if (autoSpinRef.current || !settled || dirtyRef.current) {
        if (cap30Ref.current) {
          frameKindRef.current = 'timeout'
          frameIdRef.current = window.setTimeout(() => tick(performance.now()), 33)
        } else {
          frameKindRef.current = 'raf'
          frameIdRef.current = requestAnimationFrame(tick)
        }
      } else {
        frameKindRef.current = null
        idleRef.current = true
      }
    },
    [speedRef, autoSpinRef]
  )

  const startLoop = useCallback(() => {
    if (unmountedRef.current || !activeRef.current) return
    lastTimeRef.current = 0
    idleRef.current = false
    dirtyRef.current = true
    frameKindRef.current = 'raf'
    frameIdRef.current = requestAnimationFrame(tick)
  }, [tick])

  const stopLoop = useCallback(() => {
    idleRef.current = true
    if (frameKindRef.current === 'raf') cancelAnimationFrame(frameIdRef.current)
    else if (frameKindRef.current === 'timeout') clearTimeout(frameIdRef.current)
    frameKindRef.current = null
  }, [])

  const updateActive = useCallback(() => {
    const was = activeRef.current
    const visible = !document.hidden
    const inView = intersectingRef.current
    activeRef.current = visible && inView
    if (activeRef.current && !was) startLoop()
    else if (!activeRef.current && was) stopLoop()
  }, [startLoop, stopLoop])

  useEffect(() => {
    const onVis = () => updateActive()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [updateActive])

  const init = useCallback(async () => {
    if (!enabled || !containerRef.current || readyRef.current) return
    unmountedRef.current = false
    const container = containerRef.current
    const canvas = canvasRef.current!
    try {
      computeView()
      autoSpinRef.current = autoSpin && !reduceMotion
      isMobileRef.current = typeof window !== 'undefined' && window.innerWidth < 768
      statsModeRef.current = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stats')

      // Batería baja ≈ modo ahorro: cap de 30 fps (API no estándar → try/catch).
      try {
        const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }
        nav.getBattery?.().then(
          (b) => {
            cap30Ref.current = !b.charging && b.level <= 0.25
          },
          () => undefined
        )
      } catch {
        /* ignore */
      }

      const scene = new THREE.Scene()
      sceneRef.current = scene
      scene.fog = new THREE.FogExp2(0x0a0c10, 0.028)

      const cam = new THREE.PerspectiveCamera(42, (width || container.clientWidth) / (height || container.clientHeight), 0.1, 100)
      cameraRef.current = cam
      applyCam()

      const renderer = new THREE.WebGLRenderer({
        canvas,
        // MSAA solo en desktop: en móvil el DPR bajo + shaders ya alcanzan.
        antialias: !isMobileRef.current,
        alpha: true,
        powerPreference: 'high-performance',
      })
      rendererRef.current = renderer
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.18
      const dprBase = isMobileRef.current ? 1.5 : Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
      dprRef.current = dprBase
      renderer.setPixelRatio(dprBase)
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
          if (tex?.texture) {
            scene.environment = tex.texture
            envSceneTexRef.current = tex.texture as THREE.Texture
          }
          tex?.dispose?.()
        })
      } else {
        if (target?.texture) {
          scene.environment = target.texture
          envSceneTexRef.current = target.texture as THREE.Texture
        }
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

      const build = buildLp5000()
      carBuildRef.current = build
      const car = build.group
      scene.add(car)
      carGroupRef.current = car
      // Suelo en Y=0: las llantas tocan el piso de la escena sin hundirse.
      car.position.set(0.15, 0, 0)
      car.rotation.y = 0.65
      currentRotYRef.current = 0.65
      targetRotYRef.current = 0.65
      currentRotXRef.current = 0.12
      targetRotXRef.current = 0.12
      carPartsRef.current = build.parts
      wheelSpinnersRef.current = build.spinners

      // ambiente holografico
      const ring1 = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.CylinderGeometry(2.0, 2.0, 0.02, 48), 1),
        new THREE.LineBasicMaterial({ color: 0xff0044, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
      )
      ring1.rotation.x = Math.PI / 2
      ring1.position.y = 0.08
      scene.add(ring1)
      ring1Ref.current = ring1
      const ring2 = ring1.clone()
      ring2.scale.set(1.32, 1.32, 1)
      ring2.material = (ring2.material as THREE.LineBasicMaterial).clone()
      ;(ring2.material as THREE.LineBasicMaterial).opacity = 0.08
      scene.add(ring2)
      ring2Ref.current = ring2
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6, 1, 1),
        new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
      )
      floor.rotation.x = -Math.PI / 2
      floor.position.y = 0.01
      scene.add(floor)
      floorMeshRef.current = floor

      setReadyFlag(true)

      if (statsModeRef.current) {
        const dump = () => ({
          renderer: {
            calls: rendererRef.current?.info.render.calls ?? 0,
            triangles: rendererRef.current?.info.render.triangles ?? 0,
            geometries: rendererRef.current?.info.memory.geometries ?? 0,
            textures: rendererRef.current?.info.memory.textures ?? 0,
          },
          frameEmaMs: Math.round(frameEmaMsRef.current * 10) / 10,
          dpr: rendererRef.current?.getPixelRatio() ?? 1,
          cap30: cap30Ref.current,
          active: activeRef.current,
          autoSpin: autoSpinRef.current,
        })
        ;(window as unknown as Record<string, unknown>).__aria3dStats = dump
        if (explodeMode) {
          ;(window as unknown as Record<string, unknown>).__aria3dExplode = (v: number) => {
            const k = Math.max(0, Math.min(1, Number(v) || 0))
            setExplodeValue(k)
            applyExplode(k)
          }
        }
        console.debug('[AriaScene] stats init', dump())
      }

      // Pausa cuando el visor sale del viewport (no solo cuando cambia de pestaña).
      const io = new IntersectionObserver(
        (entries) => {
          intersectingRef.current = entries.some((e) => e.isIntersecting)
          updateActive()
        },
        { threshold: 0 }
      )
      io.observe(container)
      ioRef.current = io
      updateActive()

      startLoop()
    } catch (e) {
      console.warn('[AriaScene] init failed', e)
      setReadyFlag(false)
      onError?.(e)
    }
  }, [enabled, width, height, autoSpin, reduceMotion, computeView, applyCam, makeEnvTexture, makeShadowTexture, setReadyFlag, startLoop, updateActive, onError, applyExplode, explodeMode])

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
    if (!unmountedRef.current) {
      dirtyRef.current = true
      if (idleRef.current) startLoop()
    }
  }, [width, height, computeView, applyCam, startLoop])

  useEffect(() => {
    autoSpinRef.current = autoSpin && !reduceMotion
    if (reduceMotion) {
      targetRotYRef.current = 0.65
      targetRotXRef.current = 0.12
      zoomScaleRef.current = 1
      applyCam()
    }
    if (readyRef.current) {
      dirtyRef.current = true
      if (idleRef.current) startLoop()
    }
  }, [autoSpin, reduceMotion, applyCam, startLoop])

  useEffect(() => {
    if (enabled) init()
    return () => {
      unmountedRef.current = true
      stopLoop()
      ioRef.current?.disconnect()
      ioRef.current = null
      // Liberación completa: auto (geometrías fusionadas y descartadas,
      // materiales), anillos y piso, entorno, PMREM y renderer.
      carBuildRef.current?.dispose()
      carBuildRef.current = null
      carPartsRef.current = []
      const aux = new THREE.Group()
      if (ring1Ref.current) aux.add(ring1Ref.current)
      if (ring2Ref.current) aux.add(ring2Ref.current)
      if (floorMeshRef.current) aux.add(floorMeshRef.current)
      disposeObject3D(aux)
      envTexRef.current?.dispose()
      envTexRef.current = null
      envSceneTexRef.current?.dispose()
      envSceneTexRef.current = null
      pmremRef.current?.dispose()
      pmremRef.current = null
      rendererRef.current?.dispose()
    }
  }, [enabled, init, stopLoop])

  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [resize])

  return (
    <>
      <div
        ref={containerRef}
        className={`absolute inset-0 ${className}`}
        style={{ pointerEvents: 'none', zIndex: 0, opacity }}
        aria-hidden
      >
        <canvas ref={canvasRef} className="w-full h-full block touch-none" />
      </div>
      {explodeMode && (
        <div
          className="fixed bottom-4 right-4 z-[70] flex items-center gap-3 rounded-lg bg-black/75 px-4 py-2 text-xs text-neutral-200 select-none"
          style={{ pointerEvents: 'auto' }}
          aria-hidden
        >
          <span>Explode</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={explodeValue}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              setExplodeValue(v)
              applyExplode(v)
            }}
            className="w-40 accent-red-500"
          />
          <span>{explodeValue.toFixed(2)}</span>
          <button
            type="button"
            onClick={() => {
              setExplodeValue(0)
              applyExplode(0)
            }}
            className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700"
          >
            Reset
          </button>
        </div>
      )}
    </>
  )
}