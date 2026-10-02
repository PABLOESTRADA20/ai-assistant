'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileText,
  Plus,
  Trash2,
  Download,
  Loader2,
  X,
  Search,
  Save,
  ArrowLeft,
  Package,
} from 'lucide-react'
import { apiFetch } from '@/app/lib/auth-client'
import { createZip, safeFileName } from '@/app/lib/zip'

interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface Props {
  open: boolean
  onClose: () => void
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Nota como Markdown con frontmatter, lista para soltar en Obsidian. */
function noteToMarkdown(n: Note): string {
  const tags = n.tags?.length ? `\ntags: [${n.tags.join(', ')}]` : ''
  return `---\ntitle: ${n.title}${tags}\nupdated: ${n.updatedAt}\n---\n\n# ${n.title}\n\n${n.content}\n`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/**
 * "Carpeta ARIA": notas guardadas en la nube y exportables a Obsidian.
 *
 * Se eligió la nube (no el disco del PC) para que funcione desde el celular sin
 * depender de que el ordenador esté encendido. El botón de exportar arma un ZIP
 * con un `.md` por nota, que Obsidian lee tal cual.
 */
export default function NotesPanel({ open, onClose }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/notes')
      if (!res.ok) throw new Error('No se pudieron cargar las notas')
      const data = await res.json()
      setNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    )
  }, [notes, query])

  const startCreate = () => {
    setCreating(true)
    setEditingId(null)
    setTitle('')
    setContent('')
    setError(null)
    setNotice(null)
  }

  const startEdit = (n: Note) => {
    setCreating(false)
    setEditingId(n.id)
    setTitle(n.title)
    setContent(n.content)
    setError(null)
    setNotice(null)
  }

  const cancelEdit = () => {
    setCreating(false)
    setEditingId(null)
    setTitle('')
    setContent('')
  }

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        const res = await apiFetch(`/api/notes/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar')
        setNotice('Nota actualizada.')
      } else {
        const res = await apiFetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar')
        setNotice('Nota guardada en la carpeta de ARIA.')
      }
      cancelEdit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (n: Note) => {
    if (!window.confirm(`¿Eliminar la nota "${n.title}"?`)) return
    setError(null)
    try {
      const res = await apiFetch(`/api/notes/${n.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('No se pudo eliminar')
      if (editingId === n.id) cancelEdit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  const exportOne = (n: Note) => {
    downloadBlob(new Blob([noteToMarkdown(n)], { type: 'text/markdown' }), safeFileName(n.title))
  }

  const exportAll = async () => {
    if (!notes.length) {
      setError('No hay notas para exportar')
      return
    }
    setError(null)
    setNotice(null)
    try {
      const used = new Set<string>()
      const entries = notes.map((n) => ({ name: safeFileName(n.title, used), content: noteToMarkdown(n) }))
      const index = `# Carpeta ARIA\n\nExportado: ${new Date().toLocaleString('es-ES')}\n\n${notes
        .map((n) => `- [[${n.title}]]`)
        .join('\n')}\n`
      entries.push({ name: 'Carpeta ARIA.md', content: index })
      downloadBlob(createZip(entries), `aria-notas-${today()}.zip`)
      setNotice(`Exportadas ${notes.length} notas. Descomprime el ZIP dentro de tu vault de Obsidian.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar')
    }
  }

  if (!open) return null

  const inputStyle = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  const isEditing = creating || editingId !== null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <aside
        className="relative w-full max-w-lg h-full flex flex-col"
        style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            {isEditing ? (
              <button
                onClick={cancelEdit}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:opacity-70"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Volver"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--accent-muted)' }}
              >
                <FileText size={16} style={{ color: 'var(--accent)' }} />
              </div>
            )}
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isEditing ? (editingId ? 'Editar nota' : 'Nueva nota') : 'Carpeta ARIA'}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {isEditing ? 'Markdown · exportable a Obsidian' : `${notes.length} notas guardadas`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {isEditing ? (
          /* Editor */
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título de la nota"
              className="px-3 py-2 rounded-xl text-sm outline-none"
              style={inputStyle}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Escribe aquí en Markdown…"
              className="flex-1 px-3 py-2 rounded-xl text-sm outline-none resize-none font-mono leading-relaxed"
              style={inputStyle}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={save}
                disabled={saving || !title.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(255,46,77,0.2)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Guardar
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-2 rounded-xl text-sm transition hover:opacity-70"
                style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                Cancelar
              </button>
              {editingId && (
                <button
                  onClick={() => {
                    const n = notes.find((x) => x.id === editingId)
                    if (n) void remove(n)
                  }}
                  className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition hover:opacity-70"
                  style={{ color: '#f87171', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                >
                  <Trash2 size={14} />
                  Eliminar
                </button>
              )}
            </div>
            {error && (
              <div className="text-xs flex-shrink-0" style={{ color: '#f87171' }}>
                {error}
              </div>
            )}
          </div>
        ) : (
          /* Lista */
          <>
            <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs flex-1" style={inputStyle}>
                <Search size={12} style={{ color: 'var(--text-muted)' }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar en tus notas…"
                  className="bg-transparent outline-none flex-1 text-xs"
                  style={{ color: 'var(--text-primary)' }}
                />
              </div>
              <button
                onClick={startCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition hover:opacity-80"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(255,46,77,0.2)' }}
              >
                <Plus size={12} />
                Nueva
              </button>
            </div>

            {notice && (
              <div
                className="px-4 py-2 text-xs flex-shrink-0"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)', borderBottom: '1px solid var(--border)' }}
              >
                {notice}
              </div>
            )}
            {error && (
              <div className="px-4 py-2 text-xs flex-shrink-0" style={{ color: '#f87171' }}>
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 size={14} className="animate-spin" />
                  Cargando…
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {notes.length === 0 ? (
                    <>
                      La carpeta está vacía.
                      <br />
                      Crea una nota o pídele a ARIA: «guarda una nota con…».
                    </>
                  ) : (
                    'Sin resultados para tu búsqueda.'
                  )}
                </div>
              ) : (
                filtered.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl p-3 flex items-start gap-2 cursor-pointer transition hover:opacity-90"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                    onClick={() => startEdit(n)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {n.title}
                      </div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        {n.content.replace(/\s+/g, ' ').slice(0, 120) || '(vacía)'}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                        {fmtDate(n.updatedAt)}
                        {n.tags?.length ? ` · ${n.tags.join(', ')}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        exportOne(n)
                      }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--text-muted)', background: 'var(--surface-1)' }}
                      title="Descargar .md"
                    >
                      <Download size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={exportAll}
                disabled={notes.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                <Package size={13} />
                Exportar a Obsidian (.zip)
              </button>
              <span className="text-[10px] flex-1 text-right" style={{ color: 'var(--text-muted)' }}>
                Un .md por nota
              </span>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
