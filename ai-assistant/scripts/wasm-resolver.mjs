import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.wasm?module')) {
    const wasmPath = specifier.replace('?module', '')
    return {
      shortCircuit: true,
      url: new URL(wasmPath, context.parentURL).href,
      format: 'module',
    }
  }
  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  if (url.endsWith('.wasm')) {
    const buf = readFileSync(fileURLToPath(url))
    const base64 = buf.toString('base64')
    return {
      format: 'module',
      shortCircuit: true,
      source: `const bytes = Uint8Array.from(atob("${base64}"), c => c.charCodeAt(0));\nexport default new WebAssembly.Module(bytes);\n`,
    }
  }
  return nextLoad(url, context)
}
