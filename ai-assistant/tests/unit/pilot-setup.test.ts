import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '../..')
const repoRoot = path.resolve(appRoot, '..')

const packageJson = JSON.parse(
  readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> }
const gitignore = readFileSync(path.join(appRoot, '.gitignore'), 'utf8')

describe('configuración del piloto', () => {
  it('expone un demo local que no llama a build ni a deploy', () => {
    const script = packageJson.scripts['pilot:demo']
    expect(script).toBeDefined()
    expect(script).toContain('scripts/pilot-demo.ts')
    expect(script).not.toContain('deploy')
    expect(script).not.toContain('build:worker')
  })

  it('expone el modo LLM real sin incluir deploy', () => {
    const script = packageJson.scripts['pilot:llm']
    expect(script).toBeDefined()
    expect(script).toContain('scripts/pilot-llm.ts')
    expect(script).not.toContain('deploy')
    expect(script).not.toContain('build:worker')
  })

  it('expone el evaluador sin incluir deploy', () => {
    const script = packageJson.scripts['pilot:eval']
    expect(script).toBeDefined()
    expect(script).toContain('scripts/pilot-eval.ts')
    expect(script).not.toContain('deploy')
    expect(script).not.toContain('build:worker')
  })

  it('ignora las trazas para que no se suban al repo', () => {
    expect(gitignore).toContain('/data/traces/')
  })
})
