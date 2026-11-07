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
const deployWorkflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'deploy.yml'),
  'utf8',
)

describe('scripts de build para Workers', () => {
  it('centraliza el build de OpenNext en build:worker con la bandera de versión', () => {
    const build = packageJson.scripts['build:worker']
    expect(build).toBeDefined()
    expect(build).toContain('--dangerouslyUseUnsupportedNextVersion')
    expect(build).toContain('scripts/patch-opennext-wasm.mjs')
  })

  it('preview, deploy y upload reutilizan build:worker', () => {
    for (const script of ['preview', 'deploy', 'upload']) {
      expect(packageJson.scripts[script], script).toContain('npm run build:worker')
    }
  })

  it('el workflow de deploy usa el mismo build en vez de invocar OpenNext directo', () => {
    expect(deployWorkflow).toContain('run: npm run build:worker')
    expect(deployWorkflow).not.toContain('run: npx opennextjs-cloudflare build')
  })
})
