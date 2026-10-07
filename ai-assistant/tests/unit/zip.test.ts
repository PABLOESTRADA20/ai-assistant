import { describe, expect, it } from 'vitest'
import { createZip, safeFileName } from '@/app/lib/zip'

describe('safeFileName', () => {
  it('devuelve el título + .md', () => {
    expect(safeFileName('Arquitectura de ARIA')).toBe('Arquitectura de ARIA.md')
  })

  it('sustituye caracteres prohibidos en nombres de archivo', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.md')
  })

  it('usa "nota.md" con títulos vacíos', () => {
    expect(safeFileName('')).toBe('nota.md')
    expect(safeFileName('   ')).toBe('nota.md')
  })

  it('evita duplicados (sin distinguir mayúsculas)', () => {
    const used = new Set<string>()
    expect(safeFileName('Nota', used)).toBe('Nota.md')
    expect(safeFileName('nota', used)).toBe('nota 2.md')
    expect(safeFileName('Nota', used)).toBe('Nota 3.md')
  })

  it('trunca títulos largos a 80 caracteres', () => {
    const name = safeFileName('x'.repeat(200))
    expect(name).toBe(`${'x'.repeat(80)}.md`)
  })
})

describe('createZip', () => {
  const entries = [
    { name: 'una.md', content: '# Una\nContenido de la nota una.' },
    { name: 'dos.md', content: '# Dos\nContenido de la nota dos.' },
  ]

  it('devuelve un Blob application/zip con firma PK correcta', async () => {
    const blob = createZip(entries)
    expect(blob.type).toBe('application/zip')

    const buf = new Uint8Array(await blob.arrayBuffer())
    // Firma local de archivo: PK\x03\x04
    expect([...buf.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('el directorio final (EOCD) decliva las entradas escritas', async () => {
    const blob = createZip(entries)
    const buf = new Uint8Array(await blob.arrayBuffer())

    // El EOCD son los últimos 22 bytes: firma PK\x05\x06 y el contador.
    const eocd = buf.slice(-22)
    expect([...eocd.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
    const count = eocd[10] | (eocd[11] << 8)
    expect(count).toBe(entries.length)
  })

  it('zip vacío: solo tiene directorio final (EOCD)', async () => {
    const buf = new Uint8Array(await createZip([]).arrayBuffer())
    // Sin entradas no hay cabeceras locales: el archivo es el EOCD de 22 bytes.
    expect([...buf.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
    const eocd = buf.slice(-22)
    expect(eocd[10] | (eocd[11] << 8)).toBe(0)
  })
})
