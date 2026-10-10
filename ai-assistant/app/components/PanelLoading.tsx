// app/components/PanelLoading.tsx
'use client'

/**
 * Placeholder mientras se descarga el chunk de un panel lateral (T1 de la fase
 * de rendimiento). Reproduce el mismo fondo atenuado + columna derecha que los
 * paneles reales (`MemoryInspector`, `GithubRepos`, `NotesPanel`) para que
 * abrirlos no muestre un hueco vacío ni produzca un salto de layout.
 */
export default function PanelLoading({ maxWidth = 'max-w-md' }: { maxWidth?: string }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" aria-hidden="true">
      <div className="absolute inset-0 bg-black/50" />

      <aside
        className={`relative w-full ${maxWidth} h-full flex items-center justify-center`}
        style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      >
        <span
          className="w-5 h-5 rounded-full animate-spin"
          style={{ border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }}
        />
      </aside>
    </div>
  )
}
