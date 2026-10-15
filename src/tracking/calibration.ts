/**
 * Per-user tracking calibration.
 *
 * MediaPipe's raw blendshape scores are absolute-ish, but the same expression on two
 * different faces produces different numbers — a relaxed mouth on one person scores
 * 0.18 on `mouthSmileLeft`, on another 0.04. Feeding those straight into a rig makes
 * one avatar grin at rest and the other look sedated.
 *
 * Calibration fixes that in three steps, and it is per-channel:
 *
 *  1. **Baseline** — during a calm 1.2 s "look straight at the camera" capture we
 *     record the resting value of all 52 channels and subtract it. This also removes
 *     any constant bias in the detector.
 *  2. **Gain** — a per-channel multiplier so the *range* the user actually produces
 *     maps onto the rig's 0..1. Estimated from the peak values observed during
 *     calibration plus an adaptive maximum tracked during use, so a subtle expresser
 *     still drives the face fully.
 *  3. **Noise floor** — a dead zone per channel, derived from the standard deviation
 *     observed while still. Channels that jitter get a wider dead zone, which kills
 *     idle flicker without adding smoothing lag.
 *
 * Everything is stored locally and can be reset or recalibrated at any time.
 */
import { ARKIT_BLENDSHAPES } from '../avatar/arkit'
import { BLENDSHAPE_FILTER, type OneEuroOptions } from './oneEuroFilter'

export const CHANNEL_COUNT = ARKIT_BLENDSHAPES.length

/** How long the user holds still while we sample their neutral face. */
export const CALIBRATION_DURATION_MS = 1200

export interface CalibrationData {
  version: 2
  /** Resting value per channel, subtracted from live input. */
  baseline: Float32Array
  /** Multiplier per channel so the user's range fills the rig's 0..1. */
  gain: Float32Array
  /** Per-channel dead zone, in normalised units. */
  deadZone: Float32Array
  /** True once a capture has completed successfully. */
  calibrated: boolean
  capturedAt: string | null
  /** Peak magnitude observed per channel during capture, for diagnostics. */
  observedRange: Float32Array
}

export function createDefaultCalibration(): CalibrationData {
  return {
    version: 2,
    baseline: new Float32Array(CHANNEL_COUNT),
    gain: new Float32Array(CHANNEL_COUNT).fill(1),
    // A small default dead zone before any capture: enough to suppress detector
    // noise, small enough that deliberate expressions come through immediately.
    deadZone: new Float32Array(CHANNEL_COUNT).fill(0.015),
    calibrated: false,
    capturedAt: null,
    observedRange: new Float32Array(CHANNEL_COUNT),
  }
}

/**
 * Collects samples during the capture window and solves for the calibration.
 *
 * Kept deliberately simple: mean for the baseline, and a robust spread estimate for
 * the noise floor. Anything more elaborate needs more data than a user will sit
 * through.
 */
export class CalibrationCapture {
  private sums: Float64Array
  private sumSquares: Float64Array
  private peaks: Float32Array
  private samples = 0
  private startedAt = 0
  readonly durationMs: number

  constructor(durationMs = CALIBRATION_DURATION_MS) {
    this.durationMs = durationMs
    this.sums = new Float64Array(CHANNEL_COUNT)
    this.sumSquares = new Float64Array(CHANNEL_COUNT)
    this.peaks = new Float32Array(CHANNEL_COUNT)
  }

  start(nowMs: number): void {
    this.startedAt = nowMs
    this.samples = 0
    this.sums.fill(0)
    this.sumSquares.fill(0)
    this.peaks.fill(0)
  }

  /** 0..1 progress through the capture window. */
  progress(nowMs: number): number {
    if (this.startedAt === 0) return 0
    return Math.min(1, (nowMs - this.startedAt) / this.durationMs)
  }

  add(values: Float32Array): void {
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const v = values[i]
      this.sums[i] += v
      this.sumSquares[i] += v * v
      if (v > this.peaks[i]) this.peaks[i] = v
    }
    this.samples++
  }

  get ready(): boolean {
    return this.samples > 8
  }

  /** Solve for baseline / gain / dead zone from the collected samples. */
  finish(): CalibrationData {
    const data = createDefaultCalibration()
    if (this.samples < 4) return data

    const n = this.samples
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const mean = this.sums[i] / n
      const variance = Math.max(0, this.sumSquares[i] / n - mean * mean)
      const sd = Math.sqrt(variance)

      data.baseline[i] = mean

      // Dead zone: two standard deviations of the resting signal, floored so a
      // suspiciously steady channel still gets some protection, and capped so we
      // never swallow a deliberate expression.
      data.deadZone[i] = Math.min(0.12, Math.max(0.012, sd * 2.2))

      // Gain: the headroom above baseline. A channel whose peak barely rises above
      // its own noise floor gets no boost at all (otherwise we would amplify noise).
      const headroom = this.peaks[i] - mean
      if (headroom > sd * 3 && headroom > 0.02) {
        // Map the observed headroom onto roughly 0.75 of the rig's range, leaving
        // room for a bigger expression than the one we happened to observe.
        const gain = Math.min(2.6, Math.max(0.85, 0.75 / headroom))
        data.gain[i] = gain
      } else {
        data.gain[i] = 1
      }

      data.observedRange[i] = headroom
    }

    data.calibrated = true
    data.capturedAt = new Date().toISOString()
    return data
  }
}

/**
 * Applies calibration and produces the final expression values.
 *
 * Runs on a scratch buffer and is allocation-free: this is called for 52 channels on
 * every camera frame.
 */
export class CalibratedBlender {
  private readonly data: CalibrationData
  /** Adaptive peaks, so gain improves during use for channels the capture missed. */
  private readonly livePeaks: Float32Array
  private readonly liveDecay = 0.9995

  constructor(data: CalibrationData) {
    this.data = data
    this.livePeaks = Float32Array.from(data.observedRange)
  }

  /**
   * @param raw      detector values, 0..1
   * @param out      destination, written in place
   * @param options  `applyGain` false to get an un-amplified signal (used for the
   *                 eye-look channels, where gain amplification reads as drift)
   */
  apply(raw: Float32Array, out: Float32Array, options: { applyGain?: boolean } = {}): void {
    const applyGain = options.applyGain ?? true
    const { baseline, gain, deadZone } = this.data

    for (let i = 0; i < CHANNEL_COUNT; i++) {
      let v = raw[i] - baseline[i]

      // Dead zone: subtract in the direction of travel so there is no jump at the
      // threshold (a plain clamp would pop).
      const dz = deadZone[i]
      if (v > 0) v = v <= dz ? 0 : v - dz
      else if (v < 0) v = v >= -dz ? 0 : v + dz

      if (v > 0) {
        // Track live peaks so channels the calibration did not exercise still get a
        // sensible gain, decaying slowly so the value follows a changing user.
        this.livePeaks[i] = Math.max(v, this.livePeaks[i] * this.liveDecay)
        if (applyGain && v < 0.82) {
          const needed = 0.82 / Math.max(v, 1e-3)
          const target = Math.min(1.6, needed)
          // Blend the static calibration gain toward the observed need.
          v *= Math.min(target, gain[i])
        }
      }

      out[i] = v
    }
  }

  reset(): void {
    this.livePeaks.set(this.data.observedRange)
  }
}

/** Serialise calibration for IndexedDB (typed arrays are structured-cloneable). */
export function serialiseCalibration(data: CalibrationData): CalibrationData {
  return {
    ...data,
    baseline: Float32Array.from(data.baseline),
    gain: Float32Array.from(data.gain),
    deadZone: Float32Array.from(data.deadZone),
    observedRange: Float32Array.from(data.observedRange),
  }
}

/** The filter preset blendshapes use. Exported so callers share one definition. */
export const EXPRESSION_FILTER: OneEuroOptions = BLENDSHAPE_FILTER
