// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ARIA — AI Assistant',
  description: 'Asistente de IA con memoria, herramientas, voz y canales (WhatsApp, correo).',
  applicationName: 'ARIA',
  // Al añadir a la pantalla de inicio en iOS se comporta como app a pantalla completa.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ARIA',
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%237c6af7'/><stop offset='100%25' stop-color='%236d5ce6'/></linearGradient></defs><rect width='100' height='100' rx='20' fill='url(%23g)'/><text x='50' y='68' font-size='50' fill='white' text-anchor='middle' font-family='system-ui' font-weight='bold'>A</text></svg>",
  },
}

// En móvil: respeta el notch (`viewportFit: cover`) y pinta la barra de estado.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0a0a0f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="noise">{children}</body>
    </html>
  )
}
