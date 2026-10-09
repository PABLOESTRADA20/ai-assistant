'use client'

/**
 * Puente entre la app web y el agente local de ARIA.
 *
 * La página se sirve por HTTPS (o por `localhost`), pero el agente escucha en
 * `http://127.0.0.1:8787`. Los navegadores modernos consideran `localhost` /
 * `127.0.0.1` un "contexto seguro", así que el fetch desde HTTPS NO se bloquea
 * como contenido mixto.
 *
 * El token NUNCA se hornea en el bundle (nada de `NEXT_PUBLIC_*`): si estuviera
 * en el JS publico, cualquiera podria leerlo y abrir apps en tu PC. En su lugar
 * el usuario lo pega una vez y se guarda en `localStorage` (ver
 * `saveLocalToken`). Debe coincidir con el `ARIA_LOCAL_TOKEN` del agente; va en
 * una cabecera propia para que dispare un preflight CORS y el agente pueda
 * validarlo antes de ejecutar nada.
 */

export interface LocalAgentResult {
  ok: boolean
  message: string
  /** El agente exige token y la app no tiene uno válido. */
  needsToken?: boolean
}

function agentBase(): string {
  const raw = process.env.NEXT_PUBLIC_ARIA_LOCAL_AGENT?.trim()
  return (raw || 'http://127.0.0.1:8787').replace(/\/$/, '')
}

/**
 * El token sale SOLO de `localStorage`, donde lo deja el usuario una vez (ver
 * `saveLocalToken`). No se lee de ninguna variable `NEXT_PUBLIC_*`: eso lo
 * inlineaba en el bundle público y lo exponía a cualquiera que abriera la app.
 */
function agentToken(): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('aria_local_token') : null
    if (stored?.trim()) return stored.trim()
  } catch {
    /* localStorage no disponible */
  }
  return ''
}

/** Guarda el token en el navegador para próximas llamadas. */
export function saveLocalToken(token: string): void {
  try {
    localStorage.setItem('aria_local_token', token.trim())
  } catch {
    /* ignore */
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = agentToken()
  if (token) h['X-ARIA-Token'] = token
  return h
}

/** Comprueba si el agente local está corriendo. */
export async function checkLocalAgent(): Promise<boolean> {
  try {
    const res = await fetch(`${agentBase()}/health`, {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Pide al agente local que abra una aplicación. */
export async function openAppLocally(app: string, target?: string): Promise<LocalAgentResult> {
  if (!app) return { ok: false, message: 'No especifiqué qué aplicación abrir.' }
  try {
    const res = await fetch(`${agentBase()}/open`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ app, args: target }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      return { ok: false, needsToken: true, message: 'El agente local exige un token de acceso.' }
    }
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        message: data?.error || `El agente local respondió con ${res.status}.`,
      }
    }
    return { ok: true, message: data?.message || `Abriendo ${app}…` }
  } catch {
    return {
      ok: false,
      message:
        'No pude contactar con el agente local. ¿Está corriendo en tu PC? ' +
        'Arráncalo con: node local-agent/aria-local-agent.mjs',
    }
  }
}
