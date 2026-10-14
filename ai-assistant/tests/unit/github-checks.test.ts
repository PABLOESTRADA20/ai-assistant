import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCheckRuns } from '@/app/lib/github'

/**
 * Prisma en memoria: `getCheckRuns` lee el contador de correcciones de la rama
 * desde `SessionContext`. `vi.hoisted` porque `vi.mock` se eleva por encima de
 * los imports.
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

interface Handlers {
  pr?: unknown
  prStatus?: number
  branch?: unknown
  branchStatus?: number
  checkRuns?: unknown
  checkRunsStatus?: number
  statuses?: unknown
  annotations?: Record<number, unknown>
}

/** Mock de la API de GitHub para checks. Devuelve las URLs consultadas. */
function stubChecks(h: Handlers = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      calls.push(url)

      if (/\/pulls\/\d+$/.test(url)) {
        return h.prStatus && h.prStatus >= 400
          ? json({ message: 'Not Found' }, h.prStatus)
          : json(
              h.pr ?? {
                title: 'Fix',
                state: 'open',
                merged: false,
                head: { sha: 'sha-1', ref: 'aria/x' },
                base: { ref: 'main' },
              },
            )
      }
      if (url.includes('/branches/')) {
        return h.branchStatus && h.branchStatus >= 400
          ? json({ message: 'Not Found' }, h.branchStatus)
          : json(h.branch ?? { name: 'aria/x', commit: { sha: 'sha-1' } })
      }
      if (url.includes('/annotations')) {
        const id = Number(url.match(/check-runs\/(\d+)\/annotations/)?.[1])
        return json(h.annotations?.[id] ?? [])
      }
      if (url.includes('/check-runs?')) {
        return h.checkRunsStatus && h.checkRunsStatus >= 400
          ? json({ message: 'Forbidden' }, h.checkRunsStatus)
          : json({ check_runs: h.checkRuns ?? [] })
      }
      if (url.endsWith('/status')) {
        return json({ statuses: h.statuses ?? [] })
      }
      return json({ message: 'Not Found' }, 404)
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStore.clear()
})

describe('getCheckRuns', () => {
  it('exige pr o branch (sin tocar la red)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo' }))
    expect(out.error).toMatch(/pr|branch/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza un repositorio inválido', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = JSON.parse(await getCheckRuns({ repo: 'nope' }))
    expect(out.error).toMatch(/inválido/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reporta éxito con el SHA del commit y los datos del PR', async () => {
    stubChecks({
      checkRuns: [
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'lint', status: 'completed', conclusion: 'skipped' },
      ],
    })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', pr: 7 }))
    expect(out.state).toBe('success')
    expect(out.sha).toBe('sha-1')
    expect(out.branch).toBe('aria/x')
    expect(out.pr).toBe(7)
    expect(out.passed).toBe(1)
    expect(out.neutral).toBe(1)
    expect(out.failed).toBe(0)
  })

  it('reporta fallo y adjunta anotaciones y salida del check', async () => {
    stubChecks({
      checkRuns: [
        {
          id: 99,
          name: 'test',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.test/check/99',
          output: { title: 'Tests failed' },
        },
      ],
      annotations: { 99: [{ path: 'src/a.ts', start_line: 3, message: 'expected 1 got 2' }] },
    })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('failure')
    expect(out.failed).toBe(1)
    expect(out.failed_checks[0].detail).toContain('Tests failed')
    expect(out.failed_checks[0].annotations[0]).toContain('src/a.ts:3')
    expect(out.failed_checks[0].annotations[0]).toContain('expected 1 got 2')
    // Avisa con honestidad de que el log completo no es legible vía API.
    expect(JSON.stringify(out.warnings)).toMatch(/log completo/i)
  })

  it('avisa cuando no hay detalle legible del fallo', async () => {
    stubChecks({
      checkRuns: [{ id: 5, name: 'test', status: 'completed', conclusion: 'failure' }],
    })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('failure')
    expect(JSON.stringify(out.warnings)).toMatch(/no pude leer el detalle/i)
  })

  it('marca pendiente si algún check no terminó', async () => {
    stubChecks({
      checkRuns: [
        { name: 'build', status: 'in_progress' },
        { name: 'old', status: 'completed', conclusion: 'success' },
      ],
    })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('pending')
    expect(out.pending).toBe(1)
    expect(out.passed).toBe(1)
  })

  it('marca none si no hay checks ni estados', async () => {
    stubChecks()
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('none')
    expect(out.counts).toEqual({ check_runs: 0, statuses: 0 })
  })

  it('considera los commit statuses (CI antiguos) además de los check runs', async () => {
    stubChecks({ statuses: [{ state: 'failure', context: 'ci/old' }] })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('failure')
    expect(out.counts.statuses).toBe(1)
  })

  it('resuelve el commit a partir de una rama', async () => {
    const calls = stubChecks({ branch: { name: 'aria/otra', commit: { sha: 'branch-sha' } } })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/otra' }))
    expect(out.sha).toBe('branch-sha')
    expect(out.branch).toBe('aria/otra')
    expect(calls.some((u) => u.includes('/branches/aria%2Fotra'))).toBe(true)
  })

  it('no revienta si el token no puede leer check runs pero sí los estados', async () => {
    stubChecks({ checkRunsStatus: 403, statuses: [{ state: 'success', context: 'ci' }] })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.state).toBe('success')
    expect(JSON.stringify(out.warnings)).toMatch(/Checks: read/i)
  })

  it('expone el contador de correcciones de la rama', async () => {
    sessionStore.set('github:fix:owner/repo:aria/x', { count: 2 })
    stubChecks()
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', branch: 'aria/x' }))
    expect(out.fix_attempts).toBe(2)
    expect(out.fix_attempts_max).toBe(2)
  })

  it('propaga el error si el PR no existe', async () => {
    stubChecks({ prStatus: 404 })
    const out = JSON.parse(await getCheckRuns({ repo: 'owner/repo', pr: 7 }))
    expect(out.error).toMatch(/no encontré/i)
  })
})
