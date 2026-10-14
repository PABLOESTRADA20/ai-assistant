import { describe, expect, it } from 'vitest'
import {
  CODE_MAX_CHUNK_CHARS,
  chunkCode,
  codeChunkText,
  fuseCodeScores,
  hashContent,
  isIndexedFile,
  langFromPath,
} from '@/app/lib/code-index'

/**
 * Troceado del índice de código: puro, sin Postgres ni red.
 *
 * Los segmentos de prueba se rellenan a propósito por encima de
 * `CODE_MIN_CHUNK_CHARS` para que no se fusionen entre sí (el troceador une los
 * bloques diminutos, y sin relleno dos funciones cortas serían una sola).
 */

/** Función exportada con cuerpo suficiente para superar el umbral de fusión. */
function fn(name: string, lines = 8): string {
  const body = Array.from(
    { length: lines },
    (_, i) => `  const value${i} = ${i} // relleno para pasar el umbral de fusion`,
  ).join('\n')
  return `export function ${name}() {\n${body}\n  return ${name}\n}`
}

describe('langFromPath / isIndexedFile', () => {
  it('mapea extensiones conocidas a su lenguaje', () => {
    expect(langFromPath('app/lib/brain.ts')).toBe('typescript')
    expect(langFromPath('ui/Button.tsx')).toBe('tsx')
    expect(langFromPath('prisma/schema.prisma')).toBe('prisma')
    expect(langFromPath('README.md')).toBe('markdown')
    expect(langFromPath('foto.png')).toBeNull()
    expect(langFromPath('sin-extension')).toBeNull()
  })

  it('solo indexa extensiones de código y descarta lockfiles', () => {
    expect(isIndexedFile('app/lib/tools.ts')).toBe(true)
    expect(isIndexedFile('prisma/schema.prisma')).toBe(true)
    expect(isIndexedFile('README.md')).toBe(true)
    expect(isIndexedFile('public/logo.png')).toBe(false)
    expect(isIndexedFile('package-lock.json')).toBe(false)
    expect(isIndexedFile('pnpm-lock.yaml')).toBe(false)
  })
})

describe('hashContent', () => {
  it('es determinista y distingue textos distintos', () => {
    expect(hashContent('hola')).toBe(hashContent('hola'))
    expect(hashContent('hola')).not.toBe(hashContent('hola!'))
    expect(hashContent('')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('chunkCode', () => {
  it('devuelve [] para ficheros vacíos o solo con espacios', () => {
    expect(chunkCode('a.ts', '')).toEqual([])
    expect(chunkCode('a.ts', '   \n\n  \t')).toEqual([])
  })

  it('parte por función y conserva el nombre como símbolo', () => {
    const content = `import fs from 'fs'\n\n${fn('alpha')}\n\n${fn('beta')}\n`
    const chunks = chunkCode('app/lib/demo.ts', content)
    expect(chunks.map((c) => c.symbol)).toEqual(['alpha', 'beta'])
    expect(chunks.every((c) => c.kind === 'function')).toBe(true)
    expect(chunks.every((c) => c.lang === 'typescript')).toBe(true)
    // Líneas coherentes: el segundo empieza después de que termine el primero.
    expect(chunks[0].startLine).toBeLessThan(chunks[1].startLine)
    expect(chunks[0].endLine).toBeLessThan(chunks[1].startLine)
  })

  it('no parte un bloque por llaves dentro de strings', () => {
    const content = `export function bracey() {\n  const s = "}{ no son llaves }{"\n  const t = \`${'x'.repeat(220)}\`\n  return s\n}`
    const chunks = chunkCode('app/lib/bracey.ts', content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].symbol).toBe('bracey')
  })

  it('no parte una clase por sus métodos (profundidad de llaves)', () => {
    const methods = Array.from(
      { length: 8 },
      (_, i) => `  method${i}() {\n    const x = ${i} // relleno suficientemente largo\n    return x\n  }`,
    ).join('\n')
    const content = `export class Widget {\n${methods}\n}`
    const chunks = chunkCode('app/lib/widget.ts', content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].symbol).toBe('Widget')
    expect(chunks[0].kind).toBe('class')
  })

  it('sin declaraciones, el fichero entero es un trozo tipo file', () => {
    const content = '# Título\n\nTexto suelto sin ninguna declaración de código.'
    const chunks = chunkCode('docs/nota.md', content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].kind).toBe('file')
    expect(chunks[0].symbol).toBeNull()
  })

  it('parte las funciones gigantes en trozos de tamaño acotado con el mismo símbolo', () => {
    const body = Array.from(
      { length: 60 },
      (_, i) => `  const datoLargo${i} = '${'z'.repeat(50)}' // relleno extenso`,
    ).join('\n')
    const content = `export function gigante() {\n${body}\n}`
    const chunks = chunkCode('app/lib/gigante.ts', content)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.symbol === 'gigante')).toBe(true)
    expect(chunks.every((c) => c.content.length <= CODE_MAX_CHUNK_CHARS + 1)).toBe(true)
  })

  it('normaliza CRLF (no deja \\r en el contenido)', () => {
    const content = `${fn('crlf')}\r\n${fn('otro')}\r\n`.replace(/\n/g, '\r\n')
    const chunks = chunkCode('app/lib/crlf.ts', content)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some((c) => c.content.includes('\r'))).toBe(false)
  })

  it('el hash del trozo es estable entre ejecuciones', () => {
    const content = fn('estable')
    const a = chunkCode('a.ts', content)
    const b = chunkCode('a.ts', content)
    expect(a.map((c) => c.contentHash)).toEqual(b.map((c) => c.contentHash))
  })
})

describe('codeChunkText', () => {
  it('incluye ruta, símbolo y tipo delante del código', () => {
    const [chunk] = chunkCode('app/lib/notes.ts', fn('saveNote'))
    const text = codeChunkText('app/lib/notes.ts', chunk)
    expect(text).toContain('passage: typescript app/lib/notes.ts :: saveNote (function)')
    expect(text).toContain('export function saveNote')
  })
})

describe('fuseCodeScores', () => {
  it('una sola vía devuelve su similitud', () => {
    expect(fuseCodeScores(0.8, null)).toBe(0.8)
    expect(fuseCodeScores(null, 5)).toBeGreaterThan(0.9)
    expect(fuseCodeScores(undefined, undefined)).toBe(0)
  })

  it('coincidir en vectorial y léxico puntúa más que en una sola vía', () => {
    const fused = fuseCodeScores(0.7, 0.2)
    expect(fused).toBeGreaterThan(0.7)
    expect(fused).toBeLessThanOrEqual(1)
  })

  it('acota valores fuera de rango', () => {
    expect(fuseCodeScores(2, null)).toBe(1)
    expect(fuseCodeScores(-1, null)).toBe(0)
  })
})
