'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Menu, RefreshCw, Download } from 'lucide-react'

import Sidebar from './components/Sidebar'
import ChatContainer from './components/ChatContainer'
import ChatInput from './components/ChatInput'
import ModelSelector from './components/ModelSelector'

import { Message, Conversation, ToolInvocation } from './types'
import {
  getConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  generateTitle,
} from './lib/store'

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingTools, setStreamingTools] = useState<ToolInvocation[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [model, setModel] = useState('llama-3.3-70b-versatile')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const abortRef = useRef<AbortController | null>(null)

  // Load conversations from API
  useEffect(() => {
    getConversations().then((stored) => {
      setConversations(stored)
      if (stored.length > 0) {
        setActiveId(stored[0].id)
      }
      setInitialLoading(false)
    })

    // Pre-index the Obsidian vault on startup (best-effort)
    fetch('/api/vault/index', { method: 'GET' }).catch(() => {})
  }, [])

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

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

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model, conversationId: convId }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error en la API')
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      const toolEvents: ToolInvocation[] = []

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value)
          const lines = text.split('\n')

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'tool_call') {
                toolEvents.push({
                  name: parsed.tool?.name || '',
                  args: parsed.tool?.args || {},
                  result: parsed.tool?.result,
                  status: parsed.tool?.status === 'error' ? 'error' : 'done',
                })
                setStreamingTools([...toolEvents])
                continue
              }
              if (parsed.content) {
                accumulated += parsed.content
                setStreamingContent(accumulated)
              }
            } catch { /* skip malformed chunks */ }
          }
        }
      }

      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: accumulated,
        createdAt: new Date(),
        model,
        tools: toolEvents.length > 0 ? toolEvents : undefined,
      }

      const finalMessages = [...updatedMessages, assistantMessage]
      try {
        const updated = await updateConversation(convId!, { messages: finalMessages })
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
    } catch (err: unknown) {
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
  }, [input, isLoading, activeId, conversations, model, streamingContent, streamingTools])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!activeConversation || isLoading) return
    const msgs = activeConversation.messages
    if (msgs.length < 2) return

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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: activeConversation.model, conversationId: convId }),
        signal: abortRef.current.signal,
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      const toolEvents: ToolInvocation[] = []

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'tool_call') {
                toolEvents.push({
                  name: parsed.tool?.name || '',
                  args: parsed.tool?.args || {},
                  result: parsed.tool?.result,
                  status: parsed.tool?.status === 'error' ? 'error' : 'done',
                })
                setStreamingTools([...toolEvents])
                continue
              }
              if (parsed.content) { accumulated += parsed.content; setStreamingContent(accumulated) }
            } catch { /* skip */ }
          }
        }
      }

      const assistantMessage: Message = {
        id: uuidv4(), role: 'assistant', content: accumulated, createdAt: new Date(), model: activeConversation.model,
        tools: toolEvents.length > 0 ? toolEvents : undefined,
      }

      const finalMessages = [...trimmed, assistantMessage]
      try {
        const updated = await updateConversation(convId, { messages: finalMessages })
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
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') console.error(err)
    } finally {
      setIsLoading(false)
      setStreamingContent('')
      setStreamingTools([])
    }
  }, [activeConversation, isLoading])

  const handleSuggestion = (text: string) => {
    setInput(text)
  }

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

  if (initialLoading) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: 'var(--surface-0)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-xl" style={{ background: 'linear-gradient(135deg, #7c6af7, #6d5ce6)', animation: 'pulse 1.5s infinite' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando conversaciones...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--surface-0)' }}>
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
      />

      <div className="flex flex-col flex-1 min-w-0 h-full">
        <header
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-1)' }}
        >
          <div className="flex items-center gap-3">
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

          <div className="flex items-center gap-2">
            {activeConversation && activeConversation.messages.length >= 2 && (
              <button
                onClick={handleRegenerate}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition hover:opacity-70 disabled:opacity-40"
                style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <RefreshCw size={12} />
                Regenerar
              </button>
            )}
            {activeConversation && activeConversation.messages.length > 0 && (
              <button
                onClick={handleExportMarkdown}
                title="Exportar conversación a Markdown"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition hover:opacity-70"
                style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <Download size={12} />
                Exportar
              </button>
            )}
            <ModelSelector value={model} onChange={setModel} />
          </div>
        </header>

        <ChatContainer
          messages={activeConversation?.messages || []}
          isLoading={isLoading}
          streamingContent={streamingContent}
          streamingTools={streamingTools}
          currentModel={model}
          onSuggestion={handleSuggestion}
        />

        <div
          className="flex-shrink-0 px-4 pb-4 pt-3"
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
