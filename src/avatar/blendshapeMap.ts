/**
 * Per-model morph-target name translation.
 *
 * MediaPipe hands us ARKit names. A given avatar's morph targets may be named
 * anything, so every rig carries a mapping. The mapping is resolved *once* at
 * load time into an index table (name -> morphTargetInfluences index), and any
 * unmapped channel is logged so a new model can be supported without guesswork.
 */
import { ARKIT_BLENDSHAPES, type ArkitBlendshape } from './arkit'

export type BlendshapeMapping = Partial<Record<ArkitBlendshape, string>>

/**
 * The "Face Cap" rig (facecap.glb, by Bannaflak) uses ARKit names split per side
 * with `_L` / `_R` suffixes. Verified against three.js's own webcam example and
 * against the model's 52 morph targets.
 */
export const FACECAP_MAPPING: BlendshapeMapping = {
  browDownLeft: 'browDown_L',
  browDownRight: 'browDown_R',
  browInnerUp: 'browInnerUp',
  browOuterUpLeft: 'browOuterUp_L',
  browOuterUpRight: 'browOuterUp_R',
  cheekPuff: 'cheekPuff',
  cheekSquintLeft: 'cheekSquint_L',
  cheekSquintRight: 'cheekSquint_R',
  eyeBlinkLeft: 'eyeBlink_L',
  eyeBlinkRight: 'eyeBlink_R',
  eyeLookDownLeft: 'eyeLookDown_L',
  eyeLookDownRight: 'eyeLookDown_R',
  eyeLookInLeft: 'eyeLookIn_L',
  eyeLookInRight: 'eyeLookIn_R',
  eyeLookOutLeft: 'eyeLookOut_L',
  eyeLookOutRight: 'eyeLookOut_R',
  eyeLookUpLeft: 'eyeLookUp_L',
  eyeLookUpRight: 'eyeLookUp_R',
  eyeSquintLeft: 'eyeSquint_L',
  eyeSquintRight: 'eyeSquint_R',
  eyeWideLeft: 'eyeWide_L',
  eyeWideRight: 'eyeWide_R',
  jawForward: 'jawForward',
  jawLeft: 'jawLeft',
  jawOpen: 'jawOpen',
  jawRight: 'jawRight',
  mouthClose: 'mouthClose',
  mouthDimpleLeft: 'mouthDimple_L',
  mouthDimpleRight: 'mouthDimple_R',
  mouthFrownLeft: 'mouthFrown_L',
  mouthFrownRight: 'mouthFrown_R',
  mouthFunnel: 'mouthFunnel',
  mouthLeft: 'mouthLeft',
  mouthLowerDownLeft: 'mouthLowerDown_L',
  mouthLowerDownRight: 'mouthLowerDown_R',
  mouthPressLeft: 'mouthPress_L',
  mouthPressRight: 'mouthPress_R',
  mouthPucker: 'mouthPucker',
  mouthRight: 'mouthRight',
  mouthRollLower: 'mouthRollLower',
  mouthRollUpper: 'mouthRollUpper',
  mouthShrugLower: 'mouthShrugLower',
  mouthShrugUpper: 'mouthShrugUpper',
  mouthSmileLeft: 'mouthSmile_L',
  mouthSmileRight: 'mouthSmile_R',
  mouthStretchLeft: 'mouthStretch_L',
  mouthStretchRight: 'mouthStretch_R',
  mouthUpperUpLeft: 'mouthUpperUp_L',
  mouthUpperUpRight: 'mouthUpperUp_R',
  noseSneerLeft: 'noseSneer_L',
  noseSneerRight: 'noseSneer_R',
  tongueOut: 'tongueOut',
}

/**
 * Fallback: assume the model already uses ARKit names verbatim (the ARKit sample
 * scans, and most DCC exports that follow Apple's naming). Anything unresolved is
 * dropped, which degrades gracefully instead of throwing.
 */
export const IDENTITY_MAPPING: BlendshapeMapping = Object.fromEntries(
  ARKIT_BLENDSHAPES.map((n) => [n, n]),
) as BlendshapeMapping

/**
 * Read the morph target names straight off a mesh dictionary and choose the best
 * mapping automatically. Explicitly-supplied mappings (from a provider) win.
 */
export function resolveMapping(
  morphTargetDictionary: Record<string, number> | undefined,
  preferred?: BlendshapeMapping,
): { mapping: BlendshapeMapping; missing: ArkitBlendshape[]; coverage: number } {
  const available = new Set(Object.keys(morphTargetDictionary ?? {}))

  const candidates: BlendshapeMapping[] = []
  if (preferred) candidates.push(preferred)
  // Only use the canned Face Cap map if the model actually looks like Face Cap.
  if (available.has('browDown_L') || available.has('eyeBlink_L')) candidates.push(FACECAP_MAPPING)
  candidates.push(IDENTITY_MAPPING)

  let best: BlendshapeMapping = {}
  let bestScore = -1
  for (const candidate of candidates) {
    let score = 0
    for (const name of ARKIT_BLENDSHAPES) {
      const target = candidate[name]
      if (target && available.has(target)) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  const mapping: BlendshapeMapping = {}
  const missing: ArkitBlendshape[] = []
  for (const name of ARKIT_BLENDSHAPES) {
    const target = best[name]
    if (target && available.has(target)) mapping[name] = target
    else missing.push(name)
  }

  return { mapping, missing, coverage: (ARKIT_BLENDSHAPES.length - missing.length) / ARKIT_BLENDSHAPES.length }
}

/**
 * Compile a name mapping into a flat Float32 array index table for the hot path:
 * `indexTable[channelId] = morphTargetInfluences index`, or -1 when unsupported.
 */
export function compileIndexTable(
  mapping: BlendshapeMapping,
  morphTargetDictionary: Record<string, number>,
): Int16Array {
  const table = new Int16Array(ARKIT_BLENDSHAPES.length).fill(-1)
  ARKIT_BLENDSHAPES.forEach((name, i) => {
    const target = mapping[name]
    if (target === undefined) return
    const idx = morphTargetDictionary[target]
    if (idx !== undefined) table[i] = idx
  })
  return table
}
