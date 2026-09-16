// app/components/ChatContainer.tsx
'use client'

import { useRef, useEffect } from 'react'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'
import WelcomeScreen from './WelcomeScreen'
import { Message, ToolInvocation } from '@/app/types'

interface Props {
  messages: Message[]
  isLoading: boolean
  streamingContent: string
  streamingTools: ToolInvocation[]
  currentModel: string
  onSuggestion: (text: string) => void
}

export default function ChatContainer({
  messages,
  isLoading,
  streamingContent,
  streamingTools,
  currentModel,
  onSuggestion,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, isLoading])

  const isEmpty = messages.length === 0 && !isLoading

  if (isEmpty) {
    return <WelcomeScreen onPrompt={onSuggestion} />
  }

  // Build display messages — inject streaming message if active
  const streamingMessage: Message | null =
    streamingContent || streamingTools.length > 0
      ? {
          id: '__streaming__',
          role: 'assistant',
          content: streamingContent,
          createdAt: new Date(),
          model: currentModel,
          tools: streamingTools.length > 0 ? streamingTools : undefined,
        }
      : null

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streamingMessage && (
          <MessageBubble message={streamingMessage} isStreaming />
        )}

        {isLoading && !streamingContent && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
