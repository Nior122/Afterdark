/**
 * Generate a small HDR studio environment map (Radiance .hdr, RGBE) at build time.
 *
 * Why generate instead of download: keeps the bundle tiny and dependency-free, and
 * gives full control over the softbox layout so the "soft studio" look is deliberate.
 * Layout: dark-ish neutral room, one large key softbox upper-left, a broad fill on the
 * right, a cool rim strip behind and a warm low bounce. ~100 KB for 256x128.
 *
 * Usage: node scripts/gen-studio-env.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 256
const H = 128

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** A soft elliptical "softbox" of light, in equirectangular uv space. */
function softbox(u, v, cu, cv, rw, rh, intensity, falloff = 2.2) {
  // Wrap horizontally so boxes near the seam stay continuous.
  let du = Math.abs(u - cu)
  if (du > 0.5) du = 1 - du
  const dv = Math.abs(v - cv)
  const d = Math.sqrt((du / rw) ** 2 + (dv / rh) ** 2)
  if (d >= 1) return 0
  // Rounded rectangular falloff: flat core, smooth edge.
  const edge = 1 - smooth(0.55, 1, d)
  return intensity * edge ** falloff
}

function radianceAt(u, v) {
  // v: 0 = +Y (zenith) → 1 = -Y (nadir)
  const sky = smooth(0.5, 0.0, v) // 1 at the top of the sphere
  const floor = smooth(0.5, 1.0, v)

  let r = 0
  let g = 0
  let b = 0

  // Ambient room gradient: cool above, warm neutral below. Kept low so the
  // softboxes read as the dominant light sources.
  const amb = 0.035 + 0.05 * sky
  r += amb * 0.92
  g += amb * 0.96
  b += amb * 1.08

  const bounce = 0.045 * floor
  r += bounce * 1.10
  g += bounce * 0.98
  b += bounce * 0.86

  // Key softbox: upper-left/front, slightly warm-white (like a diffused strobe).
  const key = softbox(u, v, 0.30, 0.24, 0.20, 0.24, 5.6)
  r += key * 1.0
  g += key * 0.985
  b += key * 0.94

  // Fill: broad, dimmer, camera-right — lifts the shadow side so it never goes muddy.
  const fill = softbox(u, v, 0.70, 0.34, 0.26, 0.30, 1.5, 1.6)
  r += fill * 0.95
  g += fill * 0.97
  b += fill * 1.02

  // Cool rim strip behind the subject for edge separation on dark hair.
  const rim = softbox(u, v, 0.5, 0.16, 0.30, 0.09, 3.1, 1.4)
  r += rim * 0.80
  g += rim * 0.90
  b += rim * 1.15

  // Warm low bounce to keep the neck/shoulders from reading as a black void.
  const warm = softbox(u, v, 0.5, 0.86, 0.42, 0.20, 0.85, 1.5)
  r += warm * 0.55
  g += warm * 0.40
  b += warm * 0.28

  // Very dim top ceiling panel for a soft crown highlight.
  const top = softbox(u, v, 0.5, 0.02, 0.24, 0.06, 1.1, 1.5)
  r += top * 0.98
  g += top * 0.99
  b += top * 1.0

  return [r, g, b]
}

/**
 * Encode a float triple to RGBE (shared exponent), the Radiance HDR format.
 *
 * The decoder three.js uses is:  value = mantissa * 2^(e - 128) / 255
 * so we must pick e such that mantissa = value * 255 / 2^(e - 128) lands in [0, 255],
 * i.e. 2^(e - 128) >= max(value). Hence the +128 bias below.
 */
export function toRGBE(r, g, b) {
  const max = Math.max(r, g, b)
  if (max < 1e-8) return [0, 0, 0, 0]
  const exp = Math.ceil(Math.log2(max)) // 2^exp >= max
  const scale = 255 / Math.pow(2, exp)
  const q = (v) => Math.min(255, Math.max(0, Math.round(v * scale)))
  return [q(r), q(g), q(b), Math.min(255, Math.max(0, exp + 128))]
}

function buildHeader() {
  return Buffer.from(
    `#?RADIANCE\n# Faceverify generated studio environment\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`,
    'ascii',
  )
}

/**
 * Radiance RLE: each scanline is [2,2,hi,lo] then four separately-run-length-encoded
 * channel planes. Runs are literal (<=128 bytes) or repeat (byte 128+n, then value).
 */
function encodeScanline(rgbeRow) {
  const out = []
  out.push(2, 2, (W >> 8) & 0xff, W & 0xff)
  for (let c = 0; c < 4; c++) {
    let i = 0
    while (i < W) {
      // Detect a run of at least 4 identical values.
      let run = 1
      while (i + run < W && run < 127 && rgbeRow[(i + run) * 4 + c] === rgbeRow[i * 4 + c]) run++
      if (run >= 4) {
        out.push(128 + run, rgbeRow[i * 4 + c])
        i += run
      } else {
        // Emit a literal block up to the next run (or 128 bytes).
        const start = i
        let len = 0
        while (i < W && len < 128) {
          const a = rgbeRow[i * 4 + c]
          const b1 = i + 1 < W ? rgbeRow[(i + 1) * 4 + c] : -1
          const b2 = i + 2 < W ? rgbeRow[(i + 2) * 4 + c] : -1
          const b3 = i + 3 < W ? rgbeRow[(i + 3) * 4 + c] : -1
          if (a === b1 && a === b2 && a === b3) break
          i++
          len++
        }
        if (len === 0) {
          len = 1
          i = start + 1
        }
        out.push(len)
        for (let k = start; k < start + len; k++) out.push(rgbeRow[k * 4 + c])
      }
    }
  }
  return Buffer.from(out)
}

async function main() {
  const pixels = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const v = (y + 0.5) / H
      // Angular weighting keeps the polar regions from over-contributing once
      // three.js convolves this into an irradiance map.
      const theta = (v - 0.5) * Math.PI
      const weight = 0.35 + 0.65 * Math.cos(theta)
      const [r, g, b] = radianceAt(u, v).map((c) => c * weight)
      const [er, eg, eb, ee] = toRGBE(r, g, b)
      const o = (y * W + x) * 4
      pixels[o] = er
      pixels[o + 1] = eg
      pixels[o + 2] = eb
      pixels[o + 3] = ee
    }
  }

  const header = buildHeader()
  const chunks = [header]
  for (let y = 0; y < H; y++) {
    chunks.push(encodeScanline(pixels.subarray(y * W * 4, (y + 1) * W * 4)))
  }
  const out = Buffer.concat(chunks)

  const dest = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'hdr', 'studio.hdr'))
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, out)
  console.log(`✓ studio.hdr  ${W}x${H}  ${(out.length / 1024).toFixed(1)} KB → ${dest}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
