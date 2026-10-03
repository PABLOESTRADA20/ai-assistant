'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Menu, RefreshCw, Download, Volume2, VolumeX, Github, X, FileText, MoreVertical } from 'lucide-react'

import Sidebar from './components/Sidebar'
import ChatContainer from './components/ChatContainer'
import ChatInput from './components/ChatInput'
import ModelSelector from './components/ModelSelector'
import MemoryInspector from './components/MemoryInspector'
import GithubRepos from './components/GithubRepos'
import NotesPanel from './components/NotesPanel'
import { useTTS } from './hooks/useTTS'

import { Message, Conversation, ToolInvocation, AVAILABLE_MODELS } from './types'
import { checkLocalAgent, openAppLocally, saveLocalToken } from './lib/local-agent'
import { streamChat, UnauthorizedError } from './lib/chat-client'
import {
  getConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  generateTitle,
} from './lib/store'
import LoginScreen from './components/LoginScreen'
import NeuralNetwork from './components/NeuralNetwork'
import AriaMark from './components/AriaMark'
import InstallButton from './components/InstallButton'
import {
  apiFetch,
  fetchAuthRequired,
  getToken,
  UNAUTHORIZED_EVENT,
} from './lib/auth-client'

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [authState, setAuthState] = useState<'checking' | 'needed' | 'ready'>('checking')
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingTools, setStreamingTools] = useState<ToolInvocation[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [localAgent, setLocalAgent] = useState<boolean | null>(null)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [githubOpen, setGithubOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [rescueVisible, setRescueVisible] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  // Voz de salida (TTS). `prime` desbloquea la síntesis en iOS durante un gesto.
  const { speak, stop: stopSpeech, prime } = useTTS()

  // Comprobar si la app pide clave y, si hay una guardada, validarla antes de
  // cargar nada. Evita mostrar conversaciones o lanzar peticiones a ciegas.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const required = await fetchAuthRequired()
      if (cancelled) return
      if (!required) {
        setAuthState('ready')
        return
      }
      if (!getToken()) {
        setAuthState('needed')
        return
      }
      try {
        const res = await apiFetch('/api/conversations')
        if (cancelled) return
        setAuthState(res.ok ? 'ready' : 'needed')
      } catch {
        // Sin red no se puede validar ahora: dejamos entrar y que las peticiones
        // posteriores decidan (un 401 devuelve al login).
        if (!cancelled) setAuthState('ready')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Si una peticion posterior recibe 401, volver al login.
  useEffect(() => {
    const onUnauthorized = () => setAuthState('needed')
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // Load conversations from API once authenticated
  useEffect(() => {
    if (authState !== 'ready') return

    getConversations()
      .then((stored) => {
        setConversations(stored)
        if (stored.length > 0) {
          setActiveId((prev) => prev ?? stored[0].id)
        }
      })
      .catch(() => {
        // Si falla, igual dejamos entrar en vez de quedar cargando para siempre.
      })
      .finally(() => setInitialLoading(false))

    // Pre-index the Obsidian vault on startup (best-effort)
    apiFetch('/api/vault/index', { method: 'GET' }).catch(() => {})
  }, [authState])

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // Cerrar el menú móvil del header al tocar fuera de él.
  useEffect(() => {
    if (!headerMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [headerMenuOpen])

  // Si el arranque se demora demasiado (p. ej. un service worker viejo dejó la
  // app a medio cargar), ofrecemos una salida que limpia y recarga.
  useEffect(() => {
    const t = setTimeout(() => setRescueVisible(true), 8000)
    return () => clearTimeout(t)
  }, [])

  // Red de seguridad: pase lo que pase, no quedarse atascado en la pantalla de
  // carga. Si a los 12 s seguimos arrancando, entramos igual; las peticiones
  // posteriores resolverán la sesión (un 401 devuelve al login).
  useEffect(() => {
    const t = setTimeout(() => {
      setInitialLoading(false)
      setAuthState((s) => (s === 'checking' ? (getToken() ? 'ready' : 'needed') : s))
    }, 12_000)
    return () => clearTimeout(t)
  }, [])

  // Marca de "la app ya arrancó" para el aviso de emergencia del HTML. Si está,
  // ocultamos ese aviso por si había aparecido mientras cargaba.
  useEffect(() => {
    if (authState === 'checking' || initialLoading) return
    ;(window as Window & { __ariaBooted?: boolean }).__ariaBooted = true
    const el = document.getElementById('aria-boot-fallback')
    if (el) el.style.display = 'none'
  }, [authState, initialLoading])

  // Preferencia de voz: persistente entre recargas.
  useEffect(() => {
    setAutoSpeak(localStorage.getItem('aria_autospeak') === '1')
  }, [])
  useEffect(() => {
    localStorage.setItem('aria_autospeak', autoSpeak ? '1' : '0')
  }, [autoSpeak])

  // Aviso de auto-cambio de modelo: se oculta solo a los pocos segundos.
  useEffect(() => {
    if (!modelNotice) return
    const id = setTimeout(() => setModelNotice(null), 9000)
    return () => clearTimeout(id)
  }, [modelNotice])

  // Detectar si el agente local está corriendo (para abrir apps en el PC).
  // Se revalida cada 30 s por si el usuario lo arranca o lo cierra.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const ok = await checkLocalAgent()
      if (!cancelled) setLocalAgent(ok)
    }
    check()
    const id = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // `open_app` lo ejecuta el navegador contra el agente local, no el servidor.
  const runLocalTool = useCallback(async (tool: ToolInvocation, events: ToolInvocation[]) => {
    if (tool.name !== 'open_app') return
    const app = typeof tool.args.app === 'string' ? tool.args.app : ''
    const target = typeof tool.args.args === 'string' ? tool.args.args : undefined

    let result = await openAppLocally(app, target)

    // El agente pide un token que la app aún no tiene: se lo pedimos una vez y
    // lo guardamos en el navegador (sin recompilar).
    if (!result.ok && result.needsToken && typeof window !== 'undefined') {
      const token = window.prompt('El agente local exige un token. Pega el ARIA_LOCAL_TOKEN:')
      if (token?.trim()) {
        saveLocalToken(token)
        result = await openAppLocally(app, target)
      }
    }

    tool.result = result.message
    tool.status = result.ok ? 'done' : 'error'
    setStreamingTools([...events])
  }, [])

  const activeConversation = conversations.find((c) => c.id === activeId) || null

  const handleNew = useCallback(async () => {
    try {
      const conv = await createConversation(model)
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setInput('')
      setSidebarOpen(false)
    } catch (err) {
      console.error('Error creating conversation:', err)
    }
  }, [model])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
    setInput('')
    setSidebarOpen(false)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('¿Eliminar esta conversación?')) return
    try {
      await deleteConversation(id)
      setConversations((prev) => {
        const updated = prev.filter((c) => c.id !== id)
        return updated
      })
      setActiveId((prev) => (prev === id ? null : prev))
    } catch (err) {
      console.error('Error deleting conversation:', err)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleNew()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleNew])

  const handleSubmit = useCallback(async () => {
    const content = input.trim()
    if (!content || isLoading) return
    // Gesto del usuario (clic/Enter) → desbloquea la voz en iOS antes del fetch.
    if (autoSpeak) prime()

    let convId = activeId
    let existingMessages: Message[] = []
    let conv = conversations.find((c) => c.id === convId)
    if (!conv) {
      try {
        const newConv = await createConversation(model)
        setConversations((prev) => [newConv, ...prev])
        convId = newConv.id
        setActiveId(convId)
        conv = newConv
      } catch {
        return
      }
    }
    existingMessages = conv.messages

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date(),
    }

    const isFirst = existingMessages.length === 0
    const updatedMessages = [...existingMessages, userMessage]

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          title: isFirst ? generateTitle(content) : c.title,
          messages: updatedMessages,
          updatedAt: new Date(),
        }
      })
    )
    setInput('')
    setIsLoading(true)
    setStreamingContent('')
    setStreamingTools([])

    const apiMessages = updatedMessages.map((m) => ({ role: m.role, content: m.content }))

    try {
      abortRef.current = new AbortController()

      const result = await streamChat({
        messages: apiMessages,
        model,
        conversationId: convId ?? undefined,
        signal: abortRef.current.signal,
        onContent: setStreamingContent,
        onTool: (tool, all) => {
          setStreamingTools([...all])
          void runLocalTool(tool, all)
        },
        onFallback: (from, to, reason) => {
          const fromName = AVAILABLE_MODELS.find((m) => m.id === from)?.name ?? from
          const toName = AVAILABLE_MODELS.find((m) => m.id === to)?.name ?? to
          setModelNotice(
            reason === 'no_tools'
              ? `🔄 ${fromName} no ejecuta herramientas. Pasé a ${toName} para poder hacerlo.`
              : `🔄 ${fromName} se quedó sin cuota. Pasé a ${toName}.`,
          )
        },
      })

      if (result.switchedFrom) setModel(result.model)

      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: result.content,
        createdAt: new Date(),
        model: result.model,
        tools: result.tools.length > 0 ? result.tools : undefined,
      }

      const finalMessages = [...updatedMessages, assistantMessage]
      try {
        const updated = await updateConversation(convId!, {
          messages: finalMessages,
          model: result.model,
        })
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? updated : c))
        )
      } catch {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c
            return { ...c, messages: finalMessages, updatedAt: new Date() }
          })
        )
      }

      // Voz: se lee la respuesta final (no el streaming, que sería entrecortado).
      if (autoSpeak && result.content.trim()) speak(result.content)
    } catch (err: unknown) {
      // 401: apiFetch ya limpió el token y la app volvió al login.
      if (err instanceof UnauthorizedError) return
      if (err instanceof Error && err.name === 'AbortError') {
        if (streamingContent || streamingTools.length > 0) {
          const partialMessage: Message = {
            id: uuidv4(),
            role: 'assistant',
            content: streamingContent,
            createdAt: new Date(),
            model,
            tools: streamingTools.length > 0 ? streamingTools : undefined,
          }
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== convId) return c
              return {
                ...c,
                messages: [...c.messages, partialMessage],
                updatedAt: new Date(),
              }
            })
          )
        }
        return
      }

      const errorMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: `⚠️ **Error**: ${err instanceof Error ? err.message : 'No se pudo conectar con la API. Verifica tu GROQ_API_KEY en el archivo .env.local'}`,
        createdAt: new Date(),
      }
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c
          return { ...c, messages: [...c.messages, errorMessage], updatedAt: new Date() }
        })
      )
    } finally {
      setIsLoading(false)
      setStreamingContent('')
      setStreamingTools([])
      abortRef.current = null
    }
  }, [input, isLoading, activeId, conversations, model, streamingContent, streamingTools, runLocalTool, autoSpeak, prime, speak])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!activeConversation || isLoading) return
    const msgs = activeConversation.messages
    if (msgs.length < 2) return
    if (autoSpeak) prime()

    const trimmed = msgs.slice(0, -1)
    const convId = activeConversation.id

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        return { ...c, messages: trimmed, updatedAt: new Date() }
      })
    )

    const lastUser = trimmed[trimmed.length - 1]
    if (!lastUser) return

    setIsLoading(true)
    setStreamingContent('')
    setStreamingTools([])

    const apiMessages = trimmed.map((m) => ({ role: m.role, content: m.content }))

    try {
      abortRef.current = new AbortController()
      const result = await streamChat({
        messages: apiMessages,
        model: activeConversation.model,
        conversationId: convId,
        signal: abortRef.current.signal,
        onContent: setStreamingContent,
        onTool: (tool, all) => {
          setStreamingTools([...all])
          void runLocalTool(tool, all)
        },
        onFallback: (from, to, reason) => {
          const fromName = AVAILABLE_MODELS.find((m) => m.id === from)?.name ?? from
          const toName = AVAILABLE_MODELS.find((m) => m.id === to)?.name ?? to
          setModelNotice(
            reason === 'no_tools'
              ? `🔄 ${fromName} no ejecuta herramientas. Pasé a ${toName} para poder hacerlo.`
              : `🔄 ${fromName} se quedó sin cuota. Pasé a ${toName}.`,
          )
        },
      })

      if (result.switchedFrom) setModel(result.model)

      const assistantMessage: Message = {
        id: uuidv4(), role: 'assistant', content: result.content, createdAt: new Date(), model: result.model,
        tools: result.tools.length > 0 ? result.tools : undefined,
      }

      const finalMessages = [...trimmed, assistantMessage]
      try {
        const updated = await updateConversation(convId, { messages: finalMessages, model: result.model })
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? updated : c))
        )
      } catch {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c
            return { ...c, messages: finalMessages, updatedAt: new Date() }
          })
        )
      }

      if (autoSpeak && result.content.trim()) speak(result.content)
    } catch (err) {
      if (err instanceof UnauthorizedError) return
      if (err instanceof Error && err.name !== 'AbortError') console.error(err)
    } finally {
      setIsLoading(false)
      setStreamingContent('')
      setStreamingTools([])
    }
  }, [activeConversation, isLoading, runLocalTool, autoSpeak, prime, speak])

  const handleSuggestion = (text: string) => {
    setInput(text)
  }

  const toggleAutoSpeak = useCallback(() => {
    const next = !autoSpeak
    setAutoSpeak(next)
    if (next) prime()
    else stopSpeech()
  }, [autoSpeak, prime, stopSpeech])

  const handleExportMarkdown = () => {
    if (!activeConversation) return
    const { title, messages, model } = activeConversation

    const lines: string[] = []
    lines.push(`# ${title}`)
    lines.push('')
    lines.push(`- **Conversación con ARIA** — Modelo: \`${model}\``)
    lines.push(`- **Exportada:** ${new Date().toLocaleString('es-ES')}`)
    lines.push(`- **Mensajes:** ${messages.length}`)
    lines.push('')
    lines.push('---')
    lines.push('')

    for (const msg of messages) {
      const author = msg.role === 'user' ? '## 👤 Usuario' : '## 🤖 ARIA'
      lines.push(author)
      lines.push('')
      if (msg.tools && msg.tools.length > 0) {
        lines.push('### Herramientas usadas')
        lines.push('')
        for (const tool of msg.tools) {
          lines.push(`- **${tool.name}** (${tool.status})`)
          lines.push(`  - Args: \`${JSON.stringify(tool.args)}\``)
          if (tool.result) {
            lines.push(`  - Resultado: \`${tool.result.slice(0, 300)}${tool.result.length > 300 ? '…' : ''}\``)
          }
        }
        lines.push('')
      }
      lines.push(msg.content)
      lines.push('')
    }

    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || 'conversacion'
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ARIA-${safeTitle}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // Salida de emergencia: desregistra el service worker, borra cachés y recarga.
  const hardReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      // Aunque algo falle, recargamos igual.
    }
    window.location.reload()
  }

  if (authState === 'checking' || (authState === 'ready' && initialLoading)) {
    return (
      <div className="relative flex h-dvh items-center justify-center" style={{ background: 'var(--app-bg)' }}>
        <NeuralNetwork opacity={0.35} />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div
            className="flex items-center justify-center rounded-2xl"
            style={{
              width: 56,
              height: 56,
              background: 'radial-gradient(circle at 50% 40%, rgba(255,46,77,0.25), transparent 70%)',
              border: '1px solid rgba(255,46,77,0.3)',
              animation: 'pulse 1.8s ease-in-out infinite',
            }}
          >
            <AriaMark size={34} />
          </div>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando conversaciones...</span>
          {rescueVisible && (
            <button
              onClick={hardReset}
              className="mt-2 text-xs px-3 py-1.5 rounded-xl transition hover:opacity-80 cursor-pointer"
              style={{
                color: 'var(--accent)',
                background: 'var(--accent-muted)',
                border: '1px solid rgba(255,46,77,0.3)',
              }}
            >
              ¿Tarda mucho? Recargar y limpiar caché
            </button>
          )}
        </div>
      </div>
    )
  }

  if (authState === 'needed') {
    return <LoginScreen onSuccess={() => setAuthState('ready')} />
  }

  // Acciones secundarias del header. En pantallas grandes se ven como botones;
  // en móvil van dentro del menú "⋮" para que el header no se amontone.
  const headerActions = [
    {
      key: 'agent',
      label: 'Agente local',
      title: localAgent
        ? 'Agente local conectado: ARIA puede abrir apps en tu PC'
        : 'Agente local desconectado: ARIA no puede abrir apps en tu PC. Arráncalo con: node local-agent/aria-local-agent.mjs',
      icon: <span className="w-1.5 h-1.5 rounded-full" style={{ background: localAgent ? '#34d399' : '#6b7280' }} />,
      onClick: async () => setLocalAgent(await checkLocalAgent()),
      active: false,
      disabled: false,
    },
    {
      key: 'voice',
      label: 'Voz',
      title: autoSpeak ? 'Voz activada: ARIA lee sus respuestas en voz alta' : 'Leer las respuestas en voz alta',
      icon: autoSpeak ? <Volume2 size={14} /> : <VolumeX size={14} />,
      onClick: toggleAutoSpeak,
      active: autoSpeak,
      disabled: false,
    },
    ...(activeConversation && activeConversation.messages.length >= 2
      ? [
          {
            key: 'regen',
            label: 'Regenerar',
            title: 'Volver a generar la última respuesta',
            icon: <RefreshCw size={14} />,
            onClick: handleRegenerate,
            active: false,
            disabled: isLoading,
          },
        ]
      : []),
    ...(activeConversation && activeConversation.messages.length > 0
      ? [
          {
            key: 'export',
            label: 'Exportar',
            title: 'Exportar conversación a Markdown',
            icon: <Download size={14} />,
            onClick: handleExportMarkdown,
            active: false,
            disabled: false,
          },
        ]
      : []),
    {
      key: 'github',
      label: 'GitHub',
      title: 'Repositorios de GitHub que ARIA puede leer y revisar',
      icon: <Github size={14} />,
      onClick: () => setGithubOpen(true),
      active: false,
      disabled: false,
    },
    {
      key: 'notes',
      label: 'Notas',
      title: 'Carpeta ARIA: notas guardadas en la nube, exportables a Obsidian',
      icon: <FileText size={14} />,
      onClick: () => setNotesOpen(true),
      active: false,
      disabled: false,
    },
  ]

  return (
    <div className="relative flex h-dvh overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      <NeuralNetwork opacity={0.4} />
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenMemory={() => setMemoryOpen(true)}
      />

      <MemoryInspector open={memoryOpen} onClose={() => setMemoryOpen(false)} />

      <GithubRepos open={githubOpen} onClose={() => setGithubOpen(false)} />

      <NotesPanel open={notesOpen} onClose={() => setNotesOpen(false)} />

      <div className="relative z-10 flex flex-col flex-1 min-w-0 h-full">
        <header
          className="flex items-center justify-between gap-2 px-4 py-3 flex-shrink-0 safe-top"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-8 h-8 flex items-center justify-center rounded-xl hover:opacity-70 transition cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Menu size={16} />
            </button>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
              {activeConversation?.title || 'ARIA — AI Assistant'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* Acciones secundarias: visibles desde md; en móvil van al menú ⋮. */}
            <div className="hidden md:flex items-center gap-2">
              {headerActions.map((a) => (
                <button
                  key={a.key}
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.title}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition hover:opacity-70 disabled:opacity-40"
                  style={{
                    color: a.active ? 'var(--accent)' : 'var(--text-muted)',
                    background: a.active ? 'var(--accent-muted)' : 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {a.icon}
                  <span className="hidden lg:inline">{a.label}</span>
                </button>
              ))}
            </div>

            <ModelSelector value={model} onChange={setModel} />
            <InstallButton />

            <div ref={headerMenuRef} className="relative md:hidden">
              <button
                onClick={() => setHeaderMenuOpen((o) => !o)}
                aria-label="Más opciones"
                aria-expanded={headerMenuOpen}
                className="w-8 h-8 flex items-center justify-center rounded-xl transition hover:opacity-70"
                style={{
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                }}
              >
                <MoreVertical size={15} />
              </button>
              {headerMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 rounded-2xl p-1.5 z-[70] animate-fade-in"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                  }}
                >
                  {headerActions.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => {
                        setHeaderMenuOpen(false)
                        a.onClick()
                      }}
                      disabled={a.disabled}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition hover:opacity-80 disabled:opacity-40"
                      style={{
                        color: a.active ? 'var(--accent)' : 'var(--text-primary)',
                        background: a.active ? 'var(--accent-muted)' : 'transparent',
                      }}
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {modelNotice && (
          <div
            className="flex items-center gap-2 px-4 py-2 text-xs flex-shrink-0"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span className="flex-1">{modelNotice}</span>
            <button
              onClick={() => setModelNotice(null)}
              className="hover:opacity-70"
              aria-label="Cerrar aviso"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <ChatContainer
          messages={activeConversation?.messages || []}
          isLoading={isLoading}
          streamingContent={streamingContent}
          streamingTools={streamingTools}
          currentModel={model}
          onSuggestion={handleSuggestion}
        />

        <div
          className="flex-shrink-0 px-4 pt-3 safe-bottom"
          style={{ background: 'var(--surface-1)', borderTop: '1px solid var(--border)' }}
        >
          <div className="max-w-3xl mx-auto">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={handleStop}
              isLoading={isLoading}
            />
            <p className="text-center text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              ARIA puede cometer errores. Verifica información importante.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
