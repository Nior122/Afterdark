/**
 * The rig: everything between "numbers describing a face" and "a posed scene graph".
 *
 * `Rig` owns three concerns and nothing else:
 *   1. Pose    — head/neck rotation with a natural split, plus counter-rotation so
 *                the neck never looks like it is bolted to a turntable.
 *   2. Expression — 52 morph targets, resolved once into a flat index table.
 *   3. Gaze    — separate eye pivot nodes, so the eyeballs rotate independently of
 *                the eyelids (which is what makes a look read as a look).
 *
 * It is deliberately free of React and of MediaPipe: the manual panels feed it the
 * same `FaceState` that the live tracker does, so both modes share one code path.
 */
import type { Object3D } from 'three'
import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import { ARKIT_BLENDSHAPES, type ArkitBlendshape } from './arkit'
import { compileIndexTable, resolveMapping, type BlendshapeMapping } from './blendshapeMap'
import type { RigHints } from './types'
import { devWarn } from '../lib/util'

/** Index of each ARKit channel inside `expression`. */
const CHANNEL = Object.fromEntries(ARKIT_BLENDSHAPES.map((n, i) => [n, i])) as Record<ArkitBlendshape, number>
export const CHANNEL_COUNT = ARKIT_BLENDSHAPES.length

/** Everything the rig needs to render one frame. All values are already smoothed. */
export interface FaceState {
  /** Head yaw/pitch/roll in radians, already mirrored into avatar space. */
  headYaw: number
  headPitch: number
  headRoll: number
  /** Gaze direction per eye, in normalised [-1, 1] eyeball-rotation units. */
  gazeXLeft: number
  gazeYLeft: number
  gazeXRight: number
  gazeYRight: number
  /** 52 ARKit channels, indexed by CHANNEL. */
  expression: Float32Array
}

export const createFaceState = (): FaceState => ({
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  gazeXLeft: 0,
  gazeYLeft: 0,
  gazeXRight: 0,
  gazeYRight: 0,
  expression: new Float32Array(CHANNEL_COUNT),
})

export const resetFaceState = (s: FaceState): void => {
  s.headYaw = 0
  s.headPitch = 0
  s.headRoll = 0
  s.gazeXLeft = 0
  s.gazeYLeft = 0
  s.gazeXRight = 0
  s.gazeYRight = 0
  s.expression.fill(0)
}

/** Fraction of the head's rotation that the neck takes instead. */
const NECK_SHARE = 0.22
/** Eyeball rotation limits, in radians, for a full gaze deflection. */
const MAX_EYE_YAW = 0.42
const MAX_EYE_PITCH = 0.26

export interface RigDiagnostics {
  morphTargetCount: number
  mappedChannels: number
  coverage: number
  missingChannels: ArkitBlendshape[]
  headNodeFound: boolean
  neckNodeFound: boolean
  eyeNodesFound: 0 | 1 | 2
  faceMeshFound: boolean
}

export class Rig {
  readonly diagnostics: RigDiagnostics

  private readonly headNode: Object3D | null
  private readonly neckNode: Object3D | null
  private readonly eyeLeftNode: Object3D | null
  private readonly eyeRightNode: Object3D | null
  private readonly faceMesh: { morphTargetInfluences?: number[]; morphTargetDictionary?: Record<string, number> } | null
  private readonly influences: number[] | null
  private readonly indexTable: Int16Array
  /** Rest pose of the eye pivots, so gaze is applied as an offset from neutral. */
  private readonly eyeLeftRest: Quaternion
  private readonly eyeRightRest: Quaternion

  /**
   * The head's rotation relative to its rest pose, updated by `apply()`. Read by the
   * neck skin so the bust bends with the head instead of hinging at the jaw.
   */
  readonly headDelta = new Quaternion()

  private readonly headBase = new Quaternion()
  private readonly neckBase = new Quaternion()
  private readonly tmpQuat = new Quaternion()
  private readonly tmpEuler = new Euler()
  private readonly tmpVec = new Vector3()

  constructor(root: Object3D, hints?: RigHints) {
    const find = (name: string | undefined): Object3D | null => (name ? (root.getObjectByName(name) ?? null) : null)

    // --- resolve nodes -------------------------------------------------------
    // Prefer provider hints; otherwise fall back to well-known names used by the
    // ARKit-style exports we ship (facecap.glb) and by Avaturn's rig.
    const byName = (...names: string[]): Object3D | null => {
      for (const n of names) {
        const found = root.getObjectByName(n)
        if (found) return found
      }
      return null
    }

    this.headNode = find(hints?.headNode) ?? byName('head', 'Head', 'Head_M', 'mixamorigHead')
    this.neckNode = find(hints?.neckNode) ?? byName('neck', 'Neck', 'Neck_M', 'mixamorigNeck')
    this.eyeLeftNode = find(hints?.eyeLeftNode) ?? byName('grp_eyeLeft', 'eyeLeft', 'EyeLeft', 'eye_L', 'LeftEye')
    this.eyeRightNode = find(hints?.eyeRightNode) ?? byName('grp_eyeRight', 'eyeRight', 'EyeRight', 'eye_R', 'RightEye')

    // --- resolve the mesh carrying morph targets -----------------------------
    let mesh: Rig['faceMesh'] = null
    if (hints?.faceMesh) {
      const hinted = root.getObjectByName(hints.faceMesh)
      mesh = (hinted as unknown as Rig['faceMesh']) ?? null
    }
    if (!mesh?.morphTargetDictionary) {
      // Pick whichever mesh has the most morph targets — that is the face.
      let best: Rig['faceMesh'] = null
      let bestCount = 0
      root.traverse((o) => {
        const m = o as unknown as { morphTargetDictionary?: Record<string, number> }
        const count = m.morphTargetDictionary ? Object.keys(m.morphTargetDictionary).length : 0
        if (count > bestCount) {
          bestCount = count
          best = o as unknown as Rig['faceMesh']
        }
      })
      mesh = best
    }

    const dictionary = mesh?.morphTargetDictionary
    if (mesh && mesh.morphTargetDictionary && !mesh.morphTargetInfluences) {
      // three.js populates influences lazily only when a morph target is touched.
      devWarn('face mesh has morphTargetDictionary but no influences array')
    }

    const { mapping, missing, coverage } = resolveMapping(dictionary, hints?.blendshapeMapping)
    this.faceMesh = mesh
    this.influences = mesh?.morphTargetInfluences ?? null
    this.indexTable = dictionary ? compileIndexTable(mapping, dictionary) : new Int16Array(CHANNEL_COUNT).fill(-1)

    this.diagnostics = {
      morphTargetCount: dictionary ? Object.keys(dictionary).length : 0,
      mappedChannels: CHANNEL_COUNT - missing.length,
      coverage,
      missingChannels: missing,
      headNodeFound: !!this.headNode,
      neckNodeFound: !!this.neckNode,
      eyeNodesFound: ((this.eyeLeftNode ? 1 : 0) + (this.eyeRightNode ? 1 : 0)) as 0 | 1 | 2,
      faceMeshFound: !!mesh,
    }

    // THREE requires influences to be allocated before animation; if the model has
    // morph targets the loader already created the array, but be defensive.
    if (this.faceMesh && !this.influences && dictionary) {
      const count = Math.max(...Object.values(dictionary).map((v) => v + 1))
      ;(this.faceMesh as { morphTargetInfluences?: number[] }).morphTargetInfluences = new Array(count).fill(0)
      this.influences = this.faceMesh.morphTargetInfluences ?? null
    }

    // --- remember rest pose --------------------------------------------------
    if (this.headNode) this.headBase.copy(this.headNode.quaternion)
    if (this.neckNode) this.neckBase.copy(this.neckNode.quaternion)
    this.eyeLeftRest = this.eyeLeftNode ? this.eyeLeftNode.quaternion.clone() : new Quaternion()
    this.eyeRightRest = this.eyeRightNode ? this.eyeRightNode.quaternion.clone() : new Quaternion()

    if (__DEV_MODE__) {
      // One concise report per load — this is the first thing to check when a new
      // model does not animate.
      console.info('[faceverify] rig resolved', {
        morphTargets: this.diagnostics.morphTargetCount,
        mappedChannels: this.diagnostics.mappedChannels,
        coverage: `${(this.diagnostics.coverage * 100).toFixed(0)}%`,
        head: this.diagnostics.headNodeFound,
        neck: this.diagnostics.neckNodeFound,
        eyes: this.diagnostics.eyeNodesFound,
        missing: this.diagnostics.missingChannels,
      })
    }
  }

  /** True when the rig cannot animate at all — the UI uses this to warn early. */
  get isDriveable(): boolean {
    return this.influences !== null && this.diagnostics.mappedChannels > 0
  }

  /**
   * Apply one frame. `intensity` scales expression only (used by the manual mode's
   * gentle defaults); pose is always applied fully.
   */
  apply(state: FaceState, intensity = 1): void {
    // --- pose ---------------------------------------------------------------
    // Yaw/pitch/roll -> quaternion. Order YXZ reads most naturally for a head:
    // turning left and right should not couple into roll.
    this.tmpEuler.set(state.headPitch, state.headYaw, state.headRoll, 'YXZ')
    this.tmpQuat.setFromEuler(this.tmpEuler)

    if (this.headNode) {
      // Split the rotation: the head carries most of it, the neck a little, which
      // is what stops a big turn from looking like the head is on a swivel.
      this.headDelta.copy(this.tmpQuat)
      this.headNode.quaternion.copy(this.headBase).multiply(this.headDelta)
    }

    if (this.neckNode) {
      // Neck follows the same direction at a reduced angle, easing the silhouette.
      this.tmpEuler.set(
        state.headPitch * NECK_SHARE,
        state.headYaw * NECK_SHARE,
        state.headRoll * NECK_SHARE * 0.5,
        'YXZ',
      )
      this.tmpQuat.setFromEuler(this.tmpEuler)
      this.neckNode.quaternion.copy(this.neckBase).multiply(this.tmpQuat)
    }

    // --- gaze ---------------------------------------------------------------
    // Convention, applied identically to both eyes (both eyeballs rotate together
    // when a person looks in a direction):
    //   gazeX +1  -> looking toward the SUBJECT'S RIGHT, which is +X in model space
    //   gazeY +1  -> looking UP
    //
    // The mapping to rotations, worked through once so it does not need re-deriving:
    //   * The pupil faces +Z. A rotation about +Y by a positive angle sends +Z toward
    //     +X, i.e. to the subject's right. So yaw = +gazeX * MAX_EYE_YAW.
    //   * A rotation about +X by a positive angle sends +Z toward -Y, i.e. downward.
    //     So pitch = -gazeY * MAX_EYE_PITCH.
    if (this.eyeLeftNode) {
      this.tmpEuler.set(-state.gazeYLeft * MAX_EYE_PITCH, state.gazeXLeft * MAX_EYE_YAW, 0, 'YXZ')
      this.tmpQuat.setFromEuler(this.tmpEuler)
      this.eyeLeftNode.quaternion.copy(this.eyeLeftRest).multiply(this.tmpQuat)
    }
    if (this.eyeRightNode) {
      this.tmpEuler.set(-state.gazeYRight * MAX_EYE_PITCH, state.gazeXRight * MAX_EYE_YAW, 0, 'YXZ')
      this.tmpQuat.setFromEuler(this.tmpEuler)
      this.eyeRightNode.quaternion.copy(this.eyeRightRest).multiply(this.tmpQuat)
    }

    // --- expression ---------------------------------------------------------
    const influences = this.influences
    if (!influences) return
    const table = this.indexTable
    const expr = state.expression
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      const idx = table[ch]
      if (idx < 0) continue
      influences[idx] = MathUtils.clamp(expr[ch] * intensity, 0, 1)
    }
  }

  /** Ease everything back to rest over `dt` seconds. Used on lost tracking. */
  easeToNeutral(state: FaceState, dt: number, rate = 6): void {
    const k = 1 - Math.exp(-rate * dt)
    state.headYaw += (0 - state.headYaw) * k
    state.headPitch += (0 - state.headPitch) * k
    state.headRoll += (0 - state.headRoll) * k
    state.gazeXLeft += (0 - state.gazeXLeft) * k
    state.gazeYLeft += (0 - state.gazeYLeft) * k
    state.gazeXRight += (0 - state.gazeXRight) * k
    state.gazeYRight += (0 - state.gazeYRight) * k
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      state.expression[i] += (0 - state.expression[i]) * k
    }
    this.apply(state)
  }

  /** World-space bounds of the head, for framing the studio camera. */
  measure(target: Object3D): { center: Vector3; size: Vector3 } {
    const node = this.headNode ?? target
    return { center: node.getWorldPosition(this.tmpVec).clone(), size: new Vector3(0.2, 0.26, 0.22) }
  }

  /** Set a single ARKit channel by name. Convenience for the manual panels. */
  static channel(name: ArkitBlendshape): number {
    return CHANNEL[name]
  }

  get mapping(): BlendshapeMapping {
    return Object.fromEntries(
      ARKIT_BLENDSHAPES.map((n, i) => (this.indexTable[i] >= 0 ? [n, n] : [n, ''])).filter(([, v]) => v !== ''),
    ) as BlendshapeMapping
  }
}

export { CHANNEL }
