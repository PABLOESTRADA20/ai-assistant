// app/api/tts/route.ts
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'af_bella' } = await req.json()

    if (!text) {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Dynamic import to avoid SSR issues
    const { KokoroTTS } = await import('kokoro-js')

    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0', {
      dtype: 'q8',
    })

    const audio = await tts.generate(text, { voice })

    // Convert to wav buffer
    const wavBuffer = audio.toWav()
    const buffer = Buffer.from(wavBuffer)

    return new Response(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('TTS error:', error)
    const message = error instanceof Error ? error.message : 'TTS generation failed'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}