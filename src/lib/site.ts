/**
 * Public location of this deployment.
 *
 * `VITE_SITE_URL` is baked in at build time (Cloudflare Pages / GitHub Actions
 * environment variable) and is the single source of truth for canonical URLs,
 * Open Graph tags, the sitemap and robots.txt. It may include a sub-path, e.g.
 * `https://nior122.github.io/Faceverify` — no trailing slash.
 *
 * Unset, the app falls back to the current GitHub Pages location (the repo was
 * renamed from Faceverify to Afterdark) or, on localhost, to the local origin.
 */
const DEFAULT_SITE_URL = 'https://nior122.github.io/Afterdark'

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

/**
 * The link to hand to another person: the video's own `/v/<id>/` page, on the
 * host the visitor is actually using, under the deployment's sub-path.
 *
 * This URL is the one that previews. Chat bots (WhatsApp, Telegram, iMessage,
 * Discord, Facebook) never run JavaScript, so only a page that ships its own
 * `<meta property="og:*">` block in the HTML produces a card with a thumbnail
 * and the caption — and the only such page is the prerendered `/v/<id>/` one.
 * `/watch/<id>` is the same video inside the app but a bare shell to a bot:
 * pasting it shows nothing but the URL. SITE_URL is not used here on purpose:
 * it is baked at build time and can name a different host (or a stale one)
 * while the visitor is clearly reading the site from this origin.
 */
export function shareUrl(id: string): string {
  if (typeof window === 'undefined') return videoUrl(id)
  return `${window.location.origin}${deployBase()}${videoPath(id).replace(/^\/+/, '')}`
}

/**
 * Directory the app is mounted at: `/` at a domain root, `/Afterdark/` on
 * GitHub Pages. Taken from the `<base href>` the prerender step injects (which
 * is derived from VITE_SITE_URL), falling back to Vite's BASE_URL.
 */
export function deployBase(): string {
  if (typeof document !== 'undefined') {
    const tag = document.querySelector('base')?.getAttribute('href')
    if (tag) {
      try {
        const path = new URL(tag, window.location.origin).pathname
        return path.endsWith('/') ? path : `${path}/`
      } catch {
        /* fall through to BASE_URL */
      }
    }
  }
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** Path of the admin dashboard on this deployment. */
export function adminPath(): string {
  return `${deployBase()}admin/`
}
