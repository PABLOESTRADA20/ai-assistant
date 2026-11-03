export type OpenKind = 'alias' | 'uri' | 'path' | 'command'

export interface PolicyOptions {
  allowAny?: boolean
  existsSync?: (path: string) => boolean
}

export interface PolicyDenied {
  ok: false
  status: 400 | 403
  error: string
}

export interface ResolveSuccess {
  ok: true
  value: string
  kind: OpenKind
}

export type ResolveResult = ResolveSuccess | PolicyDenied

export interface OpenRequest {
  app?: unknown
  args?: unknown
}

export interface OpenSuccess {
  ok: true
  target: string
  args?: string
  kind: OpenKind
}

export type OpenResult = OpenSuccess | PolicyDenied

export interface TokenOptions {
  envToken?: string
  tokenFile?: string
  existsSync?: (path: string) => boolean
  readFileSync?: (path: string, encoding: string) => string
  writeFileSync?: (path: string, data: string, options?: { mode?: number }) => void
  randomBytes?: (size: number) => { toString(encoding: string): string }
  warn?: (message: string, error?: unknown) => void
}

export const ALLOWED_URI_SCHEMES: Set<string>
export const EXECUTABLE_EXTENSIONS: Set<string>
export const APP_ALIASES: Readonly<Record<string, string>>
export const CONSOLE_ALIASES: Set<string>

export function normalizeKey(name: string): string
export function hasUnsafeChars(value: unknown): boolean
export function isExecutablePath(value: string): boolean
export function resolveTarget(app: unknown, options?: PolicyOptions): ResolveResult
export function validateOpenRequest(request?: OpenRequest, options?: PolicyOptions): OpenResult
export function tokenMatches(provided: unknown, expected: unknown): boolean
export function loadAgentToken(options?: TokenOptions): string
