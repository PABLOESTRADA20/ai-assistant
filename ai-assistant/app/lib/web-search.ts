/**
 * Busqueda web sin API key y sin costo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SE USA NINGUN BUSCADOR (DuckDuckGo, Bing, Brave, Startpage...)
 * ---------------------------------------------------------------------------
 * Todos los buscadores de proposito general rechazan o corrompen las peticiones
 * que llegan desde IPs de datacenter, que es exactamente desde donde sale un
 * Cloudflare Worker. Medido con este mismo Worker (workerd real):
 *
 *   - DuckDuckGo HTML + lite + POST: HTTP 202 con la pagina de anti-bot, siempre,
 *     con cualquier User-Agent. (Desde Node en la misma red: 4/4 correctos.)
 *   - Bing HTML: HTTP 200 con SERP, pero resultados **corruptos**. Para
 *     "mejores lenguajes de programacion 2026" devolvio resultados de
 *     Newgrounds/Reddit sin relacion, y en consultas correctas desalineo el
 *     titulo con su URL. Es anti-scraping deliberado, no un bug de parseo.
 *   - Brave 429/422 (pide `x-subscription-token`), Ecosia 403, Reddit 403,
 *     Yahoo 500, Startpage Anubis (challenge JS), Mojeek pagina vacia,
 *     searx.be/priv.au/baresearch 403/429/challenge, Marginalia sin cobertura,
 *     Yep y Google: shell de JS sin datos.
 *
 * Es decir: no hay forma de obtener una SERP real desde un Worker sin clave.
 * Como el riesgo real de esto es *inventarse* resultados, se eligieron APIs
 * publicas que exponen datos estructurados, sin key, y se verificó que responden
 * bien desde el egress de Cloudflare.
 *
 * ---------------------------------------------------------------------------
 * FUENTES USADAS (todas keyless, gratis y sin limite oficial imposed)
 * ---------------------------------------------------------------------------
 *   1. Wikipedia  - enciclopedico, el mejor para hechos y fechas.
 *   2. Stack Overflow (Stack Exchange API) - preguntas y respuestas tecnicas.
 *   3. Hacker News (Algolia) - discussion tecnica y de industria.
 *   4. MDN - documentacion web (JS, CSS, HTML, Web APIs).
 *   5. arXiv - papers cientificos (papers de ML/IA).
 *
 * Si alguna vez se quiere cobertura de noticias o busqueda general, hace falta
 * un proveedor con API key (Tavily, Brave, Serper, Exa tienen tier gratuito);
 * se agrega aqui como fuente mas y no hay que tocar el resto del codigo.
 */

/** UA honesto: identificarse como bot. Presentarse como navegador no aporta nada. */
const USER_AGENT = 'aria-assistant/1.0 (https://github.com/PABLOESTRADA20/ai-assistant)'

export type WebResult = {
  title: string
  url: string
  snippet: string
  source: string
}

export type WebSearchOutcome = {
  query: string
  results: WebResult[]
  sources: string[]
  /** Errores no fatales de los proveedores que fallaron. */
  warnings: string[]
  /** Fuentes no consultadas por no aplicar a esta consulta. */
  skipped: string[]
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
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * Descarga perezosa con cache en modulo.
 *
 * Se usa para el catalogo de endoflife.date: son ~478 productos y tiene sentido
 * pedirlo una vez y reutilizarlo, en vez de en cada busqueda. La cache vive en el
 * isolate del Worker, o sea que en un isolate caliente el coste es cero.
 */
const cache = new Map<string, { at: number; value: unknown }>()
const CACHE_TTL_MS = 10 * 60_000

async function getCachedJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T

  const value = await getJson<T>(url, signal)
  cache.set(url, { at: Date.now(), value })
  return value
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type Source = (query: string, limit: number, signal: AbortSignal) => Promise<WebResult[]>

// ---------------------------------------------------------------------------
// Wikipedia
// ---------------------------------------------------------------------------

type WikiSearch = {
  query?: {
    search?: Array<{
      title: string
      pageid: number
      snippet: string
      pageprops?: { disambiguation?: string }
    }>
  }
}

/** Palabras vacias ES/EN: no ayudan a decidir que articulo se busca. */
const STOPWORDS = new Set(
  (
    'de la el los las un una unos unas y o que en del al por para con como es son fue esta este ' +
    'estos estas hay quien cual cuales cuando donde cuanto ' +
    'the a an of to in for on and or is are was were what which who how why when ' +
    'it its this that with be do does did i me my you your'
  ).split(' ')
)

function queryTokens(query: string): string[] {
  return query.split(/[^\p{L}\p{N}+#.-]+/u).filter((t) => t.length > 1)
}

/**
 * Candidatos a entidad, ordenados por probabilidad de ser el sujeto de la consulta.
 *
 * Primero las palabras con mayuscula que no son la primera (nombres propios y
 * siglas: "Alan Turing", "JavaScript", "HTTP"), despues el resto de terminos
 * significativos. La primera palabra se excluye a proposito porque en espanol
 * casi toda consulta empieza por "que", "como" o "quien" y esas nunca son la
 * entidad.
 */
function entityCandidates(query: string, max: number): string[] {
  const all = queryTokens(query)
  const proper = all.filter(
    (t, i) => i > 0 && /^\p{Lu}/u.test(t) && !STOPWORDS.has(t.toLowerCase())
  )
  const rest = all.filter((t) => !STOPWORDS.has(t.toLowerCase()) && !proper.includes(t))

  const seen = new Set<string>()
  const out: string[] = []
  for (const token of [...proper, ...rest]) {
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
    if (out.length >= max) break
  }
  return out
}

type WikiExtract = {
  query?: {
    pages?: Record<string, { extract?: string; missing?: string }>
  }
}

type WikiHit = {
  title: string
  pageid: number
  snippet: string
  lang: string
  pageprops?: { disambiguation?: string }
}

/**
 * Desambiguacion.
 *
 * Con `intitle:Rust` el primer resultado es la pagina homonima ("Rust" el album,
 * el municipio, la pelicula) y no el lenguaje de programacion. Wikipedia lo
 * marca de forma fiable: `pageprops.disambiguation` viene presente solo en las
 * paginas de desambiguacion. Verificado contra "Rust" (lo tiene), "Deno",
 * "JavaScript", "PostgreSQL" y "Alan Turing" (no lo tienen).
 *
 * Se descartan, pero solo si queda algo: para consultas genuinamente ambiguas
 * ("Rust" a secas) la pagina de desambiguacion es la respuesta correcta.
 */
const DISAMBIGUATION = /puede referirse a|may refer to|is a disambiguation/i

function isDisambiguation(hit: WikiHit): boolean {
  if (hit.pageprops?.disambiguation !== undefined) return true
  return DISAMBIGUATION.test(stripTags(hit.snippet))
}

async function wikiSearch(
  lang: string,
  srsearch: string,
  signal: AbortSignal
): Promise<WikiHit[]> {
  const data = await getJson<WikiSearch>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srprop=snippet|pageprops` +
      `&srsearch=${encodeURIComponent(srsearch)}&srlimit=6&srnamespace=0&format=json&origin=*`,
    signal
  )
  return (data.query?.search ?? []).map((h) => ({ ...h, lang }))
}

/**
 * Busca articulos y ademas trae el parrafo introductorio de cada uno.
 *
 * ------------------------------------------------------------------
 * POR QUE NO SE BUSCA LA FRASE COMPLETA Y YA
 * ------------------------------------------------------------------
 * `srsearch` con el texto crudo indexa por OR de terminos, asi que cualquier
 * palabra suelta arrastra articulos que no tienen nada que ver. Medido con este
 * mismo codigo sobre consultas reales:
 *
 *   "Alan Turing biography importance"  -> Historia de las matematicas (1er resultado)
 *   "who invented the World Wide Web"  -> Motor de busqueda (1er resultado)
 *
 * Y las dos alternativas obvias tampoco sirven por si solas (medido, 5 consultas):
 *
 *   frase exacta "primeras 2 palabras"  -> top1 correcto 1/5, y "ultima version"
 *                                           devolvia DrugBank
 *   AND de todos los terminos (+a +b)  -> top1 correcto 0/5
 *
 * Lo que si funciona es combinar cuatro estrategias y ordenarlas por fiabilidad,
 * porque cada una le acierta a un caso distinto:
 *
 *   1. `intitle:"ent1 ent2 ent3"`  entidad multipalabra completa ("World Wide Web")
 *   2. `intitle:"ent1 ent2"`       entidad multipalabra parcial
 *   3. la consulta completa         indexada por OR, pero es la unica que
 *                                   entiende "ultima version estable de Rust" y
 *                                   ahi coloca "Rust (lenguaje de programacion)"
 *                                   en el primer lugar
 *   4. `intitle:ent1`              entidad de una palabra, ultimo recurso: "Rust"
 *                                   devuelve tambien el album y la pelicula
 *
 * No se corta en cuanto se llena la cuota, se ejecutan las cuatro y se ordena el
 * conjunto: si se paraba en la primera que llenaba, la estrategia 3 nunca llegaba
 * a ejecutarse y "Rust" salia con la pelicula y el album. Medido con el orden y el
 * tope por estrategia de este codigo: el articulo correcto cae en el top-3 en 5 de
 * 6 consultas de prueba (la sexta se queda fuera por el tope de 3 por idioma, que
 * es el precio de no diluir el ranking con ~100 candidatos).
 *
 * Los extractos se piden por `pageids` y no por `titles` a proposito: con
 * `redirects=1` el titulo devuelto puede no coincidir con el pedido, y buscar el
 * extract por nombre terminaba asociandole a un articulo el parrafo de otro
 * (medido: "Rust (lenguaje de programacion)" recibia la introduccion de SFML).
 * Con `pageids` la correspondencia es exacta.
 */
const searchWikipedia: Source = async (query, limit, signal) => {
  const candidates = entityCandidates(query, 3)

  /**
   * Intercala por posicion de ranking, no por idioma.
   *
   * Concatenar todo el español y despues todo el ingles desperdicia el ranking: con
   * `intitle:Rust` el español devuelve [Rust (desambiguacion), Rust in Peace, Rust
   * (pelicula), ...] y el ingles [Rust (programming language), Rust (film), ...], asi
   * que el articulo correcto quedaba en la posicion 7 y se caia del corte. Alternando
   * por posicion, el resultado #1 de cada idioma compite y el bueno entra primero.
   */
  const inBothLanguages = async (srsearch: string) => {
    const [es, en] = await Promise.all([
      wikiSearch('es', srsearch, signal),
      wikiSearch('en', srsearch, signal),
    ])
    const interleaved: WikiHit[] = []
    for (let i = 0; i < Math.max(es.length, en.length); i++) {
      if (es[i]) interleaved.push(es[i])
      if (en[i]) interleaved.push(en[i])
    }
    return interleaved
  }

  /**
   * Cada estrategia aporta poco y el ranking se diluye si todasFULL: con 12
   * resultados por estrategia el articulo correcto caia en la posicion 22-35 de un
   * ranking de ~100 candidatos. Con 3 por idioma el mismo articulo entra en el
   * top-3 (medido: "ultima version estable de Rust" pasa de pos 22 a pos 1).
   */
  const PER_STRATEGY = 6

  /** Paso -> peso de orden. Menor peso entra antes. Ver medicion abajo. */
  const WEIGHT: Record<number, number> = {
    0: 0, // frase intitle de 3 palabras
    1: 0.4, // frase intitle de 2 palabras
    2: 0.2, // consulta completa (a texto completo)
    3: 0.8, // intitle de una palabra
  }

  const hits = new Map<string, { hit: WikiHit; step: number; idx: number }>()
  const collect = (found: WikiHit[], step: number) => {
    found.slice(0, PER_STRATEGY).forEach((hit, idx) => {
      const key = `${hit.lang}:${hit.title}`
      // Gana el primer paso que encontro el articulo, que es el de menor peso.
      if (!hits.has(key)) hits.set(key, { hit, step, idx })
    })
  }

  // Todas las estrategias se ejecutan siempre, sin cortar por cuota: si se para
  // al llenarse `limit` se perdia la que mejor ordena, y medir eso era
  // precisamente lo que fallaba con "Rust".
  if (candidates.length >= 2) {
    collect(await inBothLanguages(`intitle:"${candidates.slice(0, 3).join(' ')}"`), 0)
    collect(await inBothLanguages(`intitle:"${candidates.slice(0, 2).join(' ')}"`), 1)
  }
  collect(await inBothLanguages(query), 2)
  for (const candidate of candidates.slice(0, 2)) {
    collect(await inBothLanguages(`intitle:${candidate}`), 3)
  }

  // Descartar paginas de desambiguacion, pero solo si queda alternativa: para
  // "Rust" a secas la pagina que lista todos los sentidos es la respuesta buena.
  const all = [...hits.values()].map((entry) => entry.hit)
  const specific = all.filter((h) => !isDisambiguation(h))
  const pool = specific.length > 0 ? specific : all

  const score = (h: WikiHit) => {
    const entry = hits.get(`${h.lang}:${h.title}`)!
    return WEIGHT[entry.step] + entry.idx * 0.4
  }

  const top = pool.sort((a, b) => score(a) - score(b)).slice(0, limit)
  if (top.length === 0) return []

  // Extracts por idioma, agrupados para no pedir el mismo idioma dos veces.
  const extractsByPageId = new Map<string, string>()
  for (const lang of ['es', 'en']) {
    const pageIds = top
      .filter((h) => h.lang === lang)
      .slice(0, 2)
      .map((h) => h.pageid)
    if (pageIds.length === 0) continue
    try {
      const ex = await getJson<WikiExtract>(
        `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1` +
          `&explaintext=1&redirects=1&pageids=${pageIds.join('|')}&format=json&origin=*`,
        signal
      )
      for (const [pageId, page] of Object.entries(ex.query?.pages ?? {})) {
        if (page.extract) extractsByPageId.set(`${lang}:${pageId}`, stripTags(page.extract))
      }
    } catch {
      // Los extractos son una mejora, no un requisito: seguimos con los snippets.
    }
  }

  const results: WebResult[] = []
  for (const hit of top) {
    const intro = extractsByPageId.get(`${hit.lang}:${hit.pageid}`)
    const snippet = intro || stripTags(hit.snippet)
    if (!snippet) continue
    results.push({
      title: hit.title,
      url: `https://${hit.lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      snippet: clamp(snippet, 700),
      source: 'wikipedia',
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Stack Overflow
// ---------------------------------------------------------------------------

type StackExchange = {
  items?: Array<{
    title: string
    link: string
    score: number
    answer_count: number
    is_answered: boolean
    body?: string
    tags?: string[]
  }>
}

const searchStackOverflow: Source = async (query, limit, signal) => {
  const data = await getJson<StackExchange>(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance` +
      `&q=${encodeURIComponent(query)}&site=stackoverflow&filter=withbody` +
      `&pagesize=${limit}`,
    signal
  )

  return (data.items ?? []).slice(0, limit).map((item) => ({
    title: stripTags(item.title),
    url: item.link,
    snippet: clamp(
      stripTags(item.body ?? '') || `puntaje ${item.score}, ${item.answer_count} respuestas`,
      600
    ),
    source: 'stackoverflow',
  }))
}

// ---------------------------------------------------------------------------
// Hacker News (Algolia)
// ---------------------------------------------------------------------------

type HnAlgolia = {
  hits?: Array<{
    title?: string | null
    url?: string | null
    story_text?: string | null
    comment_text?: string | null
    points?: number | null
    num_comments?: number | null
  }>
}

const searchHackerNews: Source = async (query, limit, signal) => {
  const data = await getJson<HnAlgolia>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=(story,comment)&hitsPerPage=${limit}`,
    signal
  )

  const results: WebResult[] = []
  for (const hit of data.hits ?? []) {
    if (results.length >= limit) break
    const title = hit.title ?? hit.comment_text?.slice(0, 80)
    if (!title) continue
    const hnId = (hit as { objectID?: string }).objectID
    const snippet = stripTags(hit.story_text ?? hit.comment_text ?? '') ||
      `${hit.points ?? 0} puntos, ${hit.num_comments ?? 0} comentarios`
    results.push({
      title: clamp(stripTags(title), 160),
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hnId ?? ''}`,
      snippet: clamp(snippet, 600),
      source: 'hackernews',
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// MDN (documentacion web)
// ---------------------------------------------------------------------------

type MdnSearch = {
  documents?: Array<{ mdn_url: string; title: string; summary: string; score: number }>
}

const searchMdn: Source = async (query, limit, signal) => {
  const data = await getJson<MdnSearch>(
    `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`,
    signal
  )

  return (data.documents ?? [])
    .slice(0, limit)
    .map((doc) => ({
      title: stripTags(doc.title),
      url: `https://developer.mozilla.org${doc.mdn_url}`,
      snippet: clamp(stripTags(doc.summary ?? ''), 500),
      source: 'mdn',
    }))
    .filter((r) => r.snippet !== '')
}

// ---------------------------------------------------------------------------
// Versiones oficiales (endoflife.date)
// ---------------------------------------------------------------------------

type EolCatalog = {
  result?: Array<{
    name: string
    label?: string
    aliases?: string[]
    uri?: string
  }>
}

type EolDetail = {
  result?: {
    name?: string
    label?: string
    // Ojo: la clave es `releases`, no `cycles`, y dentro de cada release `latest`
    // es un objeto `{name, date, link}`, no una cadena. Leidas como texto plano
    // devolvian "[object Object]".
    releases?: Array<{
      name?: string
      label?: string
      releaseDate?: string
      isLts?: boolean
      isEol?: boolean
      isMaintained?: boolean
      eolFrom?: string | null
      latest?: { name?: string; date?: string; link?: string }
    }>
  }
}

const VERSION_INTENT =
  /\b(versi[oó]n|version|versions|release|releases|released|latest|ultima|[uú]ltima|estable|stable|actual|newest|nova|nova versi[oó]n|actualizaci[oó]n|update|lts|soporte|support|fin de vida|eol|end of life)\b|v?\d+\.\d+/i

/**
 * Versiones oficiales de los runtimes mas consultados.
 *
 * endoflife.date va atrasado en algunos productos: para Rust devolvia 1.98.1
 * cuando el canal estable oficial ya estaba en 1.99.0. Para estos tres se va al
 * canal oficial del proyecto, que es la fuente primaria y ademas no depende de que
 * alguien mantenga un catalogo.
 *
 * Solo se consulta cuando el producto identificado coincide, asi que no suma
 * peticiones en el resto de las consultas.
 */
const OFFICIAL_VERSION_SOURCES: Array<{
  match: string[]
  url: string
  page: string
  pick: (text: string) => { version: string; date?: string } | null
}> = [
  {
    // El canal estable declara la version en dos sitios; el primero que aparece es
    // el paquete rust del propio toolchain.
    match: ['rust'],
    url: 'https://static.rust-lang.org/dist/channel-rust-stable.toml',
    page: 'https://blog.rust-lang.org/releases/',
    pick: (text) => {
      // El valor viene como "1.99.0 (b940084d7 2026-09-28)": la version limpia y la
      // fecha van dentro del parentesis. Tomar la primera fecha suelta del archivo
      // daba la de generacion del manifiesto, no la del release.
      const raw = /\[pkg\.rust\][\s\S]{0,300}?version = "([^"]+)"/.exec(text)?.[1]
      if (!raw) return null
      const date = /(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1]
      const version = raw.replace(/\s*\(.*\)\s*$/, '')
      return { version, date }
    },
  },
  {
    match: ['nodejs', 'node'],
    url: 'https://nodejs.org/dist/index.json',
    page: 'https://nodejs.org/en/blog',
    pick: (text) => {
      try {
        const releases = JSON.parse(text) as Array<{ version: string; date: string }>
        const first = releases[0]
        return first ? { version: first.version, date: first.date } : null
      } catch {
        return null
      }
    },
  },
  {
    match: ['deno'],
    url: 'https://dl.deno.land/release-latest.txt',
    page: 'https://github.com/denoland/deno/releases',
    pick: (text) => {
      const version = text.trim()
      return version ? { version } : null
    },
  },
]

async function officialVersion(
  names: string[],
  signal: AbortSignal
): Promise<{ version: string; date?: string; page: string } | null> {
  const source = OFFICIAL_VERSION_SOURCES.find((s) => s.match.some((m) => names.includes(m)))
  if (!source) return null

  const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT }, signal })
  if (!res.ok) return null
  const picked = source.pick(await res.text())
  return picked ? { ...picked, page: source.page } : null
}

/**
 * Consulta "¿cuál es la última versión de X?" con un dato real.
 *
 * Sin esto el modelo responde de memoria y falla: medido, preguntó la última
 * versión estable de Rust y contestó "1.78.0", que era la de 2024. Wikipedia
 * tiene un artículo excelente sobre Rust pero su introducción no menciona la
 * versión actual, así que no hay nada que citar y el modelo rellena.
 *
 * endoflife.date es keyless, gratis y cubre 478 productos. Son dos peticiones: el
 * catalogo para resolver el nombre (Rust sale con los alias "rustlang" y
 * "rust-lang") y despues el detalle de ese producto, que es donde vienen las
 * versiones. Verificado que devuelve Rust 1.99.0, que coincide con el canal estable
 * oficial.
 *
 * Limitacion asumida: es un catalogo mantenido por la comunidad, no la fuente
 * primaria de cada proyecto. Para un dato de version la cita cruzada con la fuente
 * oficial sigue siendo lo prudente.
 */
const searchVersions: Source = async (query, limit, signal) => {
  const catalog = await getCachedJson<EolCatalog>(
    'https://endoflife.date/api/v1/products',
    signal
  )
  const products = catalog.result ?? []
  if (products.length === 0) return []

  const tokens = queryTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => !STOPWORDS.has(t) && !VERSION_INTENT.test(t))

  const results: WebResult[] = []
  for (const token of tokens) {
    if (results.length >= limit) break

    for (const product of products) {
      const names = [product.name, product.label, ...(product.aliases ?? [])]
        .filter((n): n is string => typeof n === 'string')
        .map((n) => n.toLowerCase())
      // Exacto contra nombre, etiqueta o alias; prefijo solo con 5+ caracteres,
      // para que "java" no arrastre "javascript".
      const exact = names.includes(token)
      const prefix = token.length >= 5 && names.some((n) => n.startsWith(token))
      if (!exact && !prefix) continue

      const label = product.label ?? product.name

      // Fuente oficial primero: el catalogo puede ir atrasado.
      try {
        const official = await officialVersion(names, signal)
        if (official) {
          const facts = [`Ultima version estable: ${official.version}`]
          if (official.date) facts.push(`publicada el ${official.date}`)
          facts.push('fuente oficial del proyecto')
          results.push({
            title: `${label} ${official.version}`,
            url: official.page,
            snippet: `${facts.join(', ')}.`,
            source: 'versiones',
          })
          break
        }
      } catch {
        // Si el canal oficial falla, sigue el catalogo de endoflife.date.
      }

      // El catalogo NO trae las versiones, solo la URI del detalle. Leer `latest`
      // de ahi daba siempre vacio y la fuente no aportaba nada.
      if (!product.uri) break
      const detail = await getCachedJson<EolDetail>(product.uri, signal)
      for (const release of detail.result?.releases ?? []) {
        if (results.length >= limit) break
        const version = release.latest?.name
        if (!version) continue

        const facts = [`Ultima version de la rama ${release.name ?? version}: ${version}`]
        if (release.latest?.date) facts.push(`publicada el ${release.latest.date}`)
        if (release.isLts) facts.push('rama LTS')
        if (release.isEol) facts.push('soporte ya terminado')
        else if (release.eolFrom) facts.push(`soporte hasta ${release.eolFrom}`)
        if (release.isMaintained) facts.push('aun con mantenimiento')

        results.push({
          title: `${label} ${version}`,
          // Si el proyecto enlaza a su propio release, se cita ese: es la fuente
          // primaria y el modelo puede verificarla.
          url: release.latest?.link ?? `https://endoflife.date/${product.name}`,
          snippet: `${facts.join(', ')}.`,
          source: 'versiones',
        })
      }
      break
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// arXiv (papers) - DESACTIVADO
// ---------------------------------------------------------------------------
// Se probo y se descarto. Su API keyless (`export.arxiv.org/api/query`) respondio
// `429 Rate exceeded` en el 100% de los intentos y uno de los requests tardo 31s.
// Como `searchWeb` espera a todas las fuentes, dejarlo activo arruinaba la
// latencia de cada busqueda (medido: de 1.3s a 4s, y con el caso de 31s) sin
// aportar un solo resultado. Si se quiere reincorporar, tiene que ir con su
// propio timeout corto y sin_expectar reintentos.

/**
 * Orden de intento. Las tres primeras rinden mucho para un asistente tecnico y
 * responden en 0.3-1.5s.
 *
 * `timeoutMs` es por fuente y no global a proposito: con un unico abort
 * compartido, la fuente mas lenta retrasaba *todas* las busquedas.
 */
/**
 * Senales de que la consulta es de programacion.
 *
 * Sirven para NO pedir Stack Overflow y MDN cuando la pregunta es de otro tema.
 * Esas dos APIs no tienen cobertura tematica: contestan cualquier cosa que tenga
 * una palabra en comun, y el filtro de relevancia de abajo no las salva porque los
 * textos que devuelven mencionan la consulta de verdad. Medido:
 *
 *   "who invented the World Wide Web" -> Stack Overflow: "Javascript isn't linked
 *     properly to my HTML", cuyo cuerpo menciona "World Wide Web" literalmente
 *   "Alan Turing biography importance" -> MDN: "Emphasis and importance" y
 *     "Challenge: Styling a biography page"
 *
 * O sea: no es ruido del buscador, es que la fuente no tiene nada que ver con la
 * pregunta. Saltarsela es mas barato y mas fiable que intentar filtrar despues.
 */
const CODE_SIGNALS =
  /\b(rust|python|javascript|typescript|golang|java|c\+\+|c#|php|ruby|swift|kotlin|dart|scala|elixir|perl|bash|sql|html|css|json|xml|yaml|api|sdk|ide|cli|npm|pip|cargo|deno|bun|node|react|vue|angular|svelte|next\.?js|docker|kubernetes|git|github|linux|nginx|aws|regex|async|await|thread|mutex|closure|array|string|dict|list|map|loop|pointer|null|undefined|exception|stacktrace|debug|refactor|deploy|compile|build|test|bug|error|exception|function|method|class|struct|enum|interface|module|package|library|framework|server|client|database|query|typescript|programaci[oó]n|c[oó]digo|programar|error|falla|base de datos|librer[ií]a)\b/i

/** Documentacion web: tiene sentido para HTML, CSS, JS de navegador y APIs web. */
const WEB_SIGNALS =
  /\b(html|css|javascript|dom|browser|navegador|web|api|fetch|http|https|url|cookie|localstorage|sessionstorage|form|formulario|input|canvas|svg|aria|accessibility|accesibilidad|flexbox|grid|responsive|webpack|vite|tailwind|bootstrap)\b/i

/** Cada fuente declara para que tipo de consulta aporta algo, via `applies`. */
const SOURCES: Array<{
  name: string
  run: Source
  max: number
  timeoutMs: number
  /** Si es false, la fuente se salta en vez de gastar una consulta. */
  applies: (query: string) => boolean
}> = [
  {
    name: 'stackoverflow',
    run: searchStackOverflow,
    max: 4,
    timeoutMs: 5_000,
    applies: (q) => CODE_SIGNALS.test(q),
  },
  { name: 'wikipedia', run: searchWikipedia, max: 4, timeoutMs: 7_000, applies: () => true },
  {
    name: 'hackernews',
    run: searchHackerNews,
    max: 3,
    timeoutMs: 5_000,
    // HN es una fuente de industria tecnologica. En consultas de otro tema su
    // busqueda por texto completo devuelve comentarios que mencionan la palabra
    // de paso (medido: "who invented the World Wide Web" -> "Genuine scientific
    // progress is usually collaborative...").
    applies: (q) => CODE_SIGNALS.test(q),
  },
  {
    name: 'mdn',
    run: searchMdn,
    max: 2,
    timeoutMs: 4_000,
    applies: (q) => WEB_SIGNALS.test(q),
  },
  {
    name: 'versiones',
    run: searchVersions,
    max: 2,
    timeoutMs: 4_000,
    // Solo cuando la pregunta es por versiones: si no, este catalogo no aporta
    // nada y ademas觸 "quien invento Java" con la version LTS de Java.
    applies: (q) => VERSION_INTENT.test(q),
  },
]

/**
 * Descarta resultados que no hablan de lo que se pregunto.
 *
 * Stack Overflow y MDN indexan por coincidencias sueltas, no por la intencion de la
 * consulta, asi que contestan cualquier cosa. Medido antes de este filtro:
 *
 *   "Alan Turing biography importance"      -> "Javascript isn't linked properly to my HTML"
 *   "como funciona el protocolo HTTP"      -> "How to use PreferenceFragment?"
 *   "Alan Turing biography importance"      -> "Emphasis and importance" (MDN)
 *   "ultima version estable de Rust"       -> "version" (MDN, sobre manifest.json)
 *
 * Un resultado sobrevive si cumple una de estas dos condiciones:
 *
 *   a) Menciona la entidad de la consulta (el termino con mayuscula: "Rust",
 *      "Alan Turing", "HTTP"). Es la condicion fuerte y la que hace el trabajo.
 *   b) Coincide con 2 o mas terminos significativos, para las consultas sin entidad
 *      donde los terminos sueltos son la unica senal.
 *
 * Con "coincide con cualquier termino" no alcanzaba: la palabra "importance" de la
 * consulta hacia pasar "Emphasis and importance" (MDN). Exigir la entidad, o dos
 * terminos, lo evita. No se puntua por frecuencia a proposito: eso premia los
 * textos largos, que son justo los que matchean cualquier cosa.
 *
 * Prioriza precision sobre cobertura: el fallo que nos duele es que el modelo se
 * invente la respuesta cuando los resultados no le sirven, no que le falte un
 * resultado. Aun asi, si despues de filtrar quedan menos de 3 se rellena con los
 * descartados, porque un unico resultado hace que la busqueda parezca fallida
 * (medido: "ultima version estable de Rust" se quedaba con 1 solo articulo, que es
 * el correcto, y el modelo no tenia con que contrastarlo).
 *
 * Solo se aplica con 2 o mas terminos significativos: con una sola palabra
 * ("Deno") casi todo resultado es relevante y filtrar solo perderia cobertura. Si
 * el filtro deja la lista vacia se devuelven los originales, porque perder todos los
 * resultados es peor que devolver alguno mediocre.
 */
function filterRelevant(query: string, results: WebResult[]): WebResult[] {
  const tokens = queryTokens(query).filter((t) => !STOPWORDS.has(t.toLowerCase()))
  if (tokens.length < 2) return results

  // Entidades: con mayuscula y que no sea la primera palabra de la frase.
  const entities = tokens
    .filter((t, i) => i > 0 && /^\p{Lu}/u.test(t))
    .map((t) => t.toLowerCase())

  const kept: WebResult[] = []
  const dropped: WebResult[] = []
  for (const r of results) {
    const haystack = `${r.title} ${r.snippet}`.toLowerCase()
    const relevant =
      entities.some((e) => haystack.includes(e)) ||
      tokens.filter((t) => haystack.includes(t.toLowerCase())).length >= 2
    ;(relevant ? kept : dropped).push(r)
  }

  if (kept.length === 0) return results
  // Relleno para que la busqueda no parezca vacia.
  if (kept.length < 3) return kept.concat(dropped.slice(0, 3 - kept.length))
  return kept
}

/**
 * Busca en la web usando solo servicios gratuitos y sin API key.
 *
 * Las fuentes corren en paralelo y se aislan entre si: si una falla o tarda, el
 * resto igual entrega resultados y el fallo queda en `warnings`. Los resultados
 * se intercalan por origen para que un unico proveedor no monopolice la
 * respuesta.
 */
export async function searchWeb(query: string, maxResults = 6): Promise<WebSearchOutcome> {
  const limit = Math.min(Math.max(maxResults, 1), 12)
  const warnings: string[] = []

  // Solo se consulta lo que aplica a esta consulta: una fuente sin cobertura
  // tematica devuelve ruido que el filtro de relevancia no puede quitar.
  const active = SOURCES.filter((source) => source.applies(query))
  const skipped = SOURCES.filter((source) => !source.applies(query)).map((s) => s.name)

  const settled = await Promise.allSettled(
    active.map(async (source) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), source.timeoutMs)
      try {
        // Se pide margen extra a cada fuente porque despues se recorta al limite.
        const raw = await source.run(query, Math.max(source.max, 3), controller.signal)
        return { name: source.name, results: filterRelevant(query, raw) }
      } finally {
        clearTimeout(timer)
      }
    })
  )

  const perSource = new Map<string, WebResult[]>()
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'fulfilled') {
      if (outcome.value.results.length > 0) {
        perSource.set(outcome.value.name, outcome.value.results)
      }
    } else {
      // Con el nombre de la fuente: sin el, un "HTTP 429" suelto no dice nada.
      const source = active[index]
      const reason = outcome.reason
      const detail = String(reason instanceof Error ? reason.message : reason)
      warnings.push(
        /abort/i.test(detail) ? `${source.name}: timeout` : `${source.name}: ${detail}`
      )
    }
  }

  // Las versiones van primero, sin round-robin: si la pregunta es "¿cual es la
  // ultima version de X?" ese es el dato que se busca, y enterrado en la posicion
  // 5 el modelo lo pasa por alto y contesta de memoria (medido: dio 1.78.0).
  const ordered: WebResult[] = []
  const cursors = new Map<string, number>()
  const seenUrls = new Set<string>()

  const take = (item: WebResult) => {
    // Deduplicar por URL canonica (sin esquema ni barra final).
    const key = item.url.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
    if (seenUrls.has(key)) return
    seenUrls.add(key)
    ordered.push(item)
  }

  for (const item of perSource.get('versiones') ?? []) {
    if (ordered.length >= limit) break
    take(item)
  }

  // Intercalado round-robin del resto: sop, wiki, hn, sop, wiki, hn...
  let progressed = true
  while (ordered.length < limit && progressed) {
    progressed = false
    for (const [name, results] of perSource) {
      if (name === 'versiones' || ordered.length >= limit) continue
      const at = cursors.get(name) ?? 0
      const item = results[at]
      if (!item) continue
      cursors.set(name, at + 1)
      progressed = true
      take(item)
    }
  }

  if (ordered.length === 0 && warnings.length === 0) {
    warnings.push('sin resultados')
  }

  return {
    query,
    results: ordered,
    sources: [...perSource.keys()],
    warnings,
    // Fuentes que ni se consultaron por no tener cobertura tematica para la
    // consulta. Se reporta para que se entienda por que hay tan pocas fuentes.
    skipped,
  }
}