'use client'

import { useState, useRef, useCallback } from 'react'

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
    .slice(0, 800)
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  const stop = useCallback(() => {
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    async (text: string) => {
      stop()
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
    },
    [stop]
  )

  return { speak, stop, speaking, loading: false, error: null }
}
