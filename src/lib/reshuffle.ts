/**
 * Catalogue rotation: the home/browse/related order reshuffles on a fixed
 * time window (two minutes) so the front page never freezes on the same
 * top rows, and every old clip gets surfaced regularly.
 *
 * The shuffle is seeded by the window index, not by random() per visitor:
 * within one window every client (and every page of a paginated list) sees
 * the exact same order — so shared links, crawlers and two tabs agree — and
 * the order changes for everyone at the same instants. Trending and Explore
 * keep their own rankings; this only orders the raw catalogue.
 */

/** Milliseconds a reshuffle lasts; the order is stable inside each window. */
export const RESHUFFLE_INTERVAL_MS = 120_000

/** Index of the current reshuffle window (floor of the clock / interval). */
export function reshuffleBucket(now: number = Date.now()): number {
  return Math.floor(now / RESHUFFLE_INTERVAL_MS)
}

/** mulberry32 — tiny, fast, deterministic; good enough for display order. */
function prng(seed: number): () => number {
  let t = (seed >>> 0) + 0x6d2b79f5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic Fisher–Yates: same items + same seed → same order.
 * Returns a copy; never mutates the input.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  const rand = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

/**
 * Milliseconds until the next window boundary. Scheduling on this (instead of
 * a plain fixed interval) keeps open tabs flipping at the same instant as
 * fresh page loads, and self-corrects any timer drift.
 */
export function msUntilNextBucket(now: number = Date.now()): number {
  return RESHUFFLE_INTERVAL_MS - (now % RESHUFFLE_INTERVAL_MS)
}
