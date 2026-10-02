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
 *   5. Versiones - canales oficiales de cada proyecto (nodejs.org, GitHub Releases
 *      de Rust, python.org) y endoflife.date como respaldo.
 *
 * Cada fuente declara `applies(query)`: no todas aportan a todas las consultas y
 * una fuente sin cobertura tematica solo mete ruido.
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

/**
 * El hexadecimal faltaba y es justo el que usa Hacker News: sus comentarios vienen
 * con `&#x2F;` en cada barra de URL, asi que el texto llegaba al modelo con
 * "https:&#x2F;&#x2F;news.ycombinator.com..." y comillas sin cerrar.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
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

/**
 * Palabras vacias ES/EN: no ayudan a decidir que articulo se busca.
 *
 * La lista es amplia a proposito. Un termino que no esta aqui actua como señal de
 * relevancia y eso es peligroso: "se" e "instala" no lo estaban, y en "que es Deno y
 * como se instala" eso hacia que *cualquier* artículo en español pasara el filtro de
 * "coincide con 2 terminos" — la busqueda devolvia "Juan VII Paleólogo" y ningun
 * artículo de Deno (medido). Los términos cortos que no distinguen un tema de otro
 * son ruido con forma de señal.
 */
const STOPWORDS = new Set(
  (
    'de la el los las un una unos unas y o que en del al por para con como es son fue esta este ' +
    'estos estas hay quien cual cuales cuando donde cuanto se su sus lo le les me te nos os ya ' +
    'mas pero sino entonces aqui alli ahi ahora tambien solo solo sobre bajo entre desde hasta ' +
    'hacia segun cada todo toda todos todas otro otra otros otras mismo misma tan bien poco ' +
    'the a an of to in for on and or is are was were what which who how why when ' +
    'it its this that with be do does did i me my you your they them their there here as if then so ' +
    'not no nor but out up down about into over after before between through during'
  ).split(' ')
)

function queryTokens(query: string): string[] {
  return query.split(/[^\p{L}\p{N}+#.-]+/u).filter((t) => t.length > 1)
}

/**
 * Candidatos a entidad, ordenados por probabilidad de ser el sujeto de la consulta.
 *
 * Primero las palabras con mayuscula (nombres propios y siglas: "Alan Turing",
 * "JavaScript", "HTTP"), despues el resto de terminos significativos.
 *
 * La primera palabra tambien cuenta si es un nombre propio. Antes se
 * excluia a proposito, porque en espanol casi toda consulta empieza por "que",
 * "como" o "quien" y esas nunca son la entidad; pero esas palabras ya estan en
 * STOPWORDS, asi que excluir la posicion 0 solo damnificaba a las consultas que
 * empiezan directamente por el sujeto. Medido con las consultas que el modelo
 * genero en produccion ("Rust stable release 2026 September version 1.80"): con la
 * exclusion, "September" era la candidata #1 y `intitle:Rust` no se llegaba a
 * preguntar, gastando uno de los dos requests disponibles en la entidad correcta.
 */
function entityCandidates(query: string, max: number): string[] {
  const all = queryTokens(query)
  /**
   * Los numeros no son candidatos: no existe un articulo llamado "1.78", asi que
   * `intitle:1.78` no devuelve nada y el request se pierde. Medido sobre 17 consultas
   * reales, cambia el resultado solo cuando hay un numero suelto, y siempre a mejor:
   * "Rust 1.78 release notes" passa de ["Rust", "1.78"] a ["Rust", "release"].
   */
  const usable = (t: string) => !STOPWORDS.has(t.toLowerCase()) && /\p{L}/u.test(t)
  const isProper = (t: string) => /^\p{Lu}/u.test(t) && usable(t)

  /**
   * Dos mayusculas encadenadas forman UNA entidad.
   *
   * "Alan Turing" se partia en "Alan" y "Turing", y Wikipedia tiene un articulo
   * legitimo llamado "Alan" (sobre el nombre): `intitle:Alan` lo devuelve primero y
   * ganaba al de la persona (medido). Nombre + apellido es el caso normal, asi que
   * solo se agrupan pares.
   *
   * Tres en cadena NO se agrupan: en "diferencia entre Promise.all y
   * Promise.allSettled en Node" las palabras cortas "y" y "en" desaparecen al
   * tokenizar y las tres propias quedan contiguas, dando la entidad inventada
   * "Promise.all Promise.allSettled Node" (medido).
   */
  const phrases: string[] = []
  for (let i = 0; i + 1 < all.length; i++) {
    // Un punto ya une el nombre con su miembro: "Promise.all" ya es una unidad, y
    // agruparla con la siguiente daria "Promise.all Promise.allSettled" (medido).
    const dotted = (t: string) => /[.+#]/.test(t)
    if (isProper(all[i]) && isProper(all[i + 1]) && !dotted(all[i]) && !dotted(all[i + 1])) {
      phrases.push(`${all[i]} ${all[i + 1]}`)
    }
  }

  const proper = all.filter(isProper)
  const rest = all.filter((t) => usable(t) && !proper.includes(t))

  const seen = new Set<string>()
  const out: string[] = []
  for (const token of [...phrases, ...proper, ...rest]) {
    const key = token.toLowerCase()
    if (seen.has(key) || out.some((o) => o.toLowerCase().includes(key))) continue
    seen.add(key)
    out.push(token)
    if (out.length >= max) break
  }
  return out
}

type WikiGenerator = {
  query?: {
    pages?: Record<string, { title: string; pageid: number; extract?: string }>
  }
}

type WikiHit = {
  title: string
  pageid: number
  extract: string
  lang: string
}

/**
 * Desambiguacion.
 *
 * Con `intitle:Rust` el primer resultado es la pagina homonima ("Rust" el album,
 * el municipio, la pelicula) y no el lenguaje de programacion. Se detecta por el
 * texto de la introduccion, que es consistente en ambos idiomas: una pagina de
 * desambiguacion empieza por "X puede referirse a" / "X may refer to".
 *
 * (La via obvia seria `pageprops.disambiguation`, pero con `generator=search` el
 * array `pageprops` llega vacio — medido — asi que no es utilizable.)
 *
 * Se descartan, pero solo si queda alternativa: para consultas genuinamente
 * ambiguas ("Rust" a secas) esa pagina es la respuesta correcta.
 */
const DISAMBIGUATION = /puede referirse a|may refer to|is a disambiguation/i

function isDisambiguation(hit: WikiHit): boolean {
  return DISAMBIGUATION.test(hit.extract)
}

/**
 * Busqueda + extracto en un solo request.
 *
 * `generator=search` con `prop=extracts` devuelve los articulos y su parrafo
 * introductorio en la misma consulta; antes se hacia `list=search` y luego una
 * segunda llamada a `prop=extracts`. No es un detalle menor: el plan gratis de
 * Cloudflare Workers permite 50 subrequests por invocacion y la version de dos
 * llamadas gastaba 14 requests por busqueda, con lo cual `/api/chat` moria con
 * HTTP 500 "Too many subrequests by single Worker invocation" en cuanto el modelo
 * hacia tres búsquedas. Medido: 14 -> 6 requests, sin perder relevancia.
 */
async function wikiSearch(lang: string, gsrsearch: string, signal: AbortSignal): Promise<WikiHit[]> {
  const data = await getJson<WikiGenerator>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(gsrsearch)}&gsrlimit=3&gsrnamespace=0` +
      `&prop=extracts&exintro=1&exsentences=3&explaintext=1&redirects=1&format=json&origin=*`,
    signal
  )
  return Object.values(data.query?.pages ?? {})
    .map((page) => ({
      title: page.title,
      pageid: page.pageid,
      extract: stripTags(page.extract ?? ''),
      lang,
    }))
    .filter((hit) => hit.extract !== '')
}

/**
 * Busca articulos y ademas trae el parrafo introductorio de cada uno.
 *
 * ------------------------------------------------------------------
 * POR QUE NO SE BUSCA LA FRASE COMPLETA Y YA
 * ------------------------------------------------------------------
 * `gsrsearch` con el texto crudo indexa por OR de terminos, asi que cualquier
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
 * Lo que si funciona es combinar la consulta completa con `intitle:` sobre la
 * entidad, porque cada una le acierta a un caso distinto:
 *
 *   1. la consulta completa         indexada por OR, pero es la unica que
 *                                   entiende "ultima version estable de Rust" y
 *                                   ahi coloca "Rust (lenguaje de programacion)"
 *                                   en el primer lugar
 *   2. `intitle:ent1`              entidad de una palabra: rescata "como se usa un
 *                                   mutex en Rust", donde la consulta completa
 *                                   devuelve articulos sobre concurrencia pero no
 *                                   sobre el lenguaje
 *   3. `intitle:ent2`              segunda candidata, cubre "World Wide Web" y casos
 *                                   donde la entidad son dos palabras
 *
 * Se ejecutan las tres siempre, sin cortar por cuota, y el ranking se arma por
 * orden de llegada (gana la primera estrategia que encontro el articulo).
 *
 * ------------------------------------------------------------------
 * POR QUE TRES ESTRATEGIAS Y NO MAS
 * ------------------------------------------------------------------
 * El limite duro es de requests, no de relevancia: en el plan gratis cada
 * invocacion de Worker admite 50 subrequests, y Wikipedia son 2 requests por
 * estrategia (es + en). Con cuatro estrategias eran 8 por busqueda mas los extractos
 * aparte (14 en total) y `/api/chat` devolvia HTTP 500 "Too many subrequests by
 * single Worker invocation" en cuanto el modelo encadenaba tres busquedas.
 *
 * Se midieron cuatro planes sobre 8 consultas reales (las de abajo), contando si el
 * articulo correcto aparecia en el top-4:
 *
 *   P1  completa + intitle x2            8/8   6 requests   <- elegido
 *   P2  completa + frase + intitle       8/8   6 requests
 *   P3  intitle x2 + completa            8/8   6 requests
 *   P4  completa + intitle x2 + frase    8/8   8 requests
 *
 * P1 va primero para no diluir: la consulta completa es la que mejor ordena, asi
 * que sus resultados llenan el top antes de que lleguen los de `intitle:`.
 */
/**
 * Normaliza un titulo de Wikipedia para compararlo con la entidad de la consulta:
 * sin articulo inicial, sin puntuacion y en minusculas. El parentesis se conserva.
 *
 * Se conservapropósito: el parentesis ES la desambiguacion de Wikipedia
 * ("Rust (lenguaje de programacion)", "Rust (pelicula)") y es lo unico que
 * distingue una cosa de otra. Quitarlo hacia que ambas se normalizaran a "rust" y
 * el titulo de la pelicula ganara al del lenguaje (medido). Los titulos que no
 * llevan parentesis son los que hay que tratar aparte.
 */
function subjectOf(title: string): string {
  return title
    .replace(/^(?:el|la|los|las|the|a|an)\s+/i, '')
    .replace(/[^\p{L}\p{N}+#.\s()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Separa "rust (lenguaje de programacion)" en ["rust", "lenguaje de programacion"]. */
function splitQualifier(normalized: string): [string, string] {
  const at = normalized.indexOf('(')
  if (at === -1) return [normalized, '']
  return [normalized.slice(0, at).trim(), normalized.slice(at + 1).replace(/\)$/, '').trim()]
}

const searchWikipedia: Source = async (query, limit, signal) => {
  const candidates = entityCandidates(query, 3)

  const seen = new Set<string>()
  const hits: WikiHit[] = []
  const collect = (found: WikiHit[]) => {
    for (const hit of found) {
      const key = `${hit.lang}:${hit.title}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push(hit)
    }
  }

  // Secuencial, no en paralelo: son 6 requests fijos y medidos, y ademas el orden de
  // llegada es el orden del ranking.
  for (const search of [query, ...candidates.slice(0, 2).map((c) => `intitle:${c}`)]) {
    for (const lang of ['es', 'en']) {
      try {
        collect(await wikiSearch(lang, search, signal))
      } catch {
        // Un idioma puede fallar sin invalidar el otro.
      }
    }
  }

  // Descartar paginas de desambiguacion, pero solo si queda alternativa: para
  // "Rust" a secas la pagina que lista todos los sentidos es la respuesta buena.
  const specific = hits.filter((h) => !isDisambiguation(h))
  const pool = specific.length > 0 ? specific : hits

  /**
   * Ranking por cuanto se parece el articulo a la entidad, no solo por mencionarla.
   *
   * El orden de llegada de Wikipedia es bueno cuando la consulta es una pregunta
   * directa, pero con las consultas que arma el modelo ("que es Deno y como se
   * instala") la estrategia de texto completo devuelve puros articulos que no la
   * nombran, y el artículo de Deno, que llega despues via `intitle:`, ya se habia
   * quedado fuera del corte: el filtro de relevancia de abajo nunca lo veía y la
   * busqueda devolvia "Juan VII Paleologo" (medido).
   *
   * Ordenar por "menciona la entidad" no basta, porque el homónimo tambien la
   * menciona: "Rust in Peace" contains "Rust" y ganaba a "Rust (programming
   * language)" (medido). Se ordena por cuatro niveles, y dentro de cada nivel se
   * respeta el orden de llegada:
   *
   *   1. el titulo ES la entidad, sin calificador   "Deno", "PostgreSQL"
   *   2. el titulo es la entidad + un calificador    "Rust (lenguaje de programacion)"
   *   3. el titulo empieza por la entidad suelta     "Rust in Peace"
   *   4. la entidad solo aparece en el texto
   *
   * El nivel 2 va antes que el 3 porque cuando Wikipedia titula "Rust (algo)" esta
   * diciendo que ese "algo" es el Rust de la entidad; "Rust in Peace" en cambio es un
   * titulo propio que casualmente empieza igual.
   *
   * Todo es local: no cuesta un solo request y solo reordena, nada se descarta.
   */
  const entities = candidates.map((c) => subjectOf(c))
  const tier = (hit: WikiHit): number => {
    const title = subjectOf(hit.title)
    const [base, qualifier] = splitQualifier(title)
    if (entities.includes(base) && qualifier === '') return 0
    if (entities.includes(base)) return 1
    if (entities.some((e) => base.startsWith(e))) return 2
    const haystack = `${hit.title} ${hit.extract}`.toLowerCase()
    return entities.some((e) => haystack.includes(e)) ? 3 : 4
  }
  // Array#sort es estable en V8: dentro de cada nivel se respeta el orden de llegada.
  const ranked = [...pool].sort((a, b) => tier(a) - tier(b))

  // Se pasan mas candidatos de los que se piden porque el ranking de arriba solo ordena
// por parecido a la entidad, no descarta: un homonimo ("Rust in Peace") tambien la
// menciona. El filtro de relevancia de abajo es quien lo descarta, y para eso tiene
// que verlo. Sin este margen, "que es Deno y como se instala" se quedaba sin ningun
// articulo sobre Deno (medido).
return ranked.slice(0, limit * 2).map((hit) => ({
    title: hit.title,
    url: `https://${hit.lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    snippet: clamp(hit.extract, 700),
    source: 'wikipedia',
  }))
}

// ---------------------------------------------------------------------------
// Stack Overflow
// ---------------------------------------------------------------------------

/**
 * Nota sobre el rate limit.
 *
 * La API de Stack Exchange limita por IP y las de datacenter estan compartidas. La
 * respuestas no es siempre la misma, y eso importa: medido alternando
 * `HTTP 429` y `HTTP 400`, ambos por throttling (el 400 es el `error_id 502` de
 * Stack Exchange, no un parametro mal formado). En 18 de 18 llamadas seguidas desde
 * el egress de Cloudflare fallo. En desarrollo, con la IP de casa, respondia bien.
 *
 * No se arregla: no hay key gratuita que lo evite. Lo que si se puede es no seguir
 * pagando por el. Cada intento fallido gasta uno de los 50 subrequests de la
 * invocacion y devuelve 0 resultados, o sea que es el peor gasto posible — por eso
 * `applies` hace un corte de circuito tras un fallo (ver
 * `stackOverflowThrottled`). Cuando la cuota del datacenter se restablece, la fuente
 * vuelve sola sin tocar el codigo.
 */

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

/** Cuanto aguanta el corte de circuito antes de volver a intentarlo. */
const STACKOVERFLOW_BREAKER_MS = 30 * 60_000
let stackOverflowBlockedUntil = 0

/**
 * Si la ultima llamada fue throttled, la fuente se salta entera.
 *
 * El corte es global a la fuente, no por consulta: el limite es de IP, asi que un
 * termino distinto tampoco va a pasar.
 */
function stackOverflowThrottled(): boolean {
  return Date.now() < stackOverflowBlockedUntil
}

const searchStackOverflow: Source = async (query, limit, signal) => {
  try {
    const data = await getJson<StackExchange>(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance` +
        `&q=${encodeURIComponent(query)}&site=stackoverflow&filter=withbody` +
        `&pagesize=${limit}`,
      signal
    )
    // Un OK borra el corte: la cuota se libero.
    stackOverflowBlockedUntil = 0

    return (data.items ?? []).slice(0, limit).map((item) => ({
      title: stripTags(item.title),
      url: item.link,
      snippet: clamp(
        stripTags(item.body ?? '') || `puntaje ${item.score}, ${item.answer_count} respuestas`,
        600
      ),
      source: 'stackoverflow',
    }))
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error)
    if (/HTTP (400|429)/.test(detail)) {
      stackOverflowBlockedUntil = Date.now() + STACKOVERFLOW_BREAKER_MS
    }
    throw error
  }
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

/**
 * Solo `story`, nunca `comment`.
 *
 * Antes se pedian las dos y la API devolvia comentarios como si fueran resultados.
 * Medido con "que es Deno": de 6 resultados, 3 fueron comentarios sobre_party_,
 * xenofobia y matrimonio del mismo sexo, con "deno" apareciendo de pasada en el cuerpo.
 * El motivo es que la busqueda es de texto completo, asi que cualquier hilo donde se
 * mencione la palabra qualify.
 *
 * Un comentario no sirve como fuente por dos razones concretas:
 *   - No tiene titulo. El que se synthesize con `comment_text.slice(0, 80)` sale a
 *     medias, con la frase cortada y sin punto, y es lo que el modelo leeria.
 *   - No es citable como afirmacion. Es la opinion de alguien en un hilo, sin
 *     contexto ni fecha, que es exactamente lo que hace que el modelo invente.
 *
 * Un filtro por longitud minima se probo antes y no sirvio de nada: los comentarios
 * de ruido tambien son largos, algunos de 1.500 caracteres. El problema no era la
 * extension sino el tipo de documento, asi que el corte va en la consulta.
 *
 * Lo que se pierde es la señal "la industria comenta esto", que tampoco era
 * accionable: sin forma de citar un comentario no hay nada que responder con el.
 */
const searchHackerNews: Source = async (query, limit, signal) => {
  const data = await getJson<HnAlgolia>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=${limit}`,
    signal
  )

  const results: WebResult[] = []
  for (const hit of data.hits ?? []) {
    if (results.length >= limit) break
    if (!hit.title) continue

    const hnId = (hit as { objectID?: string }).objectID
    const body = stripTags(hit.story_text ?? '')
    const snippet = body || `${hit.points ?? 0} puntos, ${hit.num_comments ?? 0} comentarios`
    results.push({
      title: clamp(stripTags(hit.title), 160),
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
// Changelogs (GitHub Releases)
// ---------------------------------------------------------------------------

/**
 * Notas de version reales, que es lo que faltaba.
 *
 * Sin esto el modelo se inventaba el contenido de un release: preguntando por las
 * novedades de Rust 1.99.0 contesto "Generic Associated Types (GAT) stabilisation",
 * un texto plausible pero falso — las fuentes disponibles solo dean el numero de
 * version. Con el cuerpo del release ya no hay nada que inventar.
 *
 * GitHub responde sin token (60 req/h por IP) y `releases/latest` trae el `body`
 * completo: para Rust son 11.351 caracteres de cambios reales, para Deno 2.677.
 *
 * Limitaciones, dichas sin rodeos:
 *   - El limite de 60/h es por IP y las de datacenter estan compartidas. Se mitiga
 *     con la cache de 10 min de modulo y porque solo se consulta cuando la pregunta
 *     es por versiones, no en cada busqueda. Si se agota, el 429 viaja en `warnings`.
 *   - Solo hay repositorio para los proyectos con GitHub. Node.js tambien, pero su
 *     release notes estan en el repo y no en el blog: se cita el que corresponda.
 */
const RELEASE_SOURCES: Array<{
  match: string[]
  repo: string
  project: string
}> = [
  { match: ['rust', 'rustlang', 'rust-lang'], repo: 'rust-lang/rust', project: 'Rust' },
  { match: ['deno'], repo: 'denoland/deno', project: 'Deno' },
  { match: ['nodejs', 'node'], repo: 'nodejs/node', project: 'Node.js' },
  { match: ['typescript'], repo: 'microsoft/TypeScript', project: 'TypeScript' },
  { match: ['python', 'cpython'], repo: 'python/cpython', project: 'Python' },
  { match: ['go', 'golang'], repo: 'golang/go', project: 'Go' },
  { match: ['docker'], repo: 'docker/cli', project: 'Docker' },
  { match: ['react'], repo: 'facebook/react', project: 'React' },
  { match: ['django'], repo: 'django/django', project: 'Django' },
  { match: ['flask'], repo: 'pallets/flask', project: 'Flask' },
  { match: ['fastapi'], repo: 'fastapi/fastapi', project: 'FastAPI' },
  { match: ['vue'], repo: 'vuejs/core', project: 'Vue' },
  { match: ['django-rest-framework'], repo: 'encode/django-rest-framework', project: 'DRF' },
  { match: ['postgres', 'postgresql'], repo: 'postgres/postgres', project: 'PostgreSQL' },
  { match: ['sqlite'], repo: 'sqlite/sqlite', project: 'SQLite' },
]

type GithubRelease = {
  tag_name?: string
  name?: string
  published_at?: string
  html_url?: string
  body?: string
}

/**
 * El body de un release es markdown con anchors, badges y listas de PR.
 *
 * Se limpia a texto plano porque el modelo lo lee como contexto, no como documento:
 * los badges de CI no aportan nada y los `https:/` rotos de los enlaces pegados en
 * las URLs solo gastan tokens (Rust viene con PRs https:/github...).
 */
function releaseNotes(body: string): string {
  return stripTags(
    body
      .replace(/<[^>]*>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-=*_#]{3,}\s*$/gm, ' ')
      .replace(/https:\/\/github\.com\S+/g, ' ')
  )
}

/** Frases que delatan que el body no habla de la pregunta. */
const RELEASE_NOISE =
  /^\s*(full changelog|see the (full )?changelog|changelog|what'?s changed|installation|how to (install|use)|docker|workflow ci|ci\b|build\b|deps|dependabot|chore|no changes)\b/i

/**
 * El body de un release arranca con las secciones que importan; el resto es
 * boilerplate que se repite en cada version y no ayuda a responder.
 *
 * Se corta en la tercera linea en blanco: para Rust, "Language / Cargo / Library /
 * Stabilized APIs" esta al principio y "Builds & Artifacts" al final. Para un
 * proyecto sin estructura de secciones el cuerpo entero cabe en esehueco.
 */
function topSections(body: string): string {
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim() !== '')
  const kept: string[] = []
  let blanks = 0
  for (const p of paragraphs) {
    if (RELEASE_NOISE.test(p.trim())) continue
    kept.push(p.trim())
    if (!/^\s*[-*+] |^\s*\d+\./m.test(p)) {
      // Parrafo que no es una lista: cuenta como frontera de seccion.
      blanks++
      if (blanks >= 3) break
    }
    if (kept.length >= 12) break
  }
  return kept.join('\n')
}

const searchReleases: Source = async (query, limit, signal) => {
  const tokens = queryTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => !STOPWORDS.has(t) && !VERSION_INTENT.test(t))

  const results: WebResult[] = []
  for (const token of tokens) {
    if (results.length >= limit) break
    const source = RELEASE_SOURCES.find((s) =>
      s.match.some((m) => m === token || (token.length >= 5 && m.startsWith(token)))
    )
    if (!source) continue

    try {
      const data = await getCachedJson<GithubRelease>(
        `https://api.github.com/repos/${source.repo}/releases/latest`,
        signal
      )
      const body = releaseNotes(data.body ?? '')
      if (body === '') continue

      const tag = data.name || data.tag_name || ''
      const when = data.published_at?.slice(0, 10)
      const facts = [`Notas de la version ${tag}`.trim()]
      if (when) facts.push(`publicada el ${when}`)

      /**
       * `name` ya trae el proyecto en algunos repos ("Rust 1.99.0"), asi que
       * anteponer el nombre del proyecto duplicaba: "Rust Rust 1.99.0".
       */
      const label = tag.toLowerCase().includes(source.project.toLowerCase())
        ? tag
        : `${source.project} ${tag}`

      results.push({
        title: `${label} — notas de la version`.trim(),
        url: data.html_url ?? `https://github.com/${source.repo}/releases`,
        snippet: clamp(`${facts.join(', ')}.\n\n${topSections(body)}`, 1200),
        source: 'releases',
      })
    } catch (error) {
      /**
       * Se propaga en vez de tragarselo, pero sin abortar la busqueda.
       *
       * GitHub sin token son 60 req/h por IP y las de datacenter estan
       * compartidas, asi que el 429 es esperable. Propagarlo hacia que
       * `searchWeb` lo metiera en `warnings` y se viera, que es justo lo que
       * hacia falta para saber que la fuente no estaba entregando. `versiones` sigue
       * dando el numero de version, que es lo esencial.
       */
      const detail = String(error instanceof Error ? error.message : error)
      throw new Error(detail === 'HTTP 429' ? 'GitHub: HTTP 429 (60/h por IP)' : detail)
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

/**
 * Cache de busquedas recientes, por terminos significativos.
 *
 * Existe por el limite de subrequests por invocacion (50 en el plan gratis de
 * Workers), no por rendimiento: el modelo repite la misma pregunta reformulada y
 * cada repeticion gasta las descargas enteras otra vez.
 */
const recentSearches = new Map<string, { at: number; value: WebSearchOutcome }>()
const RECENT_TTL_MS = 90_000

/**
 * Senal de que la pregunta es por novedades de una version.
 *
 * Distinta de `VERSION_INTENT` a proposito: ahi basta con que aparezca un numero
 * ("Rust 1.78 release notes"), que es justo el caso donde las notas de la version
 * SI interesan. Aqui se exige ademas que se pregunte por el contenido del release
 * —"novedades", "cambios", "release notes", "qué trae"— porque si solo se busca el
 * numero, la respuesta son dos lineas y el changelog completo es ruido.
 */
/**
 * El usuario pregunta por el CONTENIDO de una release, no por su numero.
 *
 * Se aplica sola, sin cruzarla con `VERSION_INTENT`: "que novedades trae Deno
 * changelog" no contiene ni un numero ni la palabra "version", asi que exigir las dos
 * cosas dejaba la fuente apagada justo en el caso que la pediria (medido: cero notas
 * de version para esa consulta). "Changelog" y "release notes" ya son senal
 * suficiente por si solas.
 *
 * "cambios" queda fuera a proposito: es ambiguo ("cambios en este archivo") y solo no
 * distingue un changelog de una pregunta por cualquier otra cosa.
 */
const RELEASE_INTENT =
  /\b(release notes?|changelog|notas? de (la )?(version|release)|novedades|nuevas? (funciones|caracter[ií]sticas)|what'?s new|que (trae|incluye)|breaking changes?)\b/i

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
    // El corte de circuito evita el gasto, no el fallo: si la IP del datacenter
    // esta throttled la fuente se salta sin gastar un subrequest.
    applies: (q) => CODE_SIGNALS.test(q) && !stackOverflowThrottled(),
  },
  { name: 'wikipedia', run: searchWikipedia, max: 4, timeoutMs: 7_000, applies: () => true },
  {
    name: 'releases',
    run: searchReleases,
    max: 2,
    timeoutMs: 4_000,
    applies: (q) => RELEASE_INTENT.test(q),
  },
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
    // nada y ademas responde "quien invento Java" con la version LTS de Java.
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
 * invente la respuesta cuando los resultados no le servi, no que le falte un
 * resultado. Aun asi, si despues de filtrar quedan menos de 3 se rellena con los
 * descartados, porque un unico resultado hace que la busqueda parezca fallida
 * (medido: "ultima version estable de Rust" se quedaba con 1 solo articulo, que es
 * el correcto, y el modelo no tenia con que contrastarlo).
 *
 * Si hay entidad con mayuscula, el filtro se aplica aunque la consulta tenga un
 * solo terminosignificativo: "que es PostgreSQL" deja un unico termino, y sin
 * filtrar la wikipedia inglesa devolvia "Tilde" y "Wikiloc" al lado del articulo
 * correcto (medido). Sin entidad y con un solo termino ("Deno") no se filtra nada:
 * ahi casi todo resultado es relevante y filtrar solo perderia cobertura. Si el
 * filtro deja la lista vacia se devuelven los originales, porque perder todos los
 * resultados es peor que devolver alguno mediocre.
 */
function filterRelevant(query: string, results: WebResult[]): WebResult[] {
  const raw = queryTokens(query)
  const tokens = raw.filter((t) => !STOPWORDS.has(t.toLowerCase()))

  /**
   * Entidades: terminos con mayuscula.
   *
   * La posicion se mira sobre los tokens ORIGINALES, no sobre los ya filtrados de
   * palabras vacias: en "que es PostgreSQL", quitando "que" y "es", la entidad queda
   * en el indice 0 y el filtro la deja de tratar como entidad (medido: el articulo
   * de Wikipedia "Tilde" se colaba en los resultados).
   *
   * La primera palabra SI cuenta como entidad, y antes no contaba. La regla era
   * "con mayuscula y que no sea la primera", pensada para el caso habitual en espanol
   * donde la frase empieza por "que", "como" o "quien" — pero esas palabras ya estan
   * en STOPWORDS, asi que la exclusion solo dejaba fuera a la entidad real cuando la
   * consulta empieza directamente por ella. Medido sobre 15 consultas reales
   * (incluidas las que el modelo hizo en produccion, que empiezan por "Rust ..."):
   * sin esta correccion, "Rust 1.78 release notes" descartaba el resultado correcto
   * por ser la entidad en posicion 0, y el relleno lo devolvia al final de la lista.
   */
  const entities = raw
    .filter((t) => /^\p{Lu}/u.test(t) && !STOPWORDS.has(t.toLowerCase()))
    .map((t) => t.toLowerCase())

  if (entities.length === 0 && tokens.length < 2) return results

  /**
   * Si la consulta tiene entidad, se exige que aparezca.
   *
   * Antes la alternativa "coincide con 2 terminos" hacia de segunda a cualquier
   * resultado que compartiera dos palabras sueltas con la consulta, incluso con la
   * entidad presente y sin mencionarla. Medido: "que es Deno y como se instala"
   * devolvia "Giovanni Verga", "Luis I de Hungria" y "Juan VII Paleologo" — todos
   * pasaban por las palabras "se"/"instalar", ninguno era sobre Deno.
   *
   * La excepcion es cuando la entidad NO sobrevive al filtro en ningun sitio: ahi
   * se acepta la coincidencia por terminos, porque no exigirla dejaria la busqueda
   * vacia, que es peor que devolver algo mediocre.
   */
  const kept: WebResult[] = []
  const dropped: WebResult[] = []
  const byTerms: WebResult[] = []
  for (const r of results) {
    const haystack = `${r.title} ${r.snippet}`.toLowerCase()
    const mentionsEntity = entities.some((e) => haystack.includes(e))
    const termHits = tokens.filter((t) => haystack.includes(t.toLowerCase())).length
    if (mentionsEntity) kept.push(r)
    else if (termHits >= 2) byTerms.push(r)
    else dropped.push(r)
  }

  // La entidad manda: si hay articulos que la nombran, los demas solo entran por
  // relleno al final, nunca por delante.
  const pool = kept.length > 0 ? kept : byTerms.length > 0 ? byTerms : results

  // Relleno para que la busqueda no parezca vacia: un unico resultado hace que la
  // busqueda parezca fallida (medido: "ultima version estable de Rust" se quedaba con
  // un solo articulo —el correcto— y el modelo no tenia con que contrastarlo).
  if (pool.length < 3) return pool.concat(dropped.slice(0, 3 - pool.length))
  return pool
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

  /**
   * Consultas equivalentes no se vuelven a ejecutar.
   *
   * El limite de 50 subrequests es por invocacion, y el modelo tiende a repetir la
   * pregunta: en una sesion real encadeno "latest stable Rust version 2026", "Rust
   * 1.80 stable release" y "Rust stable release 2026 version" — tres descargas
   * distintas de practicamente lo mismo. La clave es el conjunto de terminos
   * significativos, no el texto: asi las tres caerian en la misma entrada.
   *
   * TTL corto a proposito (90 s): sirve para las repreguntas de una misma
   * invocacion, que es justo donde el limite duele, y no sirve para responder
   * "de nuevo" con contenido viejo.
   */
  const cacheKey = queryTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => !STOPWORDS.has(t))
    .sort()
    .join('|')
  const cached = cacheKey ? recentSearches.get(cacheKey) : undefined
  if (cached && Date.now() - cached.at < RECENT_TTL_MS) {
    return { ...cached.value, query, warnings: [...cached.value.warnings] }
  }

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

  // `versiones` y `releases` van primero, sin round-robin. Si la pregunta es "¿cual
  // es la ultima version de X?" ese es el dato que se busca, y enterrado en la
  // posicion 5 el modelo lo pasa por alto y contesta de memoria (medido: dio
  // 1.78.0). Las notas de la version van antes que el numero: si la pregunta pide
  // novedades, el changelog es la respuesta y el numero es el contexto.
  //
  // Cada una agota sus resultados antes de pasar a la siguiente: si se metieran en un
  // unico bucle round-robin, la de versiones (2 resultados) dejaria a las notas para
  // la posicion 2 o 3, que es donde el modelo deja de leerlas.
  const PRIORITY = ['releases', 'versiones']
  const ordered: WebResult[] = []
  const cursors = new Map<string, number>()
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()

  const take = (item: WebResult) => {
    // Deduplicar por URL canonica (sin esquema ni barra final).
    const key = item.url.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase()
    if (seenUrls.has(key)) return
    seenUrls.add(key)

    /**
     * Deduplicar por contenido, entre idiomas.
     *
     * Wikipedia se consulta en español e ingles, asi que el mismo articulo vuelve dos
     * veces con URL distintas y la de-duplicacion por URL no lo nota. Medido: "Alan
     * Turing biography" devolvia el mismo texto en es y en, y "que es Deno" repetia
     * "Deno (software)" dos veces. Son dos huecos de 6 y dos bloques de texto
     * identico para el modelo.
     *
     * Se descarta el duplicado, no el par, y sin comparar el cuerpo: las diferencias
     * entre la version en español y la inglesa suelen ser de redaccion, no de
     * contenido, asi que basta con el titulo. Cuando los titulos difieren ("Rust" vs
     * "Rust (lenguaje de programacion)") se conservan los dos, que es lo correcto.
     */
    const titleKey = item.title.toLowerCase().replace(/\s+/g, ' ')
    if (seenTitles.has(titleKey)) return
    seenTitles.add(titleKey)

    ordered.push(item)
  }

  for (const name of PRIORITY) {
    for (const item of perSource.get(name) ?? []) {
      if (ordered.length >= limit) break
      take(item)
    }
  }

  // Intercalado round-robin del resto: sop, wiki, hn, sop, wiki, hn...
  let progressed = true
  while (ordered.length < limit && progressed) {
    progressed = false
    for (const [name, results] of perSource) {
      if (PRIORITY.includes(name) || ordered.length >= limit) continue
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

  const outcome: WebSearchOutcome = {
    query,
    results: ordered,
    sources: [...perSource.keys()],
    warnings,
    // Fuentes que ni se consultaron por no tener cobertura tematica para la
    // consulta. Se reporta para que se entienda por que hay tan pocas fuentes.
    skipped,
  }

  if (cacheKey) recentSearches.set(cacheKey, { at: Date.now(), value: outcome })

  return outcome
}