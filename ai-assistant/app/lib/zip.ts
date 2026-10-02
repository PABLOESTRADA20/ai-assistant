/**
 * Escritor de ZIP mínimo, sin dependencias ni compresión ("store").
 *
 * Para qué: exportar las notas de la "Carpeta ARIA" como una carpeta real de
 * archivos `.md` lista para soltar en Obsidian. Se genera en el navegador para
 * no mandar los datos a ningún sitio. Sin compresión el ZIP pesa lo mismo que el
 * texto, pero es válido en cualquier sistema y no depende de `CompressionStream`
 * (que no está en todos los Safari).
 */

const encoder = new TextEncoder()

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  content: string
}

export function createZip(entries: ZipEntry[]): Blob {
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const dataBytes = encoder.encode(entry.content)
    const crc = crc32(dataBytes)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // firma
    lv.setUint16(4, 20, true) // versión mínima
    lv.setUint16(6, 0x0800, true) // nombres en UTF-8
    lv.setUint16(8, 0, true) // método: store
    lv.setUint16(10, 0, true) // hora
    lv.setUint16(12, 0, true) // fecha
    lv.setUint32(14, crc, true)
    lv.setUint32(18, dataBytes.length, true)
    lv.setUint32(22, dataBytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    parts.push(local, dataBytes)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true) // firma
    cv.setUint16(4, 20, true) // versión que lo creó
    cv.setUint16(6, 20, true) // versión mínima
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, dataBytes.length, true)
    cv.setUint32(24, dataBytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += local.length + dataBytes.length
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)

  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // fin del directorio central
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...parts, ...central, end] as unknown as BlobPart[], { type: 'application/zip' })
}

/** Convierte un título en un nombre de archivo seguro y único dentro del ZIP. */
export function safeFileName(title: string, used: Set<string> = new Set()): string {
  const base = (title || 'nota')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'nota'
  let name = `${base}.md`
  let i = 2
  while (used.has(name.toLowerCase())) {
    name = `${base} ${i}.md`
    i++
  }
  used.add(name.toLowerCase())
  return name
}
