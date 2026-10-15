/**
 * Small shared utilities. Kept dependency-free so they can be unit-tested under
 * plain Node and reused by the photo worker.
 */

/** Haptic-style feedback where the platform supports it. Silently no-ops elsewhere. */
export function haptic(pattern: number | number[] = 8): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }
    nav.vibrate?.(pattern)
  } catch {
    /* Safari throws on vibrate in some contexts — ignore. */
  }
}

const LOG_PREFIX = '[faceverify]'

/**
 * Dev-time logging that is stripped from production by the bundler's dead-code
 * elimination (the `__DEV_MODE__` define is a literal false in prod builds).
 */
export const devLog = (...args: unknown[]): void => {
  if (__DEV_MODE__) console.log(LOG_PREFIX, ...args)
}

export const devWarn = (...args: unknown[]): void => {
  if (__DEV_MODE__) console.warn(LOG_PREFIX, ...args)
}

/** Always-on warning for unexpected but recoverable states. */
export const warn = (...args: unknown[]): void => {
  console.warn(LOG_PREFIX, ...args)
}

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Frame-rate independent exponential approach. `halfLife` in seconds. */
export const damp = (current: number, target: number, halfLife: number, dt: number): number => {
  if (halfLife <= 0) return target
  return target + (current - target) * Math.pow(0.5, dt / halfLife)
}

/** Random float in [min, max). */
export const rand = (min: number, max: number): number => min + Math.random() * (max - min)

/** True when the user has asked the OS to reduce motion. */
/**
 * True when the app is running inside an iframe.
 *
 * This matters for exactly one error message. A camera denial inside an embedded frame
 * is usually not the user's browser settings at all — it is the host page's permissions
 * policy refusing the camera to the frame — and telling someone to go and change their
 * site settings when the real fix is "open this in its own tab" wastes their time.
 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    // A cross-origin frame throws on access, which itself proves we are embedded.
    return true
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/** A promise plus its resolver, for one-shot handshakes between modules. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Conditionally-typed error carrying a user-facing message plus a machine code,
 * so the UI can map failures to friendly guidance without string matching.
 */
export class AppError extends Error {
  readonly code: string
  readonly hint?: string

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.hint = hint
  }
}
