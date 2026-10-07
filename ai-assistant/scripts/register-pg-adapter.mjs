/**
 * Hook de Node (`--import`) que instala @prisma/adapter-pg como driver adapter
 * de Prisma en tests y scripts: es el único que habla TCP con un Postgres
 * propio (Docker/VPS). Con PRISMA_ADAPTER=neon se omite y se mantiene el
 * adapter HTTP de Neon.
 *
 * app/lib/prisma.ts lee esta factory de globalThis (Symbol.for) y, si no
 * existe —caso de Workers—, usa el adapter de Neon. Por eso este archivo NUNCA
 * debe importarse desde el código de la app: pg necesita node:net y rompería el
 * bundle del Worker (OpenNext/Cloudflare).
 */
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

if (process.env.PRISMA_ADAPTER !== 'neon') {
  const { PrismaPg } = await import('@prisma/adapter-pg')
  globalThis[Symbol.for('aria.prismaAdapterFactory')] = (connectionString) =>
    new PrismaPg({ connectionString })
}
