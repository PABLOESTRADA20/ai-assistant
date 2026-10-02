'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Brain,
  X,
  Search,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  Check,
  Archive,
  Sparkles,
} from 'lucide-react'
import { apiFetch } from '@/app/lib/auth-client'
import type { MemoryRecord, MemoryStats } from '@/app/types'

const TYPE_LABELS: Record<string, string> = {
  long_term: 'Largo plazo',
  episodic: 'Episódica',
  factual: 'Factual',
  procedural: 'Procedural',
  semantic: 'Semántica',
}

const CATEGORY_LABELS: Record<string, string> = {
  preference: 'Preferencia',
  knowledge: 'Conocimiento',
  event: 'Evento',
  skill: 'Habilidad',
  fact: 'Hecho',
}

const TYPES = ['long_term', 'episodic', 'factual', 'procedural', 'semantic']
const CATEGORIES = ['preference', 'knowledge', 'event', 'skill', 'fact']

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function MemoryInspector({ open, onClose }: Props) {
  const [records, setRecords] = useState<MemoryRecord[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showCompressed, setShowCompressed] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editImportance, setEditImportance] = useState(0.5)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('fact')
  const [newImportance, setNewImportance] = useState(0.6)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filterType) params.set('type', filterType)
      if (filterCategory) params.set('category', filterCategory)
      if (showCompressed) params.set('includeCompressed', 'true')
      const res = await apiFetch(`/api/memory?${params.toString()}`)
      if (!res.ok) throw new Error('No se pudo cargar la memoria')
      const data = await res.json()
      setRecords(data.memories ?? [])
      if (data.stats) setStats(data.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [filterType, filterCategory, showCompressed])

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

  const runSearch = async () => {
    const q = query.trim()
    if (!q) {
      void load()
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 40 }),
      })
      if (!res.ok) throw new Error('La búsqueda falló')
      const data = await res.json()
      setRecords(data.memories ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en la búsqueda')
    } finally {
      setLoading(false)
    }
  }

  const saveEdit = async (id: string) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await apiFetch(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent, importance: editImportance }),
      })
      if (!res.ok) throw new Error('No se pudo guardar')
      setEditingId(null)
      setNotice('Memoria actualizada')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('¿Olvidar esta memoria? Esta acción no se puede deshacer.')) return
    setBusyId(id)
    try {
      const res = await apiFetch(`/api/memory/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('No se pudo borrar')
      setRecords((prev) => prev.filter((r) => r.id !== id))
      setNotice('Memoria olvidada')
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al borrar')
    } finally {
      setBusyId(null)
    }
  }

  const add = async () => {
    const content = newContent.trim()
    if (!content) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          type: 'long_term',
          category: newCategory,
          importance: newImportance,
          source: 'manual',
        }),
      })
      if (!res.ok) throw new Error('No se pudo guardar')
      setNewContent('')
      setAdding(false)
      setNotice('Memoria añadida')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al añadir')
    } finally {
      setLoading(false)
    }
  }

  const consolidate = async () => {
    setLoading(true)
    setNotice(null)
    setError(null)
    try {
      const res = await apiFetch('/api/memory/consolidate', { method: 'POST' })
      if (!res.ok) throw new Error('No se pudo consolidar')
      const data = await res.json()
      if (data.stats) setStats(data.stats)
      setNotice(
        `Consolidado: ${data.compressed ?? 0} archivadas · ${data.purged ?? 0} purgadas · ${data.expiredContexts ?? 0} contextos limpiados`
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al consolidar')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  const inputStyle = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <aside
        className="relative w-full max-w-md h-full flex flex-col"
        style={{ background: 'var(--surface-1)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--accent-muted)' }}
            >
              <Brain size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Memoria de ARIA
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {stats ? `${stats.total} recuerdos · ${stats.compressed} archivados` : 'Lo que ARIA sabe de ti'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <StatChip label="Total" value={stats.total} />
            <StatChip label="Preferencias" value={stats.byCategory?.preference ?? 0} />
            <StatChip label="Hechos" value={stats.byCategory?.fact ?? 0} />
            <StatChip label="Importancia media" value={stats.avgImportance} />

            <button
              onClick={consolidate}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition hover:opacity-70 disabled:opacity-40 ml-auto"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Archiva recuerdos viejos y poco importantes, purga los ya olvidados y limpia contextos"
            >
              <Sparkles size={11} />
              Consolidar
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="px-4 py-3 flex flex-col gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs flex-1"
              style={inputStyle}
            >
              <Search size={12} style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
                placeholder="Buscar en la memoria…"
                className="bg-transparent outline-none flex-1 text-xs"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
            <button
              onClick={runSearch}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(255,46,77,0.2)' }}
            >
              Buscar
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs outline-none"
              style={inputStyle}
            >
              <option value="">Todos los tipos</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs outline-none"
              style={inputStyle}
            >
              <option value="">Todas las categorías</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={showCompressed}
                onChange={(e) => setShowCompressed(e.target.checked)}
              />
              <Archive size={11} />
              Archivados
            </label>

            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition hover:opacity-70 ml-auto"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <Plus size={12} />
              Añadir
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition hover:opacity-70 disabled:opacity-40"
              style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              title="Recargar"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>

          {adding && (
            <div className="flex flex-col gap-2 p-2.5 rounded-xl" style={{ background: 'var(--surface-2)' }}>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Qué debe recordar ARIA…"
                rows={2}
                className="px-2.5 py-2 rounded-lg text-xs outline-none resize-none"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <div className="flex items-center gap-2">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="px-2 py-1 rounded-lg text-xs outline-none"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Importancia
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={newImportance}
                    onChange={(e) => setNewImportance(Number(e.target.value))}
                  />
                  {newImportance.toFixed(2)}
                </label>
                <button
                  onClick={add}
                  disabled={loading || !newContent.trim()}
                  className="ml-auto px-3 py-1 rounded-lg text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                >
                  Guardar
                </button>
              </div>
            </div>
          )}

          {notice && (
            <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
              {notice}
            </div>
          )}
          {error && (
            <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
              {error}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading && records.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={18} className="animate-spin" />
              <span className="text-xs">Cargando memoria…</span>
            </div>
          )}

          {!loading && records.length === 0 && (
            <div className="text-center py-10">
              <Brain size={22} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {query ? 'Sin recuerdos que coincidan' : 'Aún no hay recuerdos guardados'}
              </p>
            </div>
          )}

          {records.map((m) => {
            const editing = editingId === m.id
            const busy = busyId === m.id
            return (
              <div
                key={m.id}
                className="p-3 rounded-xl transition"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  opacity: m.isCompressed ? 0.6 : 1,
                }}
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                    {TYPE_LABELS[m.type] ?? m.type}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                    {CATEGORY_LABELS[m.category] ?? m.category}
                  </span>
                  {m.isCompressed && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                      <Archive size={9} /> archivada
                    </span>
                  )}
                  {typeof m.similarity === 'number' && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      sim {Math.round(m.similarity * 100)}%
                    </span>
                  )}
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                    {fmtDate(m.createdAt)}
                  </span>
                </div>

                {editing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      className="px-2.5 py-2 rounded-lg text-xs outline-none resize-none"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        Importancia
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={editImportance}
                          onChange={(e) => setEditImportance(Number(e.target.value))}
                        />
                        {editImportance.toFixed(2)}
                      </label>
                      <button
                        onClick={() => saveEdit(m.id)}
                        disabled={busy}
                        className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
                        style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 rounded-lg text-xs transition hover:opacity-70"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      {m.content}
                    </p>

                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(m.importance * 100)}%`, background: 'var(--accent)' }}
                        />
                      </div>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        imp {m.importance.toFixed(2)} · conf {m.confidence.toFixed(2)}
                      </span>

                      <button
                        onClick={() => {
                          setEditingId(m.id)
                          setEditContent(m.content)
                          setEditImportance(m.importance)
                        }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center transition hover:opacity-70"
                        style={{ color: 'var(--text-muted)' }}
                        title="Editar"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => remove(m.id)}
                        disabled={busy}
                        className="w-6 h-6 rounded-lg flex items-center justify-center transition hover:bg-red-500/20 disabled:opacity-40"
                        style={{ color: '#f87171' }}
                        title="Olvidar"
                      >
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="px-2 py-1 rounded-lg text-[11px] flex items-center gap-1.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
