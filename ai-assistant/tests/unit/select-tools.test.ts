import { describe, expect, it } from 'vitest'
import { selectTools, TOOL_GROUPS } from '@/app/lib/aria-core'
import { TOOL_DEFINITIONS } from '@/app/lib/tools'

const user = (content: string) => ({ role: 'user', content })
const names = (content: string, hasRepos = false) =>
  new Set(selectTools(user(content), hasRepos))

describe('selectTools', () => {
  it('no ofrece NINGUNA herramienta en charla normal (coste cero)', () => {
    expect(selectTools(user('hola'), false)).toEqual([])
    expect(selectTools(user('¿cómo estás?'), false)).toEqual([])
    expect(selectTools(user('cuéntame un chiste'), false)).toEqual([])
    expect(selectTools(null, false)).toEqual([])
    expect(selectTools(undefined, false)).toEqual([])
    expect(selectTools(user('   '), false)).toEqual([])
  })

  it('incluye la hora solo cuando se pregunta hora/fecha', () => {
    expect(names('¿qué hora es?').has('get_time')).toBe(true)
    expect(names('dime la fecha de hoy').has('get_time')).toBe(true)
    expect(names('cuéntame un chiste').has('get_time')).toBe(false)
  })

  it('incluye calculate con operaciones o porcentajes', () => {
    expect(names('calcula 2+2').has('calculate')).toBe(true)
    expect(names('¿cuánto es 15% de 240?').has('calculate')).toBe(true)
    expect(names('¿cuál es la capital de Francia?').has('calculate')).toBe(false)
  })

  it('incluye web_search cuando se pide buscar', () => {
    expect(names('busca en la web cómo instalar Deno').has('web_search')).toBe(true)
    expect(names('¿qué noticias hay de Rust?').has('web_search')).toBe(true)
    expect(names('resume este texto').has('web_search')).toBe(false)
  })

  it('incluye las notas del vault y NO busca en la web', () => {
    const tools = names('¿qué notas tengo sobre Postgres?')
    expect(tools.has('search_vault')).toBe(true)
    expect(tools.has('semantic_search_vault')).toBe(true)
    expect(tools.has('web_search')).toBe(false)
  })

  it('gatea github por repos configurados, salvo repo explícito', () => {
    expect(names('revisa los issues de mi repo', false).has('github_list_issues')).toBe(false)
    const withRepos = names('revisa los issues de mi repo', true)
    expect(withRepos.has('github_repo_overview')).toBe(true)
    expect(withRepos.has('github_list_issues')).toBe(true)

    const explicit = names('mira github.com/facebook/react', false)
    expect(explicit.has('github_read_file')).toBe(true)
    expect(explicit.has('github_create_pull_request')).toBe(false)

    const write = names('modifica el código de mi repo y crea un pull request', true)
    expect(write.has('github_read_file')).toBe(true)
    expect(write.has('github_create_pull_request')).toBe(true)

    const reviewPr = names('revisa el pull request de mi repo', true)
    expect(reviewPr.has('github_create_pull_request')).toBe(false)
  })

  it('enciende las github_* al pedir revisar/analizar código (con repos)', () => {
    const review = names('revisá mi código y decime qué mejorar', true)
    expect(review.has('github_read_file')).toBe(true)
    expect(review.has('github_list_files')).toBe(true)
    expect(review.has('github_repo_overview')).toBe(true)

    expect(names('analiza mi proyecto', true).has('github_repo_overview')).toBe(true)
    expect(names('auditá el código de la app', true).has('github_read_file')).toBe(true)
  })

  it('NO enciende github al revisar código sin repos ni URL, pero sí search_code', () => {
    const tools = names('revisá mi código', false)
    // El índice de código vive en la base: no necesita repo configurado.
    expect(tools.has('search_code')).toBe(true)
    expect(tools.has('github_read_file')).toBe(false)
    expect(tools.has('github_repo_overview')).toBe(false)
  })

  it('ofrece search_code al preguntar por el código del proyecto', () => {
    for (const phrase of [
      '¿dónde se guarda una nota?',
      'cómo funciona el bucle de herramientas',
      'buscá en el código dónde se define saveNote',
      '¿qué función define el patrón de parches?',
    ]) {
      expect(names(phrase, false).has('search_code'), phrase).toBe(true)
    }
    expect(names('hola, ¿todo bien?', false).has('search_code')).toBe(false)
  })

  it('detecta abrir apps, correo, clima y memoria', () => {
    expect(names('abre Spotify').has('open_app')).toBe(true)
    expect(names('envíame un correo a Juan').has('send_email')).toBe(true)
    expect(names('¿va a llover mañana?').has('get_weather')).toBe(true)
    expect(names('¿qué sabes de mí?').has('recall_memory')).toBe(true)
  })

  it('activa github_apply_patch con frases de edición en español', () => {
    for (const phrase of [
      'parcheá el archivo de mi repo',
      'aplicá el cambio en mi repo',
      'modificá ese archivo de mi repo',
      'corregí el bug en mi repo',
    ]) {
      expect(names(phrase, true).has('github_apply_patch'), phrase).toBe(true)
    }
    // Revisar (sin editar) NO activa la escritura.
    expect(names('revisá mi código y decime qué mejorar', true).has('github_apply_patch')).toBe(false)
    // Sin repos ni URL, no se ofrece nada de GitHub.
    expect(names('parcheá el archivo de mi repo', false).has('github_apply_patch')).toBe(false)
  })

  it('activa github_get_check_runs con frases de CI/checks', () => {
    for (const phrase of [
      '¿cómo va el CI de mi PR?',
      'revisá los checks de mi pull request',
      'mirá el workflow de mi repo',
    ]) {
      expect(names(phrase, true).has('github_get_check_runs'), phrase).toBe(true)
    }
    // Sin repos ni URL no hay a qué apuntar.
    expect(names('¿cómo va el CI?', false).has('github_get_check_runs')).toBe(false)
    // Al ser de solo lectura, viaja con el grupo github (p. ej. al revisar código).
    expect(names('revisá mi código y decime qué mejorar', true).has('github_get_check_runs')).toBe(true)
  })

  it('ofrece update_* solo cuando se pide modificar (FASE 4)', () => {
    // Editar una nota de la nube -> update_cloud_note, junto a las de lectura.
    const note = names('actualizá mi nota de la nube con esto')
    expect(note.has('update_cloud_note')).toBe(true)
    expect(note.has('list_cloud_notes')).toBe(true)

    // Leer notas NO ofrece la herramienta que modifica datos.
    expect(names('¿qué hay en mis notas de la nube?').has('update_cloud_note')).toBe(false)
    // Guardar no es editar: lo cubre save_cloud_note.
    expect(names('guarda una nota en la nube').has('update_cloud_note')).toBe(false)
    // Frase natural SIN la palabra "nube" (hueco que destapó la prueba en vivo).
    expect(names('editá mi nota titulada "Ideas"').has('update_cloud_note')).toBe(true)
    expect(names('editá mi nota titulada "Ideas"').has('list_cloud_notes')).toBe(true)

    // Corregir una memoria -> update_memory + recall_memory (para hallar el id).
    const mem = names('corregí esa memoria sobre mi stack')
    expect(mem.has('update_memory')).toBe(true)
    expect(mem.has('recall_memory')).toBe(true)

    // Recordar algo NO ofrece la escritura.
    expect(names('¿qué sabes de mí?').has('update_memory')).toBe(false)
    // "recordás" (voseo) también debe encender recall_memory (hueco de la prueba en vivo).
    expect(names('¿recordás qué le gusta tomar?').has('recall_memory')).toBe(true)
    expect(names('¿recordás qué le gusta tomar?').has('update_memory')).toBe(false)

    // Deshacer un cambio -> revert_change; charla normal, no.
    expect(names('deshacé el último cambio que hiciste').has('revert_change')).toBe(true)
    expect(names('hola, ¿todo bien?').has('revert_change')).toBe(false)
  })

  it('voseo y plurales (FASE 5): no se pierden por morfología', () => {
    // Causa raíz: en JS `\w` = [A-Za-z0-9_], así que una vocal acentuada final
    // ("abrí", "buscá") NO cierra palabra para `\b`. Se usa `(?!\w)`.
    expect(names('abrí Spotify').has('open_app')).toBe(true)
    expect(names('abrime el navegador').has('open_app')).toBe(true)
    expect(names('buscá en la web la última versión de Node').has('web_search')).toBe(true)
    expect(names('¿qué sabés de mí?').has('recall_memory')).toBe(true)
    expect(names('calculá el promedio de 3, 7 y 11').has('calculate')).toBe(true)
    expect(names('guardá una nota con esto').has('save_cloud_note')).toBe(true)

    // Plural: el `\b` final bloqueaba "se guardan" (el singular sí casaba).
    expect(names('buscá en mi código dónde se guardan las notas').has('search_code')).toBe(true)
    // Match que termina en vocal acentuada ("está").
    expect(names('¿dónde está la función saveNote?').has('search_code')).toBe(true)

    // Guardas: el verbo suelto no basta si no hay destino conocido.
    expect(names('abrí el archivo README').has('open_app')).toBe(false)
    // Guardar una nota NO ofrece la herramienta que modifica datos.
    expect(names('guardá una nota con esto').has('update_cloud_note')).toBe(false)
  })

  it('todos los nombres ofrecidos existen en TOOL_DEFINITIONS', () => {
    const known = new Set(TOOL_DEFINITIONS.map((t) => t.function.name))
    // El set completo declarado en los grupos debe existir.
    for (const group of Object.values(TOOL_GROUPS)) {
      for (const name of group) {
        expect(known.has(name), `${name} no está en TOOL_DEFINITIONS`).toBe(true)
      }
    }
    // Y cualquier selección real también.
    const samples = [
      'busca en la web esto',
      '¿qué notas tengo?',
      'guarda una nota en la nube',
      'revisa mi repo',
      '¿te acuerdas de mí?',
      '¿qué hora es?',
      'calcula 1+1',
      '¿va a llover?',
      'abre vscode',
      'mándame un correo',
    ]
    for (const sample of samples) {
      for (const name of selectTools(user(sample), true)) {
        expect(known.has(name), `${name} no está en TOOL_DEFINITIONS`).toBe(true)
      }
    }
  })
})
