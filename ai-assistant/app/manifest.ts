import type { MetadataRoute } from 'next'

/**
 * Manifest PWA. Permite "Añadir a pantalla de inicio" en Android/iOS y abrir
 * ARIA a pantalla completa, sin barra del navegador. No hay service worker
 * (no hace falta cache offline para una app que depende del servidor).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ARIA — AI Assistant',
    short_name: 'ARIA',
    description: 'Asistente de IA con memoria, herramientas, voz y canales.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0f',
    theme_color: '#0a0a0f',
    lang: 'es',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
