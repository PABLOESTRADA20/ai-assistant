import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_LIMITS, applyPatch, applyTextPatches } from '@/app/lib/github'

/**
 * Prisma en memoria para los tests: el contador de correcciones por rama vive
 * en `SessionContext`, y no queremos tocar ninguna base real. Se declara con
 * `vi.hoisted` porque `vi.mock` se eleva por encima de los imports.
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

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/* ----------------------- lógica pura de parcheo ----------------------- */

describe('applyTextPatches', () => {
  it('reemplaza un bloque único y deja el resto intacto', () => {
    const text = 'const a = 1\nconst b = 2\nconst c = 3\n'
    const out = applyTextPatches(text, [{ search: 'const b = 2', replace: 'const b = 42' }])
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.content).toBe('const a = 1\nconst b = 42\nconst c = 3\n')
  })

  it('falla si el bloque no aparece (cero coincidencias)', () => {
    const out = applyTextPatches('const a = 1\n', [{ search: 'const z = 9', replace: 'x' }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/no aparece/i)
  })

  it('falla si el bloque aparece más de una vez (ambiguo)', () => {
    const out = applyTextPatches('foo()\nfoo()\n', [{ search: 'foo()', replace: 'bar()' }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/más de una vez/i)
  })

  it('tolera saltos de línea CRLF y los preserva al escribir', () => {
    const text = 'line1\r\nline2\r\nline3\r\n'
    // El modelo copia el bloque con \n aunque el archivo use \r\n.
    const out = applyTextPatches(text, [{ search: 'line1\nline2', replace: 'line1\nLINE2' }])
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.content).toBe('line1\r\nLINE2\r\nline3\r\n')
  })

  it('rechaza un parche que elimina demasiadas líneas netas', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line${i}`).join('\n')
    const out = applyTextPatches(text, [{ search: text, replace: 'line0' }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/demasiadas líneas/i)
  })

  it('rechaza un bloque search vacío o gigante', () => {
    const empty = applyTextPatches('abc', [{ search: '', replace: 'x' }])
    expect(empty.ok).toBe(false)

    const huge = 'a'.repeat(GITHUB_LIMITS.patchSearchChars + 1)
    const big = applyTextPatches('abc', [{ search: huge, replace: 'x' }])
    expect(big.ok).toBe(false)
  })

  it('rechaza un parche que dejaría el archivo vacío', () => {
    const out = applyTextPatches('solo una línea\n', [{ search: 'solo una línea\n', replace: '' }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/vacío/i)
  })
})

/* --------------------- applyPatch de punta a punta -------------------- */

describe('applyPatch', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalWrite = process.env.GITHUB_WRITE_ENABLED

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStore.clear()
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
    if (originalWrite === undefined) delete process.env.GITHUB_WRITE_ENABLED
    else process.env.GITHUB_WRITE_ENABLED = originalWrite
  })

  function enableWrite() {
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_WRITE_ENABLED = 'true'
  }

  interface Handlers {
    content?: string
    sha?: string
    size?: number
    putStatus?: number
  }

  /** Mock de la API de GitHub. Devuelve las llamadas registradas. */
  function stubFetch(handlers: Handlers = {}) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        calls.push({ url, method, body })

        if (url.endsWith('/repos/owner/repo')) return json({ default_branch: 'main' })
        if (url.includes('/git/ref/heads/')) return json({ ref: 'refs/heads/branch', object: { sha: 'base-sha' } })
        if (url.endsWith('/git/refs') && method === 'POST') return json({ ref: 'refs/heads/aria/new' })
        if (url.includes('/contents/') && method === 'GET') {
          return json({
            content: b64(handlers.content ?? ''),
            encoding: 'base64',
            size: handlers.size ?? (handlers.content ?? '').length,
            sha: handlers.sha ?? 'blob-1',
            type: 'file',
          })
        }
        if (url.includes('/contents/') && method === 'PUT') {
          if (handlers.putStatus && handlers.putStatus >= 400) {
            return json({ message: 'sha does not match' }, handlers.putStatus)
          }
          return json({ content: { sha: 'new-sha' } })
        }
        if (url.endsWith('/pulls') && method === 'POST') {
          return json({ number: 7, html_url: 'https://github.test/pr/7' })
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
      await applyPatch({
        repo: 'owner/repo',
        title: 'Parche',
        patches: [{ path: 'src/index.ts', search: 'a', replace: 'b' }],
      }),
    )
    expect(out.error).toMatch(/desactivada/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aplica un parche mínimo y abre un PR en una rama aria/*', async () => {
    enableWrite()
    const original = 'const a = 1\nconst b = 2\n'
    const calls = stubFetch({ content: original })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Corrige b',
        patches: [{ path: 'src/index.ts', search: 'const b = 2', replace: 'const b = 42' }],
      }),
    )
    expect(out.success).toBe(true)
    expect(out.branch).toMatch(/^aria\/corrige-b-/)
    expect(out.merged).toBe(false)
    expect(out.pull_request).toBe(7)

    const put = calls.find((c) => c.method === 'PUT')
    expect(put).toBeTruthy()
    expect(Buffer.from(String(put!.body!.content), 'base64').toString('utf-8')).toBe(
      'const a = 1\nconst b = 42\n',
    )
    expect(calls.some((c) => c.method === 'PUT' && c.body?.branch === 'main')).toBe(false)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true)
  })

  it('aborta si el archivo cambió entre lectura y escritura (baseSha)', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n', sha: 'new-blob' })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Parche viejo',
        patches: [
          { path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2', baseSha: 'old-blob' },
        ],
      }),
    )
    expect(out.error).toMatch(/cambió|SHA/i)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('maneja el rechazo de GitHub por sha caducado (409)', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n', putStatus: 409 })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Choque',
        patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2' }],
      }),
    )
    expect(out.error).toMatch(/conflicto|cambió/i)
    expect(calls.some((c) => c.method === 'PUT')).toBe(true)
  })

  it('bloquea rutas prohibidas antes de tocar la red', async () => {
    enableWrite()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const workflow = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'No',
        patches: [{ path: '.github/workflows/deploy.yml', search: 'a', replace: 'b' }],
      }),
    )
    expect(workflow.error).toMatch(/no permitida/i)

    const traversal = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'No',
        patches: [{ path: '../../etc/passwd', search: 'a', replace: 'b' }],
      }),
    )
    expect(traversal.error).toMatch(/no permitida/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechaza archivos demasiado grandes para parchear', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'x', size: GITHUB_LIMITS.patchFileBytes + 1 })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Grande',
        patches: [{ path: 'src/big.ts', search: 'x', replace: 'y' }],
      }),
    )
    expect(out.error).toMatch(/límite|bytes/i)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('con una rama aria/* existente commitea sin crear PR', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n' })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Corrección',
        branch: 'aria/fix-abc',
        patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2' }],
      }),
    )
    expect(out.success).toBe(true)
    expect(out.branch).toBe('aria/fix-abc')
    expect(out.pull_request).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false)
  })

  it('nunca escribe en la rama principal', async () => {
    enableWrite()
    stubFetch({ content: 'const a = 1\n' })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Mala rama',
        branch: 'main',
        patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2' }],
      }),
    )
    expect(out.error).toMatch(/principal/i)
  })

  it('permite ramas con nombre libre (sin el prefijo aria/)', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n' })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Rama libre',
        branch: 'feature/nueva-funcion',
        patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2' }],
      }),
    )
    expect(out.success).toBe(true)
    expect(out.branch).toBe('feature/nueva-funcion')
    expect(calls.some((c) => c.method === 'PUT' && c.body?.branch === 'feature/nueva-funcion')).toBe(true)
  })

  it('rechaza nombres de rama inválidos sin escribir nada', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n' })

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Rama rota',
        branch: 'mala rama..',
        patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: 'const a = 2' }],
      }),
    )
    expect(out.error).toMatch(/inválido/i)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('informa cuando el archivo no existe en la rama', async () => {
    enableWrite()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/repos/owner/repo')) return json({ default_branch: 'main' })
        if (url.includes('/git/ref/heads/main')) return json({ object: { sha: 'base-sha' } })
        if (url.endsWith('/git/refs') && method === 'POST') return json({ ref: 'refs/heads/aria/new' })
        return json({ message: 'Not Found' }, 404)
      }),
    )

    const out = JSON.parse(
      await applyPatch({
        repo: 'owner/repo',
        title: 'Nuevo',
        patches: [{ path: 'src/missing.ts', search: 'a', replace: 'b' }],
      }),
    )
    expect(out.error).toMatch(/no existe/i)
  })

  it('cuenta las correcciones y bloquea la tercera sobre la misma rama aria/*', async () => {
    enableWrite()
    const calls = stubFetch({ content: 'const a = 1\n' })
    const patch = (n: number) => ({
      repo: 'owner/repo',
      title: `Corrección ${n}`,
      branch: 'aria/fix-abc',
      patches: [{ path: 'src/index.ts', search: 'const a = 1', replace: `const a = ${n}` }],
    })

    const first = JSON.parse(await applyPatch(patch(2)))
    expect(first.success).toBe(true)
    expect(first.fix_attempts).toBe(1)
    expect(first.fix_attempts_max).toBe(2)

    const second = JSON.parse(await applyPatch(patch(3)))
    expect(second.success).toBe(true)
    expect(second.fix_attempts).toBe(2)

    const putsBefore = calls.filter((c) => c.method === 'PUT').length
    const third = JSON.parse(await applyPatch(patch(4)))
    expect(third.error).toMatch(/correcciones automáticas/i)
    expect(third.fix_attempts).toBe(2)
    // No se escribió nada en el tercer intento.
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(putsBefore)
  })
})
