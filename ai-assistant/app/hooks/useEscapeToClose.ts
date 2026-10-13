'use client'

import { useEffect } from 'react'

/**
 * Cierra el panel con la tecla Escape mientras está abierto. Antes vivía
 * duplicado en MemoryInspector, NotesPanel y GithubRepos.
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}