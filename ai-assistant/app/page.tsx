// app/page.tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Menu, RefreshCw } from 'lucide-react'

import Sidebar from './components/Sidebar'
import ChatContainer from './components/ChatContainer'
import ChatInput from './components/ChatInput'
import ModelSelector from './components/ModelSelector'

import { Message, Conversation } from './types'
import {
  getConversations,
  saveConversations,
  createConversation,
  generateTitle,
} from './lib/store'

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [model, setModel] = useState('llama-3.3-70b-versatile')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const abortRef = useRef<AbortController | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = getConversations()
    setConversations(stored)
  }, [])

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  const activeConversation = conversations.find((c) => c.id === activeId) || null

  const updateConversations = useCallback((updated: Conversation[]) => {
    setConversations(updated)
    saveConversations(updated)
  }, [])

  const handleNew = useCallback(() => {
    const conv = createConversation(model)
    updateConversations([conv, ...conversations])
    setActiveId(conv.id)
    setInput('')
    setSidebarOpen(false)
  }, [conversations, model, updateConversations])

  const handleSelect = useCallback((id: string) => {
    setActiveId(id)
    setInput('')
    setSidebarOpen(false)
  }, [])

  const handleDelete = useCallback((id: string) => {
    const updated = conversations.filter((c) => c.id !== id)
    updateConversations(updated)
    if (activeId === id) {
      setActiveId(updated[0]?.id || null)
    }
  }, [conversations, activeId, updateConversations])

  const handleSubmit = useCallback(async () => {
    const content = input.trim()
    if (!content || isLoading) return

    // Create/ensure conversation
    let convId = activeId
    let currentConvs = [...conversations]
    if (!convId || !currentConvs.find((c) => c.id === convId)) {
      const newConv = createConversation(model)
      convId = newConv.id
      currentConvs = [newConv, ...currentConvs]
      setActiveId(convId)
    }

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date(),
    }

    // Add user message to conversation
    let updatedConvs = currentConvs.map((c) => {
      if (c.id !== convId) return c
      const isFirst = c.messages.length === 0
      return {
        ...c,
        title: isFirst ? generateTitle(content) : c.title,
        messages: [...c.messages, userMessage],
        updatedAt: new Date(),
      }
    })

    updateConversations(updatedConvs)
    setInput('')
    setIsLoading(true)
    setStreamingContent('')

    // Build API messages from conversation history
    const conv = updatedConvs.find((c) => c.id === convId)!
    const apiMessages = conv.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      abortRef.current = new AbortController()

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error en la API')
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

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
              if (parsed.content) {
                accumulated += parsed.content
                setStreamingContent(accumulated)
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: accumulated,
        createdAt: new Date(),
        model,
      }

      updatedConvs = updatedConvs.map((c) => {
        if (c.id !== convId) return c
        return {
          ...c,
          messages: [...c.messages, assistantMessage],
          updatedAt: new Date(),
        }
      })

      updateConversations(updatedConvs)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return

      const errorMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: `⚠️ **Error**: ${err instanceof Error ? err.message : 'No se pudo conectar con la API. Verifica tu GROQ_API_KEY en el archivo .env.local'}`,
        createdAt: new Date(),
      }

      updatedConvs = updatedConvs.map((c) => {
        if (c.id !== convId) return c
        return { ...c, messages: [...c.messages, errorMessage], updatedAt: new Date() }
      })
      updateConversations(updatedConvs)
    } finally {
      setIsLoading(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [input, isLoading, activeId, conversations, model, updateConversations])

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleRegenerate = useCallback(async () => {
    if (!activeConversation || isLoading) return
    const msgs = activeConversation.messages
    if (msgs.length < 2) return

    // Remove last assistant message
    const trimmed = msgs.slice(0, -1)
    const updatedConvs = conversations.map((c) => {
      if (c.id !== activeId) return c
      return { ...c, messages: trimmed, updatedAt: new Date() }
    })
    updateConversations(updatedConvs)

    // Re-trigger with last user message as "input"
    const lastUser = trimmed[trimmed.length - 1]
    if (!lastUser) return

    setIsLoading(true)
    setStreamingContent('')

    const apiMessages = trimmed.map((m) => ({ role: m.role, content: m.content }))

    try {
      abortRef.current = new AbortController()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: activeConversation.model }),
        signal: abortRef.current.signal,
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

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
              if (parsed.content) { accumulated += parsed.content; setStreamingContent(accumulated) }
            } catch { /* skip */ }
          }
        }
      }

      const assistantMessage: Message = {
        id: uuidv4(), role: 'assistant', content: accumulated, createdAt: new Date(), model: activeConversation.model,
      }

      updateConversations(updatedConvs.map((c) => {
        if (c.id !== activeId) return c
        return { ...c, messages: [...trimmed, assistantMessage], updatedAt: new Date() }
      }))
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') console.error(err)
    } finally {
      setIsLoading(false)
      setStreamingContent('')
    }
  }, [activeConversation, isLoading, conversations, activeId, model, updateConversations])

  const handleSuggestion = (text: string) => {
    setInput(text)
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

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Top bar */}
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
            <ModelSelector value={model} onChange={setModel} />
          </div>
        </header>

        {/* Chat area */}
        <ChatContainer
          messages={activeConversation?.messages || []}
          isLoading={isLoading}
          streamingContent={streamingContent}
          currentModel={model}
          onSuggestion={handleSuggestion}
        />

        {/* Input area */}
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
