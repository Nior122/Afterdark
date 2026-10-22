import { FEED_ORIGIN } from './settings'

/**
 * View reporting for the Worker's counter (`POST /api/videos/:id/view`).
 *
 * The page fires once per video id per page load; the Worker dedupes per
 * browser session using a random id kept in sessionStorage — a reload counts
 * as the same session, a new browser session (or device) counts again, and
 * nothing identifying the visitor is ever stored. Both video pages
 * (`/v/<id>/`, standalone, and the catalogue's `/watch/:id`) call this, so
 * views land in KV in either site mode. Without a Worker configured
 * (`VITE_TELEGRAM_FEED_URL` unset) this is a no-op and the site behaves
 * exactly as before — the counter is fire-and-forget either way: a failure
 * must never disturb the player.
 */

const SESSION_KEY = 'afterdark.session.v1'

/** Module fallback when storage is blocked, so one page load = one session. */
let memorySession = ''

function makeSessionId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
  return `s-${random}`.slice(0, 64)
}

function sessionId(): string {
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY)
    if (stored && /^[A-Za-z0-9_-]{6,64}$/.test(stored)) return stored
    const fresh = makeSessionId()
    window.sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    if (!memorySession) memorySession = makeSessionId()
    return memorySession
  }
}

/** Ids reported during this page load — guards React StrictMode's double effect. */
const reported = new Set<string>()

export function reportVideoView(id: string): void {
  if (!FEED_ORIGIN || !id || reported.has(id)) return
  reported.add(id)
  try {
    void fetch(`${FEED_ORIGIN}/api/videos/${encodeURIComponent(id)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId() }),
      // Survives navigating away right after opening a video.
      keepalive: true,
    }).catch(() => {
      /* offline or unknown video (seed catalogue ids) — nothing to do */
    })
  } catch {
    /* a browser without fetch would be a different problem entirely */
  }
}
