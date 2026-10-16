/**
 * Puente repositorio → vault de Obsidian (cerebro).
 *
 * Copia la documentación del proyecto (`README.md`, `ROADMAP.md`, `REPO_MAP.md`)
 * a una carpeta del vault para que quede visible en Obsidian y, además, se
 * indexe en la tabla `VaultNote`, que es la única vía por la que el cerebro
 * encuentra notas del vault cuando corre en el Worker (ahí no hay disco).
 *
 * Acá vive solo lo PURO (rutas y texto), para poder testearlo sin tocar el
 * disco ni la base (ver `tests/unit/vault-docs.test.ts`).
 */

export interface DocSource {
  /** Ruta del archivo, relativa al repositorio. */
  src: string
  /** Nombre del archivo dentro de la carpeta destino del vault. */
  dest: string
}

/** Documentación del proyecto que se copia al vault. */
export const PROJECT_DOCS: DocSource[] = [
  { src: 'README.md', dest: 'README.md' },
  { src: 'ROADMAP.md', dest: 'ROADMAP.md' },
  { src: 'REPO_MAP.md', dest: 'REPO_MAP.md' },
]

/** Carpeta por defecto dentro del vault (se puede cambiar con `--dest`). */
export const DEFAULT_DEST = 'ARIA/Repositorio ai-assistant'

/** Primer encabezado `# …` del contenido, o `fallback` si no hay. */
export function firstHeading(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : fallback.trim()
}

/** Une dos segmentos con `/`, sin barras de sobra (las rutas del vault usan `/`). */
export function vaultRelPath(dir: string, file: string): string {
  return [dir, file]
    .map((s) => s.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * Envuelve un documento con metadatos y un aviso para Obsidian.
 *
 * El contenido original se conserva tal cual (encabezado incluido) para que
 * Obsidian lo titule igual; el aviso va ANTES y sin `#` para no confundir el
 * título automático.
 */
export function renderDoc(opts: {
  source: string
  content: string
  generatedAt: string
}): string {
  const body = opts.content.replace(/^\uFEFF/, '').trimEnd()
  return [
    '---',
    'tags:',
    '  - aria',
    '  - proyecto',
    '  - documentacion',
    `origen: ${opts.source}`,
    `generado: ${opts.generatedAt}`,
    'generado-por: aria-docs-to-vault',
    '---',
    '',
    '> [!info] Copia automática',
    `> Este archivo se copia desde el repositorio del proyecto (\`${opts.source}\`). No lo edites aquí: se sobrescribe en la próxima copia.`,
    '',
    body,
    '',
  ].join('\n')
}
