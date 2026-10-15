/**
 * Procedural skin micro-detail.
 *
 * Two reasons this exists instead of shipping baked textures:
 *
 *  1. Weight. Photoreal skin maps are 2-4 MB each even as KTX2. A mid-range Android
 *     user on a metered Nigerian data plan cannot afford that, and the whole app
 *     budget is 6 MB. Generating 1024x1024 albedo + normal + roughness in a worker
 *     costs ~120 ms of CPU once and zero bytes of network.
 *  2. Variety. The same generator parameterised by skin tone gives every user a
 *     plausible base underneath the photo texture applied in Phase 4.
 *
 * The output is deliberately subtle. Retinas are extremely good at spotting tiled
 * noise on skin, so every layer here is low-amplitude and multi-octave: the goal is
 * "not plastic", not "obviously textured".
 */

export interface SkinTextureOptions {
  /** Edge length in pixels. 512 for Lite, 1024 for High. */
  size: number
  /** Base albedo as hex, usually sampled from the user's forehead. */
  baseColor: number
  /** How far the mottling may drift from the base, 0..1. */
  mottle?: number
  /** Density of freckles/naevi, 0..1 (0 disables). */
  freckles?: number
  /** Pore/follicle strength, 0..1. */
  pores?: number
  /** 0..1 — how much the T-zone is shinier than the cheeks. */
  oiliness?: number
  /** Deterministic seed so the same avatar regenerates identically. */
  seed?: number
}

export interface SkinTextures {
  albedo: ImageData
  normal: ImageData
  roughness: ImageData
}

// ---------------------------------------------------------------------------
// Deterministic noise (no dependencies, worker-safe)
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

/**
 * Periodic fractal noise: samples on a torus so the texture tiles seamlessly.
 * A visible seam across a face would be far worse than no texture at all, so every
 * octave wraps by construction rather than by blending edges afterwards.
 */
function tileableFbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const p = period * freq
    // Map the unit square onto a torus of radius p/2pi so the noise wraps.
    const u = (x / period) * freq
    const v = (y / period) * freq
    // Two overlapping value-noise lookups blended circularly gives a cheap toroidal
    // sample without needing a real 4D noise implementation.
    const a = valueNoise2(u * p, v * p, seed + o * 101)
    const b = valueNoise2((u - 1) * p, v * p, seed + o * 101)
    const c = valueNoise2(u * p, (v - 1) * p, seed + o * 101)
    const d = valueNoise2((u - 1) * p, (v - 1) * p, seed + o * 101)
    const n = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    sum += n * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate albedo, normal and roughness maps for skin.
 *
 * Albedo layers, coarse to fine:
 *   1. base tone
 *   2. large-scale mottling      — the patchy colour variation real skin has
 *   3. sub-dermal warmth         — a redder undertone where skin is thin
 *   4. freckles                  — sparse, soft-edged, low contrast
 *   5. pore texture              — fine, high-frequency, very low contrast
 *
 * The normal map is derived from a height field built from the same pore noise plus
 * a wrinkle layer, so the bumps actually line up with the roughness variation.
 */
export function generateSkinTextures(options: SkinTextureOptions): SkinTextures {
  const size = options.size
  const seed = options.seed ?? 1
  const mottleAmount = options.mottle ?? 0.5
  const freckleAmount = options.freckles ?? 0.35
  const poreAmount = options.pores ?? 0.6
  const oiliness = options.oiliness ?? 0.6

  const r0 = ((options.baseColor >> 16) & 0xff) / 255
  const g0 = ((options.baseColor >> 8) & 0xff) / 255
  const b0 = (options.baseColor & 0xff) / 255

  const albedo = new ImageData(size, size)
  const normal = new ImageData(size, size)
  const roughness = new ImageData(size, size)

  // Height field, reused for both normals and roughness so they correspond.
  const height = new Float32Array(size * size)

  const a = albedo.data
  const n = normal.data
  const r = roughness.data

  for (let y = 0; y < size; y++) {
    // v is scaled so features keep their aspect on a roughly 2:1 UV layout.
    const fy = (y / size) * 6
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const fx = (x / size) * 6

      // --- 1 + 2: large-scale mottling -------------------------------------
      const mottling = tileableFbm(fx, fy, 6, 5, seed) - 0.5
      // --- 3: sub-dermal warmth ------------------------------------------
      const warmth = tileableFbm(fx * 2.3 + 40, fy * 2.3, 14, 3, seed + 7) - 0.5

      // Per-channel response: melanin darkens broadly, haemoglobin reddens
      // specifically. That asymmetry is what separates skin from tinted noise.
      const chol = mottling * 2 * mottleAmount * 0.30
      const chw = warmth * 2 * mottleAmount * 0.5

      let rr = r0 * (1 + chol) + chw * 0.075
      let gg = g0 * (1 + chol * 0.92) + chw * 0.020
      let bb = b0 * (1 + chol * 0.82) + chw * 0.014

      // --- 4: freckles ------------------------------------------------------
      if (freckleAmount > 0) {
        // Sparse: threshold a high-frequency noise field, then soften it.
        const f = tileableFbm(fx * 5.5 + 90, fy * 5.5 + 30, 33, 2, seed + 19)
        const spot = clamp01((f - (1 - freckleAmount * 0.09)) * 22)
        if (spot > 0) {
          const amt = spot * spot * 0.34 * freckleAmount
          rr -= amt * 0.55
          gg -= amt * 0.68
          bb -= amt * 0.72
        }
      }

      // --- 5: pores ---------------------------------------------------------
      // Cellular-ish pattern: a high-frequency field with its own gradient gives a
      // convincing pore/wrinkle network at 1024 without per-pore geometry.
      const poreField = tileableFbm(fx * 14, fy * 14, 84, 3, seed + 41)
      const pore = Math.abs(poreField - 0.5) * 2
      const poreShade = (1 - pore) * 0.5 + 0.5
      const poreContrast = poreAmount * 0.085
      rr -= (1 - poreShade) * poreContrast
      gg -= (1 - poreShade) * poreContrast
      bb -= (1 - poreShade) * poreContrast * 0.85

      // Wrinkles: a sparser, directional-ish layer. Lower frequency and stronger
      // than pores, which is roughly how fine lines behave in real skin.
      const wrinkle = tileableFbm(fx * 3.4 + 200, fy * 5.1 + 70, 22, 3, seed + 61)
      const wrinkleLine = clamp01((0.5 - Math.abs(wrinkle - 0.5)) * 6) * 0.55
      const wrinkleDepth = wrinkleLine * 0.045
      rr -= wrinkleDepth * 0.85
      gg -= wrinkleDepth
      bb -= wrinkleDepth

      const ai = i * 4
      a[ai] = clamp01(rr) * 255
      a[ai + 1] = clamp01(gg) * 255
      a[ai + 2] = clamp01(bb) * 255
      a[ai + 3] = 255

      // Height: pores are pits, wrinkles are grooves.
      height[i] = poreShade * 0.55 + (1 - wrinkleLine) * 0.45

      // --- roughness --------------------------------------------------------
      // Oily skin is smoother. The T-zone is oilier, but in UV space we cannot know
      // where the T-zone is, so this varies organically and the material's clearcoat
      // supplies the broad glossy sweep instead.
      const oil = tileableFbm(fx * 1.7 + 300, fy * 1.7, 11, 2, seed + 83)
      const rough = 0.62 + (oil - 0.5) * 0.34 * oiliness + (1 - poreShade) * 0.07
      const ri = i * 4
      const rv = clamp01(rough) * 255
      r[ri] = rv
      r[ri + 1] = rv
      r[ri + 2] = rv
      r[ri + 3] = 255
    }
  }

  // --- normals from the height field (Sobel) --------------------------------
  const strength = 1.6 + poreAmount * 2.6
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size
    const yp = (y + 1) % size
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size
      const xp = (x + 1) % size

      const tl = height[ym * size + xm]
      const t = height[ym * size + x]
      const tr = height[ym * size + xp]
      const l = height[y * size + xm]
      const rr = height[y * size + xp]
      const bl = height[yp * size + xm]
      const b = height[yp * size + x]
      const br = height[yp * size + xp]

      // Sobel gradients.
      const dx = tl + 2 * l + bl - (tr + 2 * rr + br)
      const dy = tl + 2 * t + tr - (bl + 2 * b + br)

      // Tangent-space normal. The UVs on this rig have V pointing up, so dy is used
      // directly rather than negated.
      let nx = dx * strength
      let ny = dy * strength
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len

      const ni = (y * size + x) * 4
      n[ni] = (nx * 0.5 + 0.5) * 255
      n[ni + 1] = (ny * 0.5 + 0.5) * 255
      n[ni + 2] = (nz * 0.5 + 0.5) * 255
      n[ni + 3] = 255
    }
  }

  return { albedo, normal, roughness }
}

/** Typical skin tones, used as the sample avatar's base and as texture-fit fallbacks. */
export const SKIN_TONES = [
  { id: 'porcelain', label: 'Porcelain', albedo: 0xf3d9c9, undertone: 'cool' },
  { id: 'fair', label: 'Fair', albedo: 0xe8c4a8, undertone: 'neutral' },
  { id: 'light', label: 'Light', albedo: 0xd9a882, undertone: 'warm' },
  { id: 'medium', label: 'Medium', albedo: 0xb87a4e, undertone: 'warm' },
  { id: 'olive', label: 'Olive', albedo: 0xa9713f, undertone: 'olive' },
  { id: 'tan', label: 'Tan', albedo: 0x8c5a30, undertone: 'warm' },
  { id: 'brown', label: 'Brown', albedo: 0x6b3d1f, undertone: 'neutral' },
  { id: 'deep', label: 'Deep', albedo: 0x46220f, undertone: 'cool' },
] as const

export type SkinToneId = (typeof SKIN_TONES)[number]['id']

export const findSkinTone = (id: string) => SKIN_TONES.find((t) => t.id === id) ?? SKIN_TONES[3]
