import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEST,
  PROJECT_DOCS,
  firstHeading,
  renderDoc,
  vaultRelPath,
} from '@/app/lib/vault-docs'

/**
 * Puente repositorio → vault (FASE 6): puro, sin disco ni base de datos.
 */
describe('vault-docs', () => {
  it('lista la documentación del proyecto', () => {
    const rutas = PROJECT_DOCS.map((d) => d.src)
    expect(rutas).toContain('README.md')
    expect(rutas).toContain('ROADMAP.md')
  })

  it('saca el primer encabezado y cae al nombre si no hay', () => {
    expect(firstHeading('# ARIA\n\ntexto', 'sin-titulo')).toBe('ARIA')
    expect(firstHeading('sin encabezado', 'sin-titulo')).toBe('sin-titulo')
  })

  it('une rutas del vault con /', () => {
    expect(vaultRelPath('ARIA/Repositorio ai-assistant', 'README.md')).toBe(
      'ARIA/Repositorio ai-assistant/README.md',
    )
    expect(vaultRelPath('ARIA\\Repo', 'x.md')).toBe('ARIA/Repo/x.md')
  })

  it('envuelve el documento con metadatos y aviso, y conserva el contenido', () => {
    const out = renderDoc({
      source: 'ROADMAP.md',
      content: '# Fase 6\n\ncontenido original\n',
      generatedAt: '2026-10-16',
    })
    expect(out).toContain('tags:')
    expect(out).toContain('- aria')
    expect(out).toContain('origen: ROADMAP.md')
    expect(out).toContain('generado: 2026-10-16')
    expect(out).toContain('[!info] Copia automática')
    // El contenido original queda intacto (título incluido).
    expect(out).toContain('# Fase 6')
    expect(out).toContain('contenido original')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('define una carpeta destino dentro de ARIA', () => {
    expect(DEFAULT_DEST.startsWith('ARIA/')).toBe(true)
  })
})
