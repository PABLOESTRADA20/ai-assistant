// scripts/generate-icons.mjs
//
// Rasteriza los SVG de identidad de ARIA a los PNG que piden las PWA.
// Se corre a mano cuando cambia el diseño (no en cada build):
//
//   npm run icons
//
// Genera en `public/`: icon-192, icon-512, icon-maskable-512 y apple-touch-icon.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'public')

/** @type {{ svg: string, out: string, size: number }[]} */
const jobs = [
  { svg: 'icon.svg', out: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', out: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  { svg: 'apple-touch-icon.svg', out: 'apple-touch-icon.png', size: 180 },
]

for (const job of jobs) {
  const svg = await readFile(path.join(pub, job.svg))
  await sharp(svg, { density: 512 })
    .resize(job.size, job.size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(pub, job.out))
  console.log(`ok ${job.out} (${job.size}px)`)
}
