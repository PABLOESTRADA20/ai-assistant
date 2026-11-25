/**
 * Genera el dataset ReAct/CoT del generador de tests del piloto.
 *
 *   npm run pilot:dataset -- --dry                 # solo informe, no escribe
 *   npm run pilot:dataset -- --held-out=20         # split por PR (por defecto)
 *   npm run pilot:dataset -- --out=data/lora/mine  # salida alternativa
 *
 * Lee solo archivos JSONL locales, no consulta BD ni red y no despliega nada.
 * La salida vive en `data/lora/` (ignorado por Git): NUNCA se sube a Hugging Face.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { PilotEvalRecord, PilotTrace } from '../app/lib/pilot-traces'
import {
  buildTestgenDataset,
  parseJsonl,
  parseOptions,
  serializeTestgenJsonl,
} from '../app/lib/testgen-dataset'

const options = parseOptions(process.argv.slice(2))

function readJsonl<T>(path: string): T[] {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error(`No existe el archivo: ${path}`)
  return parseJsonl<T>(readFileSync(absolute, 'utf8'), path)
}

const traces = readJsonl<PilotTrace>(options.tracesPath)
const evals = readJsonl<PilotEvalRecord>(options.evalsPath)
const { examples, report, manifest } = buildTestgenDataset(traces, evals, options)

console.log(`Trazas leídas: ${report.traces}`)
console.log(`Ejemplos ReAct/CoT: ${report.examples} (${report.byVerdict['ci-passed']} OK / ${report.byVerdict['ci-failed']} corrección)`)
console.log(`Split por PR: ${report.train} train / ${report.valid} valid (${report.heldOutPercent}% held-out)`)
console.log(`Grupos: ${report.groups}; redacciones: ${report.redactions}`)

if (options.dryRun) {
  console.log('Modo --dry: no se escribió ningún archivo.')
} else {
  mkdirSync(options.outDir, { recursive: true })
  writeFileSync(
    resolve(options.outDir, 'train.jsonl'),
    serializeTestgenJsonl(examples.filter((example) => example.split === 'train')),
  )
  writeFileSync(
    resolve(options.outDir, 'valid.jsonl'),
    serializeTestgenJsonl(examples.filter((example) => example.split === 'valid')),
  )
  writeFileSync(
    resolve(options.outDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  )
  console.log(`Escrito en ${options.outDir}: train.jsonl, valid.jsonl, manifest.json`)
}
