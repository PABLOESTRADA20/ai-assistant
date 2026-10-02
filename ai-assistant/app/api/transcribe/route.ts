import { NextRequest } from 'next/server'
import { requireAuth } from '@/app/lib/auth'
import { rateLimit } from '@/app/lib/rate-limit'

/**
 * Dictado por voz.
 *
 * Antes el boton de microfono solo funcionaba en navegadores con la Web Speech
 * API (practicamente Chrome) y dependia de los servidores de Google: en Firefox
 * el boton ni aparecia, y en Chrome falla a menudo. Aqui el audio se graba en el
 * navegador y se transcribe en el servidor, asi que funciona en cualquiera que
 * soporte MediaRecorder.
 *
 * Motor principal: Groq `whisper-large-v3-turbo`. Es la mejor opcion gratuita
 * para este proyecto porque:
 *   - ya usa la misma `GROQ_API_KEY` (no hay que registrar nada nuevo);
 *   - su tier gratis da 2.000 transcripciones al dia y 25 MB por audio;
 *   - es rapidisimo (hardware de Groq) y tiene gran precision en español.
 *
 * Fallback: Whisper en Cloudflare Workers AI (`AI` binding), que ya se usa para
 * los embeddings. Entra dentro de las 10.000 neuronas/dia gratis (~243 minutos
 * de audio) y solo se intenta si Groq falla, para que el dictado siga vivo si
 * se agota la cuota de audio de Groq.
 */

const GROQ_TRANSCRIBE = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'whisper-large-v3-turbo'
const CF_MODEL = '@cf/openai/whisper-large-v3-turbo'
const MAX_BYTES = 24 * 1024 * 1024 // Groq free tier: 25 MB; dejamos margen

type AudioFile = { arrayBuffer: () => Promise<ArrayBuffer>; name?: string; type?: string }

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const limited = await rateLimit(req, 'TRANSCRIBE_RATE_LIMITER')
  if (limited) return limited

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'GROQ_API_KEY no configurada', code: 'no_key' }, { status: 500 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json(
      { error: 'Se esperaba multipart/form-data con el audio', code: 'bad_request' },
      { status: 400 },
    )
  }

  const file = form.get('file') as unknown as AudioFile | null
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Falta el audio en el campo "file"', code: 'no_audio' }, { status: 400 })
  }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) {
    return Response.json({ error: 'El audio esta vacio', code: 'empty_audio' }, { status: 400 })
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json(
      { error: 'El audio es demasiado largo. Graba menos de ~2 minutos.', code: 'too_large' },
      { status: 413 },
    )
  }

  const language =
    typeof form.get('language') === 'string' ? String(form.get('language')).slice(0, 5) : 'es'

  // 1) Groq Whisper.
  try {
    const out = new FormData()
    out.append('file', new File([bytes], file.name || 'audio.webm', { type: file.type || 'audio/webm' }))
    out.append('model', GROQ_MODEL)
    out.append('language', language)
    out.append('response_format', 'json')
    out.append('temperature', '0')

    const res = await fetch(GROQ_TRANSCRIBE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: out,
    })

    if (res.ok) {
      const data = (await res.json()) as { text?: string }
      const text = typeof data.text === 'string' ? data.text.trim() : ''
      if (text) return Response.json({ text, engine: 'groq' })
    } else {
      console.error(`Groq transcribe ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
  } catch (err) {
    console.error('Groq transcribe error:', err)
  }

  // 2) Fallback: Workers AI.
  try {
    const text = await transcribeWithWorkersAI(bytes, language)
    if (text) return Response.json({ text, engine: 'workers-ai' })
  } catch (err) {
    console.error('Workers AI transcribe error:', err)
  }

  return Response.json(
    { error: 'No se pudo transcribir el audio. Intentalo de nuevo.', code: 'transcription_failed' },
    { status: 502 },
  )
}

async function transcribeWithWorkersAI(bytes: ArrayBuffer, language: string): Promise<string> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const ctx = await getCloudflareContext({ async: true })
  const ai = ctx.env.AI as unknown as {
    run: (model: string, input: Record<string, unknown>) => Promise<{ text?: string }>
  }
  const out = await ai.run(CF_MODEL, {
    audio: toBase64(bytes),
    language,
    task: 'transcribe',
    vad_filter: true,
  })
  return (out?.text || '').trim()
}

function toBase64(buf: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64')
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
