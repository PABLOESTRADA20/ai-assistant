import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLp5000, WHEELS } from '@/app/components/scene/car/lp5000'
import { collectStats } from '@/app/components/scene/car/utils'

/**
 * Rediseño Fase 3 T2: Countach LP5000 Quattrovalvole procedural, medido
 * headless (sin navegador). Es el "después" del rediseño; la línea base del
 * auto anterior queda en `scene-car-stats.test.ts`.
 *
 * Presupuestos del documento: móvil < 60k tris / < 25 draw calls · desktop
 * < 150k tris / < 40 draw calls. Dimensiones reales: 4.14 × 2.00 × 1.07,
 * batalla 2.50.
 */
describe('Countach LP5000 QV — geometría (Fase 3 T2)', () => {
  it('cumple los presupuestos de triángulos y draw calls', () => {
    const build = buildLp5000()
    try {
      const stats = collectStats(build.group)
      console.log('[lp5000] stats', stats)
      expect(stats.meshes).toBeGreaterThan(0)
      expect(stats.triangles).toBeGreaterThan(0)
      // Móvil: los límites más ajustados del documento.
      expect(stats.drawCalls).toBeLessThanOrEqual(25)
      expect(stats.triangles).toBeLessThan(60_000)
      // Desktop holgado.
      expect(stats.drawCalls).toBeLessThanOrEqual(40)
      expect(stats.triangles).toBeLessThan(150_000)
    } finally {
      build.dispose()
    }
  })

  it('respeta las dimensiones y el apoyo en el suelo (1 u = 1 m)', () => {
    const build = buildLp5000()
    try {
      build.group.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(build.group)
      const size = box.getSize(new THREE.Vector3())
      console.log('[lp5000] bbox', { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() })
      // Largo ~4.14 (con pequeños salientes de patente/escapes).
      expect(size.z).toBeGreaterThan(3.9)
      expect(size.z).toBeLessThan(4.45)
      // Ancho ~2.00 (máximo en los flares traseros / retrovisores).
      expect(size.x).toBeGreaterThan(1.85)
      expect(size.x).toBeLessThan(2.25)
      // Alto ~1.07 en el techo, algo más con el alerón.
      expect(size.y).toBeGreaterThan(1.0)
      expect(size.y).toBeLessThan(1.4)
      // Ninguna parte por debajo del suelo (las llantas tocan Y=0).
      expect(box.min.y).toBeGreaterThan(-0.05)
      // Batalla de 2.50 entre ejes delantero y trasero.
      expect(Math.abs(WHEELS[0].z - WHEELS[2].z)).toBeCloseTo(2.5, 5)
    } finally {
      build.dispose()
    }
  })

  it('deja aire entre cada llanta y el paso de rueda', () => {
    // Radios de los pasos definidos en el casco (buildShell).
    const archFront = 0.36
    const archRear = 0.4
    const [fl, , rl] = WHEELS
    expect(fl.r).toBeLessThan(archFront)
    expect(rl.r).toBeLessThan(archRear)
  })

  it('expone partes nombradas para el ensamblado (`?explode=1`)', () => {
    const build = buildLp5000()
    try {
      const ids = build.parts.map((p) => p.id)
      expect(ids).toContain('body')
      expect(ids).toContain('glass')
      expect(ids).toContain('black')
      expect(ids).toContain('tail')
      expect(ids).toContain('plate')
      expect(ids).toContain('calipers')
      expect(ids.filter((id) => id.startsWith('wheel-'))).toHaveLength(4)
      // Todas las partes deben poder desplazarse al desarmar.
      for (const part of build.parts) {
        expect(part.explode.length()).toBeGreaterThan(0)
        expect(build.group.children).toContain(part.group)
      }
      // Las ruedas son los rotores que giran.
      expect(build.spinners).toHaveLength(4)
    } finally {
      build.dispose()
    }
  })

  it('mantiene normales unitarias y geometría válida', () => {
    const build = buildLp5000()
    try {
      let checked = 0
      build.group.traverse((o) => {
        const mesh = o as THREE.Mesh
        const g = mesh.geometry
        if (!g) return
        const pos = g.attributes?.position as THREE.BufferAttribute | undefined
        expect(pos?.count ?? 0).toBeGreaterThan(0)
        const norm = g.attributes?.normal as THREE.BufferAttribute | undefined
        if (!norm) return
        for (let i = 0; i < norm.count; i++) {
          const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))
          if (Math.abs(len - 1) > 1e-3) {
            throw new Error(`normal no unitaria (len ${len.toFixed(4)}) en ${o.name || o.type}`)
          }
          checked++
        }
      })
      expect(checked).toBeGreaterThan(100)
    } finally {
      build.dispose()
    }
  })

  it('libera la geometría al desmontar sin romper el grupo', () => {
    const build = buildLp5000()
    build.dispose()
    expect(build.group.children.length).toBeGreaterThan(0)
  })
})
