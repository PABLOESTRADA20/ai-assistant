'use client'

import type { ReactNode } from 'react'
import { useEscapeToClose } from '@/app/hooks/useEscapeToClose'

/** Fuente de verdad del estilo de inputs de los paneles laterales. */
export const inputStyle = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
}

interface Props {
  open: boolean
  onClose: () => void
  /** Ancho del drawer: `md` (default) o `lg`. */
  maxWidth?: 'md' | 'lg'
  children: ReactNode
}

/**
 * Esqueleto común de los paneles laterales (Memoria, Notas, GitHub): overlay de
 * fondo, cierre con Escape y drawer con fondo/borde del tema. Cada panel pinta
 * solo su contenido adentro.
 */
export default function SidePanel({ open, onClose, maxWidth = 'md', children }: Props) {
  useEscapeToClose(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <aside
        className={`relative w-full ${maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md'} h-full flex flex-col`}
        style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      >
        {children}
      </aside>
    </div>
  )
}