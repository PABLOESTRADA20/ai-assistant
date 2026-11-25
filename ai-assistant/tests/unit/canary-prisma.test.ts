import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Canario: comprueba que el cliente Prisma 7 (runtime cloudflare, que importa
 * `query_compiler_fast_bg.wasm?module`) carga bajo Vitest sin explotar. No toca
 * la base de datos, solo importa el módulo.
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

  it('usa la salida limpia de Prisma 7 sin el entrypoint obsoleto', () => {
    const generated = path.join(appRoot, 'app', 'generated', 'prisma')
    expect(existsSync(path.join(generated, 'client.ts'))).toBe(true)
    expect(existsSync(path.join(generated, 'internal', 'query_compiler_fast_bg.wasm'))).toBe(true)
    expect(existsSync(path.join(generated, 'wasm.js'))).toBe(false)
    expect(existsSync(path.join(generated, 'query_engine_bg.wasm'))).toBe(false)
  })
})
