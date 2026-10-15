/**
 * Photo -> face texture projection.
 *
 * This is the core of Option B: take the user's own pixels and lay them onto the
 * rig's UV space so the model's face *is* the user's face.
 *
 * Method: forward-rasterise the canonical 468-landmark mesh in UV space. For each of
 * the 898 canonical triangles we know both the UV coordinates of its corners (from
 * the canonical model) and where those same landmark indices appear in the photo, so
 * each triangle is an affine map from texture space to image space. Walking the
 * output texel grid and sampling the photo through that affine map produces a
 * properly registered albedo, with no per-pixel search.
 *
 * The rig's head mesh uses the *same* atlas layout as the canonical model's UVs
 * (facecap.glb's UVs bake down to the canonical layout), so the result lands on the
 * face without further alignment.
 */
import { CANONICAL_POSITIONS, CANONICAL_TRIANGLES, CANONICAL_UVS } from '../../avatar/local/canonicalFace'

export interface FaceTextureOptions {
  /** Output edge length. 1024 is the default; Lite mode uses 512. */
  size?: number
  /** Feather width, in texels, for the alpha falloff at the mask boundary. */
  feather?: number
  /** How much to lift shadowed areas so the texture does not carry baked lighting. */
  dehaze?: boolean
}

export interface FaceTextureResult {
  /** Registered face albedo, RGBA, ready to become a three.js texture. */
  image: ImageData
  /** Fraction of texels inside the face mask — a coverage readout for diagnostics. */
  coverage: number
  /** Average colour of the sampled face region. */
  averageColor: { r: number; g: number; b: number }
  /** Estimated skin tone id from the tone table, nearest match. */
  notes: string[]
}

type Landmark = { x: number; y: number; z: number }

/**
 * Build an affine map from UV space to photo pixel space using the canonical mesh.
 *
 * @param landmarks MediaPipe's 478 landmarks; the first 468 align with the canonical
 *                  model's index order.
 * @param bitmap    the photo, for dimensions
 */
export function projectFaceTexture(
  landmarks: Landmark[],
  bitmap: ImageBitmap,
  options: FaceTextureOptions = {},
): FaceTextureResult {
  const size = options.size ?? 1024
  const feather = options.feather ?? Math.round(size / 64)
  const W = bitmap.width
  const H = bitmap.height

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable — cannot project the photo.')
  ctx.drawImage(bitmap, 0, 0, W, H)
  const source = ctx.getImageData(0, 0, W, H)
  const src = source.data

  const out = new ImageData(size, size)
  const dst = out.data

  // Coverage accumulator; 1 where the photo contributed, 0 elsewhere.
  const mask = new Float32Array(size * size)

  // --- how big is the face in this photo? ---------------------------------
  // The affine map below is derived per-vertex from the landmark correspondences, so it
  // carries its own scale; there is nothing to normalise here. The interocular distance
  // is measured anyway and reported as a note, because "the face was small in the frame"
  // is the first thing to check when a projection comes out blurry.
  const iod = distance2D(landmarks[133], landmarks[362])

  const triangleCount = CANONICAL_TRIANGLES.length / 3
  for (let t = 0; t < triangleCount; t++) {
    const i0 = CANONICAL_TRIANGLES[t * 3]
    const i1 = CANONICAL_TRIANGLES[t * 3 + 1]
    const i2 = CANONICAL_TRIANGLES[t * 3 + 2]

    // UV-space corners (destination).
    const u0x = CANONICAL_UVS[i0 * 2] * size
    const u0y = (1 - CANONICAL_UVS[i0 * 2 + 1]) * size
    const u1x = CANONICAL_UVS[i1 * 2] * size
    const u1y = (1 - CANONICAL_UVS[i1 * 2 + 1]) * size
    const u2x = CANONICAL_UVS[i2 * 2] * size
    const u2y = (1 - CANONICAL_UVS[i2 * 2 + 1]) * size

    const det = (u1x - u0x) * (u2y - u0y) - (u2x - u0x) * (u1y - u0y)
    if (Math.abs(det) < 1e-6) continue

    // Photo-space corners (source).
    const p0 = landmarks[i0]
    const p1 = landmarks[i1]
    const p2 = landmarks[i2]
    if (!p0 || !p1 || !p2) continue
    const s0x = p0.x * W
    const s0y = p0.y * H
    const s1x = p1.x * W
    const s1y = p1.y * H
    const s2x = p2.x * W
    const s2y = p2.y * H


    // Rasterise the destination triangle.
    const minX = Math.max(0, Math.floor(Math.min(u0x, u1x, u2x)))
    const maxX = Math.min(size - 1, Math.ceil(Math.max(u0x, u1x, u2x)))
    const minY = Math.max(0, Math.floor(Math.min(u0y, u1y, u2y)))
    const maxY = Math.min(size - 1, Math.ceil(Math.max(u0y, u1y, u2y)))
    if (minX > maxX || minY > maxY) continue

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        // Barycentric test in UV space.
        const w0 = ((u1x - px) * (u2y - py) - (u2x - px) * (u1y - py)) / det
        const w1 = ((u2x - px) * (u0y - py) - (u0x - px) * (u2y - py)) / det
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue

        // Barycentric interpolation of the photo-space corners is equivalent to the
        // affine map, and cheaper than evaluating it twice.
        const sx = w0 * s0x + w1 * s1x + w2 * s2x
        const sy = w0 * s0y + w1 * s1y + w2 * s2y
        const ix = Math.min(W - 1, Math.max(0, Math.round(sx)))
        const iy = Math.min(H - 1, Math.max(0, Math.round(sy)))
        const si = (iy * W + ix) * 4
        const di = (y * size + x) * 4

        dst[di] = src[si]
        dst[di + 1] = src[si + 1]
        dst[di + 2] = src[si + 2]
        dst[di + 3] = 255
        mask[y * size + x] = 1
      }
    }
  }

  // --- fill holes, feather the boundary, and average the result -------------
  const feathered = featherMask(mask, size, feather)

  let coverage = 0
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < size * size; i++) {
    const m = feathered[i]
    if (m > 0.5) coverage++
    const di = i * 4
    if (m >= 0.999) continue
    // Outside the mask, leave black; the loader blends the bust tint in at the jaw.
    dst[di + 3] = Math.round(m * 255)
    if (m > 0.5) {
      r += dst[di]
      g += dst[di + 1]
      b += dst[di + 2]
      n++
    }
  }

  return {
    image: out,
    coverage: coverage / (size * size),
    averageColor: n > 0 ? { r: r / n, g: g / n, b: b / n } : { r: 180, g: 140, b: 120 },
    notes: [
      `projected ${size}x${size}`,
      `coverage ${(coverage / (size * size)).toFixed(2)}`,
      `interocular distance ${iod.toFixed(4)} of image width`,
    ],
  }
}

function distance2D(a: Landmark | undefined, b: Landmark | undefined): number {
  if (!a || !b) return 0
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Soft mask: dilate once to close pin-holes from rasterisation, then blur so the
 * boundary fades. A hard-edged mask produces a visible cut-out line across the jaw.
 */
function featherMask(mask: Float32Array, size: number, feather: number): Float32Array {
  const dilated = new Float32Array(mask)
  // 3x3 dilation to close single-texel holes.
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      if (mask[i] > 0) continue
      if (
        mask[i - 1] > 0 ||
        mask[i + 1] > 0 ||
        mask[i - size] > 0 ||
        mask[i + size] > 0 ||
        mask[i - size - 1] > 0 ||
        mask[i - size + 1] > 0 ||
        mask[i + size - 1] > 0 ||
        mask[i + size + 1] > 0
      ) {
        dilated[i] = 1
      }
    }
  }

  if (feather <= 0) return dilated

  // Separable box blur, `feather` passes approximated by a single wide kernel
  // applied horizontally then vertically (two box blurs approximate a Gaussian
  // closely enough for a mask).
  const tmp = new Float32Array(size * size)
  const out = new Float32Array(size * size)
  const radius = Math.max(1, Math.round(feather))
  const norm = 1 / (radius * 2 + 1)

  for (let y = 0; y < size; y++) {
    let acc = 0
    for (let x = -radius; x <= radius; x++) acc += dilated[y * size + Math.min(size - 1, Math.max(0, x))]
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc * norm
      const add = dilated[y * size + Math.min(size - 1, x + radius + 1)]
      const sub = dilated[y * size + Math.max(0, x - radius)]
      acc += add - sub
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(size - 1, Math.max(0, y)) * size + x]
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc * norm
      const add = tmp[Math.min(size - 1, y + radius + 1) * size + x]
      const sub = tmp[Math.max(0, y - radius) * size + x]
      acc += add - sub
    }
  }
  return out
}

/**
 * Geometric fit: compare the user's face proportions with the canonical model's and
 * return a subtle anisotropic scale plus head-size hint.
 *
 * Honest scope note: this aligns *proportions*, not identity. A full identity fit
 * would require retopologising the user's face onto the rig's 2694-vertex topology,
 * which is the "LAM backend" upgrade in docs/UPGRADES.md. What this buys us today is
 * that narrow faces render narrow and round faces render round, which is a large
 * perceptual win for a few lines of maths.
 */
export function fitFaceProportions(landmarks: Landmark[]): {
  scale: { x: number; y: number; z: number }
  faceWidthRatio: number
  faceHeightRatio: number
  notes: string[]
} {
  const left = landmarks[234]
  const right = landmarks[454]
  const top = landmarks[10]
  const chin = landmarks[152]
  if (!left || !right || !top || !chin) {
    return { scale: { x: 1, y: 1, z: 1 }, faceWidthRatio: 1, faceHeightRatio: 1, notes: ['proportions unavailable'] }
  }

  const width = Math.abs(right.x - left.x)
  const height = Math.abs(chin.y - top.y)
  if (width <= 1e-6 || height <= 1e-6) {
    return { scale: { x: 1, y: 1, z: 1 }, faceWidthRatio: 1, faceHeightRatio: 1, notes: ['proportions unavailable'] }
  }
  const aspect = width / height

  // Canonical model's own aspect, measured in its normalised units.
  const cLeft = { x: CANONICAL_POSITIONS[234 * 3], y: CANONICAL_POSITIONS[234 * 3 + 1] }
  const cRight = { x: CANONICAL_POSITIONS[454 * 3], y: CANONICAL_POSITIONS[454 * 3 + 1] }
  const cTop = { x: CANONICAL_POSITIONS[10 * 3], y: CANONICAL_POSITIONS[10 * 3 + 1] }
  const cChin = { x: CANONICAL_POSITIONS[152 * 3], y: CANONICAL_POSITIONS[152 * 3 + 1] }
  const canonicalAspect =
    Math.abs(cRight.x - cLeft.x) / Math.max(1e-6, Math.abs(cChin.y - cTop.y))

  // Apply only a fraction of the measured difference: a literal fit exaggerates
  // landmark noise and quickly looks wrong.
  const strength = 0.45
  const ratio = 1 + (aspect / canonicalAspect - 1) * strength
  const clamped = Math.max(0.82, Math.min(1.2, ratio))

  return {
    scale: {
      x: clamped,
      y: 1 / Math.sqrt(clamped),
      z: 1 / Math.sqrt(clamped),
    },
    faceWidthRatio: aspect,
    faceHeightRatio: height,
    notes: [`proportions aspect=${aspect.toFixed(3)} canonical=${canonicalAspect.toFixed(3)} scale=${clamped.toFixed(3)}`],
  }
}

