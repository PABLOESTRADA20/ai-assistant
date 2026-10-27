// app/components/ChatContainer.tsx
'use client'

import { useRef, useEffect, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'
import WelcomeScreen from './WelcomeScreen'
import { Message, ToolInvocation, SourceRef, ContextInfo } from '@/app/types'
import { contextUsagePercent, formatContextUsage } from '@/app/lib/context-info'

interface Props {
  messages: Message[]
  isLoading: boolean
  streamingContent: string
  streamingTools: ToolInvocation[]
  streamingSources: SourceRef[]
  streamingContext: ContextInfo | null
  currentModel: string
  onSuggestion: (text: string) => void
  /** Reintentar un turno fallido: recibe el id del mensaje de error. */
  onRetry: (messageId: string) => void
}

export default function ChatContainer({
  messages,
  isLoading,
  streamingContent,
  streamingTools,
  streamingSources,
  streamingContext,
  currentModel,
  onSuggestion,
  onRetry,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollButton(distanceToBottom > 200)
    }

    handleScroll()
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Auto-scroll solo si ya estamos cerca del final
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceToBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth' })
    }
  }, [messages, streamingContent, isLoading])

  const isEmpty = messages.length === 0 && !isLoading

  if (isEmpty) {
    return <WelcomeScreen onPrompt={onSuggestion} />
  }

  // Build display messages — inject streaming message if active
  const streamingMessage: Message | null =
    streamingContent || streamingTools.length > 0 || streamingSources.length > 0
      ? {
          id: '__streaming__',
          role: 'assistant',
          content: streamingContent,
          createdAt: new Date(),
          model: currentModel,
          tools: streamingTools.length > 0 ? streamingTools : undefined,
          sources: streamingSources.length > 0 ? streamingSources : undefined,
        }
      : null

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onRetry={() => onRetry(msg.id)} />
        ))}

        {streamingContext && (
          <div className="flex items-center gap-2 px-2" style={{ color: 'var(--text-muted)' }}>
            <span className="text-[10px] uppercase tracking-[0.12em]">{formatContextUsage(streamingContext)}</span>
            <div
              className="h-1 flex-1 max-w-[140px] rounded-full overflow-hidden"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(contextUsagePercent(streamingContext) * 100)}%`,
                  background: 'linear-gradient(90deg, #ff2e4d, #ff7a8c)',
                }}
              />
            </div>
            {streamingContext.summarizedCount > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] animate-fade-in"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
              >
                compactado ({streamingContext.summarizedCount})
              </span>
            )}
          </div>
        )}

        {streamingMessage && (
          <MessageBubble message={streamingMessage} isStreaming />
        )}

        {isLoading && !streamingContent && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-6 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110 animate-fade-in z-40"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
          aria-label="Bajar al final"
          title="Bajar al final"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  )
}
