// app/hooks/useTTS.ts
'use client'

import { useState, useRef, useCallback } from 'react'

export function useTTS() {
  const [speaking, setSpeaking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    setSpeaking(false)
    setLoading(false)
    setError(null)
  }, [])

  const speak = useCallback(
    async (text: string) => {
      // Stop any current audio
      stop()

      // Strip markdown for cleaner speech
      const clean = text
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
        // Limit length to avoid very long generations
        .slice(0, 800)

      if (!clean || clean.length === 0) {
        setError('No hay contenido para reproducir')
        setTimeout(() => setError(null), 3000)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, voice: 'af_heart' }),
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Error al generar audio')
        }

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)

        const audio = new Audio(url)
        audioRef.current = audio

        audio.onplay = () => {
          setLoading(false)
          setSpeaking(true)
        }
        audio.onended = () => {
          setSpeaking(false)
          URL.revokeObjectURL(url)
        }
        audio.onerror = () => {
          setSpeaking(false)
          setLoading(false)
          setError('Error al reproducir audio')
          setTimeout(() => setError(null), 3000)
        }

        await audio.play()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
        console.error('TTS error:', err)
        setError(errorMessage)
        setLoading(false)
        setSpeaking(false)
        setTimeout(() => setError(null), 5000)
      }
    },
    [stop]
  )

  return { speak, stop, speaking, loading, error }
}