// app/components/ChatInput.tsx
'use client'

import { useRef, useEffect, KeyboardEvent, useState, useCallback } from 'react'
import { Send, Square, Mic, MicOff } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  onStop?: () => void
  isLoading: boolean
  disabled?: boolean
}

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

export default function ChatInput({ value, onChange, onSubmit, onStop, isLoading, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)

  useEffect(() => {
    setSpeechSupported(
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    )
  }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [value])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!isLoading && value.trim()) onSubmit()
    }
  }

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.lang = 'es-ES'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join('')
      onChange(transcript)
    }

    recognition.onerror = () => {
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [onChange])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const toggleMic = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  return (
    <div
      className="relative flex items-end gap-3 rounded-2xl p-3 transition-all duration-200"
      style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        boxShadow: '0 0 0 0 transparent',
      }}
      onFocus={(e) => {
        const el = e.currentTarget
        el.style.border = '1px solid rgba(124,106,247,0.5)'
        el.style.boxShadow = '0 0 0 3px rgba(124,106,247,0.1)'
      }}
      onBlur={(e) => {
        const el = e.currentTarget
        el.style.border = '1px solid var(--border)'
        el.style.boxShadow = '0 0 0 0 transparent'
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isListening ? '🎤 Escuchando...' : 'Pregunta cualquier cosa… (Enter para enviar, Shift+Enter para nueva línea)'}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed py-1"
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-geist)',
          minHeight: '24px',
          maxHeight: '200px',
        }}
      />

      {/* Mic button */}
      {speechSupported && (
        <button
          onClick={toggleMic}
          disabled={isLoading || disabled}
          title={isListening ? 'Detener micrófono' : 'Hablar'}
          className={clsx(
            'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
            isListening
              ? 'text-red-400'
              : 'hover:opacity-80'
          )}
          style={{
            background: isListening
              ? 'rgba(239,68,68,0.15)'
              : 'var(--surface-3)',
            border: isListening ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
            animation: isListening ? 'pulse 1.5s infinite' : 'none',
          }}
        >
          {isListening ? <MicOff size={14} /> : <Mic size={14} style={{ color: 'var(--text-muted)' }} />}
        </button>
      )}

      {/* Send / Stop button */}
      <button
        onClick={isLoading ? onStop : onSubmit}
        disabled={!isLoading && (!value.trim() || disabled)}
        className={clsx(
          'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
          isLoading
            ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
            : value.trim() && !disabled
            ? 'hover:opacity-90 active:scale-95 text-white'
            : 'opacity-40 cursor-not-allowed text-white'
        )}
        style={
          !isLoading && value.trim() && !disabled
            ? { background: 'linear-gradient(135deg, #7c6af7, #6d5ce6)' }
            : isLoading
            ? {}
            : { background: 'var(--surface-3)' }
        }
      >
        {isLoading ? <Square size={14} fill="currentColor" /> : <Send size={14} />}
      </button>
    </div>
  )
}