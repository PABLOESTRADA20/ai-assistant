// app/components/WelcomeScreen.tsx
'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Code2, Brain, Zap, Volume2, VolumeX } from 'lucide-react'
import { useTTS } from '@/app/hooks/useTTS'

interface Props {
  onPrompt: (text: string) => void
}

const suggestions = [
  {
    icon: Code2,
    label: 'Código',
    text: 'Escribe una función en Python que implemente un árbol AVL con operaciones de inserción y búsqueda',
  },
  {
    icon: Brain,
    label: 'Explicación',
    text: '¿Cómo funciona la atención multi-cabeza (multi-head attention) en los transformers?',
  },
  {
    icon: Zap,
    label: 'Optimización',
    text: 'Revisa este código y sugiere mejoras de rendimiento: const data = arr.filter(x => x > 0).map(x => x * 2)',
  },
  {
    icon: Sparkles,
    label: 'Diseño',
    text: '¿Cuáles son los mejores patrones de diseño para una API REST escalable?',
  },
]

const WELCOME_TEXT =
  'Hello! I am ARIA, your advanced artificial intelligence assistant. I am here to help you with code, technical analysis, complex questions and much more. How can I help you today?'

export default function WelcomeScreen({ onPrompt }: Props) {
  const { speak, stop, speaking } = useTTS()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [])

  const handleToggle = () => {
    if (speaking) {
      stop()
    } else {
      speak(WELCOME_TEXT)
    }
  }

  const isActive = speaking

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-4 py-8 max-w-3xl mx-auto transition-all duration-700"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(12px)' }}
    >
      <div className="mb-6 flex flex-col items-center">
        <div className="relative mb-4">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #7c6af7, #6d5ce6)',
              opacity: isActive ? 0.4 : 0,
              transform: isActive ? 'scale(1.4)' : 'scale(1)',
              filter: 'blur(12px)',
              transition: 'all 0.4s ease',
            }}
          />
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center relative"
            style={{
              background: 'linear-gradient(135deg, #7c6af7 0%, #6d5ce6 100%)',
              boxShadow: isActive ? '0 8px 40px rgba(124,106,247,0.7)' : '0 8px 32px rgba(124,106,247,0.4)',
              transition: 'box-shadow 0.4s ease',
            }}
          >
            <Sparkles size={28} color="#fff" style={{ animation: speaking ? 'spin 3s linear infinite' : 'none' }} />
          </div>

          {isActive && (
            <div
              className="absolute -bottom-1 -right-1 flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-3)',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                fontSize: '0.6rem',
                fontWeight: 600,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
              hablando
            </div>
          )}
        </div>

        <h1
          className="text-3xl font-bold text-center tracking-tight"
          style={{
            background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Hola, soy ARIA
        </h1>

        <p className="text-center mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Tu asistente de IA avanzado. ¿En qué puedo ayudarte hoy?
        </p>

        <button
          onClick={handleToggle}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all duration-200 hover:opacity-80 cursor-pointer"
          style={{
            background: isActive ? 'var(--accent-muted)' : 'var(--surface-2)',
            border: `1px solid ${isActive ? 'rgba(124,106,247,0.4)' : 'var(--border)'}`,
            color: isActive ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {isActive ? <VolumeX size={11} /> : <Volume2 size={11} />}
          {speaking ? 'Silenciar' : 'Escuchar bienvenida'}
        </button>
      </div>

      {speaking && (
        <div className="flex items-center gap-1 mb-4" style={{ height: 24 }}>
          {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((h, i) => (
            <div key={i} style={{ width: 3, height: `${h * 4}px`, borderRadius: 2, background: 'var(--accent)', animation: `soundwave 0.8s ease-in-out infinite`, animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full mt-4">
        {suggestions.map((s, i) => {
          const Icon = s.icon
          return (
            <button
              key={i}
              onClick={() => onPrompt(s.text)}
              className="text-left p-4 rounded-2xl transition-all duration-200 cursor-pointer group hover:shadow-[0_4px_16px_rgba(124,106,247,0.15)] active:opacity-80"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(124,106,247,0.4)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-muted)' }}>
                  <Icon size={13} style={{ color: 'var(--accent)' }} />
                </div>
                <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{s.label}</span>
              </div>
              <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{s.text}</p>
            </button>
          )
        })}
      </div>

      <p className="mt-8 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
        Presiona <kbd className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>Enter</kbd> para enviar ·{' '}
        <kbd className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>Shift+Enter</kbd> para nueva línea
      </p>

      <style>{`
        @keyframes soundwave { 0%, 100% { transform: scaleY(1); opacity: 0.7; } 50% { transform: scaleY(2.2); opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  )
}