'use client'

/**
 * Último recurso: se muestra si falla el propio layout raíz. Debe declarar
 * `<html>` y `<body>`. Sin dependencias para que cargue aunque el resto falle.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          background: '#08080b',
          color: '#f7eef0',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18 }}>ARIA no pudo arrancar</h1>
          <p style={{ margin: 0, maxWidth: 360, fontSize: 14, color: '#b9a7ac' }}>
            Cerrá y volvé a abrir la app. Si sigue igual, borrá los datos del sitio.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid #ff2e4d',
              background: 'transparent',
              color: '#ff2e4d',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  )
}
