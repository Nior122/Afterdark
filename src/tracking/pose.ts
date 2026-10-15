/**
 * Head pose and gaze, from MediaPipe to the avatar's joints.
 *
 * MediaPipe reports the face as a 4x4 transformation matrix in its own metric space:
 * right-handed, camera at the origin looking down -Z, units in centimetres, 63 degree
 * vertical field of view. A face looking straight at the camera has an almost
 * identity rotation and sits at roughly z = -40 to -60.
 *
 * The avatar is rendered by a three.js camera that also sits on +Z looking down -Z,
 * so the two spaces agree on handedness and axis meaning, and the rotation part can be
 * used directly. What still needs care is the *mirror* decision and the eye-look
 * conversion, both handled explicitly below.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { ARKIT_BLENDSHAPES } from '../avatar/arkit'
import { CHANNEL } from '../avatar/rig'

const DEG = Math.PI / 180

export interface PoseResult {
  /** Head rotation in the avatar's space, radians, Euler YXZ. */
  yaw: number
  pitch: number
  roll: number
  /** True when the matrix looked sane; false means "hold the previous pose". */
  valid: boolean
}

const scratchMatrix = new Matrix4()
const scratchQuat = new Quaternion()
const scratchEuler = new Euler(0, 0, 0, 'YXZ')
const scratchScale = new Vector3()
const scratchPos = new Vector3()

/** Largest rotation we will believe; beyond this the detector glitched. */
const MAX_BELIEVABLE = 100 * DEG

/**
 * Decompose MediaPipe's facial transformation matrix into avatar yaw/pitch/roll.
 *
 * @param data   the 16 floats from `facialTransformationMatrixes[0].data`, column-major
 * @param mirror when true (the default) the avatar behaves like a mirror: turning your
 *               head to your own left turns the avatar's head toward the same side of
 *               the screen, which is what a front-camera selfie does in every other app.
 */
export function decomposePose(data: ArrayLike<number>, mirror = true): PoseResult {
  if (!data || data.length !== 16) return { yaw: 0, pitch: 0, roll: 0, valid: false }

  // fromArray expects column-major, which is what MediaPipe provides.
  scratchMatrix.fromArray(data as number[])
  scratchMatrix.decompose(scratchPos, scratchQuat, scratchScale)

  // Reject obviously broken matrices rather than throwing the head across the room.
  if (!Number.isFinite(scratchQuat.x) || !Number.isFinite(scratchQuat.w)) {
    return { yaw: 0, pitch: 0, roll: 0, valid: false }
  }
  if (scratchScale.x < 1e-4 || !Number.isFinite(scratchScale.x)) {
    return { yaw: 0, pitch: 0, roll: 0, valid: false }
  }

  scratchEuler.setFromQuaternion(scratchQuat, 'YXZ')

  // A mirror image is a flip about the Y axis, which negates yaw and roll but
  // leaves pitch alone. That single negation is the whole mirror behaviour.
  const s = mirror ? -1 : 1
  const yaw = scratchEuler.y * s
  const pitch = scratchEuler.x
  const roll = scratchEuler.z * s

  if (Math.abs(yaw) > MAX_BELIEVABLE || Math.abs(pitch) > MAX_BELIEVABLE) {
    return { yaw: 0, pitch: 0, roll: 0, valid: false }
  }

  return { yaw, pitch, roll, valid: true }
}

/**
 * Physically plausible clamping.
 *
 * A human head turns about 70-80 degrees each way before the shoulders take over, and
 * tilts about 45. Clamping rather than rejecting means an extreme-but-real pose still
 * renders sensibly, and a detector spike gets pinned to the limit instead of snapping.
 */
export const POSE_LIMITS = {
  yaw: 78 * DEG,
  pitch: 42 * DEG,
  roll: 48 * DEG,
} as const

export function clampPose(p: PoseResult): PoseResult {
  const c = (v: number, lim: number) => (v > lim ? lim : v < -lim ? -lim : v)
  return {
    yaw: c(p.yaw, POSE_LIMITS.yaw),
    pitch: c(p.pitch, POSE_LIMITS.pitch),
    roll: c(p.roll, POSE_LIMITS.roll),
    valid: p.valid,
  }
}

/**
 * Convert MediaPipe's eight eye-look channels into a shared gaze direction plus a
 * per-eye split.
 *
 * MediaPipe's naming is relative to each eye, so the signs differ between sides:
 *   looking to the SUBJECT'S RIGHT is  eyeLookInLeft / eyeLookOutRight
 *   looking to the SUBJECT'S LEFT  is   eyeLookOutLeft / eyeLookInRight
 * This is the single most error-prone part of the whole mapping, so it lives in one
 * place with a test.
 */
export function extractGaze(values: Float32Array): {
  /** Shared gaze, -1..1, positive = subject's right / up. */
  x: number
  y: number
  /** Per-eye components, for the Split control in the eye panel. */
  leftX: number
  leftY: number
  rightX: number
  rightY: number
} {
  const at = (name: (typeof ARKIT_BLENDSHAPES)[number]) => values[CHANNEL[name]] ?? 0

  const lookInLeft = at('eyeLookInLeft')
  const lookOutLeft = at('eyeLookOutLeft')
  const lookInRight = at('eyeLookInRight')
  const lookOutRight = at('eyeLookOutRight')
  const lookUpLeft = at('eyeLookUpLeft')
  const lookDownLeft = at('eyeLookDownLeft')
  const lookUpRight = at('eyeLookUpRight')
  const lookDownRight = at('eyeLookDownRight')

  // Net horizontal for each eye, in "toward the subject's right" units.
  const leftX = lookInLeft - lookOutLeft
  const rightX = lookOutRight - lookInRight
  const leftY = lookUpLeft - lookDownLeft
  const rightY = lookUpRight - lookDownRight

  return {
    x: (leftX + rightX) / 2,
    y: (leftY + rightY) / 2,
    leftX,
    leftY,
    rightX,
    rightY,
  }
}

/**
 * MediaPipe category name -> our channel index.
 *
 * MediaPipe emits exactly the ARKit 52 names, so this is a direct lookup, but we build
 * it once as a table and drop unknown names instead of trusting the detector's order.
 */
export const CATEGORY_TO_CHANNEL: Int16Array = (() => {
  const table = new Int16Array(ARKIT_BLENDSHAPES.length).fill(-1)
  // The detector emits ARKit names verbatim, so the mapping is the identity — but it
  // is still an explicit table, so an unexpected name is dropped rather than
  // silently landing in the wrong channel.
  ARKIT_BLENDSHAPES.forEach((_name, index) => {
    table[index] = index
  })
  return table
})()

/**
 * Copy MediaPipe blendshape categories into a flat channel-indexed array.
 *
 * Writing by resolved index rather than by iteration order means a change in
 * MediaPipe's output order cannot silently scramble the face.
 */
export function blendshapesToChannels(
  categories: { categoryName: string; score: number }[],
  out: Float32Array,
): void {
  out.fill(0)
  for (const category of categories) {
    const index = CHANNEL[category.categoryName as (typeof ARKIT_BLENDSHAPES)[number]]
    if (index === undefined) continue
    out[index] = category.score
  }
}
