import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

/**
 * Convención de Cloudflare `import x from './archivo.wasm?module'`: workerd lo
 * resuelve solo, Node lo resuelve scripts/wasm-resolver.mjs, pero Vite no la
 * entiende y devuelve algo que no es un WebAssembly.Module (Prisma then falla
 * con "The loaded wasm module was unexpectedly undefined or null once loaded").
 * Este plugin la implementa para los tests: lee el .wasm y exporta el módulo
 * compilado, igual que los otros dos entornos.
 */
function wasmModuleConvention(): Plugin {
  return {
    name: 'test:wasm-module-convention',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null
      if (!source.endsWith('.wasm') && !source.endsWith('.wasm?module')) return null
      const file = path.resolve(path.dirname(importer), source.replace(/\?module$/, ''))
      return source.endsWith('?module') ? `${file}?module` : file
    },
    load(id) {
      if (!id.endsWith('.wasm') && !id.endsWith('.wasm?module')) return null
      const file = id.replace(/\?module$/, '')
      const b64 = readFileSync(file).toString('base64')
      return [
        `const bytes = Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0))`,
        `export default new WebAssembly.Module(bytes)`,
      ].join('\n')
    },
  }
}

/**
 * Configuración de Vitest.
 *
 * - `@/` se resuelve igual que en tsconfig para poder importar `@/app/lib/...`
 *   igual que hace el código de la app.
 * - El cliente Prisma (runtime cloudflare) importa `query_engine_bg.wasm?module`;
 *   el plugin de arriba lo resuelve para Node.
 */
export default defineConfig({
  plugins: [wasmModuleConvention()],
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Las pruebas de integración hacen viaje a la base de datos: margen amplio.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
