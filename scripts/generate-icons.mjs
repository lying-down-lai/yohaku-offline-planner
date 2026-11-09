import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function insidePolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function createIcon(size) {
  const rows = Buffer.alloc(size * (1 + size * 4))
  const bars = [
    [[.29,.59],[.38,.35],[.47,.39],[.38,.63]],
    [[.43,.64],[.54,.25],[.63,.29],[.52,.68]],
    [[.59,.62],[.68,.39],[.77,.43],[.68,.66]]
  ]
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4)
    rows[row] = 0
    for (let x = 0; x < size; x++) {
      const nx = (x + .5) / size, ny = (y + .5) / size
      const circle = (nx - .5) ** 2 + (ny - .5) ** 2 < .36 ** 2
      const bar = bars.some(points => insidePolygon(nx, ny, points))
      const color = bar ? [240,233,214,255] : circle ? [49,80,73,255] : [36,60,57,255]
      const offset = row + 1 + x * 4
      for (let i = 0; i < 4; i++) rows[offset+i] = color[i]
    }
  }
  const signature = Buffer.from([137,80,78,71,13,10,26,10])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

for (const [name, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const file = resolve('public', name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, createIcon(size))
  console.log(`Generated ${name}`)
}
