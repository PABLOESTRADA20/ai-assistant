'use client'

import { useState, useRef, useCallback } from 'react'

/**
 * Limpia el Markdown para que la síntesis de voz no lea asteriscos, backticks
 * ni bloques de código (los resume como "bloque de código"). Además recorta el
 * texto: leer una respuesta de 4.000 caracteres en voz alta es insufrible.
 */
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
    .slice(0, 1200)
}

/**
 * Elige la mejor voz en español disponible. `getVoices()` suele estar vacío en
 * la primera llamada (las voces cargan async), así que se consulta en cada
 * `speak`: para entonces el usuario ya interactuó y normalmente están listas.
 */
function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const spanish = voices.filter((v) => /^es/i.test(v.lang))
  return spanish.find((v) => /es-(ES|MX|US|AR|CO|CL|PE)/i.test(v.lang)) || spanish[0] || null
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  /**
   * iOS/Safari exige un gesto del usuario para arrancar la síntesis. Como la
   * respuesta llega después de un `fetch`, el gesto ya se perdió y el primer
   * audio puede quedar bloqueado. `prime()` se llama en el clic del botón de
   * voz y deja el motor "desbloqueado" para las respuestas posteriores.
   */
  const prime = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.resume()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      window.speechSynthesis.speak(u)
    } catch {
      /* algunos navegadores lo rechazan; no es crítico */
    }
  }, [])

  const speak = useCallback(
    async (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
      stop()
      const clean = stripMarkdown(text)
      if (!clean) return
      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.lang = 'es-ES'
      utterance.rate = 1.05
      const voice = pickSpanishVoice()
      if (voice) utterance.voice = voice
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      utteranceRef.current = utterance
      try {
        window.speechSynthesis.speak(utterance)
        setSpeaking(true)
      } catch {
        setSpeaking(false)
      }
    },
    [stop]
  )

  return { speak, stop, prime, speaking, loading: false, error: null }
}
