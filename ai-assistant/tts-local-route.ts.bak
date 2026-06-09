// app/api/tts/route.ts
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let voice = 'af_heart';   // Voz por defecto: la mejor calidad

  try {
    const body = await req.json();
    const { text, speed = 1.0 } = body;
    voice = body.voice ?? 'af_heart';   // Actualizamos la voz

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'El texto es requerido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Dynamic import - kokoro-js solo funciona en Node.js, no en Workers
    let KokoroTTS: any;
    try {
      KokoroTTS = (await import(/* @vite-ignore */ 'kokoro-js')).KokoroTTS;
    } catch {
      return new Response(
        JSON.stringify({ error: 'TTS no disponible en esta plataforma' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tts = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      {
        dtype: 'q8',
        device: 'cpu',
      }
    );

    const audio = await tts.generate(text, {
      voice: voice as any,
      speed,
    });

    const wavBuffer = audio.toWav();
    const buffer = Buffer.from(wavBuffer);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('Kokoro TTS Error:', error);

    let errorMessage = 'Error al generar el audio';

    if (error?.message?.toLowerCase().includes('voice') || error?.message?.includes('not found')) {
      errorMessage = `Voz "${voice}" no encontrada.`;
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
