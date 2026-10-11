import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_LIMITS,
  createPullRequest,
  listFiles,
  listIssues,
  listMyRepos,
  normalizeGithubUser,
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

describe('escritura segura de GitHub', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalWrite = process.env.GITHUB_WRITE_ENABLED

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
    if (originalWrite === undefined) delete process.env.GITHUB_WRITE_ENABLED
    else process.env.GITHUB_WRITE_ENABLED = originalWrite
  })

  it('queda desactivada por defecto y no toca la red', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    delete process.env.GITHUB_WRITE_ENABLED
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const out = JSON.parse(
      await createPullRequest({
        repo: 'owner/repo',
        title: 'Cambio seguro',
        changes: [{ path: 'src/index.ts', content: 'export {}' }],
      }),
    )
    expect(out.error).toMatch(/desactivada/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('crea rama, archivo y PR sin escribir ni fusionar la rama principal', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_WRITE_ENABLED = 'true'
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, method, body })
        if (url.endsWith('/repos/owner/repo')) return json({ default_branch: 'main' })
        if (url.includes('/git/ref/heads/main')) return json({ object: { sha: 'base-sha' } })
        if (url.endsWith('/git/refs')) return json({ ref: 'refs/heads/aria/test' })
        if (url.includes('/contents/src%2Findex.ts')) return json({ sha: 'old-sha' })
        if (url.endsWith('/contents/src/index.ts')) return json({ content: { sha: 'new-sha' } })
        if (url.endsWith('/pulls')) return json({ number: 7, html_url: 'https://github.test/pr/7' })
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      }),
    )

    const out = JSON.parse(
      await createPullRequest({
        repo: 'owner/repo',
        title: 'Cambio seguro',
        branch: 'mejora',
        changes: [{ path: 'src/index.ts', content: 'export const safe = true' }],
      }),
    )
    expect(out.success).toBe(true)
    expect(out.base).toBe('main')
    expect(out.branch).toMatch(/^aria\/mejora-/)
    expect(out.merged).toBe(false)
    expect(calls.some((c) => c.method === 'PUT' && c.body?.branch === out.branch)).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true)
    expect(calls.some((c) => c.method === 'PUT' && c.body?.branch === 'main')).toBe(false)
  })

  it('bloquea workflows y lotes demasiado grandes antes de crear una rama', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_WRITE_ENABLED = 'true'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const workflow = JSON.parse(
      await createPullRequest({
        repo: 'owner/repo',
        title: 'No permitido',
        changes: [{ path: '.github/workflows/deploy.yml', content: 'name: deploy' }],
      }),
    )
    expect(workflow.error).toMatch(/no permitida/i)
    expect(fetchMock).not.toHaveBeenCalled()

    const tooMany = JSON.parse(
      await createPullRequest({
        repo: 'owner/repo',
        title: 'Demasiados',
        changes: Array.from({ length: GITHUB_LIMITS.writeFiles + 1 }, (_, i) => ({
          path: `src/${i}.ts`,
          content: '',
        })),
      }),
    )
    expect(tooMany.error).toMatch(/máximo/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('selector de repos: fallback sin token', () => {
  const originalToken = process.env.GITHUB_TOKEN

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN
  })
  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  })

  it('normalizeGithubUser valida el nombre de usuario', () => {
    expect(normalizeGithubUser('PABLOESTRADA20')).toBe('PABLOESTRADA20')
    expect(normalizeGithubUser('@octocat')).toBe('octocat')
    expect(normalizeGithubUser('  octo-cat ')).toBe('octo-cat')
    expect(normalizeGithubUser('bad user')).toBeNull()
    expect(normalizeGithubUser('a/b')).toBeNull()
    expect(normalizeGithubUser('')).toBeNull()
  })

  it('sin token y sin usuario pide el nombre de usuario (sin tocar la red)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = await listMyRepos()
    expect(out.ok).toBe(false)
    expect(out.tokenConfigured).toBe(false)
    expect(out.repos).toEqual([])
    expect(out.error).toMatch(/usuario de GitHub/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sin token, con usuario, lista sus repos públicos', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      expect(url).toContain('/users/octocat/repos')
      expect(url).toContain('type=owner')
      return json([
        {
          full_name: 'octocat/Hello-World',
          description: 'demo',
          private: false,
          language: 'Ruby',
          default_branch: 'master',
          pushed_at: '2026-01-01T00:00:00Z',
        },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await listMyRepos('', 100, 'octocat')
    expect(out.ok).toBe(true)
    expect(out.tokenConfigured).toBe(false)
    expect(out.repos).toHaveLength(1)
    expect(out.repos[0].repo).toBe('octocat/Hello-World')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('un usuario inexistente devuelve un error claro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    const out = await listMyRepos('', 100, 'nadie-xyz')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/No encontré el usuario/i)
  })

  it('un usuario inválido no dispara peticiones', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = await listMyRepos('', 100, 'a/b c')
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/inválido/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
