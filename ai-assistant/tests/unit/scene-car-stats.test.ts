import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildCar } from '@/app/components/scene/car/current-car'
import { collectStats } from '@/app/components/scene/car/utils'

/**
 * Línea base medible de la escena 3D (sin navegador): cuenta objetos,
 * draw calls y triángulos del auto construido. Es el "antes" de la Fase 3;
 * el "después" se mide con el mismo harness al final del rediseño.
 *
 * Presupuestos del documento: móvil < 60k tris / < 25 draw calls · desktop
 * < 150k tris / < 40 draw calls.
 */
describe('escena 3D — línea base del auto (Fase 3 T1)', () => {
  it('cumple los presupuestos de triángulos y draw calls', () => {
    const build = buildCar()
    try {
      const stats = collectStats(build.group)
      console.log('[scene] stats', stats)
      expect(stats.meshes).toBeGreaterThan(0)
      expect(stats.triangles).toBeGreaterThan(0)
      expect(stats.vertices).toBeGreaterThan(0)
      // Desktop: los del documento
      expect(stats.triangles).toBeLessThan(150_000)
      expect(stats.drawCalls).toBeLessThanOrEqual(40)
      // Móvil: tras fusionar los estáticos por material el auto actual queda
      // en el límite de 25 (el rediseño debe dejarlo holgado por debajo).
      expect(stats.drawCalls).toBeLessThanOrEqual(25)
    } finally {
      build.dispose()
    }
  })

  it('las mallas fusionadas mantienen normales unitarias y geometría válida', () => {
    const build = buildCar()
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
          const x = norm.getX(i)
          const y = norm.getY(i)
          const z = norm.getZ(i)
          const len = Math.hypot(x, y, z)
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

  it('libera la geometría al desmontar sin romper el grupo en memoria', () => {
    const build = buildCar()
    build.dispose()
    expect(build.group.children.length).toBeGreaterThan(0) // el grupo sigue siendo válido
  })
})