/**
 * Mapea los hits del cerebro (`BrainHit[]` de `searchBrain`) a la forma ligera
 * que viaja por el SSE y se muestra como chips bajo la respuesta (`SourceRef`).
 *
 * Es puro y sin dependencias de runtime: los chips solo necesitan tipo, título,
 * snippet y score — no el contenido completo que ya viaja al prompt.
 */
import type { BrainHit } from '@/app/lib/brain'
import type { SourceRef } from '@/app/types'

function sourceTitle(h: BrainHit): string {
  switch (h.kind) {
    case 'memory':
      // Las notas espejadas viven en Memoria con source 'note'.
      if (h.source === 'note') return 'Nota guardada en la carpeta de ARIA'
      return `Memoria · ${h.type ?? 'info'}/${h.category ?? 'general'}`
    case 'note':
      return `Nota de la carpeta${h.title ? ` · ${h.title}` : ''}`
    case 'vault':
      return `Nota del vault${h.title ? ` · ${h.title}` : ''}`
    case 'message':
      return 'Mensaje anterior de esta conversación'
  }
}

export function toSourceRefs(hits: BrainHit[]): SourceRef[] {
  return hits.map((h) => ({
    kind: h.kind,
    id: h.id,
    title: h.title ?? sourceTitle(h),
    snippet: h.snippet,
    score: h.score,
    source: h.source,
  }))
}