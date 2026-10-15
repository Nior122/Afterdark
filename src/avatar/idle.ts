/**
 * Idle life.
 *
 * A digital twin that stares unblinking is instantly uncanny. This module keeps the
 * avatar alive between inputs with four layered behaviours, all with different
 * periods so they never visibly sync up:
 *
 *  - **Blink** every 2-6 s, randomised, with a realistic asymmetrical profile
 *    (fast close ~70 ms, slower open ~140 ms) and occasional double blinks.
 *  - **Saccades**: tiny, ballistic eye movements that hold fixation for a random
 *    dwell, sometimes in pairs. This is the single most effective anti-uncanny trick.
 *  - **Breathing**: a slow chest/shoulder rise plus a subtle head bob, at 12-16
 *    breaths per minute.
 *  - **Head sway**: two incoherent low-frequency drift signals so the head is never
 *    perfectly still, plus occasional micro-corrections.
 *
 * Everything is additive and scaled by a "attention" weight, so during live tracking
 * the same code still runs (keeping the avatar alive between tracked frames) but with
 * the tracked values taking precedence.
 */

export interface IdleState {
  /** Blink closure 0..1 for the left eye. */
  blinkLeft: number
  blinkRight: number
  /** Gaze offset in -1..1 eye-rotation units. */
  gazeX: number
  gazeY: number
  /** Small additive head rotation in radians. */
  yaw: number
  pitch: number
  roll: number
  /** Breathing 0..1, used for shoulder/chest lift. */
  breath: number
  /** True while a blink is in progress (used to suppress competing input). */
  blinking: boolean
}

export const createIdleState = (): IdleState => ({
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  breath: 0,
  blinking: false,
})

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** Smooth 0..1 ease used for both blink phases. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2)
const easeIn = (t: number) => t * t * (3 - 2 * t)

export class IdleAnimator {
  private state: IdleState = createIdleState()

  // --- blink timers -------------------------------------------------------
  private nextBlinkIn = rand(2.0, 4.5)
  private blinkPhase: 'idle' | 'closing' | 'opening' = 'idle'
  private blinkT = 0
  private blinkCloseDuration = 0.07
  private blinkOpenDuration = 0.15
  private queuedDouble = false

  // --- saccades -----------------------------------------------------------
  private nextSaccadeIn = rand(0.4, 1.6)
  private saccade: { x0: number; y0: number; x1: number; y1: number; t: number; duration: number } | null = null
  private gazeX = 0
  private gazeY = 0

  // --- breathing / sway ---------------------------------------------------
  private time = 0
  private breathRate = rand(12, 16) / 60 // Hz
  private swayPhaseA = rand(0, Math.PI * 2)
  private swayPhaseB = rand(0, Math.PI * 2)
  private swayPhaseC = rand(0, Math.PI * 2)
  private microTilt = 0
  private nextMicroIn = rand(3, 9)

  /** Scale applied to everything: 0 freezes the avatar entirely. */
  liveliness = 1

  get current(): Readonly<IdleState> {
    return this.state
  }

  /** Force a blink — used by the manual eye panel's hold-to-blink button. */
  triggerBlink(): void {
    if (this.blinkPhase !== 'idle') return
    this.blinkPhase = 'closing'
    this.blinkT = 0
    this.blinkCloseDuration = rand(0.055, 0.085)
    this.blinkOpenDuration = rand(0.12, 0.19)
  }

  /** Update and return the current idle contributions. */
  update(dt: number): Readonly<IdleState> {
    // Clamp dt so a backgrounded tab does not produce a giant jump on return.
    const delta = Math.min(0.1, Math.max(0, dt))
    this.time += delta
    const s = this.state
    const lively = this.liveliness

    // --- blink -------------------------------------------------------------
    if (this.blinkPhase === 'idle') {
      this.nextBlinkIn -= delta
      if (this.nextBlinkIn <= 0) {
        this.triggerBlink()
        // 18% of blinks come in pairs, as real blinks do.
        this.queuedDouble = Math.random() < 0.18
      }
    } else {
      this.blinkT += delta
      if (this.blinkPhase === 'closing') {
        const t = this.blinkT / this.blinkCloseDuration
        s.blinkLeft = easeIn(Math.min(1, t))
        // Perfectly synchronised eyes look robotic; add a tiny offset.
        s.blinkRight = easeIn(Math.min(1, t * 0.94))
        if (t >= 1) {
          this.blinkPhase = 'opening'
          this.blinkT = 0
        }
      } else {
        const t = this.blinkT / this.blinkOpenDuration
        s.blinkLeft = 1 - easeOut(Math.min(1, t))
        s.blinkRight = 1 - easeOut(Math.min(1, t * 1.06))
        if (t >= 1) {
          s.blinkLeft = 0
          s.blinkRight = 0
          this.blinkPhase = 'idle'
          this.nextBlinkIn = this.queuedDouble ? rand(0.22, 0.38) : rand(2.0, 6.0)
          this.queuedDouble = false
        }
      }
    }
    s.blinking = this.blinkPhase !== 'idle'

    // --- saccades ----------------------------------------------------------
    if (this.saccade) {
      this.saccade.t += delta
      const t = Math.min(1, this.saccade.t / this.saccade.duration)
      // Saccades are ballistic: fast, slightly overshooting, then settle.
      const e = easeOut(t)
      const overshoot = Math.sin(t * Math.PI) * 0.06
      this.gazeX = this.saccade.x0 + (this.saccade.x1 - this.saccade.x0) * e + overshoot * (this.saccade.x1 - this.saccade.x0)
      this.gazeY = this.saccade.y0 + (this.saccade.y1 - this.saccade.y0) * e
      if (t >= 1) this.saccade = null
    } else {
      this.nextSaccadeIn -= delta
      if (this.nextSaccadeIn <= 0) {
        const dwell = rand(0.22, 0.7)
        this.saccade = {
          x0: this.gazeX,
          y0: this.gazeY,
          // Small fixations: mostly horizontal, a little vertical.
          x1: clamp(rand(-0.16, 0.16), -0.35, 0.35),
          y1: clamp(rand(-0.09, 0.09), -0.2, 0.2),
          t: 0,
          duration: rand(0.04, 0.09),
        }
        this.nextSaccadeIn = dwell
      }
    }
    s.gazeX = this.gazeX * lively
    s.gazeY = this.gazeY * lively

    // --- breathing ---------------------------------------------------------
    // A slightly asymmetric waveform reads more like a breath than a sine.
    const phase = (this.time * this.breathRate) % 1
    const breathRaw = Math.sin(phase * Math.PI * 2)
    s.breath = (0.5 + 0.5 * breathRaw) * lively

    // --- head sway ---------------------------------------------------------
    // Three incoherent low frequencies. Amplitudes are tiny: a degree or two.
    const swayYaw =
      Math.sin(this.time * 0.21 + this.swayPhaseA) * 0.022 +
      Math.sin(this.time * 0.53 + this.swayPhaseB) * 0.008
    const swayPitch =
      Math.sin(this.time * 0.17 + this.swayPhaseB) * 0.014 +
      Math.sin(this.time * 0.41 + this.swayPhaseC) * 0.006 +
      // Breathing lifts the head a touch.
      (s.breath - 0.5) * 0.006
    const swayRoll = Math.sin(this.time * 0.13 + this.swayPhaseC) * 0.013

    // Occasional micro-correction, as if the subject is refocusing attention.
    this.nextMicroIn -= delta
    if (this.nextMicroIn <= 0) {
      this.microTilt = rand(-0.02, 0.02)
      this.nextMicroIn = rand(3.5, 9)
    }
    this.microTilt *= Math.pow(0.2, delta) // decay back to zero

    s.yaw = (swayYaw + this.microTilt * 0.5) * lively
    s.pitch = (swayPitch + this.microTilt * 0.35) * lively
    s.roll = (swayRoll + this.microTilt * 0.2) * lively

    return s
  }

  reset(): void {
    this.state = createIdleState()
    this.blinkPhase = 'idle'
    this.saccade = null
    this.gazeX = 0
    this.gazeY = 0
    this.nextBlinkIn = rand(2.0, 4.5)
    this.nextSaccadeIn = rand(0.4, 1.6)
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
