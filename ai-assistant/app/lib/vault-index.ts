import fs from 'fs'
import path from 'path'

const INDEX_FILE = '.aria-index.json'

export interface VaultEntry {
  path: string
  name: string
  mtime: number
  title?: string
}

interface VaultIndex {
  file: string
  builtAt: number
  entries: VaultEntry[]
}

let cachedIndex: VaultIndex | null = null

function vaultRoot(): string | null {
  return process.env.VAULT_PATH || null
}

function getIndexFilePath(vp: string): string {
  return path.join(vp, INDEX_FILE)
}

function isIndexFresh(vp: string): boolean {
  const idxPath = getIndexFilePath(vp)
  if (!fs.existsSync(idxPath)) return false
  const idxStat = fs.statSync(idxPath)
  // Check if any note is newer than the index (walk top-level only for a quick check)
  let newestNote = 0
  try {
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === INDEX_FILE || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          // Skip heavy dirs
          if (['node_modules', '.obsidian', '.git', '.trash'].includes(entry.name)) continue
          walk(full)
        } else if (entry.name.endsWith('.md')) {
          const stat = fs.statSync(full)
          if (stat.mtimeMs > newestNote) newestNote = stat.mtimeMs
        }
      }
    }
    walk(vp)
  } catch {
    return false
  }
  return idxStat.mtimeMs >= newestNote
}

function extractTitle(content: string, name: string): string {
  const m = content.match(/^#\s+(.+)$/m)
  if (m) return m[1].trim()
  return name.replace(/\.md$/, '')
}

function buildIndex(vp: string): VaultIndex {
  const entries: VaultEntry[] = []
  const maxRead = 8 * 1024 * 1024

  const walk = (dir: string) => {
    const list = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of list) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.obsidian', '.git', '.trash', '.smart-connections'].includes(entry.name)) continue
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        const rel = path.relative(vp, full)
        const stat = fs.statSync(full)
        let title: string | undefined
        try {
          const fd = fs.openSync(full, 'r')
          const buffer = Buffer.alloc(4096)
          const read = fs.readSync(fd, buffer, 0, 4096, 0)
          fs.closeSync(fd)
          title = extractTitle(buffer.subarray(0, read).toString('utf-8'), entry.name)
        } catch {
          title = undefined
        }
        if (stat.size > maxRead && !title) continue // skip huge/unparseable
        entries.push({ path: rel, name: entry.name.replace(/\.md$/, ''), mtime: stat.mtimeMs, title })
      }
    }
  }

  walk(vp)

  const index: VaultIndex = {
    file: getIndexFilePath(vp),
    builtAt: Date.now(),
    entries,
  }

  try {
    fs.writeFileSync(index.file, JSON.stringify(index), 'utf-8')
  } catch {
    // index file is best-effort; in-memory cache still works
  }

  cachedIndex = index
  return index
}

export function getVaultIndex(force = false): VaultIndex | null {
  const vp = vaultRoot()
  if (!vp) return null

  if (force || !cachedIndex) {
    if (!force && isIndexFresh(vp)) {
      try {
        const raw = fs.readFileSync(getIndexFilePath(vp), 'utf-8')
        cachedIndex = JSON.parse(raw) as VaultIndex
        return cachedIndex
      } catch {
        cachedIndex = null
      }
    }
    return buildIndex(vp)
  }
  return cachedIndex
}

export interface VaultSearchResult {
  files: string[]
  total: number
  indexed: number
  rebuilt: boolean
}

export function searchVaultIndex(query: string): VaultSearchResult {
  const vp = vaultRoot()
  if (!vp) return { files: [], total: 0, indexed: 0, rebuilt: false }

  const before = cachedIndex ? cachedIndex.builtAt : 0
  const index = getVaultIndex()
  if (!index) return { files: [], total: 0, indexed: 0, rebuilt: false }

  const lowerQuery = query.toLowerCase()
  const byName = index.entries.filter(
    (e) => e.name.toLowerCase().includes(lowerQuery) || e.title?.toLowerCase().includes(lowerQuery)
  )
  const files = byName.map((e) => e.path)

  // Content search (limited to guard performance)
  if (files.length < 3) {
    const candidates = index.entries.slice(0, 200)
    for (const entry of candidates) {
      try {
        const full = path.join(vp, entry.path)
        const content = fs.readFileSync(full, { encoding: 'utf-8', flag: 'r' })
        if (content.toLowerCase().includes(lowerQuery)) {
          if (!files.includes(entry.path)) files.push(entry.path)
        }
      } catch {
        // skip unreadable
      }
    }
  }

  return {
    files: files.slice(0, 20),
    total: files.length,
    indexed: index.entries.length,
    rebuilt: cachedIndex ? cachedIndex.builtAt !== before : true,
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
}

export interface SemanticResult {
  files: { path: string; score: number; snippet?: string }[]
  total: number
  indexed: number
}

export function semanticSearch(query: string): SemanticResult {
  const vp = vaultRoot()
  if (!vp) return { files: [], total: 0, indexed: 0 }

  const index = getVaultIndex()
  if (!index) return { files: [], total: 0, indexed: 0 }

  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return { files: [], total: 0, indexed: index.entries.length }

  // Stopwords — reject each query term equal to common Spanish/English words
  const stopwords = new Set([
    'para', 'como', 'que', 'por', 'con', 'una', 'las', 'los', 'del', 'de', 'la', 'el', 'en', 'y', 'a', 'the', 'and', 'for', 'what', 'how', 'are', 'you', 'this', 'that',
  ])
  const terms = queryTerms.filter((t) => !stopwords.has(t)).slice(0, 8)
  if (terms.length === 0) return { files: [], total: 0, indexed: index.entries.length }

  const results: { path: string; score: number; snippet?: string }[] = []
  const maxRead = 150
  const maxBytes = 60 * 1024

  for (const entry of index.entries.slice(0, maxRead)) {
    let score = 0
    const name = tokenize(entry.name).join(' ')
    const title = tokenize(entry.title || '').join(' ')
    for (const t of terms) {
      if (name.includes(t) || title.includes(t)) score += 3
    }
    if (score === 0) continue

    let snippet: string | undefined
    // Boost with content peek when few strong name matches
    if (results.length < 12) {
      try {
        const full = path.join(vp, entry.path)
        const stat = fs.statSync(full)
        if (stat.size <= maxBytes) {
          const content = fs.readFileSync(full, 'utf-8')
          const words = tokenize(content)
          if (words.length > 0) {
            const counts = new Map<string, number>()
            for (const w of words) counts.set(w, (counts.get(w) || 0) + 1)
            for (const t of terms) {
              const count = counts.get(t) || 0
              if (count > 0) score += Math.min(count, 5) * 0.25
            }
            const idx = content.toLowerCase().indexOf(terms[0])
            if (idx >= 0) {
              const start = Math.max(0, idx - 60)
              snippet = content.slice(start, start + 140).replace(/\n+/g, ' ')
            }
          }
        }
      } catch {
        // skip unreadable
      }
    }
    results.push({ path: entry.path, score, snippet })
  }

  results.sort((a, b) => b.score - a.score)
  return { files: results.slice(0, 10), total: results.length, indexed: index.entries.length }
}