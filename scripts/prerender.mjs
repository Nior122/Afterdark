/**
 * Post-build step: static HTML for every video, plus sitemap.xml / robots.txt.
 *
 * The site is one app with two personalities (a runtime mode switch), and the
 * files below serve both:
 *
 *   dist/v/<id>/index.html   one page per video, 200, with a unique title,
 *                            description, canonical, Open Graph/Twitter tags and
 *                            a schema.org VideoObject block. The app is bundled
 *                            inside, so the player still works.
 *   dist/admin/index.html    the owner dashboard (noindex, not linked anywhere)
 *   dist/index.html          the catalogue shell (noindex but FOLLOWED — videos
 *                            are indexed at /v/<id>/, and the crawler still
 *                            flows through the home page to reach them)
 *   dist/404.html            same shell, for unknown paths on static hosts
 *   dist/sitemap.xml         every video URL + <lastmod> + poster (image ext.)
 *   dist/robots.txt          allow all crawlers, keep /admin out, point at the
 *                            sitemap
 *
 * Video pages and the sitemap are generated from the catalogue plus the bot
 * feed at build time, so a freshly published video needs a rebuild before its
 * static page exists — the dashboard's "Rebuild site" button (and the Worker's
 * automatic rebuild trigger, docs/google-search-console.md) covers that, and
 * on Cloudflare Pages the middleware already serves a live, indexable page in
 * the meantime (same head, from scripts/seo.mjs).
 *
 * Environment:
 *   VITE_SITE_URL                 canonical origin (set this for a real domain)
 *   VITE_TELEGRAM_FEED_URL        bot feed, merged into pages + sitemap
 *   VITE_GOOGLE_SITE_VERIFICATION Google Search Console token → meta tag on
 *                                 every page (verify whichever URL is opened)
 *
 * Run by `npm run build`; can also be run on its own after a build.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogue } from './load-catalogue.mjs'
import {
  SITE_NAME,
  applyHead,
  buildHead,
  escapeHtml,
  feedToSeoVideo,
  robotsTxt,
  sitemapXml,
} from './seo.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

/** Fallback matching the live deployment; set VITE_SITE_URL for a real domain. */
const FALLBACK_SITE_URL = 'https://nior122.github.io/Afterdark'
const configuredSiteUrl = (process.env.VITE_SITE_URL || '').trim()
const SITE_URL = (configuredSiteUrl || FALLBACK_SITE_URL).replace(/\/+$/, '')
if (!configuredSiteUrl) {
  console.warn(
    `⚠️  VITE_SITE_URL is not set — canonical URLs, Open Graph URLs and sitemap.xml will use\n` +
      `    ${FALLBACK_SITE_URL}\n` +
      `    Set VITE_SITE_URL to the domain the site is served from before submitting it to search engines.`,
  )
}

const FEED_URL = (process.env.VITE_TELEGRAM_FEED_URL || '').replace(/\/+$/, '')
const VERIFICATION = (process.env.VITE_GOOGLE_SITE_VERIFICATION || '').trim()

/** Path prefix of the deployment ("/" at a domain root, "/Afterdark/" on Pages). */
const basePath = (() => {
  try {
    const path = new URL(SITE_URL).pathname.replace(/\/+$/, '')
    return `${path}/`
  } catch {
    return '/'
  }
})()

/** Warm up the crawler's connection to the feed origin the app calls. */
const PRECONNECT = (() => {
  if (!FEED_URL) return ''
  let origin = ''
  try {
    origin = new URL(FEED_URL).origin
  } catch {
    origin = ''
  }
  if (!origin) return ''
  return `<link rel="preconnect" href="${escapeHtml(origin)}" crossorigin />`
})()

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{2,}$/

const headFor = (video) => buildHead(SITE_URL, video, { verification: VERIFICATION })
const withHead = (shell, head) => applyHead(shell, head, { basePath, preconnect: PRECONNECT })

const NEUTRAL_HEAD = [
  `<title>${SITE_NAME}</title>`,
  // "follow" keeps the crawl flowing through the catalogue to the video pages;
  // "noindex" stops the shell (no per-video content) from competing with them.
  `<meta name="robots" content="noindex, follow" />`,
  ...(VERIFICATION ? [`<meta name="google-site-verification" content="${escapeHtml(VERIFICATION)}" />`] : []),
].join('\n    ')

/**
 * Bot-published videos, so they get their own page and sitemap entry too.
 * Three tries: a hiccup at build time must not silently drop every feed URL
 * from the sitemap (Google treats vanishing URLs far worse than late ones).
 */
async function loadFeed() {
  if (!FEED_URL) return []
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${FEED_URL}/api/videos`, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'User-Agent': 'afterdark-build' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!Array.isArray(data?.videos)) throw new Error('unexpected feed shape')
      return data.videos.map(feedToSeoVideo).filter(Boolean)
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
  }
  console.warn(
    `⚠️  Could not read the Telegram feed at build time (${lastError?.message || lastError}); continuing with the committed catalogue.`,
  )
  return []
}

async function main() {
  const shell = await readFile(join(dist, 'index.html'), 'utf8')
  const catalogue = await loadCatalogue()
  const feedVideos = await loadFeed()

  const videos = []
  const seen = new Set()
  for (const video of [...catalogue, ...feedVideos]) {
    const id = String(video?.id || '')
    if (!ID_PATTERN.test(id)) {
      console.warn(`⚠️  Skipping video with an unusable id: ${JSON.stringify(video?.id)}`)
      continue
    }
    if (seen.has(id) || !video.title) continue
    seen.add(id)
    videos.push(video)
  }

  for (const video of videos) {
    const dir = join(dist, 'v', video.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), withHead(shell, headFor(video)), 'utf8')
  }

  // The owner dashboard gets its own file so /admin/ is a 200, not a 404.
  await mkdir(join(dist, 'admin'), { recursive: true })
  await writeFile(
    join(dist, 'admin', 'index.html'),
    withHead(shell, `<title>${SITE_NAME} — dashboard</title>\n    <meta name="robots" content="noindex, nofollow" />`),
    'utf8',
  )

  await writeFile(join(dist, 'sitemap.xml'), sitemapXml(SITE_URL, videos), 'utf8')
  await writeFile(join(dist, 'robots.txt'), robotsTxt(SITE_URL), 'utf8')

  // Catalogue shell + unknown-path fallback: neutral, noindex (but follow),
  // no video list.
  await writeFile(join(dist, 'index.html'), withHead(shell, NEUTRAL_HEAD), 'utf8')
  await writeFile(join(dist, '404.html'), withHead(shell, NEUTRAL_HEAD), 'utf8')

  // A video page for an id that has no prerendered file (posted after this
  // build). functions/_middleware.ts serves this file with a 200 — rebuilt
  // with the video's live metadata so it is INDEXABLE immediately instead of
  // waiting for the next build — and the app renders the video from the feed.
  await mkdir(join(dist, 'v'), { recursive: true })
  await writeFile(join(dist, 'v', '_shell.html'), withHead(shell, NEUTRAL_HEAD), 'utf8')

  console.log(
    `✓ prerendered ${videos.length} video page(s), admin page, sitemap.xml (${videos.length} URL${videos.length === 1 ? '' : 's'}) and robots.txt for ${SITE_URL}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
