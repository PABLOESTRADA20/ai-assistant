import 'dotenv/config'

async function main() {
  const { PrismaClient } = await import('../app/generated/prisma/wasm.js')
  const { PrismaNeon } = await import('@prisma/adapter-neon')

  const CONN = process.env.DATABASE_URL!

  // 1) Crear el cliente: coste sincrono (sin query)
  const t0 = performance.now()
  const c1 = new PrismaClient({ adapter: new PrismaNeon({ connectionString: CONN }) })
  const tCreate = performance.now() - t0
  console.log(`crear cliente (sync):        ${tCreate.toFixed(1)}ms`)

  // 2) Primera query (instancia el engine WASM)
  const t1 = performance.now()
  await c1.conversation.count()
  console.log(`1ra query (engine init):     ${(performance.now() - t1).toFixed(0)}ms`)

  // 3) Queries siguientes con el MISMO cliente (warm)
  for (let i = 0; i < 5; i++) {
    const t2 = performance.now()
    await c1.conversation.count()
    console.log(`query warm #${i + 1}:              ${(performance.now() - t2).toFixed(0)}ms`)
  }
  await c1.$disconnect()

  // 4) Cliente nuevo, query warm tras init: aisolate el coste del engine
  for (let i = 0; i < 3; i++) {
    const c = new PrismaClient({ adapter: new PrismaNeon({ connectionString: CONN }) })
    const ta = performance.now()
    await c.conversation.count()
    const first = performance.now() - ta
    const tb = performance.now()
    await c.conversation.count()
    const second = performance.now() - tb
    console.log(`cliente nuevo #${i + 1}: 1ra=${first.toFixed(0)}ms 2da=${second.toFixed(0)}ms`)
    await c.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })