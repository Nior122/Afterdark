/**
 * The 52 ARKit standard blendshapes.
 *
 * Everything in the app speaks this vocabulary: MediaPipe category names are the
 * same 52 strings, so the tracking layer needs no translation table. Only the
 * *avatar* side differs per model, which is why `blendshapeMap.ts` exists.
 */
export const ARKIT_BLENDSHAPES = [
  // Brow
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  // Cheek
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  // Eye
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  // Eye look
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  // Jaw
  'jawForward',
  'jawLeft',
  'jawRight',
  'jawOpen',
  // Mouth
  'mouthClose',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthFunnel',
  'mouthLeft',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'mouthRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  // Nose
  'noseSneerLeft',
  'noseSneerRight',
  // Tongue (optional in ARKit; MediaPipe does not emit it)
  'tongueOut',
] as const

export type ArkitBlendshape = (typeof ARKIT_BLENDSHAPES)[number]

export const ARKIT_BLENDSHAPE_SET: ReadonlySet<string> = new Set<string>(ARKIT_BLENDSHAPES)

/** Sparse blendshape pose — only the channels that are actually driven. */
export type BlendshapePose = Partial<Record<ArkitBlendshape, number>>

/** Logical groups used by the manual control panels. */
export const EYE_LOOK_SHAPES = [
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeLookDownLeft',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeLookDownRight',
] as const satisfies readonly ArkitBlendshape[]

export const EYE_BLINK_SHAPES = ['eyeBlinkLeft', 'eyeBlinkRight'] as const satisfies readonly ArkitBlendshape[]

export const MOUTH_SHAPES = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthPucker',
  'mouthFunnel',
  'mouthClose',
  'mouthPressLeft',
  'mouthPressRight',
] as const satisfies readonly ArkitBlendshape[]

export const allZeroPose = (): Record<ArkitBlendshape, number> =>
  Object.fromEntries(ARKIT_BLENDSHAPES.map((n) => [n, 0])) as Record<ArkitBlendshape, number>
