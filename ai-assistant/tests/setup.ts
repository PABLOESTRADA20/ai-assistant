import dotenv from 'dotenv'
import { register } from 'node:module'

// El cliente Prisma genera `import("./query_engine_bg.wasm?module")` (runtime
// cloudflare). Node no sabe cargar `.wasm` como módulo ES; este hook — el mismo
// que usan los scripts (`npm run db:smoke`…) — lo convierte en un módulo que
// exporta el WebAssembly.Module. Se registra antes de que ningún test importe
// a app/lib/prisma.
register(new URL('../scripts/wasm-resolver.mjs', import.meta.url))

// Claves de Groq / Cloudflare para los pocos tests que sí hablan con la red.
dotenv.config({ path: '.env.local', quiet: true })

// Embeddings locales por defecto en tests: deterministas, sin red y sin gastar
// la cuota de Workers AI. Para forzar los reales en un test: define
// EMBEDDING_PROVIDER=workers en el entorno antes de lanzarlo.
process.env.EMBEDDING_PROVIDER ??= 'local'

// Regla de oro de este harness: los tests NUNCA tocan la base de producción.
// Si existe TEST_DATABASE_URL, es la única que se usa; sin ella, los tests de
// integración se omiten (ver tests/integration/*.test.ts).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
