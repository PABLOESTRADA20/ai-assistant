/**
 * Decisión aislada de `next.config.js`: cuándo externalizar los imports
 * `.wasm` de Prisma.
 *
 * En workerd (OpenNext/Cloudflare) los módulos WASM deben llegar como
 * `WebAssembly.Module` nativo: webpack los deja como `import("*.wasm")` y el
 * parche de `build:worker` los convierte en un import estático que wrangler
 * precompila. En Node (`next dev` / `next start`) ese mismo externalizado
 * rompe: Next busca el `.wasm` dentro de `.next/server/...` y no lo copia ahí.
 * Por eso solo se externaliza cuando el build es el del worker. OpenNext marca
 * ese build con `NEXT_PRIVATE_STANDALONE=true`; el ciclo `build:worker` por sí
 * solo no llega al `npm run build` hijo que ejecuta OpenNext.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function shouldExternalizeWasm(env = process.env) {
  if (env.OPENNEXT_WASM === '1' || env.NEXT_PRIVATE_STANDALONE === 'true') return true
  const lifecycle = env.npm_lifecycle_event
  return typeof lifecycle === 'string' && lifecycle.startsWith('build:worker')
}

module.exports = { shouldExternalizeWasm }
