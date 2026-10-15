/**
 * Shading model for the offline rasteriser.
 *
 * `raster.mjs` can shade a surface two ways. The original path is a single Lambert
 * light plus a rim term: enough to answer "is the head the right way round", and it is
 * what the earlier probe renders used. This module is the second path, and it exists
 * for one reason: the realism pass changed light *ratios* and material *response*, and
 * neither is visible under one Lambert light. To show that work honestly the offline
 * renderer has to respond to the same numbers the browser does.
 *
 * So this is a compact stand-in for three.js's lit path:
 *
 *   - diffuse      `albedo / π · Σ NdotL · lightColor · intensity`
 *   - specular     Blinn-Phong lobes standing in for GGX, one for the base surface and a
 *                  second, tighter one for MeshPhysicalMaterial's clearcoat. F0 is the
 *                  0.04 dielectric constant times `specularIntensity`.
 *   - point lights `1 / l^decay` falloff with three.js's `(1 - (l/cutoff)^4)²` cutoff.
 *   - sheen        `sheenColor · sheen · (1 - NdotV)²` — the flesh-scattering stand-in.
 *   - ambient/env  `albedo · ambientColor · (ambientIntensity + envIntensity)`.
 *   - exposure     applied before the ACES curve, exactly where three applies it.
 *
 * What it is *not*: there is no roughness-map lookup, no normal-map perturbation, no
 * shadow map, and no HDR environment (the environment is folded into a constant ambient
 * tint). Interpolation is affine rather than perspective-correct, as it is everywhere
 * else in this rasteriser. Treat the output as a controlled comparison between two sets
 * of constants, not as a rendering of what the browser will draw.
 */

const RECIPROCAL_PI = 1 / Math.PI

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** three.js's punctual-light distance attenuation, including its cutoff curve. */
export function distanceAttenuation(lightDistance, cutoffDistance, decayExponent) {
  const base = 1 / Math.max(Math.pow(Math.max(lightDistance, 1e-4), decayExponent), 0.01)
  if (cutoffDistance <= 0) return base
  const t = clamp(1 - Math.pow(lightDistance / cutoffDistance, 4), 0, 1)
  return base * t * t
}

/**
 * Blinn-Phong exponent standing in for a GGX lobe of the same perceptual roughness.
 * Clamped, because a clearcoat roughness of 0.02 maps to an exponent in the millions and
 * would resolve to whichever single pixel happened to land on the highlight — which reads
 * as noise rather than as a highlight.
 */
export function shininess(roughness) {
  const r = clamp(roughness, 0.012, 1)
  return clamp(2 / (r * r * r * r) - 2, 1, 20000)
}

/** One specular lobe: normalised Blinn-Phong, weighted by the Fresnel constant. */
function lobe(ndh, ndl, exponent, f0) {
  if (ndl <= 0 || ndh <= 0) return 0
  const norm = (exponent + 8) / (8 * Math.PI)
  return Math.pow(ndh, exponent) * norm * f0 * ndl
}

/**
 * @param {object} o
 * @param {number[]} o.albedo      linear RGB base colour
 * @param {number[]} o.normal      unit surface normal (world space)
 * @param {number[]} o.viewDir     unit vector from the surface toward the camera
 * @param {number[]} o.position    surface position in world space
 * @param {Array}    o.lights      [{ kind, dir?, position?, color:[r,g,b], intensity, distance?, decay? }]
 * @param {number[]} o.ambientColor
 * @param {number}   o.ambientIntensity
 * @param {number}   o.envIntensity
 * @param {object}   o.material    { roughness, specularIntensity, sheen, sheenColor, clearcoat, clearcoatRoughness }
 * @returns {number[]} linear RGB, before tone mapping
 */
export function shadePhysically({ albedo, normal, viewDir, position, lights, ambientColor, ambientIntensity, envIntensity, material }) {
  const [nx, ny, nz] = normal
  const ndv = Math.max(0, nx * viewDir[0] + ny * viewDir[1] + nz * viewDir[2])

  const roughness = material.roughness ?? 0.6
  const specularStrength = (material.specularIntensity ?? 1) * 0.04
  const coat = material.clearcoat ?? 0
  const exponent = shininess(roughness)
  const coatExponent = shininess(material.clearcoatRoughness ?? 0.05)

  let r = 0
  let g = 0
  let b = 0

  for (const light of lights) {
    let lx
    let ly
    let lz
    let attenuation = 1

    if (light.kind === 'point') {
      lx = light.position[0] - position[0]
      ly = light.position[1] - position[1]
      lz = light.position[2] - position[2]
      const l = Math.hypot(lx, ly, lz) || 1e-4
      attenuation = distanceAttenuation(l, light.distance ?? 0, light.decay ?? 2)
      if (attenuation <= 1e-6) continue
      lx /= l
      ly /= l
      lz /= l
    } else {
      lx = light.dir[0]
      ly = light.dir[1]
      lz = light.dir[2]
      const l = Math.hypot(lx, ly, lz) || 1
      lx /= l
      ly /= l
      lz /= l
    }

    const ndl = nx * lx + ny * ly + nz * lz
    if (ndl <= 0) continue

    const energy = light.intensity * attenuation * ndl
    r += albedo[0] * RECIPROCAL_PI * light.color[0] * energy
    g += albedo[1] * RECIPROCAL_PI * light.color[1] * energy
    b += albedo[2] * RECIPROCAL_PI * light.color[2] * energy

    // Half-vector between the light and the eye.
    const hx = lx + viewDir[0]
    const hy = ly + viewDir[1]
    const hz = lz + viewDir[2]
    const hl = Math.hypot(hx, hy, hz) || 1
    const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl)

    let spec = lobe(ndh, ndl, exponent, specularStrength)
    if (coat > 0) spec += lobe(ndh, ndl, coatExponent, coat * 0.04) * (material.clearcoatFresnelBoost ? 2.4 : 1)

    const scale = light.intensity * attenuation
    r += light.color[0] * spec * scale
    g += light.color[1] * spec * scale
    b += light.color[2] * spec * scale
  }

  // Ambient + a constant stand-in for the HDR environment: both are just an even wash
  // of the base colour, which is what they mostly amount to on a matte surface.
  const wash = ambientIntensity + envIntensity
  r += albedo[0] * ambientColor[0] * wash
  g += albedo[1] * ambientColor[1] * wash
  b += albedo[2] * ambientColor[2] * wash

  // Sheen: a warm fresnel-ish lift at grazing angles. This is the term that keeps skin
  // from going matte-grey in the falloff, so it has to be in the comparison.
  if (material.sheen) {
    const fresnel = Math.pow(1 - ndv, 2)
    const sheenColor = material.sheenColor ?? [1, 1, 1]
    const amount = material.sheen * fresnel
    r += albedo[0] * sheenColor[0] * amount
    g += albedo[1] * sheenColor[1] * amount
    b += albedo[2] * sheenColor[2] * amount
  }

  return [r, g, b]
}
