/**
 * Adaptive quality.
 *
 * The target hardware is a mid-range Android phone on a metered Nigerian data plan,
 * so quality is not a preference — it is a performance contract. This module watches
 * frame time and steps quality down when the renderer cannot hold the target, then
 * (conservatively) back up when there is clear headroom. It also honours an explicit
 * "Lite" switch that pins quality low regardless of measurements, and remembers the
 * user's choice.
 *
 * Design rules:
 *  - **Step down fast, step up slowly.** A single bad second should reduce quality;
 *    it should take several good seconds to raise it, or the app will oscillate.
 *  - **Never change more than one dimension per step**, and wait a settling period
 *    after each change so the measurement reflects the new settings.
 *  - **Respect the tracker's budget.** Live mode reserves headroom for MediaPipe, so
 *    it targets a lower frame time than manual mode.
 */

export type QualityTier = 'lite' | 'balanced' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** Renderer pixel ratio cap. Device ratio is never exceeded. */
  maxPixelRatio: number
  /** Shadow map edge, or 0 to disable shadow mapping entirely. */
  shadowMapSize: number
  /** Soft contact shadow resolution (drei's ContactShadows). 0 disables. */
  contactShadowSize: number
  /** Enable the sheen + clearcoat lobes and the fake SSS term. */
  richMaterials: boolean
  /** Enable the environment map (an HDR read + PMREM generation). */
  environment: boolean
  /** Skin micro-detail texture resolution. */
  textureSize: number
  /** Animation loop cap. */
  targetFps: number
  /** Anti-aliasing on the WebGL context. Requires a context rebuild to change. */
  antialias: boolean
}

const TIERS: Record<QualityTier, QualitySettings> = {
  // Deliberately spartan: for a phone that is already dropping frames, the avatar
  // still has to track at 24 FPS, and every millisecond spent on shading is a
  // millisecond stolen from MediaPipe.
  lite: {
    tier: 'lite',
    maxPixelRatio: 1,
    shadowMapSize: 0,
    contactShadowSize: 256,
    richMaterials: false,
    environment: false,
    textureSize: 512,
    targetFps: 30,
    antialias: false,
  },
  balanced: {
    tier: 'balanced',
    maxPixelRatio: 1.5,
    shadowMapSize: 1024,
    contactShadowSize: 512,
    richMaterials: true,
    environment: true,
    textureSize: 1024,
    targetFps: 60,
    antialias: false,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    contactShadowSize: 1024,
    richMaterials: true,
    environment: true,
    textureSize: 1024,
    targetFps: 60,
    antialias: true,
  },
}

export const getTierSettings = (tier: QualityTier): QualitySettings => TIERS[tier]

/** Order of degradation. `high` is the most expensive. */
const ORDER: QualityTier[] = ['high', 'balanced', 'lite']

export interface AdaptiveQualityOptions {
  /** Starting tier, usually from device detection or the user's saved choice. */
  initial: QualityTier
  /** If true, never step up or down — the user has pinned it. */
  pinned?: boolean
  /** Target frame time in ms. Live mode uses a looser budget. */
  targetFrameMs?: number
  /** Called whenever the effective settings change. */
  onChange: (settings: QualitySettings, reason: string) => void
}

/**
 * Frame-time watchdog with hysteresis.
 *
 * Uses a rolling median rather than a mean: a single 200 ms hitch from a garbage
 * collection or a camera frame arriving late should not trigger a permanent quality
 * drop, but a sustained 30 ms frame time should.
 */
export class AdaptiveQuality {
  private readonly windowMs: number[] = []
  private readonly windowSize = 45
  private tierIndex: number
  private pinned: boolean
  private targetFrameMs: number
  private readonly onChange: AdaptiveQualityOptions['onChange']
  private settleUntil = 0
  private now = 0
  private goodStreakMs = 0

  constructor(options: AdaptiveQualityOptions) {
    this.tierIndex = Math.max(0, ORDER.indexOf(options.initial))
    this.pinned = options.pinned ?? false
    this.targetFrameMs = options.targetFrameMs ?? 1000 / 30
    this.onChange = options.onChange
  }

  get settings(): QualitySettings {
    return TIERS[ORDER[this.tierIndex]]
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned
    if (pinned) {
      // Re-announce so the renderer applies the pinned tier immediately.
      this.onChange(this.settings, 'pinned')
    }
  }

  setTier(tier: QualityTier): void {
    const index = ORDER.indexOf(tier)
    if (index === this.tierIndex) return
    this.tierIndex = index
    this.settleUntil = this.now + 1200
    this.windowMs.length = 0
    this.goodStreakMs = 0
    this.onChange(this.settings, `set to ${tier}`)
  }

  setTargetFrameMs(ms: number): void {
    this.targetFrameMs = ms
  }

  /** Feed one frame's duration in milliseconds. */
  sample(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return
    this.now += frameMs

    this.windowMs.push(frameMs)
    if (this.windowMs.length > this.windowSize) this.windowMs.shift()

    if (this.pinned) return
    if (this.windowMs.length < this.windowSize) return
    if (this.now < this.settleUntil) return

    const median = this.median(this.windowMs)
    const worst = this.percentile(this.windowMs, 0.9)

    // Step down: the median frame is over budget, or the 90th percentile is badly
    // over. Either means the user is seeing stutter.
    if (median > this.targetFrameMs * 1.35 || worst > this.targetFrameMs * 2.2) {
      if (this.tierIndex < ORDER.length - 1) {
        this.tierIndex++
        this.settleUntil = this.now + 1500
        this.windowMs.length = 0
        this.goodStreakMs = 0
        this.onChange(this.settings, `frame time ${median.toFixed(1)} ms over budget`)
      }
      return
    }

    // Step up: comfortably fast for several consecutive seconds.
    if (median < this.targetFrameMs * 0.62) {
      this.goodStreakMs += this.windowMs.length * median
      if (this.goodStreakMs > 4000 && this.tierIndex > 0) {
        this.tierIndex--
        this.settleUntil = this.now + 2500
        this.windowMs.length = 0
        this.goodStreakMs = 0
        this.onChange(this.settings, 'sustained headroom')
      }
    } else {
      this.goodStreakMs = 0
    }
  }

  private median(values: number[]): number {
    return this.percentile(values, 0.5)
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
    return sorted[idx]
  }

  reset(): void {
    this.windowMs.length = 0
    this.goodStreakMs = 0
  }
}

/**
 * Pick a starting tier from device signals.
 *
 * `deviceMemory` and `hardwareConcurrency` are coarse (and deviceMemory is
 * Chromium-only), but between them and the screen size they separate a low-end
 * Android from a flagship well enough to avoid a bad first impression.
 */
export function detectInitialTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } }
  const cores = nav.hardwareConcurrency ?? 4
  const memory = nav.deviceMemory
  const saveData = nav.connection?.saveData === true
  const slowNetwork = nav.connection?.effectiveType === '2g' || nav.connection?.effectiveType === 'slow-2g'
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 380

  // Data Saver or a very slow connection: default to Lite and let them raise it.
  if (saveData || slowNetwork) return 'lite'
  if (cores <= 4) return smallScreen ? 'lite' : 'balanced'
  if (memory !== undefined && memory <= 3) return 'balanced'
  if (cores >= 8 && (memory === undefined || memory >= 6) && !smallScreen) return 'high'
  return 'balanced'
}

/** Rough network class, shown in the footer so the user understands what loaded. */
export function networkClass(): string {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }
  if (nav.connection?.saveData) return 'data saver'
  return nav.connection?.effectiveType ?? 'unknown'
}
