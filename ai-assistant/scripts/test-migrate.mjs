/**
 * Aplica las migraciones de Prisma contra TEST_DATABASE_URL.
 *
 * Es el paso previo de `npm run test:integration`: la base de pruebas se crea
 * y se pone al día desde cero. Falla con un mensaje claro si no hay
 * TEST_DATABASE_URL, y NUNCA toca la base de producción (esa sale de
 * DATABASE_URL de prisma.config.ts).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ quiet: true })
dotenv.config({ path: '.env.local', quiet: true })

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url) {
  console.error('Falta TEST_DATABASE_URL (entorno o .env.local).')
  console.error('Debe apuntar a una base de pruebas AISLADA, jamás a producción.')
  process.exit(1)
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js')

// prisma.config.ts prefiere DATABASE_URL_UNPOOLED: se pisan las dos para que
// el CLI conecte a la BD de pruebas aunque .env defina la de producción.
const opts = {
  cwd: root,
  env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
}

// Neon scale-to-zero (o Docker recién levantado): la primera conexión en frío
// a veces falla. Hasta 3 intentos con 10 s de espera (mismo patrón que deploy.yml).
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
let lastError = ''
for (let attempt = 1; attempt <= 3; attempt++) {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    ...opts,
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'pipe'],
  })
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status === 0) process.exit(0)
  lastError = `${result.error?.message ?? ''}\n${result.stderr ?? ''}`
  if (attempt < 3) {
    console.error(`migrate deploy falló (intento ${attempt}); reintentando en 10 s...`)
    sleep(10_000)
  }
}
console.error('migrate deploy falló tras 3 intentos.')
if (/ECONNREFUSED|ENOTFOUND|does not exist|Connect/i.test(lastError)) {
  console.error('')
  console.error('No responde el Postgres de pruebas (TEST_DATABASE_URL):')
  console.error('  - Con Docker: `npm run db:up` (compose en el puerto 5433).')
  console.error('  - docker/init.sql crea la BD `aria_test` en el primer arranque.')
  console.error('  - O apunta TEST_DATABASE_URL a otra base de pruebas aislada.')
}
process.exit(1)
