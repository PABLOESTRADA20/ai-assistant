/**
 * Utilidades de autenticacion del lado del cliente.
 *
 * El token se guarda en `localStorage` y viaja en la cabecera
 * `Authorization: Bearer <token>` en cada llamada a la API. No se usa cookie
 * para no complicar el SSE: el chat se consume con `fetch` y streaming, que
 * admite cabeceras sin problema.
 */

const TOKEN_KEY = 'aria_access_token'

/** Evento que se dispara cuando el servidor responde 401. */
export const UNAUTHORIZED_EVENT = 'aria:unauthorized'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  // Brave/modo privado pueden bloquear `localStorage`: nunca debe romper el arranque.
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* almacenamiento bloqueado: la sesión no persiste, pero la app funciona. */
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignorar */
  }
}

/** Cabeceras base con el token, si lo hay. */
export function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const token = getToken()
  return token ? { ...base, Authorization: `Bearer ${token}` } : { ...base }
}

/**
 * `fetch` con el token y con manejo central del 401: si el token caduca o se
 * cambia, se borra y se avisa a la app para que muestre el login en vez de
 * dejar al usuario con errores sueltos por todas partes.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: authHeaders((init.headers as Record<string, string>) ?? {}),
  })
  if (res.status === 401 && typeof window !== 'undefined') {
    clearToken()
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return res
}

/** `fetch` que se aborta solo si tarda demasiado (evita cuelgues al arrancar). */
function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

/** Pregunta al servidor si la app exige clave. */
export async function fetchAuthRequired(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('/api/auth', { cache: 'no-store' }, 8000)
    if (!res.ok) return false
    const data = await res.json()
    return data?.required === true
  } catch {
    return false
  }
}

/**
 * Comprueba un token contra una ruta protegida. Si es valido lo deja guardado;
 * si no, lo descarta. Devuelve si la clave es correcta.
 */
export async function verifyToken(token: string): Promise<boolean> {
  setToken(token)
  try {
    const res = await fetch('/api/conversations', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (res.ok) return true
    if (res.status === 401) clearToken()
    return false
  } catch {
    clearToken()
    return false
  }
}
