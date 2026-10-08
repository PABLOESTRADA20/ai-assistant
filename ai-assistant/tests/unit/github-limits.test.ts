import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_LIMITS,
  listFiles,
  listIssues,
  readFile,
  repoOverview,
} from '@/app/lib/github'

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

/** Fixtures falsos: ninguna petición sale a la red. */
function stubGithub() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)

    if (url.includes('/readme')) {
      return json({ content: b64('R'.repeat(3000)), encoding: 'base64' })
    }
    if (url.includes('/git/trees/')) {
      return json({
        tree: Array.from({ length: 400 }, (_, i) => ({ path: `file${i}.ts`, type: 'blob' })),
      })
    }
    if (url.includes('/issues?')) {
      return json(
        Array.from({ length: 15 }, (_, i) => ({
          number: i + 1,
          title: `issue ${i}`,
          state: 'open',
          labels: [],
          comments: 0,
          updated_at: '2026-01-01T00:00:00Z',
          body: 'B'.repeat(1000),
          html_url: `https://example.test/${i}`,
          // Pull requests que la API mezcla en /issues:
          ...(i % 5 === 0 ? { pull_request: {} } : {}),
        })),
      )
    }
    if (url.includes('/contents/')) {
      return json({ content: b64('A'.repeat(7000)), encoding: 'base64', size: 7000, type: 'file' })
    }
    // Información del repo (resto de URLs).
    return json({
      description: 'demo',
      language: 'TypeScript',
      stargazers_count: 1,
      forks_count: 0,
      open_issues_count: 2,
      default_branch: 'main',
      private: false,
      pushed_at: '2026-01-01T00:00:00Z',
      topics: [],
    })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('topes de resultados de GitHub', () => {
  it('repoOverview recorta el README y el árbol de primer nivel', async () => {
    stubGithub()
    const out = JSON.parse(await repoOverview('owner/repo'))
    expect(out.readme_excerpt.length).toBe(GITHUB_LIMITS.readme)
    expect(out.top_level.length).toBeLessThanOrEqual(100)
  })

  it('readFile devuelve una ventana de 6000 y permite continuar con offset', async () => {
    stubGithub()
    const first = JSON.parse(await readFile('owner/repo', 'src/index.ts'))
    expect(first.content.length).toBe(GITHUB_LIMITS.readFile)
    expect(first.truncated).toBe(true)
    expect(first.next_offset).toBe(GITHUB_LIMITS.readFile)

    const second = JSON.parse(
      await readFile('owner/repo', 'src/index.ts', undefined, first.next_offset),
    )
    expect(second.offset).toBe(GITHUB_LIMITS.readFile)
    expect(second.content.length).toBe(7000 - GITHUB_LIMITS.readFile)
    expect(second.truncated).toBe(false)
    expect(second.next_offset).toBeNull()
  })

  it('listFiles recorta a 150 entradas', async () => {
    stubGithub()
    const out = JSON.parse(await listFiles('owner/repo'))
    expect(out.files.length).toBe(GITHUB_LIMITS.listFiles)
  })

  it('listIssues recorta a 10 issues con body de 200 y excluye PRs', async () => {
    stubGithub()
    const out = JSON.parse(await listIssues('owner/repo'))
    expect(out.issues.length).toBe(GITHUB_LIMITS.issues)
    for (const issue of out.issues) {
      expect(issue.body.length).toBeLessThanOrEqual(GITHUB_LIMITS.issueBody)
      expect(issue).not.toHaveProperty('pull_request')
    }
  })
})
