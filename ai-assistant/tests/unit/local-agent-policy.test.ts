import { describe, expect, it } from 'vitest'
import {
  APP_ALIASES,
  CONSOLE_ALIASES,
  EXECUTABLE_EXTENSIONS,
  hasUnsafeChars,
  isExecutablePath,
  loadAgentToken,
  normalizeKey,
  resolveTarget,
  tokenMatches,
  validateOpenRequest,
} from '../../local-agent/target-policy.mjs'

/** Comprobador de existencia falso: solo existen las rutas indicadas. */
function existsOnly(...paths: string[]) {
  const set = new Set(paths)
  return (value: string) => set.has(value)
}

describe('alias y prototipos', () => {
  it('resuelve alias normalizando mayúsculas, acentos y espacios', () => {
    expect(normalizeKey('  VS   Code ')).toBe('vs code')
    expect(resolveTarget('  Spotify ', { existsSync: () => false })).toEqual({
      ok: true,
      value: 'spotify:',
      kind: 'alias',
    })
    expect(resolveTarget('Calculadora', { existsSync: () => false })).toEqual({
      ok: true,
      value: 'calc',
      kind: 'alias',
    })
  })

  it('no trata propiedades heredadas del prototipo como alias', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(resolveTarget(name, { existsSync: () => false })).toMatchObject({
        ok: false,
        status: 403,
      })
    }
    expect(Object.prototype.hasOwnProperty.call(APP_ALIASES, 'constructor')).toBe(false)
  })

  it('marca las consolas conocidas', () => {
    expect(CONSOLE_ALIASES).toEqual(new Set(['cmd', 'powershell', 'terminal']))
  })
})

describe('esquemas URI', () => {
  it('acepta solo la lista blanca', () => {
    const allowed = [
      'https://example.com',
      'http://example.com',
      'mailto:hola@example.com',
      'spotify:track:123',
      'ms-settings:privacy',
      'whatsapp://send?text=hola',
      'tg://resolve?domain=alguien',
      'discord://discordapp.com/channels/1/2',
      'steam://run/123',
      'vscode://file/tmp/proyecto',
    ]
    for (const uri of allowed) {
      expect(resolveTarget(uri, { existsSync: () => false })).toMatchObject({
        ok: true,
        value: uri,
        kind: 'uri',
      })
    }
  })

  it('rechaza esquemas peligrosos con 403', () => {
    const denied = [
      'file:///etc/passwd',
      'ms-msdt:/id',
      'search-ms:query=test',
      'javascript:alert(1)',
      'data:text/html,hola',
      'shell:startup',
    ]
    for (const uri of denied) {
      expect(resolveTarget(uri, { existsSync: () => false })).toMatchObject({
        ok: false,
        status: 403,
      })
    }
  })

  it('no confunde una ruta de Windows con un esquema', () => {
    const notes = 'C:\\Users\\pablo\\notas.txt'
    expect(resolveTarget(notes, { existsSync: existsOnly(notes) })).toEqual({
      ok: true,
      value: notes,
      kind: 'path',
    })
  })
})

describe('rutas y ejecutables', () => {
  it('reconoce las extensiones ejecutables, incluso con mayúsculas o puntos finales', () => {
    for (const ext of EXECUTABLE_EXTENSIONS) {
      expect(isExecutablePath(`/tmp/archivo.${ext}`)).toBe(true)
      expect(isExecutablePath(`/tmp/archivo.${ext.toUpperCase()}.`)).toBe(true)
    }
    expect(isExecutablePath('/tmp/notas.txt')).toBe(false)
    expect(isExecutablePath('/tmp/carpeta')).toBe(false)
  })

  it('no abre ejecutables por ruta, ni siquiera con ARIA_ALLOW_ANY=1', () => {
    const exe = 'C:\\Users\\pablo\\juego.exe'
    for (const allowAny of [false, true]) {
      expect(resolveTarget(exe, { allowAny, existsSync: existsOnly(exe) })).toMatchObject({
        ok: false,
        status: 403,
      })
    }
  })

  it('abre una ruta existente no ejecutable solo sin argumentos', () => {
    const notes = '/tmp/notas.txt'
    expect(
      resolveTarget(notes, { existsSync: existsOnly(notes) }),
    ).toEqual({ ok: true, value: notes, kind: 'path' })

    expect(
      validateOpenRequest(
        { app: notes, args: 'https://example.com' },
        { existsSync: existsOnly(notes) },
      ),
    ).toMatchObject({ ok: false, status: 403 })
  })
})

describe('consolas', () => {
  it('solo se abren sin argumentos', () => {
    for (const app of ['cmd', 'powershell', 'terminal']) {
      expect(validateOpenRequest({ app }, { existsSync: () => false })).toMatchObject({
        ok: true,
      })
      expect(
        validateOpenRequest({ app, args: '/c calc' }, { existsSync: () => false }),
      ).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('también bloquea argumentos si la consola llega como comando suelto', () => {
    expect(
      validateOpenRequest(
        { app: 'cmd.exe', args: '/c calc' },
        { allowAny: true, existsSync: () => false },
      ),
    ).toMatchObject({ ok: false, status: 403 })
  })
})

describe('argumentos', () => {
  it('acepta una URL http(s)', () => {
    expect(
      validateOpenRequest(
        { app: 'chrome', args: 'https://example.com' },
        { existsSync: () => false },
      ),
    ).toMatchObject({ ok: true, target: 'chrome', args: 'https://example.com' })
  })

  it('acepta una ruta existente no ejecutable', () => {
    const notes = '/tmp/notas.txt'
    expect(
      validateOpenRequest(
        { app: 'code', args: notes },
        { existsSync: existsOnly(notes) },
      ),
    ).toMatchObject({ ok: true, target: 'code', args: notes })
  })

  it('rechaza ejecutables, esquemas no http y rutas inexistentes', () => {
    const exe = '/tmp/juego.exe'
    const notes = '/tmp/notas.txt'
    const exists = existsOnly(exe, notes)
    for (const args of [
      exe,
      'file:///etc/passwd',
      'spotify:track:1',
      '/tmp/no-existe.txt',
      '--incognito',
      '',
    ]) {
      expect(validateOpenRequest({ app: 'chrome', args }, { existsSync: exists })).toMatchObject({
        ok: false,
        status: 403,
      })
    }
  })

  it('bloquea caracteres de inyección en app y argumentos', () => {
    for (const args of [
      'https://example.com/&x',
      'https://example.com/?a=1&b=2',
      'https://example.com/%20',
      'https://example.com/|x',
      'https://example.com/<x',
      'https://example.com/^x',
      'https://example.com/"x',
      'https://example.com/`x',
      'https://example.com/\nx',
      '/tmp/notas.txt\r\ncalc',
    ]) {
      expect(
        validateOpenRequest(
          { app: 'chrome', args },
          { existsSync: existsOnly('/tmp/notas.txt') },
        ),
      ).toMatchObject({ ok: false, status: 403 })
    }

    expect(hasUnsafeChars('cmd & calc')).toBe(true)
    expect(hasUnsafeChars('https://example.com')).toBe(false)
  })

  it('rechaza args que no sean texto y peticiones sin app', () => {
    expect(validateOpenRequest({ app: 'chrome', args: 42 })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(validateOpenRequest({ app: '', args: undefined })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(validateOpenRequest({ app: 42 })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('ARIA_ALLOW_ANY', () => {
  it('permite comandos sueltos, pero no saltarse la política', () => {
    expect(
      validateOpenRequest({ app: 'mi-juego' }, { allowAny: true, existsSync: () => false }),
    ).toMatchObject({ ok: true, target: 'mi-juego', kind: 'command' })

    expect(
      validateOpenRequest(
        { app: 'mi-juego', args: 'https://example.com' },
        { allowAny: true, existsSync: () => false },
      ),
    ).toMatchObject({ ok: true, target: 'mi-juego' })

    expect(
      validateOpenRequest(
        { app: 'mi-juego', args: '--cheat' },
        { allowAny: true, existsSync: () => false },
      ),
    ).toMatchObject({ ok: false, status: 403 })

    expect(
      validateOpenRequest(
        { app: 'cmd', args: '/c calc' },
        { allowAny: true, existsSync: () => false },
      ),
    ).toMatchObject({ ok: false, status: 403 })

    expect(
      validateOpenRequest(
        { app: 'mi-juego & calc' },
        { allowAny: true, existsSync: () => false },
      ),
    ).toMatchObject({ ok: false, status: 403 })
  })
})

describe('token del agente', () => {
  it('compara en tiempo constante y falla cerrado', () => {
    expect(tokenMatches('secreto', 'secreto')).toBe(true)
    expect(tokenMatches('secreto', 'otro')).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches(undefined, 'secreto')).toBe(false)
    expect(tokenMatches('secreto', undefined)).toBe(false)
    expect(tokenMatches('a'.repeat(1000), 'b'.repeat(1000))).toBe(false)
  })

  it('prioriza ARIA_LOCAL_TOKEN y no toca el disco', () => {
    expect(
      loadAgentToken({
        envToken: '  desde-env  ',
        tokenFile: '/tmp/token',
        existsSync: () => {
          throw new Error('no debería leer el disco')
        },
      }),
    ).toBe('desde-env')
  })

  it('lee un token guardado', () => {
    expect(
      loadAgentToken({
        tokenFile: '/tmp/token',
        existsSync: () => true,
        readFileSync: () => 'guardado\n',
      }),
    ).toBe('guardado')
  })

  it('genera y guarda un token nuevo con permisos 0600', () => {
    let written = ''
    let mode: number | undefined
    const token = loadAgentToken({
      tokenFile: '/tmp/token',
      existsSync: () => false,
      writeFileSync: (_file, data, options) => {
        written = data
        mode = options?.mode
      },
      randomBytes: () => ({ toString: () => 'generado' }),
    })
    expect(token).toBe('generado')
    expect(written).toBe('generado\n')
    expect(mode).toBe(0o600)
  })

  it('si no puede leer/escribir, devuelve vacío y avisa', () => {
    const warnings: string[] = []
    const token = loadAgentToken({
      tokenFile: '/tmp/token',
      existsSync: () => true,
      readFileSync: () => {
        throw new Error('sin permisos')
      },
      warn: (message) => warnings.push(message),
    })
    expect(token).toBe('')
    expect(warnings).toHaveLength(1)
  })
})
