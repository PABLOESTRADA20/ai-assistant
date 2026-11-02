#!/usr/bin/env node
/**
 * Sube un adaptador LoRA a Cloudflare Workers AI y, opcionalmente, lo prueba.
 *
 *   npm run lora:upload -- --dir=aria-lora
 *   npm run lora:upload -- --dir=aria-lora --name=aria-v1 --model=@cf/meta/llama-3.2-3b-instruct
 *   npm run lora:upload -- --delete --name=aria-v1
 *
 * Requisitos:
 *   - `.env.local` en la raíz del repo con CLOUDFLARE_ACCOUNT_ID y
 *     CLOUDFLARE_API_TOKEN (permiso Workers AI: Edit).
 *   - La carpeta debe tener `adapter_config.json` y `adapter_model.safetensors`.
 *
 * Detalles verificados en vivo (2026-10-30):
 *   - La ruta de subida es `/finetunes/{id}/finetune-assets` SIN barra final;
 *     con barra final devuelve 404.
 *   - Cloudflare no deja reescribir un fichero: si el finetune ya existe, hay
 *     que borrarlo o usar otro nombre.
 *   - `base_model_name_or_path` debe ser la base canónica (no `unsloth/...`).
 *   - Los adaptadores públicos (`cf-public-*`) dan 500, pero uno propio con la
 *     base correcta responde 200.
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (nombre, defecto) => {
  const prefijo = `--${nombre}=`
  const encontrado = args.find((a) => a.startsWith(prefijo))
  return encontrado ? encontrado.slice(prefijo.length) : defecto
}
const bandera = (nombre) => args.includes(`--${nombre}`)

const DIR = path.resolve(arg('dir', 'aria-lora'))
const NOMBRE = arg('name', path.basename(DIR))
const BORRAR = bandera('delete')
const SIN_PRUEBA = bandera('no-test')

/** Base canónica de Hugging Face -> modelo de Cloudflare que acepta LoRA. */
const BASES = {
  'meta-llama/Llama-3.2-3B-Instruct': '@cf/meta/llama-3.2-3b-instruct',
  'meta-llama/Llama-3.2-11B-Vision-Instruct': '@cf/meta/llama-3.2-11b-vision-instruct',
  'mistralai/Mistral-7B-Instruct-v0.2': '@cf/mistral/mistral-7b-instruct-v0.2-lora',
  'mistralai/Mistral-7B-v0.1': '@cf/mistral/mistral-7b-instruct-v0.2-lora',
  'meta-llama/Llama-2-7b-chat-hf': '@cf/meta-llama/llama-2-7b-chat-hf-lora',
  'google/gemma-2b-it': '@cf/google/gemma-2b-it-lora',
  'google/gemma-7b-it': '@cf/google/gemma-7b-it-lora',
}

/** Si el cuaderno guardó la ruta de Unsloth, la traducimos a la canónica. */
const DESDE_UNSLOTH = {
  'unsloth/Llama-3.2-3B-Instruct-bnb-4bit': 'meta-llama/Llama-3.2-3B-Instruct',
  'unsloth/Llama-3.2-3B-Instruct': 'meta-llama/Llama-3.2-3B-Instruct',
  'unsloth/mistral-7b-instruct-v0.2-bnb-4bit': 'mistralai/Mistral-7B-Instruct-v0.2',
  'unsloth/mistral-7b-instruct-v0.2': 'mistralai/Mistral-7B-Instruct-v0.2',
}

function leerEnv() {
  const ruta = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe ${ruta}. Ejecutá el script desde la carpeta ai-assistant/.`)
  }
  return Object.fromEntries(
    fs
      .readFileSync(ruta, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]
      }),
  )
}

const env = leerEnv()
const ACC = env.CLOUDFLARE_ACCOUNT_ID
const TOK = env.CLOUDFLARE_API_TOKEN
if (!ACC || !TOK) throw new Error('Faltan CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN en .env.local')

const API = `https://api.cloudflare.com/client/v4/accounts/${ACC}/ai`

async function cf(ruta, opciones = {}) {
  const r = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${TOK}`, ...(opciones.headers ?? {}) },
  })
  const texto = await r.text()
  let cuerpo
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    cuerpo = texto
  }
  return { status: r.status, cuerpo }
}

async function listar() {
  const r = await cf('/finetunes')
  if (!r.cuerpo?.success) throw new Error(`No se pudo listar finetunes: ${JSON.stringify(r.cuerpo)}`)
  return r.cuerpo.result ?? []
}

if (BORRAR) {
  const f = (await listar()).find((x) => x.name === NOMBRE)
  if (!f) {
    console.log(`No existe el finetune "${NOMBRE}".`)
    process.exit(0)
  }
  const r = await cf(`/finetunes/${f.id}`, { method: 'DELETE' })
  console.log(`Borrar "${NOMBRE}":`, r.status, JSON.stringify(r.cuerpo).slice(0, 300))
  process.exit(r.status === 200 ? 0 : 1)
}

const cfgPath = path.join(DIR, 'adapter_config.json')
const pesosPath = path.join(DIR, 'adapter_model.safetensors')
for (const p of [cfgPath, pesosPath]) {
  if (!fs.existsSync(p)) throw new Error(`Falta ${p}. Descomprimí aria-lora.zip en ${DIR}/.`)
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const r = Number(cfg.r ?? 0)
const mb = (fs.statSync(pesosPath).size + fs.statSync(cfgPath).size) / 1024 ** 2

if (!['mistral', 'gemma', 'llama'].includes(cfg.model_type)) {
  throw new Error(`model_type inválido: ${cfg.model_type}. Cloudflare solo acepta mistral/gemma/llama.`)
}
if (r < 1 || r > 32) throw new Error(`r inválido: ${r}. Cloudflare acepta 1..32 (recomendado <= 8).`)
if (mb >= 300) throw new Error(`El adaptador pesa ${mb.toFixed(1)} MB; el límite es 300 MB.`)

const baseOriginal = cfg.base_model_name_or_path
if (DESDE_UNSLOTH[baseOriginal]) {
  cfg.base_model_name_or_path = DESDE_UNSLOTH[baseOriginal]
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  console.log(`Base corregida: ${baseOriginal} -> ${cfg.base_model_name_or_path}`)
}
const base = cfg.base_model_name_or_path
if (!base || base.startsWith('unsloth/')) {
  throw new Error(
    `base_model_name_or_path no es canónica: ${base}. ` +
      'Usá meta-llama/Llama-3.2-3B-Instruct o mistralai/Mistral-7B-Instruct-v0.2.',
  )
}

const modelo = arg('model', BASES[base])
if (!modelo) {
  throw new Error(
    `No sé qué modelo de Cloudflare corresponde a ${base}. Pasá --model=@cf/... (ver training/README.md).`,
  )
}

console.log(`Adaptador: ${DIR}`)
console.log(`  base: ${base}`)
console.log(`  model_type: ${cfg.model_type} | r: ${r} | ${mb.toFixed(1)} MB`)
console.log(`  modelo Cloudflare: ${modelo}`)
console.log(`  finetune: ${NOMBRE}`)

const existente = (await listar()).find((f) => f.name === NOMBRE)
if (existente) {
  throw new Error(
    `Ya existe "${NOMBRE}" (${existente.id}). Cloudflare no permite reescribirlo. ` +
      `Borralo con --delete --name=${NOMBRE} o usá otro --name.`,
  )
}

const creado = await cf('/finetunes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: modelo, name: NOMBRE, description: 'Adaptador LoRA de ARIA' }),
})
if (!creado.cuerpo?.success) {
  throw new Error(`No se pudo crear el finetune: ${JSON.stringify(creado.cuerpo)}`)
}
const id = creado.cuerpo.result.id
console.log(`Creado: ${id}`)

for (const [nombreArchivo, ruta, tipo] of [
  ['adapter_config.json', cfgPath, 'application/json'],
  ['adapter_model.safetensors', pesosPath, 'application/octet-stream'],
]) {
  const fd = new FormData()
  fd.append('file_name', nombreArchivo)
  fd.append('file', new Blob([fs.readFileSync(ruta)], { type: tipo }), nombreArchivo)
  // OJO: sin barra final; con barra, Cloudflare devuelve 404.
  const subido = await cf(`/finetunes/${id}/finetune-assets`, { method: 'POST', body: fd })
  console.log(`  ${nombreArchivo}: ${subido.status}`)
  if (!subido.cuerpo?.success) {
    throw new Error(`Falló la subida de ${nombreArchivo}: ${JSON.stringify(subido.cuerpo)}`)
  }
}

if (!SIN_PRUEBA) {
  await new Promise((resolver) => setTimeout(resolver, 3000))
  const prueba = await cf(`/run/${modelo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Responde solo: hola' }],
      max_tokens: 8,
      lora: NOMBRE,
    }),
  })
  console.log(`Prueba de inferencia: ${prueba.status}`)
  if (prueba.status === 200) {
    console.log('  respuesta:', prueba.cuerpo.result?.response?.slice(0, 120) ?? '(sin texto)')
  } else {
    console.log('  error:', JSON.stringify(prueba.cuerpo).slice(0, 400))
  }
}

console.log(`\nListo. Usá lora="${NOMBRE}" (o "${id}") con ${modelo}.`)
