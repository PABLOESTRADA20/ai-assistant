// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import ServiceWorkerRegister from './components/ServiceWorkerRegister'

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
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/icon-192.png',
  },
}

// En móvil: respeta el notch (`viewportFit: cover`) y pinta la barra de estado.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#08080b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="noise">
        {/* Guarda `beforeinstallprompt` antes de la hidratación: si el navegador
            lo dispara muy pronto, el botón Instalar no lo pierde. */}
        <Script id="aria-install-capture" strategy="beforeInteractive">
          {`window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__ariaBIP=e;window.dispatchEvent(new Event('aria:bip'));});`}
        </Script>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
