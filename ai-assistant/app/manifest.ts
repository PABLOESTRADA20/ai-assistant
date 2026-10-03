import type { MetadataRoute } from 'next'

/**
 * Manifest PWA. Permite "Añadir a pantalla de inicio" en Android/iOS y abrir
 * ARIA a pantalla completa, sin barra del navegador. No hay service worker
 * (no hace falta cache offline para una app que depende del servidor).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'ARIA — AI Assistant',
    short_name: 'ARIA',
    description: 'Asistente de IA con memoria, herramientas, voz y canales.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    // Mismo negro que --surface-0 para que el splash no parpadee a otro color.
    background_color: '#08080b',
    theme_color: '#08080b',
    lang: 'es',
    dir: 'ltr',
    categories: ['productivity', 'utilities'],
    icons: [
      // PNG primero: Android los exige y algunos navegadores ignoran el SVG.
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
