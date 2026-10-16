import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteFiles,
  isValidBranchName,
  mergePullRequest,
  validateBranch,
} from '@/app/lib/github'

/**
 * Prisma en memoria: `mergePullRequest` pasa por `getCheckRuns`, que consulta el
 * contador de correcciones por rama. No queremos tocar ninguna base real.
 */
const { sessionStore } = vi.hoisted(() => ({ sessionStore: new Map<string, unknown>() }))

vi.mock('@/app/lib/prisma', () => ({
  prisma: {
    sessionContext: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = sessionStore.get(where.key)
        return value === undefined ? null : { key: where.key, value }
      },
      upsert: async (args: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        const value = args.update.value ?? args.create.value
        sessionStore.set(args.where.key, value)
        return { key: args.where.key, value }
      },
    },
  },
}))

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const originalToken = process.env.GITHUB_TOKEN
const originalWrite = process.env.GITHUB_WRITE_ENABLED
const originalMerge = process.env.GITHUB_AUTO_MERGE

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStore.clear()
  restoreEnv('GITHUB_TOKEN', originalToken)
  restoreEnv('GITHUB_WRITE_ENABLED', originalWrite)
  restoreEnv('GITHUB_AUTO_MERGE', originalMerge)
})

function enableWrite(autoMerge = false) {
  process.env.GITHUB_TOKEN = 'test-token'
  process.env.GITHUB_WRITE_ENABLED = 'true'
  if (autoMerge) process.env.GITHUB_AUTO_MERGE = 'true'
  else delete process.env.GITHUB_AUTO_MERGE
}

/* ------------------------- validación de ramas ------------------------- */

describe('isValidBranchName / validateBranch', () => {
  it('acepta nombres normales y libres', () => {
    for (const name of ['feature/login', 'fix-123', 'aria/cosa-abc', 'release/1.2']) {
      expect(isValidBranchName(name), name).toBe(true)
    }
  })

  it('rechaza nombres peligrosos o mal formados', () => {
    for (const name of [
      '',
      'con espacio',
      'dos..puntos',
      'barra//doble',
      '/inicio',
      'fin/',
      '.oculto',
      '-guion',
      'termina.',
      'fin.lock',
      '@{algo}',
      'caracter~raro',
      'a'.repeat(201),
    ]) {
      expect(isValidBranchName(name), name).toBe(false)
    }
  })

  it('nunca permite la rama principal', () => {
    const out = validateBranch('main', 'main')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/principal/i)
  })

  it('permite una rama distinta de la principal', () => {
    const out = validateBranch('feature/x', 'main')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.branch).toBe('feature/x')
  })
})

/* ---------------------------- borrar archivos --------------------------- */

describe('deleteFiles', () => {
  function stubDelete(overrides: { missing?: string; dir?: string } = {}) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, method, body })

        if (url.endsWith('/repos/owner/repo')) return json({ default_branch: 'main' })
        if (url.includes('/git/ref/heads/')) return json({ object: { sha: 'base-sha' } })
        if (url.endsWith('/git/refs') && method === 'POST') return json({ ref: 'refs/heads/aria/new' })
        if (url.includes('/contents/') && method === 'GET') {
          if (overrides.missing && url.includes(overrides.missing)) {
            return json({ message: 'Not Found' }, 404)
          }
          if (overrides.dir && url.includes(overrides.dir)) {
            return json({ sha: 'dir-sha', type: 'dir' })
          }
          return json({ sha: 'blob-1', type: 'file' })
        }
        if (url.includes('/contents/') && method === 'DELETE') {
          return json({ commit: { sha: 'del-sha' } })
        }
        if (url.endsWith('/pulls') && method === 'POST') {
          return json({ number: 9, html_url: 'https://github.test/pr/9' })
        }
        return json({ message: 'Not Found' }, 404)
      }),
    )
    return calls
  }

  it('queda desactivada por defecto y no toca la red', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    delete process.env.GITHUB_WRITE_ENABLED
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const out = JSON.parse(
      await deleteFiles({ repo: 'owner/repo', title: 'Borra', paths: ['src/old.ts'] }),
    )
    expect(out.error).toMatch(/desactivada/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('borra archivos y abre un PR sin escribir en la rama principal', async () => {
    enableWrite()
    const calls = stubDelete()

    const out = JSON.parse(
      await deleteFiles({ repo: 'owner/repo', title: 'Limpieza', paths: ['src/old.ts', 'src/dead.ts'] }),
    )
    expect(out.success).toBe(true)
    expect(out.files_deleted).toEqual(['src/old.ts', 'src/dead.ts'])
    expect(out.merged).toBe(false)
    expect(out.pull_request).toBe(9)
    expect(out.branch).toMatch(/^aria\//)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    expect(calls.some((c) => c.method === 'DELETE' && c.body?.branch === 'main')).toBe(false)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true)
  })

  it('bloquea rutas prohibidas antes de crear la rama', async () => {
    enableWrite()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const workflow = JSON.parse(
      await deleteFiles({
        repo: 'owner/repo',
        title: 'No',
        paths: ['.github/workflows/deploy.yml'],
      }),
    )
    expect(workflow.error).toMatch(/no permitida/i)

    const traversal = JSON.parse(
      await deleteFiles({ repo: 'owner/repo', title: 'No', paths: ['../../etc/passwd'] }),
    )
    expect(traversal.error).toMatch(/no permitida/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('nunca borra en la rama principal', async () => {
    enableWrite()
    stubDelete()

    const out = JSON.parse(
      await deleteFiles({ repo: 'owner/repo', title: 'No', branch: 'main', paths: ['src/old.ts'] }),
    )
    expect(out.error).toMatch(/principal/i)
  })

  it('avisa si el archivo no existe y no borra nada', async () => {
    enableWrite()
    const calls = stubDelete({ missing: 'src/missing.ts' })

    const out = JSON.parse(
      await deleteFiles({ repo: 'owner/repo', title: 'No', paths: ['src/missing.ts'] }),
    )
    expect(out.error).toMatch(/no existe/i)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})

/* --------------------------- fusionar un PR ---------------------------- */

describe('mergePullRequest', () => {
  interface Checks {
    state: 'success' | 'pending' | 'failure' | 'none'
  }

  function stubMerge(opts: { checks?: Checks; mergeable?: boolean | null } = {}) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    const state = opts.checks?.state ?? 'success'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, method, body })

        if (url.includes('/commits/') && url.includes('/check-runs')) {
          if (state === 'success') {
            return json({ check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }] })
          }
          if (state === 'failure') {
            return json({ check_runs: [{ id: 2, name: 'ci', status: 'completed', conclusion: 'failure' }] })
          }
          if (state === 'none') return json({ check_runs: [] })
          return json({ check_runs: [{ id: 3, name: 'ci', status: 'in_progress', conclusion: null }] })
        }
        if (url.includes('/commits/') && url.endsWith('/status')) return json({ statuses: [] })
        if (url.includes('/check-runs/') && url.endsWith('/annotations')) return json([])
        if (url.endsWith('/pulls/3/merge') && method === 'PUT') {
          return json({ sha: 'merge-sha', merged: true })
        }
        if (url.endsWith('/pulls/3')) {
          return json({
            number: 3,
            state: 'open',
            merged: false,
            mergeable: opts.mergeable === undefined ? true : opts.mergeable,
            head: { ref: 'aria/x', sha: 'sha-1' },
            base: { ref: 'main' },
            html_url: 'https://github.test/pr/3',
          })
        }
        if (url.includes('/pulls?') && method === 'GET') {
          return json([{ number: 3 }])
        }
        return json({ message: 'Not Found' }, 404)
      }),
    )
    return calls
  }

  it('no fusiona si la auto-fusión está apagada (sin tocar la red)', async () => {
    enableWrite(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const out = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(out.error).toMatch(/auto-fusión/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fusiona cuando las pruebas pasaron', async () => {
    enableWrite(true)
    const calls = stubMerge({ checks: { state: 'success' } })

    const out = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(out.success).toBe(true)
    expect(out.merged).toBe(true)
    expect(out.checks).toBe('success')
    expect(out.method).toBe('squash')
    const merge = calls.find((c) => c.url.endsWith('/pulls/3/merge'))
    expect(merge?.body?.merge_method).toBe('squash')
  })

  it('no fusiona si hay pruebas en cola o fallidas', async () => {
    enableWrite(true)
    stubMerge({ checks: { state: 'pending' } })
    const pending = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(pending.error).toMatch(/no pasaron/i)
    expect(pending.state).toBe('pending')

    stubMerge({ checks: { state: 'failure' } })
    const failed = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(failed.error).toMatch(/no pasaron/i)
    expect(failed.state).toBe('failure')
  })

  it('no fusiona si hay conflictos', async () => {
    enableWrite(true)
    stubMerge({ checks: { state: 'success' }, mergeable: false })

    const out = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(out.error).toMatch(/conflictos/i)
  })

  it('fusiona un repo sin checks configurados (y avisa)', async () => {
    enableWrite(true)
    stubMerge({ checks: { state: 'none' } })

    const out = JSON.parse(await mergePullRequest({ repo: 'owner/repo', pr: 3 }))
    expect(out.success).toBe(true)
    expect(out.checks).toBe('none')
  })

  it('resuelve el PR por rama cuando no hay número', async () => {
    enableWrite(true)
    stubMerge({ checks: { state: 'success' } })

    const out = JSON.parse(await mergePullRequest({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.success).toBe(true)
    expect(out.pr).toBe(3)
  })
})
