import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface NotebookCell {
  cell_type: string
  source: string[]
}

interface Notebook {
  cells: NotebookCell[]
}

const here = path.dirname(fileURLToPath(import.meta.url))
const notebookPath = path.resolve(here, '../../training/aria-lora-kaggle.ipynb')
const notebook = JSON.parse(readFileSync(notebookPath, 'utf8')) as Notebook
const code = notebook.cells.map((cell) => cell.source.join('')).join('\n')

describe('cuaderno LoRA de Kaggle', () => {
  it('es un JSON válido con celdas de código', () => {
    expect(notebook.cells.length).toBeGreaterThan(5)
    expect(notebook.cells.some((cell) => cell.cell_type === 'code')).toBe(true)
  })

  it('no desinstala torch ni instala versiones incompatibles con Unsloth', () => {
    expect(code).not.toMatch(/pip\s+uninstall[^\n]*torch/)
    expect(code).not.toContain('torch==2.6.0')
    expect(code).not.toContain('trl==0.15.2')
    expect(code).not.toContain('unsloth @ git+')
  })

  it('instala Unsloth y unsloth_zoo con una versión fijada', () => {
    expect(code).toContain('"unsloth==2026.11.4"')
    expect(code).toContain('"unsloth_zoo==2026.11.4"')
  })

  it('importa unsloth antes que transformers y trl', () => {
    const orden = code.match(/for nombre in \[([^\]]+)\]/)?.[1] ?? ''
    const posUnsloth = orden.indexOf('"unsloth"')
    const posTransformers = orden.indexOf('"transformers"')
    const posTrl = orden.indexOf('"trl"')

    expect(posUnsloth).toBeGreaterThanOrEqual(0)
    expect(posTransformers).toBeGreaterThan(posUnsloth)
    expect(posTrl).toBeGreaterThan(posUnsloth)
  })

  it('avisa si torch quedó sin CUDA y pide reiniciar la sesión', () => {
    expect(code).toContain('hasattr(torch, "cuda")')
    expect(code).toContain('Factory reset')
  })
})
