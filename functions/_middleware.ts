/**
 * Cloudflare Pages middleware — the SEO/traffic switch for the site.
 *
 * Two jobs, both decided at request time from the Worker's `/api/settings`, so
 * the owner can change them from the bot or the dashboard without a rebuild:
 *
 * 1. **Direct-link mode + a redirect URL set** → every HTML page that is not a
 *    video page answers a real `302` to that URL. Video pages (`/v/<id>/`), the
 *    dashboard (`/admin`), assets and the crawler files (`sitemap.xml`,
 *    `robots.txt`) are never redirected, so links keep working and Google/Bing
 *    keep reading the sitemap. Nothing is cloaked: crawlers get the same 302 a
 *    visitor gets.
 * 2. **A video added after the last build** has no prerendered file. Instead of
 *    a 404 it gets the shell, which renders the video from the live feed — so
 *    "every video, old or new" works from its own link in both modes.
 *
 * If the Worker is unreachable (or `VITE_TELEGRAM_FEED_URL` is not set on the
 * Pages project) every rule falls through to the normal static site: no
 * redirects, no surprises.
 */

interface Env {
  VITE_TELEGRAM_FEED_URL?: string
  TELEGRAM_FEED_URL?: string
  ASSETS?: { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> }
}

interface Settings {
  mode?: 'public' | 'direct'
  redirectUrl?: string
}

interface Context {
  request: Request
  env: Env
  next: () => Promise<Response>
}

/** Paths that must never be redirected (assets, crawler files, dashboard). */
const EXCLUDED_PREFIXES = [
  '/admin',
  '/assets/',
  '/thumbnails/',
  '/avatars/',
  '/api/',
  '/_',
]

const EXCLUDED_FILES = new Set([
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.svg',
  '/favicon.ico',
  '/404.html',
  '/site.webmanifest',
])

const VIDEO_PATH = /^\/v\/(?:[^/]+\/?)?$/
const VIDEO_ANY = /^\/v\//
/** Anything with a file extension is an asset request, never a page. */
const HAS_EXTENSION = /\.[a-z0-9]{2,5}$/i

const CACHE_TTL_SECONDS = 60

function feedOrigin(env: Env): string {
  const raw = env.VITE_TELEGRAM_FEED_URL || env.TELEGRAM_FEED_URL || ''
  return String(raw).trim().replace(/\/+$/, '')
}

async function readSettings(origin: string): Promise<Settings | null> {
  try {
    const response = await fetch(`${origin}/api/settings`, {
      // One request per minute at most, not one per visitor.
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      headers: { Accept: 'application/json' },
      // Never let a hung Worker hang the site: after this grace period the
      // request is cut and the static page is served (the client re-fetches
      // settings with its own timeout).
      signal: AbortSignal.timeout(2000),
    } as RequestInit)
    if (!response.ok) return null
    return (await response.json()) as Settings
  } catch {
    return null
  }
}

function isNavigation(request: Request, pathname: string): boolean {
  if (EXCLUDED_FILES.has(pathname)) return false
  if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false
  if (HAS_EXTENSION.test(pathname)) return false
  const accept = request.headers.get('accept') || ''
  // Browsers send text/html for a page; assets send image/*, text/css, etc.
  return accept === '' || accept.includes('text/html') || accept.includes('*/*')
}

function redirectTarget(settings: Settings | null, requestUrl: URL): string {
  if (!settings || settings.mode !== 'direct') return ''
  const raw = String(settings.redirectUrl || '').trim()
  if (!raw) return ''
  try {
    const target = new URL(raw)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return ''
    // Redirecting to ourselves would loop; fall through to the neutral page.
    if (target.origin === requestUrl.origin) return ''
    return target.toString()
  } catch {
    return ''
  }
}

/** A video page whose file was never prerendered still deserves a 200. */
async function serveVideo(context: Context, url: URL): Promise<Response> {
  const response = await context.next()
  if (response.status !== 404) return response
  // The fallback shell is itself under /v/ — never recurse.
  if (url.pathname === '/v/_shell.html') return response

  const assets = context.env.ASSETS
  if (!assets) return response
  const shell = await assets.fetch(new URL('/v/_shell.html', url).toString())
  if (!shell.ok) return response

  return new Response(shell.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // A page rendered from the live feed has no prerendered metadata.
      'X-Robots-Tag': 'noindex, follow',
    },
  })
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next()

  if (VIDEO_ANY.test(url.pathname)) return serveVideo(context, url)

  const origin = feedOrigin(env)
  if (!origin) return context.next()

  if (!isNavigation(request, url.pathname)) return context.next()

  const target = redirectTarget(await readSettings(origin), url)
  if (!target) return context.next()

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store, max-age=0',
      Vary: 'Accept',
    },
  })
}
