// app/components/MessageBubble.tsx
'use client'

import { useState, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, User, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { Message } from '@/app/types'
import clsx from 'clsx'

interface Props {
  message: Message
  isStreaming?: boolean
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all duration-200"
      style={{
        color: copied ? '#4ade80' : 'var(--text-muted)',
        background: copied ? 'rgba(74,222,128,0.1)' : 'var(--surface-3)',
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="rounded-xl overflow-hidden my-3" style={{ border: '1px solid var(--border)' }}>
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {language || 'code'}
        </span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.8125rem',
          lineHeight: '1.6',
          background: 'var(--surface-0)',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// Strip markdown for TTS (reads cleaner without symbols)
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, 'bloque de código.')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .trim()
    .slice(0, 800) // limit length for faster generation
}

// ── Web Speech API TTS ──────────────────────────────────────────────────────
function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const stop = useCallback(() => {
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const handleSpeak = useCallback(() => {
    if (speaking) { stop(); return }
    const clean = stripMarkdown(text)
    if (!clean) return
    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.lang = 'es-ES'
    utterance.rate = 1.1
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }, [text, speaking, stop])

  if (!speechSupported) return null

  return (
    <button
      onClick={handleSpeak}
      title={speaking ? 'Detener lectura' : 'Leer en voz alta'}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-all duration-200"
      style={{
        color: speaking ? 'var(--accent)' : 'var(--text-muted)',
        background: speaking ? 'var(--accent-muted)' : 'transparent',
      }}
    >
      {speaking ? <VolumeX size={11} /> : <Volume2 size={11} />}
      {speaking ? 'Detener' : 'Escuchar'}
    </button>
  )
}
// ────────────────────────────────────────────────────────────────────────────

export default function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={clsx(
        'flex gap-3 w-full animate-slide-up',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
        style={{
          background: isUser
            ? 'linear-gradient(135deg, #7c6af7, #a78bfa)'
            : 'linear-gradient(135deg, #1a1a2e, #2d2b52)',
          border: isUser ? 'none' : '1px solid var(--border)',
        }}
      >
        {isUser ? (
          <User size={14} style={{ color: '#fff' }} />
        ) : (
          <Sparkles size={14} style={{ color: 'var(--accent)' }} />
        )}
      </div>

      {/* Content */}
      <div className={clsx('flex flex-col gap-1 max-w-[85%]', isUser && 'items-end')}>
        <span className="text-xs font-medium px-1" style={{ color: 'var(--text-muted)' }}>
          {isUser ? 'Tú' : 'ARIA'}
          {message.model && !isUser && (
            <span
              className="ml-2 px-1.5 py-0.5 rounded text-xs"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: '0.65rem' }}
            >
              {message.model}
            </span>
          )}
        </span>

        <div
          className={clsx('rounded-2xl px-4 py-3 text-sm leading-relaxed', isUser && 'rounded-tr-sm')}
          style={
            isUser
              ? {
                  background: 'linear-gradient(135deg, #7c6af7, #6d5ce6)',
                  color: '#fff',
                }
              : {
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderTopLeftRadius: '4px',
                }
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const code = String(children).replace(/\n$/, '')
                    const isBlock = code.includes('\n') || (match && match[1])

                    if (isBlock) {
                      return <CodeBlock language={match?.[1] || ''} code={code} />
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    )
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
              {isStreaming && <span className="cursor-blink" />}
            </div>
          )}
        </div>

        {/* Action buttons for assistant messages */}
        {!isUser && !isStreaming && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={handleCopyMessage}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-all duration-200"
              style={{ color: copied ? '#4ade80' : 'var(--text-muted)' }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <SpeakButton text={message.content} />
          </div>
        )}
      </div>

    </div>
  )
}