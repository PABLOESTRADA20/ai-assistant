'use client'

/**
 * Dictado por voz para el chat.
 *
 * Estrategia (de mejor a peor):
 *  1. Grabar con `MediaRecorder` y transcribir en el servidor (Groq Whisper).
 *     Funciona en Chrome, Edge, Firefox y Safari modernos, no depende de Google
 *     y la calidad es muy superior. Es el camino normal.
 *  2. Si el navegador no trae `MediaRecorder`/`getUserMedia`, se usa la Web
 *     Speech API como respaldo (lo que habia antes), solo en navegadores que la
 *     soporten.
 *
 * El texto se AÑADE al que ya hubiera en el input en vez de reemplazarlo: antes,
 * si escribias algo y pulsabas el microfono, el dictado borraba lo escrito.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/app/lib/auth-client'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

interface Options {
  /** Texto actual del input (para concatenar el dictado). */
  value: string
  /** Actualiza el input. */
  onChange: (value: string) => void
  /** Idioma del audio, ISO-639-1. Por defecto español. */
  language?: string
}

interface SpeechRecognitionResultLike {
  0: { transcript: string }
  length: number
  isFinal: boolean
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Primer formato de grabacion que soporte el navegador. */
function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((type) => {
    try {
      return typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)
    } catch {
      return false
    }
  })
}

export function useVoiceInput({ value, onChange, language = 'es' }: Options) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recorderSupported, setRecorderSupported] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)

  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    valueRef.current = value
  }, [value])
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    setRecorderSupported(
      typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function' &&
        typeof window.MediaRecorder !== 'undefined',
    )
    setSpeechSupported(
      typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    )
  }, [])

  const append = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    const base = valueRef.current.trim()
    onChangeRef.current(base ? `${base} ${clean}` : clean)
  }, [])

  const transcribe = useCallback(
    async (blob: Blob) => {
      const extension = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const form = new FormData()
      form.append('file', blob, `audio.${extension}`)
      form.append('language', language)

      const res = await apiFetch('/api/transcribe', { method: 'POST', body: form })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || `No se pudo transcribir el audio (${res.status})`)
      }
      const data = (await res.json()) as { text?: string }
      append(typeof data.text === 'string' ? data.text : '')
    },
    [append, language],
  )

  const startRecorder = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickAudioMime()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        // Menos de ~1 KB es un toque accidental: no merece una peticion.
        if (blob.size < 1200) {
          setState('idle')
          return
        }
        setState('transcribing')
        const run = async () => {
          try {
            await transcribe(blob)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al transcribir el audio.')
          } finally {
            setState('idle')
          }
        }
        void run()
      }

      recorder.start()
      recorderRef.current = recorder
      setState('recording')
    } catch {
      setError('No pude acceder al micrófono. Revisa los permisos del navegador.')
      setState('idle')
    }
  }, [transcribe])

  const startSpeech = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) return
    setError(null)

    const recognition = new Ctor()
    recognition.lang = language === 'es' ? 'es-ES' : language
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ')
      append(transcript)
    }
    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError('El dictado del navegador falló. Inténtalo de nuevo.')
      }
      setState('idle')
    }
    recognition.onend = () => setState('idle')

    recognitionRef.current = recognition
    recognition.start()
    setState('recording')
  }, [append, language])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      setState('idle')
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop()
      return
    }
    if (state !== 'idle') return
    if (recorderSupported) void startRecorder()
    else if (speechSupported) startSpeech()
  }, [state, recorderSupported, speechSupported, startRecorder, startSpeech, stop])

  // Limpieza si el componente se desmonta a mitad de grabacion.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      recognitionRef.current?.abort()
    }
  }, [])

  return {
    supported: recorderSupported || speechSupported,
    engine: recorderSupported ? 'server' : speechSupported ? 'browser' : 'none',
    state,
    error,
    clearError,
    toggle,
  } as const
}
