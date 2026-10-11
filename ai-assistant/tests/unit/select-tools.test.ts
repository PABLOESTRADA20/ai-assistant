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

  it('detecta abrir apps, correo, clima y memoria', () => {
    expect(names('abre Spotify').has('open_app')).toBe(true)
    expect(names('envíame un correo a Juan').has('send_email')).toBe(true)
    expect(names('¿va a llover mañana?').has('get_weather')).toBe(true)
    expect(names('¿qué sabes de mí?').has('recall_memory')).toBe(true)
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
