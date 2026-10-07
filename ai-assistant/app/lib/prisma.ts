import { PrismaClient } from '../generated/prisma/wasm.js'
import { PrismaNeon } from '@prisma/adapter-neon'

/**
 * Gestión del cliente Prisma en Cloudflare Workers.
 *
 * Por qué NO se puede compartir un único PrismaClient entre requests:
 * el engine WASM de Prisma crea objetos de I/O "Native" ligados al request que
 * los crea. Si el mismo cliente se reutiliza en un request posterior, workerd
 * lanza "Cannot perform I/O on behalf of a different request" y responde
 * HTTP 1101 de forma intermitente (~40% de los requests en producción).
 *
 * Solución: un PrismaClient por request, cacheado en el contexto del request
 * actual (AsyncLocalStorage) para reutilizarlo dentro de la misma request.
 * El objeto de contexto lo crea OpenNext en `runWithCloudflareRequestContext`
 * (`cloudflareContextALS.run({ env, ctx, cf }, handler)`) y es único por request.
 */

/**
 * Fábrica del driver adapter que registran los entornos Node (tests y scripts)
 * vía scripts/register-pg-adapter.mjs: @prisma/adapter-pg, el único que habla
 * TCP con un Postgres propio (Docker/VPS) — y también con el TCP de Neon.
 *
 * Workers nunca la registra y usa el adapter de Neon (HTTP), por lo que
 * @prisma/adapter-pg no aparece en el bundle del Worker (pg necesita node:net
 * y rompería el build de OpenNext/Cloudflare).
 */
type AdapterFactory = (connectionString: string) => NonNullable<ConstructorParameters<typeof PrismaClient>[0]>['adapter']

// Symbol.for = registro global: la misma clave que usa el hook de Node.
const ADAPTER_FACTORY_KEY = Symbol.for('aria.prismaAdapterFactory')

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!
  const factory = (globalThis as Record<symbol, unknown>)[ADAPTER_FACTORY_KEY] as AdapterFactory | undefined
  const adapter = factory ? factory(connectionString) : new PrismaNeon({ connectionString })
  return new PrismaClient({ adapter })
}

// Contexto del request actual, inyectado por @opennextjs/cloudflare.
// Se lee por el mismo símbolo que usa getCloudflareContext(), de forma
// síncrona y sin importar el paquete (los scripts locales de Node, que
// importan este módulo, no deben arrastrar el runtime de Cloudflare).
type RequestContext = { __prismaClient?: PrismaClient }

function currentRequestContext(): RequestContext | null {
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')]
  return (ctx as RequestContext | undefined) ?? null
}

// Node (scripts locales, prisma CLI): un único cliente reutilizable, que allí
// no suffers de la restricción de I/O por request.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function nodeClient(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient()
  return globalForPrisma.prisma
}

/** Cliente Prisma ligado al request actual. */
export function getPrisma(): PrismaClient {
  const ctx = currentRequestContext()
  if (!ctx) return nodeClient()
  if (!ctx.__prismaClient) ctx.__prismaClient = createClient()
  return ctx.__prismaClient
}

/**
 * Proxy que resuelve el cliente del request actual en cada acceso a propiedad,
 * de modo que los call sites existentes (`prisma.memory.findMany(...)`)
 * obtain siempre el cliente correcto sin tener que cambiar a `getPrisma()`.
 * Cualquier uso nuevo queda protegido automáticamente.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
