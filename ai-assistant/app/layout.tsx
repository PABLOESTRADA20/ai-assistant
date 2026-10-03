// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import ServiceWorkerRegister from './components/ServiceWorkerRegister'

/**
 * Red de seguridad en HTML puro.
 *
 * Si el JavaScript de la app no llega a ejecutarse —el caso típico es un
 * service worker viejo sirviendo un HTML que apunta a bundles que ya no
 * existen—, la pantalla de carga se queda congelada y el usuario no puede
 * hacer nada. Este script es independiente de React y del bundle: a los 10 s,
 * si la app no marcó `window.__ariaBooted`, muestra un aviso con un botón que
 * desregistra el service worker, borra las cachés y recarga.
 */
const BOOT_WATCHDOG = [
  '(function(){',
  "function reveal(){if(window.__ariaBooted)return;var el=document.getElementById('aria-boot-fallback');if(el){el.style.display='flex';}}",
  'setTimeout(reveal,10000);',
  "document.addEventListener('click',function(e){",
  "var t=e.target;",
  "if(!t||t.id!=='aria-boot-reset')return;",
  "t.textContent='Limpiando...';t.disabled=true;",
  'Promise.resolve()',
  ".then(function(){if('serviceWorker' in navigator){return navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));});}})",
  ".then(function(){if('caches' in window){return caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));});}})",
  '.then(function(){location.reload();})',
  '.catch(function(){location.reload();});',
  '});',
  '})();',
].join('\n')

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
        {/* Aviso de emergencia: solo se ve si la app no arranca (ver BOOT_WATCHDOG). */}
        <div
          id="aria-boot-fallback"
          style={{
            display: 'none',
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            background: '#08080b',
            color: '#f7eef0',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <p style={{ margin: 0, fontSize: 15 }}>ARIA tardó demasiado en cargar.</p>
          <p style={{ margin: 0, maxWidth: 320, fontSize: 13, color: '#b9a7ac' }}>
            Normalmente pasa cuando el navegador guardó una versión vieja. Tocá el botón para limpiarla.
          </p>
          <button
            id="aria-boot-reset"
            type="button"
            style={{
              padding: '10px 18px',
              borderRadius: 12,
              border: '1px solid #ff2e4d',
              background: 'rgba(255,46,77,0.14)',
              color: '#ff2e4d',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Limpiar caché y recargar
          </button>
        </div>
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
      </body>
    </html>
  )
}
