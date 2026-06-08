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

    const { KokoroTTS } = await import('kokoro-js');

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

    // Mensaje más útil cuando falla la voz
    if (error?.message?.toLowerCase().includes('voice') || error?.message?.includes('not found')) {
      errorMessage = `Voz "${voice}" no encontrada. 

Voces disponibles:
• af_heart (la mejor calidad - recomendada)
• af_bella (clara y natural)
• af_sky (suave)
• af_nicole (profesional)
• bf_emma (acento británico)
• bm_george (voz masculina)`;
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
