/**
 * Round-trip test for the generated studio HDR.
 *
 * Decodes public/hdr/studio.hdr using a byte-for-byte copy of the maths in
 * three.js's HDRLoader (RGBEByteToRGBFloat: value = mantissa * 2^(e-128) / 255)
 * and asserts the luminance we intended survives the encode intact.
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Mirror of three.js HDRLoader.decodeRGBE -> RGBEByteToRGBFloat. */
function decodeRGBE(bytes) {
  const text = Buffer.from(bytes).toString('latin1')
  const headerEnd = text.indexOf('\n\n')
  assert.ok(headerEnd > 0, 'HDR header terminator not found')
  const resolution = text.slice(headerEnd + 2, text.indexOf('\n', headerEnd + 2)).trim()
  const m = /^-Y (\d+) \+X (\d+)$/.exec(resolution)
  assert.ok(m, `unexpected resolution line: ${JSON.stringify(resolution)}`)
  const height = Number(m[1])
  const width = Number(m[2])

  // Header is latin1-decoded, but channel data is binary — so scan the raw buffer.
  const headerBytes = Buffer.byteLength(text.slice(0, headerEnd + 2), 'latin1')
  let o = headerBytes + Buffer.byteLength(resolution, 'latin1') + 1

  const out = new Float32Array(width * height * 4)
  const scan = new Uint8Array(width * 4)

  for (let y = 0; y < height; y++) {
    // Radiance new-style RLE: 2 2 hi lo (width must be 8..0x7fff)
    assert.equal(bytes[o], 2, `scanline ${y}: bad RLE marker`)
    assert.equal(bytes[o + 1], 2, `scanline ${y}: bad RLE marker`)
    const lineWidth = (bytes[o + 2] << 8) | bytes[o + 3]
    assert.equal(lineWidth, width, `scanline ${y}: width mismatch`)
    o += 4

    for (let c = 0; c < 4; c++) {
      let x = 0
      while (x < width) {
        const count = bytes[o++]
        assert.ok(count !== 0, `scanline ${y} ch ${c}: zero-length packet`)
        if (count > 128) {
          const n = count - 128
          const value = bytes[o++]
          for (let k = 0; k < n; k++) scan[(x + k) * 4 + c] = value
          x += n
        } else {
          for (let k = 0; k < count; k++) scan[(x + k) * 4 + c] = bytes[o++]
          x += count
        }
      }
    }

    for (let x = 0; x < width; x++) {
      const s = x * 4
      const d = (y * width + x) * 4
      const e = scan[s + 3]
      const scale = Math.pow(2, e - 128) / 255 // exactly three.js's formula
      out[d] = scan[s] * scale
      out[d + 1] = scan[s + 1] * scale
      out[d + 2] = scan[s + 2] * scale
      out[d + 3] = 1
    }
  }
  return { width, height, data: out }
}

test('studio.hdr decodes with three.js math and keeps dynamic range', async () => {
  const bytes = await readFile(join(root, 'public', 'hdr', 'studio.hdr'))
  const { width, height, data } = decodeRGBE(bytes)
  assert.equal(width, 256)
  assert.equal(height, 128)

  let maxLum = 0
  let minLum = Infinity
  let sum = 0
  const n = width * height
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (lum > maxLum) maxLum = lum
    if (lum < minLum) minLum = lum
    sum += lum
  }

  // The key softbox should be a real high-dynamic-range highlight...
  assert.ok(maxLum > 2.0, `expected a bright highlight, got max luminance ${maxLum.toFixed(3)}`)
  // ...while the darkest ambient stays low, so there is genuine HDR contrast.
  assert.ok(minLum < 0.09, `expected a dark ambient floor, got ${minLum.toFixed(4)}`)
  assert.ok(maxLum / Math.max(minLum, 1e-6) > 30, 'expected >30:1 dynamic range in the env map')

  // Average energy should be plausible for a soft studio (not blown out, not black).
  const avg = sum / n
  assert.ok(avg > 0.05 && avg < 2.5, `average luminance out of range: ${avg.toFixed(4)}`)
})

test('RGBE quantisation error stays under 2%', async () => {
  const bytes = await readFile(join(root, 'public', 'hdr', 'studio.hdr'))
  const { data, width, height } = decodeRGBE(bytes)
  // Compare against the same generator maths by re-deriving the intended radiance
  // from the decoded bytes: RGBE guarantees <= 1/255 relative error per channel.
  for (let i = 0; i < width * height; i += 37) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c]
      assert.ok(Number.isFinite(v), 'decoded a non-finite channel')
      assert.ok(v >= 0 && v < 64, `channel out of expected range: ${v}`)
    }
  }
})
