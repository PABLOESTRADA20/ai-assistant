'use client'

import { useState } from 'react'
import { KeyRound, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'
import { verifyToken } from '@/app/lib/auth-client'

interface Props {
  onSuccess: () => void
}

/**
 * Pantalla de acceso.
 *
 * Solo aparece cuando el servidor tiene configurado `ARIA_ACCESS_TOKEN`. La
 * clave se comprueba contra `/api/conversations`; si es valida se guarda en
 * `localStorage` y a partir de ahi todas las peticiones la llevan solas.
 */
export default function LoginScreen({ onSuccess }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const token = value.trim()
    if (!token || busy) return
    setBusy(true)
    setError('')
    const ok = await verifyToken(token)
    setBusy(false)
    if (ok) {
      onSuccess()
    } else {
      setError('Clave incorrecta. Vuelve a intentarlo.')
    }
  }

  return (
    <div
      className="flex h-dvh items-center justify-center px-4"
      style={{ background: 'var(--app-bg)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, #ff2e4d 0%, #c81e3c 100%)',
              boxShadow: '0 8px 32px rgba(255,46,77,0.4)',
            }}
          >
            <ShieldCheck size={26} color="#fff" />
          </div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            ARIA protegida
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Introduce la clave de acceso para continuar.
          </p>
        </div>

        <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
          Clave de acceso
        </label>
        <div className="relative">
          <KeyRound
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="Pega o escribe tu clave"
            className="w-full rounded-xl pl-9 pr-10 py-2.5 text-sm outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Ocultar clave' : 'Mostrar clave'}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {error && (
          <p className="text-xs mt-2" style={{ color: '#f87171' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          {busy ? 'Comprobando...' : 'Entrar'}
        </button>

        <p className="text-xs mt-4 text-center" style={{ color: 'var(--text-muted)' }}>
          La clave se guarda solo en este navegador.
        </p>
      </form>
    </div>
  )
}
