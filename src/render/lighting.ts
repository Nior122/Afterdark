/**
 * The studio.
 *
 * Lighting for a "soft studio portrait" is mostly about *not* being dramatic: one
 * large soft key, a broad fill, a cool rim for edge separation, and enough ambient
 * bounce that shadows never go muddy. That is deliberately the same layout baked into
 * public/hdr/studio.hdr, so the environment map and the analytic lights agree instead
 * of fighting.
 *
 * Five things carry the realism here, in order of how much they matter:
 *
 *  1. **The key is warm and slightly above the eyeline.** Portrait lighting is warm
 *     and high; anything else reads as a vacuum.
 *  2. **The fill is cool and weak.** 1:4 is a portrait ratio. A strong fill flattens
 *     the face into a mask — that, not polygon count, is what usually looks "CG".
 *  3. **The rim separates hair from the background.** Without it dark hair merges
 *     into the dark studio and the head loses its silhouette.
 *  4. **A catchlight.** A small bright source near the camera axis puts a specular dot
 *     in each cornea. This is the single strongest "these are eyes, not marbles" cue,
 *     and it costs one point light with no shadow.
 *  5. **Ambient stays low and blue.** It only exists so shadows do not crush to black;
 *     the environment map does the real ambient work.
 *
 * Everything here scales with the quality tier, because on a mid-range Android the
 * difference between one shadow-casting light and three is most of the frame budget.
 */
import { useMemo } from 'react'
import { Color, type Vector3 } from 'three'
import type { QualitySettings } from './quality'

export interface StudioLightingProps {
  quality: QualitySettings
  /** Head-relative scale used to size shadow cameras. */
  headSize?: number
}

/** Warm key, neutral fill, cool rim — the classic three-point ratio, softened. */
export const STUDIO_COLORS = {
  key: new Color(0xfff1e0),
  fill: new Color(0xdfe9ff),
  rim: new Color(0xb4d0ff),
  bounce: new Color(0xffd2b0),
  ambient: new Color(0x232a3a),
  /** The hair/back light is cooler than the key: it reads as a separate instrument. */
  top: new Color(0xcfe0ff),
  /** Catchlight: slightly warm, because it stands in for a reflected softbox. */
  catchlight: new Color(0xfff6ea),
} as const

/**
 * The catchlight, as a bounded flood from the lens axis.
 *
 * It is deliberately *not* a point light. A point light bright enough to put a dot in a
 * cornea has to sit ~0.2 head-heights off the face, and at that range its inverse-square
 * falloff (`1 / l^decay`) makes it by far the brightest thing in the scene — the eyelid
 * and the side of the nose blow out to white, and it gets worse the closer the avatar is
 * framed. A camera-axis directional light is what a real ring/beauty light is: bounded,
 * uniform across the face, and it still lands a tight specular dot in both corneas,
 * because both eyes are pointed at the lens.
 */
export const CATCHLIGHT = {
  /**
   * Kept well under the key. Its only job is the highlight: at this strength it adds a
   * hair of even frontal light and nothing else. Push it up and the 1:4 ratio that gives
   * the face its form flattens out.
   */
  intensity: 0.34,
} as const

/**
 * Positions are expressed in units of "head heights from the head's centre" so the
 * rig looks the same regardless of the avatar's absolute scale.
 */
export const LIGHT_GEOMETRY = {
  key: { x: -0.95, y: 0.85, z: 1.25 },
  fill: { x: 1.1, y: 0.35, z: 0.9 },
  rim: { x: 0.25, y: 0.6, z: -1.5 },
  bounce: { x: 0, y: -0.9, z: 0.6 },
  top: { x: -0.1, y: 1.35, z: -0.25 },
  /**
   * Just off the lens axis, a little above and to the model's left. A perfectly on-axis
   * catchlight looks like a flashlight; the offset is what gives the eye a direction to
   * be looking from, which is most of what makes a portrait feel attended to.
   *
   * For a directional light `position` is the direction the light *comes from*, so this
   * is the camera axis, tilted.
   */
  catchlight: { x: 0.16, y: 0.22, z: 1 },
} as const

export function studioLightPositions(headSize: number, target: Vector3 | [number, number, number] = [0, 0, 0]) {
  const t = Array.isArray(target) ? target : [target.x, target.y, target.z]
  const at = (p: { x: number; y: number; z: number }): [number, number, number] => [
    t[0] + p.x * headSize,
    t[1] + p.y * headSize,
    t[2] + p.z * headSize,
  ]
  return {
    key: at(LIGHT_GEOMETRY.key),
    fill: at(LIGHT_GEOMETRY.fill),
    rim: at(LIGHT_GEOMETRY.rim),
    bounce: at(LIGHT_GEOMETRY.bounce),
    top: at(LIGHT_GEOMETRY.top),
    catchlight: at(LIGHT_GEOMETRY.catchlight),
  }
}

/**
 * The bounce card.
 *
 * It sits ~0.18 m under the chin, and that is the whole problem with modelling it as a
 * normal point light: at that range `1 / l^2` multiplies the intensity by ~30, so a
 * "subtle" 0.4 arrives as ~13 — several times the key — and washes the chest out to
 * white. Real bounce is a large, close area source, which is the one case where
 * three.js's `decay: 0` is the physically *better* approximation: no distance falloff,
 * a plain additive uplight, bounded by `distance` so it cannot leak up onto the face.
 */
export const BOUNCE = {
  decay: 0,
  /** Cutoff, in head heights. Past this the card contributes nothing at all. */
  distance: 1.6,
} as const

/**
 * Intensity ratios.
 *
 * Key does the work; the fill is deliberately four stops down so the cheek away from
 * the key falls into shape; the rim runs hot because it is fighting a dark background.
 */
export const INTENSITY = {
  key: 2.45,
  fill: 0.62,
  rim: 1.7,
  bounce: 0.42,
  ambient: 0.18,
  top: 0.55,
  catchlight: CATCHLIGHT.intensity,
} as const

/**
 * Environment map intensity for MeshPhysicalMaterial.
 *
 * Kept modest: the HDR carries the soft ambient shape, but the analytic lights carry
 * the form. Crank this up and the face flattens out.
 */
export const ENV_INTENSITY = 0.7

/** Tone-mapping exposure. Slightly under 1 because skin blows out easily under ACES. */
export const EXPOSURE = 0.92

export function useStudioLighting(quality: QualitySettings, headSize = 1) {
  return useMemo(() => {
    const positions = studioLightPositions(headSize)
    return {
      positions,
      // Shadows only from the key: a single, well-placed shadow reads far better than
      // three soft ones fighting each other, and it costs a third as much.
      castShadow: quality.shadowMapSize > 0,
      shadowMapSize: quality.shadowMapSize,
      intensities: INTENSITY,
      colors: STUDIO_COLORS,
      envIntensity: quality.environment ? ENV_INTENSITY : 0,
      catchlight: CATCHLIGHT,
    }
  }, [quality.shadowMapSize, quality.environment, headSize])
}
