/**
 * Busqueda web sin API key y sin costo.
 *
 * Fuentes (todas gratuitas y sin clave):
 *  1. DuckDuckGo HTML  - `https://html.duckduckgo.com/html/?q=` ( scraping del
 *     endpoint HTML sin JS que DDG expone para integradores). Es el unico que
 *     devuelve resultados web reales sin key.
 *  2. Wikipedia API     - fallback/extra para consultas enciclopedicas.
 *
 * Por que no Tavily/Brave/Serper: todos exigen key y (salvo tier inicial) cobro.
 *
 * Nota de robustez: DDG devuelve sus URLs como redirectores
 * `//duckduckgo.com/l/?uddg=<url-codificada>`, aqui se desenvuelven a la URL
 * real. Los resultados patrocinados se descartan.
 */

const DDG_ENDPOINT = 'https://html.duckduckgo.com/html/'

/**
 * User-Agent honesto (identificandonos como bot), NO uno de navegador.
 *
 * Medido: con UA de navegador DDG dispara su pagina de anti-bot de forma
 * intermitente (~50% de los requests, status 202 + "Anomaly detected"), mientras
 * que con este UA se comporto estable 4/4 en la misma tanda. Presentarse como
 * navegador es justamente lo que activa la deteccion.
 */
const BOT_UA = 'Mozilla/5.0 (compatible; aria-assistant/1.0; +https://github.com/PABLOESTRADA20/ai-assistant)'

/** UA de navegador, solo para Wikipedia que lo pide para su API etiquette. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export type WebResult = {
  title: string
  url: string
  snippet: string
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#x2F;': '/',
  '&#x2E;': '.',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|apos|nbsp|#x2F|#x2E);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Desenvuelve la URL real desde el redirector de DDG.
 * Acepta `//duckduckgo.com/l/?uddg=...` y `https://duckduckgo.com/l/?uddg=...`.
 */
function unwrapDuckduckgoUrl(href: string): string | null {
  let raw = href.trim().replace(/^["']|["']$/g, '')
  if (raw.startsWith('//')) raw = `https:${raw}`
  try {
    const url = new URL(raw)
    const target = url.searchParams.get('uddg')
    if (!target) return null
    return decodeURIComponent(target)
  } catch {
    return null
  }
}

/** Detecta URLs de resultados patrocinados (anuncios). */
function isSponsored(rawUrl: string): boolean {
  return (
    rawUrl.includes('duckduckgo.com/y.js') ||
    rawUrl.includes('ad_provider=') ||
    rawUrl.includes('ad_type=') ||
    rawUrl.includes('bing.com/aclick')
  )
}

/**
 * Parsea el HTML de resultados de DuckDuckGo.
 * Cada resultado viene como:
 *   <h2 class="result__title"><a class="result__a" href="...">Title</a></h2>
 *   <a class="result__snippet">snippet</a>
 */
function parseDuckduckgoHtml(html: string, limit: number): WebResult[] {
  const results: WebResult[] = []

  // Bloque por bloque: partir por cada titulo y tomar el snippet que le sigue.
  const blocks = html.split(/<h2[^>]*class="[^"]*result__title[^"]*"/i).slice(1)

  for (const block of blocks) {
    if (results.length >= limit) break

    const linkMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!linkMatch) continue

    const url = unwrapDuckduckgoUrl(decodeEntities(linkMatch[1]))
    if (!url || isSponsored(url)) continue
    if (!/^https?:\/\//i.test(url)) continue

    const title = stripTags(linkMatch[2])
    if (!title) continue

    // El snippet puede estar en <a class="result__snippet"> o <div class="result__snippet">
    const snippetMatch = block.match(
      /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
    )
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''

    results.push({ title, url, snippet })
  }

  return results
}

/** DDG devuelve codigos 202/403 + pagina de challenge cuando detecta bot. */
function isChallengePage(html: string): boolean {
  return /anomaly|captcha|unusual traffic|challenge-form|blocked/i.test(html)
}

async function searchDuckduckgo(query: string, limit: number): Promise<WebResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(`${DDG_ENDPOINT}?q=${encodeURIComponent(query)}&kl=wt-wt`, {
      headers: { 'User-Agent': BOT_UA, Accept: 'text/html' },
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`DuckDuckGo respondio ${res.status}`)

    const html = await res.text()
    if (isChallengePage(html)) throw new Error('DuckDuckGo devolvio pagina de anti-bot')

    return parseDuckduckgoHtml(html, limit)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Wikipedia: util para consultas enciclopedicas ("quien es X", "capital de Y",
 * "cuando se fundo Z"). Aporta contexto y extractos cuando DDG falla.
 */
async function searchWikipedia(query: string, limit: number): Promise<WebResult[]> {
  const results: WebResult[] = []

  for (const lang of ['es', 'en']) {
    if (results.length >= limit) break
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}` +
        `&format=json&origin=*`

      const res = await fetch(url, { headers: { 'User-Agent': `${BROWSER_UA} (aria-assistant)` } })
      if (!res.ok) continue

      const data = (await res.json()) as {
        query?: { search?: Array<{ title: string; snippet: string; pageid: number }> }
      }
      const hits = data.query?.search ?? []
      for (const hit of hits) {
        if (results.length >= limit) break
        results.push({
          title: hit.title,
          url: `https://${lang}.wikipedia.org/?curid=${hit.pageid}`,
          snippet: stripTags(hit.snippet),
        })
      }
    } catch {
      // Wikipedia es best-effort: si falla, seguimos con lo que haya.
    }
  }

  return results
}

export type WebSearchOutcome = {
  query: string
  answer: string | null
  results: WebResult[]
  sources: string[]
  /** Errores no fatales de los proveedores que fallaron. */
  warnings: string[]
}

/**
 * Busca en la web usando solo servicios gratuitos sin API key.
 * Intenta DuckDuckGo y, si no arroja nada, completa con Wikipedia.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchOutcome> {
  const limit = Math.min(Math.max(maxResults, 1), 10)
  const warnings: string[] = []
  let results: WebResult[] = []

  try {
    results = await searchDuckduckgo(query, limit)
  } catch (err) {
    warnings.push(`DuckDuckGo: ${err instanceof Error ? err.message : String(err)}`)
  }

  // DDG puede responder 200 con la pagina de challenge en vez de lanzar excepcion:
  // en ese caso cae aqui con results vacio y se rescata con Wikipedia.
  if (results.length === 0) {
    try {
      const wiki = await searchWikipedia(query, limit)
      if (wiki.length > 0) {
        warnings.push('resultados obtenidos solo de Wikipedia')
        results = wiki
      }
    } catch (err) {
      warnings.push(`Wikipedia: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (results.length === 0 && warnings.length === 0) {
    warnings.push('sin resultados')
  }

  return {
    query,
    // El modelo resume los snippets; no inventamos un "answer" prefabricado.
    answer: null,
    results,
    sources: results.length > 0 ? ['duckduckgo', 'wikipedia'] : [],
    warnings,
  }
}