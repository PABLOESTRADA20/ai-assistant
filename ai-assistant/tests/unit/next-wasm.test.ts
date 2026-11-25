import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { shouldExternalizeWasm } = require('../../scripts/next-wasm.cjs') as {
  shouldExternalizeWasm: (env: Record<string, string | undefined>) => boolean
}

describe('shouldExternalizeWasm', () => {
  it('externaliza solo en el build del worker (npm script)', () => {
    expect(shouldExternalizeWasm({ npm_lifecycle_event: 'build:worker' })).toBe(true)
    expect(shouldExternalizeWasm({ npm_lifecycle_event: 'build:worker:preview' })).toBe(true)
  })

  it('respeta el interruptor explícito OPENNEXT_WASM', () => {
    expect(shouldExternalizeWasm({ OPENNEXT_WASM: '1' })).toBe(true)
  })

  it('externaliza en el build que OpenNext marca como standalone', () => {
    expect(shouldExternalizeWasm({ NEXT_PRIVATE_STANDALONE: 'true' })).toBe(true)
  })

  it('no externaliza en dev, build ni start de Node', () => {
    expect(shouldExternalizeWasm({ npm_lifecycle_event: 'dev' })).toBe(false)
    expect(shouldExternalizeWasm({ npm_lifecycle_event: 'build' })).toBe(false)
    expect(shouldExternalizeWasm({ npm_lifecycle_event: 'start' })).toBe(false)
    expect(shouldExternalizeWasm({})).toBe(false)
  })
})
