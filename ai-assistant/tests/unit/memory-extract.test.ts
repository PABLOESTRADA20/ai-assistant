import { describe, expect, it } from 'vitest'
import { extractMemories, heuristicExtract } from '@/app/lib/memory-extract'

/**
 * Tests unitarios del extractor de memorias.
 *
 * `heuristicExtract` es la red de seguridad cuando Groq falla o no devuelve
 * JSON: convierte un mensaje en hechos con categoría e importancia.
 */
describe('heuristicExtract', () => {
  it('detecta preferencias explícitas (importance 0.9)', () => {
    const out = heuristicExtract('Me gusta mucho programar en Python por las noches')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'long_term', category: 'preference', importance: 0.9 })
    expect(out[0].content).toContain('Me gusta')
    expect(out[0].tags).toEqual(['preference'])
  })

  it('detecta disgustos con importance 0.85', () => {
    const out = heuristicExtract('Odio las reuniones largas de los lunes')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'preference', importance: 0.85 })
  })

  it('detecta datos del entorno (herramientas de trabajo)', () => {
    const out = heuristicExtract('Trabajo con Docker y Kubernetes todo el día')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'fact', importance: 0.75 })
  })

  it('detecta aprendizaje en curso', () => {
    const out = heuristicExtract('Quiero aprender Rust este año')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'skill', importance: 0.8 })
  })

  it('detecta instrucciones de recordar', () => {
    const out = heuristicExtract('Recuerda que mi cumpleaños es en junio')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: 'fact', importance: 0.85 })
  })

  it('devuelve [] ante mensajes triviales o vacíos', () => {
    expect(heuristicExtract('¿Qué hora es?')).toEqual([])
    expect(heuristicExtract('hola, ¿cómo estás?')).toEqual([])
    expect(heuristicExtract('   ')).toEqual([])
    expect(heuristicExtract('')).toEqual([])
  })

  it('puede extraer varios hechos de un solo mensaje', () => {
    const out = heuristicExtract('Me gusta el té y estoy aprendiendo TypeScript')
    expect(out).toHaveLength(2)
    expect(out.map((m) => m.category).sort()).toEqual(['preference', 'skill'])
  })

  it('trunca el contenido a 220 caracteres', () => {
    const out = heuristicExtract(`Me gusta ${'x'.repeat(300)}`)
    expect(out).toHaveLength(1)
    expect(out[0].content.length).toBe(220)
  })

  it('siempre devuelve importance/confidence dentro de [0, 1]', () => {
    const out = heuristicExtract('Prefiero el tema oscuro')
    expect(out[0].importance).toBeGreaterThanOrEqual(0)
    expect(out[0].importance).toBeLessThanOrEqual(1)
    expect(out[0].confidence).toBeGreaterThanOrEqual(0)
    expect(out[0].confidence).toBeLessThanOrEqual(1)
  })
})

describe('extractMemories', () => {
  it('devuelve [] sin clave o sin texto (sin tocar la red)', async () => {
    expect(await extractMemories('', 'hola')).toEqual([])
    expect(await extractMemories('gsk_develop', '   ')).toEqual([])
    expect(await extractMemories('gsk_develop', '')).toEqual([])
  })
})
