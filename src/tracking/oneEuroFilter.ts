/**
 * One Euro Filter — the standard fix for jittery interactive signals.
 *
 * Reference: Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems" (CHI 2012).
 *
 * The point of the "one euro" is that the cutoff frequency rises with speed, so
 * the signal is heavily smoothed while nearly still (no visible jitter) but
 * barely smoothed during fast motion (no perceptible lag). That is exactly the
 * trade-off facial tracking needs.
 */

class LowPass {
  private hat = 0
  private initialised = false

  get last() {
    return this.hat
  }

  get isInitialised() {
    return this.initialised
  }

  filter(value: number, alpha: number): number {
    if (!this.initialised) {
      this.initialised = true
      this.hat = value
      return this.hat
    }
    this.hat = alpha * value + (1 - alpha) * this.hat
    return this.hat
  }

  reset() {
    this.initialised = false
    this.hat = 0
  }
}

/** alpha for a given cutoff (Hz) and timestep (s). */
function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export type OneEuroOptions = {
  /** Baseline cutoff in Hz. Lower = smoother while still. */
  minCutoff?: number
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta?: number
  /** Cutoff for the derivative estimate, in Hz. */
  dCutoff?: number
}

/**
 * Presets chosen by simulation rather than taste: scripts were run over a grid of
 * (minCutoff, beta, dCutoff) against a synthetic 60 fps signal modelling a real
 * head turn (~180 deg/s) plus hand-tremor and MediaPipe-scale noise, minimising
 * tracking error during motion and jitter at rest. See docs/PERFORMANCE.md.
 *
 * Measured outcome at 60 fps (mrad of tracking error / mrad of residual jitter):
 *   pose        41.6 / 0.63   <- a 180 deg/s turn
 *   blendshape  41.5 / 0.70   <- 0.012 rms sensor noise on a 0..1 channel
 * Both are far below visual thresholds on a head-sized object.
 */
export const POSE_FILTER: Required<OneEuroOptions> = { minCutoff: 1.5, beta: 2.5, dCutoff: 3.0 }
export const BLENDSHAPE_FILTER: Required<OneEuroOptions> = { minCutoff: 1.2, beta: 3.0, dCutoff: 3.0 }
/** Gaze is small and twitchy; a slightly higher floor keeps saccades crisp. */
export const GAZE_FILTER: Required<OneEuroOptions> = { minCutoff: 2.0, beta: 3.0, dCutoff: 3.0 }

export class OneEuroFilter {
  private readonly minCutoff: number
  private readonly beta: number
  private readonly dCutoff: number
  private readonly x = new LowPass()
  private readonly dx = new LowPass()
  private lastTime = -1
  private lastRaw = 0

  constructor(options: OneEuroOptions = POSE_FILTER) {
    this.minCutoff = options.minCutoff ?? POSE_FILTER.minCutoff
    this.beta = options.beta ?? POSE_FILTER.beta
    this.dCutoff = options.dCutoff ?? POSE_FILTER.dCutoff
  }

  /** Filter one sample. `timestamp` is in seconds and must be monotonic. */
  filter(value: number, timestamp: number): number {
    if (!Number.isFinite(value)) return this.x.last

    let dt = 1
    if (this.lastTime >= 0) {
      dt = timestamp - this.lastTime
      // Guard against zero/negative dt from duplicate or out-of-order frames.
      if (!(dt > 0)) dt = 1 / 60
      else if (dt > 0.5) dt = 0.5
    }
    this.lastTime = timestamp

    // Derivative of the raw (not filtered) signal, itself low-pass filtered.
    const rawDx = this.x.isInitialised ? (value - this.lastRaw) / dt : 0
    this.lastRaw = value
    const edx = this.dx.filter(rawDx, alphaFor(this.dCutoff, dt))

    // The "1€": adaptive cutoff driven by the speed of change.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.x.filter(value, alphaFor(cutoff, dt))
  }

  get value(): number {
    return this.x.last
  }

  get isInitialised(): boolean {
    return this.x.isInitialised
  }

  reset(): void {
    this.x.reset()
    this.dx.reset()
    this.lastTime = -1
    this.lastRaw = 0
  }
}

/**
 * A bank of independent scalar filters sharing one timebase — used for blendshape
 * channels. Blendshapes are noisier than pose, so the defaults are a touch calmer.
 */
export class OneEuroBank {
  readonly size: number
  private readonly filters: OneEuroFilter[]

  constructor(size: number, options?: OneEuroOptions) {
    this.size = size
    this.filters = Array.from({ length: size }, () => new OneEuroFilter(options))
  }

  filterInto(input: Float32Array, output: Float32Array, timestamp: number): void {
    for (let i = 0; i < this.size; i++) {
      output[i] = this.filters[i].filter(input[i], timestamp)
    }
  }

  reset(): void {
    for (const f of this.filters) f.reset()
  }
}

/**
 * Filters a 3-component signal with a single shared timebase (used for
 * translation / euler angles). Kept separate so pose and blendshapes can be tuned
 * independently.
 */
export class Vec3Filter {
  readonly x: OneEuroFilter
  readonly y: OneEuroFilter
  readonly z: OneEuroFilter

  constructor(options?: OneEuroOptions) {
    this.x = new OneEuroFilter(options)
    this.y = new OneEuroFilter(options)
    this.z = new OneEuroFilter(options)
  }

  filter(v: { x: number; y: number; z: number }, t: number): void {
    v.x = this.x.filter(v.x, t)
    v.y = this.y.filter(v.y, t)
    v.z = this.z.filter(v.z, t)
  }

  reset(): void {
    this.x.reset()
    this.y.reset()
    this.z.reset()
  }
}

export type RotationVector = { x: number; y: number; z: number }

/**
 * Smoothing for rotations, done in the Lie algebra (a "rotation vector").
 *
 * Filtering the four raw quaternion components is wrong: a component-wise average
 * of two unit quaternions is not a unit quaternion, which shortens the result and
 * visibly biases the head back toward identity during fast turns. Instead we take
 * the log map (axis * angle, in radians), filter that — it is continuous and
 * centred on zero at rest — and map back with the exponential. For the <90°
 * rotations a face makes, the two maps are unambiguous.
 *
 * Quaternion <-> rotation-vector conversion is done inline so the hot path stays
 * allocation-free and free of a three.js dependency (this module is unit-tested
 * under plain Node).
 */
export class QuaternionSmoother {
  private readonly filters: Vec3Filter
  private readonly prev: RotationVector = { x: 0, y: 0, z: 0 }
  private readonly rv: RotationVector = { x: 0, y: 0, z: 0 }
  private readonly out: RotationVector & { w: number } = { x: 0, y: 0, z: 0, w: 1 }
  private hasPrev = false

  constructor(options?: OneEuroOptions) {
    this.filters = new Vec3Filter(options ?? POSE_FILTER)
  }

  /**
   * @param q unit quaternion
   * @returns a filtered unit quaternion (reused buffer — copy it if you keep it).
   */
  filterQuaternion(q: { x: number; y: number; z: number; w: number }, timestamp: number): RotationVector & { w: number } {
    // Shortest-arc normalisation: q and -q are the same rotation, so pick the
    // branch nearest the previous sample before taking the log map.
    let { x, y, z, w } = q
    if (w < 0) {
      x = -x
      y = -y
      z = -z
      w = -w
    }

    // log map: rotation vector = axis * angle
    const len = Math.hypot(x, y, z)
    const r = this.rv
    if (len < 1e-9) {
      r.x = 0
      r.y = 0
      r.z = 0
    } else {
      const angle = 2 * Math.atan2(len, w)
      const s = angle / len
      r.x = x * s
      r.y = y * s
      r.z = z * s
    }

    // Stay on a continuous branch so smoothing never takes the long way round.
    if (this.hasPrev && r.x * this.prev.x + r.y * this.prev.y + r.z * this.prev.z < 0) {
      r.x = -r.x
      r.y = -r.y
      r.z = -r.z
    }
    this.hasPrev = true

    this.filters.filter(r, timestamp)
    this.prev.x = r.x
    this.prev.y = r.y
    this.prev.z = r.z

    // exp map: back to a unit quaternion
    const angle = Math.hypot(r.x, r.y, r.z)
    const out = this.out
    if (angle < 1e-9) {
      out.x = 0
      out.y = 0
      out.z = 0
      out.w = 1
    } else {
      const s = Math.sin(angle / 2) / angle
      out.x = r.x * s
      out.y = r.y * s
      out.z = r.z * s
      out.w = Math.cos(angle / 2)
    }
    return out
  }

  reset(): void {
    this.filters.reset()
    this.hasPrev = false
  }
}
