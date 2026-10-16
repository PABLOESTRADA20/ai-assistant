import { describe, expect, it } from 'vitest'
import { scrubText } from '@/app/lib/scrub'

/**
 * Anonimización del conjunto de datos (FASE 6): puro, sin base de datos ni red.
 *
 * Lo importante es que NADA de lo que sigue pueda acabar en el dataset. Se
 * comprueba tanto que el secreto desaparece como que el resto de la frase no se
 * rompe.
 */
describe('scrubText', () => {
  it('tapa los correos', () => {
    const { text, byKind } = scrubText('escribime a ana.perez+dev@ejemplo.com')
    expect(text).toBe('escribime a <email>')
    expect(byKind.email).toBe(1)
  })

  it('tapa una clave de Groq', () => {
    const { text } = scrubText('usa GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwx1234')
    expect(text).toBe('usa GROQ_API_KEY=<clave>')
  })

  it('tapa un token de GitHub', () => {
    const { text } = scrubText('Authorization: ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(text).toBe('Authorization: <clave>')
  })

  it('tapa usuario y clave de una URL de Postgres', () => {
    const { text } = scrubText('DATABASE_URL=postgresql://pablo:super-secreto@ep.datos.neon.tech/neondb')
    expect(text).toBe('DATABASE_URL=postgresql://<usuario>:<clave>@ep.datos.neon.tech/neondb')
  })

  it('tapa un JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const { text } = scrubText(`token=${jwt}`)
    expect(text).toBe('token=<token>')
  })

  it('tapa el token de un Bearer', () => {
    const { text } = scrubText('Authorization: Bearer abcDEF123456ghiJKL')
    expect(text).toBe('Authorization: Bearer <token>')
  })

  it('tapa el nombre de usuario en una ruta de Windows', () => {
    const { text } = scrubText('C:\\Users\\pablo\\OneDrive\\Desktop\\proyecto.ts')
    expect(text).toBe('C:\\Users\\<usuario>\\OneDrive\\Desktop\\proyecto.ts')
  })

  it('tapa el nombre de usuario en una ruta de Linux/macOS', () => {
    const { text } = scrubText('/home/pablo/proyecto/index.ts')
    expect(text).toBe('/home/<usuario>/proyecto/index.ts')
  })

  it('tapa direcciones IP', () => {
    const { text } = scrubText('el servidor 192.168.0.15 respondió')
    expect(text).toBe('el servidor <ip> respondió')
  })

  it('tapa teléfonos con prefijo internacional', () => {
    const { text } = scrubText('llamame al +54 9 11 5555 4444 porfa')
    expect(text).toContain('<telefono>')
    expect(text).not.toContain('5555')
  })

  it('tapa un DNI español', () => {
    const { text } = scrubText('DNI 12345678Z')
    expect(text).toBe('DNI <dni>')
  })

  it('tapa hashes largos (sha de git, tokens hex)', () => {
    const { text } = scrubText('commit ea9ec74000000000000000000000000000000000')
    expect(text).toBe('commit <hash>')
  })

  it('acumula el conteo por categoría', () => {
    const { redactions, byKind } = scrubText('a@b.com y c@d.com y 10.0.0.1')
    expect(redactions).toBe(3)
    expect(byKind.email).toBe(2)
    expect(byKind.ip).toBe(1)
  })

  it('no toca texto normal ni código común', () => {
    const limpio = 'const total = items.reduce((a, b) => a + b, 0) // suma simple'
    const { text, redactions } = scrubText(limpio)
    expect(text).toBe(limpio)
    expect(redactions).toBe(0)
  })
})
