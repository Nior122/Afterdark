/**
 * Public location of this deployment.
 *
 * `VITE_SITE_URL` is baked in at build time (Cloudflare Pages / GitHub Actions
 * environment variable) and is the single source of truth for canonical URLs,
 * Open Graph tags, the sitemap and robots.txt. It may include a sub-path, e.g.
 * `https://nior122.github.io/Faceverify` — no trailing slash.
 *
 * Unset, the app falls back to the current GitHub Pages location (so that
 * deployment stays correct) or, on localhost, to the local origin.
 */
const DEFAULT_SITE_URL = 'https://nior122.github.io/Faceverify'

const configured = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? '').trim()

const isLocalHost =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(window.location.hostname)

export const SITE_URL = (configured || (isLocalHost ? window.location.origin : DEFAULT_SITE_URL)).replace(
  /\/+$/,
  '',
)

export const SITE_NAME = 'AfterDark'

/** Canonical path of a video page. Always the `/v/<id>/` shape. */
export function videoPath(id: string): string {
  return `/v/${encodeURIComponent(id)}/`
}

function normalisePath(path: string): string {
  return path.replace(/^(\.\/)+/, '').replace(/^\/+/, '')
}

/** Absolute URL for a site path (`/v/abc/`) or a public asset (`thumbnails/x.svg`). */
export function absoluteUrl(path: string): string {
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  return `${SITE_URL}/${normalisePath(path)}`
}

/** Absolute URL of a video's own page. */
export function videoUrl(id: string): string {
  return `${SITE_URL}${videoPath(id)}`
}
