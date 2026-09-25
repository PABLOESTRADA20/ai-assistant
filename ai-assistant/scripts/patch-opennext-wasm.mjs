/**
 * Patch the OpenNext for Cloudflare build output so Prisma's WASM query engine
 * is loaded by wrangler as a precompiled `WebAssembly.Module` (workerd only
 * allows instantiating pre-compiled modules).
 *
 * `next.config.js` externalizes `.wasm` imports so webpack leaves them as
 * literal `import("...wasm")` expressions in its output. OpenNext's esbuild
 * pass then rewrites those relative imports to ABSOLUTE paths (pointing at
 * copied `.next` files that do not exist). This script:
 *
 *  1. Replaces every `import("<abs path>/query_engine_bg.wasm")` in
 *     `handler.mjs` with a call to `__get_oe_wasm()`.
 *  2. Prepends a single top-level static `import` of the wasm file (relative to
 *     `handler.mjs`) plus the `__get_oe_wasm` helper, so wrangler bundles the
 *     wasm natively (one canonical location).
 *  3. Copies the wasm file next to `handler.mjs` for wrangler to resolve.
 *
 * Run AFTER `opennextjs-cloudflare build` and BEFORE `wrangler deploy`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = path.join(root, '.open-next', 'server-functions', 'default')
const handlerPath = path.join(serverDir, 'handler.mjs')
const sourceWasm = path.join(root, 'app', 'generated', 'prisma', 'query_engine_bg.wasm')

const MARKER = '__get_oe_wasm'
const REL_WASM_DIR = path.join('chunks', 'static', 'wasm')
const WASM_NAME = 'query_engine_bg.wasm'
const REL_WASM = `${REL_WASM_DIR.replace(/\\/g, '/')}/${WASM_NAME}`

function log(msg) {
  console.log(`[patch-opennext-wasm] ${msg}`)
}

function copyWasm() {
  const targetDir = path.join(serverDir, REL_WASM_DIR)
  fs.mkdirSync(targetDir, { recursive: true })
  fs.copyFileSync(sourceWasm, path.join(targetDir, WASM_NAME))
  log(`copied ${WASM_NAME} to ${path.relative(root, path.join(targetDir, WASM_NAME))}`)
}

if (!fs.existsSync(sourceWasm)) {
  throw new Error(`source wasm not found: ${sourceWasm}`)
}
let handler = fs.readFileSync(handlerPath, 'utf8')

if (handler.includes(MARKER)) {
  log('handler.mjs already patched')
  copyWasm()
  process.exit(0)
}

// eslint-disable-next-line no-useless-escape
const importRe = /import\(\s*"([^"]*query_engine_bg\.wasm)"\s*\)/g
const matches = handler.match(importRe)
if (!matches || matches.length === 0) {
  log('WARNING: no external wasm imports found in handler.mjs; nothing to patch!')
  process.exit(0)
}
log(`found ${matches.length} external wasm import(s)`)

// Replace every external wasm import with the helper call.
handler = handler.replace(importRe, '__get_oe_wasm()')

// Prepend the canonical static import + helper.
const header =
  `import __oe_wasm_core from "./${REL_WASM}";\n` +
  `const __oe_wasm_ns = { default: __oe_wasm_core };\n` +
  `const __get_oe_wasm = () => Promise.resolve(__oe_wasm_ns);\n`

fs.writeFileSync(handlerPath, header + handler)
log('handler.mjs patched')

copyWasm()