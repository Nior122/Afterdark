import { formatViews } from './video'
import { hashString } from './avatars'

/**
 * Derived view counts.
 *
 * Every video gets a plausible audience size without storing anything: the
 * ceiling is a log-uniform hash of the video id, and the ramp starts at 18 %
 * of that ceiling the moment the video appears and reaches 100 % after two
 * days. The same id always resolves to the same number on every device, and
 * counts age on their own as time passes.
 */

/** Two days in milliseconds — the ramp from floor to ceiling. */
const RAMP_MS = 2 * 24 * 60 * 60 * 1000

/** Minimum fraction of the ceiling shown when the video is brand new. */
const FLOOR_FRACTION = 0.18

/**
 * Log-uniform ceiling for a video, hashed from its id. Range is roughly 100
 * to ~100 K, with the same shape as subscriber counts so the distribution
 * feels natural — most videos sit in the low thousands, a few break out.
 */
function viewCeiling(id: string): number {
  const h = hashString(id || 'afterdark')
  const spread = (h >>> 8) % 1000
  return Math.round(10 ** (2 + (spread / 1000) * 3))
}

/**
 * Derived view count for a video, based on its id and optional creation
 * timestamp. Without a timestamp the video shows at the floor (just
 * published); with one the count ramps linearly to the ceiling over two days.
 */
export function deriveViews(id: string, createdAt?: number): string {
  const ceiling = viewCeiling(id)
  let fraction = FLOOR_FRACTION
  if (createdAt !== undefined) {
    const elapsed = Date.now() - createdAt
    if (elapsed >= RAMP_MS) {
      fraction = 1
    } else if (elapsed > 0) {
      fraction = FLOOR_FRACTION + (1 - FLOOR_FRACTION) * (elapsed / RAMP_MS)
    }
  }
  return formatViews(Math.round(ceiling * fraction))
}
