// Exportar el diseño vectorial de app/icon.svg a formatos de navegador y teléfono.
// No necesita red, fuentes, variables de entorno ni dependencias adicionales.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = new URL('../', import.meta.url)
const source = await readFile(new URL('app/icon.svg', root))
const coral = '#ff385c'

// ICO con PNG internos: 16/32 para pestañas y 48/64 para pantallas de mayor densidad.
const sizes = [16, 32, 48, 64]
const frames = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + frames.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = header.length
for (const [i, frame] of frames.entries()) {
  const entry = 6 + i * 16
  header[entry] = sizes[i]
  header[entry + 1] = sizes[i]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frame.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frame.length
}
await writeFile(new URL('app/favicon.ico', root), Buffer.concat([header, ...frames]))

// Los sistemas móviles aplican su propia máscara: el fondo llena toda la imagen.
for (const [path, size] of [
  ['app/apple-icon.png', 180],
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
]) {
  await sharp(source).resize(size, size).flatten({ background: coral }).png()
    .toFile(fileURLToPath(new URL(path, root)))
}

// Margen adicional para que Android no recorte la A al aplicar máscaras circulares.
const size = 512
const inner = 432
const padding = (size - inner) / 2
await sharp(source).resize(inner, inner).flatten({ background: coral })
  .extend({ top: padding, bottom: padding, left: padding, right: padding, background: coral })
  .png().toFile(fileURLToPath(new URL('public/icons/icon-maskable-512.png', root)))

console.log('Iconos de AirAdmin generados desde app/icon.svg.')
