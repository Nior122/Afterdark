/**
 * Minimal PNG encoder (truecolour + alpha, 8-bit, filter 0).
 *
 * Exists so the headless verification tools can emit images that a human (or the
 * agent) can actually look at. Node ships zlib, so no dependencies are needed.
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([len, typeAndData, crc])
}

/**
 * @param {Uint8Array} rgba tightly packed RGBA, length = width*height*4
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter byte. Adaptive filtering picks, per row,
  // whichever of the five PNG filters minimises the sum of absolute signed bytes — the
  // standard heuristic from the PNG spec. On smooth gradients (icons, renders) this is
  // worth roughly 4x in the deflate output, which matters because the app icons are
  // precached on phones with metered data.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  const attempts = [FilterType.None, FilterType.Sub, FilterType.Up, FilterType.Average, FilterType.Paeth]
  const candidate = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride
    const prevStart = rowStart - stride
    let bestType = FilterType.None
    let bestScore = Infinity
    let best = null
    for (const type of attempts) {
      const score = applyFilter(type, rgba, rowStart, stride, prevStart >= 0 ? rgba : null, prevStart, candidate)
      if (score < bestScore) {
        bestScore = score
        bestType = type
        best = Buffer.from(candidate)
      }
    }
    raw[y * (stride + 1)] = bestType
    best.copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** PNG filter types, in the order the spec numbers them. */
const FilterType = { None: 0, Sub: 1, Up: 2, Average: 3, Paeth: 4 }

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Apply one filter to a scanline into `out`, returning its score (the sum of absolute
 * values read as signed bytes, which is the heuristic the spec recommends).
 */
function applyFilter(type, src, rowStart, stride, prev, prevStart, out) {
  let score = 0
  for (let x = 0; x < stride; x++) {
    const raw = src[rowStart + x]
    const left = x >= 4 ? src[rowStart + x - 4] : 0
    const up = prev ? prev[prevStart + x] : 0
    const upLeft = prev && x >= 4 ? prev[prevStart + x - 4] : 0
    let value
    switch (type) {
      case FilterType.Sub:
        value = raw - left
        break
      case FilterType.Up:
        value = raw - up
        break
      case FilterType.Average:
        value = raw - ((left + up) >> 1)
        break
      case FilterType.Paeth:
        value = raw - paeth(left, up, upLeft)
        break
      default:
        value = raw
    }
    value &= 0xff
    out[x] = value
    score += value < 128 ? value : 256 - value
  }
  return score
}
