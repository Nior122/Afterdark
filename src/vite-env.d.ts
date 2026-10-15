/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Replaced at build time by Vite's `define` (see vite.config.ts). Kept as a
 * literal in production builds so `if (__DEV_MODE__)` branches are eliminated by
 * the minifier and dev-only logging costs nothing on a user's data plan.
 */
declare const __DEV_MODE__: boolean

interface Navigator {
  /** Non-standard but widely supported on Android Chrome; absent on iOS Safari. */
  vibrate?: (pattern: number | number[]) => boolean
}

interface HTMLVideoElement {
  /** Safari-only prefixed hint that makes a muted inline video autoplay. */
  webkitPlaysInline?: boolean
}

interface Window {
  /** Present only in browsers that support live MediaStream capture. */
  MediaRecorder?: typeof MediaRecorder
}
