'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Github,
  X,
  Plus,
  Trash2,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
  List,
  Lock,
  Search,
} from 'lucide-react'
import { apiFetch } from '@/app/lib/auth-client'

interface Repo {
  repo: string
  note?: string
  addedAt: string
}

interface BrowseRepo {
  repo: string
  description: string | null
  private: boolean
  language: string | null
  defaultBranch: string
  pushedAt: string | null
}

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Panel para administrar los repositorios de GitHub que ARIA puede leer.
 *
 * Todo es de SOLO LECTURA: ARIA nunca crea issues, PRs ni modifica nada. La
 * lista se guarda en el servidor, así que aparece igual desde el PC y el móvil.
 *
 * Además del alta manual (`owner/repo`), si hay `GITHUB_TOKEN` configurado se
 * pueden listar los repositorios del usuario y agregarlos con un clic.
 */
export default function GithubRepos({ open, onClose }: Props) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [busyRepo, setBusyRepo] = useState<string | null>(null)

  // Selector de repositorios del usuario.
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseRepos, setBrowseRepos] = useState<BrowseRepo[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browseQuery, setBrowseQuery] = useState('')
  const [addingRepo, setAddingRepo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/github/repos')
      if (!res.ok) throw new Error('No se pudieron cargar los repositorios')
      const data = await res.json()
      setRepos(Array.isArray(data.repos) ? data.repos : [])
      setTokenConfigured(data.tokenConfigured === true)
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

  /** Agrega un repo a la lista guardada. Devuelve true si salió bien. */
  const submitRepo = async (value: string, repoNote?: string): Promise<boolean> => {
    const v = value.trim()
    if (!v || saving) return false
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/github/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: v, note: repoNote || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo agregar el repositorio')
      setRepos(Array.isArray(data.repos) ? data.repos : [])
      setTokenConfigured(data.tokenConfigured === true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al agregar')
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = async () => {
    const ok = await submitRepo(input, note.trim() || undefined)
    if (ok) {
      setInput('')
      setNote('')
    }
  }

  const loadBrowse = useCallback(async () => {
    setBrowseLoading(true)
    setBrowseError(null)
    try {
      const res = await apiFetch('/api/github/browse')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar tus repositorios')
      setBrowseRepos(Array.isArray(data.repos) ? data.repos : [])
      if (data.ok === false && data.error) setBrowseError(data.error)
    } catch (e) {
      setBrowseRepos([])
      setBrowseError(e instanceof Error ? e.message : 'Error al cargar repositorios')
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  const openBrowse = () => {
    setBrowseOpen(true)
    setBrowseQuery('')
    setError(null)
    void loadBrowse()
  }

  const addFromBrowse = async (repo: string) => {
    setAddingRepo(repo)
    const ok = await submitRepo(repo)
    setAddingRepo(null)
    if (ok) setBrowseRepos((prev) => prev.filter((r) => r.repo !== repo))
  }

  const remove = async (repo: string) => {
    if (!window.confirm(`¿Quitar ${repo} de la lista?`)) return
    setBusyRepo(repo)
    setError(null)
    try {
      const res = await apiFetch('/api/github/repos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo quitar')
      setRepos(Array.isArray(data.repos) ? data.repos : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al quitar')
    } finally {
      setBusyRepo(null)
    }
  }

  if (!open) return null

  const inputStyle = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }

  const q = browseQuery.trim().toLowerCase()
  const filteredBrowse = q
    ? browseRepos.filter(
        (r) =>
          r.repo.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q),
      )
    : browseRepos

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
              <Github size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Repositorios de GitHub
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                ARIA los lee para darte ideas de arreglo
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

        {/* Aviso de solo lectura + token */}
        <div className="px-4 py-3 space-y-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <ShieldCheck size={14} style={{ color: '#4ade80', flexShrink: 0, marginTop: 1 }} />
            <span>
              Solo lectura. ARIA puede leer repos, archivos e issues, pero <strong>nunca</strong> escribe,
              crea ni modifica nada en GitHub.
            </span>
          </div>
          {!tokenConfigured && (
            <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <AlertTriangle size={14} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
              <span>
                Sin <code>GITHUB_TOKEN</code> solo funcionan repos públicos (límite 60 peticiones/hora).
                Configura un token de solo lectura para subir a 5.000/hora, ver tus repos privados y
                listarlos aquí mismo.
              </span>
            </div>
          )}
        </div>

        {/* Alta */}
        <div className="px-4 py-3 flex flex-col gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs"
            style={inputStyle}
          >
            <Github size={12} style={{ color: 'var(--text-muted)' }} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
              placeholder="owner/repo o https://github.com/owner/repo"
              className="bg-transparent outline-none flex-1 text-xs"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
              placeholder="Nota opcional (p. ej. 'mi app principal')"
              className="px-2.5 py-1.5 rounded-xl text-xs flex-1 outline-none"
              style={inputStyle}
            />
            <button
              onClick={add}
              disabled={saving || !input.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid rgba(255,46,77,0.2)' }}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Agregar
            </button>
          </div>
          <button
            onClick={openBrowse}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition hover:opacity-80 w-full"
            style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <List size={12} />
            Ver mis repositorios de GitHub
          </button>
          {error && (
            <div className="text-xs" style={{ color: '#f87171' }}>
              {error}
            </div>
          )}
        </div>

        {/* Lista guardada / selector */}
        {browseOpen ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div
              className="px-4 py-2 flex items-center gap-2 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <button
                onClick={() => setBrowseOpen(false)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition hover:opacity-70"
                style={{ color: 'var(--text-secondary)', background: 'var(--surface-2)' }}
              >
                <ArrowLeft size={12} />
                Volver
              </button>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                Tus repositorios
              </span>
              {browseRepos.length > 0 && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  ({filteredBrowse.length})
                </span>
              )}
            </div>

            <div className="px-4 py-2 flex-shrink-0">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs" style={inputStyle}>
                <Search size={12} style={{ color: 'var(--text-muted)' }} />
                <input
                  value={browseQuery}
                  onChange={(e) => setBrowseQuery(e.target.value)}
                  placeholder="Buscar por nombre o descripción…"
                  className="bg-transparent outline-none flex-1 text-xs"
                  style={{ color: 'var(--text-primary)' }}
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
              {browseLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Loader2 size={14} className="animate-spin" />
                  Cargando tus repositorios…
                </div>
              ) : browseError ? (
                <div
                  className="rounded-xl p-3 text-xs flex items-start gap-2"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Lock size={14} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {browseError}{' '}
                    <a
                      href="https://github.com/settings/tokens?type=beta"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      Crear token
                    </a>
                  </span>
                </div>
              ) : filteredBrowse.length === 0 ? (
                <div className="text-center py-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {browseRepos.length === 0
                    ? 'No encontré repositorios con este token.'
                    : 'Ningún repositorio coincide con la búsqueda.'}
                </div>
              ) : (
                filteredBrowse.map((r) => (
                  <div
                    key={r.repo}
                    className="rounded-xl p-3 flex items-start gap-2"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {r.repo}
                        </span>
                        {r.private && (
                          <span
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs flex-shrink-0"
                            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: '0.65rem' }}
                          >
                            <Lock size={9} />
                            privado
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                          {r.description}
                        </div>
                      )}
                      {r.language && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {r.language}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => addFromBrowse(r.repo)}
                      disabled={saving}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition hover:opacity-80 disabled:opacity-40 flex-shrink-0"
                      style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                      title="Agregar a la lista de ARIA"
                    >
                      {addingRepo === r.repo ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Plus size={12} />
                      )}
                      Agregar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={14} className="animate-spin" />
                Cargando…
              </div>
            ) : repos.length === 0 ? (
              <div className="text-center py-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                Aún no agregaste repositorios.
                <br />
                Pega un <code>owner/repo</code> arriba, o usa «Ver mis repositorios».
              </div>
            ) : (
              repos.map((r) => (
                <div
                  key={r.repo}
                  className="rounded-xl p-3 flex items-start gap-2"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`https://github.com/${r.repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium truncate hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {r.repo}
                      </a>
                      <ExternalLink size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </div>
                    {r.note && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {r.note}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => remove(r.repo)}
                    disabled={busyRepo === r.repo}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                    style={{ color: '#f87171', background: 'var(--surface-1)' }}
                    title="Quitar de la lista"
                  >
                    {busyRepo === r.repo ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="px-4 py-3 text-xs flex-shrink-0" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          En el chat, pídele por ejemplo: «revisá este repo y decime cómo arreglar los bugs abiertos».
        </div>
      </aside>
    </div>
  )
}
