/**
 * The studio.
 *
 * Lighting for a "soft studio portrait" is mostly about *not* being dramatic: one
 * large soft key, a broad fill, a cool rim for edge separation, and enough ambient
 * bounce that shadows never go muddy. That is deliberately the same layout baked into
 * public/hdr/studio.hdr, so the environment map and the analytic lights agree instead
 * of fighting.
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
  key: new Color(0xfff2e4),
  fill: new Color(0xe8eeff),
  rim: new Color(0xbcd4ff),
  bounce: new Color(0xffd9be),
  ambient: new Color(0x2a3040),
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
  }
}

/** Intensity ratios. Key does the work; everything else shapes. */
export const INTENSITY = {
  key: 2.15,
  fill: 0.85,
  rim: 1.45,
  bounce: 0.35,
  ambient: 0.32,
} as const

/**
 * Environment map intensity for MeshPhysicalMaterial.
 *
 * Kept modest: the HDR carries the soft ambient shape, but the analytic lights carry
 * the form. Crank this up and the face flattens out.
 */
export const ENV_INTENSITY = 0.55

/** Tone-mapping exposure. Slightly under 1 because skin blows out easily under ACES. */
export const EXPOSURE = 0.94

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
    }
  }, [quality.shadowMapSize, quality.environment, headSize])
}
