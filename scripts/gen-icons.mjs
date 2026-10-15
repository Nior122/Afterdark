/**
 * Generate the PWA icons and the favicon.
 *
 * The app has no design tool in the loop, and shipping a manifest that points at icons
 * which do not exist is a broken install prompt on Android. So the icons are generated:
 * deterministic, ~6 KB each, and regenerable if the palette changes.
 *
 * Drawing is done with signed distance fields rather than a canvas library, because the
 * only rasteriser already in this repo (tools/lib/raster.mjs) renders 3D heads. Coverage
 * is `0.5 - distance`, which gives clean antialiasing for free at every size.
 *
 *   npm run icons
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from '../tools/lib/png.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* -------------------------------------------------------------------------- */
/* Signed distance fields                                                      */
/* -------------------------------------------------------------------------- */

/** Distance from a point to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r)
  const qy = Math.abs(py - cy) - (halfH - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** Distance from a point to a circle outline of the given stroke radius. */
function sdCircleRing(px, py, cx, cy, radius, stroke) {
  return Math.abs(Math.hypot(px - cx, py - cy) - radius) - stroke
}

/** Distance from a point to a filled circle. */
function sdCircle(px, py, cx, cy, radius) {
  return Math.hypot(px - cx, py - cy) - radius
}

/** Distance to a smile: an arc of a circle, clipped to its lower half. */
function sdSmile(px, py, cx, cy, radius, stroke) {
  const d = sdCircleRing(px, py, cx, cy, radius, stroke)
  // Clip: only keep the part below the arc's centre line.
  return Math.max(d, py < cy ? cy - py : 0)
}

/* -------------------------------------------------------------------------- */
/* Painting                                                                    */
/* -------------------------------------------------------------------------- */

const CORAL = [0xf0, 0x71, 0x5f]
const VIOLET = [0x7c, 0x3a, 0xed]

/**
 * @param {number} size
 * @param {{ maskable?: boolean }} [options]  Maskable icons keep the glyph inside a
 *   safe circle, because Android crops them to whatever shape the launcher uses.
 */
function drawIcon(size, options = {}) {
  const maskable = options.maskable ?? false
  const rgba = new Uint8Array(size * size * 4)

  // Scale-independent geometry, all expressed as a fraction of the icon size.
  const glyph = maskable ? 0.5 : 0.62
  const cx = size / 2
  const cy = size / 2
  const faceR = (size * glyph) / 2
  const headCy = cy + size * 0.012
  const eyeR = size * 0.042
  const eyeDx = faceR * 0.42
  const eyeDy = faceR * 0.18
  const smileR = faceR * 0.46
  const smileStroke = size * 0.026
  const smileCy = headCy + faceR * 0.12

  // Maskable icons must bleed to the edges: the launcher supplies the shape.
  const corner = maskable ? 0 : size * 0.22
  const half = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // Background: rounded square, gradient from top-left coral to bottom-right violet.
      const bg = corner > 0 ? sdRoundRect(px, py, cx, cy, half, half, corner) : -1
      const bgCov = clamp01(0.5 - bg)
      if (bgCov <= 0) continue

      const t = clamp01((px / size) * 0.45 + (py / size) * 0.55)
      // A slight radial lift keeps the mark from looking flat when it is small.
      const glow = 1 - Math.hypot((px - cx) / size, (py - cy) / size) * 0.55
      let r = lerp(CORAL[0], VIOLET[0], t) * glow
      let g = lerp(CORAL[1], VIOLET[1], t) * glow
      let b = lerp(CORAL[2], VIOLET[2], t) * glow

      // Glyph: a head outline, two eyes, a smile — legible down to 48 px.
      const head = sdCircleRing(px, py, cx, headCy, faceR, size * 0.031)
      const eyeL = sdCircle(px, py, cx - eyeDx, headCy - eyeDy, eyeR)
      const eyeR2 = sdCircle(px, py, cx + eyeDx, headCy - eyeDy, eyeR)
      const smile = sdSmile(px, py, cx, smileCy, smileR, smileStroke)
      const glyphD = Math.min(head, eyeL, eyeR2, smile)
      const glyphCov = clamp01(0.5 - glyphD) * 0.96

      if (glyphCov > 0) {
        r = lerp(r, 255, glyphCov)
        g = lerp(g, 255, glyphCov)
        b = lerp(b, 255, glyphCov)
      }

      const i = (y * size + x) * 4
      rgba[i] = Math.round(clamp255(r))
      rgba[i + 1] = Math.round(clamp255(g))
      rgba[i + 2] = Math.round(clamp255(b))
      rgba[i + 3] = Math.round(bgCov * 255)
    }
  }

  return rgba
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
const lerp = (a, b, t) => a + (b - a) * t

/* -------------------------------------------------------------------------- */

function writePng(path, size, options) {
  const rgba = drawIcon(size, options)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodePng(rgba, size, size))
  console.log(`  ${path.replace(ROOT + '/', '')} (${size}x${size})`)
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Faceverify">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0715f"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round">
    <circle cx="32" cy="32.8" r="20.5"/>
    <path d="M22.5 39.5a11 11 0 0 0 19 0"/>
  </g>
  <g fill="#fff">
    <circle cx="23" cy="28.6" r="2.9"/>
    <circle cx="41" cy="28.6" r="2.9"/>
  </g>
</svg>
`

console.log('Generating icons…')
writePng(join(ROOT, 'public/icons/icon-192.png'), 192)
writePng(join(ROOT, 'public/icons/icon-512.png'), 512)
writePng(join(ROOT, 'public/icons/icon-512-maskable.png'), 512, { maskable: true })
writePng(join(ROOT, 'public/apple-touch-icon.png'), 180)
// The maskable icon doubles as the Android splash mark, where a square with padding
// reads better than a full-bleed gradient.
mkdirSync(join(ROOT, 'public'), { recursive: true })
writeFileSync(join(ROOT, 'public/favicon.svg'), FAVICON)
console.log('  public/favicon.svg')
console.log('Done.')
