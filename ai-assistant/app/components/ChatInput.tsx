// app/components/ChatInput.tsx
'use client'

import { useRef, useEffect, KeyboardEvent } from 'react'
import { Send, Square, Mic, MicOff, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { useVoiceInput } from '@/app/hooks/useVoiceInput'

interface Props {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  onStop?: () => void
  isLoading: boolean
  disabled?: boolean
}

export default function ChatInput({ value, onChange, onSubmit, onStop, isLoading, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { supported: voiceSupported, state: voiceState, error: voiceError, toggle: toggleMic } =
    useVoiceInput({ value, onChange })

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

  const isRecording = voiceState === 'recording'
  const isTranscribing = voiceState === 'transcribing'

  const placeholder = isTranscribing
    ? 'Transcribiendo el audio…'
    : isRecording
    ? 'Grabando… pulsa el micrófono para detener y transcribir'
    : 'Pregunta cualquier cosa… (Enter para enviar, Shift+Enter para nueva línea)'

  return (
    <div className="flex flex-col gap-2">
      {voiceError && (
        <div
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{
            background: 'rgba(239,68,68,0.12)',
            color: '#f87171',
            border: '1px solid rgba(239,68,68,0.25)',
          }}
        >
          {voiceError}
        </div>
      )}

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
          placeholder={placeholder}
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
        {voiceSupported && (
          <button
            onClick={toggleMic}
            disabled={isLoading || disabled || isTranscribing}
            title={isRecording ? 'Detener y transcribir' : 'Dictar por voz'}
            className={clsx(
              'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200',
              isRecording ? 'text-red-400' : 'hover:opacity-80'
            )}
            style={{
              background: isRecording ? 'rgba(239,68,68,0.15)' : 'var(--surface-3)',
              border: isRecording ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
              animation: isRecording ? 'pulse 1.5s infinite' : 'none',
            }}
          >
            {isTranscribing ? (
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            ) : isRecording ? (
              <MicOff size={14} />
            ) : (
              <Mic size={14} style={{ color: 'var(--text-muted)' }} />
            )}
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
    </div>
  )
}
