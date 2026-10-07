import { describe, expect, it } from 'vitest'

/**
 * Canario: comprueba que el cliente Prisma (runtime cloudflare, que importa
 * `query_engine_bg.wasm?module`) carga bajo Vitest sin explotar. No toca la
 * base de datos, solo importa el módulo.
 */
describe('carga del cliente Prisma bajo Vitest', () => {
  it('importa app/lib/prisma y expone el proxy', async () => {
    const mod = await import('@/app/lib/prisma')
    expect(mod.prisma).toBeDefined()
    expect(typeof mod.getPrisma).toBe('function')
  })

  it('importa app/lib/memory (arrastra Prisma + generated)', async () => {
    const mod = await import('@/app/lib/memory')
    expect(typeof mod.createMemory).toBe('function')
    expect(typeof mod.searchSemanticMemories).toBe('function')
    expect(typeof mod.getWorkingMemory).toBe('function')
  })
})
