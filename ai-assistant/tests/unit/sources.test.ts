import { describe, expect, it } from 'vitest'
import { toSourceRefs } from '@/app/lib/sources'
import type { BrainHit } from '@/app/lib/brain'

/**
 * Mapeo `BrainHit -> SourceRef` de la FASE 3.1: los chips de fuentes son un
 * recorte ligero de lo que `searchBrain` ya inyecta en el contexto. Estas
 * pruebas cubren el título legible por tipo, la propagación del score/snippet
 * y que el mapeo sea puro (sin red, API ni BD).
 */

const memHit: BrainHit = {
  kind: 'memory',
  id: 'mem-1',
  type: 'pref',
  category: 'general',
  content: 'A Pable le gusta el mate amargo.',
  snippet: '…le gusta el mate amargo…',
  tags: ['mate'],
  source: 'conversation',
  score: 0.87,
  importance: 0.6,
  createdAt: '2026-10-01T10:00:00Z',
}

const noteMirrorHit: BrainHit = {
  ...memHit,
  id: 'mem-note',
  type: 'knowledge',
  source: 'note',
  score: 0.72,
}

const noteHit: BrainHit = {
  kind: 'note',
  id: 'nota-9',
  title: 'Ideas 2026',
  content: 'Proyectos del año',
  snippet: 'Proyectos…',
  tags: ['proyectos'],
  source: 'note',
  score: 0.61,
  createdAt: '2026-10-02T10:00:00Z',
}

const vaultHit: BrainHit = {
  kind: 'vault',
  id: 'vault-3',
  title: 'Reunión octubre',
  content: 'Actas de la reunión',
  snippet: 'Actas…',
  tags: ['reunión'],
  source: 'vault',
  score: 0.55,
  createdAt: '2026-10-03T10:00:00Z',
}

const messageHit: BrainHit = {
  kind: 'message',
  id: 'msg-7',
  content: 'Mensaje anterior',
  snippet: 'Mensaje anterior…',
  tags: [],
  source: 'conversation',
  score: 0.44,
  createdAt: '2026-10-04T10:00:00Z',
}

describe('toSourceRefs', () => {
  it('mapea los cuatro tipos con el título legible correcto', () => {
    const refs = toSourceRefs([memHit, noteHit, vaultHit, messageHit])
    expect(refs.map((r) => r.kind)).toEqual(['memory', 'note', 'vault', 'message'])
    expect(refs[0].title).toBe('Memoria · pref/general')
    expect(refs[1].title).toBe('Ideas 2026')
    expect(refs[2].title).toBe('Reunión octubre')
    expect(refs[3].title).toBe('Mensaje anterior de esta conversación')
  })

  it('las notas espejadas (memory con source note) se titulan como nota guardada', () => {
    const [ref] = toSourceRefs([noteMirrorHit])
    expect(ref.kind).toBe('memory')
    expect(ref.title).toBe('Nota guardada en la carpeta de ARIA')
    expect(ref.source).toBe('note')
  })

  it('propaga score, snippet e id tal cual', () => {
    const [ref] = toSourceRefs([memHit])
    expect(ref.id).toBe('mem-1')
    expect(ref.score).toBe(0.87)
    expect(ref.snippet).toBe('…le gusta el mate amargo…')
    expect(ref.source).toBe('conversation')
  })

  it('hits sin título caen al título genérico del tipo', () => {
    const noTitle: BrainHit = { ...vaultHit, title: undefined }
    const [ref] = toSourceRefs([noTitle])
    expect(ref.title).toBe('Nota del vault')
  })

  it('lista vacía da lista vacía', () => {
    expect(toSourceRefs([])).toEqual([])
  })
})