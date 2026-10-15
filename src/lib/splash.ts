/**
 * The pre-hydration splash screen (the markup lives in index.html, inline, so it paints
 * before any JavaScript arrives).
 *
 * Hiding it is a three-way race: the app becomes ready, the app crashes, or neither
 * happens within a reasonable time. All three paths call in here, and all three are
 * idempotent, because a splash screen stuck over a working app is the worst possible
 * failure mode for a demo.
 */

const SPLASH_ID = 'boot-splash'
const FADE_MS = 340

let hidden = false

export function hideSplash(): void {
  if (hidden) return
  hidden = true
  const el = document.getElementById(SPLASH_ID)
  if (!el) return
  el.classList.add('is-leaving')
  window.setTimeout(() => el.setAttribute('hidden', ''), FADE_MS)
}

/** Last-resort timer: whatever happens, the splash does not outstay its welcome. */
export function armSplashTimeout(ms = 15_000): void {
  window.setTimeout(hideSplash, ms)
}
